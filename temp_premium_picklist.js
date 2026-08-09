// --- Premium Pick List Logic ---
let currentPremiumLocation = "전체";

window.renderPremiumLocationChips = function() {
  const container = document.getElementById("picklist-location-chips");
  if (!container) return;
  
  const stockMap = buildStockMap();
  const locations = new Set(["전체"]);
  
  stockMap.forEach(item => {
    if (item.currentStock > 0 && item.location) {
      locations.add(item.location);
    }
  });
  
  const locArray = Array.from(locations).sort();
  
  let html = ``;
  locArray.forEach(loc => {
    const isSelected = currentPremiumLocation === loc;
    const bg = isSelected ? '#2563eb' : '#f1f5f9';
    const color = isSelected ? 'white' : '#475569';
    const border = isSelected ? 'none' : '1px solid #cbd5e1';
    html += `<button type="button" style="background:${bg}; color:${color}; border:${border}; font-weight:700; font-size:13px; padding:6px 14px; border-radius:20px; white-space:nowrap; transition:all 0.2s; box-shadow:${isSelected ? '0 2px 4px rgba(37,99,235,0.2)' : 'none'}; cursor:pointer;" onclick="changePremiumLocation('${loc}')">${loc}</button>`;
  });
  
  container.innerHTML = html;
};

window.changePremiumLocation = function(loc) {
  currentPremiumLocation = loc;
  renderPremiumLocationChips();
  renderPremiumInventory();
};

window.renderPremiumInventory = function() {
  const container = document.getElementById("picklist-premium-inventory");
  if (!container) return;
  
  const stockMap = buildStockMap();
  let inventory = Array.from(stockMap.values()).filter(item => item.currentStock > 0);
  
  if (currentPremiumLocation !== "전체") {
    inventory = inventory.filter(item => item.location === currentPremiumLocation);
  }
  
  if (inventory.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:#94a3b8; padding:30px; font-size:14px;"><i class="fa-solid fa-box-open" style="font-size:24px; margin-bottom:8px; display:block;"></i>이 구역에는 담을 재고가 없습니다.</div>`;
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
      <div style="display:flex; align-items:center; padding:12px; background:white; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,0.02); gap:12px;">
        <div style="flex:1;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="background:#f1f5f9; color:#2563eb; font-size:10px; font-weight:800; padding:2px 8px; border-radius:12px;"><i class="fa-solid fa-location-dot"></i> ${item.location}</span>
            <span style="font-size:12px; font-weight:800; color:#334155;">${item.artNo}</span>
          </div>
          <div style="font-size:14px; font-weight:800; color:#0f172a; margin-top:4px; line-height:1.2;">${item.artName}</div>
          <div style="font-size:11px; color:#64748b; margin-top:4px;">창고 잔여 재고: <strong style="color:#059669;">${item.currentStock}개</strong></div>
        </div>
        
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
          <input type="number" id="premium-qty-${item.artNo}" value="${item.currentStock}" min="1" max="${item.currentStock}" style="width:60px; padding:6px; text-align:center; border:1px solid #cbd5e1; border-radius:8px; font-weight:700; color:#0f172a; background:#f8fafc;">
          <button type="button" style="background:#e0f2fe; color:#0369a1; border:none; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:800; cursor:pointer;" onclick="addToPremiumCart('${item.artNo}', '${item.artName.replace(/'/g, "\\'")}', ${item.currentStock})">
            <i class="fa-solid fa-plus"></i> 담기
          </button>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
};

window.addToPremiumCart = async function(artNo, artName, maxQty) {
  const qtyInput = document.getElementById(`premium-qty-${artNo}`);
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
    
    showToast(`'${artName}' ${qty}개를 담았습니다.`, "success");
    playSuccessFeedback();
    
    renderPremiumPickCart();
  } catch (err) {
    console.error("Failed to add picklist item", err);
    showToast("담기 실패", "danger");
  }
};

window.renderPremiumPickCart = function() {
  const container = document.getElementById("picklist-premium-cart");
  const countSpan = document.getElementById("pick-cart-count");
  if (!container) return;
  
  const pendingPicks = orderLogs.filter(item => item.status === "출고대기");
  
  countSpan.textContent = `${pendingPicks.length}개 진행 중`;
  
  if (pendingPicks.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px 20px; background:#f8fafc; border-radius:12px; border:2px dashed #cbd5e1;">
        <i class="fa-solid fa-clipboard-list" style="font-size:32px; color:#94a3b8; margin-bottom:12px; display:block;"></i>
        <h3 style="font-size:16px; font-weight:800; color:#475569; margin:0 0 4px 0;">목록이 비어있습니다</h3>
        <p style="font-size:13px; color:#64748b; margin:0;">위 구역별 재고에서 필요한 물품을 담아주세요.</p>
      </div>
    `;
    return;
  }
  
  const grouped = {};
  pendingPicks.forEach((item) => {
    const stockMap = buildStockMap();
    const stockItem = stockMap.get(item.artNo);
    let location = "미지정 구역";
    if (stockItem && stockItem.location) {
      location = stockItem.location;
    }
    
    if (!grouped[location]) grouped[location] = [];
    grouped[location].push(item);
  });
  
  const sortedLocations = Object.keys(grouped).sort();
  
  let html = "";
  sortedLocations.forEach(loc => {
    const items = grouped[loc];
    html += `
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;">
        <div style="background:#e2e8f0; padding:10px 15px; display:flex; align-items:center; gap:8px;">
          <i class="fa-solid fa-map-pin" style="color:#475569;"></i>
          <span style="font-size:14px; font-weight:800; color:#334155;">${loc}</span>
          <span style="background:#334155; color:white; font-size:11px; font-weight:800; padding:2px 8px; border-radius:10px; margin-left:auto;">${items.length}개</span>
        </div>
        <div style="padding:10px; display:flex; flex-direction:column; gap:10px;">
    `;
    
    items.forEach(item => {
      html += `
        <div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:12px; border-radius:8px; border:1px solid #cbd5e1; box-shadow:0 1px 2px rgba(0,0,0,0.05);">
          <div>
            <div style="font-size:11px; font-weight:800; color:#64748b;">${item.artNo}</div>
            <div style="font-size:14px; font-weight:800; color:#0f172a; margin-top:2px; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.artName}</div>
            <div style="font-size:13px; font-weight:800; color:#b45309; margin-top:4px;">${item.qty}개 챙기기</div>
          </div>
          <button type="button" style="background:#059669; color:white; font-weight:800; border:none; padding:12px 16px; border-radius:8px; font-size:14px; cursor:pointer; box-shadow:0 2px 4px rgba(5,150,105,0.2); transition:all 0.2s;" onclick="completePickItem_custom('${item.id}')">
            <i class="fa-solid fa-check"></i> 완료
          </button>
        </div>
      `;
    });
    
    html += `
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
};

const origSwitchTabPremium = window.switchTab;
window.switchTab = function(tabId) {
  if (typeof origSwitchTabPremium === "function") origSwitchTabPremium(tabId);
  
  if (tabId === "tab-picklist") {
    renderPremiumLocationChips();
    renderPremiumInventory();
    renderPremiumPickCart();
  }
};

const origCompletePickItem_custom = window.completePickItem_custom;
window.completePickItem_custom = async function(id) {
  if (typeof origCompletePickItem_custom === "function") {
    await origCompletePickItem_custom(id);
    
    const activeTab = document.querySelector('.tab-page.active');
    if (activeTab && activeTab.id === "tab-picklist") {
      renderPremiumLocationChips();
      renderPremiumInventory();
      renderPremiumPickCart();
    }
  }
};
