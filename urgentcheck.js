// urgentcheck.js — 긴급 재고 체크
// · jipar5만: 재고 조회 카드의 [재고 체크] 버튼으로 요청 / 다시 누르면 요청 취소
// · 오늘 할일(매장 재고 체크 아래)에 "긴급 재고 체크" 목록으로 표시 → 직원 누구나 세어서 입력
// · 전산과 다르면 보정 입고/출고를 기록해 재고를 자동으로 맞춤 (Cycle Counting과 같은 방식)
(function () {
  "use strict";

  var T = "urgent_checks", ADMIN = "jipar5";
  var state = { list: [], doneToday: [], loaded: false, sheet: null, busy: {} };

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function me() { try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || "").trim(); } catch (e) { return ""; } }
  function isAdmin() { return me().toLowerCase() === ADMIN; }
  function isViewer() { try { return typeof isViewerUser !== "undefined" && isViewerUser; } catch (e) { return false; } }
  function client() { try { return typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { return null; } }
  function toast(msg, type) { if (typeof showToast === "function") showToast(msg, type || "success"); }
  function normNo(v) { return String(v || "").replace(/\D/g, ""); }
  function pad8(v) { var d = normNo(v); return d && d.length <= 8 ? d.padStart(8, "0") : d; }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function today() { return typeof window.getTodayDateString === "function" ? window.getTodayDateString() : ymd(new Date()); }
  function fmtTime(iso) { if (!iso) return ""; var d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function zl(z) { return typeof window.zoneLabel === "function" ? window.zoneLabel(z) : z; }
  function thumb(artNo, name, size) {
    return typeof getProductThumbHtml === "function" ? getProductThumbHtml(pad8(artNo), name || "", size)
      : '<div class="tb-thumb-ph" style="width:' + size + 'px;height:' + size + 'px"><i class="fa-solid fa-box"></i></div>';
  }
  function loadThumbs() { if (typeof loadProductThumbnails === "function") { try { loadProductThumbnails(); } catch (e) {} } }
  function stockEntry(artNo) {
    var k = pad8(artNo), m; try { m = typeof buildStockMap === "function" ? buildStockMap() : new Map(); } catch (e) { m = new Map(); }
    var e = m.get(k); if (!e) m.forEach(function (v, key) { if (!e && pad8(key) === k) e = v; });
    return e || null;
  }
  function currentStock(artNo) { var e = stockEntry(artNo); return e ? (Number(e.currentStock) || 0) : 0; }
  function catalogItem(artNo) {
    var k = pad8(artNo), cat = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
    return cat.find(function (x) { return pad8(x.artNo || x.artno) === k; }) || null;
  }
  function currentLocation(artNo) { var m = catalogItem(artNo); return (m && m.location) || "미지정"; }
  function artName(artNo) { var e = stockEntry(artNo), m = catalogItem(artNo); return (e && e.artName) || (m && (m.artName || m.artname)) || ""; }
  function pendingOf(artNo) { var k = pad8(artNo); return state.list.find(function (r) { return pad8(r.artno) === k; }) || null; }

  // ---------- 불러오기 ----------
  async function load() {
    var c = client(); if (!c || !me()) return;
    try {
      var since = new Date(); since.setHours(0, 0, 0, 0);
      var r1 = await c.from(T).select("*").eq("status", "pending").order("created_at", { ascending: true }).limit(200);
      var r2 = await c.from(T).select("*").eq("status", "done").gte("checked_at", since.toISOString()).order("checked_at", { ascending: false }).limit(50);
      if (r1.error) throw r1.error;
      state.list = r1.data || []; state.doneToday = (r2 && r2.data) || []; state.loaded = true;
    } catch (e) { console.warn("urgent check load", e); }
    renderMenu(); decorateStockCards();
  }

  // ---------- 오늘 할일 카드 ----------
  function ensureMenuBox() {
    var box = document.getElementById("menu-urgent-check");
    if (box) return box;
    var anchor = document.getElementById("menu-item-storecheck");
    if (!anchor || !anchor.parentNode) return null;
    box = document.createElement("div");
    box.id = "menu-urgent-check"; box.className = "uc-box";
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    return box;
  }
  function renderMenu() {
    var box = ensureMenuBox(); if (!box) return;
    var n = state.list.length, d = state.doneToday.length;
    if (!n && !(isAdmin() && d)) { box.style.display = "none"; box.innerHTML = ""; closeList(); return; }
    box.style.display = "";
    box.innerHTML = '<a class="menu-task uc-task" onclick="UrgentCheck.openList()">' +
      '<div class="menu-task-icon uc-icon"><i class="fa-solid fa-bolt"></i></div>' +
      '<div class="menu-task-body"><div class="menu-task-title">긴급 재고 체크 ' +
        (n ? '<span class="uc-count">' + n + '개</span>' : '<span class="uc-count done">완료</span>') + '</div>' +
      '<div class="menu-task-sub">' + (n ? '먼저 세어 주세요 · 입력하면 재고 자동 수정' : '오늘 긴급 체크 ' + d + '건 모두 완료') + '</div></div>' +
      '<i class="fa-solid fa-chevron-right menu-task-arrow"></i></a>';
    if (document.getElementById("uc-list-sheet") && document.getElementById("uc-list-sheet").classList.contains("active")) renderList();
  }

  // ---------- 목록 창 (카드 누르면) ----------
  function ensureListSheet() {
    var el = document.getElementById("uc-list-sheet");
    if (el) return el;
    el = document.createElement("div");
    el.id = "uc-list-sheet"; el.className = "tb-sheet-backdrop";
    el.innerHTML = '<div class="tb-sheet uc-sheet" role="dialog" aria-modal="true">' +
      '<div class="tb-sheet-top"><span class="tb-sheet-step uc-step" id="uc-list-step"></span><button type="button" class="tb-sheet-close" onclick="UrgentCheck.closeList()" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="tb-sheet-scroll" id="uc-list-body"></div></div>';
    el.addEventListener("click", function (e) { if (e.target === el) closeList(); });
    document.body.appendChild(el);
    return el;
  }
  function openList() { ensureListSheet().classList.add("active"); document.body.classList.add("tb-sheet-open"); renderList(); }
  function closeList() {
    var el = document.getElementById("uc-list-sheet"); if (!el || !el.classList.contains("active")) return;
    el.classList.remove("active"); if (!state.sheet) document.body.classList.remove("tb-sheet-open");
  }
  function renderList() {
    var body = document.getElementById("uc-list-body"); if (!body) return;
    var n = state.list.length, d = state.doneToday.length;
    document.getElementById("uc-list-step").innerHTML = '<i class="fa-solid fa-bolt"></i> 긴급 재고 체크 · ' + n + '개';
    var rows = state.list.map(function (r) {
      return '<button type="button" class="uc-item" onclick="UrgentCheck.open(' + r.id + ')">' +
        '<div class="uc-thumb">' + thumb(r.artno, r.artname, 40) + '</div>' +
        '<div class="uc-info"><div class="uc-name">' + esc(r.artname || artName(r.artno) || "(품명 없음)") + '</div>' +
        '<div class="uc-meta"><span class="uc-no">' + esc(pad8(r.artno)) + '</span><span class="uc-loc"><i class="fa-solid fa-location-dot"></i> ' + esc(zl(currentLocation(r.artno))) + '</span>' +
        '<span>전산 ' + currentStock(r.artno) + '개</span></div></div>' +
        '<span class="uc-go">체크하기 <i class="fa-solid fa-chevron-right"></i></span></button>';
    }).join("");
    var done = "";
    if (isAdmin() && d) {
      done = '<div class="uc-done"><div class="uc-done-title">오늘 완료 ' + d + '건</div>' + state.doneToday.map(function (r) {
        var diff = Number(r.discrepancy) || 0;
        return '<div class="uc-done-row"><span class="uc-no">' + esc(pad8(r.artno)) + '</span><span class="uc-dname">' + esc(r.artname || "") + '</span>' +
          '<span class="uc-res ' + (diff ? "bad" : "ok") + '">' + r.system_stock + '→' + r.actual_stock + (diff ? ' (' + (diff > 0 ? "+" : "") + diff + ')' : ' 일치') + '</span>' +
          '<span class="uc-who">' + esc(r.checked_by || "") + ' ' + fmtTime(r.checked_at) + '</span></div>';
      }).join("") + '</div>';
    }
    body.innerHTML = (rows ? '<div class="uc-list">' + rows + '</div>' : '<div class="uc-empty"><i class="fa-solid fa-circle-check"></i> 남은 긴급 재고 체크가 없어요</div>') + done;
    loadThumbs();
  }

  // ---------- 재고 조회 카드: [재고 체크] 버튼 (jipar5만) ----------
  function decorateStockCards() {
    var cont = document.getElementById("stock-cards-container");
    if (!cont) return;
    var admin = isAdmin();
    cont.querySelectorAll(".stock-card-item[data-artno]").forEach(function (card) {
      var btn = card.querySelector(".uc-req-btn");
      if (!admin) { if (btn) btn.remove(); return; }
      var art = card.getAttribute("data-artno");
      if (!btn) {
        var zoneBtn = Array.prototype.find.call(card.querySelectorAll("button"), function (b) { return /구역\s*변경/.test(b.textContent); });
        btn = document.createElement("button");
        btn.type = "button"; btn.className = "uc-req-btn";
        btn.addEventListener("click", function (e) { e.stopPropagation(); toggleRequest(art); });
        if (zoneBtn && zoneBtn.parentNode) zoneBtn.parentNode.insertBefore(btn, zoneBtn.nextSibling);
        else { var q = card.querySelector(".ssc-quick-btns"); if (q) q.parentNode.insertBefore(btn, q); else return; }
      }
      var on = !!pendingOf(art);
      btn.classList.toggle("on", on);
      btn.innerHTML = on ? '<i class="fa-solid fa-bolt"></i> 체크 요청됨' : '<i class="fa-solid fa-bolt"></i> 재고 체크';
      btn.title = on ? "다시 누르면 요청을 취소해요" : "오늘 할일에 긴급 재고 체크로 올려요";
    });
  }

  async function toggleRequest(art) {
    if (!isAdmin()) return;
    var k = pad8(art); if (state.busy[k]) return;
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }
    var p = pendingOf(k), name = artName(k);
    state.busy[k] = true;
    try {
      if (p) {
        if (!confirm("[" + (name || k) + "]\n긴급 재고 체크 요청을 취소할까요?")) return;
        var d = await c.from(T).delete().eq("id", p.id);
        if (d.error) throw d.error;
        state.list = state.list.filter(function (r) { return r.id !== p.id; });
        toast("[" + k + "] 긴급 체크 요청을 취소했어요.", "info");
      } else {
        var row = { artno: k, artname: name || null, location: currentLocation(k), requested_by: me() };
        var r = await c.from(T).insert([row]).select();
        if (r.error) {
          if (/duplicate|unique/i.test(String(r.error.message))) { toast("이미 요청된 아티클이에요.", "info"); await load(); return; }
          throw r.error;
        }
        if (r.data && r.data[0]) state.list.push(r.data[0]);
        toast("⚡ [" + k + "] 긴급 재고 체크를 요청했어요. 오늘 할일에 표시돼요.", "success");
      }
      renderMenu(); decorateStockCards();
    } catch (e) {
      toast("요청 실패: " + ((e && e.message) || e), "danger");
    } finally { state.busy[k] = false; }
  }

  // ---------- 체크 입력 창 ----------
  function ensureSheet() {
    var el = document.getElementById("uc-sheet");
    if (el) return el;
    el = document.createElement("div");
    el.id = "uc-sheet"; el.className = "tb-sheet-backdrop";
    el.innerHTML = '<div class="tb-sheet cc-sheet uc-sheet" role="dialog" aria-modal="true">' +
      '<div class="tb-sheet-top"><span class="tb-sheet-step uc-step"><i class="fa-solid fa-bolt"></i> 긴급 재고 체크</span><button type="button" class="tb-sheet-close" onclick="UrgentCheck.close()" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="tb-sheet-scroll" id="uc-sheet-body"></div><div class="tb-sheet-footer" id="uc-sheet-footer"></div></div>';
    el.addEventListener("click", function (e) { if (e.target === el) close(); });
    document.body.appendChild(el);
    return el;
  }
  function close() {
    var el = document.getElementById("uc-sheet"); if (el) el.classList.remove("active");
    state.sheet = null;
    var ls = document.getElementById("uc-list-sheet");
    if (!(ls && ls.classList.contains("active"))) document.body.classList.remove("tb-sheet-open");
  }
  function open(id) {
    if (isViewer()) { toast("읽기 전용 계정은 입력할 수 없습니다.", "warning"); return; }
    var r = state.list.find(function (x) { return x.id === id; });
    if (!r) { toast("이미 완료된 항목이에요.", "info"); load(); return; }
    var sys = currentStock(r.artno);
    state.sheet = { id: r.id, artNo: pad8(r.artno), artName: r.artname || artName(r.artno), location: currentLocation(r.artno), system: sys, actual: sys, requestedBy: r.requested_by, createdAt: r.created_at };
    ensureSheet().classList.add("active");
    document.body.classList.add("tb-sheet-open");
    renderSheet();
  }
  function diffText(diff) {
    return diff === 0 ? '<i class="fa-solid fa-check"></i> 전산과 일치 (차이 0개)'
      : '<i class="fa-solid fa-triangle-exclamation"></i> 차이 ' + (diff > 0 ? "+" : "") + diff + '개 → 저장하면 재고가 ' + Math.abs(diff) + '개 ' + (diff > 0 ? "늘어나요 (보정 입고)" : "줄어들어요 (보정 출고)");
  }
  function renderSheet() {
    var s = state.sheet; if (!s) return;
    var diff = s.actual - s.system;
    document.getElementById("uc-sheet-body").innerHTML =
      '<div class="tb-sheet-product"><div class="tb-sheet-thumb">' + thumb(s.artNo, s.artName, 96) + '</div><div class="tb-sheet-info">' +
        '<div class="tb-sheet-name">' + esc(s.artName || "(품명 없음)") + '</div><div class="tb-sheet-no">' + esc(s.artNo) + '</div>' +
        '<div class="cc-loc">창고 위치 <b>' + esc(zl(s.location)) + '</b></div>' +
        '<div class="uc-req">' + esc(s.requestedBy || "") + ' 님 요청 · ' + fmtTime(s.createdAt) + '</div></div></div>' +
      '<div class="cc-count">' +
        '<div class="cc-row"><span>전산 재고</span><b>' + s.system + '개</b></div>' +
        '<div class="cc-row cc-actual"><span>실제 센 수량</span><div class="cc-stepper">' +
          '<button type="button" onclick="UrgentCheck.step(-1)" aria-label="빼기">−</button>' +
          '<input type="number" id="uc-actual" inputmode="numeric" min="0" value="' + s.actual + '" oninput="UrgentCheck.setActual(this.value)" onfocus="this.select()">' +
          '<button type="button" onclick="UrgentCheck.step(1)" aria-label="더하기">+</button></div></div>' +
        '<div class="cc-diff ' + (diff === 0 ? "ok" : "bad") + '" id="uc-diff">' + diffText(diff) + '</div>' +
      '</div>';
    renderFooter(); loadThumbs();
  }
  function renderFooter() {
    var s = state.sheet; if (!s) return;
    var diff = s.actual - s.system;
    document.getElementById("uc-sheet-footer").innerHTML = '<button type="button" class="tb-sheet-done' + (diff === 0 ? " cc-ok" : " cc-adj") + '" id="uc-save" onclick="UrgentCheck.save()">' +
      (diff === 0 ? '<i class="fa-solid fa-check-double"></i> 재고 일치 (저장)' : '<i class="fa-solid fa-scale-balanced"></i> ' + s.actual + '개로 재고 수정하고 저장') + '</button>';
    var d = document.getElementById("uc-diff");
    if (d) { d.className = "cc-diff " + (diff === 0 ? "ok" : "bad"); d.innerHTML = diffText(diff); }
  }
  function setActual(v) { var s = state.sheet; if (!s) return; var n = parseInt(v, 10); s.actual = isNaN(n) || n < 0 ? 0 : n; renderFooter(); }
  function step(d) { var s = state.sheet; if (!s) return; s.actual = Math.max(0, s.actual + d); var i = document.getElementById("uc-actual"); if (i) i.value = s.actual; renderFooter(); }

  async function save() {
    var s = state.sheet; if (!s) return;
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }
    s.system = currentStock(s.artNo);           // 그 사이 입출고가 있었을 수 있으니 저장 직전 다시 계산
    var diff = s.actual - s.system;
    if (diff !== 0 && !confirm("[" + (s.artName || s.artNo) + "]\n전산 " + s.system + "개 → 실제 " + s.actual + "개\n\n재고를 " + s.actual + "개로 수정할까요?\n(" + (diff > 0 ? "보정 입고 " : "보정 출고 ") + Math.abs(diff) + "개 기록)")) { renderSheet(); return; }
    var btn = document.getElementById("uc-save"); if (btn) { btn.disabled = true; btn.textContent = "저장 중…"; }
    var now = new Date().toISOString();
    try {
      // 1) 먼저 완료로 표시 (다른 사람이 동시에 저장하면 한 명만 성공)
      var u = await c.from(T).update({ status: "done", system_stock: s.system, actual_stock: s.actual, discrepancy: diff, checked_by: me(), checked_at: now, location: s.location })
        .eq("id", s.id).eq("status", "pending").select();
      if (u.error) throw u.error;
      if (!u.data || !u.data.length) { toast("다른 직원이 방금 먼저 체크했어요.", "info"); close(); await load(); return; }
      // 2) 차이가 있으면 보정 입고/출고 기록 → 재고 자동 수정
      if (diff !== 0) {
        var logRow = { date: today(), type: diff > 0 ? "입고" : "출고", artNo: s.artNo, artName: s.artName || null, qty: Math.abs(diff), user: me() || null };
        var lr = await c.from("inventory_logs").insert([logRow]).select();
        if (lr.error) {
          try { await c.from(T).update({ status: "pending", system_stock: null, actual_stock: null, discrepancy: null, checked_by: me(), checked_at: null }).eq("id", s.id); } catch (e) {}
          throw lr.error;
        }
        if (typeof historyLogs !== "undefined" && Array.isArray(historyLogs)) {
          historyLogs.unshift(Object.assign({}, logRow, { id: lr.data && lr.data[0] && lr.data[0].id, artName: s.artName, created_at: now }));
        }
        if (typeof invalidateStockCache === "function") invalidateStockCache();
      }
      state.list = state.list.filter(function (r) { return r.id !== s.id; });
      if (u.data[0]) state.doneToday.unshift(u.data[0]);
      toast(diff === 0 ? "✅ [" + s.artNo + "] 재고 일치" : "[" + s.artNo + "] 재고를 " + s.actual + "개로 수정했어요.", diff === 0 ? "success" : "info");
      close(); renderMenu(); if (!state.list.length) closeList();
      try { if (typeof renderStockLookup === "function") renderStockLookup(); if (typeof renderHistoryLogs === "function") renderHistoryLogs(); } catch (e) {}
    } catch (err) {
      var msg = String((err && err.message) || err);
      if (/row-level security|JWT|401/i.test(msg)) {
        try { var r = await c.auth.getSession(); if (!r || !r.data || !r.data.session) { if (window.showAuthExpired) window.showAuthExpired(); renderFooter(); return; } } catch (e) {}
      }
      toast("저장 실패: " + msg, "danger");
      renderFooter();
    }
  }

  // ---------- 시작 ----------
  function watchStockList() {
    var cont = document.getElementById("stock-cards-container");
    if (!cont || cont._ucWatch) return;
    cont._ucWatch = true;
    var t = null;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(decorateStockCards, 30); }).observe(cont, { childList: true });
  }
  var tries = 0, boot = setInterval(function () {
    tries++;
    if (client() && me()) {
      clearInterval(boot);
      watchStockList(); load();
      try { client().channel("public:urgent_checks").on("postgres_changes", { event: "*", schema: "public", table: T }, function () { load(); }).subscribe(); } catch (e) {}
      setInterval(function () { if (!document.hidden) load(); }, 60000);   // 실시간 연결이 끊겨도 1분마다 갱신
    } else if (tries > 120) clearInterval(boot);
  }, 1000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && state.loaded) load(); });

  window.UrgentCheck = { openList: openList, closeList: closeList, open: open, close: close, save: save, step: step, setActual: setActual, toggle: toggleRequest, reload: load };
})();
