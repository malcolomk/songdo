// ==========================================
// 재고 조사 (Stock Audit) 전용 스크립트
// ==========================================

let stockAudits = [];
let auditSearchQuery = "";
let auditHfbFilter = "ALL";
let auditInputMode = "both"; // 'both' | 'store' | 'wh'
let auditListTypeFilter = "both"; // 'both' | 'store' | 'wh'

// 1. 초기화 및 데이터 로드
async function initAuditTab() {
  const dateInput = document.getElementById("audit-date");
  if (dateInput && !dateInput.value) {
    const todayStr = getTodayAuditDate();
    dateInput.value = todayStr;
  }

  const userInput = document.getElementById("audit-user");
  if (userInput && typeof currentUser !== "undefined" && currentUser) {
    userInput.value = currentUser;
  }

  setAuditInputMode(auditInputMode || "both");
  setAuditListTypeFilter(auditListTypeFilter || "both");

  await loadStockAudits();
  renderAuditList();
}

function getTodayAuditDate() {
  if (typeof window.getTodayDateString === "function") {
    return window.getTodayDateString();
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getYesterdayAuditDate() {
  if (typeof window.getYesterdayDateString === "function") {
    return window.getYesterdayDateString();
  }
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setAuditDateToday() {
  const dateInput = document.getElementById("audit-date");
  if (dateInput) {
    const today = getTodayAuditDate();
    dateInput.value = today;
    onAuditDateChange();
  }
}

function setAuditDateYesterday() {
  const dateInput = document.getElementById("audit-date");
  if (dateInput) {
    const yesterday = getYesterdayAuditDate();
    dateInput.value = yesterday;
    onAuditDateChange();
  }
}


// 2. 데이터 불러오기 (LocalStorage + Supabase 연동)
async function loadStockAudits() {
  try {
    const saved = localStorage.getItem("warehouse_stock_audits");
    if (saved) {
      const parsed = JSON.parse(saved);
      stockAudits = parsed.map(item => {
        const sQty = Number(item.storeQty !== undefined ? item.storeQty : 0);
        const wQty = Number(item.warehouseQty !== undefined ? item.warehouseQty : (item.qty || 0));
        return {
          ...item,
          storeQty: sQty,
          warehouseQty: wQty,
          qty: sQty + wQty
        };
      });
    } else {
      stockAudits = [];
    }
  } catch (err) {
    console.warn("로컬 실재고 데이터 파싱 에러:", err);
    stockAudits = [];
  }

  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from("stock_audits")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data && data.length > 0) {
        // 병합
        const localMap = new Map();
        stockAudits.forEach(item => localMap.set(String(item.id || item.artNo + "_" + item.date), item));
        data.forEach(item => {
          const key = String(item.id || item.artno + "_" + item.date);
          const sQty = Number(item.store_qty !== undefined ? item.store_qty : (item.storeQty || 0));
          const wQty = Number(item.warehouse_qty !== undefined ? item.warehouse_qty : (item.warehouseQty !== undefined ? item.warehouseQty : (item.qty || 0)));
          localMap.set(key, {
            id: item.id,
            date: item.date || item.audit_date,
            artNo: String(item.artno || item.artNo || "").trim(),
            artName: item.artname || item.artName || "",
            hfb: item.hfb || "",
            location: item.location || "",
            storeQty: sQty,
            warehouseQty: wQty,
            qty: sQty + wQty,
            user: item.user_name || item.user || "",
            note: item.note || "",
            created_at: item.created_at || new Date().toISOString()
          });
        });
        stockAudits = Array.from(localMap.values());
        saveStockAuditsToStorage();
      }
    } catch (err) {
      console.warn("Supabase 실재고 데이터 로드 에러(로컬 데이터 우선 사용):", err);
    }
  }
}

function saveStockAuditsToStorage() {
  try {
    localStorage.setItem("warehouse_stock_audits", JSON.stringify(stockAudits));
  } catch (e) {
    console.warn("LocalStorage 실재고 데이터 저장 실패:", e);
  }
}

// 3. 총 실재고 미리보기 실시간 계산
function updateAuditTotalPreview() {
  const storeInput = document.getElementById("audit-store-qty");
  const whInput = document.getElementById("audit-warehouse-qty");
  const previewEl = document.getElementById("audit-total-preview");
  
  const storeVal = storeInput ? Number(storeInput.value) || 0 : 0;
  const whVal = whInput ? Number(whInput.value) || 0 : 0;
  const total = storeVal + whVal;
  
  if (previewEl) {
    previewEl.textContent = `${total.toLocaleString()}개`;
  }
}

// Sound & Haptic Alert Helpers for Unregistered Item
function playAuditWarningBeep() {
  try {
    if (typeof window.playWarningBeep === "function") {
      window.playWarningBeep();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    
    // First warning buzz tone (low pitch sawtooth 300Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sawtooth";
    osc1.frequency.setValueAtTime(300, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.16);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.16);

    // Second deeper warning tone
    setTimeout(() => {
      try {
        const now2 = ctx.currentTime;
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sawtooth";
        osc2.frequency.setValueAtTime(220, now2);
        gain2.gain.setValueAtTime(0.35, now2);
        gain2.gain.exponentialRampToValueAtTime(0.01, now2 + 0.28);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now2);
        osc2.stop(now2 + 0.28);
      } catch(e){}
    }, 170);
  } catch(e) {
    console.warn("Audit warning beep error:", e);
  }
}

function playAuditWarningHaptic() {
  try {
    if (typeof window.playWarningHaptic === "function") {
      window.playWarningHaptic();
      return;
    }
    if (navigator && typeof navigator.vibrate === "function") {
      navigator.vibrate([150, 100, 150]);
    }
  } catch(e){}
}

// Unregistered Product Modal Handlers for Inventory (실재고) Tab
let pendingAuditUnregistered = null;
let confirmedUnregisteredArtNo = null;

function openAuditUnregisteredModal(artNo) {
  const cleanNo = String(artNo || "").trim();
  if (!cleanNo) return;
  pendingAuditUnregistered = { artNo: cleanNo };

  const modal = document.getElementById("audit-unregistered-modal");
  const artNoEl = document.getElementById("audit-unreg-modal-artno");
  const artNameInput = document.getElementById("audit-unreg-modal-artname");

  if (artNoEl) artNoEl.textContent = cleanNo;
  if (artNameInput) artNameInput.value = "";
  if (modal) modal.classList.add("active");

  playAuditWarningBeep();
  playAuditWarningHaptic();

  setTimeout(() => {
    if (artNameInput) artNameInput.focus();
  }, 100);
}

function closeAuditUnregisteredModal() {
  pendingAuditUnregistered = null;
  const modal = document.getElementById("audit-unregistered-modal");
  if (modal) modal.classList.remove("active");

  const artNoInput = document.getElementById("audit-artno");
  if (artNoInput) {
    artNoInput.value = "";
    artNoInput.focus();
  }
  clearAuditFormFields();
}

function confirmAuditUnregisteredProduct() {
  if (!pendingAuditUnregistered) return;
  const artNo = pendingAuditUnregistered.artNo;
  const artNameInput = document.getElementById("audit-unreg-modal-artname");
  const customName = (artNameInput && artNameInput.value.trim()) ? artNameInput.value.trim() : "미등록 신규 품목";

  confirmedUnregisteredArtNo = artNo;

  const modal = document.getElementById("audit-unregistered-modal");
  if (modal) modal.classList.remove("active");

  const artNoEl = document.getElementById("audit-artno");
  const artNameEl = document.getElementById("audit-artname");
  const hfbEl = document.getElementById("audit-hfb");
  const locEl = document.getElementById("audit-location");
  const icon = document.getElementById("audit-artname-status-icon");

  if (artNoEl) artNoEl.value = artNo;
  if (artNameEl) artNameEl.value = customName;
  if (hfbEl) hfbEl.value = "일반";
  if (locEl) locEl.value = "매장";
  if (icon) {
    icon.innerHTML = '<span style="font-size:10.5px; font-weight:800; color:#d97706; background:#fef3c7; padding:2px 6px; border-radius:4px; border:1px solid #fde68a;">미등록</span>';
  }

  const dateInput = document.getElementById("audit-date");
  const selectedDate = (dateInput ? dateInput.value : "") || getTodayAuditDate();
  const existing = stockAudits.find(item => item.date === selectedDate && item.artNo === artNo);
  const storeInput = document.getElementById("audit-store-qty");
  const whInput = document.getElementById("audit-warehouse-qty");
  const noteInput = document.getElementById("audit-note");

  if (existing) {
    if (storeInput) storeInput.value = existing.storeQty !== undefined ? existing.storeQty : 0;
    if (whInput) whInput.value = existing.warehouseQty !== undefined ? existing.warehouseQty : existing.qty;
    if (noteInput && existing.note) noteInput.value = existing.note;
  }

  updateAuditTotalPreview();
  if (typeof showToast === "function") {
    showToast(`[${artNo}] ${customName} (미등록 품목 실재고 등록 진행)`, "warning");
  }

  if (auditInputMode === "wh") {
    if (whInput) whInput.focus();
  } else {
    if (storeInput) storeInput.focus();
  }

  pendingAuditUnregistered = null;
}

// 4. 바코드 및 아티클 번호 실시간 입력 핸들러
function onAuditArtNoInput(val) {
  let raw = String(val || "").trim();
  if (!raw) {
    confirmedUnregisteredArtNo = null;
    clearAuditFormFields();
    return;
  }

  // 14자리 긴 바코드 자동 앞 8자리 파싱
  const digitsOnly = raw.replace(/\D/g, "");
  let cleanNo = raw;
  if (digitsOnly.length === 14) {
    cleanNo = digitsOnly.substring(0, 8);
    const artNoInput = document.getElementById("audit-artno");
    if (artNoInput) artNoInput.value = cleanNo;
  } else if (digitsOnly.length >= 8 && digitsOnly.length <= 9) {
    cleanNo = digitsOnly.slice(-8);
  }

  const artNameInput = document.getElementById("audit-artname");
  const hfbInput = document.getElementById("audit-hfb");
  const locInput = document.getElementById("audit-location");
  const icon = document.getElementById("audit-artname-status-icon");
  const hint = document.getElementById("audit-curr-stock-hint");
  const storeInput = document.getElementById("audit-store-qty");
  const whInput = document.getElementById("audit-warehouse-qty");
  const noteInput = document.getElementById("audit-note");
  const dateInput = document.getElementById("audit-date");
  const selectedDate = (dateInput ? dateInput.value : "") || getTodayAuditDate();

  if (typeof masterCatalog === "undefined" || !masterCatalog) {
    return;
  }

  const matched = masterCatalog.find(m => String(m.artNo).trim() === cleanNo);

  if (matched) {
    confirmedUnregisteredArtNo = null;
    if (artNameInput) artNameInput.value = matched.artName;
    if (hfbInput) hfbInput.value = matched.hfb || "";
    if (locInput) locInput.value = matched.location || "";
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #059669;"></i>';

    // 전산 창고 재고 확인 및 힌트 표기
    let currStock = 0;
    if (typeof getItemStock === "function") {
      currStock = getItemStock(cleanNo);
    }
    if (hint) {
      hint.textContent = `(전산: ${currStock}개)`;
    }

    // 해당 일자에 이미 등록된 실재고 기록이 있는지 확인
    const existing = stockAudits.find(item => item.date === selectedDate && item.artNo === cleanNo);
    if (existing) {
      if (storeInput) storeInput.value = existing.storeQty !== undefined ? existing.storeQty : 0;
      if (whInput) whInput.value = existing.warehouseQty !== undefined ? existing.warehouseQty : existing.qty;
      if (noteInput && existing.note) noteInput.value = existing.note;
    } else {
      if (storeInput) storeInput.value = "";
      if (whInput) whInput.value = "";
      if (noteInput) noteInput.value = "";
    }
    updateAuditTotalPreview();
  } else {
    // 8자리 번호 입력 완료 또는 14자리 바코드 스캔 시
    if (cleanNo.length === 8 || digitsOnly.length === 14) {
      if (confirmedUnregisteredArtNo !== cleanNo) {
        if (artNameInput) artNameInput.value = "";
        if (hfbInput) hfbInput.value = "";
        if (locInput) locInput.value = "";
        if (hint) hint.textContent = "";
        if (icon) icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color: #d97706;"></i>';
        updateAuditTotalPreview();
        openAuditUnregisteredModal(cleanNo);
        return;
      }
    } else {
      if (artNameInput) artNameInput.value = "";
      if (hfbInput) hfbInput.value = "";
      if (locInput) locInput.value = "";
      if (hint) hint.textContent = "";
      if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: #d97706;"></i>';
      updateAuditTotalPreview();
    }
  }
}

// Enter 키 입력 핸들러
function onAuditArtNoKeyDown(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    const rawVal = (e.target ? e.target.value : "").trim();
    if (!rawVal) {
      if (typeof showToast === "function") showToast("아티클 번호를 입력해 주세요.", "danger");
      return;
    }

    const digitsOnly = rawVal.replace(/\D/g, "");
    const cleanNo = digitsOnly.length === 14 ? digitsOnly.substring(0, 8) : (digitsOnly.length >= 8 ? digitsOnly.slice(-8) : rawVal);

    if (typeof masterCatalog !== "undefined" && masterCatalog) {
      const matched = masterCatalog.find(m => String(m.artNo).trim() === cleanNo);
      if (matched) {
        if (auditInputMode === "wh") {
          const whInput = document.getElementById("audit-warehouse-qty");
          if (whInput) whInput.focus();
        } else {
          const storeInput = document.getElementById("audit-store-qty");
          if (storeInput) storeInput.focus();
        }
      } else {
        if (confirmedUnregisteredArtNo !== cleanNo) {
          openAuditUnregisteredModal(cleanNo);
        } else {
          if (auditInputMode === "wh") {
            const whInput = document.getElementById("audit-warehouse-qty");
            if (whInput) whInput.focus();
          } else {
            const storeInput = document.getElementById("audit-store-qty");
            if (storeInput) storeInput.focus();
          }
        }
      }
    }
  }
}

function clearAuditFormFields() {
  const artNameInput = document.getElementById("audit-artname");
  const hfbInput = document.getElementById("audit-hfb");
  const locInput = document.getElementById("audit-location");
  const icon = document.getElementById("audit-artname-status-icon");
  const hint = document.getElementById("audit-curr-stock-hint");
  const storeInput = document.getElementById("audit-store-qty");
  const whInput = document.getElementById("audit-warehouse-qty");
  const noteInput = document.getElementById("audit-note");

  if (artNameInput) artNameInput.value = "";
  if (hfbInput) hfbInput.value = "";
  if (locInput) locInput.value = "";
  if (hint) hint.textContent = "";
  if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-info" style="color: #94a3b8;"></i>';
  if (storeInput) storeInput.value = "";
  if (whInput) whInput.value = "";
  if (noteInput) noteInput.value = "";
  updateAuditTotalPreview();
}

// 3. 재고 입력 모드 전환 (둘다 / 매장 / 창고)
function setAuditInputMode(mode) {
  auditInputMode = mode || "both";

  const chipBoth = document.getElementById("audit-chip-both");
  const chipStore = document.getElementById("audit-chip-store");
  const chipWh = document.getElementById("audit-chip-wh");

  if (chipBoth) chipBoth.classList.toggle("active", auditInputMode === "both");
  if (chipStore) chipStore.classList.toggle("active", auditInputMode === "store");
  if (chipWh) chipWh.classList.toggle("active", auditInputMode === "wh");

  const storeGroup = document.getElementById("audit-store-group");
  const whGroup = document.getElementById("audit-warehouse-group");
  const qtyGrid = document.getElementById("audit-qty-grid");
  const totalGroup = document.getElementById("audit-total-preview-group");
  const noteGrid = document.getElementById("audit-note-grid");
  const submitBtn = document.getElementById("btn-audit-add");
  const modeDesc = document.getElementById("audit-mode-desc");

  if (auditInputMode === "both") {
    if (storeGroup) storeGroup.style.display = "block";
    if (whGroup) whGroup.style.display = "block";
    if (qtyGrid) qtyGrid.style.gridTemplateColumns = "1fr 1fr";
    if (totalGroup) totalGroup.style.display = "flex";
    if (noteGrid) noteGrid.style.gridTemplateColumns = "1fr 1.3fr";
    if (modeDesc) modeDesc.textContent = "매장 및 창고 재고 동시 입력";
    if (submitBtn) {
      submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 실재고 등록 / 수정 (매장+창고)';
      submitBtn.style.background = "#0058a3";
    }
  } else if (auditInputMode === "store") {
    if (storeGroup) storeGroup.style.display = "block";
    if (whGroup) whGroup.style.display = "none";
    if (qtyGrid) qtyGrid.style.gridTemplateColumns = "1fr";
    if (totalGroup) totalGroup.style.display = "none";
    if (noteGrid) noteGrid.style.gridTemplateColumns = "1fr";
    if (modeDesc) modeDesc.textContent = "🏪 매장 재고 단독 입력";
    if (submitBtn) {
      submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 매장 실재고 등록 / 수정';
      submitBtn.style.background = "#2563eb";
    }
    const storeInput = document.getElementById("audit-store-qty");
    if (storeInput) storeInput.focus();
  } else if (auditInputMode === "wh") {
    if (storeGroup) storeGroup.style.display = "none";
    if (whGroup) whGroup.style.display = "block";
    if (qtyGrid) qtyGrid.style.gridTemplateColumns = "1fr";
    if (totalGroup) totalGroup.style.display = "none";
    if (noteGrid) noteGrid.style.gridTemplateColumns = "1fr";
    if (modeDesc) modeDesc.textContent = "🏬 창고 재고 단독 입력";
    if (submitBtn) {
      submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 창고 실재고 등록 / 수정';
      submitBtn.style.background = "#7c3aed";
    }
    const whInput = document.getElementById("audit-warehouse-qty");
    if (whInput) whInput.focus();
  }

  updateAuditTotalPreview();
}

// 3-B. 목록 보기 필터 전환 (둘다 / 매장 / 창고)
function setAuditListTypeFilter(type) {
  auditListTypeFilter = type || "both";

  const chipBoth = document.getElementById("audit-list-chip-both");
  const chipStore = document.getElementById("audit-list-chip-store");
  const chipWh = document.getElementById("audit-list-chip-wh");

  if (chipBoth) chipBoth.classList.toggle("active", auditListTypeFilter === "both");
  if (chipStore) chipStore.classList.toggle("active", auditListTypeFilter === "store");
  if (chipWh) chipWh.classList.toggle("active", auditListTypeFilter === "wh");

  renderAuditList();
}

// 4. 실재고 등록 폼 제출 (매장 / 창고 / 둘다 모드 지원)
async function handleAuditSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();

  const dateInput = document.getElementById("audit-date");
  const artNoInput = document.getElementById("audit-artno");
  const artNameInput = document.getElementById("audit-artname");
  const hfbInput = document.getElementById("audit-hfb");
  const locInput = document.getElementById("audit-location");
  const storeInput = document.getElementById("audit-store-qty");
  const whInput = document.getElementById("audit-warehouse-qty");
  const noteInput = document.getElementById("audit-note");
  const userInput = document.getElementById("audit-user");

  const dateVal = (dateInput ? dateInput.value : "") || getTodayAuditDate();
  const rawArtNo = (artNoInput ? artNoInput.value : "").trim();
  const digitsOnly = rawArtNo.replace(/\D/g, "");
  const artNo = digitsOnly.length === 14 ? digitsOnly.substring(0, 8) : (digitsOnly.length >= 8 ? digitsOnly.slice(-8) : rawArtNo);
  const artName = (artNameInput ? artNameInput.value : "").trim();
  const hfb = (hfbInput ? hfbInput.value : "").trim();
  const location = (locInput ? locInput.value : "").trim();
  const note = (noteInput ? noteInput.value : "").trim();
  const user = (userInput ? userInput.value : "").trim() || (typeof currentUser !== "undefined" ? currentUser : "User");

  if (!artNo) {
    if (typeof showToast === "function") showToast("아티클 번호를 입력해 주세요.", "danger");
    if (artNoInput) artNoInput.focus();
    return;
  }

  // 기존 해당 일자/품목 있는지 확인 -> 있으면 기존 수량 참조
  const existingIdx = stockAudits.findIndex(item => item.date === dateVal && item.artNo === artNo);
  const existingRecord = existingIdx >= 0 ? stockAudits[existingIdx] : null;

  let storeQty = 0;
  let warehouseQty = 0;

  if (auditInputMode === "both") {
    storeQty = Number(storeInput ? storeInput.value : 0) || 0;
    warehouseQty = Number(whInput ? whInput.value : 0) || 0;
  } else if (auditInputMode === "store") {
    storeQty = Number(storeInput ? storeInput.value : 0) || 0;
    warehouseQty = existingRecord ? Number(existingRecord.warehouseQty !== undefined ? existingRecord.warehouseQty : existingRecord.qty || 0) : 0;
  } else if (auditInputMode === "wh") {
    warehouseQty = Number(whInput ? whInput.value : 0) || 0;
    storeQty = existingRecord ? Number(existingRecord.storeQty || 0) : 0;
  }

  const qty = storeQty + warehouseQty;

  if (storeQty < 0 || warehouseQty < 0) {
    if (typeof showToast === "function") showToast("재고 수량을 올바르게 입력해 주세요. (0 이상)", "danger");
    return;
  }

  // 마스터 품목 매핑 확인
  let finalArtName = artName;
  let finalHfb = hfb;
  let finalLoc = location;

  if (typeof masterCatalog !== "undefined" && masterCatalog) {
    const matched = masterCatalog.find(m => String(m.artNo).trim() === artNo);
    if (matched) {
      if (!finalArtName) finalArtName = matched.artName;
      if (!finalHfb) finalHfb = matched.hfb;
      if (!finalLoc) finalLoc = matched.location;
    } else {
      if (!finalArtName && confirmedUnregisteredArtNo !== artNo) {
        openAuditUnregisteredModal(artNo);
        if (typeof showToast === "function") showToast("IKEA 카탈로그에 없는 미등록 품목입니다. 안내창을 확인해 주세요.", "warning");
        return;
      }
      if (!finalArtName) finalArtName = "미등록 신규 품목";
      if (!finalHfb) finalHfb = "일반";
      if (!finalLoc) finalLoc = "매장";
    }
  }

  const recordId = existingRecord ? existingRecord.id : "audit_" + Date.now();

  const auditRecord = {
    id: recordId,
    date: dateVal,
    artNo: artNo,
    artName: finalArtName || "미지정 품목",
    hfb: finalHfb || "기타",
    location: finalLoc || "B1",
    storeQty: storeQty,
    warehouseQty: warehouseQty,
    qty: qty,
    user: user,
    note: note || (existingRecord ? existingRecord.note : ""),
    created_at: existingRecord ? existingRecord.created_at : new Date().toISOString()
  };

  if (existingIdx >= 0) {
    stockAudits[existingIdx] = auditRecord;
    if (auditInputMode === "store") {
      if (typeof showToast === "function") showToast(`[${artNo}] 매장 재고가 ${storeQty}개(총 ${qty}개)로 저장되었습니다.`, "info");
    } else if (auditInputMode === "wh") {
      if (typeof showToast === "function") showToast(`[${artNo}] 창고 재고가 ${warehouseQty}개(총 ${qty}개)로 저장되었습니다.`, "info");
    } else {
      if (typeof showToast === "function") showToast(`[${artNo}] 실재고 수정 완료! (매장: ${storeQty}, 창고: ${warehouseQty}, 총: ${qty}개)`, "info");
    }
  } else {
    stockAudits.unshift(auditRecord);
    if (auditInputMode === "store") {
      if (typeof showToast === "function") showToast(`[${artNo}] ${finalArtName} 매장 재고 ${storeQty}개 등록 완료!`, "success");
    } else if (auditInputMode === "wh") {
      if (typeof showToast === "function") showToast(`[${artNo}] ${finalArtName} 창고 재고 ${warehouseQty}개 등록 완료!`, "success");
    } else {
      if (typeof showToast === "function") showToast(`[${artNo}] ${finalArtName} 실재고 등록 완료! (총: ${qty}개)`, "success");
    }
  }

  saveStockAuditsToStorage();
  renderAuditList();

  // 시스템 전산 재고 및 입출고 기록 실시간 연동 (매장+창고 또는 창고 모드 시)
  if (auditInputMode === "both" || auditInputMode === "wh") {
    syncWarehouseStockAdjustment(artNo, finalArtName, warehouseQty, dateVal, user, auditRecord);
  }

  // Supabase 비동기 동기화 시도 (백그라운드)
  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    const dbPayload = {
      id: String(recordId),
      audit_date: dateVal,
      artno: artNo,
      artname: finalArtName,
      hfb: finalHfb,
      location: finalLoc,
      store_qty: storeQty,
      warehouse_qty: warehouseQty,
      qty: qty,
      user_name: user,
      note: auditRecord.note
    };
    try {
      supabaseClient.from("stock_audits").upsert([dbPayload]).then(({ error }) => {
        if (error) {
          console.warn("Supabase stock_audits upsert notice:", error.message);
          if (error.code === "PGRST205") {
            console.error("Supabase에 'stock_audits' 테이블이 생성되지 않았습니다. SQL 쿼리를 실행해 테이블을 생성해주세요.");
          }
        }
      });
    } catch (err) {
      console.warn("Supabase audit sync err:", err);
    }
  }

  // 입력창 초기화 및 다음 입력을 위해 아티클 입력창에 포커스
  confirmedUnregisteredArtNo = null;
  if (artNoInput) {
    artNoInput.value = "";
    artNoInput.focus();
  }
  clearAuditFormFields();
}

// 창고 실재고 변경 시 시스템 전산 재고(historyLogs & Supabase inventory_logs)와 실시간 연동
function syncWarehouseStockAdjustment(artNo, artName, targetWhQty, dateVal, userVal, auditRecord) {
  if (typeof getItemStock !== "function") return;
  const cleanNo = String(artNo || "").trim();
  const currentStock = getItemStock(cleanNo);
  const targetWh = Number(targetWhQty) || 0;
  const delta = targetWh - Number(currentStock);
  if (delta === 0) return; // 변동 없음

  const adjustDate = dateVal || getTodayAuditDate();
  const adjustUser = userVal || (typeof currentUser !== "undefined" && currentUser ? currentUser : "조사자");
  const isIncrease = delta > 0;
  const changeQty = Math.abs(delta);

  const resolvedName = artName || (typeof masterCatalogMap !== "undefined" && masterCatalogMap ? (masterCatalogMap.get(cleanNo) || "") : "") || "기타 품목";

  const newLog = {
    id: Date.now(),
    date: adjustDate,
    type: isIncrease ? "입고" : "출고",
    artNo: cleanNo,
    artName: resolvedName,
    qty: changeQty,
    user: adjustUser,
    created_at: new Date().toISOString()
  };

  // auditRecord에 생성된 logId 기록 (삭제 시 롤백용)
  if (auditRecord) {
    if (!auditRecord.logIds) auditRecord.logIds = [];
    auditRecord.logIds.push(newLog.id);
    saveStockAuditsToStorage();
  }

  // 1. 로컬 historyLogs 갱신
  if (typeof historyLogs !== "undefined") {
    historyLogs.unshift(newLog);
    try {
      localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
    } catch (e) {}
  }

  // 2. 전산 재고 캐시 무효화 및 화면 렌더링
  if (typeof cachedStockMap !== "undefined") {
    cachedStockMap = null;
  }
  if (typeof renderStockLookup === "function") renderStockLookup();
  if (typeof renderHistoryLogs === "function") renderHistoryLogs();
  if (typeof updateDashboard === "function") updateDashboard();
  if (typeof populateArticleFilterDropdown === "function") populateArticleFilterDropdown();

  // 3. Supabase inventory_logs 테이블 비동기 동기화
  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    const dbLogPayload = {
      date: newLog.date,
      type: newLog.type,
      artNo: newLog.artNo,
      artName: newLog.artName,
      qty: newLog.qty,
      user: newLog.user
    };
    try {
      supabaseClient.from("inventory_logs").insert([dbLogPayload]).select().then(({ data, error }) => {
        if (error) {
          console.warn("Supabase inventory_logs 실재고 조정 연동 알림:", error.message);
        } else if (data && data.length > 0) {
          const oldLocalId = newLog.id;
          const realDbId = data[0].id;
          newLog.id = realDbId;
          if (auditRecord && auditRecord.logIds) {
            const idx = auditRecord.logIds.indexOf(oldLocalId);
            if (idx >= 0) auditRecord.logIds[idx] = realDbId;
            saveStockAuditsToStorage();
          }
          if (typeof historyLogs !== "undefined") {
            try {
              localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
            } catch (e) {}
          }
        }
      });
    } catch (err) {
      console.warn("Supabase inventory_logs sync error:", err);
    }
  }
}

// 5. 날짜 변경 시 해당 일자 목록 새로고침
function onAuditDateChange() {
  renderAuditList();
}

// 6. 목록 검색 및 HFB 필터 핸들러
function onAuditSearchInput(val) {
  auditSearchQuery = (val || "").trim().toLowerCase();
  renderAuditList();
}

function onAuditHfbChange(val) {
  auditHfbFilter = val || "ALL";
  renderAuditList();
}

// 7. 실재고 목록 렌더링 (매장 / 창고 / 둘다 필터 지원)
function renderAuditList() {
  const container = document.getElementById("audit-list-container");
  if (!container) return;

  const dateInput = document.getElementById("audit-date");
  const selectedDate = (dateInput ? dateInput.value : "") || getTodayAuditDate();

  // 해당 일자 데이터 필터링
  let list = stockAudits.filter(item => item.date === selectedDate);

  // HFB 필터
  if (auditHfbFilter && auditHfbFilter !== "ALL") {
    list = list.filter(item => item.hfb === auditHfbFilter);
  }

  // 검색어 필터
  if (auditSearchQuery) {
    list = list.filter(item => 
      item.artNo.toLowerCase().includes(auditSearchQuery) ||
      item.artName.toLowerCase().includes(auditSearchQuery) ||
      (item.location && item.location.toLowerCase().includes(auditSearchQuery)) ||
      (item.user && item.user.toLowerCase().includes(auditSearchQuery))
    );
  }

  // 요약 통계 업데이트 (필터 전 당일 전체 합계)
  const totalCountElem = document.getElementById("audit-summary-count");
  const storeQtyElem = document.getElementById("audit-summary-store-qty");
  const whQtyElem = document.getElementById("audit-summary-wh-qty");
  const totalQtyElem = document.getElementById("audit-summary-total-qty");
  const dateBadgeElem = document.getElementById("audit-summary-date");

  const totalStoreQty = list.reduce((sum, item) => sum + Number(item.storeQty || 0), 0);
  const totalWhQty = list.reduce((sum, item) => sum + Number(item.warehouseQty !== undefined ? item.warehouseQty : item.qty || 0), 0);
  const totalQty = totalStoreQty + totalWhQty;

  if (totalCountElem) totalCountElem.textContent = list.length;
  if (storeQtyElem) storeQtyElem.textContent = totalStoreQty.toLocaleString();
  if (whQtyElem) whQtyElem.textContent = totalWhQty.toLocaleString();
  if (totalQtyElem) totalQtyElem.textContent = totalQty.toLocaleString();
  if (dateBadgeElem) dateBadgeElem.textContent = selectedDate;

  // 구분 필터 (둘다 / 매장만 / 창고만)
  if (auditListTypeFilter === "store") {
    list = list.filter(item => Number(item.storeQty || 0) > 0);
  } else if (auditListTypeFilter === "wh") {
    list = list.filter(item => Number(item.warehouseQty !== undefined ? item.warehouseQty : item.qty || 0) > 0);
  }

  if (list.length === 0) {
    const filterNotice = auditListTypeFilter === "store" ? "매장 재고가 있는 " : (auditListTypeFilter === "wh" ? "창고 재고가 있는 " : "");
    container.innerHTML = `
      <div style="text-align: center; padding: 36px 16px; background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 14px; color: #64748b;">
        <i class="fa-solid fa-clipboard-list" style="font-size: 32px; color: #94a3b8; margin-bottom: 8px;"></i>
        <p style="margin: 0; font-size: 13.5px; font-weight: 700; color: #334155;">해당 일자(${selectedDate})에 등록된 ${filterNotice}실재고 기록이 없습니다.</p>
        <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">상단 입력창에서 바코드를 스캔하거나 아티클 번호를 입력하여 매장/창고 실재고를 등록해 보세요.</p>
      </div>
    `;
    return;
  }

  let html = "";
  list.forEach((item) => {
    const artNo = item.artNo;
    const thumbUrl = `https://www.ikea.com/kr/ko/images/products/${artNo}_pe000000_s5.jpg`;
    const storeVal = Number(item.storeQty || 0);
    const whVal = Number(item.warehouseQty !== undefined ? item.warehouseQty : item.qty || 0);
    const totalVal = storeVal + whVal;

    html += `
      <div class="audit-item-card" id="audit-card-${item.id}">
        
        <!-- 상단: 썸네일 & 품목 정보 & 삭제 버튼 -->
        <div class="audit-card-main">
          <div class="audit-item-thumb">
            <img src="${thumbUrl}" alt="${item.artName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" class="audit-thumb-img">
            <div class="audit-thumb-placeholder" style="display:none;"><i class="fa-solid fa-box"></i></div>
          </div>
          
          <div class="audit-item-info">
            <div class="audit-item-header">
              <span class="audit-item-artno">${item.artNo}</span>
              ${item.hfb ? `<span class="audit-item-hfb">${item.hfb}</span>` : ''}
              ${item.location ? `<span class="audit-item-loc"><i class="fa-solid fa-location-dot"></i> ${item.location}</span>` : ''}
            </div>
            <div class="audit-item-name" title="${item.artName}">${item.artName}</div>
            <div class="audit-item-meta">
              <span><i class="fa-regular fa-user"></i> ${item.user || '조사자'}</span>
              ${item.note ? `<span class="audit-item-note"><i class="fa-regular fa-comment-dots"></i> ${item.note}</span>` : ''}
            </div>
          </div>

          <button type="button" class="audit-del-btn" onclick="deleteAuditItem('${item.id}')" title="실재고 기록 삭제">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>

        <!-- 하단: 3열 마이크로 그리드 (매장 / 창고 / 총 실재고) -->
        <div class="audit-card-qty-grid">
          
          <!-- 1. 매장 재고 -->
          <div class="audit-qty-cell store" onclick="promptEditAuditStoreQty('${item.id}', ${storeVal})" title="클릭하여 매장 재고 직접 수정">
            <div class="audit-cell-label"><i class="fa-solid fa-shop"></i> 매장</div>
            <div class="audit-cell-value">
              ${storeVal.toLocaleString()}개
              <i class="fa-solid fa-pen" style="font-size:8.5px; opacity:0.6;"></i>
            </div>
          </div>

          <!-- 2. 창고 재고 스테퍼 -->
          <div class="audit-qty-cell wh">
            <div class="audit-cell-label"><i class="fa-solid fa-warehouse"></i> 창고</div>
            <div class="audit-cell-stepper">
              <button type="button" class="stepper-btn" onclick="stepAuditWarehouseQty('${item.id}', -1)" title="창고 재고 1 감소">-</button>
              <span class="stepper-val" onclick="promptEditAuditWarehouseQty('${item.id}', ${whVal})" title="클릭하여 창고 재고 직접 수정">${whVal.toLocaleString()}</span>
              <button type="button" class="stepper-btn" onclick="stepAuditWarehouseQty('${item.id}', 1)" title="창고 재고 1 증가">+</button>
            </div>
          </div>

          <!-- 3. 총 실재고 합계 -->
          <div class="audit-qty-cell total">
            <div class="audit-cell-label">총 실재고</div>
            <div class="audit-cell-value">${totalVal.toLocaleString()}개</div>
          </div>

        </div>

      </div>
    `;
  });

  container.innerHTML = html;
}

// 8. 창고 재고 수량 증감 버튼 (+ / -)
function stepAuditWarehouseQty(id, delta) {
  const item = stockAudits.find(a => String(a.id) === String(id));
  if (!item) return;

  const currentWh = Number(item.warehouseQty !== undefined ? item.warehouseQty : item.qty || 0);
  const newWh = Math.max(0, currentWh + delta);
  item.warehouseQty = newWh;
  item.qty = Number(item.storeQty || 0) + newWh;

  saveStockAuditsToStorage();
  renderAuditList();

  // 시스템 전산 재고 및 입출고 기록 실시간 연동
  syncWarehouseStockAdjustment(item.artNo, item.artName, newWh, item.date, item.user, item);

  // Supabase 비동기 동기화
  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    try {
      supabaseClient.from("stock_audits").update({ warehouse_qty: newWh, qty: item.qty }).eq("id", id);
    } catch (e) {}
  }
}

// 9-A. 창고 재고 수량 직접 입력 프롬프트
function promptEditAuditWarehouseQty(id, currentQty) {
  const input = prompt("수정할 [창고 재고] 수량을 입력하세요:", currentQty);
  if (input === null) return;

  const newWh = Number(input);
  if (isNaN(newWh) || newWh < 0) {
    if (typeof showToast === "function") showToast("올바른 수량을 입력해 주세요 (0 이상).", "danger");
    return;
  }

  const item = stockAudits.find(a => String(a.id) === String(id));
  if (!item) return;

  item.warehouseQty = newWh;
  item.qty = Number(item.storeQty || 0) + newWh;

  saveStockAuditsToStorage();
  renderAuditList();
  if (typeof showToast === "function") showToast(`[${item.artNo}] 창고 재고가 ${newWh}개(총 ${item.qty}개)로 변경되었습니다.`, "success");

  // 시스템 전산 재고 및 입출고 기록 실시간 연동
  syncWarehouseStockAdjustment(item.artNo, item.artName, newWh, item.date, item.user, item);

  // Supabase 비동기 동기화
  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    try {
      supabaseClient.from("stock_audits").update({ warehouse_qty: newWh, qty: item.qty }).eq("id", id);
    } catch (e) {}
  }
}

// 9-B. 매장 재고 수량 직접 입력 프롬프트
function promptEditAuditStoreQty(id, currentQty) {
  const input = prompt("수정할 [매장 재고] 수량을 입력하세요:", currentQty);
  if (input === null) return;

  const newStore = Number(input);
  if (isNaN(newStore) || newStore < 0) {
    if (typeof showToast === "function") showToast("올바른 수량을 입력해 주세요 (0 이상).", "danger");
    return;
  }

  const item = stockAudits.find(a => String(a.id) === String(id));
  if (!item) return;

  const currentWh = Number(item.warehouseQty !== undefined ? item.warehouseQty : item.qty || 0);
  item.storeQty = newStore;
  item.qty = newStore + currentWh;

  saveStockAuditsToStorage();
  renderAuditList();
  if (typeof showToast === "function") showToast(`[${item.artNo}] 매장 재고가 ${newStore}개(총 ${item.qty}개)로 변경되었습니다.`, "success");

  // Supabase 비동기 동기화
  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    try {
      supabaseClient.from("stock_audits").update({ store_qty: newStore, qty: item.qty }).eq("id", id);
    } catch (e) {}
  }
}

// 하위 호환성 유지용 (stepAuditQty, promptEditAuditQty)
function stepAuditQty(id, delta) {
  stepAuditWarehouseQty(id, delta);
}
function promptEditAuditQty(id, currentQty) {
  promptEditAuditWarehouseQty(id, currentQty);
}

// 10. 단일 품목 삭제 (실재고 기록 및 연동된 입출고 로그 자동 롤백)
async function deleteAuditItem(id) {
  const item = stockAudits.find(a => String(a.id) === String(id));
  if (!item) return;

  if (!confirm(`[${item.artNo}] ${item.artName} 실재고 기록을 삭제하시겠습니까?\n(연동된 창고 재고 조정 내역도 함께 취소됩니다.)`)) {
    return;
  }

  // 1. 연동된 입출고 조정 로그 롤백 (historyLogs 및 Supabase inventory_logs에서 삭제)
  if (typeof historyLogs !== "undefined") {
    if (item.logIds && item.logIds.length > 0) {
      const logIdSet = new Set(item.logIds.map(String));
      historyLogs = historyLogs.filter(l => !logIdSet.has(String(l.id)));
    } else {
      // logIds가 없는 경우 해당 일자/품목/조사자의 당일 조정 기록 필터링
      historyLogs = historyLogs.filter(l => !(String(l.artNo).trim() === String(item.artNo).trim() && l.date === item.date && l.user === item.user));
    }
    try {
      localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
    } catch (e) {}
  }

  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    if (item.logIds && item.logIds.length > 0) {
      for (const logId of item.logIds) {
        try {
          await supabaseClient.from("inventory_logs").delete().eq("id", logId);
        } catch (e) {}
      }
    } else {
      try {
        await supabaseClient.from("inventory_logs").delete().eq("artNo", item.artNo).eq("date", item.date).eq("user", item.user);
      } catch (e) {}
    }
  }

  // 2. 전산 재고 캐시 무효화 및 화면 즉시 갱신
  if (typeof cachedStockMap !== "undefined") {
    cachedStockMap = null;
  }
  if (typeof renderStockLookup === "function") renderStockLookup();
  if (typeof renderHistoryLogs === "function") renderHistoryLogs();
  if (typeof updateDashboard === "function") updateDashboard();
  if (typeof populateArticleFilterDropdown === "function") populateArticleFilterDropdown();

  // 3. 실재고 목록에서 삭제 및 Supabase 동기화
  stockAudits = stockAudits.filter(a => String(a.id) !== String(id));
  saveStockAuditsToStorage();
  renderAuditList();
  if (typeof showToast === "function") showToast("실재고 기록 및 연동된 재고 조정 내역이 삭제되었습니다.", "info");

  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    try {
      await supabaseClient.from("stock_audits").delete().eq("id", id);
    } catch (e) {}
  }
}

// 11. 당일 전체 실재고 내역 삭제 (연동된 조정 로그 일괄 롤백)
async function clearTodayAudits() {
  const dateInput = document.getElementById("audit-date");
  const selectedDate = (dateInput ? dateInput.value : "") || getTodayAuditDate();

  const todayItems = stockAudits.filter(a => a.date === selectedDate);
  const count = todayItems.length;
  if (count === 0) {
    if (typeof showToast === "function") showToast("삭제할 실재고 기록이 없습니다.", "warning");
    return;
  }

  if (!confirm(`정말로 ${selectedDate} 일자의 모든 실재고 기록(${count}건)을 삭제하시겠습니까?\n(연동된 모든 창고 재고 조정 내역도 함께 취소됩니다.)`)) {
    return;
  }

  // 1. 연동된 입출고 조정 로그 일괄 롤백
  const allLogIds = [];
  todayItems.forEach(item => {
    if (item.logIds && item.logIds.length > 0) {
      allLogIds.push(...item.logIds);
    }
  });

  if (typeof historyLogs !== "undefined") {
    if (allLogIds.length > 0) {
      const allLogSet = new Set(allLogIds.map(String));
      historyLogs = historyLogs.filter(l => !allLogSet.has(String(l.id)));
    } else {
      const artNoSet = new Set(todayItems.map(item => String(item.artNo).trim()));
      historyLogs = historyLogs.filter(l => !(artNoSet.has(String(l.artNo).trim()) && l.date === selectedDate));
    }
    try {
      localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
    } catch (e) {}
  }

  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    if (allLogIds.length > 0) {
      for (const logId of allLogIds) {
        try {
          await supabaseClient.from("inventory_logs").delete().eq("id", logId);
        } catch (e) {}
      }
    } else {
      for (const item of todayItems) {
        try {
          await supabaseClient.from("inventory_logs").delete().eq("artNo", item.artNo).eq("date", selectedDate).eq("user", item.user);
        } catch (e) {}
      }
    }
  }

  // 2. 전산 재고 캐시 무효화 및 화면 갱신
  if (typeof cachedStockMap !== "undefined") {
    cachedStockMap = null;
  }
  if (typeof renderStockLookup === "function") renderStockLookup();
  if (typeof renderHistoryLogs === "function") renderHistoryLogs();
  if (typeof updateDashboard === "function") updateDashboard();
  if (typeof populateArticleFilterDropdown === "function") populateArticleFilterDropdown();

  // 3. 실재고 목록 삭제 및 Supabase 동기화
  stockAudits = stockAudits.filter(a => a.date !== selectedDate);
  saveStockAuditsToStorage();
  renderAuditList();
  if (typeof showToast === "function") showToast(`${selectedDate} 일자의 실재고 및 재고 조정 내역이 모두 삭제되었습니다.`, "info");

  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    try {
      await supabaseClient.from("stock_audits").delete().eq("audit_date", selectedDate);
    } catch (e) {}
  }
}

// 12. 실재고 조사표 엑셀 다운로드 (.xlsx) - 매장/창고/총실재고 분리 표기
function exportAuditToExcel() {
  if (typeof XLSX === "undefined") {
    if (typeof showToast === "function") showToast("엑셀 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.", "danger");
    return;
  }

  const dateInput = document.getElementById("audit-date");
  const selectedDate = (dateInput ? dateInput.value : "") || getTodayAuditDate();

  const list = stockAudits.filter(item => item.date === selectedDate);

  if (list.length === 0) {
    if (typeof showToast === "function") showToast(`선택한 날짜(${selectedDate})에 추출할 실재고 데이터가 없습니다.`, "warning");
    return;
  }

  // 8자리 숫자형 표준 서식
  const rows = list.map((item, idx) => {
    let artNoNum = parseInt(item.artNo, 10);
    if (isNaN(artNoNum)) artNoNum = item.artNo;

    const storeVal = Number(item.storeQty || 0);
    const whVal = Number(item.warehouseQty !== undefined ? item.warehouseQty : item.qty || 0);
    const totalVal = storeVal + whVal;

    return {
      "순번": idx + 1,
      "조사일자": item.date,
      "아티클번호": artNoNum,
      "상품명": item.artName,
      "HFB": item.hfb || "",
      "위치": item.location || "",
      "매장재고": storeVal,
      "창고재고": whVal,
      "총실재고(합계)": totalVal,
      "조사자": item.user || "",
      "비고": item.note || "",
      "등록시각": item.created_at ? new Date(item.created_at).toLocaleString("ko-KR") : ""
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  // 셀 서식 지정 (아티클 번호 00000000)
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r + 1; R <= range.e.r; ++R) {
    const artNoCellRef = XLSX.utils.encode_cell({ r: R, c: 2 });
    const cell = ws[artNoCellRef];
    if (cell && typeof cell.v === 'number') {
      cell.t = 'n';
      cell.z = '00000000';
    }
  }

  // 열 너비
  ws['!cols'] = [
    { wch: 6 },   // 순번
    { wch: 12 },  // 조사일자
    { wch: 12 },  // 아티클번호
    { wch: 36 },  // 상품명
    { wch: 16 },  // HFB
    { wch: 10 },  // 위치
    { wch: 10 },  // 매장재고
    { wch: 10 },  // 창고재고
    { wch: 14 },  // 총실재고(합계)
    { wch: 12 },  // 조사자
    { wch: 20 },  // 비고
    { wch: 20 }   // 등록시각
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "실재고기록");

  const fileName = `IKEA_실재고기록_${selectedDate}.xlsx`;
  XLSX.writeFile(wb, fileName);

  if (typeof showToast === "function") {
    showToast(`실재고 엑셀 파일(${fileName})이 다운로드되었습니다!`, "success");
  }
}

// 글로벌 윈도우 객체 바인딩
window.initAuditTab = initAuditTab;
window.setAuditDateToday = setAuditDateToday;
window.setAuditDateYesterday = setAuditDateYesterday;
window.setAuditInputMode = setAuditInputMode;
window.setAuditListTypeFilter = setAuditListTypeFilter;
window.onAuditArtNoInput = onAuditArtNoInput;
window.onAuditArtNoKeyDown = onAuditArtNoKeyDown;
window.openAuditUnregisteredModal = openAuditUnregisteredModal;
window.closeAuditUnregisteredModal = closeAuditUnregisteredModal;
window.confirmAuditUnregisteredProduct = confirmAuditUnregisteredProduct;
window.playAuditWarningBeep = playAuditWarningBeep;
window.playAuditWarningHaptic = playAuditWarningHaptic;
window.handleAuditSubmit = handleAuditSubmit;
window.onAuditDateChange = onAuditDateChange;
window.onAuditSearchInput = onAuditSearchInput;
window.onAuditHfbChange = onAuditHfbChange;
window.renderAuditList = renderAuditList;
window.stepAuditWarehouseQty = stepAuditWarehouseQty;
window.promptEditAuditWarehouseQty = promptEditAuditWarehouseQty;
window.promptEditAuditStoreQty = promptEditAuditStoreQty;
window.stepAuditQty = stepAuditQty;
window.promptEditAuditQty = promptEditAuditQty;
window.deleteAuditItem = deleteAuditItem;
window.clearTodayAudits = clearTodayAudits;
window.exportAuditToExcel = exportAuditToExcel;
window.syncWarehouseStockAdjustment = syncWarehouseStockAdjustment;


