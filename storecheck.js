// storecheck.js — 매장 재고 체크: 매장 입고 기록이 있는 아티클 중 랜덤 5개 (FRAKTA/프락타 제외)
// · 매장에 실제 있는 수량을 세어 기록 (0개 = 재고 없음)
// · 시작한 사람만 끝까지 진행 · 동시에 시작해도 품목이 겹치지 않음 · 카드를 왼쪽으로 밀면 교체(개수 미포함)
// · 최근 7일 안에 체크한 아티클은 되도록 배정하지 않음
(function () {
  "use strict";

  var T_CHECKS = "store_check_checks", T_SESSIONS = "store_check_sessions";
  var PER_SESSION = 5;
  var RECENT_DAYS = 7;
  var EXCLUDE_RE = /frakta|프락타/i;   // 프락타(FRAKTA) 제품 제외

  var state = { logs: [], sessions: [], pool: [], poolLoaded: false, loaded: false, loading: false, filter: "none", sheet: null };

  // ---------- 공통 ----------
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function today() { return typeof window.getTodayDateString === "function" ? window.getTodayDateString() : ymd(new Date()); }
  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return ymd(d); }
  function me() { try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || "").trim(); } catch (e) { return ""; } }
  function isViewer() { try { return typeof isViewerUser !== "undefined" && isViewerUser; } catch (e) { return false; } }
  function client() { try { return typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { return null; } }
  function toast(msg, type) { if (typeof showToast === "function") showToast(msg, type || "success"); }
  function normNo(v) { return String(v || "").replace(/\D/g, ""); }
  function pad8(v) { var d = normNo(v); return d && d.length <= 8 ? d.padStart(8, "0") : d; }
  function fmtTime(iso) { if (!iso) return ""; var d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function sameUser(a, b) { return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase() && !!String(a || "").trim(); }
  function isMine(s) { return !!s && sameUser(s.created_by, me()); }
  function thumb(artNo, name, size) {
    return typeof getProductThumbHtml === "function" ? getProductThumbHtml(pad8(artNo), name || "", size)
      : '<div class="tb-thumb-ph" style="width:' + size + 'px;height:' + size + 'px"><i class="fa-solid fa-box"></i></div>';
  }
  function loadThumbs() { if (typeof loadProductThumbnails === "function") { try { loadProductThumbnails(); } catch (e) {} } }
  function catalogName(k) {
    try {
      var cat = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
      var m = cat.find(function (x) { return pad8(x.artNo || x.artno) === k; });
      return (m && (m.artName || m.artname)) || "";
    } catch (e) { return ""; }
  }
  function excluded(name) { return EXCLUDE_RE.test(String(name || "")); }
  // 창고 재고 (입출고 기록 기준) · 창고 위치
  function whStock(artNo) {
    try {
      var k = pad8(artNo), m = typeof buildStockMap === "function" ? buildStockMap() : null, e = m && m.get(k);
      if (!e && m) m.forEach(function (v, key) { if (!e && pad8(key) === k) e = v; });
      return e ? (Number(e.currentStock) || 0) : 0;
    } catch (err) { return 0; }
  }
  function whLocation(artNo) {
    try {
      var k = pad8(artNo), cat = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
      var m = cat.find(function (x) { return pad8(x.artNo || x.artno) === k; });
      return (m && m.location) || "";
    } catch (err) { return ""; }
  }
  function whHtml(artNo, big) {
    var n = whStock(artNo); if (!(n > 0)) return "";
    var loc = whLocation(artNo);
    return big ? '<div class="sc-wh"><i class="fa-solid fa-warehouse"></i><span>창고에 재고가 있어요</span><b>' + n + '개</b>' + (loc && loc !== "미지정" ? '<em>' + esc(loc) + '</em>' : '') + '</div>'
               : ' <span class="sc-wh-chip"><i class="fa-solid fa-warehouse"></i> 창고 ' + n + '개' + (loc && loc !== "미지정" ? ' · ' + esc(loc) : '') + '</span>';
  }

  function checks() { return state.logs.filter(function (r) { return !r.skip_reason; }); }
  function sessionChecks(sid) { return checks().filter(function (r) { return r.session_id === sid; }); }
  function sessionLatest(sid) { var m = new Map(); sessionChecks(sid).forEach(function (r) { var k = pad8(r.artno); if (!m.has(k)) m.set(k, r); }); return m; }
  function sessionDoneCount(sid) { return sessionLatest(sid).size; }
  function activeSession() { return state.sessions.find(function (s) { return s.status === "in_progress" && isMine(s); }) || null; }
  function othersActive() { return state.sessions.filter(function (s) { return s.status === "in_progress" && !isMine(s); }); }

  // ---------- 배정 대상: 매장 입고 기록이 있는 아티클 ----------
  async function loadPool() {
    var map = new Map();
    function add(no, name) {
      var k = pad8(no); if (!/^\d{8}$/.test(k)) return;
      var nm = name || (map.get(k) || {}).artname || "";
      map.set(k, { artno: k, artname: nm });
    }
    try {
      var res = typeof fetchAllRows === "function" ? await fetchAllRows("store_inbound_logs", "id", false)
        : await client().from("store_inbound_logs").select("artno,artname").limit(10000);
      if (res && !res.error && Array.isArray(res.data)) { res.data.forEach(function (r) { add(r.artno || r.artNo, r.artname || r.artName); }); state.poolLoaded = true; }
    } catch (e) { console.warn("매장 재고 체크: 매장 입고 목록을 불러오지 못했습니다", e); }
    try { if (typeof storeInboundLogs !== "undefined" && Array.isArray(storeInboundLogs)) storeInboundLogs.forEach(function (r) { add(r.artNo || r.artno, r.artName || r.artname); }); } catch (e) {}
    var out = [];
    map.forEach(function (v) {
      if (!v.artname) v.artname = catalogName(v.artno);
      if (excluded(v.artname) || excluded(catalogName(v.artno))) return;
      out.push(v);
    });
    state.pool = out;
  }

  function busySet(extra) {
    var set = new Set(extra || []);
    state.sessions.forEach(function (s) { if (s.status === "in_progress") (s.articles || []).forEach(function (x) { set.add(pad8(x.artno)); }); });
    return set;
  }
  function pick(n, extraExclude) {
    var busy = busySet(extraExclude), cut = daysAgo(RECENT_DAYS);
    var recent = new Set(); checks().forEach(function (r) { if (r.check_date >= cut) recent.add(pad8(r.artno)); });
    var fresh = [], fallback = [];
    state.pool.forEach(function (x) {
      if (busy.has(x.artno)) return;
      (recent.has(x.artno) ? fallback : fresh).push({ artno: x.artno, artname: x.artname });
    });
    var out = [];
    [fresh, fallback].forEach(function (pool) {
      while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    });
    return out;
  }


  // ---------- 권한: 관리자(jipar5, junkoo)가 아이디별로 켜고 끔 · 켜면 3시간 (서버에서도 막음) ----------
  var MANAGERS = ["jipar5", "junkoo"];
  var acc = { allowed: null, expires: null, timer: null, list: [] };
  function isManager() { return MANAGERS.indexOf(me().toLowerCase()) !== -1; }
  function leftText(iso) {
    var ms = new Date(iso).getTime() - Date.now(); if (!(ms > 0)) return "만료";
    var m = Math.ceil(ms / 60000), h = Math.floor(m / 60); m = m % 60;
    return (h ? h + "시간 " : "") + m + "분 남음";
  }
  async function checkAccess() {
    if (isManager() || (window.isTestSandbox && window.isTestSandbox())) { acc.allowed = true; acc.expires = null; return true; }
    var c = client(); if (!c || !me()) { acc.allowed = false; return false; }
    try {
      var r = await c.rpc("my_store_check_expiry");
      acc.expires = !r.error && r.data ? r.data : null;
      acc.allowed = !!acc.expires && new Date(acc.expires).getTime() > Date.now();
      if (acc.allowed && new Date(acc.expires).getFullYear() >= 2900) acc.expires = null;   // "항상" 권한
    } catch (e) { acc.allowed = false; acc.expires = null; }
    if (acc.timer) clearTimeout(acc.timer);
    if (acc.allowed && acc.expires) acc.timer = setTimeout(function () { checkAccess().then(function () { render(); }); }, Math.min(new Date(acc.expires).getTime() - Date.now() + 1500, 2147483000));
    return acc.allowed;
  }
  function denied() { toast("매장 재고 체크 권한이 없는 아이디예요. 관리자(jipar5, junkoo)에게 권한을 요청해 주세요.", "warning"); }
  async function needAccess() { if (acc.allowed === true && (!acc.expires || new Date(acc.expires).getTime() > Date.now())) return true; var ok = await checkAccess(); if (!ok) { denied(); render(); } return ok; }
  function accessBarHtml() {
    if (isViewer()) return "";
    if (acc.allowed === false) return '<div class="si-lock-bar"><i class="fa-solid fa-lock"></i><div><b>매장 재고 체크 권한이 없어요</b><span>체크는 관리자(jipar5, junkoo)가 켜 준 아이디만 할 수 있어요 (켜면 3시간 동안 가능). 현황·기록·엑셀은 그대로 볼 수 있어요.</span></div></div>';
    if (acc.allowed && acc.expires) return '<div class="si-lock-bar ok"><i class="fa-solid fa-unlock"></i><div><b>매장 재고 체크 권한 켜짐 · ' + esc(leftText(acc.expires)) + '</b><span>관리자가 켜 준 뒤 3시간 동안 쓸 수 있고, 시간이 지나면 자동으로 꺼져요.</span></div></div>';
    return "";
  }
  function ensureManagerBtn() {
    var head = document.querySelector("#tab-storecheck .tb-head-actions"); if (!head) return;
    var b = document.getElementById("btn-sc-access");
    if (isManager() && !b) {
      b = document.createElement("button"); b.type = "button"; b.id = "btn-sc-access"; b.className = "tb-btn-ghost sc-access-btn";
      b.innerHTML = '<i class="fa-solid fa-user-shield"></i> 권한 관리'; b.onclick = function () { if (window.PermAdmin) window.PermAdmin.open(); else openAccess(); };
      head.insertBefore(b, head.firstChild);
    }
    if (b) b.style.display = isManager() ? "" : "none";
  }
  function ensureAccessModal() {
    var m = document.getElementById("sc-access-modal"); if (m) return m;
    m = document.createElement("div"); m.id = "sc-access-modal"; m.className = "tb-sheet-backdrop";
    m.innerHTML = '<div class="tb-sheet si-access-sheet" role="dialog" aria-modal="true">' +
      '<div class="tb-sheet-top"><span class="tb-sheet-step sc-step"><i class="fa-solid fa-user-shield"></i> 매장 재고 체크 권한</span><button type="button" class="tb-sheet-close" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="tb-sheet-scroll"><div class="si-access-help">켜진 아이디만 매장 재고 체크를 시작·입력할 수 있어요. <b>켜면 3시간 동안만 가능</b>하고 시간이 지나면 자동으로 꺼져요. jipar5, junkoo는 항상 가능해요.</div><div id="sc-access-list"></div></div></div>';
    m.addEventListener("click", function (e) { if (e.target === m || e.target.closest(".tb-sheet-close")) closeAccess(); });
    document.body.appendChild(m); return m;
  }
  async function openAccess() {
    if (!isManager()) return;
    ensureAccessModal().classList.add("active"); document.body.classList.add("tb-sheet-open");
    document.getElementById("sc-access-list").innerHTML = '<div class="tb-empty">불러오는 중…</div>';
    await loadAccessList();
  }
  function closeAccess() { var m = document.getElementById("sc-access-modal"); if (m) m.classList.remove("active"); document.body.classList.remove("tb-sheet-open"); }
  async function loadAccessList() {
    var c = client(); if (!c) return;
    var r = await c.rpc("store_check_access_list");
    var box = document.getElementById("sc-access-list"); if (!box) return;
    if (r.error) { box.innerHTML = '<div class="tb-empty">목록을 불러오지 못했어요. (' + esc(r.error.message) + ')</div>'; return; }
    acc.list = (r.data || []).filter(function (u) { return u.app_role !== "viewer"; });
    var on = acc.list.filter(function (u) { return u.enabled || MANAGERS.indexOf(String(u.login_id).toLowerCase()) !== -1; }).length;
    box.innerHTML = '<div class="si-access-count">권한 있는 아이디 <b>' + on + '</b> / ' + acc.list.length + '</div>' + acc.list.map(function (u) {
      var id = String(u.login_id), mgr = MANAGERS.indexOf(id.toLowerCase()) !== -1, en = mgr || u.enabled;
      return '<div class="si-access-row' + (en ? " on" : "") + '"><div class="si-access-id"><b>' + esc(id) + '</b>' + (mgr ? '<span class="si-tag">관리자</span>' : u.app_role === "admin" ? '<span class="si-tag gray">admin</span>' : '') +
        '<small>' + (mgr ? "항상 가능" : en ? '<span class="si-left">' + esc(leftText(u.expires_at)) + '</span> · ' + esc(u.updated_by || "") + " " + esc(fmtTime(u.updated_at)) + ' 켬'
          : u.updated_by ? "꺼짐 · 마지막 변경 " + esc(u.updated_by) + " " + esc(fmtTime(u.updated_at)) : "꺼짐") + '</small></div>' +
        (!mgr && en ? '<button type="button" class="si-extend" data-ext="' + esc(id) + '">3시간 다시</button>' : '') +
        '<label class="switch-toggle si-switch"><input type="checkbox" ' + (en ? "checked " : "") + (mgr ? "disabled " : "") + 'data-id="' + esc(id) + '"><span class="slider-toggle"></span></label></div>';
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll("input[data-id]"), function (inp) { inp.addEventListener("change", function () { setAccess(inp.dataset.id, inp.checked, inp); }); });
    Array.prototype.forEach.call(box.querySelectorAll("button[data-ext]"), function (btn) { btn.addEventListener("click", function () { btn.disabled = true; setAccess(btn.dataset.ext, true, null); }); });
  }
  async function setAccess(id, enabled, inp) {
    var c = client(); if (!c || !isManager()) return;
    if (inp) inp.disabled = true;
    var r = await c.from("store_check_access").upsert([{ login_id: id, enabled: enabled, updated_by: me() }], { onConflict: "login_id" });   // 만료 시각(3시간)은 서버가 정함
    if (r.error) { toast("권한 변경 실패: " + r.error.message, "danger"); if (inp) { inp.checked = !enabled; inp.disabled = false; } return; }
    toast(id + " 매장 재고 체크 권한을 " + (enabled ? "켰어요 (3시간 동안 가능)" : "껐어요") + ".", enabled ? "success" : "info");
    await loadAccessList();
  }

  // ---------- 불러오기 ----------
  async function load(force) {
    var c = client();
    if (!c || state.loading) return;
    if (state.loaded && !force) { render(); return; }
    state.loading = true; render();
    try { await checkAccess(); } catch (e) {}
    try {
      var r1 = await c.from(T_CHECKS).select("*").gte("check_date", daysAgo(95)).order("id", { ascending: false }).limit(10000);
      if (r1.error) throw r1.error;
      var r2 = await c.from(T_SESSIONS).select("*").gte("created_at", daysAgo(95) + "T00:00:00").order("id", { ascending: false }).limit(2000);
      if (r2.error) throw r2.error;
      state.logs = r1.data || []; state.sessions = r2.data || []; state.loaded = true;
    } catch (err) {
      console.warn("매장 재고 체크 load error:", err);
      if (force) toast("매장 재고 체크 기록을 불러오지 못했습니다. 로그인 상태를 확인해 주세요.", "danger");
    } finally { state.loading = false; }
    render(); updateDashboard();
    if (state.loaded) { try { await resolveConflicts(); } catch (e) {} var mine = activeSession(); if (mine) maybeFinish(mine.id, true); }
  }

  function updateDashboard() {
    var sub = document.getElementById("menu-task-storecheck-sub");
    var cnt = document.getElementById("menu-task-storecheck-count");
    if (!state.loaded) { if (sub) sub.textContent = "매장 입고 아티클 · 5개/10개 선택"; if (cnt) cnt.style.display = "none"; return; }
    var a = activeSession(), t = today();
    var doneToday = state.sessions.filter(function (s) { return s.status === "done" && s.completed_at && ymd(new Date(s.completed_at)) === t; }).length;
    if (sub) {
      if (a) sub.textContent = "내 매장 재고 체크 진행 중";
      else if (othersActive().length) sub.textContent = "진행 중 " + othersActive().map(function (o) { return o.created_by; }).join(", ") + (doneToday ? " · 오늘 " + doneToday + "회 완료" : "");
      else sub.textContent = (doneToday ? "오늘 " + doneToday + "회 완료" : "오늘 진행한 매장 재고 체크 없음") + (pickItems().length ? " · 챙길 아티클 " + pickItems().length + "개" : "");
    }
    if (cnt) {
      if (a) { var d = sessionDoneCount(a.id), tg = a.target || PER_SESSION; cnt.textContent = d + "/" + tg; cnt.classList.toggle("done", d >= tg); cnt.style.display = ""; }
      else cnt.style.display = "none";
    }
  }

  // ---------- 회차 ----------
  async function startSession(count) {
    if (!(await needAccess())) return;
    var n = Number(count) === 10 ? 10 : 5;
    if (isViewer()) { toast("Viewer(읽기 전용) 계정은 시작할 수 없습니다.", "warning"); return; }
    await load(true);
    if (activeSession()) { toast("내가 진행 중인 매장 재고 체크가 있어요. 먼저 끝내 주세요.", "info"); render(); return; }
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }
    await loadPool();
    var arts = pick(n);
    if (!arts.length) { toast("매장 입고 기록이 있는 아티클을 찾지 못했습니다.", "warning"); return; }
    try {
      var res = await c.from(T_SESSIONS).insert([{ target: arts.length, articles: arts, created_by: me() || null }]).select();
      if (res.error) throw res.error;
      if (res.data && res.data[0]) state.sessions.unshift(res.data[0]);
      await resolveConflicts();
      toast("매장 재고 체크를 시작했습니다. " + arts.length + "개 아티클을 매장에서 세어 주세요.", "success");
      render(); updateDashboard();
    } catch (err) { toast("시작 실패: " + (err.message || err), "danger"); }
  }

  async function refreshSession(sid) {
    var c = client(); if (!c) return null;
    var res = await c.from(T_SESSIONS).select("*").eq("id", sid).single();
    if (res.error || !res.data) return null;
    var i = state.sessions.findIndex(function (s) { return s.id === sid; });
    if (i >= 0) state.sessions[i] = res.data; else state.sessions.unshift(res.data);
    return res.data;
  }

  // 거의 동시에 시작해 품목이 겹치면 나중 회차가 겹친 품목을 다른 품목으로 교체
  async function resolveConflicts() {
    var mine = activeSession(), c = client();
    if (!mine || !c) return;
    var res = await c.from(T_SESSIONS).select("*").eq("status", "in_progress");
    if (res.error || !res.data) return;
    res.data.forEach(function (row) { var i = state.sessions.findIndex(function (x) { return x.id === row.id; }); if (i >= 0) state.sessions[i] = row; else state.sessions.push(row); });
    mine = activeSession(); if (!mine) return;
    var taken = new Set();
    res.data.forEach(function (o) { if (o.id < mine.id && !isMine(o)) (o.articles || []).forEach(function (x) { taken.add(pad8(x.artno)); }); });
    if (!taken.size) return;
    if (!state.pool.length) await loadPool();
    var latest = sessionLatest(mine.id), changed = false;
    var arts = (mine.articles || []).map(function (x) {
      var k = pad8(x.artno);
      if (!taken.has(k) || latest.has(k)) return x;
      var next = pick(1, (mine.articles || []).map(function (y) { return pad8(y.artno); }).concat(Array.from(taken)))[0];
      if (!next) return x;
      changed = true; taken.add(next.artno); return next;
    });
    if (!changed) return;
    var up = await c.from(T_SESSIONS).update({ articles: arts }).eq("id", mine.id).select();
    if (!up.error) { mine.articles = arts; render(); }
  }

  async function maybeFinish(sid) {
    var s = state.sessions.find(function (x) { return x.id === sid; });
    if (!s || s.status !== "in_progress" || !isMine(s)) return;
    if (sessionDoneCount(sid) < (s.target || PER_SESSION)) return;
    var patch = { status: "done", completed_by: me() || null, completed_at: new Date().toISOString() };
    try {
      var res = await client().from(T_SESSIONS).update(patch).eq("id", sid).eq("status", "in_progress").select();
      if (res.error) throw res.error;
      Object.assign(s, patch);
      toast("🎉 매장 재고 체크 " + (s.target || PER_SESSION) + "개를 모두 끝냈습니다!", "success");
    } catch (err) { console.warn("finish store check error", err); }
    render(); updateDashboard();
  }

  // ---------- 교체 (카드 밀기) ----------
  var swapping = false;
  async function swapSlot(sid, artno) {
    if (!(await needAccess())) { render(); return; }
    if (isViewer() || swapping) return;
    var s = state.sessions.find(function (x) { return x.id === sid; });
    if (!s) return;
    if (!isMine(s)) { toast("시작한 사람만 아티클을 교체할 수 있습니다.", "warning"); render(); return; }
    var a = (s.articles || []).find(function (x) { return pad8(x.artno) === pad8(artno); });
    if (!a) return;
    if (sessionLatest(sid).has(pad8(artno))) { toast("이미 체크한 아티클은 교체할 수 없습니다.", "info"); render(); return; }
    swapping = true;
    try {
      var c = client();
      if (!state.pool.length) await loadPool();
      var ins = await c.from(T_CHECKS).insert([{ check_date: today(), artno: pad8(a.artno), artname: a.artname || null, skip_reason: "swapped", session_id: sid, user: me() || null }]).select();
      if (ins.error) throw ins.error;
      if (ins.data && ins.data[0]) state.logs.unshift(ins.data[0]);
      var sess = await refreshSession(sid) || s;
      var arts = (sess.articles || []).slice();
      var next = pick(1, arts.map(function (x) { return pad8(x.artno); }))[0];
      if (!next) toast("교체할 아티클이 없습니다.", "warning");
      else {
        var idx = arts.findIndex(function (x) { return pad8(x.artno) === pad8(a.artno); });
        if (idx >= 0) arts[idx] = next;
        var up = await c.from(T_SESSIONS).update({ articles: arts }).eq("id", sid).select();
        if (up.error) throw up.error;
        sess.articles = arts;
        toast(pad8(a.artno) + " → " + next.artno + " 아티클로 교체했습니다.", "info");
      }
    } catch (err) { toast("교체 실패: " + (err.message || err), "danger"); }
    swapping = false;
    render(); updateDashboard();
  }

  function bindSwipes() {
    Array.prototype.forEach.call(document.querySelectorAll("#tab-storecheck .tb-slot-wrap.pending"), function (wrap) {
      if (wrap.dataset.bound) return; wrap.dataset.bound = "1";
      var card = wrap.querySelector(".tb-slot"), startX = 0, startY = 0, dx = 0, dragging = false, decided = false, horizontal = false, open = false, REVEAL = 96;
      function setX(x, anim) { card.style.transition = anim ? "transform .2s ease" : "none"; card.style.transform = "translateX(" + x + "px)"; }
      function down(e) { var pt = e.touches ? e.touches[0] : e; startX = pt.clientX; startY = pt.clientY; dx = 0; dragging = true; decided = false; horizontal = false; }
      function move(e) {
        if (!dragging) return;
        var pt = e.touches ? e.touches[0] : e, mx = pt.clientX - startX, my = pt.clientY - startY;
        if (!decided && (Math.abs(mx) > 8 || Math.abs(my) > 8)) { decided = true; horizontal = Math.abs(mx) > Math.abs(my); }
        if (!horizontal) return;
        if (e.cancelable) e.preventDefault();
        dx = Math.min(0, mx + (open ? -REVEAL : 0)); setX(dx, false);
        wrap.classList.toggle("armed", -dx > card.offsetWidth * 0.4);
      }
      function up() {
        if (!dragging) return; dragging = false;
        if (!horizontal) return;
        wrap.dataset.swiped = "1"; setTimeout(function () { delete wrap.dataset.swiped; }, 50);
        if (-dx > card.offsetWidth * 0.4) { setX(-card.offsetWidth, true); swapSlot(Number(wrap.dataset.sid), wrap.dataset.art); }
        else if (-dx > REVEAL * 0.5) { open = true; setX(-REVEAL, true); }
        else { open = false; setX(0, true); }
        wrap.classList.remove("armed");
      }
      card.addEventListener("touchstart", down, { passive: true });
      card.addEventListener("touchmove", move, { passive: false });
      card.addEventListener("touchend", up);
      card.addEventListener("mousedown", down);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      card.addEventListener("click", function (e) {
        if (wrap.dataset.swiped) { e.stopPropagation(); e.preventDefault(); return; }
        if (open) { open = false; setX(0, true); e.stopPropagation(); e.preventDefault(); return; }
        openSlot(Number(wrap.dataset.sid), wrap.dataset.art);
      });
      var btn = wrap.querySelector(".tb-slot-swap");
      if (btn) btn.addEventListener("click", function (e) { e.stopPropagation(); swapSlot(Number(wrap.dataset.sid), wrap.dataset.art); });
    });
  }

  // ---------- 체크 창 ----------
  function ensureSheet() {
    var el = document.getElementById("sc-sheet");
    if (el) return el;
    el = document.createElement("div");
    el.id = "sc-sheet"; el.className = "tb-sheet-backdrop";
    el.innerHTML = '<div class="tb-sheet sc-sheet" role="dialog" aria-modal="true">' +
      '<div class="tb-sheet-top"><span class="tb-sheet-step sc-step" id="sc-sheet-step"></span><button type="button" class="tb-sheet-close" onclick="StoreCheck.closeSheet()" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="tb-sheet-scroll" id="sc-sheet-body"></div><div class="tb-sheet-footer" id="sc-sheet-footer"></div></div>';
    el.addEventListener("click", function (e) { if (e.target === el) closeSheet(); });
    document.body.appendChild(el);
    return el;
  }

  function openSlot(sid, artno) {
    if (acc.allowed === false) { denied(); return; }
    if (isViewer()) { toast("Viewer(읽기 전용) 계정은 체크할 수 없습니다.", "warning"); return; }
    var s = state.sessions.find(function (x) { return x.id === sid; });
    if (!s) return;
    if (!isMine(s)) { toast(s.created_by + " 님이 시작한 매장 재고 체크예요. 시작한 사람만 체크할 수 있습니다.", "warning"); return; }
    var a = (s.articles || []).find(function (x) { return pad8(x.artno) === pad8(artno); });
    if (!a) return;
    if (sessionLatest(sid).has(pad8(artno))) { toast("이미 체크한 아티클입니다.", "info"); return; }
    state.sheet = { sessionId: sid, artNo: pad8(a.artno), artName: a.artname || catalogName(pad8(a.artno)), actual: null };
    ensureSheet().classList.add("active");
    document.body.classList.add("tb-sheet-open");
    renderSheet();
    setTimeout(function () { var i = document.getElementById("sc-actual"); if (i) i.focus(); }, 120);
  }

  // ---------- 입고 요청 (오더 요청에 등록 · 처리 안 된 같은 요청이 있으면 중복 등록 안 함) ----------
  var OPEN_ORDER_ST = ["요청됨", "요청", "보류", "대기", "출고대기", "승인", "수락"];
  function orderLogsArr() { try { return (typeof orderLogs !== "undefined" && Array.isArray(orderLogs)) ? orderLogs : null; } catch (e) { return null; } }
  function hasOpenOrder(artNo) { var l = orderLogsArr() || []; return l.some(function (o) { return pad8(o.artNo || o.artno) === pad8(artNo) && OPEN_ORDER_ST.indexOf(o.status) !== -1; }); }
  // 입고 요청 보내기 (성공하면 true)
  async function sendOrder(artNo, artName, qty, msg) {
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return false; }
    try {
      var order = { date: today(), artNo: artNo, artName: artName || "기타 품목", qty: Math.max(1, Number(qty) || 1), user: me() || null, status: "요청됨" };
      var r = await c.from("order_requests").insert([order]).select();
      if (r.error) throw r.error;
      if (r.data && r.data[0]) { order.id = r.data[0].id; order.created_at = r.data[0].created_at; }
      var l = orderLogsArr(); if (l) l.unshift(order);
      try { if (typeof renderOrderLogs === "function") renderOrderLogs(); if (typeof window.updateAllBadges === "function") window.updateAllBadges(); } catch (e) {}
      toast(msg || ("[" + artNo + "] 입고 요청을 보냈어요. (오더 요청 화면에서 확인)"), "success");
      return true;
    } catch (err) { toast("입고 요청 실패: " + ((err && err.message) || err), "danger"); return false; }
  }
  // 매장 0개로 저장한 뒤: "입고 요청할까요?" 팝업 (이미 처리 안 된 요청이 있으면 묻지 않음)
  function askOrder(artNo, artName) {
    return new Promise(function (resolve) {
      if (isViewer()) { resolve(false); return; }
      var qty = 1, max = 99;
      var whN = whStock(artNo);
      if (whN > 0) {   // 창고에 있으면 안내만 → 아래 '창고에서 챙길 아티클' 목록에 자동으로 들어감
        var loc0 = whLocation(artNo);
        var el0 = document.createElement("div"); el0.className = "sc-ask-backdrop";
        el0.innerHTML = '<div class="sc-ask" role="dialog" aria-modal="true"><div class="sc-ask-icon wh"><i class="fa-solid fa-warehouse"></i></div>' +
          '<div class="sc-ask-title">창고에 재고가 있어요</div><div class="sc-ask-name">' + esc(artName || "") + ' <span>' + esc(artNo) + '</span></div>' +
          '<div class="sc-ask-whbox">' + (loc0 && loc0 !== "미지정" ? '<span class="sc-pick-loc">' + esc(loc0) + '</span>' : '<span class="sc-pick-loc gray">위치 미지정</span>') + '<b>' + whN + '개</b></div>' +
          '<div class="sc-ask-sub"><i class="fa-solid fa-list-check"></i> 아래 <b>창고에서 챙길 아티클</b> 목록에 저장했어요</div>' +
          '<button type="button" class="sc-ask-ok">확인</button></div>';
        document.body.appendChild(el0);
        requestAnimationFrame(function () { el0.classList.add("show"); });
        var closed = false;
        var close0 = function () { if (closed) return; closed = true; el0.remove(); resolve(false); };
        el0.querySelector(".sc-ask-ok").onclick = close0;
        el0.addEventListener("click", function (e) { if (e.target === el0) close0(); });
        return;
      }
      if (hasOpenOrder(artNo)) { toast("[" + artNo + "] 이미 입고 요청이 들어가 있어요.", "info"); resolve(false); return; }
      var el = document.createElement("div"); el.className = "sc-ask-backdrop";
      el.innerHTML = '<div class="sc-ask" role="dialog" aria-modal="true"><div class="sc-ask-icon"><i class="fa-solid fa-truck-ramp-box"></i></div>' +
        '<div class="sc-ask-title">매장·창고 모두 재고가 없어요</div><div class="sc-ask-name">' + esc(artName || "") + ' <span>' + esc(artNo) + '</span></div>' +
        '<div class="sc-ask-q">입고 요청할까요?</div>' +
        '<div class="sc-ask-qty"><span>요청 수량</span><button type="button" data-d="-1">−</button><b id="sc-ask-qty">1</b><button type="button" data-d="1">+</button></div>' +
        '<div class="sc-ask-btns"><button type="button" class="sc-ask-no">아니요</button><button type="button" class="sc-ask-yes"><i class="fa-solid fa-paper-plane"></i> 입고 요청</button></div></div>';
      document.body.appendChild(el);
      requestAnimationFrame(function () { el.classList.add("show"); });
      Array.prototype.forEach.call(el.querySelectorAll(".sc-ask-qty button"), function (b) {
        b.onclick = function () { qty = Math.min(max, Math.max(1, qty + Number(b.dataset.d))); el.querySelector("#sc-ask-qty").textContent = qty; };
      });
      var done = false;
      function finish(v) { if (done) return; done = true; el.remove(); resolve(v); }
      el.querySelector(".sc-ask-no").onclick = function () { finish(false); };
      el.addEventListener("click", function (e) { if (e.target === el) finish(false); });
      el.querySelector(".sc-ask-yes").onclick = async function () {
        var b = this; b.disabled = true; b.textContent = "저장 중…";
        var ok = await sendOrder(artNo, artName, qty); finish(ok);
        if (ok) render();
      };
    });
  }

  // ---------- 창고에서 챙길 아티클: 오늘 매장 '재고 없음'인데 창고에 재고가 있는 아티클 (자동 목록) ----------
  var ZONE_ORDER = { "B1": 1, "B2": 2, "램프": 3, "B3": 4 };
  function pickItems() {
    var t = today(), seen = {}, out = [];
    checks().forEach(function (r) {
      if (r.check_date !== t || r.status !== "none") return;
      var k = pad8(r.artno); if (seen[k]) return; seen[k] = 1;
      var wh = whStock(k); if (!(wh > 0)) return;
      out.push({ artno: k, artname: r.artname || catalogName(k), wh: wh, loc: whLocation(k) || "미지정" });
    });
    out.sort(function (a, b) { return (ZONE_ORDER[a.loc] || 9) - (ZONE_ORDER[b.loc] || 9) || a.artno.localeCompare(b.artno); });
    return out;
  }
  function pickListHtml() {
    var items = pickItems(); if (!items.length) return "";
    return '<div class="sc-pick"><div class="sc-pick-head"><i class="fa-solid fa-dolly"></i><div><b>창고에서 챙길 아티클 ' + items.length + '개</b><span>오늘 매장에 재고가 없었고 창고에는 있는 아티클이에요</span></div></div>' +
      items.map(function (x) {
        return '<div class="sc-pick-row">' + thumb(x.artno, x.artname, 44) + '<div class="sc-pick-body"><div class="sc-pick-name">' + esc(x.artname || "(품명 없음)") + '</div>' +
          '<div class="sc-pick-meta">' + esc(x.artno) + '</div></div>' +
          '<span class="sc-pick-loc">' + esc(x.loc) + '</span><div class="sc-pick-qty">창고 ' + x.wh + '개</div></div>';
      }).join("") + '</div>';
  }

  function closeSheet() {
    var el = document.getElementById("sc-sheet"); if (el) el.classList.remove("active");
    document.body.classList.remove("tb-sheet-open"); state.sheet = null;
  }

  function renderSheet() {
    var s = state.sheet; if (!s) return;
    var sess = state.sessions.find(function (x) { return x.id === s.sessionId; });
    document.getElementById("sc-sheet-step").textContent = "매장 재고 체크" + (sess ? " · " + sessionDoneCount(sess.id) + "/" + (sess.target || PER_SESSION) : "");
    document.getElementById("sc-sheet-body").innerHTML =
      '<div class="tb-sheet-product"><div class="tb-sheet-thumb">' + thumb(s.artNo, s.artName, 96) + '</div><div class="tb-sheet-info">' +
        '<div class="tb-sheet-name">' + esc(s.artName || "(품명 없음)") + '</div><div class="tb-sheet-no">' + esc(s.artNo) + '</div></div></div>' +
      whHtml(s.artNo, true) +
      '<div class="sc-count">' +
        '<div class="sc-q">매장에 있는 수량을 세어 주세요</div>' +
        '<div class="cc-stepper sc-stepper">' +
          '<button type="button" onclick="StoreCheck.step(-1)" aria-label="빼기">−</button>' +
          '<input type="number" id="sc-actual" inputmode="numeric" min="0" placeholder="0" value="' + (s.actual == null ? "" : s.actual) + '" oninput="StoreCheck.setActual(this.value)">' +
          '<button type="button" onclick="StoreCheck.step(1)" aria-label="더하기">+</button></div>' +
        '<button type="button" class="sc-zero" onclick="StoreCheck.setZero()"><i class="fa-solid fa-ban"></i> 매장에 재고 없음 (0개)</button>' +
      '</div>';
    renderFooter();
    loadThumbs();
  }
  function renderFooter() {
    var s = state.sheet; if (!s) return;
    var f = document.getElementById("sc-sheet-footer");
    if (s.actual == null) { f.innerHTML = '<button type="button" class="tb-sheet-done sc-wait" disabled>수량을 입력해 주세요</button>'; return; }
    var none = s.actual === 0;
    f.innerHTML = '<button type="button" class="tb-sheet-done ' + (none ? "sc-none" : "sc-has") + '" id="sc-save" onclick="StoreCheck.save()">' +
      (none ? '<i class="fa-solid fa-ban"></i> 재고 없음으로 저장' : '<i class="fa-solid fa-check"></i> 매장 ' + s.actual + '개 저장') + '</button>';
  }
  function setActual(v) { var s = state.sheet; if (!s) return; if (String(v).trim() === "") { s.actual = null; renderFooter(); return; } var n = parseInt(v, 10); s.actual = isNaN(n) || n < 0 ? 0 : n; renderFooter(); }
  function step(d) { var s = state.sheet; if (!s) return; s.actual = Math.max(0, (s.actual || 0) + d); var i = document.getElementById("sc-actual"); if (i) i.value = s.actual; renderFooter(); }
  function setZero() { var s = state.sheet; if (!s) return; s.actual = 0; var i = document.getElementById("sc-actual"); if (i) i.value = 0; renderFooter(); }

  async function save() {
    var s = state.sheet; if (!s || s.actual == null) return;
    if (!(await needAccess())) return;
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }
    var btn = document.getElementById("sc-save"); if (btn) { btn.disabled = true; btn.textContent = "저장 중…"; }
    try {
      var row = { check_date: today(), artno: s.artNo, artname: s.artName || null, actual_stock: s.actual, status: s.actual > 0 ? "has" : "none",
                  session_id: s.sessionId, user: me() || null };
      var res = await c.from(T_CHECKS).insert([row]).select();
      if (res.error) throw res.error;
      if (res.data && res.data[0]) state.logs.unshift(res.data[0]);
      toast(s.actual > 0 ? "✅ [" + s.artNo + "] 매장 " + s.actual + "개" : "[" + s.artNo + "] 매장 재고 없음으로 기록했습니다.", s.actual > 0 ? "success" : "info");
      var sid = s.sessionId; closeSheet(); render(); updateDashboard();
      if (s.actual === 0) await askOrder(s.artNo, s.artName);
      await maybeFinish(sid);
    } catch (err) {
      var msg = String((err && err.message) || err);
      if (/row-level security|JWT|401/i.test(msg)) {
        try { var r = await c.auth.getSession(); if (!r || !r.data || !r.data.session) { if (window.showAuthExpired) window.showAuthExpired(); renderFooter(); return; } } catch (e) {}
      }
      if (/row-level security/i.test(msg)) { var ok = await checkAccess(); if (!ok) { denied(); closeSheet(); render(); return; } }
      toast("저장 실패: " + msg, "danger");
      renderFooter();
    }
  }

  // ---------- 화면 ----------
  function renderStats() {
    var box = document.getElementById("sc-stats"); if (!box) return;
    var now = new Date(), t = today(), month = t.slice(0, 7), ml = (now.getMonth() + 1) + "월";
    var mc = checks().filter(function (r) { return String(r.check_date).slice(0, 7) === month; });
    var tc = mc.filter(function (r) { return r.check_date === t; });
    function isNone(r) { return r.status === "none"; }
    function tile(n, l, cls) { return '<div class="tb-kpi' + (cls ? " " + cls : "") + '"><b>' + n + '</b><span>' + l + '</span></div>'; }
    function row(list) { var z = list.filter(isNone).length; return '<div class="tb-kpis">' + tile(list.length, "체크된 아티클", "main") + tile(list.length - z, "재고 있는 아티클", "ok") + tile(z, "재고 없는 아티클", "fix") + '</div>'; }
    var ts = state.sessions.filter(function (x) { return x.status === "done" && x.completed_at && ymd(new Date(x.completed_at)) === t; })
      .sort(function (a, b) { return new Date(a.completed_at) - new Date(b.completed_at); });
    var dc = {}, dorder = [];
    ts.forEach(function (x) { var u = String(x.completed_by || x.created_by || "-"); if (!dc[u]) { dc[u] = 0; dorder.push(u); } dc[u]++; });
    var doneHtml = '<div class="tb-done-today"><span class="tb-done-label"><i class="fa-solid fa-circle-check"></i> 오늘 완료</span>' +
      (dorder.length ? dorder.map(function (u) { return '<span class="tb-done-id">' + esc(u) + (dc[u] > 1 ? '<em>×' + dc[u] + '</em>' : '') + '</span>'; }).join("")
                     : '<span class="tb-done-none">아직 완료한 사람이 없어요</span>') + '</div>';
    box.innerHTML = '<div class="tb-dash sc-dash"><div class="tb-dash-title"><span><i class="fa-solid fa-chart-simple"></i> 매장 재고 체크 현황</span><small>' + esc(ml + " " + now.getDate() + "일 기준") + '</small></div>' +
      '<div class="tb-dash-label">오늘</div>' + row(tc) + doneHtml +
      '<div class="tb-dash-label">' + esc(ml) + ' 누적</div>' + row(mc) + '</div>';
  }

  function sessionCardHtml(a, readOnly) {
    var latest = sessionLatest(a.id), done = latest.size, target = a.target || PER_SESSION;
    var swaps = state.logs.filter(function (r) { return r.session_id === a.id && r.skip_reason; }).length;
    var html = '<div class="tb-sess sc-sess' + (readOnly ? " readonly" : "") + '">' +
      '<div class="tb-sess-head"><div><b>' + (readOnly ? esc(a.created_by || "-") + " 님 진행 중" : "매장 재고 체크 진행 중") + '</b><span>시작 <b class="tb-who">' + esc(a.created_by || "-") + '</b> · ' + esc(fmtTime(a.created_at)) + (swaps ? " · 교체 " + swaps + "건" : "") + '</span></div>' +
      '<div class="tb-sess-count"><b>' + done + '</b>/' + target + '</div></div>' +
      '<div class="tb-sess-bar"><span style="width:' + Math.min(100, done / target * 100) + '%"></span></div><div class="tb-slots">' +
      (a.articles || []).map(function (x) {
        var r = latest.get(pad8(x.artno)), pending = !r && !readOnly && !isViewer();
        var name = x.artname || catalogName(pad8(x.artno)) || "(품명 없음)";
        var st = r ? (r.status === "none" ? '<span class="tb-chip warn"><i class="fa-solid fa-ban"></i>재고 없음</span>' : '<span class="tb-chip ok"><i class="fa-solid fa-circle-check"></i>매장 ' + r.actual_stock + '개</span>') + ' · ' + esc(fmtTime(r.created_at))
                   : (readOnly ? "체크 대기" : "눌러서 수량 입력");
        return '<div class="tb-slot-wrap' + (pending ? " pending" : "") + '" data-sid="' + a.id + '" data-art="' + pad8(x.artno) + '">' +
          (pending ? '<button type="button" class="tb-slot-swap"><i class="fa-solid fa-right-left"></i><span>교체</span></button>' : '') +
          '<div class="tb-slot' + (r ? " done" : "") + '">' + thumb(x.artno, name, 52) +
          '<div class="tb-slot-body"><div class="tb-slot-name">' + esc(name) + '</div><div class="tb-slot-no">' + esc(pad8(x.artno)) + whHtml(x.artno, false) + '</div>' +
          '<div class="tb-slot-state' + (r ? "" : " wait") + '">' + st + '</div></div>' +
          (pending ? '<i class="fa-solid fa-chevron-right tb-slot-go"></i>' : '') + '</div></div>';
      }).join("") + '</div>';
    if (!readOnly && !isViewer()) html += '<div class="tb-swipe-hint"><i class="fa-solid fa-hand-point-left"></i> 지금 체크하기 어려운 아티클은 카드를 왼쪽으로 밀어 교체하세요 (개수에 포함 안 됨)</div>';
    return html + '</div>';
  }

  function renderActive() {
    var box = document.getElementById("sc-session"); if (!box) return;
    var a = activeSession(), others = othersActive(), html = accessBarHtml();
    ensureManagerBtn();
    if (a) html += sessionCardHtml(a, false);
    else if (!isViewer() && acc.allowed !== false) html += '<div class="sc-start-box"><div class="sc-start-title"><i class="fa-solid fa-store"></i> 새 매장 재고 체크 시작</div>' +
      '<div class="sc-start-sub">몇 개를 체크할까요? 매장 입고된 아티클 중 랜덤으로 배정합니다 (프락타 제외) · 시작한 사람이 끝까지 진행</div>' +
      '<div class="sc-start-choices">' +
        '<button type="button" class="sc-start-btn sc-n5" onclick="StoreCheck.startSession(5)"><b>5개</b><small>빠르게</small></button>' +
        '<button type="button" class="sc-start-btn sc-n10" onclick="StoreCheck.startSession(10)"><b>10개</b><small>넉넉하게</small></button>' +
      '</div></div>';
    html += pickListHtml();
    if (others.length) html += '<details class="tb-others"' + (isViewer() ? " open" : "") + '><summary><i class="fa-solid fa-users"></i> 다른 사람이 진행 중인 매장 재고 체크 ' + others.length + '건 <span>(보기만 가능)</span></summary>' +
      others.map(function (o) { return sessionCardHtml(o, true); }).join("") + '</details>';
    box.innerHTML = html || '<div class="tb-empty">진행 중인 매장 재고 체크가 없습니다.</div>';
  }

  function rowHtml(r) {
    var none = r.status === "none";
    return '<div class="tb-row">' + thumb(r.artno, r.artname, 44) + '<div class="tb-row-body">' +
      '<div class="tb-row-title">' + (r.skip_reason ? '<span class="tb-chip skip"><i class="fa-solid fa-right-left"></i>교체</span>' : none ? '<span class="tb-chip warn"><i class="fa-solid fa-ban"></i>재고 없음</span>' : '<span class="tb-chip ok"><i class="fa-solid fa-circle-check"></i>매장 ' + r.actual_stock + '개</span>') +
      ' <b>' + esc(r.artname || catalogName(pad8(r.artno)) || "(품명 없음)") + '</b></div>' +
      '<div class="tb-row-meta"><span class="tb-row-no">' + esc(pad8(r.artno)) + '</span> · ' + (r.skip_reason ? "교체" : "체크") + ' <b class="tb-who">' + esc(r.user || "-") + '</b> · ' + esc(fmtTime(r.created_at)) + '</div>' +
      '</div></div>';
  }

  function renderLists() {
    var month = today().slice(0, 7);
    var none = checks().filter(function (r) { return r.status === "none" && String(r.check_date).slice(0, 7) === month; });
    var done = state.sessions.filter(function (s) { return s.status === "done"; });
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set("sc-stat-none", none.length); set("sc-stat-sessions", done.length);
    Array.prototype.forEach.call(document.querySelectorAll("#tab-storecheck .tb-stat"), function (b) { b.classList.toggle("active", b.dataset.filter === state.filter); });
    var list = document.getElementById("sc-list"), title = document.getElementById("sc-list-title");
    if (!list) return;
    if (state.filter === "none") {
      if (title) title.textContent = "이번 달 매장 재고 없음 내역";
      list.innerHTML = none.length ? none.map(rowHtml).join("") : '<div class="tb-empty">이번 달 재고 없는 아티클이 없습니다 👍</div>';
    } else {
      if (title) title.textContent = "완료된 매장 재고 체크 (시작·완료한 사람)";
      list.innerHTML = done.length ? done.slice(0, 20).map(function (s) {
        var rows = state.logs.filter(function (r) { return r.session_id === s.id; });
        var z = rows.filter(function (r) { return r.status === "none"; }).length, ok = rows.filter(function (r) { return r.status === "has"; }).length;
        return '<div class="tb-hist"><button type="button" class="tb-hist-head" onclick="StoreCheck.toggle(' + s.id + ')">' +
          '<div class="tb-hist-main"><b>' + esc(fmtTime(s.completed_at || s.created_at)) + ' 완료</b><span>시작 <b class="tb-who">' + esc(s.created_by || "-") + '</b> → 완료 <b class="tb-who">' + esc(s.completed_by || "-") + '</b> · ' + (s.target || PER_SESSION) + '개</span></div>' +
          '<div class="tb-hist-stats"><span class="ok">있음 ' + ok + '</span><span class="warn">없음 ' + z + '</span></div></button>' +
          '<div id="sc-sess-detail-' + s.id + '" class="tb-hist-detail" style="display:none;">' + rows.map(rowHtml).join("") + '</div></div>';
      }).join("") : '<div class="tb-empty">완료된 매장 재고 체크가 아직 없습니다.</div>';
    }
  }

  function render() {
    if (!document.getElementById("tab-storecheck")) return;
    if (!state.loaded) { var b = document.getElementById("sc-session"); if (b) b.innerHTML = '<div class="tb-empty">' + (state.loading ? "불러오는 중…" : "기록을 불러오려면 새로고침을 눌러 주세요.") + '</div>'; return; }
    renderStats(); renderActive(); renderLists(); bindSwipes(); loadThumbs();
  }

  function setFilter(f) { state.filter = f; render(); }
  function toggle(id) { var el = document.getElementById("sc-sess-detail-" + id); if (el) el.style.display = el.style.display === "none" ? "" : "none"; loadThumbs(); }


  // ---------- 엑셀 추출 ----------
  async function exportExcel() {
    if (typeof XLSX === "undefined") { toast("엑셀 기능을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.", "danger"); return; }
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }
    toast("엑셀 파일을 만드는 중…", "info");
    try {
      var rows = [], sessions = [];
      if (typeof fetchAllRows === "function") {
        var r1 = await fetchAllRows(T_CHECKS, "id", false); if (r1.error) throw r1.error; rows = r1.data || [];
        var r2 = await fetchAllRows(T_SESSIONS, "id", false); if (r2.error) throw r2.error; sessions = r2.data || [];
      } else { rows = state.logs.slice(); sessions = state.sessions.slice(); }
      if (!rows.length) { toast("추출할 매장 재고 체크 기록이 없습니다.", "warning"); return; }
      function hm(iso) { if (!iso) return ""; var d = new Date(iso); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
      function dt(iso) { return iso ? ymd(new Date(iso)) + " " + hm(iso) : ""; }
      function artNum(v) { var d = normNo(v); return d ? parseInt(d, 10) : String(v || ""); }
      var data = rows.map(function (r, i) {
        return { "연번": i + 1, "날짜": r.check_date, "시간": hm(r.created_at), "번호 (ARTNO)": artNum(r.artno),
                 "아티클 이름": r.artname || catalogName(pad8(r.artno)) || "",
                 "매장 수량": r.skip_reason ? "" : (Number(r.actual_stock) || 0),
                 "결과": r.skip_reason ? "교체" : (r.status === "none" ? "재고 없음" : "재고 있음"),
                 "체크한 사람": r.user || "-", "회차 번호": r.session_id || "" };
      });
      var ws = XLSX.utils.json_to_sheet(data);
      for (var i = 2; i <= data.length + 1; i++) { var cell = ws["D" + i]; if (cell && typeof cell.v === "number") { cell.t = "n"; cell.z = "00000000"; } }
      ws["!cols"] = [{ wch: 6 }, { wch: 11 }, { wch: 7 }, { wch: 12 }, { wch: 40 }, { wch: 9 }, { wch: 10 }, { wch: 12 }, { wch: 9 }];
      var sdata = sessions.map(function (s) {
        var rs = rows.filter(function (r) { return r.session_id === s.id && !r.skip_reason; });
        return { "회차 번호": s.id, "시작": dt(s.created_at), "시작한 사람": s.created_by || "-",
                 "완료": dt(s.completed_at), "완료한 사람": s.completed_by || "", "상태": s.status === "done" ? "완료" : "진행 중",
                 "배정 개수": s.target || PER_SESSION, "재고 있음": rs.filter(function (r) { return r.status === "has"; }).length,
                 "재고 없음": rs.filter(function (r) { return r.status === "none"; }).length };
      });
      var ws2 = XLSX.utils.json_to_sheet(sdata);
      ws2["!cols"] = [{ wch: 9 }, { wch: 17 }, { wch: 12 }, { wch: 17 }, { wch: 12 }, { wch: 8 }, { wch: 9 }, { wch: 9 }, { wch: 9 }];
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "체크 기록");
      XLSX.utils.book_append_sheet(wb, ws2, "회차");
      XLSX.writeFile(wb, "매장_재고_체크_" + today() + ".xlsx");
      toast("엑셀 파일을 내려받았습니다. (체크 " + rows.length + "건)", "success");
    } catch (err) { toast("엑셀 추출 실패: " + ((err && err.message) || err), "danger"); }
  }

  window.StoreCheck = { load: load, render: render, startSession: startSession, openSlot: openSlot, closeSheet: closeSheet, setActual: setActual, step: step, setZero: setZero,
    save: save, swapSlot: swapSlot, setFilter: setFilter, toggle: toggle, updateDashboard: updateDashboard, exportExcel: exportExcel, openAccess: openAccess, checkAccess: checkAccess, _state: state };

  function init() {
    var tab = document.getElementById("tab-storecheck");
    if (tab) new MutationObserver(function () { if (tab.classList.contains("active")) load(true); }).observe(tab, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && state.sheet) closeSheet(); });
    var tries = 0, boot = setInterval(function () {
      tries++;
      if (me() && client()) {
        clearInterval(boot); load(false);
        try { client().channel("public:store_check_access").on("postgres_changes", { event: "*", schema: "public", table: "store_check_access" }, function () { checkAccess().then(function () { render(); }); var m = document.getElementById("sc-access-modal"); if (m && m.classList.contains("active")) loadAccessList(); }).subscribe(); } catch (e) {}
      } else if (tries > 90) clearInterval(boot);
    }, 1000);
    setInterval(function () {
      var m = document.getElementById("tab-menu"), t = document.getElementById("tab-storecheck");
      if (((m && m.classList.contains("active")) || (t && t.classList.contains("active") && !state.sheet)) && !document.hidden && me()) load(true);
    }, 60000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
