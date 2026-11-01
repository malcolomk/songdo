// freenote.js — 프리노트
// · jipar5/junkoo 가 Fixa 'Refilled locations' 표(CSV 또는 엑셀)를 올리면 모든 직원이 같은 목록을 봄
// · 오늘 할일(매장 재고 체크 아래)에 "프리노트 N개" 카드 → 누르면 목록 (사진·품명·채운 수량·예상 매출·창고 재고/위치)
// · 서버 표: freenote_uploads (DB설정/23_프리노트.sql) — 올릴 때마다 쌓이고 최신 것만 표시
(function () {
  "use strict";

  var T = "freenote_uploads", MANAGERS = ["jipar5", "junkoo"];
  var state = { cur: null, q: "", loaded: false, done: {}, isNew: {} };   // isNew: { artno: set_by }   // done: { artno: done_by }

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function me() { try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || "").trim(); } catch (e) { return ""; } }
  function isManager() { return MANAGERS.indexOf(me().toLowerCase()) !== -1; }
  function client() { try { return typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { return null; } }
  function toast(m, t) { if (typeof showToast === "function") showToast(m, t || "info"); }
  function pad8(v) { var d = String(v == null ? "" : v).replace(/\D/g, ""); return d && d.length <= 8 ? d.padStart(8, "0") : d; }
  function num(v) { var n = Number(String(v == null ? "" : v).replace(/[^\d.\-]/g, "")); return isNaN(n) ? 0 : n; }
  function fmtNum(n) { return Number(n || 0).toLocaleString("ko-KR"); }
  function fmtWhen(iso) { if (!iso) return ""; var d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function zl(z) { return typeof window.zoneLabel === "function" ? window.zoneLabel(z) : z; }
  function catalog(k) {
    var cat = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
    return cat.find(function (x) { return pad8(x.artNo || x.artno) === k; }) || null;
  }
  var stockCache = null, stockAt = 0;
  function stockOf(k) {
    if (!stockCache || Date.now() - stockAt > 5000) {
      stockCache = {}; stockAt = Date.now();
      try { (typeof buildStockMap === "function" ? buildStockMap() : new Map()).forEach(function (v, key) { var p = pad8(key); stockCache[p] = (stockCache[p] || 0) + (Number(v.currentStock) || 0); }); } catch (e) {}
    }
    return stockCache[k] || 0;
  }

  // ---------- 파일 읽기 (CSV / 엑셀) ----------
  var COLS = {
    art: [/^art\.?\s*no/i, /article\s*(number|no)/i, /아티클/],
    image: [/^image$/i, /이미지|사진/],
    item: [/^item$/i, /article\s*name/i, /품명|제품명/],
    locs: [/available\s*locations/i],
    tasks: [/completed\s*tasks/i],
    pieces: [/refilled\s*pieces/i, /수량/],
    turnover: [/turnover/i, /매출/]
  };
  function findCol(header, key) {
    for (var i = 0; i < header.length; i++) { var h = String(header[i] || "").trim(); if (COLS[key].some(function (re) { return re.test(h); })) return i; }
    return -1;
  }
  function parseRows(rows) {
    var hi = rows.findIndex(function (r) { return findCol(r, "art") !== -1; });
    if (hi < 0) throw new Error("'Art. no' 열을 찾지 못했어요. Fixa 표를 그대로 내보낸 파일인지 확인해 주세요.");
    var h = rows[hi], ix = {}; Object.keys(COLS).forEach(function (k) { ix[k] = findCol(h, k); });
    var out = [];
    for (var r = hi + 1; r < rows.length; r++) {
      var row = rows[r] || [], art = pad8(row[ix.art]);
      if (!art || art.length !== 8) continue;
      out.push({
        art: art,
        item: ix.item >= 0 ? String(row[ix.item] || "").trim() : "",
        image: ix.image >= 0 ? String(row[ix.image] || "").trim() : "",
        locs: ix.locs >= 0 ? num(row[ix.locs]) : null,
        tasks: ix.tasks >= 0 ? num(row[ix.tasks]) : null,
        pieces: ix.pieces >= 0 ? num(row[ix.pieces]) : null,
        turnover: ix.turnover >= 0 ? num(row[ix.turnover]) : null
      });
    }
    if (!out.length) throw new Error("파일에 아티클이 없어요.");
    return out;
  }
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (typeof XLSX === "undefined") { reject(new Error("엑셀 읽기 도구를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.")); return; }
      var isCsv = /\.csv$/i.test(file.name), fr = new FileReader();
      fr.onerror = function () { reject(new Error("파일을 읽지 못했어요.")); };
      fr.onload = function () {
        try {
          // CSV 는 글자 그대로 읽어서 아티클 번호 앞자리 0 이 사라지지 않게
          var wb = isCsv ? XLSX.read(String(fr.result).replace(/^﻿/, ""), { type: "string", raw: true }) : XLSX.read(new Uint8Array(fr.result), { type: "array" });
          var ws = wb.Sheets[wb.SheetNames[0]];
          resolve(parseRows(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" })));
        } catch (e) { reject(e); }
      };
      if (isCsv) fr.readAsText(file, "utf-8"); else fr.readAsArrayBuffer(file);
    });
  }

  // ---------- 서버 ----------
  async function load() {
    var c = client(); if (!c || !me()) return;
    try {
      var r = await c.from(T).select("*").order("created_at", { ascending: false }).limit(1);
      if (r.error) throw r.error;
      state.cur = (r.data && r.data[0]) || null; state.loaded = true;
      await Promise.all([loadDone(), loadNew()]);
    } catch (e) { console.warn("freenote load", e); }
    renderCard(); if (isOpen()) renderList();
  }
  async function loadDone() {
    var c = client(); state.done = {};
    if (!c || !state.cur || !state.cur.id) return;
    try {
      var r = await c.from("freenote_done").select("artno,done_by").eq("upload_id", state.cur.id).limit(5000);
      if (!r.error) (r.data || []).forEach(function (x) { state.done[x.artno] = x.done_by || "✓"; });
    } catch (e) {}
  }
  async function loadNew() {
    var c = client(); if (!c) return;
    try {
      var r = await c.from("freenote_new").select("artno,set_by").limit(5000);
      if (!r.error) { state.isNew = {}; (r.data || []).forEach(function (x) { state.isNew[x.artno] = x.set_by || "✓"; }); }
    } catch (e) {}
  }
  // NEW 표시 켜고 끄기 (jipar5, junkoo 만)
  async function toggleNew(art) {
    if (!isManager()) return;
    var c = client(); if (!c) return;
    var was = state.isNew[art];
    if (was) delete state.isNew[art]; else state.isNew[art] = me();
    renderList(true);
    try {
      var r = was ? await c.from("freenote_new").delete().eq("artno", art)
                  : await c.from("freenote_new").insert([{ artno: art, set_by: me() }]);
      if (r.error && !/duplicate/i.test(String(r.error.message))) throw r.error;
    } catch (e) {
      if (was) state.isNew[art] = was; else delete state.isNew[art];
      renderList(true);
      var msg = String((e && e.message) || e);
      toast(/freenote_new|schema cache|404/i.test(msg) ? "DB 설정(23c_프리노트_NEW표시_권한.sql)을 먼저 실행해 주세요." : "새입고 표시 실패: " + msg, "danger");
    }
  }
  async function toggleDone(art) {
    if (!isManager()) return;   // 완료 표시는 jipar5, junkoo 만
    if (!state.cur || !state.cur.id) return;
    try { if (typeof isViewerUser !== "undefined" && isViewerUser) { toast("읽기 전용 계정은 표시할 수 없어요.", "warning"); return; } } catch (e) {}
    var c = client(); if (!c) return;
    var was = state.done[art];
    if (was) delete state.done[art]; else state.done[art] = me();
    renderList(true); renderCard();
    try {
      var r = was ? await c.from("freenote_done").delete().eq("upload_id", state.cur.id).eq("artno", art)
                  : await c.from("freenote_done").insert([{ upload_id: state.cur.id, artno: art, done_by: me() }]);
      if (r.error && !/duplicate/i.test(String(r.error.message))) throw r.error;
    } catch (e) {
      if (was) state.done[art] = was; else delete state.done[art];
      renderList(true);
      var msg = String((e && e.message) || e);
      toast(/freenote_done|schema cache|404/i.test(msg) ? "DB 설정(23b_프리노트_완료표시.sql)을 먼저 실행해 주세요." : "완료 표시 실패: " + msg, "danger");
    }
  }

  async function upload(file) {
    if (!isManager()) return;
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }
    var btn = document.getElementById("fn-upload-btn"); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 올리는 중…'; }
    try {
      var items = await readFile(file);
      if (state.cur && !confirm("새 파일(" + items.length + "개 아티클)로 Songdo Prenote를 바꿀까요?\n지금 목록은 기록으로 남아요.")) { renderList(); return; }
      var row = { file_name: file.name, row_count: items.length, items: items, uploaded_by: me() };
      var r = await c.from(T).insert([row]).select();
      if (r.error) throw r.error;
      state.cur = (r.data && r.data[0]) || Object.assign({ created_at: new Date().toISOString() }, row); state.done = {};
      toast("Songdo Prenote를 올렸어요 · " + items.length + "개 아티클", "success");
      renderCard(); renderList();
    } catch (e) {
      var msg = String((e && e.message) || e);
      toast(/freenote_uploads|schema cache|404/i.test(msg) ? "DB 설정(23_프리노트.sql)을 먼저 실행해 주세요." : "올리기 실패: " + msg, "danger");
      renderList();
    }
  }

  // ---------- 오늘 할일 카드 ----------
  function ensureCard() {
    var a = document.getElementById("menu-item-freenote"); if (a) return a;
    var anchor = document.getElementById("menu-item-storecheck"); if (!anchor || !anchor.parentNode) return null;
    a = document.createElement("a"); a.className = "menu-task"; a.id = "menu-item-freenote";
    a.addEventListener("click", openList);
    anchor.parentNode.insertBefore(a, anchor);   // 매장 재고 체크 바로 위
    return a;
  }
  function renderCard() {
    var a = ensureCard(); if (!a) return;
    var cur = state.cur, n = cur ? (cur.row_count || (cur.items || []).length) : 0;
    a.innerHTML = '<div class="menu-task-icon" style="background:#fef9c3; color:#a16207;"><i class="fa-solid fa-note-sticky"></i></div>' +
      '<div class="menu-task-body"><div class="menu-task-title">Songdo Prenote</div>' +
      '<div class="menu-task-sub">' + (cur ? esc(fmtWhen(cur.created_at)) + ' · ' + esc(cur.uploaded_by || "") + ' 올림' : (isManager() ? 'Fixa 표(CSV/엑셀)를 올려 주세요' : '아직 올라온 목록이 없어요')) + '</div></div>' +
      (n ? '<span class="menu-task-count' + (Object.keys(state.done).length >= n ? ' done' : '') + '">' + Object.keys(state.done).length + '/' + n + '</span>' : '') +
      '<i class="fa-solid fa-chevron-right menu-task-arrow"></i>';
  }

  // ---------- 목록 창 ----------
  function ensureSheet() {
    var el = document.getElementById("fn-sheet"); if (el) return el;
    el = document.createElement("div"); el.id = "fn-sheet"; el.className = "tb-sheet-backdrop";
    el.innerHTML = '<div class="tb-sheet fn-sheet" role="dialog" aria-modal="true">' +
      '<div class="tb-sheet-top"><span class="tb-sheet-step fn-step" id="fn-step"><i class="fa-solid fa-note-sticky"></i> Songdo Prenote</span><button type="button" class="tb-sheet-close" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="tb-sheet-scroll" id="fn-body"></div></div>' +
      '<input type="file" id="fn-file" accept=".csv,.xlsx,.xls" hidden>';
    el.addEventListener("click", function (e) { if (e.target === el || e.target.closest(".tb-sheet-close")) closeList(); });
    el.querySelector("#fn-file").addEventListener("change", function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) upload(f); });
    el.querySelector("#fn-body").addEventListener("input", function (e) { if (e.target.id === "fn-q") { state.q = e.target.value.trim().toLowerCase(); renderRows(); } });
    el.querySelector("#fn-body").addEventListener("click", function (e) {
      if (e.target.closest("#fn-upload-btn")) { document.getElementById("fn-file").click(); return; }
      var go = e.target.closest(".fn-go"); if (go) { e.stopPropagation(); goStock(go.dataset.art); return; }
      var nb = e.target.closest(".fn-newbtn"); if (nb) { e.stopPropagation(); toggleNew(nb.dataset.art); return; }
      var it = e.target.closest(".fn-item"); if (it && isManager()) toggleDone(it.dataset.art);
    });
    document.body.appendChild(el); return el;
  }
  function isOpen() { var el = document.getElementById("fn-sheet"); return !!(el && el.classList.contains("active")); }
  function openList() { ensureSheet().classList.add("active"); document.body.classList.add("tb-sheet-open"); state.q = ""; renderList(); if (!state.loaded) load(); }
  function closeList() { var el = document.getElementById("fn-sheet"); if (el) el.classList.remove("active"); document.body.classList.remove("tb-sheet-open"); }
  function goStock(art) {
    closeList();
    try {
      if (typeof switchTab === "function") switchTab("stock", document.getElementById("nav-stock-btn"));
      setTimeout(function () { var s = document.getElementById("stock-search"); if (s) { s.value = art; s.dispatchEvent(new Event("input", { bubbles: true })); } }, 150);
    } catch (e) {}
  }
  // HFB 번호 → 이름 (ex. 06 → Bath)
  var HFB_NAMES = { "01": "Living room", "02": "Storage", "03": "Workspace", "04": "Bedroom", "05": "Beds", "06": "Bath", "07": "Kitchen",
    "08": "Dining", "09": "Children", "10": "Lighting", "11": "Bed & bath textiles", "12": "Home textiles", "13": "Rugs", "14": "Cooking & eating",
    "15": "Cooking & eating", "16": "Decoration", "17": "Outdoor", "18": "Home organisation" };
  function hfbLabel(c) {
    var raw = c && c.hfb != null ? String(c.hfb).replace(/\D/g, "") : "";
    if (!raw) return "";
    var k = raw.padStart(2, "0");
    return k + (HFB_NAMES[k] ? " " + HFB_NAMES[k] : "");
  }
  function fmtArt(a) { a = pad8(a); return a.length === 8 ? a.slice(0, 3) + "." + a.slice(3, 6) + "." + a.slice(6) : a; }
  // 품명 나누기: "ÅBYÅN 오뷔온 바디퍼프3 ... AP" → 제목 "ÅBYÅN 오뷔온", 설명 "바디퍼프3 ... AP"
  function splitName(full, fallback) {
    var t = String(full || fallback || "").trim().split(/\s+/);
    if (!t[0]) return { title: "(품명 없음)", desc: "" };
    var n = (t[1] && /[가-힣]/.test(t[1])) ? 2 : 1;
    if (t[n] === "N" || t[n] === "NN") n++;   // "HEMNES N" 같은 접미어는 제목에 붙임
    return { title: t.slice(0, n).join(" "), desc: t.slice(n).join(" ") };
  }
  function renderList(keepScroll) {
    var body = document.getElementById("fn-body"); if (!body) return;
    var scroller = body; var top = keepScroll ? scroller.scrollTop : 0;
    var cur = state.cur, items = cur ? (cur.items || []) : [];
    var doneN = items.filter(function (x) { return state.done[x.art]; }).length;
    document.getElementById("fn-step").innerHTML = '<i class="fa-solid fa-note-sticky"></i> Songdo Prenote' + (cur ? ' · ' + esc(fmtWhen(cur.created_at)) : '');
    var tools = (isManager() ? '<button type="button" class="fn-upload" id="fn-upload-btn"><i class="fa-solid fa-file-arrow-up"></i> ' + (cur ? '새 파일' : '파일 올리기') + '</button>' : '');
    var head = cur
      ? '<div class="fn-progress"><b>' + doneN + ' / ' + items.length + '</b> 완료<div class="fn-bar"><i style="width:' + (items.length ? Math.round(doneN / items.length * 100) : 0) + '%"></i></div></div>'
      : '<div class="fn-progress empty">아직 올라온 목록이 없어요.' + (isManager() ? '<small>Fixa 보고서 표 ⋮ → 데이터 내보내기(CSV 또는 엑셀) 파일을 올려 주세요.</small>' : '') + '</div>';
    var search = items.length ? '<div class="fn-tools"><div class="perm-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" id="fn-q" placeholder="품명 또는 아티클 번호 검색" value="' + esc(state.q) + '"></div>' + tools + '</div>' : (tools ? '<div class="fn-tools">' + tools + '</div>' : '');
    body.innerHTML = head + search + '<div id="fn-rows" class="fn-list"></div>' + (cur ? '<div class="fn-foot">' + esc(cur.uploaded_by || "") + ' · ' + esc(cur.file_name || "") + (isManager() ? '<br>줄을 누르면 완료 표시 · 새입고 버튼으로 새 제품 표시 · 🔍 재고 조회' : '<br>🔍 누르면 재고 조회') + '</div>' : '');
    renderRows();
    if (keepScroll) scroller.scrollTop = top;
  }
  function renderRows() {
    var box = document.getElementById("fn-rows"); if (!box) return;
    var items = state.cur ? (state.cur.items || []) : [];
    var q = state.q, list = !q ? items : items.filter(function (x) {
      var c = catalog(x.art), nm = ((c && (c.artName || c.artname)) || "") + " " + (x.item || "");
      return x.art.indexOf(q.replace(/\D/g, "") || "~") !== -1 || nm.toLowerCase().indexOf(q) !== -1;
    });
    if (!items.length) { box.innerHTML = ""; return; }
    if (!list.length) { box.innerHTML = '<div class="tb-empty">검색 결과가 없어요.</div>'; return; }
    box.innerHTML = list.map(function (x) {
      var c = catalog(x.art), nm = splitName(c && (c.artName || c.artname), x.item), st = stockOf(x.art), loc = (c && c.location) || "", hfb = hfbLabel(c);
      var done = state.done[x.art], isNew = state.isNew[x.art];
      var img = x.image ? '<img src="' + esc(x.image) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
      return '<div class="fn-item' + (done ? ' done' : '') + (isManager() ? ' can' : ' view') + '" data-art="' + esc(x.art) + '" role="button" tabindex="0">' +
        '<div class="fn-thumb"><i class="fa-solid fa-couch"></i>' + img + (done ? '<span class="fn-check"><i class="fa-solid fa-check"></i></span>' : '') + '</div>' +
        '<div class="fn-info"><div class="fn-title">' + (isNew ? '<span class="fn-new">새입고</span>' : '') + esc(nm.title) + '</div>' +
          (nm.desc ? '<div class="fn-desc">' + esc(nm.desc) + '</div>' : '') +
          '<div class="fn-chips"><span class="fn-art">' + esc(fmtArt(x.art)) + '</span>' + (hfb ? '<span class="fn-loc">' + esc(hfb) + '</span>' : '') + '</div></div>' +
        '<div class="fn-right"><div class="fn-qty"><small>수량</small><b>' + fmtNum(x.pieces || 0) + '</b></div>' +
          '<div class="fn-icons">' + (st > 0 ? '<span class="fn-ico" title="창고 재고 ' + st + '개' + (loc && loc !== "미지정" ? ' · ' + esc(zl(loc)) : '') + '"><i class="fa-solid fa-warehouse"></i>' + st + '</span>' : '') +
          (isManager() ? '<button type="button" class="fn-ico fn-newbtn' + (isNew ? ' on' : '') + '" data-art="' + esc(x.art) + '" title="' + (isNew ? '새입고 표시 끄기' : '새로 들어온 제품으로 표시') + '">새입고</button>' : '') +
          '<button type="button" class="fn-ico fn-go" data-art="' + esc(x.art) + '" title="재고 조회에서 보기"><i class="fa-solid fa-magnifying-glass"></i></button></div></div></div>';
    }).join("");
  }

  // ---------- 시작 ----------
  var tries = 0, boot = setInterval(function () {
    tries++; ensureCard();
    if (client() && me()) {
      clearInterval(boot); renderCard(); load();
      try { client().channel("public:freenote_uploads").on("postgres_changes", { event: "INSERT", schema: "public", table: T }, function () { load(); }).subscribe(); } catch (e) {}
      try { client().channel("public:freenote_new").on("postgres_changes", { event: "*", schema: "public", table: "freenote_new" }, function () { loadNew().then(function () { if (isOpen()) renderList(true); }); }).subscribe(); } catch (e) {}
      try { client().channel("public:freenote_done").on("postgres_changes", { event: "*", schema: "public", table: "freenote_done" }, function () { loadDone().then(function () { renderList(true); renderCard(); }); }).subscribe(); } catch (e) {}
      setInterval(function () { if (!document.hidden) load(); }, 300000);
    } else if (tries > 120) clearInterval(boot);
  }, 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && state.loaded) renderCard(); });

  window.FreeNote = { open: openList, close: closeList, reload: load, parseRows: parseRows };
})();
