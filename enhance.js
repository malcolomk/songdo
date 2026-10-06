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

    // 2) Cycle Counting: 오늘 점검한 품목 수 (같은 기록이 여러 품번 형식으로 저장되므로 중복 제거)
    try {
      var recs = window.cycleCountRecords || {};
      var seen = new Set();
      Object.keys(recs).forEach(function (k) {
        var r = recs[k];
        if (r && r.checkedDate === today) seen.add(String(r.cleanNo || r.artNo || k));
      });
      var done = Math.min(seen.size, 5);
      var isDone = seen.size >= 5;
      setText("menu-task-cycle-count", seen.size + "/5");
      setText("menu-task-cycle-sub", isDone ? "오늘 실사 완료 👍" : ("오늘의 5개 랜덤 실사 · " + (5 - done) + "개 남음"));
      var bar = document.getElementById("menu-task-cycle-bar");
      if (bar) { bar.style.width = (done / 5 * 100) + "%"; bar.classList.toggle("done", isDone); }
      var cc = document.getElementById("menu-task-cycle-count");
      if (cc) cc.classList.toggle("done", isDone);
    } catch (e) {}

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
