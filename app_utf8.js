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
  { hfb: "HFB 01 Living", artNo: "70582028", artName: "EKET ?먯???硫?곕??붿뼱?좊컲 70x35x35 ?붿씠??AP" },
  { hfb: "HFB 01 Living", artNo: "90513393", artName: "KUGGIS 荑좉린???섎궔?곸옄 18x26x8 ?붿씠?? },
  { hfb: "HFB 02 Bedding", artNo: "20351884", artName: "KALLAX 罹섎씫???좊컲?좊떅 77x147 ?붿씠??AP" },
  { hfb: "HFB 03 Children", artNo: "30279944", artName: "ANTILOP ?좎븘?⑹떇?곸쓽???쒗듃 AP Sales" },
  { hfb: "HFB 01 Living", artNo: "10501548", artName: "LACK ?됱꽭 ?좊컲?좊떅 92x76 洹몃젅???ㅼ쇅?? },
  { hfb: "HFB 02 Bedding", artNo: "70483882", artName: "BAGGEBO 諛붽쾶蹂??꾩뼱?섎궔??50x30x80" },
  { hfb: "HFB 04 Workspace", artNo: "40354283", artName: "MICKE ?대룞?앹꽌?띿쑀 35x75 ?붿씠??AP" },
  { hfb: "HFB 05 Clothes", artNo: "30231631", artName: "RIGGA ?됯굅 ?붿씠??AP CN" },
  { hfb: "HFB 01 Living", artNo: "40308700", artName: "TROFAST N ?좊컲 30 ?쇱씠?명솕?댄듃?ㅻ뜲?? }
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
  try {
    await loadDataFromSupabase();
    initRealtimeSubscriptions();
  } catch (err) {
    console.warn("Data load error during init:", err);
  }

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
  const sessionUser = currentUser; // Only use memory, NOT localStorage
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
      if (navHistoryBtn) navHistoryBtn.style.display = "flex";
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
    showToast("?꾩씠?붾? ?낅젰??二쇱꽭??", "danger");
    return;
  }

  const matchedId = ALLOWED_USER_IDS.find(id => id.toLowerCase() === rawInputId);

  if (!matchedId) {
    showToast(`'${rawInputId}'?(?? ?덉슜?섏? ?딆? ?꾩씠?붿엯?덈떎. (?덉슜: junkoo, guest1 ??`, "danger");
    return;
  }

  const storedPw = userPasswords[matchedId] || INITIAL_PASSWORD;

  if (inputPw !== storedPw) {
    showToast(`鍮꾨?踰덊샇媛 ?щ컮瑜댁? ?딆뒿?덈떎. (湲곕낯 鍮꾨?踰덊샇: ${INITIAL_PASSWORD})`, "danger");
    return;
  }

  currentUser = matchedId;
  isAdminUser = ADMIN_USERS.includes(matchedId);

  const roleTitle = isAdminUser ? "?몣 愿由ъ옄" : "?쇰컲 ?ъ슜??;
  showToast(`?〓룄 CMP! 留밸━!<br>?ш퀬 ?뺥솗?꾨뒗 ?곕━ 紐⑤몢 ?④퍡!`, "success");

  const loginOverlay = document.getElementById("login-overlay");
  if (loginOverlay) {
    loginOverlay.classList.remove("active");
    loginOverlay.style.display = "none";
    loginOverlay.style.visibility = "hidden";
    loginOverlay.style.opacity = "0";
    loginOverlay.style.pointerEvents = "none";
  }

  // --- 釉뚮씪?곗? ?뚮┝(Push) 沅뚰븳 ?붿껌 ---
  if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
    Notification.requestPermission();
  }

  checkLoginSession();
}

function handleLogout() {
  currentUser = null;
  isAdminUser = false;
  showToast("濡쒓렇?꾩썐 ?섏뿀?듬땲??", "success");
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
    showToast("?꾩씠?붾? ?좏깮??二쇱꽭??", "danger");
    return;
  }

  const currentPw = userPasswords[selectId] || INITIAL_PASSWORD;

  if (oldPw !== currentPw) {
    showToast("?꾩옱 鍮꾨?踰덊샇媛 ?쇱튂?섏? ?딆뒿?덈떎.", "danger");
    return;
  }

  if (!newPw) {
    showToast("??鍮꾨?踰덊샇瑜??낅젰??二쇱꽭??", "danger");
    return;
  }

  userPasswords[selectId] = newPw;
  saveUserPasswords();
  closeResetPasswordModal();

  showToast(`'${selectId}'??鍮꾨?踰덊샇媛 ?깃났?곸쑝濡?蹂寃쎈릺?덉뒿?덈떎!`, "success");
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
            artName: row.artname || row.artName || masterCatalogMap.get(mappedArtNo) || "?????녿뒗 ?덈ぉ"
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
            artName: row.artname || row.artName || masterCatalogMap.get(mappedArtNo) || "?????녿뒗 ?덈ぉ"
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
      const savedMfaq = localStorage.getItem("warehouse_mfaq_logs");
      mfaqLogs = savedMfaq ? JSON.parse(savedMfaq) : [];
    }
  } else {
    const savedCatalog = localStorage.getItem("warehouse_master_catalog");
    masterCatalog = savedCatalog ? JSON.parse(savedCatalog) : [...defaultMasterCatalog];
    const savedHistory = localStorage.getItem("warehouse_history_logs");
    historyLogs = savedHistory ? JSON.parse(savedHistory) : [...defaultHistoryLogs];
    const savedOrders = localStorage.getItem("warehouse_order_logs");
    orderLogs = savedOrders ? JSON.parse(savedOrders) : [...defaultOrderLogs];
    const savedMfaq = localStorage.getItem("warehouse_mfaq_logs");
    mfaqLogs = savedMfaq ? JSON.parse(savedMfaq) : [];
  }

  rebuildMasterCatalogMap();
  invalidateStockCache();
  updateMfaqBadge();
}

function saveMasterCatalog() {
  try {
    localStorage.setItem("warehouse_master_catalog", JSON.stringify(masterCatalog));
  } catch (err) {
    showToast("濡쒖뺄 ?ㅽ넗由ъ??⑸웾??遺€議깊븯??留덉뒪???곗씠???€?μ뿉 ?ㅽ뙣?덉뒿?덈떎.", "danger");
  }
  rebuildMasterCatalogMap();
}

async function saveHistoryLogs(log) {
  let insertedId = null;
  if (supabaseClient) {
    try {
      const dbLog = { ...log };
      delete dbLog.timestamp; // Remove timestamp as it causes schema error
      delete dbLog.artName;
      delete dbLog.artname;
      
      const { data, error } = await supabaseClient
        .from("inventory_logs")
        .insert([dbLog])
        .select();
      if (!error && data && data.length > 0) {
        insertedId = data[0].id;
        log.id = insertedId;
        log.created_at = data[0].created_at;
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

function saveMfaqLogs() {
  try {
    localStorage.setItem("warehouse_mfaq_logs", JSON.stringify(mfaqLogs));
  } catch (err) {}
}

async function incrementMfaqCount(mfaqId) {
  const mfaq = mfaqLogs.find(l => l.id === mfaqId);
  if (!mfaq) return;
  
  mfaq.count += 1;
  mfaq.lastUpdated = new Date().toISOString();
  
  if (supabaseClient) {
    await supabaseClient
      .from("mfaq_logs")
      .update({ count: mfaq.count, last_updated: mfaq.lastUpdated })
      .eq("id", mfaqId);
  }
  saveMfaqLogs();
  renderMfaq();
}

function updateMfaqBadge() {
  const badge = document.getElementById("badge-mfaq");
  if (!badge) return;
  const todayStr = new Date().toISOString().split("T")[0];
  const newCount = mfaqLogs.filter(log => {
    if (!log.createdAt) return false;
    return log.createdAt.startsWith(todayStr);
  }).length;

  if (newCount > 0) {
    badge.textContent = newCount;
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
}

async function handleAddMfaqSubmit(event) {
  event.preventDefault();
  const category = document.getElementById("mfaq-new-category").value;
  const question = document.getElementById("mfaq-new-question").value.trim();
  if (!question) return;

  const existing = mfaqLogs.find(l => l.question === question && l.category === category);
  if (existing) {
    existing.count += 1;
    existing.lastUpdated = new Date().toISOString();
    showToast("이미 존재하는 항목입니다. 건수가 +1 증가했습니다.", "success");
    
    if (supabaseClient) {
      await supabaseClient
        .from("mfaq_logs")
        .update({ count: existing.count, last_updated: existing.lastUpdated })
        .eq("id", existing.id);
    }
  } else {
    const newLog = {
      id: "mfaq_" + Date.now() + "_" + Math.floor(Math.random()*1000),
      category: category,
      question: question,
      count: 1,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
    mfaqLogs.push(newLog);
    showToast("새 질문/요청이 등록되었습니다.", "success");
    
    if (supabaseClient) {
      await supabaseClient
        .from("mfaq_logs")
        .insert([{
          id: newLog.id,
          category: newLog.category,
          question: newLog.question,
          count: newLog.count,
          created_at: newLog.createdAt,
          last_updated: newLog.lastUpdated
        }]);
    }
  }
  saveMfaqLogs();
  updateMfaqBadge();
  closeMfaqModal();
  renderMfaq();
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
  if (tabId === "master" && !isAdminUser) {
    showToast("?대떦 硫붾돱??愿€由ъ옄(jipar5, hycho30, junkoo, minjong)留??묎렐?????덉뒿?덈떎.", "danger");
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

// Type Toggle (?낃퀬/異쒓퀬)
function updateTypeToggle() {
  const checkedOption = document.querySelector('input[name="reg-type"]:checked');
  if (!checkedOption) return;

  const selectedType = checkedOption.value;
  const labelIn = document.getElementById("label-type-in");
  const labelOut = document.getElementById("label-type-out");

  if (selectedType === "?낃퀬") {
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
  const dropdownId = target === "order" ? "order-autocomplete-dropdown" : target === "ptag" ? "ptag-autocomplete-dropdown" : "reg-autocomplete-dropdown";
  const nameDropdownId = target === "order" ? "order-name-autocomplete-dropdown" : target === "ptag" ? "ptag-name-autocomplete-dropdown" : "reg-name-autocomplete-dropdown";
  
  const dropdown = document.getElementById(dropdownId);
  const nameDropdown = document.getElementById(nameDropdownId);
  if (nameDropdown) nameDropdown.classList.remove("active");

  if (target === "order") onOrderArtNoInput(query);
  else if (target === "ptag") onPtagArtNoInput(query);
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
  const dropdownId = target === "order" ? "order-name-autocomplete-dropdown" : target === "ptag" ? "ptag-name-autocomplete-dropdown" : "reg-name-autocomplete-dropdown";
  const artnoDropdownId = target === "order" ? "order-autocomplete-dropdown" : target === "ptag" ? "ptag-autocomplete-dropdown" : "reg-autocomplete-dropdown";

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
  } else if (target === "ptag") {
    const artNoInput = document.getElementById("ptag-artno");
    if (artNoInput) artNoInput.value = artNo;
    onPtagArtNoInput(artNo);
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
    stockPreview.textContent = "- 媛?;
    icon.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
    return;
  }

  const artNameMatch = masterCatalogMap.get(cleanNo);

  if (artNameMatch) {
    artNameInput.value = artNameMatch;
    icon.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #059669;"></i>';
    
    const currentStock = getItemStock(cleanNo);
    stockPreview.textContent = `${currentStock} 媛?;
    stockPreview.style.color = currentStock > 0 ? "#059669" : "#dc2626";
  } else {
    icon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: #d97706;"></i>';
    const currentStock = getItemStock(cleanNo);
    stockPreview.textContent = `${currentStock} 媛?;
    stockPreview.style.color = currentStock > 0 ? "#059669" : "#64748b";
  }
}

function getPendingPickQty(artNo) {
  return orderLogs
    .filter(log => log.artNo === artNo && log.status === "異쒓퀬?€湲?)
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
    if (stockPreview) stockPreview.textContent = "- 媛?;
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
            <div>珥??ш퀬: ${currentStock}媛?/div>
            <div style="color:#b45309;">(異쒓퀬 ?€湲? -${pendingQty}媛?</div>
            <div style="font-size:16px; color:${availableStock > 0 ? '#059669' : '#dc2626'};">媛€???섎웾: ${availableStock}媛?/div>
          </div>
        `;
      } else {
        stockPreview.textContent = `${availableStock} 媛?;
        stockPreview.style.color = availableStock > 0 ? "#059669" : "#dc2626";
      }
    }
    
    if (availableStock > 0) {
      showToast(`媛€???ш퀬媛€ ${availableStock}媛??덉뒿?덈떎! 梨숆만 紐⑸줉??諛붾줈 ?댁쓣 ???덉뒿?덈떎.`, "success");
      if (takeFromStockBtn) takeFromStockBtn.style.display = 'flex';
    } else {
      if (takeFromStockBtn) takeFromStockBtn.style.display = 'none';
    }
  } else {
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: #d97706;"></i>';
    if (stockPreview) {
      stockPreview.textContent = `${availableStock} 媛?;
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
    if (log.type === "?낃퀬") entry.totalIn += qty;
    if (log.type === "異쒓퀬") entry.totalOut += qty;
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
  const type = typeOption ? typeOption.value : "?낃퀬";
  const artNo = document.getElementById("reg-artno").value.trim();
  const artName = document.getElementById("reg-artname").value.trim();
  const qty = Number(document.getElementById("reg-qty").value);

  if (!artNo || !qty || qty <= 0) {
    showToast("?꾪떚??踰덊샇?€ ?섎웾???щ컮瑜닿쾶 ?낅젰?댁＜?몄슂.", "danger");
    return;
  }

  regCartList.push({ date, type, artNo, artName: artName || "湲고? ?덈ぉ", qty });
  renderRegCart();
  
  document.getElementById("reg-artno").value = "";
  document.getElementById("reg-artname").value = "";
  document.getElementById("reg-qty").value = "";
  document.getElementById("reg-current-stock").textContent = "- 媛?;
  document.getElementById("reg-artno").focus();
}

function handleSingleRegSave() {
  const artNo = document.getElementById("reg-artno").value.trim();
  const qty = Number(document.getElementById("reg-qty").value);
  
  if (!artNo || !qty || qty <= 0) {
    showToast("?꾪떚??踰덊샇?€ ?섎웾???щ컮瑜닿쾶 ?낅젰?댁＜?몄슂.", "danger");
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
          <span class="cart-item-qty">${item.qty}媛?/span>
          <button type="button" class="btn-remove-cart" onclick="removeRegCart(${idx})"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
    `;
  });
  html += `<div class="cart-summary"><span>珥??닿릿 ??ぉ</span><span style="color:#2563eb">${regCartList.length}嫄?/span></div>`;
  container.innerHTML = html;
}

function removeRegCart(idx) {
  regCartList.splice(idx, 1);
  renderRegCart();
}

async function processRegCart() {
  if (regCartList.length === 0) return;
  
  const originalBtnText = document.getElementById("btn-save").innerHTML;
  document.getElementById("btn-save").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ?€??以?..`;
  document.getElementById("btn-save").disabled = true;

  try {
    const { data, error } = await supabaseClient
      .from('inventory_logs')
      .insert(regCartList.map(item => ({
        date: item.date,
        type: item.type,
        artNo: item.artNo,
        qty: item.qty,
        user: currentUser || "system"
      })))
      .select();

    if (error) throw error;
    
    if (data) {
      data.forEach(inserted => {
        const localLog = {
          ...inserted,
          artNo: inserted.artno || inserted.artNo,
          artName: inserted.artname || inserted.artName
        };
        historyLogs.unshift(localLog);
        if (!masterCatalogMap.has(localLog.artNo)) {
          masterCatalog.push({ artNo: localLog.artNo, artName: localLog.artName || "?좉퇋 ?덈ぉ" });
          saveMasterCatalog();
        }
      });
      populateArticleFilterDropdown();
    }
    
    invalidateStockCache();
    renderStockLookup();
    renderHistoryLogs();
    
    showToast(`珥?${regCartList.length}嫄댁쓽 ??ぉ???쇨큵 ?€?λ릺?덉뒿?덈떎!`, "success");
    playSuccessFeedback();
    
    regCartList = [];
    renderRegCart();
    initFormDate();
  } catch (err) {
    console.error("Supabase insert error:", err);
    showToast("?쇨큵 ?€???ㅽ뙣: " + err.message, "danger");
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
    showToast("?꾪떚??踰덊샇?€ ?섎웾???щ컮瑜닿쾶 ?낅젰?댁＜?몄슂.", "danger");
    return;
  }

  const currentStock = getItemStock(artNo);
  const pendingQty = getPendingPickQty(artNo);
  const availableStock = currentStock - pendingQty;
  if (qty > availableStock) {
    showToast(`媛€???ш퀬(${availableStock}媛?蹂대떎 梨숆만 ?섎웾??留롮뒿?덈떎. ?섎웾??議곗젙?댁＜?몄슂.`, "danger");
    return;
  }

  const newPick = {
    date: date,
    artNo: artNo,
    artName: artName || "湲고? ?덈ぉ",
    qty: qty,
    user: currentUser || "guest1",
    status: "異쒓퀬?€湲?
  };

  try {
    const originalBtnText = document.getElementById("btn-take-from-stock").innerHTML;
    document.getElementById("btn-take-from-stock").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ?€??以?..`;
    document.getElementById("btn-take-from-stock").disabled = true;

    await saveOrderLogs(newPick);

    orderLogs.unshift(newPick);

    showToast(`'${artName}' ${qty}媛쒓? 李쎄퀬 梨숆린湲?紐⑸줉???닿꼈?듬땲??`, "success");
    playSuccessFeedback();

    // Reset form
    document.getElementById("order-artno").value = "";
    document.getElementById("order-artname").value = "";
    document.getElementById("order-qty").value = "";
    const takeFromStockBtn = document.getElementById("btn-take-from-stock");
    if (takeFromStockBtn) takeFromStockBtn.style.display = 'none';
    document.getElementById("order-current-stock").textContent = "- 媛?;

    initFormDate(); // ?좎쭨 ?먮룞 ?낅뜲?댄듃

    renderOrderLogs();
    
    document.getElementById("btn-take-from-stock").innerHTML = originalBtnText;
    document.getElementById("btn-take-from-stock").disabled = false;
  } catch (err) {
    console.error("Supabase insert error:", err);
    showToast("梨숆린湲?紐⑸줉 ?€???ㅽ뙣: " + err.message, "danger");
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
    showToast("?꾪떚??踰덊샇?€ ?섎웾???щ컮瑜닿쾶 ?낅젰?댁＜?몄슂.", "danger");
    return;
  }

  const newOrder = {
    date: date,
    artNo: artNo,
    artName: artName || "湲고? ?덈ぉ",
    qty: qty,
    user: currentUser || "guest1",
    status: "?붿껌??
  };

  try {
    await saveOrderLogs(newOrder);

    orderLogs.unshift(newOrder);

    showToast(`'${artName}' ${qty}媛??ㅻ뜑 ?붿껌???꾨즺?섏뿀?듬땲??`, "success");
    playSuccessFeedback();

    // Reset form
    document.getElementById("order-artno").value = "";
    document.getElementById("order-artname").value = "";
    document.getElementById("order-qty").value = "";
    initFormDate(); // ?좎쭨 ?먮룞 ?낅뜲?댄듃

    renderOrderLogs();
  } catch (err) {
    console.error("Supabase order insert error:", err);
    showToast("?ㅻ뜑 ?€???ㅽ뙣: " + err.message, "danger");
  }
}

function renderOrderLogs() {
  const container = document.getElementById("order-logs-container");
  if (!container) return;

  if (orderLogs.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #94a3b8;">
        <i class="fa-solid fa-cart-shopping" style="font-size: 32px; margin-bottom: 8px;"></i>
        <p>?깅줉???ㅻ뜑 ?붿껌 ?댁뿭???놁뒿?덈떎.</p>
      </div>
    `;
    return;
  }
  container.innerHTML = orderLogs.map((item, index) => {
    const statusText = item.status || '?붿껌??;
    let bgColor = '#e0e7ff';
    let textColor = '#4338ca';
    if (statusText === '?섎씫') { bgColor = '#dcfce7'; textColor = '#166534'; }
    if (statusText === '蹂대쪟') { bgColor = '#fee2e2'; textColor = '#991b1b'; }
    if (statusText === '異쒓퀬?€湲?) { bgColor = '#fef3c7'; textColor = '#b45309'; }
    if (statusText === '異쒓퀬?꾨즺') { bgColor = '#f3f4f6'; textColor = '#4b5563'; }

    let statusHtml = `<span class="hist-badge" style="background-color: ${bgColor}; color: ${textColor};">${statusText}</span>`;
    
    if (isAdminUser) {
      statusHtml = `
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          ${statusHtml}
          <div style="display:flex; gap:4px; margin-top:2px;">
            <button type="button" onclick="updateOrderStatus(${index}, '?섎씫')" style="font-size:10px; padding:2px 8px; border:none; background:#22c55e; color:white; border-radius:4px; cursor:pointer;">?섎씫</button>
            <button type="button" onclick="updateOrderStatus(${index}, '蹂대쪟')" style="font-size:10px; padding:2px 8px; border:none; background:#ef4444; color:white; border-radius:4px; cursor:pointer;">蹂대쪟</button>
          </div>
        </div>
      `;
    }

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

    return `
    <div class="history-item" style="border-left-color: #6366f1;">
      <div class="hist-left">
        <span class="hist-date"><i class="fa-regular fa-clock"></i> ${displayTime} 쨌 ${item.user}</span>
        <div class="hist-name">${item.artName}</div>
        <span class="hist-artno">踰덊샇: ${item.artNo}</span>
      </div>
      <div class="hist-right">
        ${statusHtml}
        <div class="hist-qty" style="color: #4338ca; margin-top:4px;">
          ${item.qty}媛?        </div>
      </div>
    </div>
    `;
  }).join("");
  
  renderPickList();
}

function renderPickList() {
  const container = document.getElementById("picklist-container");
  if (!container) return;

  const pendingPicks = orderLogs.filter(log => log.status === "異쒓퀬?€湲?);

  if (pendingPicks.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #94a3b8;">
        <i class="fa-solid fa-box-open" style="font-size: 32px; margin-bottom: 8px;"></i>
        <p>梨숆꺼?????€湲?紐⑸줉???놁뒿?덈떎.</p>
      </div>
    `;
    return;
  }

  let html = "";
  orderLogs.forEach((item, index) => {
    if (item.status === "異쒓퀬?€湲?) {
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
            <span class="hist-date"><i class="fa-regular fa-clock"></i> ${displayTime} 쨌 ${item.user} ?붿껌</span>
            <div class="hist-name">${item.artName}</div>
            <span class="hist-artno">踰덊샇: ${item.artNo}</span>
          </div>
          <div class="hist-right" style="align-items:flex-end;">
            <div class="hist-qty" style="color: #b45309; font-size: 18px;">${item.qty}媛?/div>
            <button type="button" class="btn-submit" style="background-color: #059669; font-size: 12px; padding: 8px 12px; margin-top: 6px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 4px;" onclick="completePickItem(${index})">
              <i class="fa-solid fa-check"></i> 梨숆? ?꾨즺 (異쒓퀬)
            </button>
          </div>
        </div>
      `;
    }
  });
  container.innerHTML = html;
}

async function completePickItem(index) {
  const pickItem = orderLogs[index];
  if (!pickItem || pickItem.status !== "異쒓퀬?€湲?) return;
  
  if (!confirm(`'${pickItem.artName}' ${pickItem.qty}媛쒕? 李쎄퀬?먯꽌 梨숆꼈?듬땲源?\\n(?뺤씤 ??利됱떆 異쒓퀬 湲곕줉???앹꽦?⑸땲??`)) return;
  
  try {
    // 1. Update order status to 異쒓퀬?꾨즺
    pickItem.status = "異쒓퀬?꾨즺";
    if (supabaseClient && pickItem.id) {
      const { error: updateError } = await supabaseClient
        .from('order_requests')
        .update({ status: '異쒓퀬?꾨즺' })
        .eq('id', pickItem.id);
        
      if (updateError) throw updateError;
    }
    
    // 2. Insert into inventory_logs (actual checkout)
    const newLog = {
      date: new Date().toISOString().split('T')[0],
      type: "異쒓퀬",
      artNo: pickItem.artNo,
      artName: pickItem.artName,
      qty: pickItem.qty,
      user: currentUser || "system"
    };
    
    const insertedId = await saveHistoryLogs(newLog);
    historyLogs.unshift(newLog);
    invalidateStockCache();
    
    showToast(`'${pickItem.artName}' 異쒓퀬媛€ ?꾨즺?섏뿀?듬땲??`, "success", insertedId);
    playSuccessFeedback();
    
    renderStockLookup();
    renderHistoryLogs();
    renderOrderLogs(); // This will also call renderPickList()
  } catch (err) {
    console.error("Pick complete error:", err);
    showToast("異쒓퀬 ?꾨즺 泥섎━ ?ㅽ뙣: " + err.message, "danger");
  }
}

async function updateOrderStatus(index, newStatus) {
  if (!isAdminUser) return;
  const order = orderLogs[index];
  if (!order) return;

  order.status = newStatus;
  order.date = new Date().toISOString().split("T")[0]; // ?좎쭨 ?먮룞 ?낅뜲?댄듃

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

  showToast(`?ㅻ뜑 ?곹깭媛€ '${newStatus}'(??濡?蹂€寃쎈릺?덉뒿?덈떎.`, "success");
  renderOrderLogs();
}

// --- Excel Export Order Requests (ADMIN ONLY) ---
function exportOrdersToExcel() {
  if (!isAdminUser) {
    showToast("?ㅻ뜑 異붿텧 沅뚰븳???놁뒿?덈떎. (愿€由ъ옄 ?꾩슜)", "danger");
    return;
  }

  if (orderLogs.length === 0) {
    showToast("異붿텧???ㅻ뜑 ?붿껌 ?댁뿭???놁뒿?덈떎.", "danger");
    return;
  }

  const exportData = orderLogs.map((item, index) => ({
    "?곕쾲": index + 1,
    "?붿껌 ?좎쭨": item.date,
    "踰덊샇 (ARTNO)": item.artNo,
    "?꾪떚???대쫫": item.artName,
    "?붿껌 ?섎웾": item.qty,
    "?붿껌??: item.user,
    "?곹깭": item.status || "?붿껌??
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "?ㅻ뜑?붿껌");

  const todayStr = new Date().toISOString().split("T")[0];
  XLSX.writeFile(workbook, `?ㅻ뜑_?붿껌_?댁뿭_${todayStr}.xlsx`);
  showToast("愿€由ъ옄 沅뚰븳?쇰줈 ?ㅻ뜑 ?붿껌 ?묒? ?뚯씪(.xlsx) 異붿텧???꾨즺?덉뒿?덈떎!", "success");
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

  let html = '<option value="ALL">紐⑤뱺 HFB 移댄뀒怨좊━</option>';
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
    if (!item.hfb) {
      const matchedMaster = masterCatalog.find(m => m.artNo === item.artNo);
      item.hfb = matchedMaster ? matchedMaster.hfb || "湲고? HFB" : "湲고? HFB";
    }
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

  document.getElementById("stock-count-text").textContent = `${filteredList.length}媛??덈ぉ`;

  if (filteredList.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: #94a3b8; background:#fff; border-radius:14px; border:1px dashed #cbd5e1;">
        <i class="fa-solid fa-box-open" style="font-size: 40px; margin-bottom: 12px; color:#cbd5e1;"></i>
        <p style="font-weight:700; color:#64748b;">議곌굔??留욌뒗 ?ш퀬 ??ぉ???놁뒿?덈떎.</p>
        <button type="button" class="btn-secondary sm" style="margin-top:12px;" onclick="resetStockFilters()">
          <i class="fa-solid fa-rotate-left"></i> ?꾩껜 蹂닿린濡??꾪꽣 珥덇린??        </button>
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
    const statusText = isOut ? "?덉젅" : isLow ? "遺€議? : "?덉쟾";
    const statusClass = isOut ? "status-out" : isLow ? "status-low" : "status-good";

    return `
      <div class="${cardClass}">
        <div class="ssc-left">
          <div style="display:flex; flex-direction:column; gap:8px;">
            <span class="ssc-artno">${item.artNo}</span>
            <div class="ssc-quick-btns">
              <button type="button" class="btn-sm btn-quick-in" onclick="quickActionRegister('${item.artNo}', '?낃퀬')">?낃퀬</button>
              <button type="button" class="btn-sm btn-quick-out" onclick="quickActionRegister('${item.artNo}', '異쒓퀬')">異쒓퀬</button>
              <button type="button" class="btn-sm btn-quick-order" onclick="quickActionOrder('${item.artNo}')">?ㅻ뜑</button>
            </div>
          </div>
          <span class="ssc-name">${item.artName}</span>
          <span class="ssc-hfb">${item.hfb || 'HFB'}</span>
        </div>
        <div class="ssc-right">
          <span class="ssc-status ${statusClass}">${statusText}</span>
          <div class="ssc-qty">
            <span class="ssc-num ${isOut ? 'text-danger' : isLow ? 'text-warning' : 'text-primary'}">${item.currentStock}</span>
            <span class="ssc-unit">媛?/span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  if (filteredList.length > stockDisplayLimit) {
    html += `
      <button type="button" class="btn-secondary" style="width:100%; margin-top:10px; padding:12px; font-weight:700;" onclick="loadMoreStockItems()">
        ?붾낫湲?(${stockDisplayLimit} / ${filteredList.length}媛?
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
    if(badgeView) badgeView.textContent = "寃쎄퀬 TOP 10";
  } else if (type === "hfb") {
    if(btnHfb) btnHfb.classList.add("active");
    if(viewHfb) viewHfb.style.display = "block";
    if(badgeView) badgeView.textContent = "HFB 遺꾪룷";
  }
}

function renderStockDashboard(stockList) {
  const containerHigh = document.getElementById("dash-list-high");
  const containerLow = document.getElementById("dash-list-low");
  const containerHfb = document.getElementById("dash-list-hfb");
  if (!containerHigh || !containerLow) return;

  if (stockList.length === 0) {
    containerHigh.innerHTML = '<p class="dash-empty">?깅줉???ш퀬 ?곗씠?곌? ?놁뒿?덈떎.</p>';
    containerLow.innerHTML = '<p class="dash-empty">?깅줉???ш퀬 ?곗씠?곌? ?놁뒿?덈떎.</p>';
    if (containerHfb) containerHfb.innerHTML = '<p class="dash-empty">?깅줉???ш퀬 ?곗씠?곌? ?놁뒿?덈떎.</p>';
    return;
  }

  // High Stock TOP 10
  const sortedHigh = [...stockList].sort((a, b) => b.currentStock - a.currentStock);
  const topHigh = sortedHigh.slice(0, 10);
  const maxHighVal = topHigh.length > 0 && topHigh[0].currentStock > 0 ? topHigh[0].currentStock : 1;

  containerHigh.innerHTML = topHigh.map((item, idx) => {
    const rank = idx + 1;
    const rankBadgeClass = rank === 1 ? "rank-gold" : rank === 2 ? "rank-silver" : rank === 3 ? "rank-bronze" : "rank-normal";
    const rankIcon = rank === 1 ? '?몣 ' : rank === 2 ? '?쪎 ' : rank === 3 ? '?쪏 ' : '';
    const pct = Math.max(Math.min((item.currentStock / maxHighVal) * 100, 100), 5);

    return `
      <div class="dash-item" onclick="quickActionRegister('${item.artNo}', '異쒓퀬')" title="?대┃ ??異쒓퀬 ?깅줉">
        <div class="dash-item-info">
          <div class="dash-item-left">
            <span class="rank-badge ${rankBadgeClass}">${rankIcon}${rank}??/span>
            <div class="dash-item-text">
              <span class="dash-artno">${item.artNo} 쨌 ${item.hfb || 'HFB'}</span>
              <span class="dash-artname">${item.artName}</span>
            </div>
          </div>
          <span class="dash-stock-num high">${item.currentStock}媛?/span>
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
      <div class="dash-item" onclick="quickActionRegister('${item.artNo}', '?낃퀬')" title="?대┃ ???낃퀬 ?깅줉">
        <div class="dash-item-info">
          <div class="dash-item-left">
            <span class="rank-badge ${isOut ? 'rank-danger' : 'rank-warning'}">${rank}??/span>
            <div class="dash-item-text">
              <span class="dash-artno">${item.artNo} 쨌 ${item.hfb || 'HFB'}</span>
              <span class="dash-artname">${item.artName}</span>
            </div>
          </div>
          <span class="dash-stock-num ${isOut ? 'danger' : 'warning'}">
            ${isOut ? '?좑툘 ?덉젅 (0媛?' : item.currentStock + '媛?}
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
      const hfbName = item.hfb || "湲고? HFB";
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
        <div class="hfb-dash-card" onclick="filterByHFB('${hItem.hfb}')" style="cursor:pointer;" title="?대떦 HFB ?덈ぉ ?꾪꽣留?>
          <div class="hfb-dash-header">
            <div class="hfb-dash-title">
              <span class="hfb-badge">${hItem.hfb}</span>
              <span>(${hItem.count}媛??덈ぉ)</span>
            </div>
            <span class="hfb-dash-val">?ш퀬 ${hItem.totalStock}媛?/span>
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
  quickActionRegister(artNo, '?낃퀬');
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
  showToast(`'${artNo}' ?덈ぉ [${type}] ?깅줉 ?붾㈃?쇰줈 ?대룞?덉뒿?덈떎.`, "success");
}

function quickActionOrder(artNo) {
  const orderArtNoElem = document.getElementById("order-artno");
  if (orderArtNoElem) orderArtNoElem.value = artNo;
  
  onOrderArtNoInput(artNo);

  const orderNavBtn = document.querySelectorAll(".bottom-nav .nav-item")[2];
  switchTab("order", orderNavBtn);
  showToast(`'${artNo}' ?덈ぉ ?ㅻ뜑 ?붿껌 ?붾㈃?쇰줈 ?대룞?덉뒿?덈떎.`, "success");
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

  let optionsHtml = '<option value="ALL">紐⑤뱺 ?덈ぉ</option>';
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
    if (log.type === "?낃퀬") totalIn += qty;
    if (log.type === "異쒓퀬") totalOut += qty;
  }

  document.getElementById("hist-count").textContent = filteredLogs.length;
  document.getElementById("hist-total-in").textContent = totalIn;
  document.getElementById("hist-total-out").textContent = totalOut;

  if (filteredLogs.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #94a3b8;">
        <i class="fa-regular fa-folder-open" style="font-size: 32px; margin-bottom: 8px;"></i>
        <p>議곌굔??留욌뒗 湲곕줉???놁뒿?덈떎.</p>
      </div>
    `;
    return;
  }

  const visibleLogs = filteredLogs.slice(0, historyDisplayLimit);

  let html = visibleLogs.map(log => {
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
    return `
    <div class="history-item type-${log.type}">
      <div class="hist-left">
        <span class="hist-date"><i class="fa-regular fa-clock"></i> ${displayTime} ${log.user ? '쨌 ' + log.user : ''}</span>
        <div class="hist-name">${log.artName}</div>
        <span class="hist-artno">踰덊샇: ${log.artNo}</span>
      </div>
      <div class="hist-right">
        <span class="hist-badge type-${log.type}">${log.type}</span>
        <div class="hist-qty ${log.type === '?낃퀬' ? 'text-in' : 'text-out'}">
          ${log.type === '?낃퀬' ? '+' : '-'}${log.qty}媛?        </div>
      </div>
    </div>
    `;
  }).join("");

  const totalCount = isDefaultFilter && historyDisplayLimit === RENDER_LIMIT ? historyLogs.length : filteredLogs.length;
  if (totalCount > visibleLogs.length) {
    html += `
      <button type="button" class="btn-secondary" style="width:100%; margin-top:10px; padding:12px;" onclick="loadMoreHistoryLogs()">
        ?댁쟾 湲곕줉 ?붾낫湲?(${visibleLogs.length} / ${totalCount})
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
    showToast("?묒? 異붿텧 沅뚰븳???놁뒿?덈떎. (愿€由ъ옄 ?꾩슜)", "danger");
    return;
  }

  if (historyLogs.length === 0) {
    showToast("異붿텧???낆텧怨?湲곕줉???놁뒿?덈떎.", "danger");
    return;
  }

  const exportData = historyLogs.map((log, index) => ({
    "?곕쾲": index + 1,
    "?좎쭨": log.date,
    "援щ텇": log.type,
    "?꾪떚???대쫫": log.artName,
    "踰덊샇 (ARTNO)": log.artNo,
    "?섎웾": log.qty,
    "?묒꽦??: log.user || "-"
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "湲곕줉");

  const todayStr = new Date().toISOString().split("T")[0];
  XLSX.writeFile(workbook, `?낆텧怨?湲곕줉_${todayStr}.xlsx`);
  showToast("愿€由ъ옄 沅뚰븳?쇰줈 ?묒? ?뚯씪(.xlsx) 異붿텧???쒖옉?덉뒿?덈떎!", "success");
}

// --- Excel Import Functionality ---
function handleExcelImport(e) {
  if (!isAdminUser) {
    showToast("留덉뒪???곗씠???묒? ?낅줈?쒕뒗 愿€由ъ옄 ?꾩슜 湲곕뒫?낅땲??", "danger");
    return;
  }

  const file = e.target.files[0];
  if (!file) return;

  const statusMsg = document.getElementById("import-status");
  statusMsg.style.display = "block";
  statusMsg.className = "import-status-msg";
  statusMsg.style.backgroundColor = "#e0f2fe";
  statusMsg.style.color = "#0369a1";
  statusMsg.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ?묒? ?뚯씪 遺꾩꽍 以?..';

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
          throw new Error("?묒? ?쒗듃???곗씠?곌? 遺€議깊빀?덈떎.");
        }

        let hfbIdx = -1;
        let artNoIdx = -1;
        let artNameIdx = -1;

        const header = rows[0] || [];
        for (let i = 0; i < header.length; i++) {
          const title = String(header[i] || "").toUpperCase();
          if (title.includes("HFB") || title.includes("BUSINESS") || title.includes("HOME FURNISHING")) hfbIdx = i;
          if (title.includes("ARTNO") || title.includes("踰덊샇") || title.includes("ARTICLE NUMBER")) artNoIdx = i;
          if (title.includes("ARTNAME") || title.includes("?꾪떚??) || title.includes("?대쫫") || title.includes("ARTICLE NAME")) artNameIdx = i;
        }

        // Default Excel Master Specification: Sheet1 Columns:
        // F??(Index 5): HFB (Home Furnishing Business)
        // H??(Index 7): 踰덊샇 / Article Number
        // I??(Index 8): ?꾪떚???대쫫 / Article Name
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
              : "?덈ぉ紐??놁쓬";
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
          statusMsg.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${newCatalog.length}媛??꾪떚??留덉뒪???곗씠?곕줈 ?덈줈怨좎묠 ?섏뿀?듬땲??`;
          showToast(`?묒??먯꽌 ${newCatalog.length}媛??덈ぉ???덈줈怨좎묠?덉뒿?덈떎.`, "success");
        } else {
          throw new Error("?좏슚???꾪떚??踰덊샇瑜?李얠쓣 ???놁뒿?덈떎.");
        }
      } catch (err) {
        statusMsg.style.backgroundColor = "#fef2f2";
        statusMsg.style.color = "#b91c1c";
        statusMsg.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ?ㅻ쪟: ${err.message}`;
        showToast(`?묒? ?쎄린 ?ㅻ쪟: ${err.message}`, "danger");
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
    container.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 15px;">?깅줉???덈ぉ???놁뒿?덈떎.</p>';
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
        <i class="fa-solid fa-plus"></i> ?낅젰
      </button>
    </div>
  `).join("");

  if (filtered.length > masterDisplayLimit) {
    html += `
      <button type="button" class="btn-secondary" style="width:100%; margin-top:10px; padding:12px;" onclick="loadMoreMasterItems()">
        ?붾낫湲?(${masterDisplayLimit} / ${filtered.length})
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
        ?곸쐞 ${maxModalItems}媛쒕쭔 ?쒖떆?⑸땲?? ?곸꽭 寃€?됱뼱瑜??낅젰??二쇱꽭??
      </div>
    `;
  }

  container.innerHTML = html;
}

function chooseModalItem(artNo) {
  if (modalSelectTarget === "order") {
    document.getElementById("order-artno").value = artNo;
    onOrderArtNoInput(artNo);
  } else if (modalSelectTarget === "ptag") {
    document.getElementById("ptag-artno").value = artNo;
    onPtagArtNoInput(artNo);
  } else {
    document.getElementById("reg-artno").value = artNo;
    onArtNoInput(artNo);
  }
  closeMasterSelectModal();
}

function onPtagArtNoInput(artNoValue) {
  const cleanNo = artNoValue.trim();
  const artNameInput = document.getElementById("ptag-artname");
  const icon = document.getElementById("ptag-artname-status-icon");

  if (!cleanNo) {
    if (artNameInput) artNameInput.value = "";
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
    return;
  }

  const artNameMatch = masterCatalogMap.get(cleanNo);

  if (artNameMatch) {
    if (artNameInput) artNameInput.value = artNameMatch;
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #059669;"></i>';
  } else {
    if (artNameInput) artNameInput.value = "품목명 자동 입력 불가 (마스터 데이터 없음)";
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: #d97706;"></i>';
  }
}

function openAddMasterModal() {
  if (!isAdminUser) {
    showToast("?좉퇋 ?꾪떚??媛쒕퀎 異붽???愿€由ъ옄 ?꾩슜 湲곕뒫?낅땲??", "danger");
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
    showToast("愿€由ъ옄 沅뚰븳???꾩슂?⑸땲??", "danger");
    return;
  }

  const hfb = (document.getElementById("new-hfb") ? document.getElementById("new-hfb").value.trim() : "");
  const artNo = document.getElementById("new-artno").value.trim();
  const artName = document.getElementById("new-artname").value.trim();

  if (!artNo || !artName) return;

  if (masterCatalogMap.has(artNo)) {
    showToast(`?대? ?깅줉???꾪떚??踰덊샇?낅땲?? ${artNo}`, "danger");
    return;
  }

  masterCatalog.push({ hfb, artNo, artName });
  saveMasterCatalog();
  renderMasterCatalog();
  populateArticleFilterDropdown();
  closeAddMasterModal();

  showToast(`?좉퇋 ?덈ぉ '${artName}'??媛€) 異붽??섏뿀?듬땲??`, "success");
  document.getElementById("add-master-form").reset();
}

// Toast Utility
function showToast(message, type = "success", undoId = null) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast-msg ${type}`;
  
  if (undoId) {
    toast.classList.add("toast-long");
    toast.innerHTML = `
      <div style="flex:1; text-align:left;">${message}</div>
      <button type="button" class="toast-action-btn" onclick="undoLastAction(${undoId}, this.parentElement)">?ㅽ뻾 痍⑥냼</button>
    `;
  } else {
    toast.innerHTML = message;
  }

  container.appendChild(toast);

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
  tempToast.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 痍⑥냼 泥섎━ 以?..';
  const container = document.getElementById("toast-container");
  if (container) container.appendChild(tempToast);

  if (supabaseClient) {
    const { error } = await supabaseClient.from("inventory_logs").delete().eq("id", id);
    if (error) {
      if (tempToast.parentNode) tempToast.parentNode.removeChild(tempToast);
      showToast("痍⑥냼 ?ㅽ뙣: " + error.message, "danger");
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
  showToast("?대떦 湲곕줉??痍⑥냼?섏뿀?듬땲??", "success");
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

  supabaseClient
    .channel('public:mfaq_logs')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mfaq_logs' }, payload => {
      handleRealtimeMfaq(payload);
    })
    .subscribe();
}

function handleRealtimeMfaq(payload) {
  const { eventType, new: newRow, old: oldRow } = payload;
  if (eventType === 'INSERT') {
    const exists = mfaqLogs.find(l => l.id === newRow.id);
    if (!exists) {
      mfaqLogs.push({
        id: newRow.id,
        category: newRow.category,
        question: newRow.question,
        count: newRow.count,
        createdAt: newRow.created_at,
        lastUpdated: newRow.last_updated
      });
    }
  } else if (eventType === 'UPDATE') {
    const idx = mfaqLogs.findIndex(l => l.id === newRow.id);
    if (idx !== -1) {
      mfaqLogs[idx] = {
        ...mfaqLogs[idx],
        count: newRow.count,
        lastUpdated: newRow.last_updated
      };
    }
  } else if (eventType === 'DELETE') {
    mfaqLogs = mfaqLogs.filter(l => l.id !== oldRow.id);
  }
  
  saveMfaqLogs();
  updateMfaqBadge();
  
  const mfaqTab = document.getElementById("tab-mfaq");
  if (mfaqTab && mfaqTab.classList.contains("active")) {
    renderMfaq();
  }
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
        artName: newRecord.artname || newRecord.artName || masterCatalogMap.get(mappedArtNo) || "?????녿뒗 ?덈ぉ"
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
      
      // === ?뵒 愿由ъ옄?먭쾶 ???ㅻ뜑 ?붿껌 ?뚮엺 ===
      if (isAdminUser && newRecord.user !== currentUser) {
        showAlarmNotification(`?뵒 [???ㅻ뜑 ?붿껌] ${newRecord.user}?섏씠 '${newRecord.artname || newRecord.artName}' ?덈ぉ???붿껌?덉뒿?덈떎.`, "success");
      }
    }
  } else if (eventType === 'UPDATE') {
    const idx = orderLogs.findIndex(log => log.id === newRecord.id);
    if (idx !== -1) {
      // 湲곗〈 ?곹깭 ???      const oldStatus = orderLogs[idx].status || '?붿껌??;
      const newStatus = newRecord.status;

      // ?곗씠???낅뜲?댄듃
      orderLogs[idx] = {
        ...orderLogs[idx],
        ...newRecord,
        artNo: newRecord.artno || newRecord.artNo || "",
        artName: newRecord.artname || newRecord.artName || ""
      };

      // === ?뵒 ?붿껌?먯뿉寃??곹깭 蹂寃??뚮엺 濡쒖쭅 ===
      if (oldStatus !== newStatus && orderLogs[idx].user === currentUser) {
        if (newStatus === '?섎씫') {
          showAlarmNotification(`??[?ㅻ뜑 ?섎씫] '${orderLogs[idx].artName}' ?붿껌???섎씫?섏뿀?듬땲??`, "success");
        } else if (newStatus === '蹂대쪟') {
          showAlarmNotification(`?슚 [?ㅻ뜑 蹂대쪟] '${orderLogs[idx].artName}' ?붿껌??蹂대쪟?섏뿀?듬땲?? ?대떦?먯뿉寃?臾몄쓽?섏꽭??`, "danger");
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

// ?뵒 ?ㅻ뜑 泥섎━ 諛??붿껌 ?꾩슜 ?뚮엺 ?⑥닔
function showAlarmNotification(message, type) {
  // 紐⑤컮???몄떆/吏꾨룞 諛??뚮━
  playSuccessFeedback();
  
  // 釉뚮씪?곗? ?ㅼ씠?곕툕 ?뚮┝ (?덉슜??寃쎌슦)
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("?몄씪利?李쎄퀬 ?ㅻ뜑 ?뚮┝", { body: message });
  }

  // ?붾㈃ ?좎뒪???앹뾽 ?꾩슦湲?  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast-msg ${type} toast-long`; // toast-long ?대옒?ㅻ줈 ?ㅻ옒 ?쒖떆
  toast.style.border = type === 'success' ? '2px solid #059669' : '2px solid #dc2626';
  toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';
  toast.innerHTML = `<div style="flex:1; text-align:left; font-size: 14px; font-weight:800;">${message}</div>`;
  
  container.appendChild(toast);

  // 5珥????щ씪吏?  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 5000);
}

// --- Haptic & Audio Feedback ---
function playSuccessFeedback() {
  if (navigator.vibrate) {
    navigator.vibrate(50); // 50ms 吏㏃? 吏꾨룞 (紐⑤컮?쇱슜)
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
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note (寃쎌풄???뚮━)
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);
    }
  } catch (e) {
    console.warn("Audio playback failed:", e);
  }
}
