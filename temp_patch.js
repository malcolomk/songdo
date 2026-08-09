
// --- Order Logs Override & Bulk Actions ---
window.updateOrderBulkSelection = function() {
  const checkboxes = document.querySelectorAll('.order-checkbox:checked');
  const count = checkboxes.length;
  const bar = document.getElementById('order-bulk-action-bar');
  const countSpan = document.getElementById('order-bulk-count');
  
  if (count > 0) {
    countSpan.textContent = count;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
};

window.clearOrderBulkSelection = function() {
  const checkboxes = document.querySelectorAll('.order-checkbox:checked');
  checkboxes.forEach(cb => cb.checked = false);
  const selectAll = document.getElementById('order-select-all');
  if(selectAll) selectAll.checked = false;
  updateOrderBulkSelection();
};

window.toggleOrderSelectAll = function(isChecked) {
  const checkboxes = document.querySelectorAll('.order-checkbox');
  checkboxes.forEach(cb => cb.checked = isChecked);
  updateOrderBulkSelection();
};

window.bulkUpdateOrderStatus = async function(status) {
  const checkboxes = document.querySelectorAll('.order-checkbox:checked');
  if (checkboxes.length === 0) return;
  
  const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index, 10));
  
  let updateCount = 0;
  for (let i of indices) {
    const log = orderLogs[i];
    if (log) {
      log.status = status;
      if (supabaseClient) {
        try {
          await supabaseClient.from('order_requests').update({ status: status }).eq('id', log.id);
        } catch (e) {}
      }
      updateCount++;
    }
  }
  
  showToast(`${updateCount}개 요청이 [${status}] 상태로 변경되었습니다.`, "success");
  clearOrderBulkSelection();
  renderOrderLogs();
};

window.bulkDeleteOrders = async function() {
  const checkboxes = document.querySelectorAll('.order-checkbox:checked');
  if (checkboxes.length === 0) return;
  
  if (!confirm(`선택한 ${checkboxes.length}개의 요청을 완전히 삭제하시겠습니까?`)) return;
  
  const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index, 10));
  const idsToDelete = indices.map(i => orderLogs[i].id);
  
  orderLogs = orderLogs.filter(log => !idsToDelete.includes(log.id));
  
  if (supabaseClient) {
    try {
      for (let id of idsToDelete) {
        await supabaseClient.from('order_requests').delete().eq('id', id);
      }
    } catch (e) {}
  }
  
  showToast(`${idsToDelete.length}개 요청이 삭제되었습니다.`, "success");
  clearOrderBulkSelection();
  renderOrderLogs();
};

window.renderOrderLogs = function() {
  const container = document.getElementById("order-logs-container");
  if (!container) return;

  if (orderLogs.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #94a3b8;">
        <i class="fa-solid fa-cart-shopping" style="font-size: 32px; margin-bottom: 8px;"></i>
        <p>등록된 오더 요청이 없습니다.</p>
      </div>
    `;
    return;
  }
  container.innerHTML = orderLogs.map((item, index) => {
    const statusText = item.status || '요청됨';
    let bgColor = '#e0e7ff';
    let textColor = '#4338ca';
    if (statusText === '승인') { bgColor = '#dcfce7'; textColor = '#166534'; }
    if (statusText === '반려') { bgColor = '#fee2e2'; textColor = '#991b1b'; }
    if (statusText === '보류') { bgColor = '#fef3c7'; textColor = '#b45309'; }
    if (statusText === '완료') { bgColor = '#f3f4f6'; textColor = '#4b5563'; }

    let statusHtml = `<span class="hist-badge" style="background-color: ${bgColor}; color: ${textColor};">${statusText}</span>`;
    
    if (isAdminUser) {
      statusHtml = `
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          ${statusHtml}
          <div style="display:flex; gap:4px; margin-top:2px;">
            <button type="button" onclick="updateOrderStatus(${index}, '승인')" style="font-size:10px; padding:2px 8px; border:none; background:#22c55e; color:white; border-radius:4px; cursor:pointer;">승인</button>
            <button type="button" onclick="updateOrderStatus(${index}, '반려')" style="font-size:10px; padding:2px 8px; border:none; background:#ef4444; color:white; border-radius:4px; cursor:pointer;">반려</button>
          </div>
        </div>
      `;
    }

    let displayTime = item.date;
    if (item.created_at) {
      const dateStr = item.created_at.endsWith('Z') || item.created_at.includes('+') ? item.created_at : item.created_at + 'Z';
      const d = new Date(dateStr);
      const yyyy = d.getFullYear().toString().slice(2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      displayTime = `${yyyy}.${mm}.${dd} ${hh}:${min}`;
    } else {
      displayTime = `${item.date.replace(/-/g, '.').substring(2)} --:--`;
    }

    return `
    <div class="history-item" style="border-left-color: #6366f1;">
      <div class="hist-left" style="flex:0 0 auto; margin-right:10px;">
        <input type="checkbox" class="order-checkbox" data-index="${index}" onchange="updateOrderBulkSelection()" style="width:20px; height:20px; accent-color:#6366f1; cursor:pointer;">
      </div>
      <div class="hist-left">
        <span class="hist-date"><i class="fa-regular fa-clock"></i> ${displayTime} · ${item.user}</span>
        <div class="hist-name">${item.artName}</div>
        <span class="hist-artno">번호: ${item.artNo}</span>
      </div>
      <div class="hist-right">
        ${statusHtml}
        <div class="hist-qty" style="color: #4338ca; margin-top:4px; font-weight:bold;">
          ${item.qty}개
        </div>
      </div>
    </div>
    `;
  }).join("");
  
  if (typeof renderPickList === 'function') renderPickList();
  
  const checkedIndices = Array.from(document.querySelectorAll('#order-bulk-action-bar')[0]?.style.display !== 'none' ? document.querySelectorAll('.order-checkbox:checked') : []).map(cb => cb.dataset.index);
  if (checkedIndices.length > 0) {
    document.querySelectorAll('.order-checkbox').forEach(cb => {
      if (checkedIndices.includes(cb.dataset.index)) cb.checked = true;
    });
    updateOrderBulkSelection();
  }
};
