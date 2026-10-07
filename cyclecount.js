// cyclecount.js — Cycle Counting: 창고 재고 실사 (1회 15개 = B1·B2·B3 구역별 랜덤 5개)
// · 배정: 창고 재고가 있는 품목 중 오래 확인 안 한 품목 우선 (5일+ → 3일+ → 나머지), 최근 7일 안에 센 품목 제외
// · 시작한 사람만 끝까지 진행 · 동시에 시작해도 품목이 겹치지 않음 · 카드를 왼쪽으로 밀면 교체(개수 미포함)
// · 실사: 전산 재고와 실제 수량 비교 → 일치 / 차이 보정(입출고 기록에 보정 입고·출고 추가)
// · 기존 "랜덤 체크 완료" 배지(재고 조회 화면)도 계속 표시되도록 기존 기록에도 함께 저장
(function () {
  "use strict";

  var T_CHECKS = "cycle_count_checks", T_SESSIONS = "cycle_count_sessions";
  var ZONES = ["B1", "B2", "B3"];
  var PER_ZONE = 5;
  var RECENT_DAYS = 7;   // 최근 이 기간 안에 센 품목은 배정 제외

  var state = { logs: [], sessions: [], loaded: false, loading: false, filter: "adjusted", sheet: null };

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

  function stockMap() { try { if (typeof invalidateStockCache === "function") {} return typeof buildStockMap === "function" ? buildStockMap() : new Map(); } catch (e) { return new Map(); } }
  function stockEntry(artNo) {
    var k = pad8(artNo), m = stockMap(), e = m.get(k);
    if (!e) m.forEach(function (v, key) { if (!e && pad8(key) === k) e = v; });
    return e || null;
  }
  function currentStock(artNo) { var e = stockEntry(artNo); return e ? (Number(e.currentStock) || 0) : 0; }
  function currentLocation(artNo) {
    var k = pad8(artNo), cat = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
    var m = cat.find(function (x) { return pad8(x.artNo || x.artno) === k; });
    return (m && m.location) || "미지정";
  }
  function zoneMatch(loc, zone) {
    if (typeof isLocationMatch === "function") { try { return isLocationMatch(loc, zone); } catch (e) {} }
    loc = String(loc || "");
    if (zone === "B2") return loc.indexOf("B2") !== -1 && loc.indexOf("램프") === -1;
    return loc.indexOf(zone) !== -1;
  }

  function checks() { return state.logs.filter(function (r) { return !r.skip_reason; }); }
  function sessionChecks(sid) { return checks().filter(function (r) { return r.session_id === sid; }); }
  function sessionLatest(sid) { var m = new Map(); sessionChecks(sid).forEach(function (r) { var k = pad8(r.artno); if (!m.has(k)) m.set(k, r); }); return m; }
  function sessionDoneCount(sid) { return sessionLatest(sid).size; }
  function activeSession() { return state.sessions.find(function (s) { return s.status === "in_progress" && isMine(s); }) || null; }
  function othersActive() { return state.sessions.filter(function (s) { return s.status === "in_progress" && !isMine(s); }); }

  // ---------- 배정 ----------
  function busySet(extra) {
    var set = new Set(extra || []);
    state.sessions.forEach(function (s) { if (s.status === "in_progress") (s.articles || []).forEach(function (x) { set.add(pad8(x.artno)); }); });
    return set;
  }
  function pickForZone(zone, n, extraExclude) {
    var busy = busySet(extraExclude), cut = daysAgo(RECENT_DAYS);
    var recent = new Set(); checks().forEach(function (r) { if (r.check_date >= cut) recent.add(pad8(r.artno)); });
    var now = Date.now(), tiers = [[], [], []], fallback = [];
    stockMap().forEach(function (e, key) {
      var k = pad8(e.artNo || key);
      if (!k || busy.has(k) || !(Number(e.currentStock) > 0)) return;
      var loc = currentLocation(k);
      if (!zoneMatch(loc, zone)) return;
      var item = { artno: k, artname: e.artName || "", zone: zone, location: loc };
      if (recent.has(k)) { fallback.push(item); return; }
      var days = Infinity;
      try {
        var info = typeof window.getProductLatestUpdateTime === "function" ? window.getProductLatestUpdateTime(k) : null;
        if (info && info.raw instanceof Date && !isNaN(info.raw)) days = (now - info.raw.getTime()) / 86400000;
      } catch (err) {}
      tiers[days >= 5 ? 0 : days >= 3 ? 1 : 2].push(item);
    });
    tiers.push(fallback); // 후보가 모자라면 최근 센 품목도 사용
    var out = [];
    tiers.forEach(function (pool) {
      while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    });
    return out;
  }

  // ---------- 불러오기 ----------
  async function load(force) {
    var c = client();
    if (!c || state.loading) return;
    if (state.loaded && !force) { render(); return; }
    state.loading = true; render();
    try {
      var r1 = await c.from(T_CHECKS).select("*").gte("check_date", daysAgo(95)).order("id", { ascending: false }).limit(10000);
      if (r1.error) throw r1.error;
      var r2 = await c.from(T_SESSIONS).select("*").gte("created_at", daysAgo(95) + "T00:00:00").order("id", { ascending: false }).limit(2000);
      if (r2.error) throw r2.error;
      state.logs = r1.data || []; state.sessions = r2.data || []; state.loaded = true;
    } catch (err) {
      console.warn("Cycle Counting load error:", err);
      if (force) toast("Cycle Counting 기록을 불러오지 못했습니다. 로그인 상태를 확인해 주세요.", "danger");
    } finally { state.loading = false; }
    render(); updateDashboard();
    if (state.loaded) { try { await resolveConflicts(); } catch (e) {} var mine = activeSession(); if (mine) maybeFinish(mine.id, true); }
  }

  function updateDashboard() {
    var sub = document.getElementById("menu-task-cycle-sub");
    var cnt = document.getElementById("menu-task-cycle-count");
    if (!state.loaded) { if (sub) sub.textContent = "창고 재고 실사 · B1·B2·B3 각 5개"; if (cnt) cnt.style.display = "none"; return; }
    var a = activeSession(), t = today();
    var doneToday = state.sessions.filter(function (s) { return s.status === "done" && s.completed_at && ymd(new Date(s.completed_at)) === t; }).length;
    if (sub) {
      if (a) sub.textContent = "내 사이클카운팅 진행 중";
      else if (othersActive().length) sub.textContent = "진행 중 " + othersActive().map(function (o) { return o.created_by; }).join(", ") + (doneToday ? " · 오늘 " + doneToday + "회 완료" : "");
      else sub.textContent = doneToday ? "오늘 " + doneToday + "회 완료" : "오늘 진행한 사이클카운팅 없음";
    }
    if (cnt) {
      if (a) { var d = sessionDoneCount(a.id), tg = a.target || 15; cnt.textContent = d + "/" + tg; cnt.classList.toggle("done", d >= tg); cnt.style.display = ""; }
      else cnt.style.display = "none";
    }
  }

  // ---------- 회차 ----------
  async function startSession() {
    if (isViewer()) { toast("Viewer(읽기 전용) 계정은 시작할 수 없습니다.", "warning"); return; }
    await load(true);
    if (activeSession()) { toast("내가 진행 중인 사이클카운팅이 있어요. 먼저 끝내 주세요.", "info"); render(); return; }
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }
    var arts = [], short = [];
    ZONES.forEach(function (z) {
      var got = pickForZone(z, PER_ZONE, arts.map(function (x) { return x.artno; }));
      if (got.length < PER_ZONE) short.push(z + " " + got.length + "개");
      arts = arts.concat(got);
    });
    if (!arts.length) { toast("재고가 있는 창고 품목을 찾지 못했습니다. 재고 데이터를 확인해 주세요.", "warning"); return; }
    try {
      var res = await c.from(T_SESSIONS).insert([{ target: arts.length, articles: arts, created_by: me() || null }]).select();
      if (res.error) throw res.error;
      if (res.data && res.data[0]) state.sessions.unshift(res.data[0]);
      await resolveConflicts();
      toast("사이클카운팅을 시작했습니다. " + arts.length + "개 품목을 세어 주세요." + (short.length ? " (재고 있는 품목 부족: " + short.join(", ") + ")" : ""), "success");
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

  // 거의 동시에 시작해서 품목이 겹친 경우: 나중 회차(번호 큰 쪽)가 겹친 품목을 같은 구역의 다른 품목으로 조용히 교체
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
      var next = pickForZone(x.zone, 1, (mine.articles || []).map(function (y) { return pad8(y.artno); }).concat(Array.from(taken)))[0];
      if (!next) return x;
      changed = true; taken.add(next.artno); return next;
    });
    if (!changed) return;
    var up = await c.from(T_SESSIONS).update({ articles: arts }).eq("id", mine.id).select();
    if (!up.error) { mine.articles = arts; render(); }
  }

  async function maybeFinish(sid, quiet) {
    var s = state.sessions.find(function (x) { return x.id === sid; });
    if (!s || s.status !== "in_progress" || !isMine(s)) return;
    if (sessionDoneCount(sid) < (s.target || 15)) return;
    var patch = { status: "done", completed_by: me() || null, completed_at: new Date().toISOString() };
    try {
      var res = await client().from(T_SESSIONS).update(patch).eq("id", sid).eq("status", "in_progress").select();
      if (res.error) throw res.error;
      Object.assign(s, patch);
      if (!quiet || true) toast("🎉 사이클카운팅 " + (s.target || 15) + "개를 모두 끝냈습니다!", "success");
    } catch (err) { console.warn("finish cycle session error", err); }
    render(); updateDashboard();
  }

  // ---------- 교체 (카드 밀기) ----------
  var swapping = false;
  async function swapSlot(sid, artno) {
    if (isViewer() || swapping) return;
    var s = state.sessions.find(function (x) { return x.id === sid; });
    if (!s) return;
    if (!isMine(s)) { toast("시작한 사람만 품목을 교체할 수 있습니다.", "warning"); render(); return; }
    var a = (s.articles || []).find(function (x) { return pad8(x.artno) === pad8(artno); });
    if (!a) return;
    if (sessionLatest(sid).has(pad8(artno))) { toast("이미 센 품목은 교체할 수 없습니다.", "info"); render(); return; }
    swapping = true;
    try {
      var c = client();
      var ins = await c.from(T_CHECKS).insert([{ check_date: today(), artno: pad8(a.artno), artname: a.artname || null, zone: a.zone, location: a.location,
        skip_reason: "swapped", session_id: sid, user: me() || null }]).select();
      if (ins.error) throw ins.error;
      if (ins.data && ins.data[0]) state.logs.unshift(ins.data[0]);
      var sess = await refreshSession(sid) || s;
      var arts = (sess.articles || []).slice();
      var next = pickForZone(a.zone, 1, arts.map(function (x) { return pad8(x.artno); }))[0];
      if (!next) { toast(a.zone + " 구역에 교체할 품목이 없습니다.", "warning"); }
      else {
        var idx = arts.findIndex(function (x) { return pad8(x.artno) === pad8(a.artno); });
        if (idx >= 0) arts[idx] = next;
        var up = await c.from(T_SESSIONS).update({ articles: arts }).eq("id", sid).select();
        if (up.error) throw up.error;
        sess.articles = arts;
        toast("[" + a.zone + "] " + pad8(a.artno) + " → " + next.artno + " 품목을 교체했습니다.", "info");
      }
    } catch (err) { toast("교체 실패: " + (err.message || err), "danger"); }
    swapping = false;
    render(); updateDashboard();
  }

  function bindSwipes() {
    Array.prototype.forEach.call(document.querySelectorAll("#tab-cyclecount .tb-slot-wrap.pending"), function (wrap) {
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

  // ---------- 실사 창 ----------
  function ensureSheet() {
    var el = document.getElementById("cc-sheet");
    if (el) return el;
    el = document.createElement("div");
    el.id = "cc-sheet"; el.className = "tb-sheet-backdrop";
    el.innerHTML = '<div class="tb-sheet cc-sheet" role="dialog" aria-modal="true">' +
      '<div class="tb-sheet-top"><span class="tb-sheet-step cc-step" id="cc-sheet-step"></span><button type="button" class="tb-sheet-close" onclick="CycleCount.closeSheet()" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="tb-sheet-scroll" id="cc-sheet-body"></div><div class="tb-sheet-footer" id="cc-sheet-footer"></div></div>';
    el.addEventListener("click", function (e) { if (e.target === el) closeSheet(); });
    document.body.appendChild(el);
    return el;
  }

  function openSlot(sid, artno) {
    if (isViewer()) { toast("Viewer(읽기 전용) 계정은 실사할 수 없습니다.", "warning"); return; }
    var s = state.sessions.find(function (x) { return x.id === sid; });
    if (!s) return;
    if (!isMine(s)) { toast(s.created_by + " 님이 시작한 사이클카운팅이에요. 시작한 사람만 셀 수 있습니다.", "warning"); return; }
    var a = (s.articles || []).find(function (x) { return pad8(x.artno) === pad8(artno); });
    if (!a) return;
    if (sessionLatest(sid).has(pad8(artno))) { toast("이미 센 품목입니다.", "info"); return; }
    var sys = currentStock(a.artno);
    state.sheet = { sessionId: sid, artNo: pad8(a.artno), artName: a.artname || (stockEntry(a.artno) || {}).artName || "", zone: a.zone,
                    location: currentLocation(a.artno), system: sys, actual: sys };
    ensureSheet().classList.add("active");
    document.body.classList.add("tb-sheet-open");
    renderSheet();
  }

  function closeSheet() {
    var el = document.getElementById("cc-sheet"); if (el) el.classList.remove("active");
    document.body.classList.remove("tb-sheet-open"); state.sheet = null;
  }

  function renderSheet() {
    var s = state.sheet; if (!s) return;
    var sess = state.sessions.find(function (x) { return x.id === s.sessionId; });
    document.getElementById("cc-sheet-step").textContent = s.zone + " 구역 실사" + (sess ? " · " + sessionDoneCount(sess.id) + "/" + (sess.target || 15) : "");
    var diff = s.actual - s.system;
    document.getElementById("cc-sheet-body").innerHTML =
      '<div class="tb-sheet-product"><div class="tb-sheet-thumb">' + thumb(s.artNo, s.artName, 96) + '</div><div class="tb-sheet-info">' +
        '<div class="tb-sheet-name">' + esc(s.artName || "(품명 없음)") + '</div><div class="tb-sheet-no">' + esc(s.artNo) + '</div>' +
        '<div class="cc-loc"><span class="cc-zone">' + esc(s.zone) + '</span> 현재 위치 <b>' + esc(s.location) + '</b></div></div></div>' +
      '<div class="cc-count">' +
        '<div class="cc-row"><span>전산 재고</span><b>' + s.system + '개</b></div>' +
        '<div class="cc-row cc-actual"><span>실제 센 수량</span><div class="cc-stepper">' +
          '<button type="button" onclick="CycleCount.step(-1)" aria-label="빼기">−</button>' +
          '<input type="number" id="cc-actual" inputmode="numeric" min="0" value="' + s.actual + '" oninput="CycleCount.setActual(this.value)">' +
          '<button type="button" onclick="CycleCount.step(1)" aria-label="더하기">+</button></div></div>' +
        '<div class="cc-diff ' + (diff === 0 ? "ok" : "bad") + '" id="cc-diff">' + (diff === 0 ? '<i class="fa-solid fa-check"></i> 전산과 일치 (차이 0개)' : '<i class="fa-solid fa-triangle-exclamation"></i> 차이 ' + (diff > 0 ? "+" : "") + diff + '개 → 저장하면 ' + (diff > 0 ? "보정 입고" : "보정 출고") + ' ' + Math.abs(diff) + '개가 기록됩니다') + '</div>' +
      '</div>' +
      '<div class="cc-locbox"><div class="cc-loc-title"><i class="fa-solid fa-location-dot"></i> 위치가 다르면 바꿔 주세요</div><div class="cc-loc-btns">' +
        ["B1", "B2", "램프", "B3"].map(function (z) { return '<button type="button" class="' + (s.location === z ? "active" : "") + '" onclick="CycleCount.changeLocation(\'' + z + '\')">' + z + '</button>'; }).join("") +
      '</div></div>';
    renderFooter();
    loadThumbs();
  }
  function renderFooter() {
    var s = state.sheet; if (!s) return;
    var diff = s.actual - s.system;
    document.getElementById("cc-sheet-footer").innerHTML = '<button type="button" class="tb-sheet-done' + (diff === 0 ? " cc-ok" : " cc-adj") + '" id="cc-save" onclick="CycleCount.save()">' +
      (diff === 0 ? '<i class="fa-solid fa-check-double"></i> 재고 일치 확인 (맞음)' : '<i class="fa-solid fa-scale-balanced"></i> 차이 ' + (diff > 0 ? "+" : "") + diff + '개 보정하고 저장') + '</button>';
    var d = document.getElementById("cc-diff");
    if (d) { d.className = "cc-diff " + (diff === 0 ? "ok" : "bad"); d.innerHTML = diff === 0 ? '<i class="fa-solid fa-check"></i> 전산과 일치 (차이 0개)' : '<i class="fa-solid fa-triangle-exclamation"></i> 차이 ' + (diff > 0 ? "+" : "") + diff + '개 → 저장하면 ' + (diff > 0 ? "보정 입고" : "보정 출고") + ' ' + Math.abs(diff) + '개가 기록됩니다'; }
  }
  function setActual(v) { var s = state.sheet; if (!s) return; var n = parseInt(v, 10); s.actual = isNaN(n) || n < 0 ? 0 : n; renderFooter(); }
  function step(d) { var s = state.sheet; if (!s) return; s.actual = Math.max(0, s.actual + d); var i = document.getElementById("cc-actual"); if (i) i.value = s.actual; renderFooter(); }

  async function changeLocation(z) {
    var s = state.sheet; if (!s || s.location === z) return;
    var cat = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
    var m = cat.find(function (x) { return pad8(x.artNo || x.artno) === s.artNo; });
    if (m) m.location = z;
    try { if (typeof saveMasterCatalog === "function") saveMasterCatalog(); if (typeof invalidateStockCache === "function") invalidateStockCache(); } catch (e) {}
    try { var c = client(); if (c) await c.from("master_catalog").update({ location: z }).eq("artno", s.artNo); } catch (e) { console.warn(e); }
    s.location = z;
    toast("[" + s.artNo + "] 위치를 " + z + "(으)로 바꿨습니다.", "success");
    renderSheet();
  }

  // 기존 "랜덤 체크 완료" 배지용 기록에도 저장
  async function saveLegacyRecord(s, status) {
    try {
      var now = new Date(), d = today(), t = now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
      var rec = { artNo: s.artNo, cleanNo: s.artNo, artName: s.artName, location: s.location, systemStock: s.system, actualStock: s.actual,
                  discrepancy: s.actual - s.system, status: status, checkedAt: d + " " + t, checkedDate: d, checkedUser: me() };
      window.cycleCountRecords = window.cycleCountRecords || {};
      var digits = s.artNo, stripped = digits.replace(/^0+/, "");
      window.cycleCountRecords[digits] = rec; if (stripped) window.cycleCountRecords[stripped] = rec;
      if (typeof window.saveCycleCountRecords === "function") await window.saveCycleCountRecords();
    } catch (e) { console.warn("legacy cycle record error", e); }
  }

  async function save() {
    var s = state.sheet; if (!s) return;
    var c = client(); if (!c) { toast("서버에 연결할 수 없습니다.", "danger"); return; }
    var diff = s.actual - s.system;
    if (diff !== 0 && !confirm("[" + (s.artName || s.artNo) + "]\n전산 " + s.system + "개 → 실제 " + s.actual + "개\n\n차이 " + (diff > 0 ? "+" : "") + diff + "개를 " + (diff > 0 ? "보정 입고" : "보정 출고") + "로 기록할까요?")) return;
    var btn = document.getElementById("cc-save"); if (btn) { btn.disabled = true; btn.textContent = "저장 중…"; }
    try {
      // 차이가 있으면 입출고 기록에 보정 입고/출고 추가 (기존 Cycle Counting 보정과 같은 방식)
      if (diff !== 0) {
        var logRow = { date: today(), type: diff > 0 ? "입고" : "출고", artNo: s.artNo, artName: s.artName || null, qty: Math.abs(diff), user: me() || null };
        var lr = await c.from("inventory_logs").insert([logRow]).select();
        if (lr.error) throw lr.error;
        if (typeof historyLogs !== "undefined" && Array.isArray(historyLogs)) {
          historyLogs.unshift(Object.assign({}, logRow, { id: lr.data && lr.data[0] && lr.data[0].id, artName: s.artName, created_at: new Date().toISOString() }));
        }
        if (typeof invalidateStockCache === "function") invalidateStockCache();
      }
      var row = { check_date: today(), artno: s.artNo, artname: s.artName || null, zone: s.zone, location: s.location,
                  system_stock: s.system, actual_stock: s.actual, discrepancy: diff, status: diff === 0 ? "matched" : "adjusted",
                  session_id: s.sessionId, user: me() || null };
      var res = await c.from(T_CHECKS).insert([row]).select();
      if (res.error) throw res.error;
      if (res.data && res.data[0]) state.logs.unshift(res.data[0]);
      await saveLegacyRecord(s, diff === 0 ? "matched" : "adjusted");
      toast(diff === 0 ? "✅ [" + s.artNo + "] 재고 일치" : "[" + s.artNo + "] 차이 " + (diff > 0 ? "+" : "") + diff + "개 보정했습니다.", diff === 0 ? "success" : "info");
      var sid = s.sessionId; closeSheet(); render(); updateDashboard();
      try { if (typeof renderStockLookup === "function") renderStockLookup(); if (typeof renderHistoryLogs === "function") renderHistoryLogs(); } catch (e) {}
      await maybeFinish(sid);
    } catch (err) {
      toast("저장 실패: " + (err.message || err), "danger");
      renderFooter();
    }
  }

  // ---------- 화면 ----------
  function renderStats() {
    var box = document.getElementById("cc-stats"); if (!box) return;
    var now = new Date(), t = today(), month = t.slice(0, 7), ml = (now.getMonth() + 1) + "월";
    var mc = checks().filter(function (r) { return String(r.check_date).slice(0, 7) === month; });
    var tc = mc.filter(function (r) { return r.check_date === t; });
    function isAdj(r) { return r.status === "adjusted"; }
    function tile(n, l, cls) { return '<div class="tb-kpi' + (cls ? " " + cls : "") + '"><b>' + n + '</b><span>' + l + '</span></div>'; }
    function row(list) { var a = list.filter(isAdj).length; return '<div class="tb-kpis">' + tile(list.length, "체크된 아티클", "main") + tile(list.length - a, "정상 재고 아티클", "ok") + tile(a, "수정된 재고 아티클", "fix") + '</div>'; }
    var adj = mc.filter(isAdj);
    var plus = adj.reduce(function (a, r) { return a + Math.max(0, r.discrepancy || 0); }, 0), minus = adj.reduce(function (a, r) { return a + Math.min(0, r.discrepancy || 0); }, 0);
    box.innerHTML = '<div class="tb-dash cc-dash"><div class="tb-dash-title"><span><i class="fa-solid fa-chart-simple"></i> Cycle Counting 현황</span><small>' + esc(ml + " " + now.getDate() + "일 기준") + '</small></div>' +
      '<div class="tb-dash-label">오늘</div>' + row(tc) +
      '<div class="tb-dash-label">' + esc(ml) + ' 누적</div>' + row(mc) +
      (adj.length ? '<div class="tb-dash-sub">' + esc(ml) + ' 보정 수량 +' + plus + ' / ' + minus + '개</div>' : '') + '</div>';
  }

  function sessionCardHtml(a, readOnly) {
    var latest = sessionLatest(a.id), done = latest.size, target = a.target || 15;
    var swaps = state.logs.filter(function (r) { return r.session_id === a.id && r.skip_reason; }).length;
    var html = '<div class="tb-sess cc-sess' + (readOnly ? " readonly" : "") + '">' +
      '<div class="tb-sess-head"><div><b>' + (readOnly ? esc(a.created_by || "-") + " 님 진행 중" : "사이클카운팅 진행 중") + '</b><span>시작 <b class="tb-who">' + esc(a.created_by || "-") + '</b> · ' + esc(fmtTime(a.created_at)) + (swaps ? " · 교체 " + swaps + "건" : "") + '</span></div>' +
      '<div class="tb-sess-count"><b>' + done + '</b>/' + target + '</div></div>' +
      '<div class="tb-sess-bar"><span style="width:' + Math.min(100, done / target * 100) + '%"></span></div>';
    ZONES.forEach(function (z) {
      var items = (a.articles || []).filter(function (x) { return x.zone === z; });
      if (!items.length) return;
      var zd = items.filter(function (x) { return latest.has(pad8(x.artno)); }).length;
      html += '<div class="cc-zone-head"><span class="cc-zone">' + z + '</span><span>' + zd + '/' + items.length + '</span></div><div class="tb-slots">' +
        items.map(function (x) {
          var r = latest.get(pad8(x.artno)), pending = !r && !readOnly && !isViewer();
          var name = x.artname || "(품명 없음)";
          var state_ = r ? (r.status === "adjusted" ? '<span class="tb-chip warn"><i class="fa-solid fa-scale-balanced"></i>보정 ' + (r.discrepancy > 0 ? "+" : "") + r.discrepancy + '</span>' : '<span class="tb-chip ok"><i class="fa-solid fa-circle-check"></i>일치</span>') +
                         ' ' + r.actual_stock + '개 · ' + esc(fmtTime(r.created_at))
                     : '<span class="cc-sys">전산 ' + currentStock(x.artno) + '개</span> · ' + (readOnly ? "실사 대기" : "눌러서 세기");
          return '<div class="tb-slot-wrap' + (pending ? " pending" : "") + '" data-sid="' + a.id + '" data-art="' + pad8(x.artno) + '">' +
            (pending ? '<button type="button" class="tb-slot-swap"><i class="fa-solid fa-right-left"></i><span>교체</span></button>' : '') +
            '<div class="tb-slot' + (r ? " done" : "") + '">' + thumb(x.artno, name, 52) +
            '<div class="tb-slot-body"><div class="tb-slot-name">' + esc(name) + '</div><div class="tb-slot-no">' + esc(pad8(x.artno)) + ' · ' + esc(currentLocation(x.artno)) + '</div>' +
            '<div class="tb-slot-state' + (r ? "" : " wait") + '">' + state_ + '</div></div>' +
            (pending ? '<i class="fa-solid fa-chevron-right tb-slot-go"></i>' : '') + '</div></div>';
        }).join("") + '</div>';
    });
    if (!readOnly && !isViewer()) html += '<div class="tb-swipe-hint"><i class="fa-solid fa-hand-point-left"></i> 지금 세기 어려운 품목은 카드를 왼쪽으로 밀어 교체하세요 (개수에 포함 안 됨)</div>';
    return html + '</div>';
  }

  function renderActive() {
    var box = document.getElementById("cc-session"); if (!box) return;
    var a = activeSession(), others = othersActive(), html = "";
    if (a) html += sessionCardHtml(a, false);
    else if (!isViewer()) html += '<button type="button" class="tb-start-btn cc-start-btn" onclick="CycleCount.startSession()"><i class="fa-solid fa-clipboard-check"></i>' +
      '<span><b>새 사이클카운팅 시작</b><small>B1 · B2 · B3 구역에서 5개씩, 총 15개 품목을 배정합니다 · 시작한 사람이 끝까지 진행</small></span></button>';
    if (others.length) html += '<details class="tb-others"' + (isViewer() ? " open" : "") + '><summary><i class="fa-solid fa-users"></i> 다른 사람이 진행 중인 사이클카운팅 ' + others.length + '건 <span>(보기만 가능)</span></summary>' +
      others.map(function (o) { return sessionCardHtml(o, true); }).join("") + '</details>';
    box.innerHTML = html || '<div class="tb-empty">진행 중인 사이클카운팅이 없습니다.</div>';
  }

  function rowHtml(r) {
    var adj = r.status === "adjusted";
    return '<div class="tb-row">' + thumb(r.artno, r.artname, 44) + '<div class="tb-row-body">' +
      '<div class="tb-row-title">' + (r.skip_reason ? '<span class="tb-chip skip"><i class="fa-solid fa-right-left"></i>교체</span>' : adj ? '<span class="tb-chip warn"><i class="fa-solid fa-scale-balanced"></i>보정</span>' : '<span class="tb-chip ok"><i class="fa-solid fa-circle-check"></i>일치</span>') +
      ' <b>' + esc(r.artname || "(품명 없음)") + '</b></div>' +
      '<div class="tb-row-meta"><span class="tb-row-no">' + esc(pad8(r.artno)) + '</span> · ' + esc(r.zone || "") + ' · ' + (r.skip_reason ? "교체" : "실사") + ' <b class="tb-who">' + esc(r.user || "-") + '</b> · ' + esc(fmtTime(r.created_at)) + '</div>' +
      (r.skip_reason ? '' : '<div class="tb-issues"><span class="tb-issue ' + (adj ? "no" : "fixed") + '">전산 ' + r.system_stock + ' → 실제 ' + r.actual_stock + (adj ? ' (' + (r.discrepancy > 0 ? "+" : "") + r.discrepancy + ')' : '') + '</span></div>') +
      '</div></div>';
  }

  function renderLists() {
    var month = today().slice(0, 7);
    var adjusted = checks().filter(function (r) { return r.status === "adjusted" && String(r.check_date).slice(0, 7) === month; });
    var done = state.sessions.filter(function (s) { return s.status === "done"; });
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set("cc-stat-adjusted", adjusted.length); set("cc-stat-sessions", done.length);
    Array.prototype.forEach.call(document.querySelectorAll("#tab-cyclecount .tb-stat"), function (b) { b.classList.toggle("active", b.dataset.filter === state.filter); });
    var list = document.getElementById("cc-list"), title = document.getElementById("cc-list-title");
    if (!list) return;
    if (state.filter === "adjusted") {
      if (title) title.textContent = "이번 달 수량 보정 내역";
      list.innerHTML = adjusted.length ? adjusted.map(rowHtml).join("") : '<div class="tb-empty">이번 달 수량 보정 내역이 없습니다 👍</div>';
    } else {
      if (title) title.textContent = "완료된 사이클카운팅 (시작·완료한 사람)";
      list.innerHTML = done.length ? done.slice(0, 20).map(function (s) {
        var rows = state.logs.filter(function (r) { return r.session_id === s.id; });
        var adj = rows.filter(function (r) { return r.status === "adjusted"; }).length, ok = rows.filter(function (r) { return r.status === "matched"; }).length;
        return '<div class="tb-hist"><button type="button" class="tb-hist-head" onclick="CycleCount.toggle(' + s.id + ')">' +
          '<div class="tb-hist-main"><b>' + esc(fmtTime(s.completed_at || s.created_at)) + ' 완료</b><span>시작 <b class="tb-who">' + esc(s.created_by || "-") + '</b> → 완료 <b class="tb-who">' + esc(s.completed_by || "-") + '</b> · ' + (s.target || 15) + '개</span></div>' +
          '<div class="tb-hist-stats"><span class="ok">일치 ' + ok + '</span><span class="warn">보정 ' + adj + '</span></div></button>' +
          '<div id="cc-sess-detail-' + s.id + '" class="tb-hist-detail" style="display:none;">' + rows.map(rowHtml).join("") + '</div></div>';
      }).join("") : '<div class="tb-empty">완료된 사이클카운팅이 아직 없습니다.</div>';
    }
  }

  function render() {
    if (!document.getElementById("tab-cyclecount")) return;
    if (!state.loaded) { var b = document.getElementById("cc-session"); if (b) b.innerHTML = '<div class="tb-empty">' + (state.loading ? "불러오는 중…" : "기록을 불러오려면 새로고침을 눌러 주세요.") + '</div>'; return; }
    renderStats(); renderActive(); renderLists(); bindSwipes(); loadThumbs();
  }

  function setFilter(f) { state.filter = f; render(); }
  function toggle(id) { var el = document.getElementById("cc-sess-detail-" + id); if (el) el.style.display = el.style.display === "none" ? "" : "none"; loadThumbs(); }

  window.CycleCount = { load: load, render: render, startSession: startSession, openSlot: openSlot, closeSheet: closeSheet, setActual: setActual, step: step,
    changeLocation: changeLocation, save: save, swapSlot: swapSlot, setFilter: setFilter, toggle: toggle, updateDashboard: updateDashboard };

  // 예전 Cycle Counting 창을 여는 곳(재고 조회의 배지 등)은 새 화면으로 연결
  function goTab() { if (typeof switchTab === "function") switchTab("cyclecount", document.querySelector(".bottom-nav .nav-item:first-child")); }

  function init() {
    window.openCycleCountingModal = goTab;
    var tab = document.getElementById("tab-cyclecount");
    if (tab) new MutationObserver(function () { if (tab.classList.contains("active")) load(true); }).observe(tab, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && state.sheet) closeSheet(); });
    var tries = 0, boot = setInterval(function () {
      tries++;
      var ready = me() && client() && (typeof historyLogs !== "undefined" && historyLogs.length > 0);
      if (ready) { clearInterval(boot); load(false); } else if (tries > 90) clearInterval(boot);
    }, 1000);
    setInterval(function () {
      var m = document.getElementById("tab-menu"), t = document.getElementById("tab-cyclecount");
      if (((m && m.classList.contains("active")) || (t && t.classList.contains("active") && !state.sheet)) && !document.hidden && me()) load(true);
    }, 60000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  // 다른 스크립트가 나중에 openCycleCountingModal 을 다시 정의해도 새 화면으로
  window.addEventListener("load", function () { setTimeout(function () { window.openCycleCountingModal = goTab; }, 0); });
})();
