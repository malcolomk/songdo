
// --- Notice Popup Logic ---
window.checkNoticePopup = function() {
  const hideUntil = localStorage.getItem('warehouse_notice_hide_until');
  if (hideUntil) {
    const hideDate = new Date(hideUntil);
    if (new Date() < hideDate) return;
  }
  document.getElementById('notice-modal').classList.add('active');
  initNoticeSignature();
};

let noticeSigCanvas, noticeSigCtx;
let isNoticeDrawing = false;
let noticeHasSignature = false;

function initNoticeSignature() {
  noticeSigCanvas = document.getElementById('notice-signature-pad');
  if (!noticeSigCanvas) return;
  noticeSigCtx = noticeSigCanvas.getContext('2d');
  
  // Resize canvas to physical pixels to avoid blur
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
  if (!noticeHasSignature) {
    if (typeof showToast === 'function') showToast('서명을 입력해주세요.', 'warning');
    else alert('서명을 입력해주세요.');
    return;
  }
  
  const hideCheckbox = document.getElementById('notice-hide-week');
  if (hideCheckbox && hideCheckbox.checked) {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    localStorage.setItem('warehouse_notice_hide_until', nextWeek.toISOString());
  }
  
  document.getElementById('notice-modal').classList.remove('active');
};
