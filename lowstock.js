// lowstock.js — 판매 TOP 제품 재고 부족 알림
// · 판매 순위표(서버 sales_rank, 없으면 sales_rank.json) 제품 중 창고 재고가 기준 개수 이하인 제품을 오늘 할일에 표시
// · 오더 요청은 서버가 자동으로 만듦 (출고 기록 시 확인 · 20_재고부족_자동오더.sql) → 여기서는 상태만 보여줌
// · 기준 개수는 jipar5/junkoo 가 목록 창에서 바꿈 (바꾸면 서버가 바로 전체 다시 확인)
(function () {
  "use strict";

  var MANAGERS = ["jipar5", "junkoo"];
  var OPEN_ST = ["요청됨", "요청", "보류", "대기", "출고대기", "승인", "수락"];
  var state = { rank: null, mpq: {}, threshold: 5, items: [], sig: "" };

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function me() { try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || "").trim(); } catch (e) { return ""; } }
  function isManager() { return MANAGERS.indexOf(me().toLowerCase()) !== -1; }
  function client() { try { return typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { return null; } }
  function toast(m, t) { if (typeof showToast === "function") showToast(m, t || "info"); }
  function normNo(v) { return String(v || "").replace(/\D/g, ""); }
  function pad8(v) { var d = normNo(v); return d && d.length <= 8 ? d.padStart(8, "0") : d; }
  function zl(z) { return typeof window.zoneLabel === "function" ? window.zoneLabel(z) : z; }
  function thumb(artNo, name, size) {
    return typeof getProductThumbHtml === "function" ? getProductThumbHtml(pad8(artNo), name || "", size)
      : '<div class="tb-thumb-ph" style="width:' + size + 'px;height:' + size + 'px"><i class="fa-solid fa-box"></i></div>';
  }
  function loadThumbs() { if (typeof loadProductThumbnails === "function") { try { loadProductThumbnails(); } catch (e) {} } }
  function fmtDate(o) { var d = o.created_at ? new Date(o.created_at) : null; return d ? (d.getMonth() + 1) + "/" + d.getDate() : (o.date || ""); }

  // ---------- 데이터 ----------
  async function loadRank() {
    var c = client();
    try {
      if (c) {
        var r = await c.from("sales_rank").select("artno,rank,mpq").order("rank").limit(1000);
        if (!r.error && r.data && r.data.length) {
          state.rank = {}; state.mpq = {};
          r.data.forEach(function (x) { state.rank[pad8(x.artno)] = x.rank; if (x.mpq) state.mpq[pad8(x.artno)] = x.mpq; });
          return;
        }
      }
    } catch (e) {}
    try { var j = await (await fetch("sales_rank.json?v=" + Date.now())).json(); state.rank = {}; Object.keys(j).forEach(function (k) { state.rank[pad8(k)] = j[k]; }); } catch (e) { state.rank = state.rank || {}; }
  }
  async function loadThreshold() {
    var c = client(); if (!c) return;
    try {
      var r = await c.from("app_settings").select("value").eq("key", "low_stock_threshold").maybeSingle();
      if (!r.error && r.data && r.data.value !== "" && !isNaN(Number(r.data.value))) state.threshold = Number(r.data.value);
    } catch (e) {}
  }
  function stockMap() { try { return typeof buildStockMap === "function" ? buildStockMap() : new Map(); } catch (e) { return new Map(); } }
  function catalogLoc(k) {
    var cat = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
    var m = cat.find(function (x) { return pad8(x.artNo || x.artno) === k; });
    return (m && m.location) || "미지정";
  }
  function openOrderOf(k) {
    var l = (typeof orderLogs !== "undefined" && Array.isArray(orderLogs)) ? orderLogs : [];
    return l.find(function (o) { return pad8(o.artNo || o.artno) === k && OPEN_ST.indexOf(o.status) !== -1; }) || null;
  }
  function compute() {
    if (!state.rank) return [];
    var sm = stockMap(), byKey = {};
    sm.forEach(function (v, key) { var k = pad8(key); var e = byKey[k] || (byKey[k] = { stock: 0, inQty: 0, name: v.artName || "" }); e.stock += Number(v.currentStock) || 0; e.inQty += Number(v.totalIn) || 0; if (!e.name && v.artName) e.name = v.artName; });
    var out = [];
    Object.keys(state.rank).forEach(function (k) {
      var e = byKey[k];
      if (!e || !(e.inQty > 0)) return;          // 창고에 입고된 적 없는 제품은 제외
      if (e.stock <= state.threshold) out.push({ artNo: k, rank: state.rank[k], stock: e.stock, name: e.name, loc: catalogLoc(k), order: openOrderOf(k) });
    });
    return out.sort(function (a, b) { return a.rank - b.rank; });
  }

  // ---------- 오늘 할일 카드 ----------
  function ensureBox() {
    var b = document.getElementById("menu-low-stock"); if (b) return b;
    var anchor = document.getElementById("menu-urgent-check") || document.getElementById("menu-item-storecheck");
    if (!anchor || !anchor.parentNode) return null;
    b = document.createElement("div"); b.id = "menu-low-stock";
    anchor.parentNode.insertBefore(b, anchor.nextSibling);
    return b;
  }
  function refresh(force) {
    var items = compute();
    var sig = state.threshold + "|" + items.map(function (x) { return x.artNo + ":" + x.stock + ":" + (x.order ? x.order.status : ""); }).join(",");
    if (!force && sig === state.sig) return;
    state.sig = sig; state.items = items;
    renderCard();
    if (isListOpen()) renderList();
  }
  function renderCard() {
    var box = ensureBox(); if (!box) return;
    var n = state.items.length;
    if (!n) { box.style.display = "none"; box.innerHTML = ""; return; }
    var ordered = state.items.filter(function (x) { return x.order; }).length, out = state.items.filter(function (x) { return x.stock <= 0; }).length;
    box.style.display = "";
    box.innerHTML = '<a class="menu-task ls-task" onclick="LowStock.openList()">' +
      '<div class="menu-task-icon ls-icon"><i class="fa-solid fa-arrow-trend-down"></i></div>' +
      '<div class="menu-task-body"><div class="menu-task-title">재고 부족 <span class="menu-task-desc ls-desc">판매 TOP</span> <span class="ls-count">' + n + '개</span></div>' +
      '<div class="menu-task-sub">창고 ' + state.threshold + '개 이하' + (out ? ' · 품절 ' + out + '개' : '') + ' · 오더 요청 ' + ordered + '/' + n + '</div></div>' +
      '<i class="fa-solid fa-chevron-right menu-task-arrow"></i></a>';
  }

  // ---------- 목록 창 ----------
  function ensureList() {
    var el = document.getElementById("ls-sheet"); if (el) return el;
    el = document.createElement("div"); el.id = "ls-sheet"; el.className = "tb-sheet-backdrop";
    el.innerHTML = '<div class="tb-sheet ls-sheet" role="dialog" aria-modal="true">' +
      '<div class="tb-sheet-top"><span class="tb-sheet-step ls-step" id="ls-step"></span><button type="button" class="tb-sheet-close" onclick="LowStock.closeList()" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="tb-sheet-scroll" id="ls-body"></div></div>';
    el.addEventListener("click", function (e) { if (e.target === el) closeList(); });
    document.body.appendChild(el); return el;
  }
  function isListOpen() { var el = document.getElementById("ls-sheet"); return !!(el && el.classList.contains("active")); }
  function openList() { ensureList().classList.add("active"); document.body.classList.add("tb-sheet-open"); renderList(); }
  function closeList() { var el = document.getElementById("ls-sheet"); if (el) el.classList.remove("active"); document.body.classList.remove("tb-sheet-open"); }
  function renderList() {
    var body = document.getElementById("ls-body"); if (!body) return;
    document.getElementById("ls-step").innerHTML = '<i class="fa-solid fa-arrow-trend-down"></i> 재고 부족 · 판매 TOP · ' + state.items.length + '개';
    var setBox = isManager()
      ? '<div class="ls-set"><span>창고 재고</span><input type="number" id="ls-th" min="0" max="999" inputmode="numeric" value="' + state.threshold + '"><span>개 이하면 알림</span><button type="button" id="ls-th-save" onclick="LowStock.saveThreshold()">저장</button></div>'
      : '<div class="ls-set ro">창고 재고 <b>' + state.threshold + '개 이하</b>인 판매 TOP 제품이에요.</div>';
    var help = '<div class="ls-help"><i class="fa-solid fa-robot"></i> 기준 이하로 떨어지면 <b>오더 요청이 자동으로 등록</b>돼요 (이미 처리 안 된 요청이 있으면 다시 안 만들어요).</div>';
    var rows = state.items.map(function (x) {
      var o = x.order;
      var chip = o ? '<span class="ls-chip ok"><i class="fa-solid fa-check"></i> 오더 ' + esc(o.status) + ' · ' + esc(o.qty) + '개 · ' + esc(fmtDate(o)) + (String(o.user || "").indexOf("자동") === 0 ? ' (자동)' : '') + '</span>'
                   : '<span class="ls-chip wait"><i class="fa-regular fa-clock"></i> 오더 요청 대기</span>';
      return '<div class="ls-item">' +
        '<div class="ls-rank' + (x.rank <= 10 ? " top" : "") + '">' + x.rank + '<small>위</small></div>' +
        '<div class="uc-thumb">' + thumb(x.artNo, x.name, 40) + '</div>' +
        '<div class="uc-info"><div class="uc-name">' + esc(x.name || "(품명 없음)") + '</div>' +
        '<div class="uc-meta"><span class="uc-no">' + esc(x.artNo) + '</span><span class="uc-loc"><i class="fa-solid fa-location-dot"></i> ' + esc(zl(x.loc)) + '</span></div>' + chip + '</div>' +
        '<div class="ls-stock' + (x.stock <= 0 ? " zero" : "") + '"><b>' + x.stock + '</b><small>' + (x.stock <= 0 ? "품절" : "개") + '</small></div></div>';
    }).join("");
    body.innerHTML = setBox + help + (rows ? '<div class="ls-list">' + rows + '</div>' : '<div class="uc-empty"><i class="fa-solid fa-circle-check"></i> 부족한 판매 TOP 제품이 없어요</div>');
    loadThumbs();
  }
  async function saveThreshold() {
    if (!isManager()) return;
    var inp = document.getElementById("ls-th"), v = parseInt(inp && inp.value, 10);
    if (isNaN(v) || v < 0 || v > 999) { toast("0~999 사이 숫자로 입력해 주세요.", "warning"); return; }
    var c = client(); if (!c) return;
    var btn = document.getElementById("ls-th-save"); if (btn) { btn.disabled = true; btn.textContent = "저장 중…"; }
    try {
      var r = await c.rpc("set_low_stock_threshold", { p_value: v });
      if (r.error) throw r.error;
      state.threshold = v;
      var made = Number(r.data) || 0;
      toast("기준을 " + v + "개로 바꿨어요." + (made ? " 오더 요청 " + made + "건을 새로 만들었어요." : ""), "success");
      try { if (typeof window.refreshAppRealtime === "function") await window.refreshAppRealtime(); } catch (e) {}
      refresh(true);
    } catch (e) {
      var msg = String((e && e.message) || e);
      toast(/set_low_stock_threshold|schema cache|404/i.test(msg) ? "DB 설정(20_재고부족_자동오더.sql)을 먼저 실행해 주세요." : "저장 실패: " + msg, "danger");
      renderList();
    }
  }

  // ---------- 시작 ----------
  var tries = 0, boot = setInterval(async function () {
    tries++;
    if (client() && me()) {
      clearInterval(boot);
      await Promise.all([loadRank(), loadThreshold()]);
      refresh(true);
      try {
        client().channel("public:app_settings_ls").on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, async function () { await loadThreshold(); refresh(true); }).subscribe();
      } catch (e) {}
      setInterval(function () { if (!document.hidden) refresh(false); }, 5000);         // 입출고·오더 변화 반영 (화면 데이터만 비교라 가벼움)
      setInterval(function () { if (!document.hidden) loadThreshold().then(function () { refresh(false); }); }, 120000);
    } else if (tries > 120) clearInterval(boot);
  }, 1000);

  window.LowStock = { openList: openList, closeList: closeList, saveThreshold: saveThreshold, refresh: refresh };
})();
