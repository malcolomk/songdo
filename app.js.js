// Mobile Warehouse Inventory App Logic (LocalStorage + SheetJS + Auth + Admin Roles + Guest Accounts)

// --- Allowed User IDs List ---
const ALLOWED_USER_IDS = [
  "guest1", "guest2",
  "sulee21", "jocho16", "jipark5", "jipar5", "hycho30", "julee33", 
  "tabae3", "goyoo", "suahn2", "yehan1", "secho12"
];

// --- Designated Admin Users List ---
const ADMIN_USERS = ["jipark5", "jipar5", "hycho30"];

// Initial default passwords (all '522')
const INITIAL_PASSWORD = "522";

// --- Sample Initial Master Data ---
const defaultMasterCatalog = [
  { artNo: "70582028", artName: "EKET 에케트 멀티미디어선반 70x35x35 화이트 AP" },
  { artNo: "90513393", artName: "KUGGIS 쿠기스 수납상자 18x26x8 화이트" },
  { artNo: "20351884", artName: "KALLAX 캘락스 선반유닛 77x147 화이트 AP" },
  { artNo: "30279944", artName: "ANTILOP 유아용식탁의자 시트 AP Sales" },
  { artNo: "10501548", artName: "LACK 렉세 선반유닛 92x76 그레이 실외용" },
  { artNo: "70483882", artName: "BAGGEBO 바게보 도어수납장 50x30x80" },
  { artNo: "40354283", artName: "MICKE 이동식서랍유 35x75 화이트 AP" },
  { artNo: "30231631", artName: "RIGGA 행거 화이트 AP CN" },
  { artNo: "40308700", artName: "TROFAST N 선반 30 라이트화이트스데인" }
];

// --- Sample Initial Transaction History ---
const defaultHistoryLogs = [
  { id: 1, date: "2026-07-30", type: "입고", artNo: "70582028", artName: "EKET 에케트 멀티미디어선반 70x35x35 화이트 AP", qty: 8, user: "hycho30" },
  { id: 2, date: "2026-07-30", type: "출고", artNo: "70582028", artName: "EKET 에케트 멀티미디어선반 70x35x35 화이트 AP", qty: 4, user: "jipark5" },
  { id: 3, date: "2026-07-30", type: "입고", artNo: "90513393", artName: "KUGGIS 쿠기스 수납상자 18x26x8 화이트", qty: 4, user: "guest1" }
];

// App State
let masterCatalog = [];
let historyLogs = [];
let userPasswords = {};
let currentUser = null;
let isAdminUser = false;

// Stock Index Cache
let stockIndexCache = null;

function invalidateStockCache() {
  stockIndexCache = null;
}

// Performance Optimization: Debounce Function
function debounce(fn, delay = 150) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function getStockIndex() {
  if (stockIndexCache) return stockIndexCache;

  const map = {};
  masterCatalog.forEach(item => {
    map[item.artNo] = {
      artNo: item.artNo,
      artName: item.artName,
      totalIn: 0,
      totalOut: 0,
      currentStock: 0
    };
  });

  historyLogs.forEach(log => {
    if (!map[log.artNo]) {
      map[log.artNo] = {
        artNo: log.artNo,
        artName: log.artName,
        totalIn: 0,
        totalOut: 0,
        currentStock: 0
      };
    }
    if (log.type === "입고") map[log.artNo].totalIn += Number(log.qty);
    if (log.type === "출고") map[log.artNo].totalOut += Number(log.qty);
  });

  Object.values(map).forEach(item => {
    item.currentStock = item.totalIn - item.totalOut;
  });

  stockIndexCache = map;
  return stockIndexCache;
}

// Debounced handlers for inputs
const debouncedRenderStockLookup = debounce(() => renderStockLookup(), 150);
const debouncedRenderMasterCatalog = debounce(() => renderMasterCatalog(), 150);
const debouncedRenderModalMasterList = debounce(() => renderModalMasterList(), 150);

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
  initAuthDB();
  loadDataFromStorage();
  checkLoginSession();
  initFormDate();
});

// --- Auth DB & Session Management ---
function initAuthDB() {
  const savedPasswords = localStorage.getItem("warehouse_user_passwords");
  if (savedPasswords) {
    try {
      userPasswords = JSON.parse(savedPasswords);
    } catch(e) {
      userPasswords = {};
    }
    ALLOWED_USER_IDS.forEach(id => {
      if (!userPasswords[id]) {
        userPasswords[id] = INITIAL_PASSWORD;
      }
    });
    saveUserPasswords();
  } else {
    userPasswords = {};
    ALLOWED_USER_IDS.forEach(id => {
      userPasswords[id] = INITIAL_PASSWORD;
    });
    saveUserPasswords();
  }
}

function saveUserPasswords() {
  localStorage.setItem("warehouse_user_passwords", JSON.stringify(userPasswords));
}

function checkLoginSession() {
  const sessionUser = localStorage.getItem("warehouse_current_user");
  const loginOverlay = document.getElementById("login-overlay");
  const userBadge = document.getElementById("user-profile-badge");
  const userNameElem = document.getElementById("current-user-name");
  const adminRoleBadge = document.getElementById("admin-role-badge");

  const btnExcelExport = document.getElementById("btn-excel-export");
  const excelExportLocked = document.getElementById("excel-export-locked");
  const adminExcelImportBox = document.getElementById("admin-excel-import-box");
  const userMasterNoticeBox = document.getElementById("user-master-notice-box");
  const btnAddMaster = document.getElementById("btn-add-master");
  const navMasterBtn = document.getElementById("nav-master-btn");

  if (sessionUser && ALLOWED_USER_IDS.includes(sessionUser)) {
    currentUser = sessionUser;
    isAdminUser = ADMIN_USERS.includes(sessionUser);

    if (loginOverlay) loginOverlay.classList.remove("active");
    if (userBadge) userBadge.style.display = "flex";
    if (userNameElem) userNameElem.textContent = sessionUser;

    if (isAdminUser) {
      if (adminRoleBadge) adminRoleBadge.style.display = "inline-block";
      if (btnExcelExport) btnExcelExport.style.display = "flex";
      if (excelExportLocked) excelExportLocked.style.display = "none";
      if (adminExcelImportBox) adminExcelImportBox.style.display = "block";
      if (userMasterNoticeBox) userMasterNoticeBox.style.display = "none";
      if (btnAddMaster) btnAddMaster.style.display = "block";
      if (navMasterBtn) navMasterBtn.style.display = "flex";
    } else {
      if (adminRoleBadge) adminRoleBadge.style.display = "none";
      if (btnExcelExport) btnExcelExport.style.display = "none";
      if (excelExportLocked) excelExportLocked.style.display = "inline-block";
      if (adminExcelImportBox) adminExcelImportBox.style.display = "none";
      if (userMasterNoticeBox) userMasterNoticeBox.style.display = "block";
      if (btnAddMaster) btnAddMaster.style.display = "none";
      if (navMasterBtn) navMasterBtn.style.display = "none";

      const masterTab = document.getElementById("tab-master");
      if (masterTab && masterTab.classList.contains("active")) {
        const regNavBtn = document.querySelectorAll(".bottom-nav .nav-item")[0];
        if (regNavBtn) switchTab("register", regNavBtn);
      }
    }

    renderStockLookup();
    renderHistoryLogs();
    renderMasterCatalog();
    populateArticleFilterDropdown();
  } else {
    currentUser = null;
    isAdminUser = false;
    if (loginOverlay) loginOverlay.classList.add("active");
    if (userBadge) userBadge.style.display = "none";
  }
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const inputId = document.getElementById("login-id").value.trim().toLowerCase();
  const inputPw = document.getElementById("login-pw").value.trim();

  if (!ALLOWED_USER_IDS.includes(inputId)) {
    showToast("접근 허가되지 않은 아이디입니다.", "danger");
    return;
  }

  const storedPw = userPasswords[inputId] || INITIAL_PASSWORD;

  if (inputPw === storedPw) {
    localStorage.setItem("warehouse_current_user", inputId);
    const roleTitle = ADMIN_USERS.includes(inputId) ? "관리자" : "일반 사용자";
    showToast(`${inputId}님 (${roleTitle}), 로그인되었습니다!`, "success");
    checkLoginSession();
  } else {
    showToast("비밀번호가 올바르지 않습니다.", "danger");
  }
}

function handleLogout() {
  localStorage.removeItem("warehouse_current_user");
  showToast("로그아웃 되었습니다.", "success");
  checkLoginSession();
}

function openResetPasswordModal() {
  const modal = document.getElementById("reset-pw-modal");
  if (modal) modal.classList.add("active");
}

function closeResetPasswordModal() {
  const modal = document.getElementById("reset-pw-modal");
  if (modal) modal.classList.remove("active");
}

function handleResetPasswordSubmit(e) {
  e.preventDefault();
  const selectId = document.getElementById("reset-id").value;
  const oldPw = document.getElementById("reset-old-pw").value.trim();
  const newPw = document.getElementById("reset-new-pw").value.trim();

  if (!selectId) {
    showToast("아이디를 선택해 주세요.", "danger");
    return;
  }

  const currentPw = userPasswords[selectId] || INITIAL_PASSWORD;

  if (oldPw !== currentPw) {
    showToast("현재 비밀번호가 일치하지 않습니다.", "danger");
    return;
  }

  if (!newPw) {
    showToast("새 비밀번호를 입력해 주세요.", "danger");
    return;
  }

  userPasswords[selectId] = newPw;
  saveUserPasswords();
  closeResetPasswordModal();

  showToast(`'${selectId}'의 비밀번호가 성공적으로 변경되었습니다!`, "success");
  document.getElementById("login-pw").value = newPw;
}

// --- Storage & Data Load Helpers ---
function loadDataFromStorage() {
  const savedCatalog = localStorage.getItem("warehouse_master_catalog");
  if (savedCatalog) {
    try { masterCatalog = JSON.parse(savedCatalog); } catch(e) { masterCatalog = [...defaultMasterCatalog]; }
  } else {
    masterCatalog = [...defaultMasterCatalog];
    saveMasterCatalog();
  }

  const savedHistory = localStorage.getItem("warehouse_history_logs");
  if (savedHistory) {
    try { historyLogs = JSON.parse(savedHistory); } catch(e) { historyLogs = [...defaultHistoryLogs]; }
  } else {
    historyLogs = [...defaultHistoryLogs];
    saveHistoryLogs();
  }
}

function saveMasterCatalog() {
  localStorage.setItem("warehouse_master_catalog", JSON.stringify(masterCatalog));
  invalidateStockCache();
}

function saveHistoryLogs() {
  localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
  invalidateStockCache();
}

function initFormDate() {
  const today = new Date().toISOString().split("T")[0];
  const dateInput = document.getElementById("reg-date");
  if (dateInput) dateInput.value = today;
}

// Tab Switching
function switchTab(tabId, btnElement) {
  if (tabId === "master" && !isAdminUser) {
    showToast("마스터 관리 메뉴는 관리자만 접근할 수 있습니다.", "danger");
    return;
  }

  document.querySelectorAll(".tab-page").forEach(page => page.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));

  const activeTab = document.getElementById(`tab-${tabId}`);
  if (activeTab) activeTab.classList.add("active");
  if (btnElement) btnElement.classList.add("active");

  if (tabId === "stock") renderStockLookup();
  if (tabId === "history") {
    populateArticleFilterDropdown();
    renderHistoryLogs();
  }
  if (tabId === "master") renderMasterCatalog();
}

function updateTypeToggle() {
  const selectedType = document.querySelector('input[name="reg-type"]:checked')?.value || "입고";
  const labelIn = document.getElementById("label-type-in");
  const labelOut = document.getElementById("label-type-out");

  if (selectedType === "입고") {
    if (labelIn) labelIn.className = "toggle-option active-in";
    if (labelOut) labelOut.className = "toggle-option";
  } else {
    if (labelIn) labelIn.className = "toggle-option";
    if (labelOut) labelOut.className = "toggle-option active-out";
  }
}

function onArtNoInput(artNoValue) {
  const cleanNo = artNoValue.trim();
  const artNameInput = document.getElementById("reg-artname");
  const stockPreview = document.getElementById("reg-current-stock");
  const icon = document.getElementById("artname-status-icon");

  if (!cleanNo) {
    if (artNameInput) artNameInput.value = "";
    if (stockPreview) stockPreview.textContent = "- 개";
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
    return;
  }

  const match = masterCatalog.find(item => item.artNo === cleanNo);

  if (match) {
    if (artNameInput) artNameInput.value = match.artName;
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #059669;"></i>';
    
    const currentStock = getItemStock(cleanNo);
    if (stockPreview) {
      stockPreview.textContent = `${currentStock} 개`;
      stockPreview.style.color = currentStock > 0 ? "#059669" : "#dc2626";
    }
  } else {
    if (artNameInput) artNameInput.value = "등록되지 않은 번호입니다 (직접 입력 가능)";
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: #d97706;"></i>';
    if (stockPreview) {
      stockPreview.textContent = "0 개";
      stockPreview.style.color = "#64748b";
    }
  }
}

function getItemStock(artNo) {
  const index = getStockIndex();
  return index[artNo] ? index[artNo].currentStock : 0;
}

function handleRegisterSubmit(e) {
  e.preventDefault();

  const date = document.getElementById("reg-date").value;
  const type = document.querySelector('input[name="reg-type"]:checked').value;
  const artNo = document.getElementById("reg-artno").value.trim();
  const artName = document.getElementById("reg-artname").value.trim();
  const qty = Number(document.getElementById("reg-qty").value);

  if (!artNo || !qty || qty <= 0) {
    showToast("아티클 번호와 수량을 올바르게 입력해주세요.", "danger");
    return;
  }

  const newLog = {
    id: Date.now(),
    date: date,
    type: type,
    artNo: artNo,
    artName: artName || "기타 품목",
    qty: qty,
    user: currentUser || "system"
  };

  historyLogs.unshift(newLog);
  saveHistoryLogs();

  if (!masterCatalog.some(item => item.artNo === artNo)) {
    masterCatalog.push({ artNo: artNo, artName: artName || "신규 품목" });
    saveMasterCatalog();
  }

  showToast(`${type} ${qty}개가 기록시트에 추가되었습니다!`, "success");

  document.getElementById("reg-artno").value = "";
  document.getElementById("reg-artname").value = "";
  document.getElementById("reg-qty").value = "";
  document.getElementById("reg-current-stock").textContent = "- 개";

  renderStockLookup();
  renderHistoryLogs();
}

// --- Stock Lookup View Logic ---
function renderStockLookup() {
  const container = document.getElementById("stock-cards-container");
  const searchElem = document.getElementById("stock-search");
  if (!container || !searchElem) return;

  const searchQuery = searchElem.value.trim().toLowerCase();
  const stockMap = getStockIndex();

  let grandTotalItems = 0;
  let grandTotalIn = 0;
  let grandTotalOut = 0;
  let grandCurrentStock = 0;

  const stockList = Object.values(stockMap).map(item => {
    grandTotalIn += item.totalIn;
    grandTotalOut += item.totalOut;
    grandCurrentStock += item.currentStock;
    grandTotalItems++;
    return item;
  });

  document.getElementById("summary-total-items").textContent = grandTotalItems;
  document.getElementById("summary-total-in").textContent = grandTotalIn;
  document.getElementById("summary-total-out").textContent = grandTotalOut;
  document.getElementById("summary-current-stock").textContent = grandCurrentStock;

  const filteredList = stockList.filter(item => 
    item.artNo.toLowerCase().includes(searchQuery) || 
    item.artName.toLowerCase().includes(searchQuery)
  );

  document.getElementById("stock-count-text").textContent = `${filteredList.length}개 품목`;

  if (filteredList.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #94a3b8;">
        <i class="fa-solid fa-box-open" style="font-size: 36px; margin-bottom: 10px;"></i>
        <p>검색 결과가 없습니다.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredList.map(item => {
    const statusBadge = item.currentStock > 5 
      ? '<span class="badge badge-success">재고 충분</span>' 
      : item.currentStock > 0 
      ? '<span class="badge badge-info">재고 부족</span>' 
      : '<span class="badge badge-danger">품절</span>';

    return `
      <div class="stock-card" onclick="selectItemForRegister('${item.artNo}')">
        <div class="stock-card-header">
          <div>
            <span class="stock-artno">${item.artNo}</span>
            <div class="stock-artname">${item.artName}</div>
          </div>
          ${statusBadge}
        </div>
        <div class="stock-metrics-row">
          <div class="stock-metric-item">
            <span class="stock-metric-lbl">누적 입고</span>
            <span class="stock-metric-num in">+${item.totalIn}</span>
          </div>
          <div class="stock-metric-item">
            <span class="stock-metric-lbl">누적 출고</span>
            <span class="stock-metric-num out">-${item.totalOut}</span>
          </div>
          <div class="stock-metric-item">
            <span class="stock-metric-lbl">현재 재고</span>
            <span class="stock-metric-num balance">${item.currentStock}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function clearStockSearch() {
  const input = document.getElementById("stock-search");
  if (input) input.value = "";
  renderStockLookup();
}

function selectItemForRegister(artNo) {
  document.getElementById("reg-artno").value = artNo;
  onArtNoInput(artNo);
  switchTab("register", document.querySelectorAll(".nav-item")[0]);
  showToast(`'${artNo}' 번호가 입출고 등록에 선택되었습니다.`, "success");
}

// --- History Logs Logic & Filters ---
function populateArticleFilterDropdown() {
  const select = document.getElementById("filter-article");
  if (!select) return;

  const uniqueArticles = {};
  historyLogs.forEach(log => {
    uniqueArticles[log.artNo] = log.artName;
  });

  select.innerHTML = '<option value="ALL">모든 품목</option>' +
    Object.keys(uniqueArticles).map(artNo => 
      `<option value="${artNo}">${artNo} - ${uniqueArticles[artNo]}</option>`
    ).join("");
}

function renderHistoryLogs() {
  const container = document.getElementById("history-logs-container");
  if (!container) return;

  const startDate = document.getElementById("filter-start-date").value;
  const endDate = document.getElementById("filter-end-date").value;
  const typeFilter = document.getElementById("filter-type").value;
  const articleFilter = document.getElementById("filter-article").value;

  let filteredLogs = [...historyLogs];

  if (startDate) filteredLogs = filteredLogs.filter(log => log.date >= startDate);
  if (endDate) filteredLogs = filteredLogs.filter(log => log.date <= endDate);
  if (typeFilter !== "ALL") filteredLogs = filteredLogs.filter(log => log.type === typeFilter);
  if (articleFilter !== "ALL") filteredLogs = filteredLogs.filter(log => log.artNo === articleFilter);

  let totalIn = 0;
  let totalOut = 0;
  filteredLogs.forEach(log => {
    if (log.type === "입고") totalIn += Number(log.qty);
    if (log.type === "출고") totalOut += Number(log.qty);
  });

  document.getElementById("hist-count").textContent = filteredLogs.length;
  document.getElementById("hist-total-in").textContent = totalIn;
  document.getElementById("hist-total-out").textContent = totalOut;

  if (filteredLogs.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #94a3b8;">
        <i class="fa-regular fa-folder-open" style="font-size: 32px; margin-bottom: 8px;"></i>
        <p>조건에 맞는 기록이 없습니다.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredLogs.map(log => `
    <div class="history-item type-${log.type}">
      <div class="hist-left">
        <span class="hist-date"><i class="fa-regular fa-clock"></i> ${log.date} ${log.user ? '· ' + log.user : ''}</span>
        <div class="hist-name">${log.artName}</div>
        <span class="hist-artno">번호: ${log.artNo}</span>
      </div>
      <div class="hist-right">
        <span class="hist-badge type-${log.type}">${log.type}</span>
        <div class="hist-qty ${log.type === '입고' ? 'text-in' : 'text-out'}">
          ${log.type === '입고' ? '+' : '-'}${log.qty}개
        </div>
      </div>
    </div>
  `).join("");
}

function resetHistoryFilters() {
  document.getElementById("filter-start-date").value = "";
  document.getElementById("filter-end-date").value = "";
  document.getElementById("filter-type").value = "ALL";
  document.getElementById("filter-article").value = "ALL";
  renderHistoryLogs();
}

// --- Excel Export Functionality ---
function exportHistoryToExcel() {
  if (!isAdminUser) {
    showToast("엑셀 추출 권한이 없습니다. (관리자 전용)", "danger");
    return;
  }

  if (historyLogs.length === 0) {
    showToast("추출할 입출고 기록이 없습니다.", "danger");
    return;
  }

  const exportData = historyLogs.map((log, index) => ({
    "연번": index + 1,
    "날짜": log.date,
    "구분": log.type,
    "아티클 이름": log.artName,
    "번호 (ARTNO)": log.artNo,
    "수량": log.qty,
    "작성자": log.user || "-"
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "기록");

  const todayStr = new Date().toISOString().split("T")[0];
  XLSX.writeFile(workbook, `입출고_기록_${todayStr}.xlsx`);
  showToast("관리자 권한으로 엑셀 파일(.xlsx) 추출을 시작했습니다!", "success");
}

// --- Excel Import Functionality ---
function handleExcelImport(e) {
  if (!isAdminUser) {
    showToast("마스터 데이터 엑셀 업로드는 관리자 전용 기능입니다.", "danger");
    return;
  }

  const file = e.target.files[0];
  if (!file) return;

  const statusMsg = document.getElementById("import-status");
  if (statusMsg) {
    statusMsg.style.display = "block";
    statusMsg.className = "import-status-msg";
    statusMsg.style.backgroundColor = "#e0f2fe";
    statusMsg.style.color = "#0369a1";
    statusMsg.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 엑셀 파일 분석 중...';
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: "array" });

      const sheetName = workbook.SheetNames.includes("Sheet1") ? "Sheet1" : workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (rows.length < 2) throw new Error("엑셀 시트에 데이터가 부족합니다.");

      let artNoIdx = -1;
      let artNameIdx = -1;

      const header = rows[0];
      for (let i = 0; i < header.length; i++) {
        const title = String(header[i]).toUpperCase();
        if (title.includes("ARTNO") || title.includes("번호")) artNoIdx = i;
        if (title.includes("ARTNAME") || title.includes("아티클") || title.includes("이름")) artNameIdx = i;
      }

      if (artNoIdx === -1) artNoIdx = 4;
      if (artNameIdx === -1) artNameIdx = 5;

      const newCatalog = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (row && row[artNoIdx]) {
          const artNo = String(row[artNoIdx]).trim();
          const artName = row[artNameIdx] ? String(row[artNameIdx]).trim() : "품목명 없음";
          if (artNo && !newCatalog.some(item => item.artNo === artNo)) {
            newCatalog.push({ artNo, artName });
          }
        }
      }

      if (newCatalog.length > 0) {
        masterCatalog = newCatalog;
        saveMasterCatalog();
        renderMasterCatalog();
        populateArticleFilterDropdown();

        if (statusMsg) {
          statusMsg.style.backgroundColor = "#ecfdf5";
          statusMsg.style.color = "#047857";
          statusMsg.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${newCatalog.length}개 아티클 마스터 데이터로 새로고침 되었습니다!`;
        }
        showToast(`엑셀에서 ${newCatalog.length}개 품목을 새로고침했습니다.`, "success");
      } else {
        throw new Error("유효한 아티클 번호를 찾을 수 없습니다.");
      }
    } catch (err) {
      if (statusMsg) {
        statusMsg.style.backgroundColor = "#fef2f2";
        statusMsg.style.color = "#b91c1c";
        statusMsg.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> 오류: ${err.message}`;
      }
      showToast(`엑셀 읽기 오류: ${err.message}`, "danger");
    }
  };

  reader.readAsArrayBuffer(file);
}

// --- Master Catalog Render & Add ---
function renderMasterCatalog() {
  const container = document.getElementById("master-catalog-container");
  const searchElem = document.getElementById("master-search");
  if (!container || !searchElem) return;

  const searchQuery = searchElem.value.trim().toLowerCase();

  const filtered = masterCatalog.filter(item => 
    item.artNo.toLowerCase().includes(searchQuery) || 
    item.artName.toLowerCase().includes(searchQuery)
  );

  if (filtered.length === 0) {
    container.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 15px;">등록된 품목이 없습니다.</p>';
    return;
  }

  container.innerHTML = filtered.map(item => `
    <div class="master-item">
      <div>
        <span class="master-artno">${item.artNo}</span>
        <div class="master-artname">${item.artName}</div>
      </div>
      <button type="button" class="btn-secondary sm" onclick="selectItemForRegister('${item.artNo}')">
        <i class="fa-solid fa-plus"></i> 입력
      </button>
    </div>
  `).join("");
}

// --- Modals Logic ---
function openMasterSelectModal() {
  const modal = document.getElementById("master-select-modal");
  if (modal) modal.classList.add("active");
  renderModalMasterList();
}

function closeMasterSelectModal() {
  const modal = document.getElementById("master-select-modal");
  if (modal) modal.classList.remove("active");
}

function renderModalMasterList() {
  const container = document.getElementById("modal-master-list");
  const searchElem = document.getElementById("modal-search");
  if (!container || !searchElem) return;

  const query = searchElem.value.trim().toLowerCase();

  const filtered = masterCatalog.filter(item => 
    item.artNo.toLowerCase().includes(query) || 
    item.artName.toLowerCase().includes(query)
  );

  container.innerHTML = filtered.map(item => `
    <div class="modal-list-item" onclick="chooseModalItem('${item.artNo}')">
      <div>
        <strong style="color: #2563eb;">${item.artNo}</strong>
        <div style="font-size: 13px; font-weight: 600;">${item.artName}</div>
      </div>
      <i class="fa-solid fa-chevron-right" style="color: #cbd5e1;"></i>
    </div>
  `).join("");
}

function chooseModalItem(artNo) {
  document.getElementById("reg-artno").value = artNo;
  onArtNoInput(artNo);
  closeMasterSelectModal();
}

function openAddMasterModal() {
  if (!isAdminUser) {
    showToast("신규 아티클 개별 추가는 관리자 전용 기능입니다.", "danger");
    return;
  }
  const modal = document.getElementById("add-master-modal");
  if (modal) modal.classList.add("active");
}

function closeAddMasterModal() {
  const modal = document.getElementById("add-master-modal");
  if (modal) modal.classList.remove("active");
}

function handleAddMasterSubmit(e) {
  e.preventDefault();
  if (!isAdminUser) {
    showToast("관리자 권한이 필요합니다.", "danger");
    return;
  }

  const artNo = document.getElementById("new-artno").value.trim();
  const artName = document.getElementById("new-artname").value.trim();

  if (!artNo || !artName) return;

  masterCatalog.push({ artNo, artName });
  saveMasterCatalog();
  renderMasterCatalog();
  populateArticleFilterDropdown();
  closeAddMasterModal();

  showToast(`신규 품목 '${artName}'이(가) 추가되었습니다.`, "success");
  document.getElementById("add-master-form").reset();
}

// Toast Utility
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast-msg ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}