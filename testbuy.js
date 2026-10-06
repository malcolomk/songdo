// testbuy.js — Test Buy: 매장 전시품이 실제로 전시되어 있는지 점검하고 기록합니다.
// 저장 위치: Supabase test_buy_checks 테이블 (로그인한 직원만 접근, Viewer는 조회만)
(function () {
  "use strict";

  var TABLE = "test_buy_checks";
  // 개발 중: 메뉴에서는 안내 창만 뜨고, 대시보드 요약·자동 불러오기는 하지 않습니다. 오픈할 때 true로 바꾸세요.
  var ENABLED = false;
  var STATUS = {
    displayed: { label: "전시됨", cls: "ok", icon: "fa-circle-check" },
    not_displayed: { label: "미전시", cls: "no", icon: "fa-circle-xmark" },
    issue: { label: "파손·이상", cls: "warn", icon: "fa-triangle-exclamation" }
  };

  var state = {
    logs: [],          // 최근 90일 점검 기록 (최신순)
    loaded: false,
    loading: false,
    filter: "today",   // today | open | all
    picked: null,      // { artNo, artName }
    status: null
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function today() {
    if (typeof window.getTodayDateString === "function") return window.getTodayDateString();
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function daysAgo(n) {
    var d = new Date(); d.setDate(d.getDate() - n);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function me() {
    try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || "").trim(); } catch (e) { return ""; }
  }
  function isViewer() { try { return typeof isViewerUser !== "undefined" && isViewerUser; } catch (e) { return false; } }
  function isAdmin() { try { return typeof isAdminUser !== "undefined" && isAdminUser; } catch (e) { return false; } }
  function client() { try { return typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { return null; } }
  function toast(msg, type) { if (typeof showToast === "function") showToast(msg, type || "success"); }
  function normNo(v) { return String(v || "").replace(/\D/g, ""); }

  // 품번별 최신 점검 결과 → 아직 해결되지 않은(미전시·이상) 품목
  function openItems() {
    var latest = new Map();
    state.logs.forEach(function (r) {           // logs는 최신순
      var k = normNo(r.artno) || r.artno;
      if (!latest.has(k)) latest.set(k, r);
    });
    var out = [];
    latest.forEach(function (r) { if (r.status !== "displayed") out.push(r); });
    return out;
  }

  async function load(force) {
    var c = client();
    if (!c || state.loading) return;
    if (state.loaded && !force) { render(); return; }
    state.loading = true;
    try {
      var res = await c.from(TABLE).select("*").gte("check_date", daysAgo(90))
        .order("id", { ascending: false }).limit(3000);
      if (res.error) throw res.error;
      state.logs = res.data || [];
      state.loaded = true;
    } catch (err) {
      console.warn("Test Buy load error:", err);
      if (force) toast("Test Buy 기록을 불러오지 못했습니다. 로그인 상태를 확인해 주세요.", "danger");
    } finally {
      state.loading = false;
    }
    render();
    updateDashboard();
  }

  function updateDashboard() {
    if (!ENABLED) return;
    var t = today();
    var todayCnt = state.logs.filter(function (r) { return r.check_date === t; }).length;
    var open = openItems().length;
    var sub = document.getElementById("menu-task-testbuy-sub");
    if (sub) {
      if (!state.loaded) sub.textContent = "매장 전시품 전시 여부 점검";
      else sub.textContent = "오늘 " + todayCnt + "건 점검" + (open > 0 ? " · 미전시·이상 " + open + "건" : " · 모두 정상");
    }
    var badge = document.getElementById("badge-testbuy");
    if (badge) {
      badge.textContent = open;
      badge.style.display = open > 0 ? "inline-block" : "none";
    }
  }

  // ---------- 품목 검색 ----------
  function onArtInput() {
    var input = document.getElementById("tb-artno");
    var box = document.getElementById("tb-suggest");
    if (!input || !box) return;
    state.picked = null;
    document.getElementById("tb-picked").style.display = "none";
    var q = input.value.trim().toLowerCase();
    if (q.length < 2) { box.innerHTML = ""; return; }
    var qd = q.replace(/\D/g, "");
    var cat = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
    var hits = [];
    for (var i = 0; i < cat.length && hits.length < 8; i++) {
      var m = cat[i];
      var no = String(m.artNo || m.artno || "");
      var name = String(m.artName || m.artname || "");
      if ((qd.length >= 3 && normNo(no).indexOf(qd) !== -1) || name.toLowerCase().indexOf(q) !== -1) hits.push({ artNo: no, artName: name });
    }
    var html = hits.map(function (h, idx) {
      return '<button type="button" class="tb-sug" data-idx="' + idx + '"><b>' + esc(h.artNo) + '</b> ' + esc(h.artName) + '</button>';
    }).join("");
    if (qd.length >= 5) {
      html += '<button type="button" class="tb-sug tb-sug-manual" data-manual="1">“' + esc(input.value.trim()) + '” 품번으로 직접 입력</button>';
    }
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll(".tb-sug"), function (btn) {
      btn.onclick = function () {
        if (btn.dataset.manual) pick({ artNo: input.value.trim(), artName: "" });
        else pick(hits[Number(btn.dataset.idx)]);
      };
    });
  }

  function pick(item) {
    state.picked = item;
    var input = document.getElementById("tb-artno");
    var box = document.getElementById("tb-suggest");
    var pk = document.getElementById("tb-picked");
    if (box) box.innerHTML = "";
    if (input) input.value = item.artNo;
    // 최근 점검 이력 1건
    var k = normNo(item.artNo);
    var last = state.logs.find(function (r) { return normNo(r.artno) === k; });
    if (pk) {
      pk.style.display = "";
      pk.innerHTML = '<div><b>' + esc(item.artName || "(품명 없음)") + '</b><span>' + esc(item.artNo) + '</span></div>' +
        (last ? '<div class="tb-last">최근 점검: ' + esc(last.check_date.slice(5)) + ' ' + esc((STATUS[last.status] || {}).label || last.status) +
          (last.area ? ' · ' + esc(last.area) : '') + '</div>' : '<div class="tb-last">첫 점검 품목</div>');
      if (last && last.area) {
        var area = document.getElementById("tb-area");
        if (area && !area.value) area.value = last.area;
      }
    }
  }

  function pickStatus(st) {
    state.status = st;
    Array.prototype.forEach.call(document.querySelectorAll(".tb-status"), function (b) {
      b.classList.toggle("active", b.dataset.status === st);
    });
  }

  async function submit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (isViewer()) { toast("Viewer(읽기 전용) 계정은 등록할 수 없습니다.", "warning"); return; }
    var input = document.getElementById("tb-artno");
    var raw = input ? input.value.trim() : "";
    if (!state.picked && raw) {
      // 목록에서 고르지 않았으면 품번 정확히 일치하는 품목을 찾아봄
      var cat = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
      var d = normNo(raw);
      var m = d ? cat.find(function (x) { return normNo(x.artNo || x.artno) === d || normNo(x.artNo || x.artno) === d.padStart(8, "0"); }) : null;
      if (m) state.picked = { artNo: m.artNo || m.artno, artName: m.artName || m.artname || "" };
      else if (d.length >= 5) state.picked = { artNo: raw, artName: "" };
    }
    if (!state.picked) { toast("점검할 품목을 선택해 주세요.", "danger"); if (input) input.focus(); return; }
    if (!state.status) { toast("전시 상태(전시됨 / 미전시 / 파손·이상)를 선택해 주세요.", "danger"); return; }
    var c = client();
    if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }

    var areaEl = document.getElementById("tb-area");
    var memoEl = document.getElementById("tb-memo");
    var row = {
      check_date: today(),
      artno: String(state.picked.artNo),
      artname: state.picked.artName || null,
      area: areaEl && areaEl.value.trim() ? areaEl.value.trim() : null,
      status: state.status,
      memo: memoEl && memoEl.value.trim() ? memoEl.value.trim() : null,
      user: me() || null
    };
    var btn = document.getElementById("tb-submit");
    if (btn) btn.disabled = true;
    try {
      var res = await c.from(TABLE).insert([row]).select();
      if (res.error) throw res.error;
      if (res.data && res.data[0]) state.logs.unshift(res.data[0]);
      toast("[" + row.artno + "] " + STATUS[row.status].label + " 으로 저장했습니다.", row.status === "displayed" ? "success" : "warning");
      // 다음 품목 입력 준비 (매장 위치는 유지 — 같은 구역을 연달아 점검하는 경우가 많음)
      state.picked = null; pickStatus(null);
      if (input) { input.value = ""; input.focus(); }
      if (memoEl) memoEl.value = "";
      document.getElementById("tb-picked").style.display = "none";
      render(); updateDashboard();
    } catch (err) {
      toast("저장 실패: " + (err.message || err), "danger");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // 목록에서 바로 "전시 확인" (미전시 → 전시됨으로 다시 점검)
  async function quickResolve(id) {
    var r = state.logs.find(function (x) { return x.id === id; });
    if (!r) return;
    pick({ artNo: r.artno, artName: r.artname || "" });
    var area = document.getElementById("tb-area");
    if (area) area.value = r.area || "";
    pickStatus("displayed");
    var form = document.getElementById("tb-form");
    if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
    toast("전시 확인 후 '점검 결과 저장'을 눌러 주세요.", "info");
  }

  async function remove(id) {
    var r = state.logs.find(function (x) { return x.id === id; });
    if (!r) return;
    if (!confirm("[" + r.artno + "] " + r.check_date + " 점검 기록을 삭제할까요?")) return;
    var c = client();
    try {
      var res = await c.from(TABLE).delete().eq("id", id).select();
      if (res.error) throw res.error;
      if (!res.data || res.data.length === 0) { toast("삭제 권한이 없습니다. (관리자 또는 본인 기록만 삭제 가능)", "warning"); return; }
      state.logs = state.logs.filter(function (x) { return x.id !== id; });
      render(); updateDashboard();
      toast("삭제했습니다.", "success");
    } catch (err) {
      toast("삭제 실패: " + (err.message || err), "danger");
    }
  }

  function setFilter(f) { state.filter = f; render(); }

  function render() {
    var list = document.getElementById("tb-list");
    if (!list) return;
    var t = today();
    var open = openItems();
    var todayRows = state.logs.filter(function (r) { return r.check_date === t; });
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set("tb-stat-today", todayRows.length);
    set("tb-stat-open", open.length);
    set("tb-stat-all", state.logs.length);
    Array.prototype.forEach.call(document.querySelectorAll(".tb-stat"), function (b) {
      b.classList.toggle("active", b.dataset.filter === state.filter);
    });
    var titles = { today: "오늘 점검", open: "미전시·이상 (미해결)", all: "최근 90일 전체" };
    set("tb-list-title", titles[state.filter]);

    var rows = state.filter === "today" ? todayRows : state.filter === "open" ? open : state.logs;
    var q = (document.getElementById("tb-search") || {}).value;
    q = (q || "").trim().toLowerCase();
    if (q) rows = rows.filter(function (r) {
      return [r.artno, r.artname, r.area, r.memo, r.user].join(" ").toLowerCase().indexOf(q) !== -1;
    });

    if (!state.loaded) { list.innerHTML = '<div class="tb-empty">' + (state.loading ? "불러오는 중…" : "기록을 불러오려면 새로고침을 눌러 주세요.") + '</div>'; return; }
    if (rows.length === 0) {
      list.innerHTML = '<div class="tb-empty">' + (state.filter === "open" ? "해결 안 된 품목이 없습니다 👍" : "기록이 없습니다.") + '</div>';
      return;
    }
    var my = me().toLowerCase();
    list.innerHTML = rows.slice(0, 300).map(function (r) {
      var st = STATUS[r.status] || { label: r.status, cls: "", icon: "fa-circle" };
      var time = r.created_at ? new Date(r.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "";
      var canDel = !isViewer() && (isAdmin() || (r.user || "").toLowerCase() === my);
      return '<div class="tb-row">' +
        '<span class="tb-chip ' + st.cls + '"><i class="fa-solid ' + st.icon + '"></i>' + esc(st.label) + '</span>' +
        '<div class="tb-row-body">' +
          '<div class="tb-row-title"><b>' + esc(r.artname || "(품명 없음)") + '</b> <span>' + esc(r.artno) + '</span></div>' +
          '<div class="tb-row-meta">' + esc(r.check_date.slice(5)) + ' ' + esc(time) + (r.area ? ' · ' + esc(r.area) : '') + (r.user ? ' · ' + esc(r.user) : '') + '</div>' +
          (r.memo ? '<div class="tb-row-memo">' + esc(r.memo) + '</div>' : '') +
        '</div>' +
        '<div class="tb-row-actions">' +
          (r.status !== "displayed" && !isViewer() ? '<button type="button" class="tb-mini ok" onclick="TestBuy.quickResolve(' + r.id + ')">전시 확인</button>' : '') +
          (canDel ? '<button type="button" class="tb-mini del" onclick="TestBuy.remove(' + r.id + ')" title="삭제"><i class="fa-solid fa-trash"></i></button>' : '') +
        '</div>' +
      '</div>';
    }).join("");

    // 매장 위치 자동완성 목록
    var dl = document.getElementById("tb-area-list");
    if (dl) {
      var areas = Array.from(new Set(state.logs.map(function (r) { return r.area; }).filter(Boolean))).slice(0, 30);
      dl.innerHTML = areas.map(function (a) { return '<option value="' + esc(a) + '">'; }).join("");
    }
  }

  window.TestBuy = {
    load: load, render: render, submit: submit, setFilter: setFilter, pickStatus: pickStatus,
    onArtInput: onArtInput, quickResolve: quickResolve, remove: remove, updateDashboard: updateDashboard
  };

  // 탭을 열면 불러오기, 로그인 후 데이터가 들어오면 대시보드용으로 한 번 불러오기
  function init() {
    if (!ENABLED) return;
    var tab = document.getElementById("tab-testbuy");
    if (tab) {
      new MutationObserver(function () { if (tab.classList.contains("active")) load(true); })
        .observe(tab, { attributes: true, attributeFilter: ["class"] });
    }
    var tries = 0;
    var boot = setInterval(function () {
      tries++;
      var ready = me() && client() && (typeof historyLogs !== "undefined" && historyLogs.length > 0);
      if (ready) { clearInterval(boot); load(false); }
      else if (tries > 90) clearInterval(boot);
    }, 1000);
    // 메뉴 화면에 있을 때 1분마다 갱신
    setInterval(function () {
      var m = document.getElementById("tab-menu");
      if (m && m.classList.contains("active") && !document.hidden && me()) load(true);
    }, 60000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
