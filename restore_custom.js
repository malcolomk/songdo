// --- Notice Popup Logic ---
window.checkNoticePopup = function() {
  if (typeof isAdminUser !== "undefined" && !isAdminUser) {
    const hideUntil = localStorage.getItem('warehouse_guest_manual_hide_until');
    if (hideUntil) {
      const hideDate = new Date(hideUntil);
      if (new Date() < hideDate) return;
    }
    const modal = document.getElementById('guest-manual-modal');
    if (modal) {
      modal.classList.add('active');
      if (typeof initGuestManualSignature === 'function') initGuestManualSignature();
      if (typeof nextGuestManualPage === 'function') nextGuestManualPage(1);
    }
  } else {
    const hideUntil = localStorage.getItem('warehouse_notice_hide_until');
    if (hideUntil) {
      const hideDate = new Date(hideUntil);
      if (new Date() < hideDate) return;
    }
    const modal = document.getElementById('notice-modal');
    if (modal) {
      modal.classList.add('active');
      initNoticeSignature();
    }
  }
};

let noticeSigCanvas, noticeSigCtx;
let isNoticeDrawing = false;
let noticeHasSignature = false;

function initNoticeSignature() {
  noticeSigCanvas = document.getElementById('notice-signature-pad');
  if (!noticeSigCanvas) return;
  noticeSigCtx = noticeSigCanvas.getContext('2d');
  
  const rect = noticeSigCanvas.getBoundingClientRect();
  noticeSigCanvas.width = rect.width;
  noticeSigCanvas.height = rect.height;
  
  noticeSigCtx.lineWidth = 2;
  noticeSigCtx.lineCap = 'round';
  noticeSigCtx.strokeStyle = '#0f172a';
  
  noticeSigCanvas.addEventListener('mousedown', noticeStartDraw);
  noticeSigCanvas.addEventListener('mousemove', noticeDraw);
  noticeSigCanvas.addEventListener('mouseup', noticeStopDraw);
  noticeSigCanvas.addEventListener('mouseout', noticeStopDraw);
  
  noticeSigCanvas.addEventListener('touchstart', noticeStartDraw, {passive: false});
  noticeSigCanvas.addEventListener('touchmove', noticeDraw, {passive: false});
  noticeSigCanvas.addEventListener('touchend', noticeStopDraw);
}

function noticeStartDraw(e) {
  e.preventDefault();
  isNoticeDrawing = true;
  noticeHasSignature = true;
  const pos = noticeGetPos(e);
  noticeSigCtx.beginPath();
  noticeSigCtx.moveTo(pos.x, pos.y);
}

function noticeDraw(e) {
  if (!isNoticeDrawing) return;
  e.preventDefault();
  const pos = noticeGetPos(e);
  noticeSigCtx.lineTo(pos.x, pos.y);
  noticeSigCtx.stroke();
}

function noticeStopDraw() {
  isNoticeDrawing = false;
}

function noticeGetPos(e) {
  const rect = noticeSigCanvas.getBoundingClientRect();
  let clientX = e.clientX;
  let clientY = e.clientY;
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  }
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

window.clearNoticeSignature = function() {
  if (!noticeSigCtx || !noticeSigCanvas) return;
  noticeSigCtx.clearRect(0, 0, noticeSigCanvas.width, noticeSigCanvas.height);
  noticeSigCtx.beginPath();
  noticeHasSignature = false;
};

window.confirmNoticeModal = function() {
  const nameInput = document.getElementById('notice-signature-name');
  if (!nameInput || !nameInput.value.trim()) {
    if (typeof showToast === 'function') showToast('이름을 입력해주세요.', 'warning');
    else alert('이름을 입력해주세요.');
    return;
  }
  if (!noticeHasSignature) {
    if (typeof showToast === 'function') showToast('서명을 입력해주세요.', 'warning');
    else alert('서명을 입력해주세요.');
    return;
  }
  
  if (typeof saveSignatureHistory === 'function') saveSignatureHistory(nameInput.value.trim(), '관리자');
  
  const hideCheckbox = document.getElementById('notice-hide-week');
  if (hideCheckbox && hideCheckbox.checked) {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    localStorage.setItem('warehouse_notice_hide_until', nextWeek.toISOString());
  }
  
  document.getElementById('notice-modal').classList.remove('active');
};

window.updateAllBadges = function() {
  if (typeof orderLogs === "undefined" || !orderLogs) return;
  
  const pendingPicks = orderLogs.filter(item => item.status === "요청" || item.status === "보류");
  const activeOrders = orderLogs.filter(item => !item.status || item.status === "요청됨" || item.status === "보류");

  const badgePicklist = document.getElementById("badge-picklist");
  if (badgePicklist) {
    if (pendingPicks.length > 0) {
      badgePicklist.textContent = pendingPicks.length;
      badgePicklist.style.display = "inline-flex";
      badgePicklist.style.backgroundColor = "#ef4444";
      badgePicklist.style.position = "absolute";
      badgePicklist.style.top = "10px";
      badgePicklist.style.right = "10px";
    } else {
      badgePicklist.style.display = "none";
    }
  }

  const badgeOrder = document.getElementById("badge-order");
  if (badgeOrder) {
    if (activeOrders.length > 0) {
      badgeOrder.textContent = activeOrders.length;
      badgeOrder.style.display = "inline-flex";
      badgeOrder.style.backgroundColor = "#3b82f6";
      badgeOrder.style.position = "absolute";
      badgeOrder.style.top = "10px";
      badgeOrder.style.right = "10px";
    } else {
      badgeOrder.style.display = "none";
    }
  }

  const badgeMenuMain = document.getElementById("badge-menu-main");
  if (badgeMenuMain) {
    const totalCount = pendingPicks.length + activeOrders.length;
    if (totalCount > 0) {
      badgeMenuMain.textContent = totalCount;
      badgeMenuMain.style.display = "inline-flex";
      badgeMenuMain.style.backgroundColor = "#ef4444";
    } else {
      badgeMenuMain.style.display = "none";
    }
  }
};

window.exportStockToExcel = function() {
  if (typeof isAdminUser === "undefined" || !isAdminUser) {
    if (typeof showToast === "function") showToast("접근 권한이 없습니다. (관리자 전용)", "danger");
    return;
  }

  const stockMap = typeof buildStockMap === "function" ? buildStockMap() : new Map();
  if (stockMap.size === 0) {
    if (typeof showToast === "function") showToast("추출할 재고 데이터가 없습니다.", "danger");
    return;
  }

  const exportData = [];
  let index = 1;
  stockMap.forEach((data, artNo) => {
    let artName = "알 수 없는 품목";
    if (typeof masterCatalogMap !== "undefined" && masterCatalogMap.has(artNo)) {
      artName = masterCatalogMap.get(artNo);
    } else if (data.artName) {
      artName = data.artName;
    }
    
    exportData.push({
      "연번": index++,
      "아티클 이름": artName,
      "번호 (ARTNO)": artNo,
      "재고 수량": data.currentStock !== undefined ? data.currentStock : 0,
      "위치": data.location || "미지정"
    });
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "재고현황");

  const todayStr = new Date().toISOString().split("T")[0];
  XLSX.writeFile(workbook, `창고재고현황_${todayStr}.xlsx`);
  if (typeof showToast === "function") showToast("관리자 권한으로 엑셀 파일(.xlsx) 추출이 시작되었습니다!", "success");
};

// --- Guest Manual Modal Logic ---
let guestManualSigPad = null;
let guestManualSigCtx = null;
let guestManualHasSignature = false;
let currentGuestManualPage = 1;

window.initGuestManualSignature = function() {
  const canvas = document.getElementById('guest-manual-signature-pad');
  if (!canvas) return;
  
  guestManualSigPad = canvas;
  guestManualSigCtx = canvas.getContext('2d');
  
  const resizeCanvas = () => {
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth - 2;
    canvas.height = 120;
    if (typeof clearGuestSignature === 'function') clearGuestSignature();
  };
  resizeCanvas();
  
  let drawing = false;
  
  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  
  const startDraw = (e) => {
    e.preventDefault();
    drawing = true;
    guestManualHasSignature = true;
    const pos = getPos(e);
    guestManualSigCtx.beginPath();
    guestManualSigCtx.moveTo(pos.x, pos.y);
  };
  
  const draw = (e) => {
    e.preventDefault();
    if (!drawing) return;
    const pos = getPos(e);
    guestManualSigCtx.lineTo(pos.x, pos.y);
    guestManualSigCtx.strokeStyle = "#0f172a";
    guestManualSigCtx.lineWidth = 2;
    guestManualSigCtx.lineCap = "round";
    guestManualSigCtx.stroke();
  };
  
  const endDraw = (e) => {
    e.preventDefault();
    drawing = false;
    guestManualSigCtx.beginPath();
  };
  
  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseleave', endDraw);
  
  canvas.addEventListener('touchstart', startDraw, {passive: false});
  canvas.addEventListener('touchmove', draw, {passive: false});
  canvas.addEventListener('touchend', endDraw);
};

window.clearGuestSignature = function() {
  if (!guestManualSigCtx || !guestManualSigPad) return;
  guestManualSigCtx.clearRect(0, 0, guestManualSigPad.width, guestManualSigPad.height);
  guestManualSigCtx.beginPath();
  guestManualHasSignature = false;
};

window.nextGuestManualPage = function(pageNumber) {
  document.querySelectorAll('.guest-manual-page').forEach(page => {
    page.style.display = 'none';
  });
  
  const targetPage = document.getElementById(`guest-manual-page-${pageNumber}`);
  if (targetPage) {
    targetPage.style.display = 'block';
  }
  
  currentGuestManualPage = pageNumber;
};

window.confirmGuestManualModal = function() {
  const nameInput = document.getElementById('guest-signature-name');
  if (!nameInput || !nameInput.value.trim()) {
    if (typeof showToast === 'function') showToast('이름을 입력해주세요.', 'warning');
    else alert('이름을 입력해주세요.');
    return;
  }
  if (!guestManualHasSignature) {
    if (typeof showToast === 'function') showToast('서명을 입력해주세요.', 'warning');
    else alert('서명을 입력해주세요.');
    return;
  }
  
  if (typeof saveSignatureHistory === 'function') saveSignatureHistory(nameInput.value.trim(), '게스트');
  
  const hideCheckbox = document.getElementById('guest-manual-hide-week');
  if (hideCheckbox && hideCheckbox.checked) {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    localStorage.setItem('warehouse_guest_manual_hide_until', nextWeek.toISOString());
  }
  
  document.getElementById('guest-manual-modal').classList.remove('active');
};

window.saveSignatureHistory = function(name, role) {
  let history = [];
  try {
    const data = localStorage.getItem('warehouse_signature_history');
    if (data) history = JSON.parse(data);
  } catch(e) {}
  
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  
  history.unshift({ name, role, date: dateStr, account: typeof currentUser !== "undefined" ? currentUser : "unknown" });
  if (history.length > 100) history = history.slice(0, 100);
  
  localStorage.setItem('warehouse_signature_history', JSON.stringify(history));
};

window.openSigHistoryModal = function() {
  const modal = document.getElementById('sig-history-modal');
  const listContainer = document.getElementById('sig-history-list');
  if (!modal || !listContainer) return;
  
  let history = [];
  try {
    const data = localStorage.getItem('warehouse_signature_history');
    if (data) history = JSON.parse(data);
  } catch(e) {}
  
  if (history.length === 0) {
    listContainer.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:20px 0;">서명 기록이 없습니다.</div>';
  } else {
    listContainer.innerHTML = history.map(item => `
      <div style="padding:10px; border:1px solid #e2e8f0; border-radius:6px; background:#f8fafc; font-size:13px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span style="font-weight:bold; color:#0f172a;">${item.name}</span>
          <span style="color:#64748b; font-size:12px;">${item.date}</span>
        </div>
        <div style="color:#475569;">계정: ${item.account} / 유형: ${item.role}</div>
      </div>
    `).join('');
  }
  
  modal.classList.add('active');
};

window.closeSigHistoryModal = function() {
  const modal = document.getElementById('sig-history-modal');
  if (modal) modal.classList.remove('active');
};
