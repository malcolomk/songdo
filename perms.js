// perms.js — 권한 관리 한 화면 (jipar5, junkoo 전용)
// · 아이디별 [매장 입고] [매장 재고 체크] 권한을 끄기 / 3시간 / 항상 으로 설정
// · 3시간은 다시 누르면 3시간 연장 · 서버(permission_list, *_access 표)와 실시간 동기화
(function () {
  "use strict";

  var MANAGERS = ["jipar5", "junkoo"];
  var KINDS = [
    { key: "si", table: "store_inbound_access", label: "매장 입고", icon: "fa-dolly" },
    { key: "sc", table: "store_check_access", label: "매장 재고 체크", icon: "fa-store" }
  ];
  var state = { list: [], loading: false, q: "" };

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function me() { try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || "").trim(); } catch (e) { return ""; } }
  function isManager() { return MANAGERS.indexOf(me().toLowerCase()) !== -1; }
  function client() { try { return typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { return null; } }
  function toast(m, t) { if (typeof showToast === "function") showToast(m, t || "info"); }
  function nameOf(id) { try { var m = typeof USER_ID_NAMES !== "undefined" ? USER_ID_NAMES : null; return (m && m[String(id).toLowerCase()]) || ""; } catch (e) { return ""; } }
  function leftText(iso) {
    var ms = new Date(iso).getTime() - Date.now(); if (!(ms > 0)) return "";
    var m = Math.ceil(ms / 60000), h = Math.floor(m / 60); m = m % 60;
    return (h ? h + "시간 " : "") + m + "분 남음";
  }
  function modeOf(u, k) {
    if (u[k + "_always"]) return "always";
    if (u[k + "_expires"] && new Date(u[k + "_expires"]).getTime() > Date.now()) return "timed";
    return "off";
  }

  // ---------- 메뉴 바로가기 타일 (관리자만) ----------
  function ensureTile() {
    var grid = document.querySelector("#tab-menu .menu-tile-grid") || document.querySelector(".menu-tile-grid");
    if (!grid) return;
    var t = document.getElementById("menu-tile-perms");
    if (!isManager()) { if (t) t.style.display = "none"; return; }
    if (!t) {
      t = document.createElement("a"); t.id = "menu-tile-perms"; t.className = "menu-tile";
      t.innerHTML = '<div class="menu-tile-icon" style="background:#ecfeff; color:#0e7490;"><i class="fa-solid fa-user-shield"></i></div><span class="menu-tile-text">권한 관리</span>';
      t.addEventListener("click", open);
      grid.appendChild(t);
    }
    t.style.display = "";
  }

  // ---------- 창 ----------
  function ensureSheet() {
    var m = document.getElementById("perm-sheet"); if (m) return m;
    m = document.createElement("div"); m.id = "perm-sheet"; m.className = "tb-sheet-backdrop";
    m.innerHTML = '<div class="tb-sheet perm-sheet-box" role="dialog" aria-modal="true">' +
      '<div class="tb-sheet-top"><span class="tb-sheet-step perm-step"><i class="fa-solid fa-user-shield"></i> 권한 관리</span><button type="button" class="tb-sheet-close" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="tb-sheet-scroll"><div class="perm-help"><b>3시간</b>: 켜고 3시간 뒤 자동으로 꺼져요 (다시 누르면 3시간 연장). <b>항상</b>: 끌 때까지 계속 가능해요. jipar5, junkoo는 항상 가능해요.</div>' +
      '<div class="perm-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" id="perm-q" placeholder="이름 또는 아이디 검색"></div>' +
      '<div id="perm-summary" class="perm-summary"></div><div id="perm-list"></div></div></div>';
    m.addEventListener("click", function (e) { if (e.target === m || e.target.closest(".tb-sheet-close")) close(); });
    document.body.appendChild(m);
    m.querySelector("#perm-q").addEventListener("input", function (e) { state.q = e.target.value.trim().toLowerCase(); render(); });
    m.querySelector("#perm-list").addEventListener("click", onClick);
    return m;
  }
  async function open() {
    if (!isManager()) { toast("권한 관리는 jipar5, junkoo만 할 수 있어요.", "warning"); return; }
    ensureSheet().classList.add("active"); document.body.classList.add("tb-sheet-open");
    document.getElementById("perm-list").innerHTML = '<div class="tb-empty">불러오는 중…</div>';
    await load();
  }
  function close() { var m = document.getElementById("perm-sheet"); if (m) m.classList.remove("active"); document.body.classList.remove("tb-sheet-open"); }
  function isOpen() { var m = document.getElementById("perm-sheet"); return !!(m && m.classList.contains("active")); }

  async function load() {
    var c = client(); if (!c || state.loading) return;
    state.loading = true;
    try {
      var r = await c.rpc("permission_list");
      if (r.error) throw r.error;
      state.list = (r.data || []).filter(function (u) { return u.app_role !== "viewer" && String(u.login_id).toLowerCase() !== "test"; });
      render();
    } catch (e) {
      var msg = String((e && e.message) || e);
      document.getElementById("perm-list").innerHTML = '<div class="tb-empty">목록을 불러오지 못했어요.<br><small>' +
        (/permission_list|schema cache|does not exist|404/i.test(msg) ? "DB 설정(19_권한관리_한화면.sql)을 먼저 실행해 주세요." : esc(msg)) + '</small></div>';
    } finally { state.loading = false; }
  }

  function render() {
    var box = document.getElementById("perm-list"); if (!box) return;
    var list = state.list.filter(function (u) {
      if (!state.q) return true;
      return String(u.login_id).toLowerCase().indexOf(state.q) !== -1 || nameOf(u.login_id).indexOf(state.q) !== -1;
    });
    var sum = KINDS.map(function (k) {
      var n = state.list.filter(function (u) { return MANAGERS.indexOf(String(u.login_id).toLowerCase()) !== -1 || modeOf(u, k.key) !== "off"; }).length;
      return '<span><i class="fa-solid ' + k.icon + '"></i> ' + k.label + ' <b>' + n + '</b>명</span>';
    }).join("");
    document.getElementById("perm-summary").innerHTML = sum;
    if (!list.length) { box.innerHTML = '<div class="tb-empty">검색 결과가 없어요.</div>'; return; }
    box.innerHTML = list.map(function (u) {
      var id = String(u.login_id), mgr = MANAGERS.indexOf(id.toLowerCase()) !== -1, nm = nameOf(id);
      var rows = KINDS.map(function (k) {
        if (mgr) return '<div class="perm-kind"><span class="perm-kind-label"><i class="fa-solid ' + k.icon + '"></i> ' + k.label + '</span><span class="perm-fixed">관리자 · 항상</span></div>';
        var mode = modeOf(u, k.key), left = mode === "timed" ? leftText(u[k.key + "_expires"]) : "";
        function seg(m, label) { return '<button type="button" class="perm-seg ' + m + (mode === m ? " on" : "") + '" data-id="' + esc(id) + '" data-k="' + k.key + '" data-m="' + m + '">' + label + '</button>'; }
        return '<div class="perm-kind"><span class="perm-kind-label"><i class="fa-solid ' + k.icon + '"></i> ' + k.label +
          (left ? '<small class="perm-left">' + esc(left) + '</small>' : '') + '</span>' +
          '<div class="perm-segs">' + seg("off", "끄기") + seg("timed", mode === "timed" ? "3시간 연장" : "3시간") + seg("always", "항상") + '</div></div>';
      }).join("");
      var any = mgr || KINDS.some(function (k) { return modeOf(u, k.key) !== "off"; });
      return '<div class="perm-row' + (any ? " on" : "") + '"><div class="perm-who"><b>' + esc(nm || id) + '</b>' + (nm ? '<span class="perm-id">' + esc(id) + '</span>' : '') +
        (mgr ? '<span class="si-tag">관리자</span>' : u.app_role === "admin" ? '<span class="si-tag gray">admin</span>' : '') + '</div>' + rows + '</div>';
    }).join("");
  }

  async function onClick(e) {
    var b = e.target.closest(".perm-seg"); if (!b || b.disabled) return;
    var id = b.dataset.id, kind = KINDS.find(function (k) { return k.key === b.dataset.k; }), m = b.dataset.m;
    var u = state.list.find(function (x) { return x.login_id === id; }); if (!u || !kind) return;
    var cur = modeOf(u, kind.key);
    if (cur === m && m !== "timed") return;
    var c = client(); if (!c || !isManager()) return;
    b.closest(".perm-segs").querySelectorAll("button").forEach(function (x) { x.disabled = true; });
    var row = { login_id: id, updated_by: me(), enabled: m === "timed", always: m === "always" };
    var r = await c.from(kind.table).upsert([row], { onConflict: "login_id" });
    if (r.error) { toast("권한 변경 실패: " + r.error.message, "danger"); render(); return; }
    var who = (nameOf(id) || id);
    toast(who + " · " + kind.label + " " + (m === "off" ? "껐어요" : m === "always" ? "항상 가능으로 바꿨어요" : cur === "timed" ? "3시간 연장했어요" : "켰어요 (3시간)"), m === "off" ? "info" : "success");
    await load();
    try { if (window.StoreInboundAccess) window.StoreInboundAccess.check(); } catch (e2) {}
  }

  // ---------- 시작 ----------
  function init() {
    var tries = 0, boot = setInterval(function () {
      tries++;
      ensureTile();
      if (client() && me()) {
        clearInterval(boot); ensureTile();
        KINDS.forEach(function (k) {
          try { client().channel("perm:" + k.table).on("postgres_changes", { event: "*", schema: "public", table: k.table }, function () { if (isOpen()) load(); }).subscribe(); } catch (e) {}
        });
      } else if (tries > 120) clearInterval(boot);
    }, 1000);
    // 로그인 아이디가 바뀌면 타일 다시 판단 · 열려 있으면 남은 시간 갱신
    setInterval(function () { ensureTile(); if (isOpen() && !document.hidden) render(); }, 30000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) ensureTile(); });
  }
  window.PermAdmin = { open: open, close: close, reload: load };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
