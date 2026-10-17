// enhance.js — 렌더링/저장 최적화 + 하단 메뉴 보조 (마지막에 로드되어야 함)
// 1) 화면에 보이지 않는 탭(재고 조회, 입출고 내역)은 다시 그리지 않고 "갱신 필요"로만 표시했다가,
//    해당 탭을 열 때 한 번만 그립니다.
// 2) 입출고 기록의 브라우저 캐시 저장(localStorage)을 1.5초 단위로 묶어서 한 번만 저장합니다.
(function () {
  "use strict";

  // ---------- 1) 보이는 탭만 렌더링 ----------
  // 렌더 함수 이름 → 해당 화면이 속한 탭 id
  // (뱃지/카운트를 함께 갱신하는 오더·챙기기 렌더 함수는 건드리지 않습니다)
  var LAZY_RENDERERS = {
    renderStockLookup: "stock",
    renderStockLocationDashboard: "stock",
    renderHistoryLogs: "history"
  };

  var dirty = {};          // fnName -> true (탭이 숨겨져 있어 그리기를 미룬 함수)
  var originals = {};

  function isTabActive(tabId) {
    var el = document.getElementById("tab-" + tabId);
    return !!(el && el.classList.contains("active"));
  }

  function wrapRenderer(name) {
    var orig = window[name];
    if (typeof orig !== "function" || orig.__lazyWrapped) return;
    originals[name] = orig;
    var tabId = LAZY_RENDERERS[name];
    var wrapped = function () {
      if (!isTabActive(tabId)) {
        dirty[name] = true;
        return;
      }
      dirty[name] = false;
      return orig.apply(this, arguments);
    };
    wrapped.__lazyWrapped = true;
    window[name] = wrapped;
  }

  function flushDirtyFor(tabId) {
    Object.keys(LAZY_RENDERERS).forEach(function (name) {
      if (LAZY_RENDERERS[name] === tabId && dirty[name] && originals[name]) {
        dirty[name] = false;
        try { originals[name](); } catch (e) { console.warn("[perf] render error", name, e); }
      }
    });
  }

  function wrapSwitchTab() {
    var orig = window.switchTab;
    if (typeof orig !== "function" || orig.__lazyWrapped) return;
    var wrapped = function (rawTabId) {
      var result = orig.apply(this, arguments);
      var tabId = rawTabId ? String(rawTabId).replace(/^tab-/, "") : "register";
      // switchTab 이 이미 그렸다면 dirty 가 false 로 바뀌어 있으므로 중복 렌더링하지 않음
      flushDirtyFor(tabId);
      highlightBottomNav(tabId);
      return result;
    };
    wrapped.__lazyWrapped = true;
    window.switchTab = wrapped;
  }

  // ---------- 2) 입출고 기록 캐시 저장 묶기 ----------
  var saveTimer = null;
  function flushHistoryCache() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      if (typeof historyLogs !== "undefined") {
        localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
      }
    } catch (e) {}
  }
  window.scheduleHistoryCacheSave = function () {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushHistoryCache, 1500);
  };
  window.addEventListener("pagehide", flushHistoryCache);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && saveTimer) flushHistoryCache();
  });

  // ---------- 3) 하단 메뉴 보조 ----------
  // 메뉴 화면에서 '창고 챙기기'나 '재고 조회'로 들어가도 하단 메뉴의 해당 칸이 켜지도록 함
  function highlightBottomNav(tabId) {
    var btn = document.querySelector('.bottom-nav .nav-item[onclick*="\'' + tabId + '\'"]');
    if (!btn) return; // 하단에 없는 화면은 기존처럼 '메뉴'가 켜짐
    document.querySelectorAll(".bottom-nav .nav-item").forEach(function (b) {
      b.classList.toggle("active", b === btn);
    });
  }

  // 메뉴 안의 '창고 챙기기' 대기 건수 뱃지를 하단 메뉴에도 똑같이 표시
  function mirrorBadge(srcId, dstId) {
    var src = document.getElementById(srcId);
    var dst = document.getElementById(dstId);
    if (!src || !dst) return;
    var sync = function () {
      dst.textContent = src.textContent;
      dst.style.display = src.style.display === "none" ? "none" : "";
    };
    sync();
    new MutationObserver(sync).observe(src, { attributes: true, attributeFilter: ["style"], childList: true, characterData: true, subtree: true });
  }

  // 오더 좋아요 기능 삭제: 휴대폰에 남은 좋아요 데이터 정리
  try { localStorage.removeItem("warehouse_order_likes"); } catch (e) {}

  // ---------- 4) 삭제 권한 안내 ----------
  // DB 보안 설정(RLS)에서 남의 기록 삭제는 관리자만 가능하도록 막혀 있습니다.
  // 막힌 삭제는 오류 없이 "0건 삭제"로 끝나므로, 이를 감지해 안내하고 화면을 서버 기준으로 되돌립니다.
  var GUARDED_TABLES = { inventory_logs: 1, order_requests: 1, store_inbound_logs: 1, stock_audits: 1, master_catalog: 1 };
  var deniedNoticeTimer = null;
  function notifyDeleteDenied() {
    if (deniedNoticeTimer) return; // 여러 건이 한꺼번에 막혀도 안내는 한 번만
    deniedNoticeTimer = setTimeout(async function () {
      deniedNoticeTimer = null;
      // 화면에서 지워진 것처럼 보이는 기록을 서버 기준으로 되돌림 (동기화 완료 알림/소리는 끔)
      if (typeof window.refreshAppRealtime === "function") {
        var origToast = window.showToast, origSound = window.playSuccessFeedback;
        window.showToast = function () {};
        window.playSuccessFeedback = function () {};
        try { await window.refreshAppRealtime(); } catch (e) {}
        window.showToast = origToast;
        window.playSuccessFeedback = origSound;
      }
      if (typeof window.showToast === "function") {
        window.showToast("삭제 권한이 없습니다. 다른 사람의 기록은 관리자만 삭제할 수 있어요.", "danger");
      }
    }, 400);
  }
  function installDeleteGuard() {
    if (typeof supabaseClient === "undefined" || !supabaseClient || supabaseClient.__deleteGuard) return;
    var origFrom = supabaseClient.from.bind(supabaseClient);
    supabaseClient.from = function (table) {
      var qb = origFrom(table);
      if (!GUARDED_TABLES[table] || typeof qb.delete !== "function") return qb;
      var origDelete = qb.delete.bind(qb);
      qb.delete = function () {
        var fb = origDelete.apply(null, arguments);
        if (window.isAdminUser) return fb; // 관리자는 확인 불필요
        // 삭제된 행을 돌려받도록 요청하고, 결과가 0건이면 권한 부족으로 판단
        try { fb.select("id"); } catch (e) { return fb; }
        var origThen = fb.then.bind(fb);
        fb.then = function (onOk, onErr) {
          return origThen(function (res) {
            if (res && !res.error && Array.isArray(res.data) && res.data.length === 0) {
              res.deniedByPolicy = true;
              notifyDeleteDenied();
            }
            return onOk ? onOk(res) : res;
          }, onErr);
        };
        return fb;
      };
      return qb;
    };
    supabaseClient.__deleteGuard = true;
  }

  // ---------- 설치 ----------
  function install() {
    Object.keys(LAZY_RENDERERS).forEach(wrapRenderer);
    wrapSwitchTab();
  }
  install();
  installDeleteGuard();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { mirrorBadge("badge-picklist", "badge-nav-picklist"); });
  } else {
    mirrorBadge("badge-picklist", "badge-nav-picklist");
  }
  // 다른 스크립트가 load 이후에 함수를 다시 덮어쓰는 경우를 대비해 한 번 더 확인
  window.addEventListener("load", function () {
    setTimeout(install, 0);
  });
})();

// ---------- 메뉴 탭 "오늘 할 일" 요약 (2026-10 개편) ----------
// 매장 입고 오늘 건수, Cycle Counting 진행(n/5), 재고 이상(마이너스·위치 미지정)을 메뉴 탭에 표시합니다.
(function () {
  "use strict";

  function todayStr() {
    if (typeof window.getTodayDateString === "function") return window.getTodayDateString();
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function setText(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }

  function renderMenuToday() {
    var today = todayStr();
    var dayNames = ["일", "월", "화", "수", "목", "금", "토"];
    var d = new Date();
    setText("menu-today-date", (d.getMonth() + 1) + "월 " + d.getDate() + "일 (" + dayNames[d.getDay()] + ")");

    // 1) 매장 입고: 오늘 등록된 건수·수량
    try {
      var logs = (typeof storeInboundLogs !== "undefined" && Array.isArray(storeInboundLogs)) ? storeInboundLogs : [];
      var cnt = 0, qty = 0;
      for (var i = 0; i < logs.length; i++) {
        if (String(logs[i].date || "").slice(0, 10) === today) { cnt++; qty += Number(logs[i].qty) || 0; }
      }
      setText("menu-task-store-sub", cnt > 0 ? ("오늘 " + cnt + "건 · " + qty.toLocaleString() + "개 입고됨") : "오늘 입고 기록 없음 · 바코드 스캔");
    } catch (e) {}

    // 2) Cycle Counting 요약은 cyclecount.js가 갱신
    try { if (window.CycleCount) window.CycleCount.updateDashboard(); } catch (e) {}

    // Test Buy 요약은 testbuy.js가 갱신
    try { if (window.TestBuy) window.TestBuy.updateDashboard(); } catch (e) {}

    // 3) 재고 이상: 마이너스 재고 / 재고는 있는데 위치 미지정
    try {
      var neg = 0, noloc = 0;
      if (typeof buildStockMap === "function") {
        buildStockMap().forEach(function (it) {
          var s = Number(it.currentStock) || 0;
          if (s < 0) neg++;
          else if (s > 0) {
            var loc = String(it.location || "").trim();
            if (!loc || loc === "미지정") noloc++;
          }
        });
      }
      var box = document.getElementById("menu-task-alert");
      var bn = document.getElementById("menu-alert-negative");
      var bl = document.getElementById("menu-alert-noloc");
      if (bn) { bn.querySelector("b").textContent = neg; bn.style.display = neg > 0 ? "" : "none"; }
      if (bl) { bl.querySelector("b").textContent = noloc; bl.style.display = noloc > 0 ? "" : "none"; }
      if (box) box.style.display = (neg > 0 || noloc > 0) ? "" : "none";
    } catch (e) {}
  }
  window.renderMenuToday = renderMenuToday;

  // 재고 이상 칩 → 재고 조회 탭을 해당 조건으로 열기
  window.openMenuStockAlert = function (kind) {
    if (kind === "noloc") {
      if (typeof window.filterStockByLocation === "function") window.filterStockByLocation("미지정");
      return;
    }
    window.currentStockLocationFilter = "ALL";
    if (typeof switchTab === "function") switchTab("stock");
    try { currentStockStatusFilter = "negative"; } catch (e) {}
    if (typeof window.renderStockLookup === "function") window.renderStockLookup();
    else if (typeof renderStockLookup === "function") renderStockLookup();
  };

  function menuActive() {
    var t = document.getElementById("tab-menu");
    return !!(t && t.classList.contains("active"));
  }

  function init() {
    var tab = document.getElementById("tab-menu");
    if (!tab) return;
    // 메뉴 탭이 열릴 때마다 갱신
    new MutationObserver(function () { if (menuActive()) renderMenuToday(); })
      .observe(tab, { attributes: true, attributeFilter: ["class"] });
    // 데이터가 도착하면 한 번, 이후 메뉴 탭이 보일 때 30초마다 갱신 (실시간 변경 반영)
    renderMenuToday();
    var tries = 0;
    var boot = setInterval(function () {
      tries++;
      renderMenuToday();
      var loaded = (typeof historyLogs !== "undefined" && historyLogs.length > 0);
      if (loaded || tries > 60) clearInterval(boot);
    }, 1000);
    setInterval(function () { if (menuActive() && !document.hidden) renderMenuToday(); }, 30000);
    // Cycle Counting 창을 닫으면 진행률 즉시 갱신
    var origClose = window.closeCycleCountingModal;
    if (typeof origClose === "function") {
      window.closeCycleCountingModal = function () {
        var r = origClose.apply(this, arguments);
        renderMenuToday();
        return r;
      };
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

// ---------- 개발 중 안내 창 ----------
window.openDevNotice = function (title, desc) {
  var m = document.getElementById("dev-notice-modal");
  if (!m) return;
  var t = document.getElementById("dev-notice-title");
  var d = document.getElementById("dev-notice-desc");
  if (t) t.textContent = (title || "이 기능") + " 은(는) 개발 중입니다";
  if (d) d.textContent = desc || "";
  m.classList.add("active");
};
window.closeDevNotice = function () {
  var m = document.getElementById("dev-notice-modal");
  if (m) m.classList.remove("active");
};

// ===== 송도 MFAQ 현황 (오늘 / 이번 달 누적 · 등록된 / 새로운 / 중복된) + 누가 등록·+1 했는지 =====
// · 새로운 MFAQ: 처음 등록된 질문 수 (mfaq_logs.created_at 기준)
// · 중복된 MFAQ: 이미 있던 질문을 또 받은 횟수 (+1 탭 · 같은 질문 재등록) → mfaq_events 에 기록
// · 등록된 MFAQ: 받은 질문 전체 = 새로운 + 중복된
(function () {
  "use strict";
  var events = [], loaded = false;
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function today() { return typeof window.getTodayDateString === "function" ? window.getTodayDateString() : ymd(new Date()); }
  function me() { try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || "").trim(); } catch (e) { return ""; } }
  function client() { try { return typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { return null; } }
  function logs() {
    try { return (typeof mfaqLogs !== "undefined" && Array.isArray(mfaqLogs) ? mfaqLogs : []).filter(function (l) {
      return l && l.category !== "공지사항" && l.category !== "방문자통계" && !String(l.id).startsWith("notice_") && l.id !== "site_visitor_stats" && l.id !== "cycle_counting_records";
    }); } catch (e) { return []; }
  }
  function createdDay(l) { var c = l.createdAt || l.created_at; if (!c) return ""; var d = new Date(c); return isNaN(d) ? "" : ymd(d); }
  function counts(match) {
    var nw = logs().filter(function (l) { return match(createdDay(l)); }).length;
    var nwEv = events.filter(function (e) { return e.type === "new" && match(String(e.event_date)); }).length;
    var dup = events.filter(function (e) { return e.type === "dup" && match(String(e.event_date)); }).length;
    nw = Math.max(nw, nwEv);
    return { all: nw + dup, nw: nw, dup: dup };
  }

  function render() {
    var box = document.getElementById("mfaq-stats"); if (!box) return;
    var now = new Date(), t = today(), month = t.slice(0, 7), ml = (now.getMonth() + 1) + "월";
    var td = counts(function (d) { return d === t; }), mo = counts(function (d) { return d.slice(0, 7) === month; });
    function tile(n, l, cls) { return '<div class="tb-kpi' + (cls ? " " + cls : "") + '"><b>' + n + '</b><span>' + l + '</span></div>'; }
    function row(c) { return '<div class="tb-kpis">' + tile(c.all, "등록된 MFAQ", "main") + tile(c.nw, "새로운 MFAQ", "ok") + tile(c.dup, "중복된 MFAQ", "fix") + '</div>'; }
    box.innerHTML = '<div class="tb-dash mfaq-dash"><div class="tb-dash-title"><span><i class="fa-solid fa-chart-simple"></i> MFAQ 현황</span><small>' + ml + " " + now.getDate() + '일 기준</small></div>' +
      '<div class="tb-dash-label">오늘</div>' + row(td) + todayWho(t) +
      '<div class="tb-dash-label">' + ml + ' 누적</div>' + row(mo) +
      '<div class="tb-dash-sub">전체 등록된 질문 ' + logs().length + '개</div></div>';
  }

  // 오늘 질문을 등록한 아이디 (새 질문 등록 + 이미 있던 질문 +1 모두 포함, ×횟수)
  function todayWho(t) {
    var cnt = {}, order = [];
    function add(u) { u = String(u || "").trim(); if (!u || u === "-" || u === "system") return; if (!cnt[u]) { cnt[u] = 0; order.push(u); } cnt[u]++; }
    logs().forEach(function (l) { if (createdDay(l) === t) add(l.createdBy); });
    events.forEach(function (e) { if (e.type === "dup" && String(e.event_date) === t) add(e.user); });
    order.sort(function (a, b) { return cnt[b] - cnt[a]; });
    return '<div class="tb-done-today"><span class="tb-done-label"><i class="fa-solid fa-user-pen"></i> 오늘 등록</span>' +
      (order.length ? order.map(function (u) { return '<span class="tb-done-id">' + esc(u) + (cnt[u] > 1 ? '<em>×' + cnt[u] + '</em>' : '') + '</span>'; }).join("")
                    : '<span class="tb-done-none">오늘 등록한 사람이 없어요</span>') + '</div>';
  }

  // 질문 한 줄 아래: 등록 아이디 · +1 누른 아이디(횟수)
  function whoHtml(id, creator, lastTap) {
    var tally = {}, order = [];
    events.forEach(function (e) {
      if (e.type !== "dup" || String(e.mfaq_id) !== String(id)) return;
      var u = String(e.user || "-"); if (!tally[u]) { tally[u] = 0; order.push(u); } tally[u]++;
    });
    var taps = order.sort(function (a, b) { return tally[b] - tally[a]; }).map(function (u) { return '<b>' + esc(u) + '</b>' + (tally[u] > 1 ? '<em>×' + tally[u] + '</em>' : ''); });
    if (!taps.length && lastTap && lastTap.user) taps = ['<b>' + esc(lastTap.user) + '</b>'];
    return '<div class="mfaq-who"><span><i class="fa-solid fa-user-pen"></i>등록 <b>' + esc(creator || "-") + '</b></span>' +
      (taps.length ? '<span><i class="fa-solid fa-hand-pointer"></i>+1 ' + taps.join(", ") + '</span>' : '') + '</div>';
  }

  async function load() {
    var c = client(); if (!c) { render(); return; }
    try {
      var r = await c.from("mfaq_events").select("mfaq_id,type,user,event_date").order("id", { ascending: true }).limit(20000);
      if (!r.error && r.data) { events = r.data; loaded = true; }
    } catch (e) {}
    render();
    try { var tab = document.getElementById("tab-mfaq"); if (tab && tab.classList.contains("active") && typeof window.renderMfaq === "function") window.renderMfaq(); } catch (e) {}
  }

  async function record(type, id) {
    var row = { mfaq_id: id ? String(id) : null, type: type, event_date: today(), user: me() || null };
    events.push(row);
    var c = client(); if (!c || !me()) return;
    try { await c.from("mfaq_events").insert([row]); } catch (e) { console.warn("mfaq_events", e); }
  }

  function snapshot() { var m = new Map(); logs().forEach(function (l) { m.set(String(l.id), Number(l.count) || 0); }); return m; }
  function diffAndRecord(before) {
    var changed = false;
    logs().forEach(function (l) {
      var k = String(l.id), c = Number(l.count) || 0;
      if (!before.has(k)) { record("new", k); changed = true; }
      else if (c > before.get(k)) { record("dup", k); changed = true; }
    });
    if (changed) { render(); try { if (typeof window.renderMfaq === "function") window.renderMfaq(); } catch (e) {} }
  }

  function wrap() {
    var add = window.handleAddMfaqSubmit, inc = window.incrementMfaqCount;
    if (typeof add === "function" && !add.__mfaqDash) {
      var w1 = async function (ev) { var b = snapshot(); var r = await add.apply(this, arguments); diffAndRecord(b); return r; };
      w1.__mfaqDash = true; window.handleAddMfaqSubmit = w1;
    }
    if (typeof inc === "function" && !inc.__mfaqDash) {
      var w2 = async function (id) { var b = snapshot(); var r = await inc.apply(this, arguments); diffAndRecord(b); return r; };
      w2.__mfaqDash = true; window.incrementMfaqCount = w2;
    }
    var rm = window.renderMfaq;
    if (typeof rm === "function" && !rm.__mfaqDash) {
      var w3 = function () { var r = rm.apply(this, arguments); try { render(); } catch (e) {} return r; };
      w3.__mfaqDash = true; window.renderMfaq = w3;
    }
  }

  function init() {
    wrap();
    window.addEventListener("load", function () { setTimeout(wrap, 0); });
    var tab = document.getElementById("tab-mfaq");
    if (tab) new MutationObserver(function () { if (tab.classList.contains("active")) { wrap(); load(); } }).observe(tab, { attributes: true, attributeFilter: ["class"] });
    var tries = 0, boot = setInterval(function () { tries++; if (client() && me()) { clearInterval(boot); load(); try { client().channel("public:mfaq_events").on("postgres_changes", { event: "INSERT", schema: "public", table: "mfaq_events" }, function () { load(); }).subscribe(); } catch (e) {} } else if (tries > 90) clearInterval(boot); }, 1000);
  }
  window.MfaqDash = { load: load, render: render, whoHtml: whoHtml };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

// ===== 매장 입고 권한: 관리자(jipar5, junkoo)가 아이디별로 켜고 끔 =====
// · 켜진 아이디만 담기/저장/삭제 가능 (DB에서도 막음) · 기록 보기와 엑셀은 누구나
// · 켜면 3시간 동안만 유효 → 지나면 자동으로 꺼짐 (서버 시간 기준)
(function () {
  "use strict";
  var MANAGERS = ["jipar5", "junkoo"];
  var state = { allowed: null, list: [], checking: false, expires: null, timer: null };
  function leftText(iso) {
    var ms = new Date(iso).getTime() - Date.now(); if (!(ms > 0)) return "만료";
    var m = Math.ceil(ms / 60000), h = Math.floor(m / 60); m = m % 60;
    return (h ? h + "시간 " : "") + m + "분 남음";
  }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function me() { try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || "").trim(); } catch (e) { return ""; } }
  function client() { try { return typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { return null; } }
  function toast(m, t) { if (typeof showToast === "function") showToast(m, t || "info"); }
  function isManager() { return MANAGERS.indexOf(me().toLowerCase()) !== -1; }

  async function check() {
    if (isManager() || (window.isTestSandbox && window.isTestSandbox())) { state.allowed = true; state.expires = null; applyUi(); return true; }   // 시험 계정은 저장이 안 되므로 열어 둠
    var c = client(), id = me();
    if (!c || !id) { state.allowed = false; applyUi(); return false; }
    try {
      var r = await c.rpc("my_store_inbound_expiry");
      state.expires = !r.error && r.data ? r.data : null;
      state.allowed = !!state.expires && new Date(state.expires).getTime() > Date.now();
    } catch (e) { state.allowed = false; state.expires = null; }
    // 만료 시각이 되면 다시 확인해서 자동으로 잠금
    if (state.timer) clearTimeout(state.timer);
    if (state.allowed) state.timer = setTimeout(check, Math.min(new Date(state.expires).getTime() - Date.now() + 1500, 2147483000));
    applyUi();
    return state.allowed;
  }

  function applyUi() {
    var tab = document.getElementById("tab-store-inbound"); if (!tab) return;
    var locked = state.allowed === false;
    tab.classList.toggle("si-locked", locked);
    var bar = document.getElementById("si-lock-bar");
    if (!bar) {
      bar = document.createElement("div"); bar.id = "si-lock-bar";
      var scanner = tab.querySelector("#store-barcode-input");
      var panel = scanner ? scanner.closest('div[style*="border-radius:14px"]') : null;
      if (panel && panel.parentNode) panel.parentNode.insertBefore(bar, panel); else tab.firstElementChild.appendChild(bar);
    }
    var timed = !locked && state.allowed && state.expires;
    bar.style.display = locked || timed ? "" : "none";
    bar.className = "si-lock-bar" + (timed ? " ok" : "");
    bar.innerHTML = timed
      ? '<i class="fa-solid fa-unlock"></i><div><b>매장 입고 권한 켜짐 · ' + esc(leftText(state.expires)) + '</b><span>관리자가 켜 준 뒤 3시간 동안 쓸 수 있고, 시간이 지나면 자동으로 꺼져요.</span></div>'
      : '<i class="fa-solid fa-lock"></i><div><b>매장 입고 권한이 없어요</b><span>입고 등록은 관리자(jipar5, junkoo)가 켜 준 아이디만 할 수 있어요 (켜면 3시간 동안 가능). 기록 보기와 엑셀은 그대로 쓸 수 있어요.</span></div>';
    ["store-barcode-input", "btn-save-store-inbound"].forEach(function (id) { var el = document.getElementById(id); if (el) el.disabled = locked; });
    var head = tab.querySelector("#btn-store-excel-export");
    var mb = document.getElementById("btn-si-access");
    if (isManager() && head && !mb) {
      mb = document.createElement("button"); mb.type = "button"; mb.id = "btn-si-access"; mb.className = "si-access-btn";
      mb.innerHTML = '<i class="fa-solid fa-user-shield"></i> 입고 권한';
      mb.onclick = function () { openModal(); };
      head.parentNode.insertBefore(mb, head);
    }
    if (mb) mb.style.display = isManager() ? "" : "none";
  }

  function denied() { toast("매장 입고 권한이 없는 아이디예요. 관리자(jipar5, junkoo)에게 권한을 요청해 주세요.", "warning"); }

  function wrapFns() {
    var add = window.addStoreInboundCartItem;
    if (typeof add === "function" && !add.__siGuard) {
      var w = function () { if (state.allowed === false) { denied(); return; } return add.apply(this, arguments); };
      w.__siGuard = true; window.addStoreInboundCartItem = w;
    }
    var proc = window.processStoreInboundCart;
    if (typeof proc === "function" && !proc.__siGuard) {
      var w2 = async function () { var ok = await check(); if (!ok) { denied(); return; } return proc.apply(this, arguments); };
      w2.__siGuard = true; window.processStoreInboundCart = w2;
    }
    var del = window.deleteStoreInboundLog;
    if (typeof del === "function" && !del.__siGuard) {
      var w3 = async function () { var ok = await check(); if (!ok) { denied(); return; } return del.apply(this, arguments); };
      w3.__siGuard = true; window.deleteStoreInboundLog = w3;
    }
  }

  // ----- 관리자: 아이디별 권한 켜고 끄기 -----
  function ensureModal() {
    var m = document.getElementById("si-access-modal"); if (m) return m;
    m = document.createElement("div"); m.id = "si-access-modal"; m.className = "tb-sheet-backdrop";
    m.innerHTML = '<div class="tb-sheet si-access-sheet" role="dialog" aria-modal="true">' +
      '<div class="tb-sheet-top"><span class="tb-sheet-step si-step"><i class="fa-solid fa-user-shield"></i> 매장 입고 권한</span><button type="button" class="tb-sheet-close" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="tb-sheet-scroll"><div class="si-access-help">켜진 아이디만 매장 입고를 등록·삭제할 수 있어요. <b>켜면 3시간 동안만 가능</b>하고 시간이 지나면 자동으로 꺼져요. jipar5, junkoo는 항상 가능해요.</div><div id="si-access-list"></div></div></div>';
    m.addEventListener("click", function (e) { if (e.target === m || e.target.closest(".tb-sheet-close")) closeModal(); });
    document.body.appendChild(m); return m;
  }
  async function openModal() {
    if (!isManager()) return;
    ensureModal().classList.add("active"); document.body.classList.add("tb-sheet-open");
    document.getElementById("si-access-list").innerHTML = '<div class="tb-empty">불러오는 중…</div>';
    await loadList();
  }
  function closeModal() { var m = document.getElementById("si-access-modal"); if (m) m.classList.remove("active"); document.body.classList.remove("tb-sheet-open"); }
  async function loadList() {
    var c = client(); if (!c) return;
    var r = await c.rpc("store_inbound_access_list2");
    if (r.error) { document.getElementById("si-access-list").innerHTML = '<div class="tb-empty">목록을 불러오지 못했어요. (' + esc(r.error.message) + ')</div>'; return; }
    state.list = (r.data || []).filter(function (u) { return u.app_role !== "viewer"; });
    renderList();
  }
  function fmt(iso) { if (!iso) return ""; var d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function renderList() {
    var box = document.getElementById("si-access-list"); if (!box) return;
    var on = state.list.filter(function (u) { return u.enabled || MANAGERS.indexOf(String(u.login_id).toLowerCase()) !== -1; }).length;
    box.innerHTML = '<div class="si-access-count">권한 있는 아이디 <b>' + on + '</b> / ' + state.list.length + '</div>' + state.list.map(function (u) {
      var id = String(u.login_id), mgr = MANAGERS.indexOf(id.toLowerCase()) !== -1, en = mgr || u.enabled;
      return '<div class="si-access-row' + (en ? " on" : "") + '"><div class="si-access-id"><b>' + esc(id) + '</b>' + (mgr ? '<span class="si-tag">관리자</span>' : u.app_role === "admin" ? '<span class="si-tag gray">admin</span>' : '') +
        '<small>' + (mgr ? "항상 가능" : en ? '<span class="si-left">' + esc(leftText(u.expires_at)) + '</span> · ' + esc(u.updated_by || "") + " " + esc(fmt(u.updated_at)) + ' 켬'
          : u.updated_by ? "꺼짐 · 마지막 변경 " + esc(u.updated_by) + " " + esc(fmt(u.updated_at)) : "꺼짐") + '</small></div>' +
        (!mgr && en ? '<button type="button" class="si-extend" data-ext="' + esc(id) + '">3시간 다시</button>' : '') +
        '<label class="switch-toggle si-switch"><input type="checkbox" ' + (en ? "checked " : "") + (mgr ? "disabled " : "") + 'data-id="' + esc(id) + '"><span class="slider-toggle"></span></label></div>';
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll("input[data-id]"), function (inp) {
      inp.addEventListener("change", function () { setAccess(inp.dataset.id, inp.checked, inp); });
    });
    Array.prototype.forEach.call(box.querySelectorAll("button[data-ext]"), function (btn) {
      btn.addEventListener("click", function () { btn.disabled = true; setAccess(btn.dataset.ext, true, null); });
    });
  }
  async function setAccess(id, enabled, inp) {
    var c = client(); if (!c || !isManager()) return;
    if (inp) inp.disabled = true;
    var row = { login_id: id, enabled: enabled, updated_by: me() };   // 만료 시각(3시간)은 서버가 정함
    var r = await c.from("store_inbound_access").upsert([row], { onConflict: "login_id" });
    if (r.error) { toast("권한 변경 실패: " + r.error.message, "danger"); if (inp) { inp.checked = !enabled; inp.disabled = false; } return; }
    toast(id + " 매장 입고 권한을 " + (enabled ? "켰어요 (3시간 동안 가능)" : "껐어요") + ".", enabled ? "success" : "info");
    await loadList();
  }

  function init() {
    wrapFns();
    // 1분마다: 남은 시간 표시 갱신 · 만료된 권한 자동 반영
    setInterval(function () {
      if (document.hidden || !me()) return;
      var m = document.getElementById("si-access-modal");
      if (m && m.classList.contains("active")) loadList();
      var tab = document.getElementById("tab-store-inbound");
      if (tab && tab.classList.contains("active")) check();
    }, 60000);
    window.addEventListener("load", function () { setTimeout(wrapFns, 0); });
    var tab = document.getElementById("tab-store-inbound");
    if (tab) new MutationObserver(function () { if (tab.classList.contains("active")) { wrapFns(); check(); } }).observe(tab, { attributes: true, attributeFilter: ["class"] });
    var tries = 0, boot = setInterval(function () {
      tries++;
      if (client() && me()) {
        clearInterval(boot); check();
        try { client().channel("public:store_inbound_access").on("postgres_changes", { event: "*", schema: "public", table: "store_inbound_access" }, function () { check(); if (document.getElementById("si-access-modal")?.classList.contains("active")) loadList(); }).subscribe(); } catch (e) {}
      } else if (tries > 90) clearInterval(boot);
    }, 1000);
  }
  window.StoreInboundAccess = { check: check, open: openModal };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

// ===== 입출고 등록 화면 개선 =====
// 1) 입고/출고에 따라 화면 색·저장 버튼 문구 변경   2) 현재 재고 → 저장 후 재고 크게 (재고 부족 즉시 경고)
// 3) 입고 저장 때 "창고 구역을 어디로?" 팝업 (지금 위치와 다르면 한 번 더 확인)
// 4) 내 최근 등록 5건 + 오늘 기록 바로 취소   5) 수량칸 크게 + 출고 '최대'
// 6) 품번을 찾으면 제품 카드(사진·이름·위치), 이름 입력칸은 미등록 제품일 때만   7) 오늘이 아닌 날짜면 노란 표시
(function () {
  "use strict";
  var ZONES = ["B1", "B2", "B3", "램프"];
  var zoneChosen = false, lastSig = "", lastRecentSig = "";
  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function today() { return typeof window.getTodayDateString === "function" ? window.getTodayDateString() : ymd(new Date()); }
  function me() { try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || "").trim(); } catch (e) { return ""; } }
  function client() { try { return typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { return null; } }
  function toast(m, t) { if (typeof showToast === "function") showToast(m, t || "info"); }
  function regType() { var c = document.querySelector('input[name="reg-type"]:checked'); return c ? c.value : "입고"; }
  function pad8(v) { var d = String(v || "").replace(/\D/g, ""); return d && d.length <= 8 ? d.padStart(8, "0") : String(v || "").trim(); }
  function findProduct(q) {
    if (!q) return null;
    var p = null;
    try { p = typeof resolveMasterProduct === "function" ? resolveMasterProduct(q) : null; } catch (e) {}
    if (!p || p.isUnregistered || !p.artName) return null;
    var k = pad8(p.artNo), cat = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
    var m = cat.find(function (x) { return pad8(x.artNo || x.artno) === k; });
    var loc = (m && m.location && m.location !== "미지정") ? String(m.location).trim() : "";
    return { artNo: k, artName: p.artName, location: loc };
  }
  function stockOf(no) { try { return typeof window.getArtCurrentStock === "function" ? Number(window.getArtCurrentStock(no)) || 0 : 0; } catch (e) { return 0; } }
  function thumb(no, name, size) { return typeof getProductThumbHtml === "function" ? getProductThumbHtml(pad8(no), name || "", size) : ""; }
  function loadThumbs() { if (typeof loadProductThumbnails === "function") { try { loadProductThumbnails(); } catch (e) {} } }

  // ---------- 1) 모드 색 ----------
  function applyMode() {
    var f = $("register-form"); if (!f) return;
    var t = regType();
    f.classList.toggle("reg-mode-in", t === "입고"); f.classList.toggle("reg-mode-out", t === "출고");
    var lb = $("reg-save-label"); if (lb) lb.textContent = t === "입고" ? "입고 저장" : "출고 저장";
    var mx = $("reg-qty-max"); if (mx) mx.style.display = t === "출고" ? "" : "none";
  }

  // ---------- 2) 재고 미리보기 (크게) ----------
  function stockPreview() {
    var box = $("reg-current-stock"); if (!box) return;
    var no = (($("reg-artno") || {}).value || "").trim();
    if (!no) { box.className = "stock-preview-box reg-stock-big"; box.innerHTML = '<span class="rs-label">현재 재고</span><b class="rs-now">-</b>'; return; }
    var cur = stockOf(no), t = regType(), q = parseInt(($("reg-qty") || {}).value, 10) || 0;
    var cls = "stock-preview-box reg-stock-big", html = '<span class="rs-label">현재 재고</span><b class="rs-now">' + cur + '</b><span class="rs-unit">개</span>';
    if (t === "출고") {
      if (cur <= 0) { cls += " bad"; html += '<span class="rs-msg">재고가 없어 출고할 수 없어요</span>'; }
      else if (q > 0) {
        var after = cur - q;
        if (after < 0) { cls += " bad"; html += '<i class="fa-solid fa-arrow-right rs-arrow"></i><span class="rs-msg">재고보다 ' + (q - cur) + '개 많아요</span>'; }
        else { cls += " out"; html += '<i class="fa-solid fa-arrow-right rs-arrow"></i><span class="rs-label">출고 후</span><b class="rs-after">' + after + '</b><span class="rs-unit">개</span>'; }
      }
    } else if (q > 0) { cls += " in"; html += '<i class="fa-solid fa-arrow-right rs-arrow"></i><span class="rs-label">입고 후</span><b class="rs-after">' + (cur + q) + '</b><span class="rs-unit">개</span>'; }
    box.className = cls; box.innerHTML = html;
  }

  // ---------- 6) 제품 카드 ----------
  function productCard() {
    var card = $("reg-product-card"), nameGroup = $("reg-name-group"); if (!card || !nameGroup) return;
    var no = (($("reg-artno") || {}).value || "").trim();
    if (!no) { card.style.display = "none"; card.dataset.k = ""; nameGroup.style.display = "none"; return; }
    var p = findProduct(no);
    if (!p) { card.style.display = "none"; card.dataset.k = ""; nameGroup.style.display = ""; return; }
    nameGroup.style.display = "none";
    var t = regType(), k = p.artNo + "|" + p.location + "|" + t;
    if (card.dataset.k === k && card.style.display !== "none") return;
    card.dataset.k = k; card.style.display = "";
    var locHtml = p.location
      ? (t === "출고" ? '<span class="rp-loc out"><i class="fa-solid fa-location-dot"></i> ' + esc(p.location) + ' 구역에서 챙기세요</span>'
                     : '<span class="rp-loc"><i class="fa-solid fa-location-dot"></i> 지금 위치 ' + esc(p.location) + '</span><span class="rp-hint">저장할 때 구역을 골라요</span>')
      : '<span class="rp-loc none"><i class="fa-solid fa-triangle-exclamation"></i> 위치 미지정</span>' + (t === "입고" ? '<span class="rp-hint">저장할 때 구역을 골라요</span>' : '');
    card.innerHTML = '<div class="rp-thumb">' + thumb(p.artNo, p.artName, 60) + '</div><div class="rp-body"><div class="rp-name">' + esc(p.artName) + '</div>' +
      '<div class="rp-no">' + esc(p.artNo) + '</div><div class="rp-locs">' + locHtml + '</div></div>';
    loadThumbs();
  }

  // ---------- 7) 날짜 ----------
  function dateWarn() {
    var el = $("reg-date-warn"), d = ($("reg-date") || {}).value || ""; if (!el) return;
    if (!d || d === today()) { el.style.display = "none"; return; }
    var dd = new Date(d + "T00:00:00"), lab = (dd.getMonth() + 1) + "/" + dd.getDate();
    el.style.display = ""; el.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + (d < today() ? "지난" : "미래") + ' 날짜 ' + lab + ' 로 등록돼요';
  }

  // ---------- 4) 내 최근 등록 5건 ----------
  function myRecent() {
    var logs = (typeof historyLogs !== "undefined" && Array.isArray(historyLogs)) ? historyLogs : [], u = me().toLowerCase();
    return logs.filter(function (l) { return l && String(l.user || "").toLowerCase() === u && l.id != null && !String(l.id).startsWith("local"); })
      .slice().sort(function (a, b) { return (Number(b.id) || 0) - (Number(a.id) || 0); }).slice(0, 5);
  }
  function fmtTime(l) { var c = l.created_at ? new Date(l.created_at) : null; if (!c || isNaN(c)) return String(l.date || ""); return (c.getMonth() + 1) + "/" + c.getDate() + " " + String(c.getHours()).padStart(2, "0") + ":" + String(c.getMinutes()).padStart(2, "0"); }
  function renderRecent(force) {
    var box = $("reg-recent"); if (!box) return;
    var list = myRecent(), sig = list.map(function (l) { return l.id + ":" + l.qty; }).join(",");
    if (!force && sig === lastRecentSig) return; lastRecentSig = sig;
    if (!me() || !list.length) { box.innerHTML = ""; return; }
    var t = today();
    box.innerHTML = '<div class="rr-head"><span><i class="fa-solid fa-clock-rotate-left"></i> 내 최근 등록</span><small>오늘 기록은 바로 취소할 수 있어요</small></div>' +
      list.map(function (l) {
        var no = pad8(l.artNo || l.artno), name = l.artName || (typeof masterCatalogMap !== "undefined" && masterCatalogMap ? masterCatalogMap.get(no) : "") || "기타 품목";
        var isIn = l.type === "입고", canUndo = String(l.date) === t;
        return '<div class="rr-row">' + '<span class="rr-type ' + (isIn ? "in" : "out") + '">' + esc(l.type) + '</span>' +
          '<div class="rr-body"><div class="rr-name">' + esc(name) + '</div><div class="rr-meta">' + esc(no) + ' · ' + esc(fmtTime(l)) + (String(l.date) !== t ? ' · ' + esc(l.date) : '') + '</div></div>' +
          '<b class="rr-qty ' + (isIn ? "in" : "out") + '">' + (isIn ? "+" : "−") + esc(l.qty) + '</b>' +
          (canUndo ? '<button type="button" class="rr-undo" data-id="' + esc(l.id) + '">취소</button>' : '') + '</div>';
      }).join("");
    Array.prototype.forEach.call(box.querySelectorAll(".rr-undo"), function (b) { b.addEventListener("click", function () { undo(b.dataset.id, b); }); });
  }
  async function undo(id, btn) {
    if (typeof isViewerUser !== "undefined" && isViewerUser) { toast("Viewer(읽기 전용) 계정은 취소할 수 없습니다.", "warning"); return; }
    var logs = (typeof historyLogs !== "undefined" && Array.isArray(historyLogs)) ? historyLogs : [];
    var l = logs.find(function (x) { return String(x.id) === String(id); }); if (!l) return;
    var no = pad8(l.artNo || l.artno), name = l.artName || no;
    if (!confirm("[" + name + "] " + l.type + " " + l.qty + "개 기록을 취소할까요?\n재고가 등록 전으로 돌아가요.")) return;
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }
    if (btn) { btn.disabled = true; btn.textContent = "취소 중"; }
    try {
      var r = await c.from("inventory_logs").delete().eq("id", l.id).select("id");
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw new Error("이미 지워졌거나 취소할 권한이 없어요");
      historyLogs = historyLogs.filter(function (x) { return String(x.id) !== String(id); });
      try { localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs)); } catch (e) {}
      if (typeof invalidateStockCache === "function") invalidateStockCache();
      try { if (typeof renderStockLookup === "function") renderStockLookup(); if (typeof renderHistoryLogs === "function") renderHistoryLogs(); } catch (e) {}
      toast("[" + name + "] " + l.type + " " + l.qty + "개 기록을 취소했어요.", "success");
      renderRecent(true); stockPreview();
    } catch (err) {
      toast("취소 실패: " + (err.message || err), "danger");
      if (btn) { btn.disabled = false; btn.textContent = "취소"; }
    }
  }

  // ---------- 3) 입고 구역 팝업 ----------
  function ensureSheet() {
    var el = $("reg-zone-sheet"); if (el) return el;
    el = document.createElement("div"); el.id = "reg-zone-sheet"; el.className = "tb-sheet-backdrop";
    el.innerHTML = '<div class="tb-sheet rz-sheet" role="dialog" aria-modal="true"><div class="tb-sheet-top"><span class="tb-sheet-step rz-step"><i class="fa-solid fa-location-dot"></i> 입고 구역 지정</span>' +
      '<button type="button" class="tb-sheet-close" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div><div class="tb-sheet-scroll" id="rz-body"></div></div>';
    document.body.appendChild(el); return el;
  }
  // 오늘이 아닌 날짜면 팝업에도 표시
  function dateNote(verb) {
    var d = ($("reg-date") || {}).value || "";
    if (!d || d === today()) return "";
    var dd = new Date(d + "T00:00:00");
    return '<div class="rz-date"><i class="fa-solid fa-triangle-exclamation"></i> 오늘이 아니에요! ' + (dd.getMonth() + 1) + '월 ' + dd.getDate() + '일 ' + (d < today() ? "(지난 날짜)" : "(미래 날짜)") + '로 ' + (verb || "입고") + '돼요</div>';
  }
  function askZone(no, qty) {
    return new Promise(function (resolve) {
      var p = findProduct(no), cur = p ? p.location : "", name = p ? p.artName : ((($("reg-artname") || {}).value || "").trim() || "미등록 품목");
      var el = ensureSheet(), body = $("rz-body"), done = false;
      var stepEl = el.querySelector(".rz-step"); if (stepEl) stepEl.innerHTML = '<i class="fa-solid fa-location-dot"></i> 입고 구역 지정';
      function finish(v) { if (done) return; done = true; el.classList.remove("active"); document.body.classList.remove("tb-sheet-open"); el.onclick = null; resolve(v); }
      el.onclick = function (e) { if (e.target === el || e.target.closest(".tb-sheet-close")) finish(null); };
      function step1() {
        body.innerHTML = '<div class="rz-prod">' + (p ? '<div class="rz-thumb">' + thumb(p.artNo, name, 52) + '</div>' : '') + '<div><div class="rz-name">' + esc(name) + '</div><div class="rz-meta">' + esc(p ? p.artNo : pad8(no)) + ' · 입고 <b>' + esc(qty) + '개</b></div></div></div>' +
          dateNote() +
          '<div class="rz-q">창고 구역을 어디로 지정할까요?</div>' +
          (cur ? '<div class="rz-cur">지금 위치: <b>' + esc(cur) + '</b></div>' : '<div class="rz-cur none">아직 위치가 지정되지 않은 제품이에요</div>') +
          '<div class="rz-grid">' + ZONES.map(function (z) { return '<button type="button" class="rz-zone' + (z === cur ? " cur" : "") + (z === "램프" ? " ramp" : "") + '" data-z="' + z + '">' + z + (z === cur ? '<small>지금 위치</small>' : '') + '</button>'; }).join("") + '</div>' +
          '<button type="button" class="rz-cancel">취소</button>';
        Array.prototype.forEach.call(body.querySelectorAll(".rz-zone"), function (b) { b.addEventListener("click", function () { var z = b.dataset.z; if (cur && z !== cur) step2(z); else finish(z); }); });
        body.querySelector(".rz-cancel").addEventListener("click", function () { finish(null); });
        loadThumbs();
      }
      function step2(z) {
        body.innerHTML = '<div class="rz-move"><i class="fa-solid fa-triangle-exclamation"></i><div class="rz-move-title">위치를 옮길까요?</div>' +
          '<div class="rz-move-path"><span>' + esc(cur) + '</span><i class="fa-solid fa-arrow-right"></i><span class="to">' + esc(z) + '</span></div>' +
          '<div class="rz-move-desc">[' + esc(name) + ']<br>지금 <b>' + esc(cur) + '</b>에 있는 제품이에요. 입고하면 이 제품의 위치가 <b>' + esc(z) + '</b>(으)로 바뀌어요.</div></div>' +
          dateNote() +
          '<div class="rz-actions"><button type="button" class="rz-back">다시 고르기</button><button type="button" class="rz-ok">' + esc(z) + '(으)로 옮기고 입고</button></div>';
        body.querySelector(".rz-back").addEventListener("click", step1);
        body.querySelector(".rz-ok").addEventListener("click", function () { finish(z); });
      }
      step1();
      el.classList.add("active"); document.body.classList.add("tb-sheet-open");
    });
  }
  // 저장 누르면 먼저 "입고 / 출고" 팝업
  function askType(no, qty) {
    return new Promise(function (resolve) {
      var p = findProduct(no), name = p ? p.artName : ((($("reg-artname") || {}).value || "").trim() || "미등록 품목");
      var cur = stockOf(no), afterIn = cur + qty, afterOut = cur - qty, canOut = cur > 0 && afterOut >= 0;
      var el = ensureSheet(), body = $("rz-body"), done = false;
      var step = el.querySelector(".rz-step"); if (step) step.innerHTML = '<i class="fa-solid fa-arrows-left-right"></i> 입고 / 출고 선택';
      function finish(v) { if (done) return; done = true; el.classList.remove("active"); document.body.classList.remove("tb-sheet-open"); el.onclick = null; resolve(v); }
      el.onclick = function (e) { if (e.target === el || e.target.closest(".tb-sheet-close")) finish(null); };
      body.innerHTML = '<div class="rz-prod">' + (p ? '<div class="rz-thumb">' + thumb(p.artNo, name, 52) + '</div>' : '') + '<div><div class="rz-name">' + esc(name) + '</div><div class="rz-meta">' + esc(p ? p.artNo : pad8(no)) + ' · 수량 <b>' + esc(qty) + '개</b> · 현재 재고 ' + cur + '개' + (p && p.location ? ' · ' + esc(p.location) : '') + '</div></div></div>' +
        dateNote("등록") +
        '<div class="rz-q">입고인가요, 출고인가요?</div>' +
        '<div class="rt-grid">' +
          '<button type="button" class="rt-btn in" data-t="입고"><i class="fa-solid fa-plus"></i><b>입고</b><small>재고 ' + cur + ' → ' + afterIn + '개</small></button>' +
          '<button type="button" class="rt-btn out" data-t="출고"' + (canOut ? '' : ' disabled') + '><i class="fa-solid fa-minus"></i><b>출고</b><small>' + (canOut ? '재고 ' + cur + ' → ' + afterOut + '개' : (cur <= 0 ? '재고가 없어요' : '재고 부족 (' + (qty - cur) + '개 모자람)')) + '</small></button>' +
        '</div>' +
        (canOut || cur <= 0 ? '' : '') +
        '<button type="button" class="rz-cancel">취소</button>';
      Array.prototype.forEach.call(body.querySelectorAll(".rt-btn:not([disabled])"), function (b) { b.addEventListener("click", function () { finish(b.dataset.t); }); });
      body.querySelector(".rz-cancel").addEventListener("click", function () { finish(null); });
      loadThumbs();
      el.classList.add("active"); document.body.classList.add("tb-sheet-open");
    });
  }
  function setType(t) {
    var r = document.querySelector('input[name="reg-type"][value="' + t + '"]');
    if (r) { r.checked = true; if (typeof updateTypeToggle === "function") { try { updateTypeToggle(); } catch (e) {} } }
  }
  function gate(orig) {
    if (typeof orig !== "function" || orig.__zoneGate) return orig;
    var w = async function () {
      var args = arguments, ctx = this;
      if (zoneChosen) return orig.apply(ctx, args);
      var no = (($("reg-artno") || {}).value || "").trim(), q = Number(($("reg-qty") || {}).value);
      if (!no || !q || q <= 0) return orig.apply(ctx, args);   // 원래 안내(번호·수량 입력) 그대로
      var t = regType();
      if (t === "입고") {
        var z = await askZone(no, q);
        if (!z) return;
        var li = $("reg-location"); if (li) li.value = z;
      }
      zoneChosen = true;
      try { return await orig.apply(ctx, args); } finally { zoneChosen = false; applyMode(); }
    };
    w.__zoneGate = true; return w;
  }
  function wrapAll() {
    window.handleAddRegCart = gate(window.handleAddRegCart);
    window.handleSingleRegSave = gate(window.handleSingleRegSave);
    // 미리보기는 이 모듈이 크게 그림
    if (!window.updateRegStockPreview || !window.updateRegStockPreview.__big) { var sp = function () { stockPreview(); }; sp.__big = true; window.updateRegStockPreview = sp; }
  }

  // ---------- 5) 최대 ----------
  function bindOnce() {
    var mx = $("reg-qty-max");
    if (mx && !mx.dataset.bound) {
      mx.dataset.bound = "1";
      mx.addEventListener("click", function () {
        var no = (($("reg-artno") || {}).value || "").trim(); if (!no) { toast("먼저 아티클 번호를 입력해 주세요.", "warning"); return; }
        var cur = stockOf(no); if (cur <= 0) { toast("출고할 재고가 없어요.", "warning"); return; }
        var q = $("reg-qty"); q.value = cur; q.dispatchEvent(new Event("input", { bubbles: true })); stockPreview();
      });
    }
    var q = $("reg-qty"); if (q && !q.dataset.prev) { q.dataset.prev = "1"; q.addEventListener("input", stockPreview); }
    var d = $("reg-date"); if (d && !d.dataset.warn) { d.dataset.warn = "1"; d.addEventListener("change", dateWarn); d.addEventListener("input", dateWarn); }
    Array.prototype.forEach.call(document.querySelectorAll('input[name="reg-type"]'), function (r) { if (!r.dataset.mode) { r.dataset.mode = "1"; r.addEventListener("change", function () { applyMode(); productCard(); stockPreview(); }); } });
  }

  // ---------- 처음 화면: 입고 / 출고 큰 버튼 → 누르면 해당 모드의 등록 폼 ----------
  function ensureChooser() {
    var c = $("reg-chooser"); if (c) return c;
    var f = $("register-form"); if (!f) return null;
    c = document.createElement("div"); c.id = "reg-chooser";
    c.innerHTML = '<div class="rc-title">무엇을 등록할까요?</div><div class="rc-grid">' +
      '<button type="button" class="rc-btn in" data-t="입고"><i class="fa-solid fa-plus"></i><b><span class="rc-pre">창고</span>입고</b><small>창고에 넣기</small></button>' +
      '<button type="button" class="rc-btn out" data-t="출고"><i class="fa-solid fa-minus"></i><b><span class="rc-pre">창고</span>출고</b><small>창고에서 꺼내기</small></button></div>';
    f.parentNode.insertBefore(c, f);
    Array.prototype.forEach.call(c.querySelectorAll(".rc-btn"), function (b) { b.addEventListener("click", function () { choose(b.dataset.t); }); });
    // 폼 위에 '다시 고르기'
    var back = document.createElement("button"); back.type = "button"; back.id = "reg-back-chooser"; back.className = "reg-back-chooser";
    back.innerHTML = '<i class="fa-solid fa-chevron-left"></i> 입고 / 출고 다시 고르기';
    back.addEventListener("click", function () { showChooser(true); });
    f.parentNode.insertBefore(back, f);
    return c;
  }
  function showChooser(on) {
    var c = ensureChooser(), f = $("register-form"), back = $("reg-back-chooser"); if (!c || !f) return;
    c.style.display = on ? "" : "none"; f.style.display = on ? "none" : ""; if (back) back.style.display = on ? "none" : "";
  }
  function choose(t) {
    setType(t); showChooser(false); applyMode(); productCard(); stockPreview();
    var a = $("reg-artno"); if (a) setTimeout(function () { try { a.focus(); } catch (e) {} }, 50);
  }
  window.RegChooser = { show: function () { showChooser(true); }, choose: choose };

  function tick() {
    var tab = $("tab-register"); if (!tab || !tab.classList.contains("active")) return;
    var sig = [(($("reg-artno") || {}).value || ""), (($("reg-artname") || {}).value || ""), regType(), (($("reg-qty") || {}).value || ""), (($("reg-date") || {}).value || ""),
      (typeof historyLogs !== "undefined" && historyLogs ? historyLogs.length : 0)].join("|");
    if (sig !== lastSig) { lastSig = sig; applyMode(); productCard(); stockPreview(); dateWarn(); }
    var sb = $("reg-current-stock"); if (sb && !sb.querySelector(".rs-label")) stockPreview();   // 다른 코드가 덮어쓴 경우 복구
    renderRecent(false);
  }

  function init() {
    wrapAll(); bindOnce(); applyMode();
    var tabR = $("tab-register");
    if (tabR) {
      var wasActive = tabR.classList.contains("active");
      var cartEmpty = function () { try { return !(typeof regCartList !== "undefined" && regCartList.length); } catch (e) { return true; } };
      if (wasActive) showChooser(true);
      new MutationObserver(function () {
        var act = tabR.classList.contains("active");
        // 탭에 새로 들어왔고, 폼이 비어 있으면(다른 화면에서 품번을 넘겨받은 경우 제외) 입고/출고부터 고르기
        if (act && !wasActive) { var a = $("reg-artno"); if ((!a || !a.value.trim()) && cartEmpty()) showChooser(true); else showChooser(false); }
        wasActive = act;
      }).observe(tabR, { attributes: true, attributeFilter: ["class"] });
    }
    window.addEventListener("load", function () { setTimeout(function () { wrapAll(); bindOnce(); tick(); }, 0); });
    setInterval(tick, 400);
  }
  window.RegForm = { askZone: askZone, renderRecent: renderRecent, refresh: function () { lastSig = ""; tick(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

// ===== 구역 변경: 가운데 팝업에서 구역 버튼 한 번 누르면 바로 변경 =====
(function () {
  "use strict";
  var ZONES = ["B1", "B2", "B3", "램프"];
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad8(v) { var d = String(v || "").replace(/\D/g, ""); return d && d.length <= 8 ? d.padStart(8, "0") : String(v || "").trim(); }
  function info(no) {
    var k = pad8(no), cat = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
    var m = cat.find(function (x) { return pad8(x.artNo || x.artno) === k; });
    var name = (m && (m.artName || m.artname)) || ((typeof masterCatalogMap !== "undefined" && masterCatalogMap) ? masterCatalogMap.get(k) : "") || "기타 품목";
    var loc = (m && m.location && m.location !== "미지정") ? String(m.location).trim() : "";
    return { artNo: k, artName: name, location: loc };
  }
  function ensure() {
    var el = document.getElementById("loc-change-sheet"); if (el) return el;
    el = document.createElement("div"); el.id = "loc-change-sheet"; el.className = "tb-sheet-backdrop";
    el.innerHTML = '<div class="tb-sheet rz-sheet" role="dialog" aria-modal="true"><div class="tb-sheet-top"><span class="tb-sheet-step lc-step"><i class="fa-solid fa-pen-to-square"></i> 구역 변경</span>' +
      '<button type="button" class="tb-sheet-close" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div><div class="tb-sheet-scroll" id="lc-body"></div></div>';
    el.addEventListener("click", function (e) { if (e.target === el || e.target.closest(".tb-sheet-close") || e.target.closest(".rz-cancel")) close(); });
    document.body.appendChild(el); return el;
  }
  function close() { var el = document.getElementById("loc-change-sheet"); if (el) el.classList.remove("active"); document.body.classList.remove("tb-sheet-open"); }
  function open(artNo) {
    var p = info(artNo), el = ensure(), body = document.getElementById("lc-body");
    body.innerHTML = '<div class="rz-prod">' + (typeof getProductThumbHtml === "function" ? '<div class="rz-thumb">' + getProductThumbHtml(p.artNo, p.artName, 52) + '</div>' : '') +
      '<div><div class="rz-name">' + esc(p.artName) + '</div><div class="rz-meta">' + esc(p.artNo) + '</div></div></div>' +
      '<div class="rz-q">어느 구역으로 바꿀까요?</div>' +
      (p.location ? '<div class="rz-cur">지금 위치: <b>' + esc(p.location) + '</b></div>' : '<div class="rz-cur none">아직 위치가 지정되지 않은 제품이에요</div>') +
      '<div class="rz-grid">' + ZONES.map(function (z) {
        var cur = z === p.location;
        return '<button type="button" class="rz-zone' + (cur ? " cur" : "") + (z === "램프" ? " ramp" : "") + '" data-z="' + z + '"' + (cur ? " disabled" : "") + '>' + z + (cur ? '<small>지금 위치</small>' : '') + '</button>';
      }).join("") + '</div><button type="button" class="rz-cancel">닫기</button>';
    Array.prototype.forEach.call(body.querySelectorAll(".rz-zone:not([disabled])"), function (b) {
      b.addEventListener("click", async function () {
        Array.prototype.forEach.call(body.querySelectorAll(".rz-zone"), function (x) { x.disabled = true; });
        b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try { currentSingleLocArtNo = p.artNo; } catch (e) {}
        try { if (typeof window.saveSingleLocation === "function") await window.saveSingleLocation(b.dataset.z); } finally { close(); }
      });
    });
    if (typeof loadProductThumbnails === "function") { try { loadProductThumbnails(); } catch (e) {} }
    el.classList.add("active"); document.body.classList.add("tb-sheet-open");
  }
  // 여러 품목 선택 후 '위치 변경' → 같은 팝업, 구역 하나만 누르면 선택한 품목 모두 변경
  function openBulk() {
    var cbs = Array.prototype.slice.call(document.querySelectorAll(".stock-checkbox:checked"));
    if (!cbs.length) { if (typeof showToast === "function") showToast("위치를 바꿀 품목을 먼저 선택해 주세요.", "warning"); return; }
    var items = cbs.map(function (cb) { return info(cb.value); });
    var byLoc = {}; items.forEach(function (p) { var k = p.location || "미지정"; byLoc[k] = (byLoc[k] || 0) + 1; });
    var el = ensure(), body = document.getElementById("lc-body");
    var names = items.slice(0, 3).map(function (p) { return esc(p.artName); }).join(", ") + (items.length > 3 ? " 외 " + (items.length - 3) + "개" : "");
    body.innerHTML = '<div class="rz-prod"><div class="lc-multi-count">' + items.length + '<small>개</small></div><div><div class="rz-name">선택한 품목 ' + items.length + '개</div><div class="rz-meta">' + names + '</div></div></div>' +
      '<div class="rz-q">어느 구역으로 바꿀까요?</div>' +
      '<div class="rz-cur">지금 위치: ' + Object.keys(byLoc).map(function (k) { return '<b>' + esc(k) + '</b> ' + byLoc[k] + '개'; }).join(" · ") + '</div>' +
      '<div class="rz-grid">' + ZONES.map(function (z) { return '<button type="button" class="rz-zone' + (z === "램프" ? " ramp" : "") + '" data-z="' + z + '">' + z + '</button>'; }).join("") + '</div>' +
      '<button type="button" class="rz-cancel">닫기</button>';
    Array.prototype.forEach.call(body.querySelectorAll(".rz-zone"), function (b) {
      b.addEventListener("click", async function () {
        Array.prototype.forEach.call(body.querySelectorAll(".rz-zone"), function (x) { x.disabled = true; });
        b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        // 기존 일괄 저장 로직 재사용: 숨은 체크박스에서 고른 구역 하나만 체크
        Array.prototype.forEach.call(document.querySelectorAll('#bulk-loc-checkboxes input[type="checkbox"]'), function (cb) { cb.checked = cb.value === b.dataset.z; });
        try { if (typeof window.saveBulkLocation === "function") await window.saveBulkLocation(); } finally { close(); }
      });
    });
    el.classList.add("active"); document.body.classList.add("tb-sheet-open");
  }
  function install() {
    if (!window.setSingleLocation || !window.setSingleLocation.__simple) { open.__simple = true; window.setSingleLocation = open; }
    if (!window.openBulkLocationModal || !window.openBulkLocationModal.__simple) { openBulk.__simple = true; window.openBulkLocationModal = openBulk; }
  }
  install();
  window.addEventListener("load", function () { setTimeout(install, 0); });
})();

// ===== 시험 모드: 'test' 아이디는 저장/수정/삭제가 서버로 가지 않고 이 화면에서만 반영 =====
// (DB에서도 test 계정 쓰기를 막아 둠 — 혹시 빠진 곳이 있어도 실제 데이터에는 절대 안 들어감)
(function () {
  "use strict";
  var WRITE = ["insert", "update", "upsert", "delete"], fakeId = Date.now() * 10;
  function me() { try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || sessionStorage.getItem("warehouse_current_user") || "").trim().toLowerCase(); } catch (e) { return ""; } }
  function isTest() { return me() === "test"; }
  window.isTestSandbox = isTest;

  // 시험 모드에서 만든 기록은 이 화면 메모리에만 보관 (새로고침하면 사라짐)
  var store = {};
  function rowsOf(t) { return store[t] || (store[t] = []); }
  function match(row, filters) { return filters.every(function (f) { return String(row[f[0]]) === String(f[1]); }); }

  // 메서드를 계속 이어 붙일 수 있고(.select().eq().single()…), await 하면 exec 결과를 돌려주는 체인
  function chain(exec, passTo) {
    var filters = [], single = false, ranged = false, target = passTo;
    var proxy = new Proxy(function () {}, { get: function (t, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        var pr = Promise.resolve(exec(filters, single, ranged, target));
        return pr[prop].bind(pr);
      }
      return function () {
        var a = arguments;
        if (prop === "eq") filters.push([a[0], a[1]]);
        if (prop === "single" || prop === "maybeSingle") single = true;
        if (prop === "range") ranged = true;
        if (target && typeof target[prop] === "function") target = target[prop].apply(target, a);
        return proxy;
      };
    } });
    return proxy;
  }
  function out(rows, single) { return { data: single ? (rows[0] || null) : rows, error: null, status: 200, count: rows.length }; }

  function fakeWrite(kind, table, args) {
    var now = new Date().toISOString(), list = rowsOf(table);
    console.info("[시험 모드] " + table + "." + kind + " → 서버에 저장하지 않음");
    if (kind === "insert" || kind === "upsert") {
      var src = Array.isArray(args[0]) ? args[0] : [args[0]];
      var rows = src.map(function (r) {
        var o = Object.assign({}, r);
        if (kind === "upsert") { var key = o.id != null ? "id" : (o.login_id != null ? "login_id" : null); if (key) { var ex = list.find(function (x) { return String(x[key]) === String(o[key]); }); if (ex) { Object.assign(ex, o); return ex; } } }
        if (o.id == null) o.id = ++fakeId; if (!o.created_at) o.created_at = now; if (table.indexOf("_sessions") !== -1 && !o.status) o.status = "in_progress";
        list.push(o); return o;
      });
      return chain(function (f, single) { return out(rows, single); });
    }
    if (kind === "update") {
      var patchObj = args[0] || {};
      return chain(function (filters, single) { var m = list.filter(function (r) { return match(r, filters); }); m.forEach(function (r) { Object.assign(r, patchObj); }); return out(m.length ? m : [Object.assign({}, patchObj)], single); });
    }
    return chain(function (filters, single) { var m = list.filter(function (r) { return match(r, filters); }); store[table] = list.filter(function (r) { return m.indexOf(r) === -1; }); return out(m.length ? m : [{ id: (filters[0] || [])[1] }], single); });
  }
  // 읽기: 실제 서버 결과 + 시험 모드에서 만든 기록(같은 조건)
  function wrapRead(table, real) {
    return function (prop) {
      return function () {
        var started = real[prop].apply(real, arguments);
        return chain(async function (filters, single, ranged, target) {
          var res = await target;
          var mine = (store[table] || []).filter(function (r) { return match(r, filters); });
          if (!mine.length || ranged || (res && res.error)) return res;
          if (single) return Object.assign({}, res, { data: mine[0] });
          var ids = new Set(mine.map(function (r) { return String(r.id); }));
          var base = Array.isArray(res && res.data) ? res.data.filter(function (r) { return !ids.has(String(r.id)); }) : [];
          return Object.assign({}, res, { data: mine.slice().reverse().concat(base) });
        }, started);
      };
    };
  }
  function patch() {
    var c; try { c = typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { c = null; }
    if (!c || c.__sandboxPatched) return !!c;
    var origFrom = c.from.bind(c);
    c.from = function (table) {
      var real = origFrom(table);
      if (!isTest()) return real;
      var rd = wrapRead(table, real);
      return new Proxy(real, { get: function (t, prop) {
        if (WRITE.indexOf(prop) !== -1) return function () { return fakeWrite(prop, table, arguments); };
        if (prop === "select") return rd("select");
        var v = t[prop]; return typeof v === "function" ? v.bind(t) : v;
      } });
    };
    c.__sandboxPatched = true;
    return true;
  }
  // 시험 계정: 로그인하면 안내 팝업 → 5분 사용 → 자동 로그아웃
  var LIMIT_MS = 5 * 60 * 1000, START_KEY = "warehouse_test_sandbox_start", ended = false;
  function startTime() {
    var v = 0; try { v = Number(sessionStorage.getItem(START_KEY)) || 0; } catch (e) {}
    if (!v) { v = Date.now(); try { sessionStorage.setItem(START_KEY, String(v)); } catch (e) {} showIntro(); }
    return v;
  }
  function popup(id, icon, cls, title, desc, btn, onClick) {
    if (document.getElementById(id)) return;
    var el = document.createElement("div"); el.id = id; el.className = "tb-sheet-backdrop active";
    el.style.alignItems = "center"; el.style.padding = "16px"; el.style.zIndex = "100002";
    el.innerHTML = '<div class="auth-exp-card"><div class="auth-exp-icon ' + cls + '"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div class="auth-exp-title">' + title + '</div><div class="auth-exp-desc">' + desc + '</div>' +
      '<button type="button" class="auth-exp-btn">' + btn + '</button></div>';
    el.querySelector(".auth-exp-btn").addEventListener("click", function () { el.remove(); if (onClick) onClick(); });
    document.body.appendChild(el);
  }
  function showIntro() {
    popup("test-sandbox-intro", "fa-flask", "sandbox", "시험용 계정이에요",
      "여기서 저장·수정·삭제한 내용은 <b>실제 데이터에 들어가지 않아요.</b><br>" +
      "<b>5분 동안</b> 자유롭게 눌러볼 수 있고, 시간이 지나면 자동으로 로그아웃돼요.", "확인했어요");
  }
  function endSession() {
    if (ended) return; ended = true;
    try { sessionStorage.removeItem(START_KEY); } catch (e) {}
    popup("test-sandbox-end", "fa-hourglass-end", "sandbox", "시험 시간이 끝났어요",
      "5분이 지나서 자동으로 로그아웃돼요.<br>다시 써 보려면 test 로 다시 로그인하세요.", "확인", function () {});
    setTimeout(function () {
      if (typeof handleLogout === "function") handleLogout();
      else { window.__appLoggingOut = true; try { sessionStorage.removeItem("warehouse_current_user"); } catch (e) {} location.reload(); }
    }, 2500);
  }
  function fmtLeft(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  function banner() {
    var b = document.getElementById("test-sandbox-banner");
    if (ended) { if (b) b.innerHTML = '<i class="fa-solid fa-hourglass-end"></i> 시험 시간이 끝났어요 · 로그아웃 중…'; return; }
    if (isTest()) {
      if (!b) {
        b = document.createElement("div"); b.id = "test-sandbox-banner";
        document.body.insertBefore(b, document.body.firstChild);
      }
      var left = LIMIT_MS - (Date.now() - startTime());
      b.innerHTML = '<i class="fa-solid fa-flask"></i> 시험 모드 · 저장 안 됨 · 남은 시간 <b>' + fmtLeft(left) + '</b>';
      b.classList.toggle("ending", left <= 60000);
      document.body.classList.add("test-sandbox");
      if (left <= 0) endSession();
    } else if (b) { b.remove(); document.body.classList.remove("test-sandbox"); }
  }
  // 시험 모드에서는 기기 저장소(캐시)에도 데이터를 남기지 않음 → 다른 사람이 같은 기기로 로그인해도 섞이지 않음
  var DATA_KEYS = ["warehouse_history_logs", "warehouse_master_catalog", "warehouse_cycle_counts", "warehouse_mfaq_logs", "warehouse_order_logs",
                   "warehouse_order_requests", "warehouse_stock_audits", "warehouse_store_inbound_logs", "warehouse_notice_board_logs", "warehouse_mfaq_categories", "warehouse_visitor_stats"];
  try {
    var origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (this === window.localStorage && isTest() && DATA_KEYS.indexOf(k) !== -1) return; return origSet.call(this, k, v); };
  } catch (e) {}

  var tries = 0, t = setInterval(function () { tries++; if (patch() || tries > 200) clearInterval(t); }, 50);
  patch();
  setInterval(banner, 1000);   // 1초마다 남은 시간 갱신
})();

// ===== 로그인 만료 감지: 서버 로그인이 끊겼는데 화면은 로그인된 것처럼 보이는 상태 방지 =====
// (예: 같은 아이디로 다른 곳에서 로그아웃 → 저장이 조용히 실패하던 문제)
(function () {
  "use strict";
  var shown = false;
  function loggedInUi() { try { return !!(window.currentUser || sessionStorage.getItem("warehouse_current_user")); } catch (e) { return !!window.currentUser; } }
  function showExpired() {
    if (shown || window.__appLoggingOut || !loggedInUi()) return;
    shown = true;
    var el = document.createElement("div");
    el.id = "auth-expired"; el.className = "tb-sheet-backdrop active";
    el.style.alignItems = "center"; el.style.padding = "16px"; el.style.zIndex = "100001";
    el.innerHTML = '<div class="auth-exp-card"><div class="auth-exp-icon"><i class="fa-solid fa-user-lock"></i></div>' +
      '<div class="auth-exp-title">로그인이 만료됐어요</div>' +
      '<div class="auth-exp-desc">같은 아이디로 다른 곳에서 로그아웃했거나 오래 켜 두어서 로그인이 끊겼어요.<br>지금은 저장이 안 되니 다시 로그인해 주세요.</div>' +
      '<button type="button" class="auth-exp-btn">다시 로그인</button></div>';
    el.querySelector(".auth-exp-btn").addEventListener("click", function () {
      try { sessionStorage.removeItem("warehouse_current_user"); } catch (e) {}
      location.reload();
    });
    document.body.appendChild(el);
  }
  window.showAuthExpired = showExpired;
  function bind() {
    var c; try { c = typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { c = null; }
    if (!c || !c.auth || c.__authWatch) return !!(c && c.__authWatch);
    c.__authWatch = true;
    c.auth.onAuthStateChange(function (event, session) {
      if (event === "SIGNED_OUT" || (!session && event !== "INITIAL_SESSION")) setTimeout(showExpired, 300);
    });
    // 탭을 다시 볼 때도 확인
    document.addEventListener("visibilitychange", async function () {
      if (document.hidden || !loggedInUi() || window.__appLoggingOut) return;
      try { var r = await c.auth.getSession(); if (!r || !r.data || !r.data.session) showExpired(); } catch (e) {}
    });
    return true;
  }
  var n = 0, t = setInterval(function () { n++; if (bind() || n > 100) clearInterval(t); }, 100);
})();

// ===== 새 버전 자동 적용: 사이트에 새 파일이 올라오면 열어둔 화면도 자동으로 새로고침 =====
// · 2분마다(그리고 앱으로 돌아올 때) index.html 을 다시 받아 파일 버전(?v=…)이 바뀌었는지 확인
// · 바뀌었으면 위쪽에 "새 버전" 알림 → 입력 중이 아니면 10초 뒤 자동 새로고침
// · 입력 창/팝업이 열려 있거나, 입력칸에 쓰는 중이거나, 담아 둔 목록이 있으면 기다렸다가 적용
(function () {
  "use strict";
  var CHECK_MS = 120000, WAIT_S = 10;
  var pending = false, countdown = null, left = 0, checking = false;

  function sig(list) { return list.map(function (u) { return String(u).replace(/^.*\//, ""); }).filter(function (u) { return /\?v=/.test(u); }).sort().join("|"); }
  function currentSig() {
    var arr = [];
    Array.prototype.forEach.call(document.querySelectorAll('script[src*="?v="], link[rel="stylesheet"][href*="?v="]'), function (el) { arr.push(el.getAttribute("src") || el.getAttribute("href")); });
    return sig(arr);
  }
  var mine = null;

  function busy() {
    try {
      var ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.type !== "checkbox" && ae.type !== "radio") return true;
      if (document.querySelector(".tb-sheet-backdrop.active")) return true;
      var modals = document.querySelectorAll(".modal-backdrop, .modal");
      for (var i = 0; i < modals.length; i++) { var m = modals[i]; if (m.offsetParent !== null && getComputedStyle(m).display !== "none" && getComputedStyle(m).visibility !== "hidden") return true; }
      if (typeof regCartList !== "undefined" && Array.isArray(regCartList) && regCartList.length) return true;
      if (Array.isArray(window.storeInboundCart) && window.storeInboundCart.length) return true;
      var a = document.getElementById("reg-artno"), q = document.getElementById("reg-qty");
      if ((a && a.value.trim()) || (q && q.value.trim())) return true;
      if (document.body.classList.contains("tb-sheet-open")) return true;
    } catch (e) {}
    return false;
  }

  function bar() {
    var b = document.getElementById("app-update-bar");
    if (!b) {
      b = document.createElement("div"); b.id = "app-update-bar";
      b.innerHTML = '<i class="fa-solid fa-rotate"></i><span id="app-update-text">새 버전이 있어요</span><button type="button" id="app-update-btn">지금 새로고침</button>';
      document.body.appendChild(b);
      b.querySelector("#app-update-btn").onclick = reload;
    }
    return b;
  }
  function setText(t) { var el = document.getElementById("app-update-text"); if (el) el.textContent = t; }
  function reload() { try { window.__appLoggingOut = true; } catch (e) {} location.reload(); }

  function tick() {
    if (!pending) return;
    if (busy()) { left = WAIT_S; setText("새 버전이 있어요 · 입력이 끝나면 자동으로 새로고침돼요"); return; }
    left--;
    if (left <= 0) { clearInterval(countdown); reload(); return; }
    setText("새 버전이 있어요 · " + left + "초 뒤 자동 새로고침");
  }

  async function check() {
    if (checking || pending || document.hidden) return;
    checking = true;
    try {
      var url = location.pathname.replace(/[^\/]*$/, "") + "index.html?_=" + Date.now();
      var res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        var html = await res.text(), arr = [], re = /(?:src|href)\s*=\s*"([^"]+\?v=[^"]+)"/g, m;
        while ((m = re.exec(html))) arr.push(m[1]);
        var remote = sig(arr);
        if (mine === null) mine = currentSig();
        if (remote && mine && remote !== mine) {
          pending = true; left = WAIT_S;
          bar().classList.add("show");
          tick(); countdown = setInterval(tick, 1000);
        }
      }
    } catch (e) { /* 오프라인 등은 다음에 다시 */ }
    checking = false;
  }

  function init() {
    mine = currentSig();
    setTimeout(check, 30000);
    setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
  }
  window.AppUpdate = { check: check };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

// ===== 방문자수: 들어올 때마다 1번씩 셈 (같은 사람이 여러 번 들어와도 포함) · 오늘 = 오늘 방문 횟수, 누적 = 전체 방문 횟수 =====
// · 앱을 새로 열고 로그인할 때마다 1번 (같은 창에서 새로고침·자동 업데이트는 세지 않음)
// 서버 함수 record_visit / visitor_stats 사용 (DB설정/13_방문자수.sql). test 계정은 세지 않음.
(function () {
  "use strict";
  var KEY = "warehouse_visitor_stats_v2", recordedFor = "", subscribed = false, busy = false;
  function me() { try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || "").trim(); } catch (e) { return ""; } }
  function client() { try { return typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { return null; } }
  function kstToday() { var d = new Date(Date.now() + 9 * 3600000); return d.toISOString().slice(0, 10); }
  function show(today, total) {
    var t = today == null ? "-" : Number(today).toLocaleString(), a = total == null ? "-" : Number(total).toLocaleString();
    document.querySelectorAll(".val-visitor-today").forEach(function (el) { el.textContent = t; });
    document.querySelectorAll(".val-visitor-total").forEach(function (el) { el.textContent = a; });
  }
  function cached() {
    try { var c = JSON.parse(localStorage.getItem(KEY) || "null"); if (c && c.date === kstToday()) return c; } catch (e) {}
    return null;
  }
  function apply(d) {
    if (!d || typeof d.today !== "number") return;
    show(d.today, d.total);
    try { localStorage.setItem(KEY, JSON.stringify({ today: d.today, total: d.total, date: kstToday() })); } catch (e) {}
  }
  async function refresh() {
    var c = client(); if (!c) return;
    try { var r = await c.rpc("visitor_stats"); if (!r.error) apply(r.data); } catch (e) {}
  }
  async function run() {
    var c0 = cached(); if (c0) show(c0.today, c0.total); else show(null, null);
    var c = client(), id = me().toLowerCase();
    if (!c || !id || busy) return;
    busy = true;
    try {
      var key = id + "|" + kstToday(), sKey = "visit_counted_" + key, counted = false;
      try { counted = sessionStorage.getItem(sKey) === "1"; } catch (e) {}
      var r = (recordedFor === key || counted) ? await c.rpc("visitor_stats") : await c.rpc("record_visit");
      if (!r.error) { recordedFor = key; try { sessionStorage.setItem(sKey, "1"); } catch (e) {} apply(r.data); }
    } catch (e) { /* 다음에 다시 */ }
    busy = false;
    if (!subscribed) {
      subscribed = true;
      try { c.channel("public:visit_events").on("postgres_changes", { event: "INSERT", schema: "public", table: "visit_events" }, function () { refresh(); }).subscribe(); } catch (e) {}
    }
  }
  window.initVisitorCounter = run;          // 예전 방식(세션마다 +1, 시작값 1425)을 대체
  // 로그인되면 한 번 기록 · 아이디가 바뀌거나 날짜가 바뀌면 다시 기록
  setInterval(function () { var id = me().toLowerCase(); if (id && client() && recordedFor !== id + "|" + kstToday()) run(); }, 3000);
  setInterval(function () { if (!document.hidden && me()) refresh(); }, 300000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();

// ===== 입출고 저장이 서버에서 거절되면(예: 재고 부족) 화면을 서버 기준으로 바로 되돌림 =====
// · 서버(DB설정/14_마이너스재고_방지.sql)가 재고보다 많은 출고를 거절함
// · 일부 화면은 화면에 먼저 반영하고 서버에 저장하므로, 거절되면 화면에만 '유령 기록'이 남을 수 있음 → 최신 데이터로 다시 불러와 정리
(function () {
  "use strict";
  var lastToast = 0, reloading = false;
  function onFail(err) {
    var msg = String((err && (err.message || err.details)) || err || "");
    if (Date.now() - lastToast > 1500) {
      lastToast = Date.now();
      if (typeof showToast === "function") showToast((/재고 부족|마이너스/.test(msg) ? "⛔ " + msg : "저장이 거절됐어요: " + msg) + " · 최신 데이터로 다시 불러올게요.", "danger");
    }
    if (reloading) return; reloading = true;
    setTimeout(async function () {
      try { if (typeof window.refreshAppRealtime === "function") await window.refreshAppRealtime(); } catch (e) {}
      reloading = false;
    }, 600);
  }
  function hook(builder) {
    if (!builder || typeof builder.then !== "function" || builder.__invHooked) return builder;
    builder.__invHooked = true;
    var t = builder.then.bind(builder);
    builder.then = function (res, rej) {
      return t(function (r) { if (r && r.error) onFail(r.error); return r; }).then(res, rej);
    };
    return builder;
  }
  function wrap() {
    var c; try { c = typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { c = null; }
    if (!c || !c.from || c.from.__invGuard) return;
    var orig = c.from.bind(c);
    var f = function (table) {
      var qb = orig(table);
      if (table !== "inventory_logs" || !qb) return qb;
      ["insert", "update", "delete", "upsert"].forEach(function (m) {
        if (typeof qb[m] !== "function") return;
        var fn = qb[m];
        qb[m] = function () { return hook(fn.apply(qb, arguments)); };
      });
      return qb;
    };
    f.__invGuard = true;
    c.from = f;
  }
  wrap();
  setInterval(wrap, 2000);
})();

// ===== 새 스캐너(QR/디지털 링크) 지원: 스캔 결과가 주소로 들어와도 아티클 번호 8자리만 남김 =====
// 예) https://www.ikea.com/kr/240/00455081197209?13=250713  → 00455081
//     한글 자판 상태에서 찍히면 "ㅗㅅ센://ㅈㅈㅈ.해새.ㅑㅏㄷㅁ.채ㅡ/240/00455081197209?13=250713" 처럼 들어와도 같은 결과
// · "/240/" 뒤 8자리가 들어오는 순간 바로 번호로 바꿔서 조회 (나머지 글자를 기다리지 않음)
// · 그 뒤에 이어서 들어오는 나머지 글자는 버리고, 스캐너의 엔터는 그대로 진행
// · 주소가 들어오는 중간 글자로는 다른 기능이 반응하지 않게 막음 (엉뚱한 번호로 조회·담기 방지)
(function () {
  "use strict";
  var pending = new WeakMap(), swallow = new WeakMap(), PASS = false;
  function isTextInput(el) { return el && el.tagName === "INPUT" && /^(text|search|tel|)$/i.test(el.type || "text"); }
  function looksLikeLink(v) { return /:\/\/|\/240\//.test(v); }
  function extract(v) {
    var m = v.match(/\/240\/(\d{8})/);            // IKEA 디지털 링크: /240/ 뒤 앞 8자리 = 아티클 번호
    if (m) return m[1];
    var d = v.replace(/\D/g, "");
    if (looksLikeLink(v) && d.length >= 14) return d.slice(0, 8);
    var m2 = v.match(/^\s*(\d{14})(?:\D.*)?$/);
    if (m2) return m2[1].slice(0, 8);
    return null;
  }
  function fire(el) {
    PASS = true;
    try { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } finally { PASS = false; }
  }
  // 번호로 바꾼 뒤: 스캐너의 엔터가 오면 그때 한 번만 넘겨줌 (엔터와 자동 담기가 겹쳐 2번 담기는 것 방지)
  // 엔터가 안 오는 스캐너면 0.3초 뒤 넘겨줌
  function apply(el, art) {
    el.value = art;
    var st = swallow.get(el); if (st) { clearTimeout(st.t); clearTimeout(st.c); }
    st = { art: art, fired: false };
    st.c = setTimeout(function () { if (!st.fired) { st.fired = true; fire(el); } }, 300);
    st.t = setTimeout(function () { swallow.delete(el); }, 700);
    swallow.set(el, st);
  }
  function finalize(el) {
    var st = pending.get(el); if (!st) return null;
    clearTimeout(st.t); pending.delete(el);
    var art = extract(el.value || "");
    if (art) apply(el, art);
    return art;
  }
  // 나머지 글자 입력 자체를 막음 (스캐너가 보내는 키 입력)
  document.addEventListener("keydown", function (e) {
    var el = e.target; if (!isTextInput(el)) return;
    var sw = swallow.get(el);
    if (e.key === "Enter") {
      if (pending.has(el)) finalize(el);      // 아직 번호로 안 바뀌었으면 먼저 바꿈
      var s2 = swallow.get(el);
      if (s2) { clearTimeout(s2.c); clearTimeout(s2.t); if (!s2.fired) { s2.fired = true; el.value = s2.art; fire(el); } swallow.delete(el); }
      return;                                 // 엔터는 그대로 진행 (기존 조회/담기 동작)
    }
    if (sw && e.key && (e.key.length === 1 || e.key === "Process")) {   // 번호를 찾은 뒤 이어지는 글자는 버림
      e.preventDefault(); e.stopImmediatePropagation();
      clearTimeout(sw.t); sw.t = setTimeout(function () { swallow.delete(el); }, 700);
    }
  }, true);
  document.addEventListener("input", function (e) {
    if (PASS) return;
    var el = e.target; if (!isTextInput(el)) return;
    var sw = swallow.get(el);
    if (sw) {                                  // 혹시 키 입력으로 못 막은 글자가 들어오면 번호만 남김
      e.stopImmediatePropagation();
      if (el.value !== sw.art) el.value = sw.art;
      clearTimeout(sw.t); sw.t = setTimeout(function () { swallow.delete(el); }, 700);
      return;
    }
    var v = el.value || "";
    // 숫자만 14자리로 들어온 경우(예: 00455081197209, 뒤에 ?13=… 가 붙어도) → 앞 8자리 아티클 번호
    var m14 = v.match(/^\s*(\d{14})(?:\D.*)?$/);
    if (m14 && !pending.has(el)) {
      e.stopImmediatePropagation();
      apply(el, m14[1].slice(0, 8));
      return;
    }
    if (!looksLikeLink(v)) { if (pending.has(el)) { clearTimeout(pending.get(el).t); pending.delete(el); } return; }
    e.stopImmediatePropagation();              // 주소가 들어오는 중: 다른 기능에 전달하지 않음
    var m = v.match(/\/240\/(\d{8})/);
    if (m) { pending.set(el, pending.get(el) || {}); finalize(el); return; }   // 8자리 다 들어온 순간 바로 처리
    var st = pending.get(el) || {}; clearTimeout(st.t);
    st.t = setTimeout(function () { finalize(el); }, 150);
    pending.set(el, st);
  }, true);
  window.extractArtFromScan = extract;
})();

// ===== 아티클 박스 수량(MPQ) 보기: 매장 입고 대기 목록의 "?" 버튼 =====
// 데이터: mpq.json (al010_export 의 Z열 MPQ = 박스당 수량). 새 엑셀이 나오면 mpq.json 만 바꾸면 됨
(function () {
  "use strict";
  var data = null, loading = null;
  function pad8(v) { var d = String(v || "").replace(/\D/g, ""); return d && d.length <= 8 ? d.padStart(8, "0") : d; }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) loading = fetch("mpq.json?v=20261017b", { cache: "force-cache" }).then(function (r) { return r.json(); }).then(function (j) { data = j || {}; return data; }).catch(function () { loading = null; return null; });
    return loading;
  }
  function popup(html) {
    var el = document.createElement("div"); el.className = "sc-ask-backdrop";
    el.innerHTML = '<div class="sc-ask mpq-pop" role="dialog" aria-modal="true">' + html + '<button type="button" class="sc-ask-ok">확인</button></div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("show"); });
    function close() { el.remove(); }
    el.querySelector(".sc-ask-ok").onclick = close;
    el.addEventListener("click", function (e) { if (e.target === el) close(); });
  }
  window.showBoxQty = async function (artNo, artName) {
    var k = pad8(artNo), d = await load();
    if (!d) { if (typeof showToast === "function") showToast("박스 수량 정보를 불러오지 못했어요. 잠시 후 다시 눌러 주세요.", "warning"); return; }
    // [Z열 MPQ(멀티박스), AA열 Palq(팔렛)] — Z < AA 면 멀티박스로 들어옴 / Z = AA 면 팔렛으로 들어옴
    var v = d[k], z = 0, aa = 0;
    if (Array.isArray(v)) { z = Number(v[0]) || 0; aa = Number(v[1]) || 0; } else if (v) { z = Number(v) || 0; }
    var head = '<div class="sc-ask-name">' + esc(artName || "") + ' <span>' + esc(k) + '</span></div>', body;
    if (z > 0 && aa > 0 && z < aa) {
      body = '<div class="sc-ask-icon wh"><i class="fa-solid fa-box"></i></div><div class="sc-ask-title">멀티박스 수량</div>' + head +
        '<div class="mpq-big"><b>' + z + '</b>개</div><div class="sc-ask-sub">멀티박스로 들어와요 · 1박스에 ' + z + '개</div>' +
        '<div class="mpq-pal">참고: 1팔렛 ' + aa + '개</div>';
    } else if (z > 0 && aa > 0 && z === aa) {
      body = '<div class="sc-ask-icon pal"><i class="fa-solid fa-pallet"></i></div><div class="sc-ask-title">팔렛 수량</div>' + head +
        '<div class="mpq-big pal"><b>' + aa + '</b>개</div><div class="sc-ask-sub">멀티박스가 아니라 팔렛으로 들어와요 · 1팔렛 ' + aa + '개</div>' +
        '<div class="mpq-input-note"><i class="fa-solid fa-pen"></i> 수량을 입력해주세요.</div>';
    } else {
      body = '<div class="sc-ask-icon"><i class="fa-solid fa-circle-question"></i></div><div class="sc-ask-title">박스 수량</div>' + head +
        '<div class="mpq-none">박스·팔렛 수량 정보가 없어요</div>';
    }
    popup(body);
  };
  // 매장 입고 화면을 열면 미리 불러 둠 (누를 때 기다리지 않게)
  var tab = document.getElementById("tab-store-inbound");
  if (tab) new MutationObserver(function () { if (tab.classList.contains("active")) load(); }).observe(tab, { attributes: true, attributeFilter: ["class"] });
})();
