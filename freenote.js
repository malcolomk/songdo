// freenote.js — 프리노트
// · jipar5/junkoo 가 Fixa 'Refilled locations' 표(CSV 또는 엑셀)를 올리면 모든 직원이 같은 목록을 봄
// · 오늘 할일(매장 재고 체크 아래)에 "프리노트 N개" 카드 → 누르면 목록 (사진·품명·채운 수량·예상 매출·창고 재고/위치)
// · 서버 표: freenote_uploads (DB설정/23_프리노트.sql) — 올릴 때마다 쌓이고 최신 것만 표시
(function () {
  "use strict";

  var T = "freenote_uploads", MANAGERS = ["jipar5", "junkoo"];
  var state = { cur: null, metas: [], selDate: null, q: "", loaded: false, done: {}, isNew: {}, sort: (function () { try { return localStorage.getItem("fn_sort") || "qty"; } catch (e) { return "qty"; } })() };   // isNew: { artno: set_by }   // done: { artno: done_by }

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function me() { try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || "").trim(); } catch (e) { return ""; } }
  function isManager() { return MANAGERS.indexOf(me().toLowerCase()) !== -1; }
  function client() { try { return typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { return null; } }
  function toast(m, t) { if (typeof showToast === "function") showToast(m, t || "info"); }
  function pad8(v) { var d = String(v == null ? "" : v).replace(/\D/g, ""); return d && d.length <= 8 ? d.padStart(8, "0") : d; }
  function num(v) { var n = Number(String(v == null ? "" : v).replace(/[^\d.\-]/g, "")); return isNaN(n) ? 0 : n; }
  function fmtNum(n) { return Number(n || 0).toLocaleString("ko-KR"); }
  function fmtWhen(iso) { if (!iso) return ""; var d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function todayStr() { return typeof window.getTodayDateString === "function" ? window.getTodayDateString() : ymd(new Date()); }
  function addDays(ds, n) { var p = String(ds).split("-"), d = new Date(+p[0], +p[1] - 1, +p[2]); d.setDate(d.getDate() + n); return ymd(d); }
  function tomorrowStr() { return addDays(todayStr(), 1); }
  function metaDate(m) { return m.target_date ? String(m.target_date).slice(0, 10) : addDays(ymd(new Date(m.created_at)), 1); }
  function fmtDay(ds) {
    if (!ds) return "";
    var p = ds.split("-"), d = new Date(+p[0], +p[1] - 1, +p[2]), w = "일월화수목금토"[d.getDay()];
    return (+p[1]) + "/" + (+p[2]) + "(" + w + ")";
  }
  function relOf(ds) { return ds === todayStr() ? " · 오늘" : ds === tomorrowStr() ? " · 내일" : ds === addDays(todayStr(), -1) ? " · 어제" : ""; }
  function dayIn(ds) { return fmtDay(ds) + " 입고" + relOf(ds); }
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
          var text = null;
          if (isCsv) {
            // 한글 윈도우 엑셀로 저장한 CSV(CP949)는 utf-8 로 읽으면 글자가 깨짐 → euc-kr 로 다시 읽기
            var buf = new Uint8Array(fr.result);
            text = new TextDecoder("utf-8").decode(buf);
            if (text.indexOf("\uFFFD") !== -1) { try { text = new TextDecoder("euc-kr").decode(buf); } catch (e2) {} }
            text = text.replace(/^\uFEFF/, "");
          }
          // CSV 는 글자 그대로 읽어서 아티클 번호 앞자리 0 이 사라지지 않게
          var wb = isCsv ? XLSX.read(text, { type: "string", raw: true }) : XLSX.read(new Uint8Array(fr.result), { type: "array" });
          var ws = wb.Sheets[wb.SheetNames[0]];
          resolve(parseRows(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" })));
        } catch (e) { reject(e); }
      };
      fr.readAsArrayBuffer(file);
    });
  }

  // ---------- 서버 ----------
  async function load() {
    var c = client(); if (!c || !me()) return;
    try {
      var r = await c.from(T).select("id,target_date,created_at,uploaded_by,file_name,row_count").order("created_at", { ascending: false }).limit(80);
      if (r.error) {   // 23d 실행 전(날짜 칸 없음)이면 예전 방식으로
        r = await c.from(T).select("id,created_at,uploaded_by,file_name,row_count").order("created_at", { ascending: false }).limit(80);
        if (r.error) throw r.error;
      }
      // 날짜별로 가장 최근에 올린 것만
      var newest = (r.data || [])[0] || null;   // 가장 최근에 올린 것 (created_at 내림차순)
      if (newest) {
        if (state.loaded && (!state.latest || newest.id !== state.latest.id) && newest.uploaded_by !== me()) toast("📋 Songdo Prenote가 업데이트됐어요 · " + dayIn(metaDate(newest)), "info");
        state.latest = { id: newest.id, date: metaDate(newest), by: newest.uploaded_by, at: newest.created_at };
      }
      var seen = {}; state.metas = [];
      (r.data || []).forEach(function (m) { var d = metaDate(m); if (!seen[d]) { seen[d] = 1; state.metas.push(Object.assign({}, m, { _date: d })); } });
      state.metas.sort(function (a, b) { return a._date < b._date ? 1 : a._date > b._date ? -1 : 0; });
      // 기본: 내일 입고분 → 없으면 가장 최근 날짜
      // 항상 가장 최근에 올린 목록을 보여줌
      state.selDate = newest ? metaDate(newest) : null;
      await loadSelected();
      state.loaded = true;
      await Promise.all([loadDone(), loadNew()]);
    } catch (e) { console.warn("freenote load", e); }
    renderCard(); if (isOpen()) renderList();
  }
  async function loadSelected() {
    var c = client(), m = state.metas.find(function (x) { return x._date === state.selDate; });
    if (!c || !m) { state.cur = null; state.done = {}; return; }
    if (!state.cur || state.cur.id !== m.id || !state.cur.items) {
      var r = await c.from(T).select("*").eq("id", m.id).limit(1);
      if (r.error) throw r.error;
      state.cur = r.data && r.data[0] ? Object.assign({}, r.data[0], { _date: m._date }) : null;
    } else state.cur._date = m._date;
  }
  async function selectDate(d) {
    state.selDate = d; state.q = "";
    try { await loadSelected(); await loadDone(); } catch (e) { toast("불러오기 실패: " + ((e && e.message) || e), "danger"); }
    renderCard(); renderList();
    if (isOpen()) markView();
  }
  // 입고 날짜 고르기 창 (올릴 때 / 날짜 바꿀 때)
  function askDate(title, def, okText) {
    return new Promise(function (resolve) {
      var d = document.getElementById("fn-date-dlg");
      if (!d) { d = document.createElement("div"); d.id = "fn-date-dlg"; d.className = "perm-pw-backdrop"; d.innerHTML = '<div class="perm-pw-box"><div id="fn-date-body"></div></div>'; document.body.appendChild(d); }
      d.classList.add("active");
      document.getElementById("fn-date-body").innerHTML =
        '<div class="perm-pw-title fn-date-title"><i class="fa-solid fa-calendar-day"></i> ' + esc(title) + '</div>' +
        '<label class="perm-pw-label">입고 날짜</label><input type="date" id="fn-date-in" class="fn-date-in" value="' + esc(def) + '">' +
        '<div class="fn-date-quick"><button type="button" data-d="' + todayStr() + '">오늘</button><button type="button" data-d="' + tomorrowStr() + '">내일</button><button type="button" data-d="' + addDays(todayStr(), 2) + '">모레</button></div>' +
        '<div class="perm-pw-actions"><button type="button" class="perm-pw-cancel" id="fn-date-cancel">취소</button><button type="button" class="perm-pw-ok fn-date-ok" id="fn-date-ok">' + esc(okText) + '</button></div>';
      var done = function (v) { d.classList.remove("active"); resolve(v); };
      d.querySelectorAll(".fn-date-quick button").forEach(function (b) { b.onclick = function () { document.getElementById("fn-date-in").value = b.dataset.d; }; });
      document.getElementById("fn-date-cancel").onclick = function () { done(null); };
      document.getElementById("fn-date-ok").onclick = function () { var v = document.getElementById("fn-date-in").value; if (!v) { toast("날짜를 골라 주세요.", "warning"); return; } done(v); };
      d.onclick = function (e) { if (e.target === d) done(null); };
    });
  }
  async function changeDate() {
    if (!isManager() || !state.cur) return;
    var v = await askDate("입고 날짜 바꾸기", state.cur._date || tomorrowStr(), "바꾸기");
    if (!v || v === state.cur._date) return;
    var exists = state.metas.find(function (m) { return m._date === v && m.id !== state.cur.id; });
    if (exists && !confirm(fmtDay(v) + "에 이미 올린 목록이 있어요. 이 목록으로 바꿀까요?")) return;
    var c = client();
    try {
      var r = await c.from(T).update({ target_date: v }).eq("id", state.cur.id).select();
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw new Error("권한이 없거나 DB 설정(23d)이 아직이에요.");
      toast("입고 날짜를 " + fmtDay(v) + "(으)로 바꿨어요.", "success");
      state.selDate = v; state.cur = null; await load();
    } catch (e) {
      var msg = String((e && e.message) || e);
      toast(/target_date|schema cache|23d/i.test(msg) ? "DB 설정(23d_프리노트_입고날짜.sql)을 먼저 실행해 주세요." : "날짜 바꾸기 실패: " + msg, "danger");
    }
  }
  async function loadDone() {
    var c = client(); state.done = {};
    if (!c || !state.cur || !state.cur.id) return;
    try {
      var r = await c.from("freenote_done").select("artno,done_by,done_at").eq("upload_id", state.cur.id).limit(5000);
      if (!r.error) (r.data || []).forEach(function (x) { state.done[x.artno] = { by: x.done_by || "", at: x.done_at || null }; });
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
    // 완료: 직원 누구나 · 취소: 누른 본인 또는 jipar5, junkoo
    if (!state.cur || !state.cur.id) return;
    var cur0 = state.done[art];
    if (cur0 && !isManager() && String(cur0.by).toLowerCase() !== me().toLowerCase()) { toast(nmOf(cur0.by) + " 님이 완료한 항목이에요. 취소는 완료한 사람이나 관리자만 할 수 있어요.", "info"); return; }
    if (cur0 && !confirmUndo(art)) return;
    try { if (typeof isViewerUser !== "undefined" && isViewerUser) { toast("읽기 전용 계정은 표시할 수 없어요.", "warning"); return; } } catch (e) {}
    var c = client(); if (!c) return;
    var was = state.done[art];
    if (was) delete state.done[art]; else state.done[art] = { by: me(), at: new Date().toISOString() };
    renderList(true); renderCard();
    try {
      var r = was ? await c.from("freenote_done").delete().eq("upload_id", state.cur.id).eq("artno", art)
                  : await c.from("freenote_done").insert([{ upload_id: state.cur.id, artno: art, done_by: me() }]);
      if (r.error && !/duplicate/i.test(String(r.error.message))) throw r.error;
    } catch (e) {
      if (was) state.done[art] = was; else delete state.done[art];
      renderList(true);
      var msg = String((e && e.message) || e);
      toast(/freenote_done|schema cache|404/i.test(msg) ? "DB 설정(23b_프리노트_완료표시.sql)을 먼저 실행해 주세요." : /row-level security/i.test(msg) ? "완료 권한이 없어요. 관리자에게 DB 설정(23g_프리노트_완료_모든직원.sql) 실행을 부탁해 주세요." : "완료 표시 실패: " + msg, "danger");
    }
  }

  function nmOf(id) { try { var m = typeof USER_ID_NAMES !== "undefined" ? USER_ID_NAMES : {}; return m[String(id || "").toLowerCase()] || id || "?"; } catch (e) { return id || "?"; } }
  // 완료 취소는 실수 방지로 화면 안 확인 (브라우저 확인창은 막혀 있을 수 있어서 쓰지 않음): 2초 안에 한 번 더 누르면 취소
  var undoArm = {};
  function confirmUndo(art) {
    if (undoArm[art] && Date.now() - undoArm[art] < 2500) { delete undoArm[art]; return true; }
    undoArm[art] = Date.now(); toast("완료를 취소하려면 [취소]를 한 번 더 눌러 주세요.", "info");
    var b = document.querySelector('.fn-donebtn.undo[data-art="' + art + '"]'); if (b) { b.classList.add("armed"); b.textContent = "한 번 더"; setTimeout(function () { if (b.isConnected) { b.classList.remove("armed"); b.textContent = "취소"; } }, 2500); }
    return false;
  }
  // 올리기 결과를 목록 창 안에도 남김 (알림이 가려지거나 금방 사라져도 볼 수 있게)
  function setUpMsg(type, text) {
    state.upMsg = text ? { type: type, text: text } : null;
    var box = document.getElementById("fn-upmsg"); if (!box) return;
    box.className = "fn-upmsg " + (state.upMsg ? state.upMsg.type : "");
    box.innerHTML = state.upMsg ? esc(state.upMsg.text) : "";
    box.style.display = state.upMsg ? "" : "none";
  }
  async function upload(file) {
    if (!isManager()) { toast("Songdo Prenote 올리기는 jipar5, junkoo 만 할 수 있어요. (지금 아이디: " + (me() || "없음") + ")", "warning"); return; }
    toast("📄 " + file.name + " 읽는 중…", "info"); setUpMsg("info", "📄 " + file.name + " 읽는 중…");
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }
    var btn = document.getElementById("fn-upload-btn"); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 올리는 중…'; }
    try {
      var items = await readFile(file);
      var date = tomorrowStr();   // 입고 날짜는 자동으로 다음날
      // 같은 날짜 목록이 이미 있어도 묻지 않고 새 파일로 바꿈 (예전 목록은 기록으로 남음)
      //  ※ 확인창(confirm)은 브라우저에서 '대화상자 차단'이 켜져 있으면 바로 '취소'로 처리돼 아무 일도 안 일어나는 문제가 있었음
      var replaced = state.metas.some(function (m) { return m._date === date; });
      var row = { file_name: file.name, row_count: items.length, items: items, uploaded_by: me(), target_date: date };
      var r = await c.from(T).insert([row]).select();
      if (r.error && /target_date/i.test(String(r.error.message))) {
        // 23d(입고 날짜) 설정 전이면 날짜 없이 올림 → 화면에서는 '올린 날 다음날'로 똑같이 표시됨
        delete row.target_date;
        r = await c.from(T).insert([row]).select();
      }
      if (r.error) throw r.error;
      var okMsg = "✅ Songdo Prenote를 " + (replaced ? "새 파일로 바꿨어요" : "올렸어요") + " · " + fmtDay(date) + " 입고 · " + items.length + "개 아티클";
      toast(okMsg, "success"); setUpMsg("ok", okMsg);
      state.selDate = date; state.cur = null; await load();
    } catch (e) {
      var msg = String((e && e.message) || e);
      setUpMsg("err", "⚠️ 올리기 실패 — " + msg + "  (" + file.name + ")");
      toast(/relation .*freenote_uploads|freenote_uploads.*does not exist|404/i.test(msg) ? "DB 설정(23_프리노트.sql)을 먼저 실행해 주세요." : /row-level security/i.test(msg) ? "올리기 권한이 없어요 (jipar5, junkoo만 가능)." : "올리기 실패: " + msg, "danger");
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
  // 업데이트 표시: 내가 마지막으로 열어본 업로드보다 새 업로드가 있으면 카드에 표시 (기기별 기억)
  function seenKey() { return "fn_seen_" + me().toLowerCase(); }
  function seenId() { try { return Number(localStorage.getItem(seenKey()) || 0); } catch (e) { return 0; } }
  function markSeen() { if (!state.latest) return; try { localStorage.setItem(seenKey(), String(state.latest.id)); } catch (e) {} renderCard(); }
  function hasUpdate() { return !!state.latest && state.latest.id > seenId() && state.latest.by !== me(); }
  function renderCard() {
    var a = ensureCard(); if (!a) return;
    var cur = state.cur, n = cur ? (cur.row_count || (cur.items || []).length) : 0;
    a.classList.toggle("fn-has-upd", hasUpdate());
    a.innerHTML = '<div class="menu-task-icon" style="background:#fef9c3; color:#a16207;"><i class="fa-solid fa-note-sticky"></i></div>' +
      '<div class="menu-task-body"><div class="menu-task-title">Songdo Prenote' + (hasUpdate() ? ' <span class="fn-upd"><i class="fa-solid fa-circle"></i> 업데이트</span>' : '') + '</div>' +
      '<div class="menu-task-sub">' + (cur ? '<b class="fn-day">' + esc(dayIn(cur._date)) + '</b> · ' + esc(cur.uploaded_by || "") + ' 올림' : (isManager() ? 'Fixa 표(CSV/엑셀)를 올려 주세요' : '아직 올라온 목록이 없어요')) + '</div></div>' +
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
    el.querySelector("#fn-body").addEventListener("change", function (e) { if (e.target.id === "fn-dsel") selectDate(e.target.value); });
    el.querySelector("#fn-body").addEventListener("input", function (e) { if (e.target.id === "fn-q") { state.q = e.target.value.trim().toLowerCase(); renderRows(); } });
    el.querySelector("#fn-body").addEventListener("click", function (e) {
      if (e.target.closest("#fn-upload-btn")) { document.getElementById("fn-file").click(); return; }
      var go = e.target.closest(".fn-go"); if (go) { e.stopPropagation(); goStock(go.dataset.art); return; }
      var nv = e.target.closest(".fn-dnav"); if (nv) { var i = state.metas.findIndex(function (m) { return m._date === state.selDate; }) + Number(nv.dataset.nav); if (state.metas[i]) selectDate(state.metas[i]._date); return; }
      if (e.target.closest("#fn-dchange")) { changeDate(); return; }
      if (e.target.closest("#fn-vw-xls")) { exportViews(); return; }
      var sb = e.target.closest(".fn-sort button"); if (sb) { state.sort = sb.dataset.sort; try { localStorage.setItem("fn_sort", state.sort); } catch (e2) {} renderList(); return; }
      var nb = e.target.closest(".fn-newbtn"); if (nb) { e.stopPropagation(); toggleNew(nb.dataset.art); return; }
      var db = e.target.closest(".fn-donebtn"); if (db) { e.stopPropagation(); toggleDone(db.dataset.art); return; }
    });
    document.body.appendChild(el); return el;
  }
  function isOpen() { var el = document.getElementById("fn-sheet"); return !!(el && el.classList.contains("active")); }
  // ---------- 열람 기록 ----------
  var viewers = { id: null, list: null };
  async function markView() {
    var c = client(); if (!c || !state.cur || !state.cur.id) return;
    try { await c.rpc("freenote_mark_view", { p_upload_id: state.cur.id }); } catch (e) {}
    if (isManager()) loadViewers();
  }
  async function loadViewers() {
    var c = client(); if (!c || !state.cur || !state.cur.id || !isManager()) return;
    var id = state.cur.id;
    try { var r = await c.rpc("freenote_viewers", { p_upload_id: id }); viewers = { id: id, list: r.error ? null : (r.data || []), err: r.error ? String(r.error.message) : "" }; }
    catch (e) { viewers = { id: id, list: null, err: String(e) }; }
    renderViewers();
  }
  function staffIds() {
    try { return Object.keys(typeof USER_ID_NAMES !== "undefined" ? USER_ID_NAMES : {}).filter(function (k) { return k !== "test" && k !== "guest1"; }); } catch (e) { return []; }
  }
  function nm(id) { try { var m = typeof USER_ID_NAMES !== "undefined" ? USER_ID_NAMES : {}; return m[String(id).toLowerCase()] || id; } catch (e) { return id; } }
  function renderViewers() {
    var box = document.getElementById("fn-viewers"); if (!box) return;
    if (!isManager() || !state.cur || viewers.id !== state.cur.id) { box.innerHTML = ""; return; }
    if (!viewers.list) { box.innerHTML = '<div class="fn-vw-note">' + (/freenote_viewers|schema cache|404/i.test(viewers.err || "") ? "열람 기록은 DB 설정(23e_프리노트_열람기록.sql)을 실행하면 보여요." : "") + '</div>'; return; }
    var seen = {}; viewers.list.forEach(function (v) { seen[String(v.login_id).toLowerCase()] = v; });
    var up = String(state.cur.uploaded_by || "").toLowerCase();
    var notYet = staffIds().filter(function (k) { return !seen[k] && k !== up; });
    var list = viewers.list.slice().sort(function (a, b) { return new Date(b.last_at) - new Date(a.last_at); });
    box.innerHTML = '<details class="fn-vw"><summary><i class="fa-regular fa-eye"></i> 확인한 사람 <b>' + list.length + '</b>명' + (notYet.length ? ' · 안 본 사람 <b>' + notYet.length + '</b>명' : '') + '<i class="fa-solid fa-chevron-down fn-vw-caret"></i></summary>' +
      '<div class="fn-vw-body"><button type="button" class="fn-vw-xls" id="fn-vw-xls"><i class="fa-solid fa-file-excel"></i> 열람 기록 엑셀 받기 (전체 날짜)</button>' +
        (list.length ? list.map(function (v) {
          return '<div class="fn-vw-row"><span class="fn-vw-name">' + esc(nm(v.login_id)) + '<small>' + esc(v.login_id) + '</small></span><span class="fn-vw-when">' + esc(fmtWhen(v.last_at)) + (v.views > 1 ? ' · ' + v.views + '번' : '') + '</span></div>';
        }).join("") : '<div class="fn-vw-note">아직 열어본 사람이 없어요.</div>') +
        (notYet.length ? '<div class="fn-vw-not"><span>안 본 사람</span>' + notYet.map(function (k) { return '<em>' + esc(nm(k)) + '</em>'; }).join("") + '</div>' : '') +
      '</div></details>';
  }

  // 열람 기록 전체 → 엑셀 (요약 / 열람 기록 / 안 본 사람)
  async function exportViews() {
    if (!isManager()) return;
    if (typeof XLSX === "undefined") { toast("엑셀 도구를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.", "danger"); return; }
    var c = client(); if (!c) return;
    var btn = document.getElementById("fn-vw-xls"); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 만드는 중…'; }
    try {
      var r = await c.rpc("freenote_viewers_all");
      if (r.error) throw r.error;
      var rows = r.data || [];
      var two = function (n) { return String(n).padStart(2, "0"); };
      var dt = function (iso) { if (!iso) return ""; var d = new Date(iso); return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes()); };
      var ups = [], byUp = {};
      rows.forEach(function (x) {
        if (!byUp[x.upload_id]) { byUp[x.upload_id] = { id: x.upload_id, date: String(x.target_date || "").slice(0, 10), by: x.uploaded_by || "", at: x.uploaded_at, file: x.file_name || "", views: [] }; ups.push(byUp[x.upload_id]); }
        if (x.login_id) byUp[x.upload_id].views.push(x);
      });
      var staff = staffIds();
      var sum = [["입고일", "올린 사람", "올린 시간", "파일", "확인한 사람", "안 본 사람", "확인률"]];
      var log = [["입고일", "이름", "아이디", "처음 연 시간", "마지막 연 시간", "연 횟수"]];
      var miss = [["입고일", "이름", "아이디"]];
      ups.forEach(function (u) {
        var seen = {}; u.views.forEach(function (v) { seen[String(v.login_id).toLowerCase()] = 1; });
        var target = staff.filter(function (k) { return k !== String(u.by).toLowerCase(); });
        var notYet = target.filter(function (k) { return !seen[k]; });
        var seenN = target.length - notYet.length;
        sum.push([u.date, nm(u.by), dt(u.at), u.file, seenN, notYet.length, target.length ? Math.round(seenN / target.length * 100) + "%" : ""]);
        u.views.forEach(function (v) { log.push([u.date, nm(v.login_id), v.login_id, dt(v.first_at), dt(v.last_at), v.views]); });
        notYet.forEach(function (k) { miss.push([u.date, nm(k), k]); });
      });
      var wb = XLSX.utils.book_new();
      [["요약", sum, [12, 10, 17, 30, 11, 11, 9]], ["열람 기록", log, [12, 10, 12, 17, 17, 9]], ["안 본 사람", miss, [12, 10, 12]]].forEach(function (sh) {
        var ws = XLSX.utils.aoa_to_sheet(sh[1]); ws["!cols"] = sh[2].map(function (w) { return { wch: w }; });
        XLSX.utils.book_append_sheet(wb, ws, sh[0]);
      });
      var d = new Date();
      XLSX.writeFile(wb, "Songdo_Prenote_열람기록_" + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + ".xlsx");
      toast("열람 기록 엑셀을 받았어요 · 목록 " + ups.length + "개", "success");
    } catch (e) {
      var msg = String((e && e.message) || e);
      toast(/freenote_viewers_all|schema cache|404/i.test(msg) ? "DB 설정(23f_프리노트_열람기록_전체.sql)을 먼저 실행해 주세요." : "엑셀 만들기 실패: " + msg, "danger");
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-excel"></i> 열람 기록 엑셀 받기 (전체 날짜)'; }
    }
  }

  function openList() {
    ensureSheet().classList.add("active"); document.body.classList.add("tb-sheet-open"); state.q = "";
    setTimeout(markView, 300);
    if (hasUpdate() && state.latest.date !== state.selDate) { var d = state.latest.date; markSeen(); selectDate(d); return; }   // 새로 올라온 날짜로 바로 이동
    markSeen(); renderList(); if (!state.loaded) load();
  }
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
    document.getElementById("fn-step").innerHTML = '<i class="fa-solid fa-note-sticky"></i> Songdo Prenote';
    var idx = state.metas.findIndex(function (m) { return m._date === state.selDate; });
    var dateBar = cur ? '<div class="fn-datebar"><span class="fn-dlabel"><i class="fa-regular fa-calendar"></i> ' + esc(dayIn(cur._date)) + '</span></div>' : '';
    var tools = (isManager() ? '<button type="button" class="fn-upload" id="fn-upload-btn"><i class="fa-solid fa-file-arrow-up"></i> ' + (cur ? '새 파일' : '파일 올리기') + '</button>' : '');
    var head = cur
      ? '<div class="fn-progress"><b>' + doneN + ' / ' + items.length + '</b> 완료<div class="fn-bar"><i style="width:' + (items.length ? Math.round(doneN / items.length * 100) : 0) + '%"></i></div></div>'
      : '<div class="fn-progress empty">아직 올라온 목록이 없어요.' + (isManager() ? '<small>Fixa 보고서 표 ⋮ → 데이터 내보내기(CSV 또는 엑셀) 파일을 올려 주세요.</small>' : '') + '</div>';
    var search = items.length ? '<div class="fn-tools"><div class="perm-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" id="fn-q" placeholder="품명 또는 아티클 번호 검색" value="' + esc(state.q) + '"></div>' + tools + '</div>' : (tools ? '<div class="fn-tools">' + tools + '</div>' : '');
    var sortBar = items.length ? '<div class="fn-sort"><span>정렬</span>' +
      [["qty", "수량순"], ["hfb", "HFB순"]].map(function (o) { return '<button type="button" data-sort="' + o[0] + '" class="' + (state.sort === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join("") + '</div>' : '';
    var upBox = isManager() ? '<div id="fn-upmsg" class="fn-upmsg ' + (state.upMsg ? state.upMsg.type : '') + '"' + (state.upMsg ? '' : ' style="display:none"') + '>' + (state.upMsg ? esc(state.upMsg.text) : '') + '</div>' : '';
    body.innerHTML = upBox + dateBar + head + (isManager() && cur ? '<div id="fn-viewers"></div>' : '') + search + sortBar + '<div id="fn-rows" class="fn-list"></div>' + (cur ? '<div class="fn-foot">' + esc(cur.uploaded_by || "") + ' · ' + esc(cur.file_name || "") + (isManager() ? '<br>[완료]로 완료 표시 · 새입고 버튼으로 새 제품 표시 · 🔍 재고 조회' : '<br>[완료]로 완료 표시 · 🔍 누르면 재고 조회') + '</div>' : '');
    renderRows(); renderViewers();
    if (keepScroll) scroller.scrollTop = top;
  }
  function canDone() { try { return !(typeof isViewerUser !== "undefined" && isViewerUser); } catch (e) { return true; } }
  function doneLine(art, done) {
    if (done) {
      var mine = String(done.by).toLowerCase() === me().toLowerCase(), canUndo = isManager() || mine;
      return '<div class="fn-doneline"><span class="fn-doneby"><i class="fa-solid fa-circle-check"></i> <b>' + esc(nmOf(done.by)) + '</b> 완료' + (done.at ? ' · ' + esc(fmtWhen(done.at)) : '') + '</span>' +
        (canUndo ? '<button type="button" class="fn-donebtn undo" data-art="' + esc(art) + '">취소</button>' : '') + '</div>';
    }
    return canDone() ? '<div class="fn-doneline"><button type="button" class="fn-donebtn" data-art="' + esc(art) + '"><i class="fa-solid fa-check"></i> 완료</button></div>' : '';
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
    // 정렬: 수량순(많은 순) / HFB순(번호 작은 순 → 같은 HFB 안에서는 수량 많은 순, HFB 없는 건 맨 아래)
    var hfbNum = function (x) { var c = catalog(x.art), h = c && c.hfb != null ? parseInt(String(c.hfb).replace(/\D/g, ""), 10) : NaN; return isNaN(h) ? 999 : h; };
    list = list.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) {
      var qa = Number(a.x.pieces) || 0, qb = Number(b.x.pieces) || 0;
      if (state.sort === "hfb") { var d = hfbNum(a.x) - hfbNum(b.x); if (d) return d; }
      return (qb - qa) || (a.i - b.i);
    }).map(function (o) { return o.x; });
    box.innerHTML = list.map(function (x) {
      var c = catalog(x.art), nm = splitName(c && (c.artName || c.artname), x.item), st = stockOf(x.art), loc = (c && c.location) || "", hfb = hfbLabel(c);
      var done = state.done[x.art], isNew = state.isNew[x.art];
      var img = x.image ? '<img src="' + esc(x.image) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
      return '<div class="fn-item view' + (done ? ' done' : '') + '" data-art="' + esc(x.art) + '">' +
        '<div class="fn-thumb"><i class="fa-solid fa-couch"></i>' + img + (done ? '<span class="fn-check"><i class="fa-solid fa-check"></i></span>' : '') + '</div>' +
        '<div class="fn-info"><div class="fn-title">' + (isNew ? '<span class="fn-new">새입고</span>' : '') + esc(nm.title) + '</div>' +
          (nm.desc ? '<div class="fn-desc">' + esc(nm.desc) + '</div>' : '') +
          '<div class="fn-chips"><span class="fn-art">' + esc(fmtArt(x.art)) + '</span>' + (hfb ? '<span class="fn-loc">' + esc(hfb) + '</span>' : '') + '</div>' +
          doneLine(x.art, done) + '</div>' +
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
      try { client().channel("public:freenote_uploads").on("postgres_changes", { event: "*", schema: "public", table: T }, function () { load(); }).subscribe(); } catch (e) {}
      try { client().channel("public:freenote_new").on("postgres_changes", { event: "*", schema: "public", table: "freenote_new" }, function () { loadNew().then(function () { if (isOpen()) renderList(true); }); }).subscribe(); } catch (e) {}
      try { client().channel("public:freenote_done").on("postgres_changes", { event: "*", schema: "public", table: "freenote_done" }, function () { loadDone().then(function () { renderList(true); renderCard(); }); }).subscribe(); } catch (e) {}
      setInterval(function () { if (!document.hidden) load(); }, 300000);
    } else if (tries > 120) clearInterval(boot);
  }, 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && state.loaded) renderCard(); });

  window.FreeNote = { open: openList, close: closeList, reload: load, parseRows: parseRows };
})();
