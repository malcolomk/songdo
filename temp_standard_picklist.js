// --- Standard Pick List Logic ---

window.renderStandardLocationDropdown = function() {
  const dropdown = document.getElementById("picklist-location-dropdown");
  if (!dropdown) return;
  
  const currentVal = dropdown.value || "전체";
  
  const stockMap = buildStockMap();
  const locations = new Set();
  
  stockMap.forEach(item => {
    if (item.currentStock > 0 && item.location) {
      locations.add(item.location);
    }
  });
  
  const locArray = Array.from(locations).sort();
  
  let html = `<option value="전체">모든 구역 보기</option>`;
  locArray.forEach(loc => {
    html += `<option value="${loc}">${loc}</option>`;
  });
  
  dropdown.innerHTML = html;
  dropdown.value = currentVal;
  
  renderStandardInventory();
};

window.renderStandardInventory = function() {
  const container = document.getElementById("picklist-standard-inventory");
  const dropdown = document.getElementById("picklist-location-dropdown");
  if (!container || !dropdown) return;
  
  const selectedLocation = dropdown.value;
  
  const stockMap = buildStockMap();
  let inventory = Array.from(stockMap.values()).filter(item => item.currentStock > 0);
  
  if (selectedLocation !== "전체") {
    inventory = inventory.filter(item => item.location === selectedLocation);
  }
  
  if (inventory.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:#94a3b8; padding:20px; font-size:13px;">선택한 구역에 재고가 없습니다.</div>`;
    return;
  }
  
  inventory.sort((a, b) => {
    const locDiff = (a.location || "").localeCompare(b.location || "", "ko");
    if (locDiff !== 0) return locDiff;
    return a.artNo.localeCompare(b.artNo);
  });
  
  let html = "";
  inventory.forEach((item) => {
    html += `
      <div class="stock-card" style="display:flex; align-items:center; padding:10px; border-bottom:1px solid #f1f5f9; gap:10px;">
        <input type="checkbox" class="std-picklist-cb" data-artno="${item.artNo}" data-artname="${item.artName.replace(/"/g, "&quot;")}" data-maxqty="${item.currentStock}" style="width:20px; height:20px; accent-color:#059669; cursor:pointer;">
        
        <div style="flex:1;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="background:#f8fafc; color:#64748b; font-size:11px; font-weight:700; padding:2px 6px; border-radius:4px; border:1px solid #cbd5e1;"><i class="fa-solid fa-map-pin"></i> 구역: ${item.location || '미지정'}</span>
            <span style="font-size:12px; font-weight:bold; color:#475569;">${item.artNo}</span>
          </div>
          <div style="font-size:13px; font-weight:bold; margin-top:4px;">${item.artName}</div>
          <div style="font-size:11px; color:#64748b; margin-top:2px;">잔여 재고: ${item.currentStock}개</div>
        </div>
        
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          <label style="font-size:11px; font-weight:bold; color:#475569;">수량</label>
          <input type="number" id="std-qty-${item.artNo}" value="${item.currentStock}" min="1" max="${item.currentStock}" style="width:60px; padding:4px; text-align:center; border:1px solid #cbd5e1; border-radius:4px;">
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
};

window.addStandardToPickList = async function() {
  const checkboxes = document.querySelectorAll('.std-picklist-cb:checked');
  if (checkboxes.length === 0) {
    showToast("이동할 품목을 선택해주세요.", "warning");
    return;
  }
  
  let addedCount = 0;
  
  for (let cb of checkboxes) {
    const artNo = cb.dataset.artno;
    const artName = cb.dataset.artname;
    const maxQty = parseInt(cb.dataset.maxqty, 10);
    const qtyInput = document.getElementById(`std-qty-${artNo}`);
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
      const insertedId = await saveOrderLogs(newOrder); 
      if (insertedId) newOrder.id = insertedId;
      orderLogs.unshift(newOrder);
      addedCount++;
    } catch (err) {
      console.error("Failed to add picklist item", err);
    }
  }
  
  if (addedCount > 0) {
    showToast(`${addedCount}개 품목이 공용 챙기기 목록으로 이동되었습니다.`, "success");
    playSuccessFeedback();
    
    checkboxes.forEach(cb => cb.checked = false);
    renderStandardPickList();
  }
};

window.renderStandardPickList = function() {
  const container = document.getElementById("picklist-standard-cart");
  if (!container) return;
  
  const pendingPicks = orderLogs.filter(item => item.status === "출고대기");
  
  if (pendingPicks.length === 0) {
    container.innerHTML = `<div class="empty-state">대기 중인 공용 챙기기 목록이 없습니다.</div>`;
    return;
  }
  
  let html = "";
  pendingPicks.forEach(item => {
    const stockMap = buildStockMap();
    const stockItem = stockMap.get(item.artNo);
    let location = "미지정";
    if (stockItem && stockItem.location) location = stockItem.location;
    
    html += `
      <div class="history-card" style="align-items:center;">
        <div class="history-icon" style="background-color: #f59e0b; color: white;">
          <i class="fa-solid fa-box-open"></i>
        </div>
        <div class="history-content">
          <div style="font-size: 10px; color: #64748b; font-weight: 700;">
            ${item.date} | 요청: ${item.user}
          </div>
          <div class="history-artno">${item.artNo}</div>
          <div class="history-artname">${item.artName}</div>
          <div style="margin-top:4px;">
            <span style="background:#f8fafc; color:#64748b; font-weight:700; font-size:11px; padding:2px 6px; border-radius:4px; border:1px solid #cbd5e1; display:inline-flex; align-items:center; gap:4px;">
              <i class="fa-solid fa-map-pin"></i> 구역: ${location}
            </span>
          </div>
        </div>
        <div class="history-qty" style="color: #d97706; font-size: 16px; min-width:40px; text-align:right;">
          ${item.qty}개
        </div>
        <button type="button" style="background:#059669; color:white; border:none; margin-left:15px; font-weight:bold; border-radius:6px; padding:12px 16px; cursor:pointer; box-shadow:0 2px 4px rgba(5,150,105,0.2);" onclick="completePickItem_custom('${item.id}')">
          <i class="fa-solid fa-check"></i> 완료
        </button>
      </div>
    `;
  });
  container.innerHTML = html;
};

const origSwitchTabStandard = window.switchTab;
window.switchTab = function(tabId) {
  if (typeof origSwitchTabStandard === "function") origSwitchTabStandard(tabId);
  
  if (tabId === "tab-picklist") {
    renderStandardLocationDropdown();
    renderStandardPickList();
  }
};

const origCompletePickItemStandard = window.completePickItem_custom;
window.completePickItem_custom = async function(id) {
  if (typeof origCompletePickItemStandard === "function") {
    await origCompletePickItemStandard(id);
    
    const activeTab = document.querySelector('.tab-page.active');
    if (activeTab && activeTab.id === "tab-picklist") {
      renderStandardLocationDropdown();
      renderStandardPickList();
    }
  }
};
