// testbuy.js — Test Buy: 매장 디스플레이 점검 (회차당 5개)
// · 대상: testbuy_l2.js 의 L2 아티클 목록(TESTBUY_L2.xlsx)에서 랜덤 배정
// · 회차: 5개를 "점검 완료"해야 끝. 미입고로 교체한 아티클은 개수에 포함 안 됨
// · 아티클별: [L2 아티클이지만 송도 미입고? 네=다른 아티클로 교체 / 테스트바이 시작]
//            → 질문 6개(네/아니요) → 모두 네=통과 / 아니요 있으면 수정 안내
//            · "해당 장소에서 구입할 수 있습니까?" 아니요 → 디스플레이 잠시 빼두기
// · 기록: 회차를 만든 사람, 아티클별 점검한 사람, 5개째를 끝낸 사람
(function () {
  "use strict";

  var T_CHECKS = "test_buy_checks", T_SESSIONS = "test_buy_sessions";
  var ENABLED = true;
  var TARGET = 5;
  var RECENT_TESTED_DAYS = 30;   // 최근 점검한 아티클은 배정 제외
  var RECENT_SKIPPED_DAYS = 60;  // 미입고로 넘긴 아티클은 배정 제외

  var QUESTIONS = [
    { key: "pickup", icon: "fa-solid fa-location-dot", title: "해당 장소에서 구입할 수 있습니까?", short: "구입 가능", fix: "지금 구입할 수 없는 제품입니다. 고객 혼선이 없도록 디스플레이를 잠시 빼 두세요.", pull: true },
    { key: "display", icon: "fa-regular fa-eye", title: "제품이 진열/전시 되어 있나요?", short: "진열/전시", fix: "제품을 지정된 자리에 진열/전시해 주세요." },
    { key: "condition", icon: "fa-solid fa-wand-magic-sparkles", title: "제품 상태가 청결하고 완벽한 상태인가요?", short: "제품 상태", fix: "제품을 깨끗이 닦고, 빠진 부품이나 잘못된 조립을 바로잡아 주세요." },
    { key: "price_tag", icon: "fa-solid fa-tag", title: "가격표가 깔끔하고 올바르게 배치되어 있습니까?", short: "가격표", fix: "가격표를 올바른 위치에 깔끔하게 다시 붙여 주세요." },
    { key: "buying_instruction", icon: "fa-solid fa-file-invoice", title: "바잉인스트럭션이 제품에 맞게 게시되어 있나요?", short: "바잉인스트럭션", fix: "제품에 맞는 바잉인스트럭션으로 바꿔 게시해 주세요." },
    { key: "range_area", icon: "fa-solid fa-table-cells-large", title: "고객이 찾기를 기대하는 범위 영역에 배치하고 분류합니까?", short: "범위 영역", fix: "고객이 찾기 쉬운 범위 영역으로 옮겨 분류해 주세요." }
  ];
  var RESULT = {
    pass: { label: "통과", cls: "ok", icon: "fa-circle-check" },
    fixed: { label: "수정 완료", cls: "warn", icon: "fa-screwdriver-wrench" },
    fail: { label: "수정 필요", cls: "no", icon: "fa-circle-exclamation" },
    skip: { label: "미입고 교체", cls: "skip", icon: "fa-arrows-rotate" },
    swap: { label: "미리 교체", cls: "skip", icon: "fa-right-left" }
  };
  var SKIP_TEXT = { not_received: "L2 아티클 · 송도 미입고", swapped: "지금 점검이 어려워 미리 교체" };

  var state = { logs: [], sessions: [], loaded: false, loading: false, filter: "open", sheet: null };

  // ---------- 공통 ----------
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function today() { return typeof window.getTodayDateString === "function" ? window.getTodayDateString() : ymd(new Date()); }
  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return ymd(d); }
  function me() { try { return (window.currentUser || (typeof currentUser !== "undefined" ? currentUser : "") || "").trim(); } catch (e) { return ""; } }
  function isViewer() { try { return typeof isViewerUser !== "undefined" && isViewerUser; } catch (e) { return false; } }
  function isAdmin() { try { return typeof isAdminUser !== "undefined" && isAdminUser; } catch (e) { return false; } }
  function client() { try { return typeof supabaseClient !== "undefined" ? supabaseClient : null; } catch (e) { return null; } }
  function toast(msg, type) { if (typeof showToast === "function") showToast(msg, type || "success"); }
  function normNo(v) { return String(v || "").replace(/\D/g, ""); }
  function pad8(v) { var d = normNo(v); return d && d.length <= 8 ? d.padStart(8, "0") : d; }
  function fmtArt(v) { var d = pad8(v); return d.length === 8 ? d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6) : String(v || ""); }
  function fmtTime(iso) { if (!iso) return ""; var d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function l2List() { return Array.isArray(window.TESTBUY_L2_ARTICLES) ? window.TESTBUY_L2_ARTICLES : []; }
  // 품명: 마스터에 한글 품명이 있으면 그걸, 없으면 L2 목록의 품명
  var _masterNameMap = null;
  function displayName(artNo, fallback) {
    if (!_masterNameMap) {
      _masterNameMap = new Map();
      var cat = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
      cat.forEach(function (m) { var k = pad8(m.artNo || m.artno); if (k && (m.artName || m.artname)) _masterNameMap.set(k, m.artName || m.artname); });
      if (!_masterNameMap.size) _masterNameMap = null;
    }
    return (_masterNameMap && _masterNameMap.get(pad8(artNo))) || fallback || "(품명 없음)";
  }
  function thumb(artNo, name, size) {
    return typeof getProductThumbHtml === "function" ? getProductThumbHtml(pad8(artNo), name || "", size)
      : '<div class="tb-thumb-ph" style="width:' + size + 'px;height:' + size + 'px"><i class="fa-solid fa-couch"></i></div>';
  }
  function loadThumbs() { if (typeof loadProductThumbnails === "function") { try { loadProductThumbnails(); } catch (e) {} } }
  function rowResult(r) { return r.skip_reason ? (r.skip_reason === "swapped" ? "swap" : "skip") : (r.result || (r.status === "displayed" ? "pass" : "fail")); }
  function noKeys(a) { return QUESTIONS.filter(function (q) { return a && a[q.key] === "no"; }).map(function (q) { return q.key; }); }
  function computeResult(a, fixes, pulled) {
    var nos = noKeys(a);
    if (!nos.length) return "pass";
    return nos.every(function (k) { return k === "pickup" ? pulled : (fixes && fixes[k]); }) ? "fixed" : "fail";
  }
  // 구입할 수 없는 제품(첫 질문 아니요)이면 나머지 질문은 해당 없음
  function activeQuestions(a) { return a && a.pickup === "no" ? QUESTIONS.filter(function (q) { return q.key === "pickup"; }) : QUESTIONS; }
  function checks() { return state.logs.filter(function (r) { return !r.skip_reason; }); }
  function sessionChecks(sid) { return checks().filter(function (r) { return r.session_id === sid; }); }
  function sessionDoneCount(sid) { var s = new Set(); sessionChecks(sid).forEach(function (r) { s.add(pad8(r.artno)); }); return s.size; }
  function sameUser(a, b) { return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase() && !!String(a || "").trim(); }
  function isMine(sess) { return !!sess && sameUser(sess.created_by, me()); }
  // 내 진행 중 회차 (회차는 만든 사람만 진행·수정·완료할 수 있음)
  function activeSession() { return state.sessions.find(function (s) { return s.status === "in_progress" && isMine(s); }) || null; }
  function othersActive() { return state.sessions.filter(function (s) { return s.status === "in_progress" && !isMine(s); }); }
  function sessionLatest(sid) { var m = new Map(); sessionChecks(sid).forEach(function (r) { var k = pad8(r.artno); if (!m.has(k)) m.set(k, r); }); return m; }
  function sessionOpenFixes(sid) { var n = 0; sessionLatest(sid).forEach(function (r) { if (rowResult(r) === "fail") n++; }); return n; }
  function canEditRecord(r) {
    if (!r || isViewer()) return false;
    if (r.session_id) { var s = state.sessions.find(function (x) { return x.id === r.session_id; }); if (s && !isMine(s)) return false; }
    return sameUser(r.user, me());
  }
  function latestPerArticle(filterFn) {
    var latest = new Map();
    checks().forEach(function (r) { var k = pad8(r.artno); if (!latest.has(k)) latest.set(k, r); });
    var out = []; latest.forEach(function (r) { if (filterFn(r)) out.push(r); }); return out;
  }
  function openItems() { return latestPerArticle(function (r) { return rowResult(r) === "fail"; }); }
  function pulledItems() { return latestPerArticle(function (r) { return !!r.display_pulled; }); }

  // ---------- 배정 ----------
  function pickArticles(n, extraExclude) {
    var list = l2List();
    var testedCut = daysAgo(RECENT_TESTED_DAYS), skipCut = daysAgo(RECENT_SKIPPED_DAYS);
    var exclude = new Set(extraExclude || []);
    // 지금 진행 중인 모든 회차(다른 사람 포함)에 배정된 아티클은 제외 → 동시에 시작해도 겹치지 않음
    state.sessions.forEach(function (s) { if (s.status === "in_progress") (s.articles || []).forEach(function (x) { exclude.add(pad8(x.artno)); }); });
    state.logs.forEach(function (r) {
      var k = pad8(r.artno);
      if (r.skip_reason === "swapped") return; // 미리 교체한 아티클은 다음 회차에 다시 나올 수 있음
      if (r.skip_reason ? r.check_date >= skipCut : r.check_date >= testedCut) exclude.add(k);
    });
    var pool = list.filter(function (x) { return !exclude.has(pad8(x.a)); });
    if (pool.length < n) { // 후보가 모자라면 '최근 점검' 제외 규칙만 완화 (진행 중 회차와는 계속 안 겹치게)
      var busy = new Set(extraExclude || []);
      state.sessions.forEach(function (s) { if (s.status === "in_progress") (s.articles || []).forEach(function (x) { busy.add(pad8(x.artno)); }); });
      pool = list.filter(function (x) { return !busy.has(pad8(x.a)); });
    }
    var out = [];
    while (out.length < n && pool.length) {
      var i = Math.floor(Math.random() * pool.length);
      var x = pool.splice(i, 1)[0];
      out.push({ artno: pad8(x.a), artname: x.n || "", hfb: x.h || null });
    }
    return out;
  }

  // ---------- 불러오기 ----------
  async function load(force) {
    var c = client();
    if (!c || state.loading) return;
    if (state.loaded && !force) { render(); return; }
    state.loading = true; render();
    try {
      var r1 = await c.from(T_CHECKS).select("*").gte("check_date", daysAgo(90)).order("id", { ascending: false }).limit(5000);
      if (r1.error) throw r1.error;
      var r2 = await c.from(T_SESSIONS).select("*").gte("created_at", daysAgo(95) + "T00:00:00").order("id", { ascending: false }).limit(2000);
      if (r2.error) throw r2.error;
      state.logs = r1.data || []; state.sessions = r2.data || []; state.loaded = true;
    } catch (err) {
      console.warn("Test Buy load error:", err);
      if (force) toast("Test Buy 기록을 불러오지 못했습니다. 로그인 상태를 확인해 주세요.", "danger");
    } finally { state.loading = false; }
    render(); updateDashboard();
    if (state.loaded) {
      try { await resolveConflicts(); } catch (e) {}
      var mine = activeSession(); if (mine) maybeFinishSession(mine.id, true);
    }
  }

  function updateDashboard() {
    if (!ENABLED) return;
    var sub = document.getElementById("menu-task-testbuy-sub");
    var open = openItems().length, pulled = pulledItems().length;
    if (sub) {
      if (!state.loaded) sub.textContent = "매장 디스플레이 점검 · 1회 5개";
      else {
        var a = activeSession(), parts = [];
        if (a) { var of = sessionOpenFixes(a.id); parts.push("내 Test Buy " + sessionDoneCount(a.id) + "/" + (a.target || TARGET) + (of ? " · 수정 남음 " + of : "")); }
        else if (othersActive().length) parts.push("진행 중 " + othersActive().map(function (o) { return o.created_by; }).join(", "));
        else {
          var t = today(), doneToday = state.sessions.filter(function (s) { return s.status === "done" && s.completed_at && ymd(new Date(s.completed_at)) === t; }).length;
          parts.push(doneToday ? "오늘 " + doneToday + "회 완료" : "오늘 진행한 Test Buy 없음");
        }
        if (open) parts.push("수정 필요 " + open);
        if (pulled) parts.push("디스플레이 빼둠 " + pulled);
        sub.textContent = parts.join(" · ");
      }
    }
    var badge = document.getElementById("badge-testbuy");
    if (badge) { badge.textContent = open; badge.style.display = open > 0 ? "inline-block" : "none"; }
  }

  // ---------- 회차 시작 / 진행 ----------
  async function startSession() {
    if (isViewer()) { toast("Viewer(읽기 전용) 계정은 Test Buy를 시작할 수 없습니다.", "warning"); return; }
    if (!l2List().length) { toast("L2 아티클 목록(testbuy_l2.js)을 불러오지 못했습니다.", "danger"); return; }
    await load(true);
    if (activeSession()) { toast("내가 진행 중인 Test Buy가 있어요. 먼저 끝내 주세요.", "info"); render(); return; }
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }
    var arts = pickArticles(TARGET);
    if (arts.length < TARGET) { toast("배정할 아티클이 부족합니다.", "warning"); return; }
    try {
      var res = await c.from(T_SESSIONS).insert([{ target: TARGET, articles: arts, created_by: me() || null }]).select();
      if (res.error) throw res.error;
      if (res.data && res.data[0]) state.sessions.unshift(res.data[0]);
      await resolveConflicts();
      toast("Test Buy를 시작했습니다. 아티클 " + TARGET + "개를 점검해 주세요.", "success");
      render(); updateDashboard();
    } catch (err) { toast("Test Buy 시작 실패: " + (err.message || err), "danger"); }
  }

  // 두 명이 거의 동시에 시작해서 아티클이 겹친 경우: 나중에 만든 회차(번호가 큰 쪽)가 겹친 아티클을 조용히 바꿈
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
    var latest = sessionLatest(mine.id), changed = false;
    var arts = (mine.articles || []).map(function (x) {
      var k = pad8(x.artno);
      if (!taken.has(k) || latest.has(k)) return x;
      var next = pickArticles(1, (mine.articles || []).map(function (y) { return pad8(y.artno); }).concat(Array.from(taken)))[0];
      if (!next) return x;
      changed = true; taken.add(next.artno); return next;
    });
    if (!changed) return;
    var up = await c.from(T_SESSIONS).update({ articles: arts }).eq("id", mine.id).select();
    if (!up.error) { mine.articles = arts; render(); }
  }

  async function refreshSession(sid) {
    var c = client(); if (!c) return null;
    var res = await c.from(T_SESSIONS).select("*").eq("id", sid).single();
    if (res.error || !res.data) return null;
    var i = state.sessions.findIndex(function (s) { return s.id === sid; });
    if (i >= 0) state.sessions[i] = res.data; else state.sessions.unshift(res.data);
    return res.data;
  }

  // 회차의 5개를 다 끝냈으면 회차 완료 처리
  // 회차 완료 조건: 만든 사람 본인이 5개 점검 + 회차 안의 '수정 필요'를 모두 수정
  async function maybeFinishSession(sid, quiet) {
    var s = state.sessions.find(function (x) { return x.id === sid; });
    if (!s || s.status !== "in_progress" || !isMine(s)) return;
    var done = sessionDoneCount(sid);
    if (done < (s.target || TARGET)) return;
    var openFix = sessionOpenFixes(sid);
    if (openFix > 0) { if (!quiet) toast("5개 점검 완료! 남은 수정 " + openFix + "건까지 끝내야 Test Buy가 완료됩니다.", "info"); render(); updateDashboard(); return; }
    var c = client();
    var patch = { status: "done", completed_by: me() || null, completed_at: new Date().toISOString() };
    try {
      var res = await c.from(T_SESSIONS).update(patch).eq("id", sid).eq("status", "in_progress").select();
      if (res.error) throw res.error;
      Object.assign(s, patch);
      toast("🎉 Test Buy " + (s.target || TARGET) + "개 점검과 수정을 모두 끝냈습니다!", "success");
    } catch (err) { console.warn("finish session error", err); }
    render(); updateDashboard();
  }

  // ---------- 점검 창 ----------
  function ensureSheet() {
    var el = document.getElementById("tb-sheet");
    if (el) return el;
    el = document.createElement("div");
    el.id = "tb-sheet"; el.className = "tb-sheet-backdrop";
    el.innerHTML =
      '<div class="tb-sheet" role="dialog" aria-modal="true">' +
        '<div class="tb-sheet-top"><span id="tb-sheet-step" class="tb-sheet-step"></span><button type="button" class="tb-sheet-close" onclick="TestBuy.closeSheet()" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="tb-sheet-scroll"><div class="tb-sheet-product" id="tb-sheet-product"></div><div id="tb-sheet-body"></div></div>' +
        '<div class="tb-sheet-footer" id="tb-sheet-footer"></div>' +
      '</div>';
    el.addEventListener("click", function (e) { if (e.target === el) closeSheet(); });
    document.body.appendChild(el);
    return el;
  }
  function showSheet() { ensureSheet().classList.add("active"); document.body.classList.add("tb-sheet-open"); renderSheet(); var sc = document.querySelector("#tb-sheet .tb-sheet-scroll"); if (sc) sc.scrollTop = 0; }

  function openSlot(sid, artno) {
    if (isViewer()) { toast("Viewer(읽기 전용) 계정은 점검할 수 없습니다.", "warning"); return; }
    var s = state.sessions.find(function (x) { return x.id === sid; });
    if (!s) return;
    if (!isMine(s)) { toast(s.created_by + " 님이 시작한 Test Buy예요. 시작한 사람만 점검할 수 있습니다.", "warning"); return; }
    var doneRec = sessionLatest(sid).get(pad8(artno));
    if (doneRec && rowResult(doneRec) === "fail") { openFix(doneRec.id); return; }
    var a = (s.articles || []).find(function (x) { return pad8(x.artno) === pad8(artno); });
    if (!a) return;
    if (sessionChecks(sid).some(function (r) { return pad8(r.artno) === pad8(artno); })) { toast("이미 점검한 아티클입니다.", "info"); return; }
    state.sheet = { sessionId: sid, artNo: pad8(a.artno), artName: displayName(a.artno, a.artname), step: "precheck", answers: {}, fixes: {}, pulled: false, recordId: null };
    showSheet();
  }

  function openFix(id) {
    var r = state.logs.find(function (x) { return x.id === id; });
    if (!r) return;
    if (!canEditRecord(r)) { toast((r.user || "다른 사람") + " 님이 점검한 아티클이에요. 점검한 사람만 수정할 수 있습니다.", "warning"); return; }
    state.sheet = { sessionId: r.session_id, artNo: pad8(r.artno), artName: displayName(r.artno, r.artname), step: "fix", answers: r.answers || {},
                    fixes: Object.assign({}, r.fixes || {}), pulled: !!r.display_pulled, recordId: r.id };
    showSheet();
  }

  function closeSheet() {
    var el = document.getElementById("tb-sheet");
    if (el) el.classList.remove("active");
    document.body.classList.remove("tb-sheet-open");
    state.sheet = null;
  }

  function productHtml(s) {
    var sess = state.sessions.find(function (x) { return x.id === s.sessionId; });
    var prog = sess ? '<div class="tb-sheet-last">Test Buy ' + sessionDoneCount(sess.id) + '/' + (sess.target || TARGET) + ' 진행 중</div>' : '';
    return '<div class="tb-sheet-thumb">' + thumb(s.artNo, s.artName, 96) + '</div><div class="tb-sheet-info">' +
      '<div class="tb-sheet-name">' + esc(s.artName) + '</div>' +
      '<div class="tb-sheet-no">' + esc(fmtArt(s.artNo)) + '</div>' + prog + '</div>';
  }

  function renderSheet() {
    var s = state.sheet; if (!s) return;
    document.getElementById("tb-sheet-product").innerHTML = productHtml(s);
    var body = document.getElementById("tb-sheet-body"), foot = document.getElementById("tb-sheet-footer"), stepEl = document.getElementById("tb-sheet-step");
    if (s.step === "precheck") {
      stepEl.textContent = "1 / 3  확인";
      body.innerHTML =
        '<div class="tb-pre"><div class="tb-q-head"><i class="fa-solid fa-truck-ramp-box"></i><div><div class="tb-q-title">해당 제품은 L2 아티클이지만 송도에는 입고 안되었나요?</div>' +
        '<div class="tb-q-sub">입고가 안 된 제품이면 \'네\'를 누르세요. 다른 아티클로 자동 교체되며, 5개 개수에는 포함되지 않습니다.</div></div></div>' +
        '<div class="tb-pre-btns">' +
          '<button type="button" class="tb-pre-yes" onclick="TestBuy.notReceived()"><i class="fa-solid fa-arrows-rotate"></i> 네 <small>다른 아티클로 교체</small></button>' +
          '<button type="button" class="tb-pre-start" onclick="TestBuy.begin()"><i class="fa-solid fa-play"></i> 테스트바이 시작</button>' +
        '</div></div>';
      foot.innerHTML = "";
    } else if (s.step === "questions") {
      stepEl.textContent = "2 / 3  디스플레이 점검";
      body.innerHTML = '<div class="tb-sheet-quick"><button type="button" onclick="TestBuy.allYes()"><i class="fa-solid fa-check-double"></i> 전부 \'네\'로 체크</button></div>' +
        activeQuestions(s.answers).map(function (q) {
          var v = s.answers[q.key];
          return '<div class="tb-q' + (v ? " answered" : "") + (q.key === "pickup" ? " first" : "") + '" data-key="' + q.key + '">' +
            '<div class="tb-q-head"><i class="' + q.icon + '"></i><div><div class="tb-q-title">' + esc(q.title) + '</div></div></div>' +
            '<button type="button" class="tb-a yes' + (v === "yes" ? " active" : "") + '" onclick="TestBuy.answer(\'' + q.key + '\',\'yes\')"><span>네</span><span class="tb-radio"></span></button>' +
            '<button type="button" class="tb-a no' + (v === "no" ? " active" : "") + '" onclick="TestBuy.answer(\'' + q.key + '\',\'no\')"><span>아니요</span><span class="tb-radio"></span></button>' +
            (v === "no" ? '<div class="tb-inline-fix' + (q.pull ? " pull" : "") + '"><i class="fa-solid ' + (q.pull ? "fa-hand" : "fa-screwdriver-wrench") + '"></i>' +
              (q.pull ? "<b>디스플레이 잠시 빼두기</b> — " : "<b>수정 필요</b> — ") + esc(q.fix) + '</div>' : '') +
            (q.key === "pickup" && v === "no" ? '<div class="tb-skip-note"><i class="fa-solid fa-forward"></i> 구입할 수 없는 제품이라 나머지 질문 5개는 건너뜁니다.</div>' : '') +
          '</div>';
        }).join("") +
        '<div class="tb-sheet-memo"><label for="tb-sheet-memo-input"><i class="fa-regular fa-pen-to-square"></i> 메모 <span>(선택)</span></label>' +
        '<textarea id="tb-sheet-memo-input" rows="2" placeholder="특이사항이 있으면 적어 주세요">' + esc(s.memo || "") + '</textarea></div>';
      var aq = activeQuestions(s.answers);
      var n = aq.filter(function (q) { return s.answers[q.key]; }).length, nos = noKeys(s.answers).length;
      var label = n < aq.length ? "완료 (" + n + "/" + aq.length + ")"
        : s.answers.pickup === "no" ? "완료 · 디스플레이 빼러 가기"
        : nos ? "완료 · 아니요 " + nos + "개 수정하러 가기" : "완료 · 통과";
      foot.innerHTML = '<button type="button" id="tb-sheet-done" class="tb-sheet-done" onclick="TestBuy.submit()"' + (n < aq.length ? " disabled" : "") + '>' + label + '</button>';
    } else {
      stepEl.textContent = "3 / 3  수정하기";
      var keys = noKeys(s.answers);
      var doneCnt = keys.filter(function (k) { return k === "pickup" ? s.pulled : s.fixes[k]; }).length;
      body.innerHTML = '<div class="tb-fix-head"><i class="fa-solid fa-screwdriver-wrench"></i><div><b>아니요 ' + keys.length + '개를 바로 고쳐 주세요</b>' +
        '<span>고친 항목은 \'수정 완료\'를 눌러 체크하세요. 이 아티클의 점검은 이미 저장되어 5개 개수에 들어갔고, 지금 못 고치면 나중에 목록에서 이어서 할 수 있어요.</span></div></div>' +
        keys.map(function (k) {
          var q = QUESTIONS.find(function (x) { return x.key === k; }), done = q.pull ? s.pulled : !!s.fixes[k];
          return '<div class="tb-fix-item' + (done ? " done" : "") + (q.pull ? " pull" : "") + '"><div class="tb-fix-title"><i class="' + q.icon + '"></i>' + esc(q.title) + '</div>' +
            '<div class="tb-fix-guide">' + esc(q.fix) + '</div>' +
            '<button type="button" class="tb-fix-btn' + (done ? " done" : "") + '" onclick="TestBuy.toggleFix(\'' + k + '\')">' +
              (done ? '<i class="fa-solid fa-circle-check"></i> ' + (q.pull ? "디스플레이 빼둠" : "수정 완료") : (q.pull ? '<i class="fa-solid fa-hand"></i> 디스플레이 뺐어요' : '<i class="fa-regular fa-circle"></i> 수정 완료')) +
            '</button></div>';
        }).join("");
      foot.innerHTML = '<div class="tb-fix-foot"><button type="button" class="tb-later" onclick="TestBuy.saveFix(true)">나중에 할게요</button>' +
        '<button type="button" class="tb-sheet-done" onclick="TestBuy.saveFix(false)"' + (doneCnt < keys.length ? " disabled" : "") + '>' +
        (doneCnt < keys.length ? "모두 수정하면 완료 (" + doneCnt + "/" + keys.length + ")" : "수정 완료") + '</button></div>';
    }
    loadThumbs();
  }

  // 아티클 교체 공통: 기록(누가·왜) 남기고 회차의 같은 자리에 다른 아티클 배정 (5개 개수에는 포함 안 됨)
  async function replaceArticle(sessionId, artNo, artName, reason) {
    var c = client(); if (!c) throw new Error("서버에 연결할 수 없습니다.");
    var ins = await c.from(T_CHECKS).insert([{ check_date: today(), artno: pad8(artNo), artname: artName || null, status: "not_displayed",
      skip_reason: reason, session_id: sessionId || null, user: me() || null }]).select();
    if (ins.error) throw ins.error;
    if (ins.data && ins.data[0]) state.logs.unshift(ins.data[0]);
    var sess = sessionId ? (await refreshSession(sessionId)) : null;
    var arts = sess ? (sess.articles || []).slice() : [];
    var next = pickArticles(1, arts.map(function (x) { return pad8(x.artno); }).concat([pad8(artNo)]))[0];
    if (!next) return null;
    if (sess) {
      var idx = arts.findIndex(function (x) { return pad8(x.artno) === pad8(artNo); });
      if (idx >= 0) arts[idx] = next; else arts.push(next);
      var up = await c.from(T_SESSIONS).update({ articles: arts }).eq("id", sess.id).select();
      if (up.error) throw up.error;
      sess.articles = arts;
    }
    return next;
  }

  // 점검 창 1단계: 미입고 → 다른 아티클로 교체
  async function notReceived() {
    var s = state.sheet; if (!s) return;
    try {
      var next = await replaceArticle(s.sessionId, s.artNo, s.artName, "not_received");
      render(); updateDashboard();
      if (!next) { toast("미입고로 기록했습니다. 교체할 아티클이 없습니다.", "warning"); closeSheet(); return; }
      toast("[" + fmtArt(s.artNo) + "] 미입고로 기록하고 다른 아티클로 교체했습니다.", "info");
      state.sheet = { sessionId: s.sessionId, artNo: next.artno, artName: displayName(next.artno, next.artname), step: "precheck", answers: {}, fixes: {}, pulled: false, recordId: null };
      renderSheet();
      var sc = document.querySelector("#tb-sheet .tb-sheet-scroll"); if (sc) sc.scrollTop = 0;
    } catch (err) { toast("교체 실패: " + (err.message || err), "danger"); }
  }

  // 회차 목록에서 카드를 밀어서 미리 교체 (가구처럼 지금 바로 점검이 어려운 경우)
  var swapping = false;
  async function swapSlot(sid, artno) {
    if (isViewer() || swapping) return;
    var s = state.sessions.find(function (x) { return x.id === sid; });
    if (s && !isMine(s)) { toast("시작한 사람만 아티클을 교체할 수 있습니다.", "warning"); render(); return; }
    var a = s && (s.articles || []).find(function (x) { return pad8(x.artno) === pad8(artno); });
    if (!a) return;
    if (sessionChecks(sid).some(function (r) { return pad8(r.artno) === pad8(artno); })) { toast("이미 점검한 아티클은 교체할 수 없습니다.", "info"); render(); return; }
    swapping = true;
    try {
      var next = await replaceArticle(sid, a.artno, displayName(a.artno, a.artname), "swapped");
      if (!next) toast("교체할 아티클이 없습니다.", "warning");
      else toast("[" + fmtArt(a.artno) + "] → [" + fmtArt(next.artno) + "] 아티클을 교체했습니다.", "info");
    } catch (err) { toast("교체 실패: " + (err.message || err), "danger"); }
    swapping = false;
    render(); updateDashboard();
  }

  // 카드 밀기: 조금 밀면 '교체' 버튼이 보이고, 40% 넘게 밀면 바로 교체
  function bindSwipes() {
    Array.prototype.forEach.call(document.querySelectorAll(".tb-slot-wrap.pending"), function (wrap) {
      if (wrap.dataset.bound) return; wrap.dataset.bound = "1";
      var card = wrap.querySelector(".tb-slot"), startX = 0, startY = 0, dx = 0, dragging = false, decided = false, horizontal = false, open = false;
      var REVEAL = 96;
      function setX(x, anim) { card.style.transition = anim ? "transform .2s ease" : "none"; card.style.transform = "translateX(" + x + "px)"; }
      function down(e) {
        var pt = e.touches ? e.touches[0] : e;
        startX = pt.clientX; startY = pt.clientY; dx = 0; dragging = true; decided = false; horizontal = false;
      }
      function move(e) {
        if (!dragging) return;
        var pt = e.touches ? e.touches[0] : e, mx = pt.clientX - startX, my = pt.clientY - startY;
        if (!decided && (Math.abs(mx) > 8 || Math.abs(my) > 8)) { decided = true; horizontal = Math.abs(mx) > Math.abs(my); }
        if (!horizontal) return;
        if (e.cancelable) e.preventDefault();
        dx = Math.min(0, mx + (open ? -REVEAL : 0));
        setX(dx, false);
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

  function begin() { if (!state.sheet) return; state.sheet.step = "questions"; renderSheet(); var sc = document.querySelector("#tb-sheet .tb-sheet-scroll"); if (sc) sc.scrollTop = 0; }
  function keepMemo() { var m = document.getElementById("tb-sheet-memo-input"); if (m && state.sheet) state.sheet.memo = m.value; }

  function answer(key, v) {
    var s = state.sheet; if (!s) return;
    keepMemo();
    var sc = document.querySelector("#tb-sheet .tb-sheet-scroll"), top = sc ? sc.scrollTop : 0;
    s.answers[key] = v; renderSheet(); if (sc) sc.scrollTop = top;
    if (v === "yes") {
      var aq = activeQuestions(s.answers);
      var idx = aq.findIndex(function (q) { return q.key === key; });
      var next = aq.find(function (q, i) { return i > idx && !s.answers[q.key]; });
      if (next) { var node = document.querySelector('#tb-sheet .tb-q[data-key="' + next.key + '"]'); if (node) setTimeout(function () { node.scrollIntoView({ behavior: "smooth", block: "start" }); }, 100); }
    }
  }
  function allYes() {
    var s = state.sheet; if (!s) return;
    keepMemo(); QUESTIONS.forEach(function (q) { s.answers[q.key] = "yes"; }); renderSheet();
    var d = document.getElementById("tb-sheet-done"); if (d) d.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  async function submit() {
    var s = state.sheet; if (!s) return;
    if (isViewer()) { toast("Viewer(읽기 전용) 계정은 등록할 수 없습니다.", "warning"); return; }
    keepMemo();
    var aq = activeQuestions(s.answers);
    if (aq.some(function (q) { return !s.answers[q.key]; })) { toast("질문에 모두 답해 주세요.", "danger"); return; }
    if (s.answers.pickup === "no") QUESTIONS.forEach(function (q) { if (q.key !== "pickup") s.answers[q.key] = "na"; }); // 해당 없음
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }
    var result = computeResult(s.answers, s.fixes, s.pulled);
    var row = { check_date: today(), artno: s.artNo, artname: s.artName || null, status: s.answers.display === "yes" ? "displayed" : "not_displayed",
                answers: s.answers, result: result, fixes: {}, display_pulled: false, session_id: s.sessionId || null,
                memo: s.memo && s.memo.trim() ? s.memo.trim() : null, user: me() || null };
    var btn = document.getElementById("tb-sheet-done"); if (btn) { btn.disabled = true; btn.textContent = "저장 중…"; }
    try {
      var res = await c.from(T_CHECKS).insert([row]).select();
      if (res.error) throw res.error;
      var saved = res.data && res.data[0]; if (saved) state.logs.unshift(saved);
      render(); updateDashboard();
      if (result === "pass") {
        toast("[" + fmtArt(s.artNo) + "] 통과! 👍", "success");
        var sid = s.sessionId; closeSheet(); if (sid) await maybeFinishSession(sid);
      } else {
        s.recordId = saved ? saved.id : null; s.step = "fix"; renderSheet();
        var sc = document.querySelector("#tb-sheet .tb-sheet-scroll"); if (sc) sc.scrollTop = 0;
      }
    } catch (err) { toast("저장 실패: " + (err.message || err), "danger"); renderSheet(); }
  }

  function toggleFix(k) { var s = state.sheet; if (!s) return; if (k === "pickup") s.pulled = !s.pulled; else s.fixes[k] = !s.fixes[k]; renderSheet(); }

  async function saveFix(later) {
    var s = state.sheet; if (!s) return;
    var result = computeResult(s.answers, s.fixes, s.pulled), c = client();
    if (c && s.recordId) {
      try {
        var res = await c.from(T_CHECKS).update({ fixes: s.fixes, display_pulled: !!s.pulled, result: result }).eq("id", s.recordId).select();
        if (res.error) throw res.error;
        var r = state.logs.find(function (x) { return x.id === s.recordId; });
        if (r) { r.fixes = Object.assign({}, s.fixes); r.display_pulled = !!s.pulled; r.result = result; }
      } catch (err) { toast("저장 실패: " + (err.message || err), "danger"); return; }
    }
    if (result === "fixed") toast("[" + fmtArt(s.artNo) + "] 수정 완료로 저장했습니다." + (s.pulled ? " (디스플레이 빼둠)" : ""), "success");
    else if (later) toast("저장했습니다. 남은 항목은 목록의 '수정하기'에서 이어서 할 수 있어요.", "info");
    var sid = s.sessionId; closeSheet(); render(); updateDashboard();
    if (sid) await maybeFinishSession(sid);
  }

  async function restoreDisplay(id) {
    var r = state.logs.find(function (x) { return x.id === id; });
    if (r && !canEditRecord(r)) { toast((r.user || "다른 사람") + " 님만 재진열을 기록할 수 있습니다.", "warning"); return; }
    if (!r || !confirm("[" + fmtArt(r.artno) + "] 구입할 수 있게 되어 디스플레이를 다시 진열했나요?")) return;
    try {
      var res = await client().from(T_CHECKS).update({ display_pulled: false }).eq("id", id).select();
      if (res.error) throw res.error;
      r.display_pulled = false; render(); updateDashboard(); toast("재진열로 기록했습니다.", "success");
    } catch (err) { toast("저장 실패: " + (err.message || err), "danger"); }
  }

  function setFilter(f) { state.filter = f; render(); }
  function toggleSession(id) { var el = document.getElementById("tb-sess-detail-" + id); if (el) el.style.display = el.style.display === "none" ? "" : "none"; loadThumbs(); }

  // ---------- 화면 ----------
  function checkRowHtml(r, opts) {
    opts = opts || {};
    var rr = rowResult(r), res = RESULT[rr], ans = r.answers || {}, fx = r.fixes || {};
    var issues = noKeys(ans).map(function (k) {
      var qq = QUESTIONS.find(function (x) { return x.key === k; });
      if (k === "pickup") return '<span class="tb-issue pull">' + (r.display_pulled ? "디스플레이 빼둠" : "구입 불가 · 디스플레이 빼야 함") + '</span>';
      return '<span class="tb-issue ' + (fx[k] ? "fixed" : "no") + '">' + esc(qq.short) + (fx[k] ? " ✓ 수정" : " ✕") + '</span>';
    }).join("");
    var actions = "";
    if (!opts.compact && canEditRecord(r)) {
      if (rr === "fail") actions += '<button type="button" class="tb-mini fix" onclick="TestBuy.openFix(' + r.id + ')">수정하기</button>';
      if (r.display_pulled) actions += '<button type="button" class="tb-mini ok" onclick="TestBuy.restoreDisplay(' + r.id + ')">재진열</button>';
    }
    return '<div class="tb-row' + (opts.compact ? " compact" : "") + '">' + thumb(r.artno, r.artname, 44) +
      '<div class="tb-row-body"><div class="tb-row-title"><span class="tb-chip ' + res.cls + '"><i class="fa-solid ' + res.icon + '"></i>' + esc(res.label) + '</span> <b>' + esc(displayName(r.artno, r.artname)) + '</b></div>' +
      '<div class="tb-row-meta"><span class="tb-row-no">' + esc(fmtArt(r.artno)) + '</span> · ' + (r.skip_reason ? "교체" : "점검") + ' <b class="tb-who">' + esc(r.user || "-") + '</b> · ' + esc(fmtTime(r.created_at)) + '</div>' +
      (r.skip_reason ? '<div class="tb-issues"><span class="tb-issue skip">' + esc(SKIP_TEXT[r.skip_reason] || "교체") + '</span></div>' : (issues ? '<div class="tb-issues">' + issues + '</div>' : '')) +
      (r.memo ? '<div class="tb-row-memo">' + esc(r.memo) + '</div>' : '') + '</div>' +
      (actions ? '<div class="tb-row-actions">' + actions + '</div>' : (!opts.compact && !r.skip_reason && (rr === "fail" || r.display_pulled) ? '<div class="tb-row-actions"><span class="tb-owner-note">담당 ' + esc(r.user || "-") + '</span></div>' : '')) + '</div>';
  }

  function sessionCardHtml(a, readOnly) {
    var done = sessionDoneCount(a.id), target = a.target || TARGET, openFix = sessionOpenFixes(a.id);
    var latest = sessionLatest(a.id);
    var skips = state.logs.filter(function (r) { return r.session_id === a.id && r.skip_reason; }).length; // 미입고 + 미리 교체
    var status = done >= target ? (openFix ? '<div class="tb-sess-alert"><i class="fa-solid fa-screwdriver-wrench"></i> 5개 점검 완료 · 수정 ' + openFix + '건이 남아 있어요. 수정까지 끝내야 완료됩니다.</div>' : '') : '';
    return '<div class="tb-sess' + (readOnly ? " readonly" : "") + '">' +
      '<div class="tb-sess-head"><div><b>' + (readOnly ? esc(a.created_by || "-") + ' 님 진행 중' : 'Test Buy 진행 중') + '</b><span>생성 <b class="tb-who">' + esc(a.created_by || "-") + '</b> · ' + esc(fmtTime(a.created_at)) +
        (skips ? ' · 교체 ' + skips + '건' : '') + (openFix ? ' · 수정 남음 ' + openFix : '') + '</span></div>' +
      '<div class="tb-sess-count"><b>' + done + '</b>/' + target + '</div></div>' +
      '<div class="tb-sess-bar"><span style="width:' + Math.min(100, done / target * 100) + '%"></span></div>' + status +
      '<div class="tb-slots">' + (a.articles || []).map(function (x, i) {
        var r = latest.get(pad8(x.artno)), name = displayName(x.artno, x.artname);
        var st = r ? RESULT[rowResult(r)] : null;
        var pending = !r && !readOnly && !isViewer();
        var needFix = r && rowResult(r) === "fail" && !readOnly;
        return '<div class="tb-slot-wrap' + (pending ? " pending" : "") + '" data-sid="' + a.id + '" data-art="' + pad8(x.artno) + '">' +
          (pending ? '<button type="button" class="tb-slot-swap"><i class="fa-solid fa-right-left"></i><span>교체</span></button>' : '') +
          '<div class="tb-slot' + (r ? " done" : "") + (needFix ? " needfix" : "") + '"' + (needFix ? ' onclick="TestBuy.openFix(' + r.id + ')"' : '') + '>' +
          '<span class="tb-slot-num">' + (i + 1) + '</span>' + thumb(x.artno, name, 56) +
          '<div class="tb-slot-body"><div class="tb-slot-name">' + esc(name) + '</div><div class="tb-slot-no">' + esc(fmtArt(x.artno)) + '</div>' +
          (r ? '<div class="tb-slot-state"><span class="tb-chip ' + st.cls + '"><i class="fa-solid ' + st.icon + '"></i>' + esc(st.label) + '</span> ' + esc(fmtTime(r.created_at)) + (needFix ? ' · <b class="tb-fix-link">눌러서 수정</b>' : '') + '</div>'
             : '<div class="tb-slot-state wait">' + (readOnly ? "점검 대기" : "점검 대기 · 눌러서 시작") + '</div>') + '</div>' +
          (pending || needFix ? '<i class="fa-solid fa-chevron-right tb-slot-go"></i>' : '') + '</div></div>';
      }).join("") + '</div>' +
      (!readOnly && !isViewer() ? '<div class="tb-swipe-hint"><i class="fa-solid fa-hand-point-left"></i> 지금 점검하기 어려운 아티클은 카드를 왼쪽으로 밀어 교체하세요 (개수에 포함 안 됨)</div>' : '') +
      '</div>';
  }

  // ---------- 현황 대시보드 (오늘 / 이번 달 / 사용자별) ----------
  function renderStats() {
    var box = document.getElementById("tb-stats");
    if (!box) return;
    var now = new Date(), t = today(), month = t.slice(0, 7), monthLabel = (now.getMonth() + 1) + "월";
    var monthChecks = checks().filter(function (r) { return String(r.check_date).slice(0, 7) === month; });
    var todayChecks = monthChecks.filter(function (r) { return r.check_date === t; });
    var doneSessions = state.sessions.filter(function (x) { return x.status === "done" && x.completed_at; });
    var monthSessions = doneSessions.filter(function (x) { return ymd(new Date(x.completed_at)).slice(0, 7) === month; });
    var todaySessions = monthSessions.filter(function (x) { return ymd(new Date(x.completed_at)) === t; });
    var fixedMonth = monthChecks.filter(function (r) { return rowResult(r) === "fixed"; }).length;
    var passMonth = monthChecks.filter(function (r) { return rowResult(r) === "pass"; }).length;

    var fixedToday = todayChecks.filter(function (r) { return rowResult(r) === "fixed"; }).length;

    function tile(num, label, cls) { return '<div class="tb-kpi' + (cls ? " " + cls : "") + '"><b>' + num + '</b><span>' + label + '</span></div>'; }
    box.innerHTML =
      '<div class="tb-dash">' +
        '<div class="tb-dash-title"><span><i class="fa-solid fa-chart-simple"></i> Test Buy 현황</span><small>' + esc(monthLabel + " " + now.getDate() + "일 기준") + '</small></div>' +
        '<div class="tb-dash-label">오늘</div>' +
        '<div class="tb-kpis">' +
          tile(todayChecks.length, "전체 아티클", "main") +
          tile(todaySessions.length, "완료된 테스트바이") +
          tile(fixedToday, "수정된 테스트바이", "fix") +
        '</div>' +
        '<div class="tb-dash-label">' + esc(monthLabel) + ' 누적</div>' +
        '<div class="tb-kpis">' +
          tile(monthChecks.length, "전체 아티클", "main") +
          tile(monthSessions.length, "완료된 테스트바이") +
          tile(fixedMonth, "수정된 테스트바이", "fix") +
        '</div>' +
        (monthChecks.length ? '<div class="tb-dash-sub">통과 ' + passMonth + ' · 수정 완료 ' + fixedMonth + ' · 수정 필요 ' + (monthChecks.length - passMonth - fixedMonth) + '</div>' : '') +
      '</div>';
  }

  function renderActive() {
    var box = document.getElementById("tb-session");
    if (!box) return;
    var a = activeSession(), others = othersActive(), html = "";
    if (a) html += sessionCardHtml(a, false);
    else html += isViewer() ? "" :
      '<button type="button" class="tb-start-btn" onclick="TestBuy.startSession()"><i class="fa-solid fa-shuffle"></i>' +
      '<span><b>새 Test Buy 시작</b><small>L2 아티클 ' + l2List().length + '개 중 5개를 랜덤으로 배정합니다 · 시작한 사람이 끝까지 진행</small></span></button>';
    if (others.length) {
      html += '<details class="tb-others"' + (isViewer() ? " open" : "") + '><summary><i class="fa-solid fa-users"></i> 다른 사람이 진행 중인 Test Buy ' + others.length + '건 <span>(보기만 가능)</span></summary>' +
        others.map(function (o) { return sessionCardHtml(o, true); }).join("") + '</details>';
    }
    if (!html) html = '<div class="tb-empty">진행 중인 Test Buy가 없습니다.</div>';
    box.innerHTML = html;
  }

  function renderHistory() {
    var box = document.getElementById("tb-history");
    if (!box) return;
    var done = state.sessions.filter(function (s) { return s.status === "done"; }).slice(0, 20);
    if (!done.length) { box.innerHTML = '<div class="tb-empty">완료된 테스트바이가 아직 없습니다.</div>'; return; }
    box.innerHTML = done.map(function (s) {
      var rows = sessionChecks(s.id), cnt = { pass: 0, fixed: 0, fail: 0 };
      rows.forEach(function (r) { var k = rowResult(r); if (cnt[k] !== undefined) cnt[k]++; });
      var skips = state.logs.filter(function (r) { return r.session_id === s.id && r.skip_reason; });
      var workers = Array.from(new Set(rows.map(function (r) { return r.user; }).filter(Boolean)));
      return '<div class="tb-hist">' +
        '<button type="button" class="tb-hist-head" onclick="TestBuy.toggleSession(' + s.id + ')">' +
          '<div class="tb-hist-main"><b>' + esc(fmtTime(s.completed_at || s.created_at)) + ' 완료</b>' +
          '<span>생성 <b class="tb-who">' + esc(s.created_by || "-") + '</b> → 완료 <b class="tb-who">' + esc(s.completed_by || "-") + '</b>' + (workers.length ? ' · 점검 ' + esc(workers.join(", ")) : '') + '</span></div>' +
          '<div class="tb-hist-stats"><span class="ok">통과 ' + cnt.pass + '</span><span class="warn">수정 ' + cnt.fixed + '</span>' + (cnt.fail ? '<span class="no">미수정 ' + cnt.fail + '</span>' : '') + '</div>' +
        '</button>' +
        '<div id="tb-sess-detail-' + s.id + '" class="tb-hist-detail" style="display:none;">' + rows.concat(skips).map(function (r) { return checkRowHtml(r, { compact: false }); }).join("") + '</div>' +
      '</div>';
    }).join("");
  }

  function renderIssues() {
    var list = document.getElementById("tb-list");
    if (!list) return;
    var open = openItems(), pulled = pulledItems();
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set("tb-stat-open", open.length); set("tb-stat-pulled", pulled.length);
    set("tb-stat-sessions", state.sessions.filter(function (s) { return s.status === "done"; }).length);
    Array.prototype.forEach.call(document.querySelectorAll(".tb-stat"), function (b) { b.classList.toggle("active", b.dataset.filter === state.filter); });
    var histWrap = document.getElementById("tb-history-wrap"), listWrap = document.getElementById("tb-list-wrap");
    if (histWrap) histWrap.style.display = state.filter === "sessions" ? "" : "none";
    if (listWrap) listWrap.style.display = state.filter === "sessions" ? "none" : "";
    set("tb-list-title", state.filter === "open" ? "수정 필요 (아직 안 고친 아티클)" : "디스플레이 빼둔 아티클");
    var rows = state.filter === "open" ? open : pulled;
    list.innerHTML = rows.length ? rows.map(function (r) { return checkRowHtml(r); }).join("")
      : '<div class="tb-empty">' + (state.filter === "open" ? "수정할 아티클이 없습니다 👍" : "디스플레이를 빼 둔 아티클이 없습니다.") + '</div>';
  }

  function render() {
    if (!document.getElementById("tab-testbuy")) return;
    if (!state.loaded) {
      var b = document.getElementById("tb-session"); if (b) b.innerHTML = '<div class="tb-empty">' + (state.loading ? "불러오는 중…" : "기록을 불러오려면 새로고침을 눌러 주세요.") + '</div>';
      return;
    }
    renderStats(); renderActive(); renderIssues(); renderHistory(); bindSwipes(); loadThumbs();
  }

  window.TestBuy = {
    load: load, render: render, setFilter: setFilter, startSession: startSession, openSlot: openSlot, openFix: openFix,
    closeSheet: closeSheet, notReceived: notReceived, begin: begin, answer: answer, allYes: allYes, submit: submit,
    toggleFix: toggleFix, saveFix: saveFix, restoreDisplay: restoreDisplay, toggleSession: toggleSession, updateDashboard: updateDashboard, swapSlot: swapSlot
  };

  function init() {
    if (!ENABLED) return;
    var tab = document.getElementById("tab-testbuy");
    if (tab) new MutationObserver(function () { if (tab.classList.contains("active")) load(true); }).observe(tab, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && state.sheet) closeSheet(); });
    var tries = 0;
    var boot = setInterval(function () {
      tries++;
      var ready = me() && client() && (typeof historyLogs !== "undefined" && historyLogs.length > 0);
      if (ready) { clearInterval(boot); load(false); } else if (tries > 90) clearInterval(boot);
    }, 1000);
    setInterval(function () {
      var m = document.getElementById("tab-menu"), t = document.getElementById("tab-testbuy");
      if (((m && m.classList.contains("active")) || (t && t.classList.contains("active") && !state.sheet)) && !document.hidden && me()) load(true);
    }, 60000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
