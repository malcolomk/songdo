let ptagRequests = [];

async function savePtagRequest(req) {
  let insertedId = null;
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('ptag_requests').insert([req]).select();
      if (!error && data && data.length > 0) {
        insertedId = data[0].id;
        req.id = insertedId;
        req.created_at = data[0].created_at;
      }
    } catch (err) { console.warn(err); }
  }
  return insertedId;
}

async function loadPtagRequests() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('ptag_requests').select('*').order('created_at', { ascending: false });
      if (!error && data) {
        ptagRequests = data;
        renderPtagLogs();
      }
    } catch (err) { console.warn(err); }
  }
}

function onPtagArtNoInput(artNoValue) {
  const cleanNo = artNoValue.trim();
  const artNameInput = document.getElementById('ptag-artname');
  const locInput = document.getElementById('ptag-location');
  const icon = document.getElementById('ptag-artname-status-icon');
  if (!cleanNo) {
    artNameInput.value = '';
    locInput.value = '';
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
    return;
  }
  const matched = masterCatalog.find(m => m.artNo === cleanNo);
  if (matched) {
    artNameInput.value = matched.artName;
    if (matched.location && matched.location !== '지정 안됨') locInput.value = matched.location;
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #059669;"></i>';
  } else {
    if (icon) icon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: #d97706;"></i>';
  }
}

async function handlePtagSubmit(e) {
  e.preventDefault();
  const artNo = document.getElementById('ptag-artno').value.trim();
  const artName = document.getElementById('ptag-artname').value.trim();
  const qty = Number(document.getElementById('ptag-qty').value);
  const loc = document.getElementById('ptag-location').value.trim();
  const isPtag = document.getElementById('ptag-check-ptag').checked;
  const isRack = document.getElementById('ptag-check-rack').checked;
  if (!artNo || !qty || qty <= 0) {
    showToast('아티클 번호와 수량을 정확히 입력하세요.', 'danger');
    return;
  }
  if (!isPtag && !isRack) {
    showToast('라벨 종류(P-tag 또는 Rack Label)를 하나 이상 선택하세요.', 'danger');
    return;
  }
  const labelTypes = [];
  if (isPtag) labelTypes.push('P-tag');
  if (isRack) labelTypes.push('Rack Label');

  const newReq = {
    date: new Date().toISOString().split('T')[0],
    artno: artNo,
    artname: artName || '알 수 없음',
    qty: qty,
    location: loc || '미지정',
    label_type: labelTypes.join(', '),
    user: currentUser || 'guest1'
  };
  const btn = document.getElementById('btn-ptag-request');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 전송 중...';
  btn.disabled = true;

  const id = await savePtagRequest(newReq);
  if (id) {
    ptagRequests.unshift(newReq);
    showToast('라벨 출력 요청이 등록되었습니다.', 'success', null, true);
    if (typeof playSuccessFeedback === 'function') playSuccessFeedback();
    document.getElementById('ptag-artno').value = '';
    document.getElementById('ptag-artname').value = '';
    document.getElementById('ptag-qty').value = '';
    document.getElementById('ptag-location').value = '';
    renderPtagLogs();
  } else {
    showToast('저장에 실패했습니다. 관리자에게 문의하세요.', 'danger');
  }
  btn.innerHTML = originalHtml;
  btn.disabled = false;
}

function renderPtagLogs() {
  const container = document.getElementById('ptag-logs-container');
  if (!container) return;
  if (ptagRequests.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:30px; color:#94a3b8;"><i class="fa-solid fa-tags" style="font-size:32px; margin-bottom:8px;"></i><p>출력 대기 중인 라벨이 없습니다.</p></div>';
    return;
  }
  container.innerHTML = ptagRequests.map((item, index) => {
    let displayTime = item.date;
    if (item.created_at) {
      const d = new Date(item.created_at);
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      displayTime += ` ${hh}:${min}`;
    }
    return `
    <div class="history-item" style="border-left-color: #3b82f6;">
      <div class="hist-left" style="flex:0 0 auto; margin-right:10px;">
        <input type="checkbox" class="ptag-checkbox" data-index="${index}" style="width:20px; height:20px; accent-color:#3b82f6;">
      </div>
      <div class="hist-left">
        <span class="hist-date"><i class="fa-regular fa-clock"></i> ${displayTime} · ${item.user}</span>
        <div class="hist-name">${item.artname}</div>
        <span class="hist-artno">번호: ${item.artno} <span style="margin-left:6px; color:#b45309; font-weight:bold;">위치: ${item.location}</span></span>
      </div>
      <div class="hist-right" style="align-items:flex-end;">
        <span class="hist-badge" style="background:#e0e7ff; color:#4338ca;">${item.label_type}</span>
        <div class="hist-qty" style="color: #4338ca; margin-top:4px; font-weight:bold;">${item.qty}개</div>
      </div>
    </div>
    `;
  }).join('');
}

function toggleAllPtags(btn) {
  const checkboxes = document.querySelectorAll('.ptag-checkbox');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => cb.checked = !allChecked);
  if (allChecked) btn.innerHTML = '<i class="fa-solid fa-check-double"></i> 전체선택';
  else btn.innerHTML = '<i class="fa-solid fa-xmark"></i> 선택해제';
}

async function deleteSelectedPtags() {
  const checkboxes = document.querySelectorAll('.ptag-checkbox:checked');
  if (checkboxes.length === 0) {
    showToast('완료 처리할 항목을 선택해주세요.', 'danger');
    return;
  }
  if (!confirm(`선택한 ${checkboxes.length}개의 요청을 완료(삭제) 하시겠습니까?`)) return;
  
  const indicesToDelete = Array.from(checkboxes).map(cb => Number(cb.getAttribute('data-index'))).sort((a,b)=>b-a);
  const idsToDelete = indicesToDelete.map(idx => ptagRequests[idx].id).filter(id => id);
  
  if (supabaseClient && idsToDelete.length > 0) {
    try {
      const { error } = await supabaseClient.from('ptag_requests').delete().in('id', idsToDelete);
      if (error) throw error;
    } catch (err) {
      console.warn('Supabase delete error:', err);
      showToast('삭제 중 오류가 발생했습니다.', 'danger');
      return;
    }
  }
  
  indicesToDelete.forEach(idx => ptagRequests.splice(idx, 1));
  renderPtagLogs();
  showToast('선택한 항목이 완료(삭제)되었습니다.', 'success', null, true);
}

function exportPtagToExcel() {
  const checkboxes = document.querySelectorAll('.ptag-checkbox:checked');
  let itemsToExport = [];
  
  if (checkboxes.length > 0) {
    const indices = Array.from(checkboxes).map(cb => Number(cb.getAttribute('data-index')));
    itemsToExport = indices.map(idx => ptagRequests[idx]);
  } else {
    itemsToExport = [...ptagRequests];
  }
  
  if (itemsToExport.length === 0) {
    showToast('추출할 데이터가 없습니다.', 'danger');
    return;
  }
  
  const wb = XLSX.utils.book_new();
  const wsData = [
    ["요청일자", "요청자", "아티클 번호", "아티클 이름", "수량", "위치", "라벨 종류"]
  ];
  
  itemsToExport.forEach(item => {
    wsData.push([
      item.date,
      item.user,
      item.artno,
      item.artname,
      item.qty,
      item.location,
      item.label_type
    ]);
  });
  
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, "P-tag Requests");
  XLSX.writeFile(wb, `Ptag_RackLabel_요청내역_${new Date().toISOString().split('T')[0]}.xlsx`);
  showToast('엑셀 다운로드가 시작되었습니다.', 'success');
}
