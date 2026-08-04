const supabaseUrl = "https://zblzdqwqxagqnkrojyda.supabase.co";

const supabaseKey = "여기에 Publishable Key";

const supabaseClient = supabase.createClient(
  supabaseUrl,
  supabaseKey
);

// Mobile Warehouse Inventory App Logic (Optimized + Top 10 Dashboard + Order Requests + Role Permissions)

// --- Allowed User IDs List ---
const ALLOWED_USER_IDS = [
  "guest1", "guest2", "amelie",
  "sulee21", "jocho16", "jipar5", "hycho30", "julee33", 
  "tabae3", "goyoo", "suahn2", "yehan1", "secho12",
  "junkoo", "minjong"
];

// --- Designated Admin Users List ---
const ADMIN_USERS = ["jipar5", "hycho30", "junkoo", "minjong"];

// Initial default passwords (all '522')
const INITIAL_PASSWORD = "522";

// --- Sample Initial Master Data ---
const defaultMasterCatalog = [
  { hfb: "HFB 01 Living", artNo: "70582028", artName: "EKET 에케트 멀티미디어선반 70x35x35 화이트 AP" },
  { hfb: "HFB 01 Living", artNo: "90513393", artName: "KUGGIS 쿠기스 수납상자 18x26x8 화이트" },
  { hfb: "HFB 02 Bedding", artNo: "20351884", artName: "KALLAX 캘락스 선반유닛 77x147 화이트 AP" },
  { hfb: "HFB 03 Children", artNo: "30279944", artName: "ANTILOP 유아용식탁의자 시트 AP Sales" },
  { hfb: "HFB 01 Living", artNo: "10501548", artName: "LACK 렉세 선반유닛 92x76 그레이 실외용" },
  { hfb: "HFB 02 Bedding", artNo: "70483882", artName: "BAGGEBO 바게보 도어수납장 50x30x80" },
  { hfb: "HFB 04 Workspace", artNo: "40354283", artName: "MICKE 이동식서랍유 35x75 화이트 AP" },
  { hfb: "HFB 05 Clothes", artNo: "30231631", artName: "RIGGA 행거 화이트 AP CN" },
  { hfb: "HFB 01 Living", artNo: "40308700", artName: "TROFAST N 선반 30 라이트화이트스데인" }
];

// --- Cleaned Transaction History & Order Requests for Actual Usage ---
const defaultHistoryLogs = [];
const defaultOrderLogs = [];

// App State
let masterCatalog = [];
let historyLogs = [];
let orderLogs = [];
let userPasswords = {};
let currentUser = null;
let isAdminUser = false;
let currentDashboardTab = "high"; // "high", "low", "hfb"
let modalSelectTarget = "register"; // "register" or "order"

// Stock Dashboard Filter & Sort State
let currentStockStatusFilter = "all"; // "all", "good", "low", "out"
let currentStockHFBFilter = "ALL";
let currentStockSort = "stock-desc"; // "stock-desc", "stock-asc", "name-asc", "artno-asc"

// Optimization Caches & Indices
let masterCatalogMap = new Map();
let cachedStockMap = null;

const RENDER_LIMIT = 50;
let stockDisplayLimit = RENDER_LIMIT;
let historyDisplayLimit = RENDER_LIMIT;
let masterDisplayLimit = RENDER_LIMIT;

// Utility: Debounce function
function debounce(func, delay = 150) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

// Initialize App
document.addEventListener("DOMContentLoaded", async () => {

  initAuthDB();
  await loadDataFromSupabase();

  checkLoginSession();
  initFormDate();
  setupDebouncedInputs();

});

function setupDebouncedInputs() {
  const stockSearch = document.getElementById("stock-search");
  if (stockSearch) {
    stockSearch.addEventListener("input", debounce(() => {
      stockDisplayLimit = RENDER_LIMIT;
      renderStockLookup();
    }, 150));
  }

  const masterSearch = document.getElementById("master-search");
  if (masterSearch) {
    masterSearch.addEventListener("input", debounce(() => {
      masterDisplayLimit = RENDER_LIMIT;
      renderMasterCatalog();
    }, 150));
  }

  const modalSearch = document.getElementById("modal-search");
  if (modalSearch) {
    modalSearch.addEventListener("input", debounce(() => {
      renderModalMasterList();
    }, 150));
  }

  const regArtNo = document.getElementById("reg-artno");
  if (regArtNo) {
    regArtNo.addEventListener("input", debounce((e) => {
      onArtNoInput(e.target.value);
    }, 150));
  }

  const orderArtNo = document.getElementById("order-artno");
  if (orderArtNo) {
    orderArtNo.addEventListener("input", debounce((e) => {
      onOrderArtNoInput(e.target.value);
    }, 150));
  }
}

function rebuildMasterCatalogMap() {
  masterCatalogMap.clear();
  for (let i = 0; i < masterCatalog.length; i++) {
    const item = masterCatalog[i];
    masterCatalogMap.set(item.artNo, item.artName);
  }
}

function invalidateStockCache() {
  cachedStockMap = null;
}

// --- Auth DB & Session Management ---
function initAuthDB() {
  try {
    const savedPasswords = localStorage.getItem("warehouse_user_passwords");
    if (savedPasswords) {
      userPasswords = JSON.parse(savedPasswords);
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
  } catch (err) {
    console.error("Auth DB initialization error:", err);
    userPasswords = {};
    ALLOWED_USER_IDS.forEach(id => { userPasswords[id] = INITIAL_PASSWORD; });
  }
}

function saveUserPasswords() {
  try {
    localStorage.setItem("warehouse_user_passwords", JSON.stringify(userPasswords));
  } catch (err) {
    console.error("Failed to save passwords to LocalStorage:", err);
  }
}

function checkLoginSession() {
  const sessionUser = localStorage.getItem("warehouse_current_user");
  const loginOverlay = document.getElementById("login-overlay");
  const userBadge = document.getElementById("user-profile-badge");
  const userNameElem = document.getElementById("current-user-name");
  const adminRoleBadge = document.getElementById("admin-role-badge");

  const btnExcelExport = document.getElementById("btn-excel-export");
  const btnOrderExcelExport = document.getElementById("btn-order-excel-export");
  const excelExportLocked = document.getElementById("excel-export-locked");
  const adminExcelImportBox = document.getElementById("admin-excel-import-box");
  const userMasterNoticeBox = document.getElementById("user-master-notice-box");
  const btnAddMaster = document.getElementById("btn-add-master");

  const navHistoryBtn = document.getElementById("nav-history-btn");
  const navMasterBtn = document.getElementById("nav-master-btn");

  if (sessionUser && ALLOWED_USER_IDS.includes(sessionUser)) {
    currentUser = sessionUser;
    isAdminUser = ADMIN_USERS.includes(sessionUser);

    loginOverlay.classList.remove("active");
    userBadge.style.display = "flex";
    userNameElem.textContent = sessionUser;

    if (isAdminUser) {
      adminRoleBadge.style.display = "inline-block";
      if (btnExcelExport) btnExcelExport.style.display = "flex";
      if (btnOrderExcelExport) btnOrderExcelExport.style.display = "flex";
      if (excelExportLocked) excelExportLocked.style.display = "none";
      if (adminExcelImportBox) adminExcelImportBox.style.display = "block";
      if (userMasterNoticeBox) userMasterNoticeBox.style.display = "none";
      if (btnAddMaster) btnAddMaster.style.display = "block";

      // Show Admin-only nav buttons
      if (navHistoryBtn) navHistoryBtn.style.display = "flex";
      if (navMasterBtn) navMasterBtn.style.display = "flex";
    } else {
      adminRoleBadge.style.display = "none";
      if (btnExcelExport) btnExcelExport.style.display = "none";
      if (btnOrderExcelExport) btnOrderExcelExport.style.display = "none";
      if (excelExportLocked) excelExportLocked.style.display = "inline-block";
      if (adminExcelImportBox) adminExcelImportBox.style.display = "none";
      if (userMasterNoticeBox) userMasterNoticeBox.style.display = "block";
      if (btnAddMaster) btnAddMaster.style.display = "none";

      // HIDE History & Master Tab for regular users
      if (navHistoryBtn) navHistoryBtn.style.display = "none";
      if (navMasterBtn) navMasterBtn.style.display = "none";

      // Fallback if currently on a restricted tab
      const historyTab = document.getElementById("tab-history");
      const masterTab = document.getElementById("tab-master");
      if ((historyTab && historyTab.classList.contains("active")) || (masterTab && masterTab.classList.contains("active"))) {
        const regNavBtn = document.querySelectorAll(".bottom-nav .nav-item")[0];
        if (regNavBtn) switchTab("register", regNavBtn);
      }
    }

    renderStockLookup();
    renderHistoryLogs();
    renderOrderLogs();
    renderMasterCatalog();
    populateArticleFilterDropdown();
  } else {
    currentUser = null;
    isAdminUser = false;
    loginOverlay.classList.add("active");
    userBadge.style.display = "none";
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
    const roleTitle = ADMIN_USERS.includes(inputId) ? "👑 관리자" : "일반 사용자";
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

// Reset Password
function openResetPasswordModal() {
  document.getElementById("reset-pw-modal").classList.add("active");
}

function closeResetPasswordModal() {
  document.getElementById("reset-pw-modal").classList.remove("active");
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
async function loadDataFromSupabase() {
  try {
    const savedCatalog = localStorage.getItem("warehouse_master_catalog");
    if (savedCatalog) {
      masterCatalog = JSON.parse(savedCatalog);
    } else {
      masterCatalog = [...defaultMasterCatalog];
      saveMasterCatalog();
    }
  } catch (err) {
    console.error("Failed to load master catalog:", err);
    masterCatalog = [...defaultMasterCatalog];
  }

  const { data: historyData } =
    await supabaseClient
      .from("inventory_logs")
      .select("*")
      .order("id", { ascending: false });

  historyLogs = historyData || [];

  const { data: orderData } =
    await supabaseClient
      .from("order_requests")
      .select("*")
      .order("id", { ascending: false });

  orderLogs = orderData || [];

  rebuildMasterCatalogMap();
  invalidateStockCache();
}

function saveMasterCatalog() {
  try {
    localStorage.setItem("warehouse_master_catalog", JSON.stringify(masterCatalog));
  } catch (err) {
    showToast("로컬 스토리지용량이 부족하여 마스터 데이터 저장에 실패했습니다.", "danger");
  }
  rebuildMasterCatalogMap();
}

function saveHistoryLogs() {
  try {
    localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
  } catch (err) {
    showToast("로컬 스토리지용량이 부족하여 기록 저장에 실패했습니다.", "danger");
  }
  invalidateStockCache();
}

function saveOrderLogs() {
  try {
    localStorage.setItem("warehouse_order_logs", JSON.stringify(orderLogs));
  } catch (err) {
    showToast("로컬 스토리지 용량이 부족하여 오더 요청 저장에 실패했습니다.", "danger");
  }
}

// Date Default (Today)
function initFormDate() {
  const today = new Date().toISOString().split("T")[0];
  const regDateElem = document.getElementById("reg-date");
  if (regDateElem) regDateElem.value = today;

  const orderDateElem = document.getElementById("order-date");
  if (orderDateElem) orderDateElem.value = today;
}

// Tab Switching (With Access Control)
function switchTab(tabId, btnElement) {
  // Access Restrictions
  if ((tabId === "history" || tabId === "master") && !isAdminUser) {
    showToast("해당 메뉴는 관리자(jipar5, hycho30, junkoo, minjong)만 접근할 수 있습니다.", "danger");
    return;
  }

  document.querySelectorAll(".tab-page").forEach(page => page.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));

  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.classList.add("active");
  if (btnElement) btnElement.classList.add("active");

  if (tabId === "stock") {
    stockDisplayLimit = RENDER_LIMIT;
    renderStockLookup();
  }
  if (tabId === "order") {
    renderOrderLogs();
  }
  if (tabId === "history") {
    historyDisplayLimit = RENDER_LIMIT;
    populateArticleFilterDropdown();
    renderHistoryLogs();
  }
  if (tabId === "master") {
    masterDisplayLimit = RENDER_LIMIT;
    renderMasterCatalog();
  }
}

// Type Toggle (입고/출고)
function updateTypeToggle() {
  const checkedOption = document.querySelector('input[name="reg-type"]:checked');
  if (!checkedOption) return;

  const selectedType = checkedOption.value;
  const labelIn = document.getElementById("label-type-in");
  const labelOut = document.getElementById("label-type-out");

  if (selectedType === "입고") {
    labelIn.className = "toggle-option active-in";
    labelOut.className = "toggle-option";
  } else {
    labelIn.className = "toggle-option";
    labelOut.className = "toggle-option active-out";
  }
}

// Auto Lookup Article Name for Register Tab
function onArtNoInput(artNoValue) {
  const cleanNo = artNoValue.trim();
  const artNameInput = document.getElementById("reg-artname");
  const stockPreview = document.getElementById("reg-current-stock");
  const icon = document.getElementById("artname-status-icon");

  if (!cleanNo) {
    artNameInput.value = "";
    stockPreview.textContent = "- 개";
    icon.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
    return;
  }

  const artNameMatch = masterCatalogMap.get(cleanNo);

  if (artNameMatch) {
    artNameInput.value = artNameMatch;
    icon.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #059669;"></i>';
    
    const currentStock = getItemStock(cleanNo);
    stockPreview.textContent = `${currentStock} 개`;
    stockPreview.style.color = currentStock > 0 ? "#059669" : "#dc2626";
  } else {
    artNameInput.value = "등록되지 않은 번호입니다 (직접 입력 가능)";
    icon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: #d97706;"></i>';
    const currentStock = getItemStock(cleanNo);
    stockPreview.textContent = `${currentStock} 개`;
    stockPreview.style.color = currentStock > 0 ? "#059669" : "#64748b";
  }
}

// Auto Lookup Article Name for Order Request Tab
function onOrderArtNoInput(artNoValue) {
  const cleanNo = artNoValue.trim();
  const artNameInput = document.getElementById("order-artname");
  const icon = document.getElementById("order-artname-status-icon");

  if (!cleanNo) {
    artNameInput.value = "";
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
    return;
  }

  const artNameMatch = masterCatalogMap.get(cleanNo);

  if (artNameMatch) {
    artNameInput.value = artNameMatch;
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #059669;"></i>';
  } else {
    artNameInput.value = "등록되지 않은 번호입니다 (직접 입력 가능)";
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: #d97706;"></i>';
  }
}

// Calculate cached stock Map
function buildStockMap() {
  if (cachedStockMap) return cachedStockMap;

  const stockMap = new Map();

  for (let i = 0; i < masterCatalog.length; i++) {
    const item = masterCatalog[i];
    stockMap.set(item.artNo, {
      artNo: item.artNo,
      artName: item.artName,
      totalIn: 0,
      totalOut: 0,
      currentStock: 0
    });
  }

  for (let i = 0; i < historyLogs.length; i++) {
    const log = historyLogs[i];
    let entry = stockMap.get(log.artNo);
    if (!entry) {
      entry = {
        artNo: log.artNo,
        artName: log.artName,
        totalIn: 0,
        totalOut: 0,
        currentStock: 0
      };
      stockMap.set(log.artNo, entry);
    }
    const qty = Number(log.qty) || 0;
    if (log.type === "입고") entry.totalIn += qty;
    if (log.type === "출고") entry.totalOut += qty;
  }

  stockMap.forEach(entry => {
    entry.currentStock = entry.totalIn - entry.totalOut;
  });

  cachedStockMap = stockMap;
  return stockMap;
}

function getItemStock(artNo) {
  const stockMap = buildStockMap();
  const entry = stockMap.get(artNo);
  return entry ? entry.currentStock : 0;
}

async function handleRegisterSubmit(e) {
  e.preventDefault();

  const date = document.getElementById("reg-date").value;
  const typeOption = document.querySelector('input[name="reg-type"]:checked');
  const type = typeOption ? typeOption.value : "입고";
  const artNo = document.getElementById("reg-artno").value.trim();
  const artName = document.getElementById("reg-artname").value.trim();
  const qty = Number(document.getElementById("reg-qty").value);

  if (!artNo || !qty || qty <= 0) {
    showToast("아티클 번호와 수량을 올바르게 입력해주세요.", "danger");
    return;
  }

  const newLog = {
    date: date,
    type: type,
    artNo: artNo,
    artName: artName || "기타 품목",
    qty: qty,
    user: currentUser || "system"
  };

  try {
    await supabaseClient
      .from("inventory_logs")
      .insert([newLog]);

    historyLogs.unshift(newLog);
    invalidateStockCache();

    if (!masterCatalogMap.has(artNo)) {
      masterCatalog.push({ artNo: artNo, artName: artName || "신규 품목" });
      saveMasterCatalog();
      populateArticleFilterDropdown();
    }

    showToast(`${type} ${qty}개가 기록시트에 추가되었습니다!`, "success");

    document.getElementById("reg-artno").value = "";
    document.getElementById("reg-artname").value = "";
    document.getElementById("reg-qty").value = "";
    document.getElementById("reg-current-stock").textContent = "- 개";

    renderStockLookup();
    renderHistoryLogs();
  } catch (err) {
    console.error("Supabase insert error:", err);
    showToast("입출고 저장 실패: " + err.message, "danger");
  }
}

// --- NEW ORDER REQUEST HANDLER ---
async function handleOrderSubmit(e) {
  e.preventDefault();

  const date = document.getElementById("order-date").value;
  const artNo = document.getElementById("order-artno").value.trim();
  const artName = document.getElementById("order-artname").value.trim();
  const qty = Number(document.getElementById("order-qty").value);

  if (!artNo || !qty || qty <= 0) {
    showToast("아티클 번호와 수량을 올바르게 입력해주세요.", "danger");
    return;
  }

  const newOrder = {
    date: date,
    artNo: artNo,
    artName: artName || "기타 품목",
    qty: qty,
    user: currentUser || "guest1",
    status: "요청됨"
  };

  try {
    await supabaseClient
      .from("order_requests")
      .insert([newOrder]);

    orderLogs.unshift(newOrder);

    showToast(`'${artName}' ${qty}개 오더 요청이 완료되었습니다!`, "success");

    // Reset form
    document.getElementById("order-artno").value = "";
    document.getElementById("order-artname").value = "";
    document.getElementById("order-qty").value = "";

    renderOrderLogs();
  } catch (err) {
    console.error("Supabase order insert error:", err);
    showToast("오더 저장 실패: " + err.message, "danger");
  }
}

function renderOrderLogs() {
  const container = document.getElementById("order-logs-container");
  if (!container) return;

  if (orderLogs.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #94a3b8;">
        <i class="fa-solid fa-cart-shopping" style="font-size: 32px; margin-bottom: 8px;"></i>
        <p>등록된 오더 요청 내역이 없습니다.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = orderLogs.map(item => `
    <div class="history-item" style="border-left-color: #6366f1;">
      <div class="hist-left">
        <span class="hist-date"><i class="fa-regular fa-clock"></i> ${item.date} · ${item.user}</span>
        <div class="hist-name">${item.artName}</div>
        <span class="hist-artno">번호: ${item.artNo}</span>
      </div>
      <div class="hist-right">
        <span class="hist-badge" style="background-color: #e0e7ff; color: #4338ca;">${item.status || '요청됨'}</span>
        <div class="hist-qty" style="color: #4338ca;">
          ${item.qty}개
        </div>
      </div>
    </div>
  `).join("");
}

// --- Excel Export Order Requests (ADMIN ONLY) ---
function exportOrdersToExcel() {
  if (!isAdminUser) {
    showToast("오더 추출 권한이 없습니다. (관리자 전용)", "danger");
    return;
  }

  if (orderLogs.length === 0) {
    showToast("추출할 오더 요청 내역이 없습니다.", "danger");
    return;
  }

  const exportData = orderLogs.map((item, index) => ({
    "연번": index + 1,
    "요청 날짜": item.date,
    "번호 (ARTNO)": item.artNo,
    "아티클 이름": item.artName,
    "요청 수량": item.qty,
    "요청자": item.user,
    "상태": item.status || "요청됨"
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "오더요청");

  const todayStr = new Date().toISOString().split("T")[0];
  XLSX.writeFile(workbook, `오더_요청_내역_${todayStr}.xlsx`);
  showToast("관리자 권한으로 오더 요청 엑셀 파일(.xlsx) 추출을 완료했습니다!", "success");
}

// --- Stock Lookup View Logic & Enhanced Dashboard ---
function populateStockHFBDropdown() {
  const select = document.getElementById("stock-hfb-select");
  if (!select) return;

  const currentVal = select.value || "ALL";
  const hfbSet = new Set();
  masterCatalog.forEach(item => {
    if (item.hfb) hfbSet.add(item.hfb);
  });

  let html = '<option value="ALL">모든 HFB 카테고리</option>';
  Array.from(hfbSet).sort().forEach(hfb => {
    html += `<option value="${hfb}" ${hfb === currentVal ? 'selected' : ''}>${hfb}</option>`;
  });
  select.innerHTML = html;
}

function filterByStockStatus(status) {
  currentStockStatusFilter = status;
  
  const statusChips = ["all", "good", "low", "out"];
  statusChips.forEach(st => {
    const chip = document.getElementById(`chip-status-${st}`);
    if (chip) {
      if (st === status) chip.classList.add("active");
      else chip.classList.remove("active");
    }
  });

  stockDisplayLimit = RENDER_LIMIT;
  renderStockLookup();
}

function resetStockFilters() {
  const stockSearch = document.getElementById("stock-search");
  if (stockSearch) stockSearch.value = "";
  
  const hfbSelect = document.getElementById("stock-hfb-select");
  if (hfbSelect) hfbSelect.value = "ALL";
  
  const sortSelect = document.getElementById("stock-sort-select");
  if (sortSelect) sortSelect.value = "stock-desc";

  currentStockHFBFilter = "ALL";
  currentStockSort = "stock-desc";

  filterByStockStatus("all");
}

function onStockFilterChange() {
  const hfbSelect = document.getElementById("stock-hfb-select");
  if (hfbSelect) currentStockHFBFilter = hfbSelect.value;

  const sortSelect = document.getElementById("stock-sort-select");
  if (sortSelect) currentStockSort = sortSelect.value;

  stockDisplayLimit = RENDER_LIMIT;
  renderStockLookup();
}

function renderStockLookup() {
  const container = document.getElementById("stock-cards-container");
  if (!container) return;

  populateStockHFBDropdown();

  const searchQuery = document.getElementById("stock-search").value.trim().toLowerCase();
  const stockMap = buildStockMap();

  let grandTotalItems = 0;
  let grandTotalIn = 0;
  let grandTotalOut = 0;
  let grandCurrentStock = 0;

  let cntGood = 0;
  let cntLow = 0;
  let cntOut = 0;

  const stockList = [];
  stockMap.forEach(item => {
    if (!item.hfb) {
      const matchedMaster = masterCatalog.find(m => m.artNo === item.artNo);
      item.hfb = matchedMaster ? matchedMaster.hfb || "기타 HFB" : "기타 HFB";
    }

    grandTotalIn += item.totalIn;
    grandTotalOut += item.totalOut;
    grandCurrentStock += item.currentStock;
    grandTotalItems++;

    if (item.currentStock > 5) cntGood++;
    else if (item.currentStock > 0) cntLow++;
    else cntOut++;

    stockList.push(item);
  });

  // Summary Cards Update
  document.getElementById("summary-total-items").textContent = grandTotalItems;
  document.getElementById("summary-total-in").textContent = grandTotalIn;
  document.getElementById("summary-total-out").textContent = grandTotalOut;
  document.getElementById("summary-current-stock").textContent = grandCurrentStock;

  // Spectrum Bar & Count Updates
  document.getElementById("spectrum-total-badge").textContent = `총 ${grandTotalItems}개 품목`;
  document.getElementById("spec-cnt-good").textContent = `${cntGood}개`;
  document.getElementById("spec-cnt-low").textContent = `${cntLow}개`;
  document.getElementById("spec-cnt-out").textContent = `${cntOut}개`;

  if (grandTotalItems > 0) {
    const pctGood = ((cntGood / grandTotalItems) * 100).toFixed(1);
    const pctLow = ((cntLow / grandTotalItems) * 100).toFixed(1);
    const pctOut = ((cntOut / grandTotalItems) * 100).toFixed(1);

    document.getElementById("spec-bar-good").style.width = `${pctGood}%`;
    document.getElementById("spec-bar-low").style.width = `${pctLow}%`;
    document.getElementById("spec-bar-out").style.width = `${pctOut}%`;
  } else {
    document.getElementById("spec-bar-good").style.width = "0%";
    document.getElementById("spec-bar-low").style.width = "0%";
    document.getElementById("spec-bar-out").style.width = "0%";
  }

  // Dashboard Update
  renderStockDashboard(stockList);

  // Filter Stock List
  let filteredList = stockList;

  if (searchQuery) {
    filteredList = filteredList.filter(item =>
      item.artNo.toLowerCase().includes(searchQuery) ||
      item.artName.toLowerCase().includes(searchQuery) ||
      (item.hfb && item.hfb.toLowerCase().includes(searchQuery))
    );
  }

  if (currentStockStatusFilter === "good") {
    filteredList = filteredList.filter(item => item.currentStock > 5);
  } else if (currentStockStatusFilter === "low") {
    filteredList = filteredList.filter(item => item.currentStock > 0 && item.currentStock <= 5);
  } else if (currentStockStatusFilter === "out") {
    filteredList = filteredList.filter(item => item.currentStock <= 0);
  }

  if (currentStockHFBFilter && currentStockHFBFilter !== "ALL") {
    filteredList = filteredList.filter(item => item.hfb === currentStockHFBFilter);
  }

  // Sort Stock List
  filteredList.sort((a, b) => {
    if (currentStockSort === "stock-desc") return b.currentStock - a.currentStock;
    if (currentStockSort === "stock-asc") return a.currentStock - b.currentStock;
    if (currentStockSort === "name-asc") return a.artName.localeCompare(b.artName, "ko");
    if (currentStockSort === "artno-asc") return a.artNo.localeCompare(b.artNo);
    return 0;
  });

  document.getElementById("stock-count-text").textContent = `${filteredList.length}개 품목`;

  if (filteredList.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: #94a3b8; background:#fff; border-radius:14px; border:1px dashed #cbd5e1;">
        <i class="fa-solid fa-box-open" style="font-size: 40px; margin-bottom: 12px; color:#cbd5e1;"></i>
        <p style="font-weight:700; color:#64748b;">조건에 맞는 재고 항목이 없습니다.</p>
        <button type="button" class="btn-secondary sm" style="margin-top:12px;" onclick="resetStockFilters()">
          <i class="fa-solid fa-rotate-left"></i> 전체 보기로 필터 초기화
        </button>
      </div>
    `;
    return;
  }

  const visibleList = filteredList.slice(0, stockDisplayLimit);
  const maxStockRef = Math.max(...stockList.map(item => item.currentStock), 10);

  let html = visibleList.map(item => {
    const isOut = item.currentStock <= 0;
    const isLow = item.currentStock > 0 && item.currentStock <= 5;
    
    const statusBadge = isOut 
      ? '<span class="badge badge-danger">🔴 품절</span>' 
      : isLow 
      ? '<span class="badge badge-info">🟡 재고 부족</span>' 
      : '<span class="badge badge-success">🟢 안전 재고</span>';

    const cardClass = isOut ? "stock-card is-out" : isLow ? "stock-card is-low" : "stock-card";
    const healthClass = isOut ? "out" : isLow ? "low" : "good";
    const healthPct = isOut ? 0 : Math.max(Math.min((item.currentStock / maxStockRef) * 100, 100), 6);

    return `
      <div class="${cardClass}">
        <div class="stock-card-top">
          <div class="stock-card-meta">
            <span class="stock-artno">${item.artNo}</span>
            <span class="hfb-badge">${item.hfb || 'HFB'}</span>
          </div>
          ${statusBadge}
        </div>
        <div class="stock-artname">${item.artName}</div>

        <div class="stock-health-bar-track">
          <div class="stock-health-bar-fill ${healthClass}" style="width: ${healthPct}%;"></div>
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
            <span class="stock-metric-num balance">${item.currentStock}개</span>
          </div>
        </div>

        <div class="stock-quick-actions">
          <button type="button" class="btn-quick-act btn-quick-in" onclick="quickActionRegister('${item.artNo}', '입고')">
            <i class="fa-solid fa-plus"></i> 입고
          </button>
          <button type="button" class="btn-quick-act btn-quick-out" onclick="quickActionRegister('${item.artNo}', '출고')">
            <i class="fa-solid fa-minus"></i> 출고
          </button>
          <button type="button" class="btn-quick-act btn-quick-order" onclick="quickActionOrder('${item.artNo}')">
            <i class="fa-solid fa-cart-flatbed"></i> 오더 요청
          </button>
        </div>
      </div>
    `;
  }).join("");

  if (filteredList.length > stockDisplayLimit) {
    html += `
      <button type="button" class="btn-secondary" style="width:100%; margin-top:10px; padding:12px; font-weight:700;" onclick="loadMoreStockItems()">
        더보기 (${stockDisplayLimit} / ${filteredList.length}개)
      </button>
    `;
  }

  container.innerHTML = html;
}

// Multi-Tab Dashboard (High TOP 10, Low TOP 10, HFB Breakdown)
function switchDashboardTab(type) {
  currentDashboardTab = type;

  const btnHigh = document.getElementById("dash-tab-high");
  const btnLow = document.getElementById("dash-tab-low");
  const btnHfb = document.getElementById("dash-tab-hfb");
  const viewHigh = document.getElementById("dash-view-high");
  const viewLow = document.getElementById("dash-view-low");
  const viewHfb = document.getElementById("dash-view-hfb");
  const badgeView = document.getElementById("dash-badge-view");

  [btnHigh, btnLow, btnHfb].forEach(b => { if(b) b.classList.remove("active"); });
  [viewHigh, viewLow, viewHfb].forEach(v => { if(v) v.style.display = "none"; });

  if (type === "high") {
    if(btnHigh) btnHigh.classList.add("active");
    if(viewHigh) viewHigh.style.display = "block";
    if(badgeView) badgeView.textContent = "TOP 10";
  } else if (type === "low") {
    if(btnLow) btnLow.classList.add("active");
    if(viewLow) viewLow.style.display = "block";
    if(badgeView) badgeView.textContent = "경고 TOP 10";
  } else if (type === "hfb") {
    if(btnHfb) btnHfb.classList.add("active");
    if(viewHfb) viewHfb.style.display = "block";
    if(badgeView) badgeView.textContent = "HFB 분포";
  }
}

function renderStockDashboard(stockList) {
  const containerHigh = document.getElementById("dash-list-high");
  const containerLow = document.getElementById("dash-list-low");
  const containerHfb = document.getElementById("dash-list-hfb");
  if (!containerHigh || !containerLow) return;

  if (stockList.length === 0) {
    containerHigh.innerHTML = '<p class="dash-empty">등록된 재고 데이터가 없습니다.</p>';
    containerLow.innerHTML = '<p class="dash-empty">등록된 재고 데이터가 없습니다.</p>';
    if (containerHfb) containerHfb.innerHTML = '<p class="dash-empty">등록된 재고 데이터가 없습니다.</p>';
    return;
  }

  // High Stock TOP 10
  const sortedHigh = [...stockList].sort((a, b) => b.currentStock - a.currentStock);
  const topHigh = sortedHigh.slice(0, 10);
  const maxHighVal = topHigh.length > 0 && topHigh[0].currentStock > 0 ? topHigh[0].currentStock : 1;

  containerHigh.innerHTML = topHigh.map((item, idx) => {
    const rank = idx + 1;
    const rankBadgeClass = rank === 1 ? "rank-gold" : rank === 2 ? "rank-silver" : rank === 3 ? "rank-bronze" : "rank-normal";
    const rankIcon = rank === 1 ? '👑 ' : rank === 2 ? '🥈 ' : rank === 3 ? '🥉 ' : '';
    const pct = Math.max(Math.min((item.currentStock / maxHighVal) * 100, 100), 5);

    return `
      <div class="dash-item" onclick="quickActionRegister('${item.artNo}', '출고')" title="클릭 시 출고 등록">
        <div class="dash-item-info">
          <div class="dash-item-left">
            <span class="rank-badge ${rankBadgeClass}">${rankIcon}${rank}위</span>
            <div class="dash-item-text">
              <span class="dash-artno">${item.artNo} · ${item.hfb || 'HFB'}</span>
              <span class="dash-artname">${item.artName}</span>
            </div>
          </div>
          <span class="dash-stock-num high">${item.currentStock}개</span>
        </div>
        <div class="dash-progress-track">
          <div class="dash-progress-bar high" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  }).join("");

  // Low Stock / Out TOP 10
  const sortedLow = [...stockList].sort((a, b) => a.currentStock - b.currentStock);
  const topLow = sortedLow.slice(0, 10);
  const maxLowRef = Math.max(...topLow.map(item => Math.abs(item.currentStock)), 10);

  containerLow.innerHTML = topLow.map((item, idx) => {
    const rank = idx + 1;
    const isOut = item.currentStock <= 0;
    const pct = isOut ? 100 : Math.max(Math.min((item.currentStock / maxLowRef) * 100, 100), 8);

    return `
      <div class="dash-item" onclick="quickActionRegister('${item.artNo}', '입고')" title="클릭 시 입고 등록">
        <div class="dash-item-info">
          <div class="dash-item-left">
            <span class="rank-badge ${isOut ? 'rank-danger' : 'rank-warning'}">${rank}위</span>
            <div class="dash-item-text">
              <span class="dash-artno">${item.artNo} · ${item.hfb || 'HFB'}</span>
              <span class="dash-artname">${item.artName}</span>
            </div>
          </div>
          <span class="dash-stock-num ${isOut ? 'danger' : 'warning'}">
            ${isOut ? '⚠️ 품절 (0개)' : item.currentStock + '개'}
          </span>
        </div>
        <div class="dash-progress-track">
          <div class="dash-progress-bar ${isOut ? 'danger' : 'warning'}" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  }).join("");

  // HFB Category Breakdown Dashboard View
  if (containerHfb) {
    const hfbMap = new Map();
    stockList.forEach(item => {
      const hfbName = item.hfb || "기타 HFB";
      let hEntry = hfbMap.get(hfbName);
      if (!hEntry) {
        hEntry = { hfb: hfbName, count: 0, totalStock: 0 };
        hfbMap.set(hfbName, hEntry);
      }
      hEntry.count++;
      hEntry.totalStock += Math.max(item.currentStock, 0);
    });

    const hfbList = Array.from(hfbMap.values()).sort((a, b) => b.totalStock - a.totalStock);
    const maxHfbStock = hfbList.length > 0 && hfbList[0].totalStock > 0 ? hfbList[0].totalStock : 1;

    containerHfb.innerHTML = hfbList.map(hItem => {
      const pct = Math.max(Math.min((hItem.totalStock / maxHfbStock) * 100, 100), 8);
      return `
        <div class="hfb-dash-card" onclick="filterByHFB('${hItem.hfb}')" style="cursor:pointer;" title="해당 HFB 품목 필터링">
          <div class="hfb-dash-header">
            <div class="hfb-dash-title">
              <span class="hfb-badge">${hItem.hfb}</span>
              <span>(${hItem.count}개 품목)</span>
            </div>
            <span class="hfb-dash-val">재고 ${hItem.totalStock}개</span>
          </div>
          <div class="dash-progress-track">
            <div class="dash-progress-bar high" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    }).join("");
  }
}

function filterByHFB(hfbName) {
  const select = document.getElementById("stock-hfb-select");
  if (select) select.value = hfbName;
  currentStockHFBFilter = hfbName;
  stockDisplayLimit = RENDER_LIMIT;
  renderStockLookup();
}

function loadMoreStockItems() {
  stockDisplayLimit += RENDER_LIMIT;
  renderStockLookup();
}

function clearStockSearch() {
  document.getElementById("stock-search").value = "";
  stockDisplayLimit = RENDER_LIMIT;
  renderStockLookup();
}

function selectItemForRegister(artNo) {
  quickActionRegister(artNo, '입고');
}

function quickActionRegister(artNo, type) {
  const regArtNoElem = document.getElementById("reg-artno");
  if (regArtNoElem) regArtNoElem.value = artNo;
  
  const radio = document.querySelector(`input[name="reg-type"][value="${type}"]`);
  if (radio) {
    radio.checked = true;
    updateTypeToggle();
  }

  onArtNoInput(artNo);

  const regNavBtn = document.querySelectorAll(".bottom-nav .nav-item")[0];
  switchTab("register", regNavBtn);
  showToast(`'${artNo}' 품목 [${type}] 등록 화면으로 이동했습니다.`, "success");
}

function quickActionOrder(artNo) {
  const orderArtNoElem = document.getElementById("order-artno");
  if (orderArtNoElem) orderArtNoElem.value = artNo;
  
  onOrderArtNoInput(artNo);

  const orderNavBtn = document.querySelectorAll(".bottom-nav .nav-item")[2];
  switchTab("order", orderNavBtn);
  showToast(`'${artNo}' 품목 오더 요청 화면으로 이동했습니다.`, "success");
}

// --- History Logs Logic & Filters ---
function populateArticleFilterDropdown() {
  const select = document.getElementById("filter-article");
  if (!select) return;

  const currentSelection = select.value;
  const uniqueArticles = new Map();

  for (let i = 0; i < historyLogs.length; i++) {
    const log = historyLogs[i];
    if (!uniqueArticles.has(log.artNo)) {
      uniqueArticles.set(log.artNo, log.artName);
    }
  }

  let optionsHtml = '<option value="ALL">모든 품목</option>';
  uniqueArticles.forEach((artName, artNo) => {
    optionsHtml += `<option value="${artNo}">${artNo} - ${artName}</option>`;
  });

  select.innerHTML = optionsHtml;
  if (currentSelection && (currentSelection === "ALL" || uniqueArticles.has(currentSelection))) {
    select.value = currentSelection;
  }
}

function renderHistoryLogs() {
  const container = document.getElementById("history-logs-container");
  if (!container) return;

  const startDate = document.getElementById("filter-start-date").value;
  const endDate = document.getElementById("filter-end-date").value;
  const typeFilter = document.getElementById("filter-type").value;
  const articleFilter = document.getElementById("filter-article").value;

  let filteredLogs = historyLogs;

  if (startDate || endDate || typeFilter !== "ALL" || articleFilter !== "ALL") {
    filteredLogs = historyLogs.filter(log => {
      if (startDate && log.date < startDate) return false;
      if (endDate && log.date > endDate) return false;
      if (typeFilter !== "ALL" && log.type !== typeFilter) return false;
      if (articleFilter !== "ALL" && log.artNo !== articleFilter) return false;
      return true;
    });
  }

  let totalIn = 0;
  let totalOut = 0;
  for (let i = 0; i < filteredLogs.length; i++) {
    const log = filteredLogs[i];
    const qty = Number(log.qty) || 0;
    if (log.type === "입고") totalIn += qty;
    if (log.type === "출고") totalOut += qty;
  }

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

  const visibleLogs = filteredLogs.slice(0, historyDisplayLimit);

  let html = visibleLogs.map(log => `
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

  if (filteredLogs.length > historyDisplayLimit) {
    html += `
      <button type="button" class="btn-secondary" style="width:100%; margin-top:10px; padding:12px;" onclick="loadMoreHistoryLogs()">
        더보기 (${historyDisplayLimit} / ${filteredLogs.length})
      </button>
    `;
  }

  container.innerHTML = html;
}

function loadMoreHistoryLogs() {
  historyDisplayLimit += RENDER_LIMIT;
  renderHistoryLogs();
}

function resetHistoryFilters() {
  document.getElementById("filter-start-date").value = "";
  document.getElementById("filter-end-date").value = "";
  document.getElementById("filter-type").value = "ALL";
  document.getElementById("filter-article").value = "ALL";
  historyDisplayLimit = RENDER_LIMIT;
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
  statusMsg.style.display = "block";
  statusMsg.className = "import-status-msg";
  statusMsg.style.backgroundColor = "#e0f2fe";
  statusMsg.style.color = "#0369a1";
  statusMsg.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 엑셀 파일 분석 중...';

  setTimeout(() => {
    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        const sheetName = workbook.SheetNames.find(s => s.trim().toUpperCase() === "SHEET1") || workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (rows.length < 2) {
          throw new Error("엑셀 시트에 데이터가 부족합니다.");
        }

        let hfbIdx = -1;
        let artNoIdx = -1;
        let artNameIdx = -1;

        const header = rows[0] || [];
        for (let i = 0; i < header.length; i++) {
          const title = String(header[i] || "").toUpperCase();
          if (title.includes("HFB") || title.includes("BUSINESS") || title.includes("HOME FURNISHING")) hfbIdx = i;
          if (title.includes("ARTNO") || title.includes("번호") || title.includes("ARTICLE NUMBER")) artNoIdx = i;
          if (title.includes("ARTNAME") || title.includes("아티클") || title.includes("이름") || title.includes("ARTICLE NAME")) artNameIdx = i;
        }

        // Default Excel Master Specification: Sheet1 Columns:
        // F열 (Index 5): HFB (Home Furnishing Business)
        // H열 (Index 7): 번호 / Article Number
        // I열 (Index 8): 아티클 이름 / Article Name
        if (hfbIdx === -1) hfbIdx = 5;
        if (artNoIdx === -1) artNoIdx = 7;
        if (artNameIdx === -1) artNameIdx = 8;

        const newCatalog = [];
        const seenArtNo = new Set();

        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          if (row && row[artNoIdx] !== undefined && row[artNoIdx] !== null) {
            const artNo = String(row[artNoIdx]).trim();
            const artName = (row[artNameIdx] !== undefined && row[artNameIdx] !== null)
              ? String(row[artNameIdx]).trim() 
              : "품목명 없음";
            const hfb = (row[hfbIdx] !== undefined && row[hfbIdx] !== null)
              ? String(row[hfbIdx]).trim()
              : "";

            if (artNo && !seenArtNo.has(artNo)) {
              seenArtNo.add(artNo);
              newCatalog.push({ hfb, artNo, artName });
            }
          }
        }

        if (newCatalog.length > 0) {
          masterCatalog = newCatalog;
          saveMasterCatalog();
          renderMasterCatalog();
          populateArticleFilterDropdown();

          statusMsg.style.backgroundColor = "#ecfdf5";
          statusMsg.style.color = "#047857";
          statusMsg.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${newCatalog.length}개 아티클 마스터 데이터로 새로고침 되었습니다!`;
          showToast(`엑셀에서 ${newCatalog.length}개 품목을 새로고침했습니다.`, "success");
        } else {
          throw new Error("유효한 아티클 번호를 찾을 수 없습니다.");
        }
      } catch (err) {
        statusMsg.style.backgroundColor = "#fef2f2";
        statusMsg.style.color = "#b91c1c";
        statusMsg.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> 오류: ${err.message}`;
        showToast(`엑셀 읽기 오류: ${err.message}`, "danger");
      } finally {
        e.target.value = "";
      }
    };

    reader.readAsArrayBuffer(file);
  }, 50);
}

// --- Master Catalog Render & Add ---
function renderMasterCatalog() {
  const container = document.getElementById("master-catalog-container");
  if (!container) return;

  const searchQuery = document.getElementById("master-search").value.trim().toLowerCase();

  const filtered = searchQuery 
    ? masterCatalog.filter(item => 
        (item.hfb && item.hfb.toLowerCase().includes(searchQuery)) ||
        item.artNo.toLowerCase().includes(searchQuery) || 
        item.artName.toLowerCase().includes(searchQuery)
      )
    : masterCatalog;

  if (filtered.length === 0) {
    container.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 15px;">등록된 품목이 없습니다.</p>';
    return;
  }

  const visibleList = filtered.slice(0, masterDisplayLimit);

  let html = visibleList.map(item => `
    <div class="master-item">
      <div>
        <div style="display:flex; align-items:center; gap:6px; margin-bottom: 2px;">
          ${item.hfb ? `<span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:11px; font-weight:700; padding:2px 6px; border-radius:4px;">${item.hfb}</span>` : ''}
          <span class="master-artno">${item.artNo}</span>
        </div>
        <div class="master-artname">${item.artName}</div>
      </div>
      <button type="button" class="btn-secondary sm" onclick="selectItemForRegister('${item.artNo}')">
        <i class="fa-solid fa-plus"></i> 입력
      </button>
    </div>
  `).join("");

  if (filtered.length > masterDisplayLimit) {
    html += `
      <button type="button" class="btn-secondary" style="width:100%; margin-top:10px; padding:12px;" onclick="loadMoreMasterItems()">
        더보기 (${masterDisplayLimit} / ${filtered.length})
      </button>
    `;
  }

  container.innerHTML = html;
}

function loadMoreMasterItems() {
  masterDisplayLimit += RENDER_LIMIT;
  renderMasterCatalog();
}

// --- Modals Logic ---
function openMasterSelectModal(target = "register") {
  modalSelectTarget = target;
  document.getElementById("master-select-modal").classList.add("active");
  document.getElementById("modal-search").value = "";
  renderModalMasterList();
}

function closeMasterSelectModal() {
  document.getElementById("master-select-modal").classList.remove("active");
}

function renderModalMasterList() {
  const container = document.getElementById("modal-master-list");
  if (!container) return;

  const query = document.getElementById("modal-search").value.trim().toLowerCase();

  const filtered = query 
    ? masterCatalog.filter(item => 
        (item.hfb && item.hfb.toLowerCase().includes(query)) ||
        item.artNo.toLowerCase().includes(query) || 
        item.artName.toLowerCase().includes(query)
      )
    : masterCatalog;

  const maxModalItems = 100;
  const visibleList = filtered.slice(0, maxModalItems);

  let html = visibleList.map(item => `
    <div class="modal-list-item" onclick="chooseModalItem('${item.artNo}')">
      <div>
        <div style="display:flex; align-items:center; gap:6px;">
          ${item.hfb ? `<span style="background:#e0f2fe; color:#0369a1; font-size:10px; font-weight:700; padding:1px 5px; border-radius:3px;">${item.hfb}</span>` : ''}
          <strong style="color: #2563eb;">${item.artNo}</strong>
        </div>
        <div style="font-size: 13px; font-weight: 600; margin-top: 2px;">${item.artName}</div>
      </div>
      <i class="fa-solid fa-chevron-right" style="color: #cbd5e1;"></i>
    </div>
  `).join("");

  if (filtered.length > maxModalItems) {
    html += `
      <div style="text-align:center; padding:10px; font-size:12px; color:#64748b;">
        상위 ${maxModalItems}개만 표시됩니다. 상세 검색어를 입력해 주세요.
      </div>
    `;
  }

  container.innerHTML = html;
}

function chooseModalItem(artNo) {
  if (modalSelectTarget === "order") {
    document.getElementById("order-artno").value = artNo;
    onOrderArtNoInput(artNo);
  } else {
    document.getElementById("reg-artno").value = artNo;
    onArtNoInput(artNo);
  }
  closeMasterSelectModal();
}

function openAddMasterModal() {
  if (!isAdminUser) {
    showToast("신규 아티클 개별 추가는 관리자 전용 기능입니다.", "danger");
    return;
  }
  document.getElementById("add-master-modal").classList.add("active");
}

function closeAddMasterModal() {
  document.getElementById("add-master-modal").classList.remove("active");
}

function handleAddMasterSubmit(e) {
  e.preventDefault();
  if (!isAdminUser) {
    showToast("관리자 권한이 필요합니다.", "danger");
    return;
  }

  const hfb = (document.getElementById("new-hfb") ? document.getElementById("new-hfb").value.trim() : "");
  const artNo = document.getElementById("new-artno").value.trim();
  const artName = document.getElementById("new-artname").value.trim();

  if (!artNo || !artName) return;

  if (masterCatalogMap.has(artNo)) {
    showToast(`이미 등록된 아티클 번호입니다: ${artNo}`, "danger");
    return;
  }

  masterCatalog.push({ hfb, artNo, artName });
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
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 3000);
}
