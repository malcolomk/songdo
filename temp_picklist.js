// --- Pick List Inventory Logic ---
let currentPicklistLocation = "전체";

window.renderPicklistLocationFilters = function() {
  const container = document.getElementById("picklist-location-filters");
  if (!container) return;
  
  const stockMap = buildStockMap();
  const locations = new Set(["전체"]);
  
  stockMap.forEach(item => {
    if (item.currentStock > 0 && item.location) {
      locations.add(item.location);
    }
  });
  
  const locArray = Array.from(locations).sort();
  
  let html = `<span style="font-size:12px; font-weight:bold; color:#64748b;">위치 필터:</span>`;
  locArray.forEach(loc => {
    const isSelected = currentPicklistLocation === loc;
    const bg = isSelected ? '#2563eb' : '#e2e8f0';
    const color = isSelected ? 'white' : '#334155';
    html += `<button type="button" class="btn-sm" style="background:${bg}; color:${color}; font-weight:bold; border:none; padding:4px 10px; border-radius:12px;" onclick="changePicklistLocation('${loc}')">${loc}</button>`;
  });
  
  container.innerHTML = html;
};

window.changePicklistLocation = function(loc) {
  currentPicklistLocation = loc;
  renderPicklistLocationFilters();
  renderPicklistInventory();
};

window.renderPicklistInventory = function() {
  const container = document.getElementById("picklist-inventory-container");
  if (!container) return;
  
  const stockMap = buildStockMap();
  let inventory = Array.from(stockMap.values()).filter(item => item.currentStock > 0);
  
  if (currentPicklistLocation !== "전체") {
    inventory = inventory.filter(item => item.location === currentPicklistLocation);
  }
  
  if (inventory.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:#94a3b8; padding:20px; font-size:13px;">해당 위치에 재고가 없습니다.</div>`;
    return;
  }
  
  // Sort by Location, then ArtNo
  inventory.sort((a, b) => {
    const locDiff = (a.location || "").localeCompare(b.location || "", "ko");
    if (locDiff !== 0) return locDiff;
    return a.artNo.localeCompare(b.artNo);
  });
  
  let html = "";
  inventory.forEach((item, idx) => {
    html += `
      <div class="stock-card" style="display:flex; align-items:center; padding:10px; border-bottom:1px solid #f1f5f9; gap:10px;">
        <input type="checkbox" class="picklist-add-cb" data-artno="${item.artNo}" data-artname="${item.artName}" data-maxqty="${item.currentStock}" style="width:20px; height:20px; accent-color:#059669; cursor:pointer;">
        
        <div style="flex:1;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="background:#f1f5f9; color:#2563eb; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px;"><i class="fa-solid fa-location-dot"></i> ${item.location}</span>
            <span style="font-size:12px; font-weight:bold; color:#475569;">${item.artNo}</span>
          </div>
          <div style="font-size:13px; font-weight:bold; margin-top:4px;">${item.artName}</div>
          <div style="font-size:11px; color:#64748b; margin-top:2px;">현재 재고: ${item.currentStock}개</div>
        </div>
        
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          <label style="font-size:11px; font-weight:bold; color:#475569;">추가할 수량</label>
          <input type="number" class="picklist-add-qty" id="pl-qty-${item.artNo}" value="${item.currentStock}" min="1" max="${item.currentStock}" style="width:60px; padding:4px; text-align:center; border:1px solid #cbd5e1; border-radius:4px;">
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
};

window.addSelectedToPickList = async function() {
  const checkboxes = document.querySelectorAll('.picklist-add-cb:checked');
  if (checkboxes.length === 0) {
    showToast("챙기기 목록에 추가할 품목을 선택해주세요.", "warning");
    return;
  }
  
  let addedCount = 0;
  
  for (let cb of checkboxes) {
    const artNo = cb.dataset.artno;
    const artName = cb.dataset.artname;
    const maxQty = parseInt(cb.dataset.maxqty, 10);
    const qtyInput = document.getElementById(`pl-qty-${artNo}`);
    let qty = parseInt(qtyInput.value, 10);
    
    if (isNaN(qty) || qty <= 0) qty = 1;
    if (qty > maxQty) qty = maxQty;
    
    const newOrder = {
      date: new Date().toISOString().split('T')[0],
      artNo: artNo,
      artName: artName,
      qty: qty,
      user: currentUser || "system",
      status: "출고대기",
      created_at: new Date().toISOString()
    };
    
    try {
      const insertedId = await saveOrderLogs(newOrder); // Saves to DB
      if (insertedId) newOrder.id = insertedId;
      orderLogs.unshift(newOrder);
      addedCount++;
    } catch (err) {
      console.error("Failed to add picklist item", err);
    }
  }
  
  if (addedCount > 0) {
    showToast(`${addedCount}개 품목을 챙기기 목록에 추가했습니다.`, "success");
    playSuccessFeedback();
    
    // Reset selections
    checkboxes.forEach(cb => cb.checked = false);
    
    // Refresh the pending pick list
    renderPickList();
  }
};

const origSwitchTab = window.switchTab;
window.switchTab = function(tabId) {
  if (typeof origSwitchTab === "function") origSwitchTab(tabId);
  else {
    document.querySelectorAll('.tab-page').forEach(page => page.classList.remove('active'));
    document.querySelectorAll('.bottom-nav-item').forEach(item => item.classList.remove('active'));
    
    const targetPage = document.getElementById(tabId);
    if (targetPage) targetPage.classList.add('active');
    
    const targetNav = document.querySelector(`.bottom-nav-item[onclick="switchTab('${tabId}')"]`);
    if (targetNav) targetNav.classList.add('active');
  }
  
  if (tabId === "tab-picklist") {
    renderPicklistLocationFilters();
    renderPicklistInventory();
  }
};
