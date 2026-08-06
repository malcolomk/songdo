const supabaseUrl = "https://zblzdqwqxagqnkrojyda.supabase.co";

const supabaseKey = "sb_publishable_rV-ZqhhA4pxsIN_9NhPEcg_EoiM_xo1";

let supabaseClient = null;
try {
  if (typeof supabase !== "undefined" && supabase.createClient) {
    supabaseClient = supabase.createClient(
      supabaseUrl,
      supabaseKey
    );
  }
} catch (err) {
  console.warn("Supabase initialization skipped or failed:", err);
}

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

// Bulk Action State
let selectedStockItems = new Set();

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
  
  // 1. Check session and restore tab synchronously to prevent UI flashing
  checkLoginSession();
  initFormDate();
  setupDebouncedInputs();

  const savedTab = localStorage.getItem("warehouse_current_tab");
  if (savedTab) {
    const navBtn = document.querySelector(`.bottom-nav .nav-item[onclick*="${savedTab}"]`);
    if (navBtn) switchTab(savedTab, navBtn);
    else switchTab(savedTab);
  }

  // 2. Fetch latest data from Supabase in background
  try {
    await loadDataFromSupabase();
    initRealtimeSubscriptions();
    // Soft re-render the current tab with the newly fetched data
    if (currentTab) switchTab(currentTab);
  } catch (err) {
    console.warn("Data load error during init:", err);
  }

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

function updateUserInfoDisplay() {
  // If there's a place to show user info, update it here.
  // We can inject a logout button into the UI if it doesn't exist
  let userBadge = document.getElementById("user-info-badge");
  if (!userBadge) {
    userBadge = document.createElement("div");
    userBadge.id = "user-info-badge";
    userBadge.style.cssText = "position:absolute; top:20px; right:20px; z-index:50; display:flex; align-items:center; gap:10px; background:rgba(255,255,255,0.9); padding:6px 12px; border-radius:20px; box-shadow:0 2px 5px rgba(0,0,0,0.1); font-size:13px; font-weight:600; color:#475569;";
    document.body.appendChild(userBadge);
  }
  
  userBadge.innerHTML = `
    <span><i class="fa-solid fa-user${isAdminUser ? '-tie text-primary' : ''}"></i> ${currentUser}</span>
    <button type="button" onclick="logoutUser()" style="background:none; border:none; color:#dc2626; font-size:12px; cursor:pointer; font-weight:700;"><i class="fa-solid fa-arrow-right-from-bracket"></i> 로그아웃</button>
  `;
}

function logoutUser() {
  localStorage.removeItem("warehouse_current_user");
  currentUser = null;
  isAdminUser = false;
  
  const userBadge = document.getElementById("user-info-badge");
  if (userBadge) userBadge.remove();
  
  document.getElementById("login-overlay").classList.add("active");
  
  // Clear any inputs if needed
  document.getElementById("login-id").value = "";
  document.getElementById("login-pw").value = "";
}

function checkLoginSession() {
  const sessionUser = currentUser || localStorage.getItem("warehouse_current_user"); // Use localStorage fallback
  const loginOverlay = document.getElementById("login-overlay");
  const userBadge = document.getElementById("user-profile-badge");
  const userNameElem = document.getElementById("current-user-name");
  const adminRoleBadge = document.getElementById("admin-role-badge");

  const btnExcelExport = document.getElementById("btn-excel-export");
  const btnOrderExcelExport = document.getElementById("btn-order-excel-export");
  const excelExportLocked = document.getElementById("excel-export-locked");

  const navHistoryBtn = document.getElementById("nav-history-btn");

  if (sessionUser && ALLOWED_USER_IDS.includes(sessionUser)) {
    currentUser = sessionUser;
    isAdminUser = ADMIN_USERS.includes(sessionUser);

    if (loginOverlay) {
      loginOverlay.classList.remove("active");
      loginOverlay.style.display = "none";
      loginOverlay.style.visibility = "hidden";
      loginOverlay.style.opacity = "0";
      loginOverlay.style.pointerEvents = "none";
    }
    
    updateUserInfoDisplay();
    
    if (userBadge) userBadge.style.display = "flex";
    if (userNameElem) userNameElem.textContent = sessionUser;

    if (isAdminUser) {
      if (adminRoleBadge) adminRoleBadge.style.display = "inline-block";
      if (btnExcelExport) btnExcelExport.style.display = "flex";
      if (btnOrderExcelExport) btnOrderExcelExport.style.display = "flex";
      if (excelExportLocked) excelExportLocked.style.display = "none";
      if (navHistoryBtn) navHistoryBtn.style.display = "flex";
    } else {
      if (adminRoleBadge) adminRoleBadge.style.display = "none";
      if (btnExcelExport) btnExcelExport.style.display = "none";
      if (btnOrderExcelExport) btnOrderExcelExport.style.display = "none";
      if (excelExportLocked) excelExportLocked.style.display = "inline-block";
      if (navHistoryBtn) navHistoryBtn.style.display = "none";

      const historyTab = document.getElementById("tab-history");
      if (historyTab && historyTab.classList.contains("active")) {
        const regNavBtn = document.querySelectorAll(".bottom-nav .nav-item")[0];
        if (regNavBtn) switchTab("register", regNavBtn);
      }
    }

    try { renderStockLookup(); } catch (e) { console.error(e); }
    try { renderHistoryLogs(); } catch (e) { console.error(e); }
    try { renderOrderLogs(); } catch (e) { console.error(e); }
    try { populateArticleFilterDropdown(); } catch (e) { console.error(e); }
  } else {
    currentUser = null;
    isAdminUser = false;
    if (loginOverlay) {
      loginOverlay.classList.add("active");
      loginOverlay.style.display = "flex";
      loginOverlay.style.visibility = "visible";
      loginOverlay.style.opacity = "1";
      loginOverlay.style.pointerEvents = "auto";
    }
    if (userBadge) userBadge.style.display = "none";
  }
}

function handleLoginSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();

  const loginIdElem = document.getElementById("login-id");
  const loginPwElem = document.getElementById("login-pw");
  
  if (!loginIdElem || !loginPwElem) return;

  const rawInputId = loginIdElem.value.trim().toLowerCase();
  const inputPw = loginPwElem.value.trim();

  if (!rawInputId) {
    showToast("아이디를 입력해 주세요.", "danger");
    return;
  }

  const matchedId = ALLOWED_USER_IDS.find(id => id.toLowerCase() === rawInputId);

  if (!matchedId) {
    showToast(`'${rawInputId}'은(는) 허용되지 않은 아이디입니다. (허용: junkoo, guest1 등)`, "danger");
    return;
  }

  const storedPw = userPasswords[matchedId] || INITIAL_PASSWORD;

  if (inputPw !== storedPw) {
    showToast(`비밀번호가 올바르지 않습니다. (기본 비밀번호: ${INITIAL_PASSWORD})`, "danger");
    return;
  }

  currentUser = matchedId;
  isAdminUser = ADMIN_USERS.includes(matchedId);
  localStorage.setItem("warehouse_current_user", currentUser);

  const roleTitle = isAdminUser ? "👑 관리자" : "일반 사용자";
  showToast(`송도 CMP! 맹리!<br>재고 정확도는 우리 모두 함께!`, "success");

  const loginOverlay = document.getElementById("login-overlay");
  if (loginOverlay) {
    loginOverlay.classList.remove("active");
    loginOverlay.style.display = "none";
    loginOverlay.style.visibility = "hidden";
    loginOverlay.style.opacity = "0";
    loginOverlay.style.pointerEvents = "none";
  }

  // --- 브라우저 알림(Push) 권한 요청 ---
  if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
    Notification.requestPermission();
  }

  checkLoginSession();
}

function handleLogout() {
  currentUser = null;
  isAdminUser = false;
  localStorage.removeItem("warehouse_current_user");
  localStorage.removeItem("warehouse_current_tab");
  showToast("로그아웃 되었습니다.", "success", null, true);
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

  showToast(`'${selectId}'의 비밀번호가 성공적으로 변경되었습니다!`, "success", null, true);
  document.getElementById("login-pw").value = newPw;
}

// --- Storage & Data Load Helpers ---
async function loadDataFromSupabase() {
  if (supabaseClient) {
    try {
      const { data: catalog, error: catErr } =
        await supabaseClient
          .from("master_catalog")
          .select("*");

      if (!catErr && catalog && catalog.length > 0) {
        masterCatalog = catalog.map(row => ({
          hfb: row.hfb || "",
          artNo: row.artno || row.artNo || "",
          artName: row.artname || row.artName || "",
          location: row.location || "지정 안됨",
          id: row.id
        }));
      } else {
        const savedCatalog = localStorage.getItem("warehouse_master_catalog");
        masterCatalog = savedCatalog ? JSON.parse(savedCatalog) : [...defaultMasterCatalog];
      }

      rebuildMasterCatalogMap();

      const { data: history, error: histErr } =
        await supabaseClient
          .from("inventory_logs")
          .select("*")
          .order("id", { ascending: false });

      if (!histErr && history) {
        historyLogs = history.map(row => {
          const mappedArtNo = row.artno || row.artNo || "";
          return {
            ...row,
            artNo: mappedArtNo,
            artName: row.artname || row.artName || masterCatalogMap.get(mappedArtNo) || "알 수 없는 품목"
          };
        });
      } else {
        const savedHistory = localStorage.getItem("warehouse_history_logs");
        historyLogs = savedHistory ? JSON.parse(savedHistory) : [...defaultHistoryLogs];
      }

      const { data: orders, error: ordErr } =
        await supabaseClient
          .from("order_requests")
          .select("*")
          .order("id", { ascending: false });

      if (!ordErr && orders) {
        orderLogs = orders.map(row => {
          const mappedArtNo = row.artno || row.artNo || "";
          return {
            ...row,
            artNo: mappedArtNo,
            artName: row.artname || row.artName || masterCatalogMap.get(mappedArtNo) || "알 수 없는 품목"
          };
        });
      } else {
        const savedOrders = localStorage.getItem("warehouse_order_logs");
        orderLogs = savedOrders ? JSON.parse(savedOrders) : [...defaultOrderLogs];
      }
    } catch (err) {
      console.warn("Supabase data load error, fallback to local storage:", err);
      const savedCatalog = localStorage.getItem("warehouse_master_catalog");
      masterCatalog = savedCatalog ? JSON.parse(savedCatalog) : [...defaultMasterCatalog];
      const savedHistory = localStorage.getItem("warehouse_history_logs");
      historyLogs = savedHistory ? JSON.parse(savedHistory) : [...defaultHistoryLogs];
      const savedOrders = localStorage.getItem("warehouse_order_logs");
      orderLogs = savedOrders ? JSON.parse(savedOrders) : [...defaultOrderLogs];
    }
  } else {
    const savedCatalog = localStorage.getItem("warehouse_master_catalog");
    masterCatalog = savedCatalog ? JSON.parse(savedCatalog) : [...defaultMasterCatalog];
    const savedHistory = localStorage.getItem("warehouse_history_logs");
    historyLogs = savedHistory ? JSON.parse(savedHistory) : [...defaultHistoryLogs];
    const savedOrders = localStorage.getItem("warehouse_order_logs");
    orderLogs = savedOrders ? JSON.parse(savedOrders) : [...defaultOrderLogs];
  }

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

async function saveHistoryLogs(log) {
  let insertedId = null;
  if (supabaseClient) {
    try {
      const dbLog = { ...log };
      delete dbLog.timestamp; // Remove timestamp as it causes schema error
      
      let payload = { ...dbLog };
      
      let res = await supabaseClient.from("inventory_logs").insert([payload]).select();
      if (res.error && res.error.message) {
        const msg = res.error.message;
        if (msg.includes("artName") || msg.includes("artname") || msg.includes("artNo") || msg.includes("artno")) {
          payload = { ...dbLog };
          if (payload.artNo) { payload.artno = payload.artNo; delete payload.artNo; }
          if (payload.artName) { payload.artname = payload.artName; delete payload.artName; }
          res = await supabaseClient.from("inventory_logs").insert([payload]).select();
          
          if (res.error && res.error.message) {
            payload = { ...dbLog };
            delete payload.artName;
            delete payload.artname;
            res = await supabaseClient.from("inventory_logs").insert([payload]).select();
            
            if (res.error && res.error.message) {
              payload = { ...dbLog };
              if (payload.artNo) { payload.artno = payload.artNo; delete payload.artNo; }
              delete payload.artName;
              delete payload.artname;
              res = await supabaseClient.from("inventory_logs").insert([payload]).select();
            }
          }
        }
      }

      if (!res.error && res.data && res.data.length > 0) {
        insertedId = res.data[0].id;
        log.id = insertedId;
        log.created_at = res.data[0].created_at;
      } else if (res.error) {
        throw res.error;
      }
    } catch (err) {
      console.warn("Supabase saveHistoryLogs error:", err);
    }
  }
  try {
    localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
  } catch (err) {}
  return insertedId;
}

async function saveOrderLogs(order) {
  let insertedId = null;
  if (supabaseClient) {
    try {
      const dbOrder = { ...order };
      delete dbOrder.timestamp; // Remove timestamp as it causes schema error
      const { data, error } = await supabaseClient
        .from("order_requests")
        .insert([dbOrder])
        .select();
      
      if (!error && data && data.length > 0) {
        insertedId = data[0].id;
        order.id = insertedId;
        order.created_at = data[0].created_at;
      }
    } catch (err) {
      console.warn("Supabase saveOrderLogs error:", err);
    }
  }
  try {
    localStorage.setItem("warehouse_order_logs", JSON.stringify(orderLogs));
  } catch (err) {}
  return insertedId;
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
  
  if (!btnElement) {
    btnElement = document.querySelector(`.bottom-nav .nav-item[onclick*="${tabId}"]`);
  }
  if (btnElement) btnElement.classList.add("active");

  currentTab = tabId;
  localStorage.setItem("warehouse_current_tab", tabId);

  // Clear bulk selection on tab switch
  if (typeof clearBulkSelection === 'function') {
    clearBulkSelection();
  }

  if (tabId === "stock") {
    stockDisplayLimit = RENDER_LIMIT;
    renderStockLookup();
  }
  if (tabId === "register" || tabId === "order") {
    initFormDate();
  }
  if (tabId === "order") {
    renderOrderLogs();
  }
  if (tabId === "picklist") {
    renderPickList();
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

// --- LIVE AUTOCOMPLETE SEARCH LOGIC ---
function handleAutocompleteInput(query, target = "register") {
  const cleanQuery = query.trim().toLowerCase();
  const dropdownId = target === "order" ? "order-autocomplete-dropdown" : "reg-autocomplete-dropdown";
  const nameDropdownId = target === "order" ? "order-name-autocomplete-dropdown" : "reg-name-autocomplete-dropdown";
  
  const dropdown = document.getElementById(dropdownId);
  const nameDropdown = document.getElementById(nameDropdownId);
  if (nameDropdown) nameDropdown.classList.remove("active");

  if (target === "order") onOrderArtNoInput(query);
  else onArtNoInput(query);

  if (!cleanQuery) {
    if (dropdown) dropdown.classList.remove("active");
    return;
  }

  const matches = masterCatalog.filter(item => 
    item.artNo.toLowerCase().includes(cleanQuery) ||
    item.artName.toLowerCase().includes(cleanQuery) ||
    (item.hfb && item.hfb.toLowerCase().includes(cleanQuery))
  ).slice(0, 10);

  if (matches.length === 0 || !dropdown) {
    if (dropdown) dropdown.classList.remove("active");
    return;
  }

  dropdown.innerHTML = matches.map(item => `
    <div class="autocomplete-item" onclick="selectAutocompleteItem('${item.artNo}', '${target}')">
      <div class="art-info">
        <div class="art-no-row">
          ${item.hfb ? `<span style="background:#e0f2fe; color:#0369a1; font-size:10px; font-weight:700; padding:1px 5px; border-radius:3px;">${item.hfb}</span>` : ''}
          <span class="art-no">${item.artNo}</span>
        </div>
        <div class="art-name">${item.artName}</div>
      </div>
      <i class="fa-solid fa-check" style="color:#2563eb; font-size:12px;"></i>
    </div>
  `).join("");

  dropdown.classList.add("active");
}

function handleAutocompleteNameInput(query, target = "register") {
  const cleanQuery = query.trim().toLowerCase();
  const dropdownId = target === "order" ? "order-name-autocomplete-dropdown" : "reg-name-autocomplete-dropdown";
  const artnoDropdownId = target === "order" ? "order-autocomplete-dropdown" : "reg-autocomplete-dropdown";

  const dropdown = document.getElementById(dropdownId);
  const artnoDropdown = document.getElementById(artnoDropdownId);
  if (artnoDropdown) artnoDropdown.classList.remove("active");

  if (!cleanQuery) {
    if (dropdown) dropdown.classList.remove("active");
    return;
  }

  const matches = masterCatalog.filter(item => 
    item.artName.toLowerCase().includes(cleanQuery) ||
    item.artNo.toLowerCase().includes(cleanQuery) ||
    (item.hfb && item.hfb.toLowerCase().includes(cleanQuery))
  ).slice(0, 10);

  if (matches.length === 0 || !dropdown) {
    if (dropdown) dropdown.classList.remove("active");
    return;
  }

  dropdown.innerHTML = matches.map(item => `
    <div class="autocomplete-item" onclick="selectAutocompleteItem('${item.artNo}', '${target}')">
      <div class="art-info">
        <div class="art-no-row">
          ${item.hfb ? `<span style="background:#e0f2fe; color:#0369a1; font-size:10px; font-weight:700; padding:1px 5px; border-radius:3px;">${item.hfb}</span>` : ''}
          <span class="art-no">${item.artNo}</span>
        </div>
        <div class="art-name">${item.artName}</div>
      </div>
      <i class="fa-solid fa-check" style="color:#2563eb; font-size:12px;"></i>
    </div>
  `).join("");

  dropdown.classList.add("active");
}

function selectAutocompleteItem(artNo, target = "register") {
  if (target === "order") {
    const artNoInput = document.getElementById("order-artno");
    if (artNoInput) artNoInput.value = artNo;
    onOrderArtNoInput(artNo);
  } else {
    const artNoInput = document.getElementById("reg-artno");
    if (artNoInput) artNoInput.value = artNo;
    onArtNoInput(artNo);
  }
  closeAllAutocompletes();
}

function closeAllAutocompletes() {
  document.querySelectorAll(".autocomplete-dropdown").forEach(d => d.classList.remove("active"));
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".autocomplete-wrapper")) {
    closeAllAutocompletes();
  }
});

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
    icon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: #d97706;"></i>';
    const currentStock = getItemStock(cleanNo);
    stockPreview.textContent = `${currentStock} 개`;
    stockPreview.style.color = currentStock > 0 ? "#059669" : "#64748b";
  }
}

function getPendingPickQty(artNo) {
  return orderLogs
    .filter(log => log.artNo === artNo && log.status === "출고대기")
    .reduce((sum, log) => sum + log.qty, 0);
}

// Auto Lookup Article Name for Order Request Tab
function onOrderArtNoInput(artNoValue) {
  const cleanNo = artNoValue.trim();
  const artNameInput = document.getElementById("order-artname");
  const icon = document.getElementById("order-artname-status-icon");
  const stockPreview = document.getElementById("order-current-stock");
  const takeFromStockBtn = document.getElementById("btn-take-from-stock");

  if (!cleanNo) {
    artNameInput.value = "";
    if (stockPreview) stockPreview.textContent = "- 개";
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
    if (takeFromStockBtn) takeFromStockBtn.style.display = 'none';
    return;
  }

  const artNameMatch = masterCatalogMap.get(cleanNo);
  const currentStock = getItemStock(cleanNo);
  const pendingQty = getPendingPickQty(cleanNo);
  const availableStock = currentStock - pendingQty;

  if (artNameMatch) {
    artNameInput.value = artNameMatch;
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #059669;"></i>';
    if (stockPreview) {
      if (pendingQty > 0) {
        stockPreview.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:4px; font-size:14px; padding:4px 0;">
            <div>총 재고: ${currentStock}개</div>
            <div style="color:#b45309;">(출고 대기: -${pendingQty}개)</div>
            <div style="font-size:16px; color:${availableStock > 0 ? '#059669' : '#dc2626'};">가용 수량: ${availableStock}개</div>
          </div>
        `;
      } else {
        stockPreview.textContent = `${availableStock} 개`;
        stockPreview.style.color = availableStock > 0 ? "#059669" : "#dc2626";
      }
    }
    
    if (availableStock > 0) {
      showToast(`가용 재고가 ${availableStock}개 있습니다! 챙길 목록에 바로 담을 수 있습니다.`, "success");
      if (takeFromStockBtn) takeFromStockBtn.style.display = 'flex';
    } else {
      if (takeFromStockBtn) takeFromStockBtn.style.display = 'none';
    }
  } else {
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: #d97706;"></i>';
    if (stockPreview) {
      stockPreview.textContent = `${availableStock} 개`;
      stockPreview.style.color = availableStock > 0 ? "#059669" : "#64748b";
    }
    if (takeFromStockBtn) takeFromStockBtn.style.display = 'none';
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

// --- NEW CART STATE ---
let regCartList = [];

// --- REG CART LOGIC ---
function handleAddRegCart() {
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

  regCartList.push({ date, type, artNo, artName: artName || "기타 품목", qty });
  renderRegCart();
  
  document.getElementById("reg-artno").value = "";
  document.getElementById("reg-artname").value = "";
  document.getElementById("reg-qty").value = "";
  document.getElementById("reg-current-stock").textContent = "- 개";
  document.getElementById("reg-artno").focus();
}

function handleSingleRegSave() {
  const artNo = document.getElementById("reg-artno").value.trim();
  const qty = Number(document.getElementById("reg-qty").value);
  
  if (!artNo || !qty || qty <= 0) {
    showToast("아티클 번호와 수량을 올바르게 입력해주세요.", "danger");
    return;
  }
  
  handleAddRegCart();
  processRegCart();
}

function renderRegCart() {
  const container = document.getElementById("reg-cart-list");
  const saveBtn = document.getElementById("btn-save");
  
  if (regCartList.length === 0) {
    container.style.display = "none";
    saveBtn.style.display = "none";
    container.innerHTML = "";
    return;
  }
  
  container.style.display = "flex";
  saveBtn.style.display = "flex";
  
  let html = "";
  regCartList.forEach((item, idx) => {
    html += `
      <div class="cart-item">
        <div class="cart-item-info">
          <span class="cart-item-title">${item.artNo} - ${item.artName}</span>
          <span class="cart-item-sub">${item.date} | ${item.type}</span>
        </div>
        <div class="cart-item-action">
          <span class="cart-item-qty">${item.qty}개</span>
          <button type="button" class="btn-remove-cart" onclick="removeRegCart(${idx})"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
    `;
  });
  html += `<div class="cart-summary"><span>총 담긴 항목</span><span style="color:#2563eb">${regCartList.length}건</span></div>`;
  container.innerHTML = html;
}

function removeRegCart(idx) {
  regCartList.splice(idx, 1);
  renderRegCart();
}

async function processRegCart() {
  if (regCartList.length === 0) return;
  
  const originalBtnText = document.getElementById("btn-save").innerHTML;
  document.getElementById("btn-save").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 저장 중...`;
  document.getElementById("btn-save").disabled = true;

  try {
    let payload = regCartList.map(item => ({
      date: item.date, type: item.type, artNo: item.artNo, qty: item.qty, user: currentUser || "system", artName: item.artName
    }));

    let res = await supabaseClient.from('inventory_logs').insert(payload).select();
    
    if (res.error && res.error.message) {
      const msg = res.error.message;
      if (msg.includes("artName") || msg.includes("artname") || msg.includes("artNo") || msg.includes("artno")) {
        // Fallback 1: lowercase everything
        payload = regCartList.map(item => ({
          date: item.date, type: item.type, artno: item.artNo, qty: item.qty, user: currentUser || "system", artname: item.artName
        }));
        res = await supabaseClient.from('inventory_logs').insert(payload).select();
        
        if (res.error && res.error.message) {
          // Fallback 2: artNo only (no name)
          payload = regCartList.map(item => ({
            date: item.date, type: item.type, artNo: item.artNo, qty: item.qty, user: currentUser || "system"
          }));
          res = await supabaseClient.from('inventory_logs').insert(payload).select();
          
          if (res.error && res.error.message) {
            // Fallback 3: artno only (no name)
            payload = regCartList.map(item => ({
              date: item.date, type: item.type, artno: item.artNo, qty: item.qty, user: currentUser || "system"
            }));
            res = await supabaseClient.from('inventory_logs').insert(payload).select();
          }
        }
      }
    }

    if (res.error) throw res.error;
    const data = res.data;
    const error = res.error;
    
    if (data) {
      data.forEach(inserted => {
        const localLog = {
          ...inserted,
          artNo: inserted.artno || inserted.artNo,
          artName: inserted.artname || inserted.artName
        };
        historyLogs.unshift(localLog);
        if (!masterCatalogMap.has(localLog.artNo)) {
          masterCatalog.push({ artNo: localLog.artNo, artName: localLog.artName || "신규 품목" });
          saveMasterCatalog();
        }
      });
      populateArticleFilterDropdown();
    }
    
    invalidateStockCache();
    renderStockLookup();
    renderHistoryLogs();
    
    showToast(`총 ${regCartList.length}건의 항목이 일괄 저장되었습니다!`, "success", null, true);
    playSuccessFeedback();
    
    regCartList = [];
    renderRegCart();
    initFormDate();
  } catch (err) {
    console.error("Supabase insert error:", err);
    showToast("일괄 저장 실패: " + err.message, "danger");
  } finally {
    document.getElementById("btn-save").innerHTML = originalBtnText;
    document.getElementById("btn-save").disabled = false;
  }
}

// --- NEW ORDER REQUEST HANDLER ---
async function handleAddToPickList() {
  const date = document.getElementById("order-date").value;
  const artNo = document.getElementById("order-artno").value.trim();
  const artName = document.getElementById("order-artname").value.trim();
  const qty = Number(document.getElementById("order-qty").value);

  if (!artNo || !qty || qty <= 0) {
    showToast("아티클 번호와 수량을 올바르게 입력해주세요.", "danger");
    return;
  }

  const currentStock = getItemStock(artNo);
  const pendingQty = getPendingPickQty(artNo);
  const availableStock = currentStock - pendingQty;
  if (qty > availableStock) {
    showToast(`가용 재고(${availableStock}개)보다 챙길 수량이 많습니다. 수량을 조정해주세요.`, "danger");
    return;
  }

  const newPick = {
    date: date,
    artNo: artNo,
    artName: artName || "기타 품목",
    qty: qty,
    user: currentUser || "guest1",
    status: "출고대기"
  };

  try {
    const originalBtnText = document.getElementById("btn-take-from-stock").innerHTML;
    document.getElementById("btn-take-from-stock").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 저장 중...`;
    document.getElementById("btn-take-from-stock").disabled = true;

    await saveOrderLogs(newPick);

    orderLogs.unshift(newPick);

    showToast(`'${artName}' ${qty}개가 창고 챙기기 목록에 담겼습니다!`, "success", null, true);
    playSuccessFeedback();

    // Reset form
    document.getElementById("order-artno").value = "";
    document.getElementById("order-artname").value = "";
    document.getElementById("order-qty").value = "";
    const takeFromStockBtn = document.getElementById("btn-take-from-stock");
    if (takeFromStockBtn) takeFromStockBtn.style.display = 'none';
    document.getElementById("order-current-stock").textContent = "- 개";

    initFormDate(); // 날짜 자동 업데이트

    renderOrderLogs();
    
    document.getElementById("btn-take-from-stock").innerHTML = originalBtnText;
    document.getElementById("btn-take-from-stock").disabled = false;
  } catch (err) {
    console.error("Supabase insert error:", err);
    showToast("챙기기 목록 저장 실패: " + err.message, "danger");
    document.getElementById("btn-take-from-stock").disabled = false;
  }
}

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
    await saveOrderLogs(newOrder);

    orderLogs.unshift(newOrder);

    showToast("오더 요청이 성공적으로 등록되었습니다.", "success", null, true);
    playSuccessFeedback();

    // Reset form
    document.getElementById("order-artno").value = "";
    document.getElementById("order-artname").value = "";
    document.getElementById("order-qty").value = "";
    initFormDate(); // 날짜 자동 업데이트

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
  container.innerHTML = orderLogs.map((item, index) => {
    const statusText = item.status || '요청됨';
    let bgColor = '#e0e7ff';
    let textColor = '#4338ca';
    if (statusText === '수락') { bgColor = '#dcfce7'; textColor = '#166534'; }
    if (statusText === '보류') { bgColor = '#fee2e2'; textColor = '#991b1b'; }
    if (statusText === '출고대기') { bgColor = '#fef3c7'; textColor = '#b45309'; }
    if (statusText === '출고완료') { bgColor = '#f3f4f6'; textColor = '#4b5563'; }

    let statusHtml = `<span class="hist-badge" style="background-color: ${bgColor}; color: ${textColor};">${statusText}</span>`;
    // statusHtml remains just the badge
    // We will place the action buttons below the quantity

    let displayTime = item.date;
    if (item.created_at) {
      const d = new Date(item.created_at);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      displayTime = `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    }

    let actionButtonsHtml = '';
    const canManageStatus = isAdminUser;
    const canDelete = isAdminUser || item.user === currentUser;
    
    if (canManageStatus || canDelete) {
      actionButtonsHtml += `<div style="display:flex; gap:4px; margin-top:8px;">`;
      
      if (canManageStatus) {
        actionButtonsHtml += `
          <button type="button" onclick="updateOrderStatus(${index}, '출고대기')" class="btn-action-sm btn-accept"><i class="fa-solid fa-check"></i> 수락</button>
          <button type="button" onclick="updateOrderStatus(${index}, '보류')" class="btn-action-sm btn-hold"><i class="fa-solid fa-pause"></i> 보류</button>
        `;
      }
      if (canDelete) {
        actionButtonsHtml += `
          <button type="button" onclick="deleteOrderRequest(${index})" class="btn-action-sm btn-del"><i class="fa-solid fa-trash-can"></i> 삭제</button>
        `;
      }
      
      actionButtonsHtml += `</div>`;
    }

    return `
    <div class="history-item" style="border-left-color: #6366f1;">
      <div class="hist-left">
        <span class="hist-date"><i class="fa-regular fa-clock"></i> ${displayTime} · ${item.user}</span>
        <div class="hist-name">${item.artName}</div>
        <span class="hist-artno">번호: ${item.artNo}</span>
      </div>
      <div class="hist-right" style="align-items:flex-end;">
        ${statusHtml}
        <div class="hist-qty" style="color: #4338ca; margin-top:4px; font-weight:bold;">
          ${item.qty}개
        </div>
        ${actionButtonsHtml}
      </div>
    </div>
    `;
  }).join("");
  
  renderPickList();
}

async function deleteOrderRequest(index) {
  const order = orderLogs[index];
  if (!order) return;
  
  if (!confirm(`'${order.artName}' (${order.qty}개) 오더 요청을 정말 삭제하시겠습니까?`)) return;
  
  if (supabaseClient && order.id) {
    try {
      const { error } = await supabaseClient
        .from('order_requests')
        .delete()
        .eq('id', order.id);
        
      if (error) throw error;
    } catch (err) {
      console.warn("Supabase delete error:", err);
      showToast("오더 삭제 실패: " + err.message, "danger");
      return;
    }
  }
  
  orderLogs.splice(index, 1);
  try {
    localStorage.setItem("warehouse_order_logs", JSON.stringify(orderLogs));
  } catch (err) {}
  
  showToast("오더 요청이 삭제되었습니다.", "success", null, true);
  renderOrderLogs();
}

function renderPickList() {
  const container = document.getElementById("picklist-container");
  if (!container) return;

  const pendingPicks = orderLogs.filter(log => log.status === "출고대기");

  if (pendingPicks.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #94a3b8;">
        <i class="fa-solid fa-box-open" style="font-size: 32px; margin-bottom: 8px;"></i>
        <p>챙겨야 할 대기 목록이 없습니다.</p>
      </div>
    `;
    return;
  }

  let html = "";
  orderLogs.forEach((item, index) => {
    if (item.status === "출고대기") {
      let displayTime = item.date;
      if (item.created_at) {
        const d = new Date(item.created_at);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        displayTime = `${yyyy}-${mm}-${dd} ${hh}:${min}`;
      }
      html += `
        <div class="history-item" style="border-left-color: #f59e0b; background-color: #fffbeb;">
          <div class="hist-left">
            <span class="hist-date"><i class="fa-regular fa-clock"></i> ${displayTime} · ${item.user} 요청</span>
            <div class="hist-name">${item.artName}</div>
            <span class="hist-artno">
              번호: ${item.artNo}
              <span style="margin-left:6px; background-color:#e2e8f0; color:#334155; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:700;">위치: ${(() => {
                const matched = masterCatalog.find(m => m.artNo === item.artNo);
                return matched && matched.location && matched.location !== '지정 안됨' ? matched.location : '지정 안됨';
              })()}</span>
            </span>
          </div>
          <div class="hist-right" style="align-items:flex-end;">
            <div class="hist-qty" style="color: #b45309; font-size: 18px;">${item.qty}개</div>
            <div style="display:flex; gap:4px; margin-top:8px;">
              <button type="button" class="btn-action-sm btn-accept" onclick="completePickItem(${index})">
                <i class="fa-solid fa-check"></i> 챙김 완료
              </button>
              ${(isAdminUser || item.user === currentUser) ? `
                <button type="button" class="btn-action-sm btn-del" onclick="deleteOrderRequest(${index})">
                  <i class="fa-solid fa-trash-can"></i> 삭제
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }
  });
  container.innerHTML = html;
}

async function completePickItem(index) {
  const pickItem = orderLogs[index];
  if (!pickItem || pickItem.status !== "출고대기") return;
  
  if (!confirm(`'${pickItem.artName}' ${pickItem.qty}개를 창고에서 챙겼습니까?\\n(확인 시 즉시 출고 기록이 생성됩니다)`)) return;
  
  try {
    // 1. Update order status to 출고완료
    pickItem.status = "출고완료";
    if (supabaseClient && pickItem.id) {
      const { error: updateError } = await supabaseClient
        .from('order_requests')
        .update({ status: '출고완료' })
        .eq('id', pickItem.id);
        
      if (updateError) throw updateError;
    }
    
    // 2. Insert into inventory_logs (actual checkout)
    const newLog = {
      date: new Date().toISOString().split('T')[0],
      type: "출고",
      artNo: pickItem.artNo,
      artName: pickItem.artName,
      qty: pickItem.qty,
      user: currentUser || "system"
    };
    
    const insertedId = await saveHistoryLogs(newLog);
    historyLogs.unshift(newLog);
    invalidateStockCache();
    
    showToast("창고 챙김을 완료하고 출고 처리했습니다.", "success", null, true);
    playSuccessFeedback();
    
    renderStockLookup();
    renderHistoryLogs();
    renderOrderLogs(); // This will also call renderPickList()
  } catch (err) {
    console.error("Pick complete error:", err);
    showToast("출고 완료 처리 실패: " + err.message, "danger");
  }
}

async function updateOrderStatus(index, newStatus) {
  if (!isAdminUser) return;
  const order = orderLogs[index];
  if (!order) return;

  order.status = newStatus;
  order.date = new Date().toISOString().split("T")[0]; // 날짜 자동 업데이트

  if (supabaseClient && order.id) {
    try {
      await supabaseClient
        .from("order_requests")
        .update({ status: newStatus, date: order.date })
        .eq("id", order.id);
    } catch (err) {
      console.warn("Supabase update error:", err);
    }
  }

  try {
    localStorage.setItem("warehouse_order_logs", JSON.stringify(orderLogs));
  } catch (err) {}

  showToast(`상태가 '${newStatus}'(으)로 변경되었습니다.`, "success", null, true);
  renderOrderLogs();
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
  showToast("관리자 권한으로 오더 요청 엑셀 파일(.xlsx) 추출을 완료했습니다!", "success", null, true);
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

  const stockList = [];
  stockMap.forEach(item => {
    const matchedMaster = masterCatalog.find(m => m.artNo === item.artNo);
    if (!item.hfb) {
      item.hfb = matchedMaster ? matchedMaster.hfb || "미지정" : "미지정";
    }
    item.location = matchedMaster ? matchedMaster.location || "지정 안됨" : "지정 안됨";
    stockList.push(item);
  });

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
    
    const cardClass = isOut ? "simple-stock-card out" : isLow ? "simple-stock-card low" : "simple-stock-card";
    const statusText = isOut ? "품절" : isLow ? "부족" : "안전";
    const statusClass = isOut ? "status-out" : isLow ? "status-low" : "status-good";

    return `
      <div class="${cardClass}" id="stock-card-${item.artNo.replace(/[^a-zA-Z0-9]/g, '-')}">
        <div class="ssc-left">
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div class="ssc-artno" style="display:flex; align-items:center; gap:8px;">
              <input type="checkbox" class="bulk-check-input" value="${item.artNo}" style="transform: scale(1.3); accent-color: #2563eb;" onchange="toggleBulkSelection('${item.artNo}', this.checked)" ${selectedStockItems.has(item.artNo) ? 'checked' : ''}>
              <span class="hfb-badge">${item.hfb}</span>
              ${item.artNo}
            </div>
            <div class="ssc-quick-btns">
              <button type="button" class="btn-sm btn-quick-in" onclick="quickActionRegister('${item.artNo}', '입고')">입고</button>
              <button type="button" class="btn-sm btn-quick-out" onclick="quickActionRegister('${item.artNo}', '출고')">출고</button>
              <button type="button" class="btn-sm btn-quick-order" onclick="quickActionOrder('${item.artNo}')">오더</button>
              <span class="btn-sm" style="background:#f1f5f9; color:#475569; border:none; padding:4px 8px; border-radius:4px;">
                <i class="fa-solid fa-location-dot"></i> ${item.location === '지정 안됨' ? '위치 미지정' : item.location}
              </span>
            </div>
          </div>
          <span class="ssc-name">${item.artName}</span>
        </div>
        <div class="ssc-right">
          <span class="ssc-status ${statusClass}">${statusText}</span>
          <div class="ssc-qty">
            <span class="ssc-num ${isOut ? 'text-danger' : isLow ? 'text-warning' : 'text-primary'}">${item.currentStock}</span>
            <span class="ssc-unit">개</span>
          </div>
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

// --- Bulk Location Edit Logic ---
function toggleBulkSelection(artNo, isChecked) {
  if (isChecked) {
    selectedStockItems.add(artNo);
  } else {
    selectedStockItems.delete(artNo);
  }
  updateBulkActionBar();
}

function updateBulkActionBar() {
  const bar = document.getElementById("bulk-action-bar");
  const countSpan = document.getElementById("bulk-count");
  if (!bar || !countSpan) return;

  if (selectedStockItems.size > 0) {
    countSpan.textContent = selectedStockItems.size;
    bar.style.display = "flex";
  } else {
    bar.style.display = "none";
  }
}

function clearBulkSelection() {
  selectedStockItems.clear();
  updateBulkActionBar();
  
  // Uncheck all checkboxes visually
  document.querySelectorAll(".bulk-check-input").forEach(cb => cb.checked = false);
}

function openBulkLocationModal() {
  const countSpan = document.getElementById("bulk-loc-count");
  if (countSpan) countSpan.textContent = selectedStockItems.size;
  
  // Reset checkboxes
  document.querySelectorAll("#bulk-loc-checkboxes input[type='checkbox']").forEach(cb => cb.checked = false);
  
  document.getElementById("bulk-loc-modal").classList.add("active");
}

function closeBulkLocationModal() {
  document.getElementById("bulk-loc-modal").classList.remove("active");
}

function saveBulkLocation() {
  if (selectedStockItems.size === 0) return;
  
  const checkboxes = document.querySelectorAll("#bulk-loc-checkboxes input[type='checkbox']:checked");
  let selected = [];
  checkboxes.forEach(cb => selected.push(cb.value));
  const newLocation = selected.length > 0 ? selected.join(', ') : '지정 안됨';
  
  selectedStockItems.forEach(artNo => {
    let item = masterCatalog.find(m => m.artNo === artNo);
    if (item) {
      item.location = newLocation;
    } else {
      item = { artNo: artNo, artName: "Unknown", location: newLocation };
      masterCatalog.push(item);
    }
  });
  
  saveMasterCatalog();
  
  if (supabaseClient) {
    const updatePromises = [];
    selectedStockItems.forEach(artNo => {
      const promise = supabaseClient.from('master_catalog')
        .update({ location: newLocation })
        .or(`artno.eq.${artNo},artNo.eq.${artNo}`);
      updatePromises.push(promise);
    });
    
    // 모달창 내 버튼 텍스트 변경 (저장 중 표시)
    const btnSubmit = document.querySelector("#bulk-loc-modal .btn-submit");
    if (btnSubmit) {
      btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 저장 중...';
      btnSubmit.disabled = true;
    }

    Promise.all(updatePromises).then(results => {
      results.forEach(({error}) => {
        if (error) console.error("Supabase bulk location update error:", error);
      });
      
      const count = selectedStockItems.size;
      closeBulkLocationModal();
      clearBulkSelection();
      
      if (btnSubmit) {
        btnSubmit.innerHTML = '변경사항 저장';
        btnSubmit.disabled = false;
      }
      
      showToast(`선택한 ${count}개 품목의 위치가 [${newLocation}](으)로 일괄 변경되었습니다.`, "success", null, true);
    });
  } else {
    const count = selectedStockItems.size;
    closeBulkLocationModal();
    clearBulkSelection();
    showToast(`선택한 ${count}개 품목의 위치가 [${newLocation}](으)로 일괄 변경되었습니다.`, "success", null, true);
  }
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
  showToast(`'${artNo}' 품목 [${type}] 등록 화면으로 이동했습니다.`, "success", null, true);
}

function quickActionOrder(artNo) {
  const orderArtNoElem = document.getElementById("order-artno");
  if (orderArtNoElem) orderArtNoElem.value = artNo;
  
  onOrderArtNoInput(artNo);

  const orderNavBtn = document.querySelectorAll(".bottom-nav .nav-item")[2];
  switchTab("order", orderNavBtn);
  showToast(`'${artNo}' 품목 오더 요청 화면으로 이동했습니다.`, "success", null, true);
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

  const isDefaultFilter = !startDate && !endDate && typeFilter === "ALL" && articleFilter === "ALL";

  if (!isDefaultFilter) {
    filteredLogs = historyLogs.filter(log => {
      if (startDate && log.date < startDate) return false;
      if (endDate && log.date > endDate) return false;
      if (typeFilter !== "ALL" && log.type !== typeFilter) return false;
      if (articleFilter !== "ALL" && log.artNo !== articleFilter) return false;
      return true;
    });
  } else if (historyDisplayLimit === RENDER_LIMIT) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    filteredLogs = historyLogs.filter(log => log.date >= yesterdayStr);
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

  let html = visibleLogs.map((log) => {
    let displayTime = log.date;
    if (log.created_at) {
      const d = new Date(log.created_at);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      displayTime = `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    }

    let deleteBtnHtml = '';
    if (isAdminUser || log.user === currentUser) {
      deleteBtnHtml = `<button type="button" class="btn-delete-log" onclick="deleteHistoryLog(${log.id})"><i class="fa-solid fa-trash-can"></i> 삭제</button>`;
    }

    return `
    <div class="history-item type-${log.type}">
      <div class="hist-left">
        <span class="hist-date"><i class="fa-regular fa-clock"></i> ${displayTime} ${log.user ? '· ' + log.user : ''}</span>
        <div class="hist-name">${log.artName}</div>
        <span class="hist-artno">번호: ${log.artNo}</span>
      </div>
      <div class="hist-right" style="align-items:flex-end;">
        <span class="hist-badge type-${log.type}">${log.type}</span>
        <div class="hist-qty ${log.type === '입고' ? 'text-in' : 'text-out'}" style="margin-top:4px; font-weight:bold;">
          ${log.type === '입고' ? '+' : '-'}${log.qty}개
        </div>
        ${deleteBtnHtml}
      </div>
    </div>
    `;
  }).join("");

  const totalCount = isDefaultFilter && historyDisplayLimit === RENDER_LIMIT ? historyLogs.length : filteredLogs.length;
  if (totalCount > visibleLogs.length) {
    html += `
      <button type="button" class="btn-secondary" style="width:100%; margin-top:10px; padding:12px;" onclick="loadMoreHistoryLogs()">
        이전 기록 더보기 (${visibleLogs.length} / ${totalCount})
      </button>
    `;
  }

  container.innerHTML = html;
}

function loadMoreHistoryLogs() {
  historyDisplayLimit += RENDER_LIMIT;
  renderHistoryLogs();
}

async function deleteHistoryLog(logId) {
  const logIndex = historyLogs.findIndex(l => l.id === logId);
  if (logIndex === -1) return;
  const log = historyLogs[logIndex];
  
  if (!confirm(`'${log.artName}' (${log.type} ${log.qty}개) 기록을 정말 삭제하시겠습니까?`)) return;
  
  if (supabaseClient && log.id) {
    try {
      const { error } = await supabaseClient
        .from('inventory_logs')
        .delete()
        .eq('id', log.id);
        
      if (error) throw error;
    } catch (err) {
      console.warn("Supabase delete error:", err);
      showToast("기록 삭제 실패: " + err.message, "danger");
      return;
    }
  }
  
  historyLogs.splice(logIndex, 1);
  try {
    localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
  } catch (err) {}
  
  invalidateStockCache();
  
  showToast("입출고 기록이 삭제되었습니다.", "success", null, true);
  renderHistoryLogs();
  
  try {
    const activeTab = document.querySelector('.tab-page.active');
    if (activeTab && activeTab.id === 'tab-stock') {
      renderStockLookup();
    }
  } catch(e) {}
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
              const existingItem = masterCatalog.find(m => m.artNo === artNo);
              const location = existingItem && existingItem.location ? existingItem.location : "지정 안됨";
              const id = existingItem ? existingItem.id : undefined;
              
              const catalogItem = { hfb, artNo, artName, location };
              if (id) catalogItem.id = id;
              
              newCatalog.push(catalogItem);
            }
          }
        }

        if (newCatalog.length > 0) {
          masterCatalog = newCatalog;
          saveMasterCatalog();
          
          if (supabaseClient) {
            const upsertPayload = newCatalog.map(item => {
              const row = {
                artno: item.artNo,
                artname: item.artName,
                hfb: item.hfb,
                location: item.location
              };
              if (item.id) row.id = item.id;
              return row;
            });
            
            // Upsert in chunks of 500 to avoid payload limits
            const chunkSize = 500;
            for (let i = 0; i < upsertPayload.length; i += chunkSize) {
              const chunk = upsertPayload.slice(i, i + chunkSize);
              supabaseClient.from('master_catalog').upsert(chunk, { onConflict: 'artno' })
                .then(({error}) => {
                  if (error) console.error("Supabase Excel upsert error:", error);
                });
            }
          }
          
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

  const newItem = { hfb, artNo, artName, location: "지정 안됨" };
  masterCatalog.push(newItem);
  saveMasterCatalog();
  
  if (supabaseClient) {
    supabaseClient.from('master_catalog').insert([{
      hfb: hfb,
      artno: artNo,
      artname: artName,
      location: "지정 안됨"
    }]).then(({error}) => {
      if (error) console.error("Supabase insert master error:", error);
    });
  }
  renderMasterCatalog();
  populateArticleFilterDropdown();
  closeAddMasterModal();

  showToast(`신규 품목 '${artName}'이(가) 추가되었습니다.`, "success");
  document.getElementById("add-master-form").reset();
}

// Toast Utility
function showToast(message, type = "success", undoId = null, requireRefresh = false) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast-msg ${type}`;
  
  if (undoId) {
    toast.classList.add("toast-long");
    toast.innerHTML = `
      <div style="flex:1; text-align:left;">${message}</div>
      <button type="button" class="toast-action-btn" onclick="undoLastAction(${undoId}, this.parentElement)">실행 취소</button>
    `;
  } else {
    toast.innerHTML = message;
  }

  container.appendChild(toast);

  if (requireRefresh) {
    if (navigator.vibrate) {
      navigator.vibrate([150, 50, 150]);
    }
    setTimeout(() => {
      // Soft refresh: fetch data quietly and re-render the current tab
      loadDataFromSupabase().then(() => {
        if (currentTab) switchTab(currentTab);
      });
    }, 1200);
  }

  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, undoId ? 5000 : 1500);
}

// Undo Last Action (Inventory Logs)
window.undoLastAction = async function(id, toastElem) {
  if (toastElem) toastElem.remove();
  
  const tempToast = document.createElement("div");
  tempToast.className = "toast-msg success";
  tempToast.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 취소 처리 중...';
  const container = document.getElementById("toast-container");
  if (container) container.appendChild(tempToast);

  if (supabaseClient) {
    const { error } = await supabaseClient.from("inventory_logs").delete().eq("id", id);
    if (error) {
      if (tempToast.parentNode) tempToast.parentNode.removeChild(tempToast);
      showToast("취소 실패: " + error.message, "danger");
      return;
    }
  }

  historyLogs = historyLogs.filter(log => log.id !== id);
  try {
    localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
  } catch (err) {}
  
  invalidateStockCache();
  renderStockLookup();
  
  if (currentTab === "history") {
    renderHistoryLogs();
  }

  if (tempToast.parentNode) tempToast.parentNode.removeChild(tempToast);
  showToast("해당 기록이 취소되었습니다.", "success", null, true);
}

// --- Supabase Realtime Subscriptions ---
function initRealtimeSubscriptions() {
  if (!supabaseClient) return;

  supabaseClient
    .channel('public:inventory_logs')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_logs' }, payload => {
      handleRealtimeInventory(payload);
    })
    .subscribe();

  supabaseClient
    .channel('public:order_requests')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_requests' }, payload => {
      handleRealtimeOrder(payload);
    })
    .subscribe();
}

function handleRealtimeInventory(payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  
  if (eventType === 'INSERT') {
    const exists = historyLogs.some(log => log.id === newRecord.id);
    if (!exists) {
      const mappedArtNo = newRecord.artno || newRecord.artNo || "";
      historyLogs.unshift({
        ...newRecord,
        artNo: mappedArtNo,
        artName: newRecord.artname || newRecord.artName || masterCatalogMap.get(mappedArtNo) || "알 수 없는 품목"
      });
      historyLogs.sort((a, b) => b.id - a.id);
    }
  } else if (eventType === 'DELETE') {
    historyLogs = historyLogs.filter(log => log.id !== oldRecord.id);
  }
  
  invalidateStockCache();
  try {
    if (currentTab === 'stock') renderStockLookup();
    if (currentTab === 'history') renderHistoryLogs();
  } catch (e) {}
}

function handleRealtimeOrder(payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  
  if (eventType === 'INSERT') {
    const exists = orderLogs.some(log => log.id === newRecord.id);
    if (!exists) {
      orderLogs.unshift({
        ...newRecord,
        artNo: newRecord.artno || newRecord.artNo || "",
        artName: newRecord.artname || newRecord.artName || ""
      });
      orderLogs.sort((a, b) => b.id - a.id);
      
      // === 🔔 관리자에게 새 오더 요청 알람 ===
      if (isAdminUser && newRecord.user !== currentUser) {
        showAlarmNotification(`🔔 [새 오더 요청] ${newRecord.user}님이 '${newRecord.artname || newRecord.artName}' 품목을 요청했습니다.`, "success");
      }
    }
  } else if (eventType === 'UPDATE') {
    const idx = orderLogs.findIndex(log => log.id === newRecord.id);
    if (idx !== -1) {
      // 기존 상태 저장
      const oldStatus = orderLogs[idx].status || '요청됨';
      const newStatus = newRecord.status;

      // 데이터 업데이트
      orderLogs[idx] = {
        ...orderLogs[idx],
        ...newRecord,
        artNo: newRecord.artno || newRecord.artNo || "",
        artName: newRecord.artname || newRecord.artName || ""
      };

      // === 🔔 요청자에게 상태 변경 알람 로직 ===
      if (oldStatus !== newStatus && orderLogs[idx].user === currentUser) {
        if (newStatus === '수락') {
          showAlarmNotification(`✅ [오더 수락] '${orderLogs[idx].artName}' 요청이 수락되었습니다!`, "success");
        } else if (newStatus === '보류') {
          showAlarmNotification(`🚨 [오더 보류] '${orderLogs[idx].artName}' 요청이 보류되었습니다. 담당자에게 문의하세요.`, "danger");
        }
      }
    }
  } else if (eventType === 'DELETE') {
    orderLogs = orderLogs.filter(log => log.id !== oldRecord.id);
  }

  try {
    const activeTab = document.querySelector('.tab-page.active');
    if (activeTab && (activeTab.id === 'tab-order' || activeTab.id === 'tab-picklist')) {
      renderOrderLogs();
    }
  } catch (e) {}
}

// 🔔 오더 처리 및 요청 전용 알람 함수
function showAlarmNotification(message, type) {
  // 모바일 푸시/진동 및 소리
  playSuccessFeedback();
  
  // 브라우저 네이티브 알림 (허용된 경우)
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("세일즈 창고 오더 알림", { body: message });
  }

  // 화면 토스트 팝업 띄우기
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast-msg ${type} toast-long`; // toast-long 클래스로 오래 표시
  toast.style.border = type === 'success' ? '2px solid #059669' : '2px solid #dc2626';
  toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';
  toast.innerHTML = `<div style="flex:1; text-align:left; font-size: 14px; font-weight:800;">${message}</div>`;
  
  container.appendChild(toast);

  // 5초 후 사라짐
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 5000);
}

// --- Haptic & Audio Feedback ---
function playSuccessFeedback() {
  if (navigator.vibrate) {
    navigator.vibrate(50); // 50ms 짧은 진동 (모바일용)
  }
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note (경쾌한 소리)
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);
    }
  } catch (e) {
    console.warn("Audio playback failed:", e);
  }
}
