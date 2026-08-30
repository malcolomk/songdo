// custom.js - Patches for inventory app features without modifying original app.js encoding

// --- IKEA Product Image Engine & Caching ---
window.productImageCache = {};
try {
  const savedImgs = localStorage.getItem("ikea_product_images_cache");
  if (savedImgs) window.productImageCache = JSON.parse(savedImgs);
} catch (e) {
  window.productImageCache = {};
}

window.saveProductImageCache = function() {
  try {
    localStorage.setItem("ikea_product_images_cache", JSON.stringify(window.productImageCache));
  } catch(e) {}
};

window.pendingImageFetches = new Set();

window.fetchIkeaProductImage = async function(rawArtNo, optArtName) {
  if (!rawArtNo) return null;
  const cleanArtNo = String(rawArtNo).replace(/[^0-9]/g, '');
  if (!cleanArtNo) return null;

  if (window.productImageCache.hasOwnProperty(cleanArtNo) && window.productImageCache[cleanArtNo] !== null) {
    return window.productImageCache[cleanArtNo];
  }

  if (window.pendingImageFetches.has(cleanArtNo)) return null;
  window.pendingImageFetches.add(cleanArtNo);

  try {
    const url = `https://sik.search.blue.cdtapps.com/kr/ko/search-result-page?q=${cleanArtNo}&size=3`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      let mainImageUrl = data?.searchResultPage?.products?.main?.items?.[0]?.product?.mainImageUrl;
      
      // Fallback 1: Discontinued / Retired products (단종/판매종료 품목)
      if (!mainImageUrl && data?.searchResultPage?.retiredProducts?.length > 0) {
        const retiredName = data.searchResultPage.retiredProducts[0].name; // e.g. "102.240.47 (SKUBB 스쿠브)"
        const match = retiredName.match(/\((.*?)\)/);
        const seriesName = match ? match[1].split(' ')[0] : '';
        
        // Auto-fill artName if currently empty
        const regArtNameEl = document.getElementById("reg-artname");
        if (regArtNameEl && !regArtNameEl.value.trim()) {
          regArtNameEl.value = match ? match[1] : retiredName;
        }

        if (seriesName) {
          try {
            const fallbackRes = await fetch(`https://sik.search.blue.cdtapps.com/kr/ko/search-result-page?q=${encodeURIComponent(seriesName)}&size=1`);
            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              mainImageUrl = fallbackData?.searchResultPage?.products?.main?.items?.[0]?.product?.mainImageUrl;
            }
          } catch(e) {}
        }
      }

      // Fallback 2: Try searching by product series name
      if (!mainImageUrl && optArtName) {
        const seriesName = String(optArtName).trim().split(' ')[0];
        if (seriesName && seriesName.length >= 2) {
          try {
            const fallbackRes = await fetch(`https://sik.search.blue.cdtapps.com/kr/ko/search-result-page?q=${encodeURIComponent(seriesName)}&size=1`);
            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              mainImageUrl = fallbackData?.searchResultPage?.products?.main?.items?.[0]?.product?.mainImageUrl;
            }
          } catch(e) {}
        }
      }

      if (mainImageUrl) {
        window.productImageCache[cleanArtNo] = mainImageUrl;
        window.saveProductImageCache();
        window.pendingImageFetches.delete(cleanArtNo);
        return mainImageUrl;
      }
    }
  } catch (err) {
    // Network or parse issue
  }

  window.pendingImageFetches.delete(cleanArtNo);
  return null;
};

window.getProductThumbHtml = function(artNo, artName, size = 48) {
  if (!artNo) return '';
  const cleanArtNo = String(artNo).replace(/[^0-9]/g, '');
  const cachedUrl = window.productImageCache ? window.productImageCache[cleanArtNo] : null;
  const hasImage = !!cachedUrl;
  const srcAttr = cachedUrl ? `src="${cachedUrl.includes('?') ? cachedUrl : (cachedUrl + '?f=xs')}" class="product-thumb-img loaded"` : `src="" class="product-thumb-img"`;
  const safeName = artName ? String(artName).replace(/"/g, '&quot;').replace(/'/g, "\\'") : '';
  
  return `
    <div class="product-thumb-container ${hasImage ? 'has-image' : ''}" data-artno="${artNo}" style="width:${size}px; height:${size}px; min-width:${size}px; min-height:${size}px;" onclick="openProductImageModal('${artNo}', '${safeName}', event)" title="사진 크게 보기">
      <div class="product-thumb-placeholder"><i class="fa-solid fa-couch"></i></div>
      <img ${srcAttr} alt="${artNo}" loading="lazy" onerror="this.classList.remove('loaded'); if(this.parentElement) this.parentElement.classList.remove('has-image');">
    </div>
  `;
};

window.loadProductThumbnails = function() {
  const containers = document.querySelectorAll('.product-thumb-container[data-artno]');
  containers.forEach(async (el) => {
    const artNo = el.getAttribute('data-artno');
    if (!artNo) return;
    const cleanArtNo = String(artNo).replace(/[^0-9]/g, '');
    const imgEl = el.querySelector('.product-thumb-img');
    if (!imgEl) return;

    if (window.productImageCache.hasOwnProperty(cleanArtNo)) {
      const imgUrl = window.productImageCache[cleanArtNo];
      if (imgUrl) {
        if (!imgEl.src || !imgEl.src.includes(imgUrl.replace(/\?f=[a-z]+/, ''))) {
          imgEl.src = imgUrl.includes('?') ? imgUrl : (imgUrl + '?f=xs');
        }
        imgEl.classList.add('loaded');
        el.classList.add('has-image');
      }
      return;
    }

    const imgUrl = await window.fetchIkeaProductImage(cleanArtNo);
    if (imgUrl && imgEl) {
      imgEl.src = imgUrl.includes('?') ? imgUrl : (imgUrl + '?f=xs');
      imgEl.onload = () => {
        imgEl.classList.add('loaded');
        el.classList.add('has-image');
      };
    }
  });
};

window.openProductImageModal = function(artNo, artName, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const cleanArtNo = artNo ? String(artNo).replace(/[^0-9]/g, '') : '';
  const imgUrl = window.productImageCache[cleanArtNo];
  if (!imgUrl) {
    window.fetchIkeaProductImage(cleanArtNo).then(url => {
      if (url) window.openProductImageModal(artNo, artName);
      else if (typeof showToast === 'function') showToast("등록된 제품 이미지가 없습니다.", "warning");
    });
    return;
  }

  const modal = document.getElementById("product-image-modal");
  const modalImg = document.getElementById("zoom-modal-img");
  const modalArtNo = document.getElementById("zoom-modal-artno");
  const modalArtName = document.getElementById("zoom-modal-artname");

  if (modal && modalImg) {
    modalImg.src = imgUrl.replace(/\?f=[a-z]+/, '') + '?f=s';
    if (modalArtNo) modalArtNo.textContent = artNo;
    if (modalArtName) modalArtName.textContent = artName || '';
    modal.classList.add("active");
  }
};

window.closeProductImageModal = function() {
  const modal = document.getElementById("product-image-modal");
  if (modal) modal.classList.remove("active");
};

// --- Register Form Product Image Preview Integration ---
window.updateRegProductThumb = function(artNo, artName) {
  const container = document.getElementById("reg-thumb-container");
  if (!container) return;
  const cleanNo = artNo ? String(artNo).replace(/[^0-9]/g, "") : "";
  if (cleanNo.length >= 6) {
    const finalName = artName || (typeof masterCatalogMap !== 'undefined' && masterCatalogMap ? masterCatalogMap.get(cleanNo) : "") || "";
    container.style.display = "block";
    container.innerHTML = window.getProductThumbHtml(cleanNo, finalName, 52);
    window.loadProductThumbnails();

    if (!window.productImageCache.hasOwnProperty(cleanNo) || !window.productImageCache[cleanNo]) {
      window.fetchIkeaProductImage(cleanNo, finalName).then(url => {
        if (url) {
          const imgEl = container.querySelector('.product-thumb-img');
          if (imgEl) {
            imgEl.src = url.includes('?') ? url : (url + '?f=xs');
            imgEl.classList.add('loaded');
            container.querySelector('.product-thumb-container')?.classList.add('has-image');
          }
        }
      });
    }
  } else {
    container.style.display = "none";
    container.innerHTML = "";
  }
};

// Hook into onArtNoInput to trigger thumbnail preview
const _origOnArtNoInput = window.onArtNoInput;
window.onArtNoInput = function(artNoValue) {
  if (typeof _origOnArtNoInput === 'function') _origOnArtNoInput(artNoValue);
  const artName = document.getElementById("reg-artname") ? document.getElementById("reg-artname").value : "";
  window.updateRegProductThumb(artNoValue, artName);
};

// Hook into selectAutocompleteItem
const _origSelectAutocompleteItem = window.selectAutocompleteItem;
window.selectAutocompleteItem = function(artNo, target) {
  if (typeof _origSelectAutocompleteItem === 'function') _origSelectAutocompleteItem(artNo, target);
  if (target === "register") {
    const artName = document.getElementById("reg-artname") ? document.getElementById("reg-artname").value : "";
    window.updateRegProductThumb(artNo, artName);
  }
};

// Hook into selectMasterItem
const _origSelectMasterItem = window.selectMasterItem;
window.selectMasterItem = function(artNo, target) {
  if (typeof _origSelectMasterItem === 'function') _origSelectMasterItem(artNo, target);
  if (target === "register") {
    const artName = document.getElementById("reg-artname") ? document.getElementById("reg-artname").value : "";
    window.updateRegProductThumb(artNo, artName);
  }
};

// Enhanced Autocomplete with Thumbnails
window.handleAutocompleteInput = function(query, target = "register") {
  const cleanQuery = query.trim().toLowerCase();
  const dropdownId = target === "order" ? "order-autocomplete-dropdown" : target === "ptag" ? "ptag-autocomplete-dropdown" : "reg-autocomplete-dropdown";
  const nameDropdownId = target === "order" ? "order-name-autocomplete-dropdown" : target === "ptag" ? "ptag-name-autocomplete-dropdown" : "reg-name-autocomplete-dropdown";
  
  const dropdown = document.getElementById(dropdownId);
  const nameDropdown = document.getElementById(nameDropdownId);
  if (nameDropdown) nameDropdown.classList.remove("active");

  if (target === "order" && typeof onOrderArtNoInput === 'function') onOrderArtNoInput(query);
  else if (target === "ptag" && typeof onPtagArtNoInput === 'function') onPtagArtNoInput(query);
  else if (typeof onArtNoInput === 'function') onArtNoInput(query);

  if (!cleanQuery) {
    if (dropdown) dropdown.classList.remove("active");
    if (target === "register") window.updateRegProductThumb("", "");
    return;
  }

  const catalog = typeof masterCatalog !== 'undefined' ? masterCatalog : [];
  const matches = catalog.filter(item => 
    item.artNo.toLowerCase().includes(cleanQuery) ||
    item.artName.toLowerCase().includes(cleanQuery) ||
    (item.hfb && item.hfb.toLowerCase().includes(cleanQuery))
  ).slice(0, 10);

  if (matches.length === 0 || !dropdown) {
    if (dropdown) dropdown.classList.remove("active");
    return;
  }

  dropdown.innerHTML = matches.map(item => `
    <div class="autocomplete-item" onclick="selectAutocompleteItem('${item.artNo}', '${target}')" style="display:flex; align-items:center; gap:10px; padding:6px 10px;">
      ${typeof getProductThumbHtml === 'function' ? getProductThumbHtml(item.artNo, item.artName, 36) : ''}
      <div class="art-info" style="flex:1; min-width:0;">
        <div class="art-no-row">
          ${item.hfb ? `<span style="background:#e0f2fe; color:#0369a1; font-size:10px; font-weight:700; padding:1px 5px; border-radius:3px;">${item.hfb}</span>` : ''}
          <span class="art-no">${item.artNo}</span>
        </div>
        <div class="art-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.artName}</div>
      </div>
      <i class="fa-solid fa-check" style="color:#2563eb; font-size:12px;"></i>
    </div>
  `).join("");

  dropdown.classList.add("active");
  if (typeof loadProductThumbnails === 'function') loadProductThumbnails();
};

window.handleAutocompleteNameInput = function(query, target = "register") {
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

  const catalog = typeof masterCatalog !== 'undefined' ? masterCatalog : [];
  const matches = catalog.filter(item => 
    item.artName.toLowerCase().includes(cleanQuery) ||
    item.artNo.toLowerCase().includes(cleanQuery) ||
    (item.hfb && item.hfb.toLowerCase().includes(cleanQuery))
  ).slice(0, 10);

  if (matches.length === 0 || !dropdown) {
    if (dropdown) dropdown.classList.remove("active");
    return;
  }

  dropdown.innerHTML = matches.map(item => `
    <div class="autocomplete-item" onclick="selectAutocompleteItem('${item.artNo}', '${target}')" style="display:flex; align-items:center; gap:10px; padding:6px 10px;">
      ${typeof getProductThumbHtml === 'function' ? getProductThumbHtml(item.artNo, item.artName, 36) : ''}
      <div class="art-info" style="flex:1; min-width:0;">
        <div class="art-no-row">
          ${item.hfb ? `<span style="background:#e0f2fe; color:#0369a1; font-size:10px; font-weight:700; padding:1px 5px; border-radius:3px;">${item.hfb}</span>` : ''}
          <span class="art-no">${item.artNo}</span>
        </div>
        <div class="art-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.artName}</div>
      </div>
      <i class="fa-solid fa-check" style="color:#2563eb; font-size:12px;"></i>
    </div>
  `).join("");

  dropdown.classList.add("active");
  if (typeof loadProductThumbnails === 'function') loadProductThumbnails();
};

// Override: Allow any user to delete history logs (remove isAdminUser check)
window.confirmDeleteHistoryLog = async function(id, optArtName) {
  const logToDelete = (typeof historyLogs !== 'undefined') ? historyLogs.find(log => String(log.id) === String(id)) : null;
  let artName = optArtName || "해당 품목";
  if (logToDelete) {
    let cleanNo = String(logToDelete.artNo || logToDelete.artno || "").trim();
    if (typeof masterCatalogMap !== 'undefined' && masterCatalogMap) {
      artName = masterCatalogMap.get(cleanNo) || masterCatalogMap.get(cleanNo.replace(/\D/g, '')) || logToDelete.artName || "해당 품목";
    } else {
      artName = logToDelete.artName || "해당 품목";
    }
  }

  if (!confirm(`'${artName}' 입출고 기록을 정말 삭제하시겠습니까?\n(삭제 시 재고가 복구되어 변경됩니다.)`)) {
    return;
  }

  if (typeof supabaseClient !== "undefined" && supabaseClient && id && id !== "undefined" && id !== "null") {
    try {
      const { error } = await supabaseClient.from('inventory_logs').delete().eq('id', id);
      if (error) console.warn("Supabase delete log error:", error);
    } catch (err) {
      console.warn("Delete log error:", err);
    }
  }

  if (typeof historyLogs !== "undefined") {
    historyLogs = historyLogs.filter(log => String(log.id) !== String(id));
    try {
      localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
    } catch (err) {}
  }
  
  if (typeof invalidateStockCache === "function") invalidateStockCache();
  if (typeof renderStockLookup === "function") renderStockLookup();
  if (typeof renderHistoryLogs === "function") renderHistoryLogs();

  if (typeof showToast === "function") {
    showToast("입출고 기록이 삭제되었습니다.", "success");
  }
};

window.deleteHistoryLog_custom = window.confirmDeleteHistoryLog;

// Also we need to make sure the delete button is visible for non-admins in renderHistoryLogs
// We can override renderHistoryLogs to generate the HTML without the isAdminUser check for the delete button
const originalRenderHistoryLogs = window.renderHistoryLogs;
window.renderHistoryLogs = function() {
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
  } else if (typeof historyDisplayLimit !== 'undefined' && typeof RENDER_LIMIT !== 'undefined' && historyDisplayLimit === RENDER_LIMIT) {
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

  let visibleLogs = filteredLogs;
  if (typeof historyDisplayLimit !== 'undefined') {
    visibleLogs = filteredLogs.slice(0, historyDisplayLimit);
  }

  let html = visibleLogs.map(log => {
    let displayTime = log.date;
    if (log.created_at) {
      const dateStr = log.created_at.endsWith('Z') || log.created_at.includes('+') ? log.created_at : log.created_at + 'Z';
      const d = new Date(dateStr);
      
      const yy = d.getFullYear().toString().slice(2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      
      displayTime = `${yy}.${mm}.${dd} ${hh}:${min}`;
    } else if (log.date) {
      displayTime = log.date.replace(/-/g, '.').substring(2);
    }
    let cleanNo = String(log.artNo || log.artno || "").trim();
    const digitsOnly = cleanNo.replace(/\D/g, '');
    if (digitsOnly.length > 0 && digitsOnly.length <= 8) {
      cleanNo = digitsOnly.padStart(8, '0');
    }
    let displayName = "";
    if (typeof masterCatalogMap !== 'undefined' && masterCatalogMap) {
      displayName = masterCatalogMap.get(cleanNo) || masterCatalogMap.get(digitsOnly) || "";
    }
    if (!displayName || displayName === "null") {
      displayName = (log.artName && log.artName !== "null") ? log.artName : ((log.artname && log.artname !== "null") ? log.artname : "기타 품목");
    }

    return `
    <div class="history-item type-${log.type}" style="display:flex; align-items:center; gap:10px;">
      ${typeof getProductThumbHtml === 'function' ? getProductThumbHtml(cleanNo, displayName, 44) : ''}
      <div class="hist-left" style="flex:1; min-width:0;">
        <span class="hist-date"><i class="fa-regular fa-clock"></i> ${displayTime} ${log.user ? '· ' + log.user : ''}</span>
        <div class="hist-name" style="word-break:break-all;">${displayName}</div>
        <span class="hist-artno">번호: ${cleanNo}</span>
      </div>
      <div class="hist-right" style="flex-shrink:0;">
        <span class="hist-badge type-${log.type}">${log.type}</span>
        <div class="hist-qty ${log.type === '입고' ? 'text-in' : 'text-out'}">
          ${log.type === '입고' ? '+' : '-'}${log.qty}개
        </div>
        <button type="button" class="btn-sm" style="background:#fee2e2; color:#b91c1c; border:none; padding:4px 8px; border-radius:4px; font-size:10px; margin-top:4px; cursor:pointer;" onclick="confirmDeleteHistoryLog('${log.id}')"><i class="fa-solid fa-trash"></i> 삭제</button>
      </div>
    </div>
    `;
  }).join("");
  
  if (typeof historyDisplayLimit !== 'undefined' && filteredLogs.length > historyDisplayLimit) {
    html += `
      <button type="button" class="btn-secondary" style="width:100%; margin-top:10px; padding:12px;" onclick="loadMoreHistoryLogs()">
        더 보기 (${visibleLogs.length} / ${filteredLogs.length})
      </button>
    `;
  }

  container.innerHTML = html;
  if (typeof loadProductThumbnails === 'function') loadProductThumbnails();
};


// Override renderPickList to add stock filtering and delete button
window.renderPickList = function() {
  const container = document.getElementById("picklist-container");
  if (!container) return;

  const pendingPicks = orderLogs.filter(item => {
    if (item.status !== "출고대기") return false;
    const stockQty = getItemStock(item.artNo);
    return stockQty > 0;
  });

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
  pendingPicks.forEach((item) => {
    let displayTime = item.date;
    if (item.created_at) {
      const dateStr = item.created_at.endsWith('Z') || item.created_at.includes('+') ? item.created_at : item.created_at + 'Z';
      const d = new Date(dateStr);
      const yy = d.getFullYear().toString().slice(2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      displayTime = `${yy}.${mm}.${dd} ${hh}:${min}`;
    } else if (item.date) {
      displayTime = item.date.replace(/-/g, '.').substring(2);
    }
    html += `
      <div class="history-item" style="border-left-color: #f59e0b; background-color: #fffbeb;">
        <div class="hist-left">
          <span class="hist-date"><i class="fa-regular fa-clock"></i> ${displayTime} · ${item.user} 요청</span>
          <div class="hist-name">${item.artName}</div>
          <span class="hist-artno">번호: ${item.artNo}</span>
        </div>
        <div class="hist-right" style="align-items:flex-end;">
          <div class="hist-qty" style="color: #b45309; font-size: 18px;">${item.qty}개</div>
          <div style="display:flex; flex-direction:column; gap:4px; margin-top:6px; width:100%;">
            <button type="button" class="btn-submit" style="background-color: #059669; font-size: 12px; padding: 8px 12px; display: flex; align-items: center; justify-content: center; gap: 4px;" onclick="completePickItem_custom('${item.id}')">
              <i class="fa-solid fa-check"></i> 챙김 완료
            </button>
            <button type="button" class="btn-sm" style="background:#fee2e2; color:#b91c1c; border:none; padding:6px 10px; border-radius:6px; font-size:11px; display:inline-flex; align-items:center; justify-content:center; gap:4px;" onclick="confirmDeletePickListItem('${item.id}', '${item.artName}')">
              <i class="fa-solid fa-trash"></i> 삭제
            </button>
          </div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
};

window.confirmDeletePickListItem = async function(id, artName) {
  if (confirm(`'${artName}' 창고 대기 목록(오더 요청)을 정말 삭제하시겠습니까?`)) {
    if (supabaseClient) {
      try {
        await supabaseClient.from("order_requests").delete().eq("id", id);
      } catch (err) {
        console.warn("Delete pick item error:", err);
      }
    }
    
    orderLogs = orderLogs.filter(log => String(log.id) !== String(id));
    try {
      localStorage.setItem("warehouse_order_logs", JSON.stringify(orderLogs));
    } catch (err) {}
    
    showToast("해당 대기 목록이 삭제되었습니다.", "success");
    renderOrderLogs();
    renderPickList();
  }
};

window.completePickItem_custom = async function(id) {
  const pickItem = orderLogs.find(log => String(log.id) === String(id));
  if (!pickItem || (pickItem.status !== "출고대기" && pickItem.status !== "요청" && pickItem.status !== "승인")) return;
  
  if (!confirm(`'${pickItem.artName}' ${pickItem.qty}개를 창고에서 챙겼습니까?\n(확인 시 즉시 출고 기록이 생성됩니다)`)) return;
  
  try {
    pickItem.status = "출고완료";
    if (supabaseClient && pickItem.id) {
      const { error: updateError } = await supabaseClient
        .from('order_requests')
        .update({ status: '출고완료' })
        .eq('id', pickItem.id);
        
      if (updateError) throw updateError;
    }
    
    const newLog = {
      date: new Date().toISOString().split('T')[0],
      type: "출고",
      artNo: pickItem.artNo,
      artName: pickItem.artName,
      qty: pickItem.qty,
      user: currentUser || "system",
      created_at: new Date().toISOString()
    };
    
    const insertedId = await saveHistoryLogs(newLog);
    historyLogs.unshift(newLog);
    invalidateStockCache();
    
    showToast(`'${pickItem.artName}' 출고가 완료되었습니다.`, "success");
    playSuccessFeedback();
    
    renderStockLookup();
    renderOrderLogs(); 
  } catch (err) {
    console.error("Pick complete error:", err);
    showToast("출고 완료 처리 실패 " + err.message, "danger");
  }
};




// --- Warehouse Location Setting Override ---
window.updateBulkSelection = function() {
  const checkboxes = document.querySelectorAll('.stock-checkbox:checked');
  const count = checkboxes.length;
  const bar = document.getElementById('bulk-action-bar');
  const countSpan = document.getElementById('bulk-count');
  
  if (count > 0) {
    countSpan.textContent = count;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
};

window.clearBulkSelection = function() {
  const checkboxes = document.querySelectorAll('.stock-checkbox:checked');
  checkboxes.forEach(cb => cb.checked = false);
  updateBulkSelection();
};

window.openBulkLocationModal = function() {
  const checkboxes = document.querySelectorAll('.stock-checkbox:checked');
  if (checkboxes.length === 0) return;
  document.getElementById('bulk-loc-count').textContent = checkboxes.length;
  document.getElementById('bulk-loc-modal').classList.add('active');
  
  const locCheckboxes = document.querySelectorAll('#bulk-loc-checkboxes input[type="checkbox"]');
  locCheckboxes.forEach(cb => cb.checked = false);
};

window.closeBulkLocationModal = function() {
  document.getElementById('bulk-loc-modal').classList.remove('active');
};

window.saveBulkLocation = async function() {
  const locCheckboxes = document.querySelectorAll('#bulk-loc-checkboxes input[type="checkbox"]:checked');
  if (locCheckboxes.length === 0) {
    showToast("적용할 위치를 선택해주세요.", "danger");
    return;
  }
  const locations = Array.from(locCheckboxes).map(cb => cb.value).join(", ");
  
  const itemCheckboxes = document.querySelectorAll('.stock-checkbox:checked');
  let updateCount = 0;
  const updates = [];
  
  itemCheckboxes.forEach(cb => {
    const artNo = cb.value;
    let masterItem = masterCatalog.find(m => m.artNo === artNo);
    if (masterItem) {
      masterItem.location = locations;
    } else {
      masterItem = { artNo: artNo, artName: "알 수 없음", location: locations, hfb: "기본 HFB" };
      masterCatalog.push(masterItem);
    }
    updates.push(masterItem);
    updateCount++;
  });
  
  if (updateCount > 0) {
    saveMasterCatalog(); // Save locally first
    
    // Sync to Supabase
    if (typeof supabaseClient !== "undefined" && supabaseClient) {
      try {
        let hasError = false;
        let lastErrorMsg = "";
        
        for (const item of updates) {
          const dbPayload = {
            artno: item.artNo,
            artname: item.artName,
            location: item.location,
            hfb: item.hfb || "기본 HFB"
          };
          
          if (item.id) {
            const { error } = await supabaseClient.from("master_catalog").update(dbPayload).eq("id", item.id);
            if (error) { hasError = true; lastErrorMsg = error.message; }
          } else {
            const { data: existing, error: selErr } = await supabaseClient.from("master_catalog").select("id").eq("artno", item.artNo).maybeSingle();
            if (existing) {
              item.id = existing.id;
              const { error: updErr } = await supabaseClient.from("master_catalog").update(dbPayload).eq("id", existing.id);
              if (updErr) { hasError = true; lastErrorMsg = updErr.message; }
            } else {
              const { data: inserted, error: insErr } = await supabaseClient.from("master_catalog").insert([dbPayload]).select();
              if (insErr) { hasError = true; lastErrorMsg = insErr.message; }
              else if (inserted && inserted.length > 0) item.id = inserted[0].id;
            }
          }
        }
        
        if (hasError) {
          console.error("Supabase bulk location update error:", lastErrorMsg);
          showToast("일부 항목 서버 동기화 실패: " + lastErrorMsg, "danger");
        }
      } catch (err) {
        console.error("Supabase bulk location exception:", err);
        showToast("서버 동기화 오류: " + err.message, "danger");
      }
    }
    
    showToast(`${updateCount}개 품목의 위치가 [${locations}] (으)로 변경되었습니다.`, "success");
    playSuccessFeedback(); // Add Vibration / Sound
    
    closeBulkLocationModal();
    clearBulkSelection();
    renderStockLookup();
  }
};

const originalRenderStockLookup = window.renderStockLookup;
window.renderStockLookup = function() {
  const container = document.getElementById("stock-cards-container");
  if (!container) return;

  populateStockHFBDropdown();

  const searchQuery = document.getElementById("stock-search").value.trim().toLowerCase();
  const stockMap = buildStockMap();

  const stockList = [];
  stockMap.forEach(item => {
    let loc = "미지정";
    if (!item.hfb) {
      const matchedMaster = masterCatalog.find(m => m.artNo === item.artNo);
      item.hfb = matchedMaster ? matchedMaster.hfb || "기본 HFB" : "기본 HFB";
      loc = matchedMaster ? matchedMaster.location || "미지정" : "미지정";
    } else {
      const matchedMaster = masterCatalog.find(m => m.artNo === item.artNo);
      loc = matchedMaster ? matchedMaster.location || "미지정" : "미지정";
    }
    item.location = loc;
    stockList.push(item);
  });

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

  filteredList.sort((a, b) => {
    if (currentStockSort === "stock-desc") return b.currentStock - a.currentStock;
    if (currentStockSort === "stock-asc") return a.currentStock - b.currentStock;
    if (currentStockSort === "name-asc") return a.artName.localeCompare(b.artName, "ko");
    if (currentStockSort === "artno-asc") return a.artNo.localeCompare(b.artNo);
    if (currentStockSort === "loc-asc") return (a.location || "").localeCompare(b.location || "", "ko");
    return 0;
  });

  document.getElementById("stock-count-text").textContent = `${filteredList.length}개 품목`;

  if (filteredList.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: #94a3b8; background:#fff; border-radius:14px; border:1px dashed #cbd5e1;">
        <i class="fa-solid fa-box-open" style="font-size: 40px; margin-bottom: 12px; color:#cbd5e1;"></i>
        <p style="font-weight:700; color:#64748b;">조건에 맞는 재고 기록이 없습니다.</p>
        <button type="button" class="btn-secondary sm" style="margin-top:12px;" onclick="resetStockFilters()">
          <i class="fa-solid fa-rotate-left"></i> 전체 보기로 필터 초기화
        </button>
      </div>
    `;
    return;
  }

  const visibleList = filteredList.slice(0, stockDisplayLimit);

  let html = visibleList.map(item => {
    const isOut = item.currentStock <= 0;
    const isLow = item.currentStock > 0 && item.currentStock <= 5;
    
    const cardClass = isOut ? "simple-stock-card out" : isLow ? "simple-stock-card low" : "simple-stock-card";
    const statusText = isOut ? "품절" : isLow ? "부족" : "안전";
    const statusClass = isOut ? "status-out" : isLow ? "status-low" : "status-good";

    return `
      <div class="${cardClass} stock-card-item" data-artno="${item.artNo}" style="position:relative; display:flex; align-items:stretch; padding:12px; gap:12px; border-radius:12px; background:#fff; border:1px solid #e2e8f0; margin-bottom:10px;">
        <!-- Checkbox -->
        <div style="position:absolute; top:8px; left:8px; z-index:2;">
          <input type="checkbox" class="stock-checkbox" value="${item.artNo}" onchange="updateBulkSelection()" style="width:18px; height:18px; accent-color:#2563eb; cursor:pointer;">
        </div>

        <!-- Left: Product Image -->
        <div style="display:flex; align-items:center; justify-content:center; padding-left:18px; flex-shrink:0;">
          ${getProductThumbHtml(item.artNo, item.artName, 68)}
        </div>

        <!-- Center: Info & Bottom Action Buttons -->
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; justify-content:space-between; gap:6px;">
          <!-- Line 1: HFB & ArtNo -->
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            ${item.hfb ? `<span style="background:#e0f2fe; color:#0369a1; font-size:11px; font-weight:700; padding:2px 6px; border-radius:4px;">${item.hfb}</span>` : ''}
            <span class="ssc-artno" style="font-size:13px; font-weight:800; color:#334155;">${item.artNo}</span>
          </div>

          <!-- Line 2: Product Name -->
          <div style="font-size:13px; font-weight:800; color:#0f172a; line-height:1.3; word-break:break-all;">
            ${item.artName}${(item.artName.includes("알 수 없") || item.artName.includes("품목명 없") || item.artName.includes("신규") || item.artName.includes("기타") || item.artName === "") ? `<button type="button" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; border-radius:4px; padding:2px 6px; font-size:10px; cursor:pointer; flex-shrink:0; margin-left:4px;" onclick="openEditItemNameModal('${item.artNo}', '${item.artName.replace(/'/g, "\\'")}')"><i class="fa-solid fa-pen"></i> 이름 수정</button>` : ""}
          </div>

          <!-- Line 3: Location / Zone -->
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="background:#f8fafc; color:#64748b; font-weight:700; font-size:11px; padding:2px 6px; border-radius:4px; display:inline-flex; align-items:center; gap:4px; border:1px solid #cbd5e1;">
              <i class="fa-solid fa-map-pin"></i> 구역: ${item.location}
            </span>
            <button type="button" style="background:#e0f2fe; color:#0284c7; border:none; font-size:10px; font-weight:800; padding:3px 6px; border-radius:4px; cursor:pointer;" onclick="setSingleLocation('${item.artNo}')">구역 변경</button>
          </div>

          <!-- Line 4: Quick Action Buttons at the bottom -->
          <div class="ssc-quick-btns" style="display:flex; gap:8px; margin-top:4px;">
            <button type="button" class="btn-sm btn-quick-in" style="flex:1; padding:6px 12px; font-size:12px; font-weight:700; border-radius:6px;" onclick="quickActionRegister('${item.artNo}', '입고')">입고</button>
            <button type="button" class="btn-sm btn-quick-out" style="flex:1; padding:6px 12px; font-size:12px; font-weight:700; border-radius:6px;" onclick="quickActionRegister('${item.artNo}', '출고')">출고</button>
          </div>
        </div>

        <!-- Right: Status Badge & Stock Qty -->
        <div class="ssc-right" style="display:flex; flex-direction:column; align-items:flex-end; justify-content:flex-start; gap:8px; min-width:50px; flex-shrink:0;">
          <span class="ssc-status ${statusClass}" style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700;">${statusText}</span>
          <div class="ssc-qty" style="display:flex; align-items:baseline; gap:2px; margin-top:4px;">
            <span class="ssc-num ${isOut ? 'text-danger' : isLow ? 'text-warning' : 'text-primary'}" style="font-size:20px; font-weight:900;">${item.currentStock}</span>
            <span class="ssc-unit" style="font-size:12px; color:#64748b; font-weight:700;">개</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  if (filteredList.length > stockDisplayLimit) {
    html += `
      <div style="text-align: center; margin-top: 15px;">
        <button type="button" class="btn-secondary" onclick="loadMoreStockItems()">더 보기 <i class="fa-solid fa-chevron-down"></i></button>
      </div>
    `;
  }

  container.innerHTML = html;
  loadProductThumbnails();
  
  // Re-check selected if they were checked before rendering
  const checkedNos = Array.from(document.querySelectorAll('#bulk-action-bar')[0].style.display !== 'none' ? document.querySelectorAll('.stock-checkbox:checked') : []).map(cb => cb.value);
  if (checkedNos.length > 0) {
    document.querySelectorAll('.stock-checkbox').forEach(cb => {
      if (checkedNos.includes(cb.value)) cb.checked = true;
    });
    updateBulkSelection();
  }
};


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

window.deleteOrderLog = async function(index) {
  if (typeof orderLogs === "undefined" || !orderLogs[index]) return;
  const targetOrder = orderLogs[index];
  const artName = targetOrder.artName || targetOrder.artNo;
  
  if (!confirm(`'${artName}' 오더 요청을 정말 삭제하시겠습니까?`)) return;
  
  const orderId = targetOrder.id;
  orderLogs.splice(index, 1);
  
  if (typeof supabaseClient !== "undefined" && supabaseClient && orderId) {
    try {
      await supabaseClient.from('order_requests').delete().eq('id', orderId);
    } catch (e) {
      console.warn("Delete order error:", e);
    }
  }
  
  if (typeof showToast === "function") showToast(`'${artName}' 오더 요청이 삭제되었습니다.`, "success");
  if (typeof renderOrderLogs === "function") renderOrderLogs();
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
    if (statusText === '승인' || statusText === '수락') { bgColor = '#dcfce7'; textColor = '#166534'; }
    if (statusText === '반려' || statusText === '보류') { bgColor = '#fee2e2'; textColor = '#991b1b'; }
    if (statusText === '출고대기') { bgColor = '#fef3c7'; textColor = '#b45309'; }
    if (statusText === '완료') { bgColor = '#f3f4f6'; textColor = '#4b5563'; }

    let statusHtml = `<span class="hist-badge" style="background-color: ${bgColor}; color: ${textColor};">${statusText}</span>`;
    
    if (typeof isAdminUser !== "undefined" && isAdminUser) {
      statusHtml = `
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          ${statusHtml}
          <div style="display:flex; gap:4px; margin-top:2px;">
            <button type="button" onclick="updateOrderStatus(${index}, '수락')" style="font-size:10px; padding:2px 7px; border:none; background:#16a34a; color:white; border-radius:4px; font-weight:700; cursor:pointer;">수락</button>
            <button type="button" onclick="updateOrderStatus(${index}, '보류')" style="font-size:10px; padding:2px 7px; border:none; background:#d97706; color:white; border-radius:4px; font-weight:700; cursor:pointer;">보류</button>
            <button type="button" onclick="deleteOrderLog(${index})" style="font-size:10px; padding:2px 7px; border:1px solid #fca5a5; background:#fee2e2; color:#dc2626; border-radius:4px; font-weight:700; cursor:pointer;">삭제</button>
          </div>
        </div>
      `;
    } else {
      statusHtml = `
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          ${statusHtml}
          <div style="display:flex; gap:4px; margin-top:2px;">
            <button type="button" onclick="deleteOrderLog(${index})" style="font-size:10px; padding:2px 7px; border:1px solid #fca5a5; background:#fee2e2; color:#dc2626; border-radius:4px; font-weight:700; cursor:pointer;">삭제</button>
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
    } else if (item.date) {
      displayTime = item.date.replace(/-/g, '.').substring(2);
    }

    return `
    <div class="history-item" style="border-left-color: #6366f1;">
      <div class="hist-left" style="flex:0 0 auto; margin-right:8px;">
        <input type="checkbox" class="order-checkbox" data-index="${index}" onchange="updateOrderBulkSelection()" style="width:20px; height:20px; accent-color:#6366f1; cursor:pointer;">
      </div>
      ${getProductThumbHtml(item.artNo, item.artName, 44)}
      <div class="hist-left" style="margin-left:8px;">
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
        
        ${getProductThumbHtml(item.artNo, item.artName, 48)}

        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="white-space:nowrap; display:inline-flex; align-items:center; gap:4px; background:#f1f5f9; color:#2563eb; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px;"><i class="fa-solid fa-location-dot"></i> ${item.location}</span>
            <span style="font-size:12px; font-weight:bold; color:#475569;">${item.artNo}</span>
          </div>
          <div style="font-size:13px; font-weight:bold; margin-top:4px; word-break:break-word;">${item.artName}</div>
          <div style="font-size:11px; color:#64748b; margin-top:2px;">현재 재고: ${item.currentStock}개</div>
        </div>
        
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px; flex-shrink:0;">
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
        ${getProductThumbHtml(item.artNo, item.artName, 48)}

        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="white-space:nowrap; display:inline-flex; align-items:center; gap:4px; background:#f1f5f9; color:#2563eb; font-size:10px; font-weight:800; padding:2px 8px; border-radius:12px;"><i class="fa-solid fa-location-dot"></i> ${item.location}</span>
            <span style="font-size:13px; font-weight:bold; color:#64748b; letter-spacing:0.5px;">${item.artNo}</span>
          </div>
          <div style="font-size:14px; font-weight:800; color:#0f172a; margin-top:4px; line-height:1.2; word-break:break-word;">${item.artName}</div>
          <div style="font-size:11px; color:#64748b; margin-top:4px;">창고 잔여 재고: <strong style="color:#059669;">${item.currentStock}개</strong></div>
        </div>
        
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px; flex-shrink:0;">
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

window.currentPicklistLocation = "전체";

window.renderStandardLocationButtons = function() {
  const container = document.getElementById("picklist-location-buttons");
  if (!container) return;
  
  const stockMap = buildStockMap();
  const locations = new Set();
  
  stockMap.forEach(item => {
    if (item.location && item.location !== "미지정" && item.location.trim() !== "") {
      const locs = item.location.split(',').map(l => l.trim());
      locs.forEach(l => {
        if (l) locations.add(l);
      });
    }
  });
  
  const locArray = Array.from(locations).sort();
  
  let html = `<button type="button" style="padding:8px 16px; border-radius:20px; font-size:14px; font-weight:bold; white-space:nowrap; border:none; cursor:pointer; ${window.currentPicklistLocation === '전체' ? 'background:#0f172a; color:white;' : 'background:#e2e8f0; color:#475569;'}" onclick="setPicklistLocation('전체')">모든 구역</button>`;
  locArray.forEach(loc => {
    html += `<button type="button" style="padding:8px 16px; border-radius:20px; font-size:14px; font-weight:bold; white-space:nowrap; border:none; cursor:pointer; ${window.currentPicklistLocation === loc ? 'background:#0f172a; color:white;' : 'background:#e2e8f0; color:#475569;'}" onclick="setPicklistLocation('${loc}')">${loc}</button>`;
  });
  
  container.innerHTML = html;
  
  renderStandardInventory();
};

window.setPicklistLocation = function(loc) {
  window.currentPicklistLocation = loc;
  renderStandardLocationButtons();
};

window.renderStandardInventory = function() {
  const container = document.getElementById("picklist-standard-inventory");
  if (!container) return;
  
  const selectedLocation = window.currentPicklistLocation;
  
  const stockMap = buildStockMap();
  let inventory = Array.from(stockMap.values()).filter(item => item.currentStock > 0);
  
  if (selectedLocation !== "전체") {
    inventory = inventory.filter(item => item.location && item.location.includes(selectedLocation));
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
      <label class="stock-card" style="display:flex; align-items:center; padding:15px; margin-bottom:12px; border-radius:12px; background:#ffffff; box-shadow:0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03); border:1px solid #e2e8f0; gap:12px; cursor:pointer; transition:all 0.2s ease;">
        <div style="display:flex; align-items:center; justify-content:center; width:24px; height:24px; flex-shrink:0;">
          <input type="checkbox" class="std-picklist-cb" data-artno="${item.artNo}" data-artname="${item.artName.replace(/"/g, "&quot;")}" data-maxqty="${item.currentStock}" style="width:20px; height:20px; accent-color:#0ea5e9; cursor:pointer; transform:scale(1.2);">
        </div>
        
        ${getProductThumbHtml(item.artNo, item.artName, 52)}

        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="white-space:nowrap; display:inline-flex; align-items:center; gap:4px; background:#f0f9ff; color:#0369a1; font-size:12px; font-weight:800; padding:4px 8px; border-radius:6px; border:1px solid #bae6fd;"><i class="fa-solid fa-map-pin"></i> ${item.location || '미지정'}</span>
            <span style="font-size:13px; font-weight:bold; color:#64748b; letter-spacing:0.5px;">${item.artNo}</span>
          </div>
          <div style="font-size:15px; font-weight:900; margin-top:6px; color:#1e293b; word-break:break-all; overflow-wrap:anywhere;">${item.artName}</div>
          <div style="font-size:12px; color:#64748b; margin-top:4px; font-weight:600;"><i class="fa-solid fa-box"></i> 잔여 재고: <span style="color:#0ea5e9;">${item.currentStock}개</span></div>
        </div>
        
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px; padding-left:10px; border-left:1px dashed #e2e8f0; flex-shrink:0;">
          <span style="font-size:12px; font-weight:bold; color:#475569;">챙길 수량</span>
          <input type="number" id="std-qty-${item.artNo}" value="${item.currentStock}" min="1" max="${item.currentStock}" onclick="event.stopPropagation();" onkeyup="event.stopPropagation();" style="width:70px; padding:8px; text-align:center; border:2px solid #e2e8f0; border-radius:8px; font-size:15px; font-weight:bold; color:#0f172a; outline:none; transition:border-color 0.2s;" onfocus="this.style.borderColor='#0ea5e9'" onblur="this.style.borderColor='#e2e8f0'">
        </div>
      </label>
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
window.switchTab = function(tabId, btnElement) {
  if (typeof origSwitchTabStandard === "function") origSwitchTabStandard(tabId, btnElement);
  
  if (tabId === "picklist") {
    renderStandardLocationButtons();
    renderStandardPickList();
  }
};

const origCompletePickItemStandard = window.completePickItem_custom;
window.completePickItem_custom = async function(id) {
  if (typeof origCompletePickItemStandard === "function") {
    await origCompletePickItemStandard(id);
    
    const activeTab = document.querySelector('.tab-page.active');
    if (activeTab && activeTab.id === "tab-picklist") {
      renderStandardLocationButtons();
      renderStandardPickList();
    }
  }
};
let currentSingleLocArtNo = null;

window.setSingleLocation = function(artNo) {
  let masterItem = masterCatalog.find(m => m.artNo === artNo);
  currentSingleLocArtNo = artNo;
  
  const artName = masterItem ? masterItem.artName : "알 수 없음";
  const currentLoc = masterItem && masterItem.location ? masterItem.location : "미지정";
  
  document.getElementById("single-loc-artname").innerHTML = `[${artNo}] ${artName} <br><span style="color:#2563eb; font-weight:normal; font-size:12px;">(현재 구역: ${currentLoc})</span>`;
  document.getElementById("single-loc-modal").classList.add("active");
};

window.closeSingleLocationModal = function() {
  document.getElementById("single-loc-modal").classList.remove("active");
  currentSingleLocArtNo = null;
};

window.saveSingleLocation = async function(locStr) {
  if (!currentSingleLocArtNo) return;
  const artNo = currentSingleLocArtNo;
  
  let masterItem = masterCatalog.find(m => m.artNo === artNo);
  
  if (masterItem) {
    masterItem.location = locStr;
  } else {
    masterItem = { artNo: artNo, artName: "알 수 없음", location: locStr, hfb: "기본 HFB" };
    masterCatalog.push(masterItem);
  }
  
  saveMasterCatalog(); // Save locally
  
  // Sync to Supabase
  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    try {
      const dbPayload = {
        artno: masterItem.artNo,
        artname: masterItem.artName,
        location: masterItem.location,
        hfb: masterItem.hfb || "기본 HFB"
      };
      
      let hasError = false;
      let lastErrorMsg = "";
      
      if (masterItem.id) {
        const { error } = await supabaseClient.from("master_catalog").update(dbPayload).eq("id", masterItem.id);
        if (error) { hasError = true; lastErrorMsg = error.message; }
      } else {
        const { data: existing, error: selErr } = await supabaseClient.from("master_catalog").select("id").eq("artno", masterItem.artNo).maybeSingle();
        if (existing) {
          masterItem.id = existing.id;
          const { error: updErr } = await supabaseClient.from("master_catalog").update(dbPayload).eq("id", existing.id);
          if (updErr) { hasError = true; lastErrorMsg = updErr.message; }
        } else {
          const { data: inserted, error: insErr } = await supabaseClient.from("master_catalog").insert([dbPayload]).select();
          if (insErr) { hasError = true; lastErrorMsg = insErr.message; }
          else if (inserted && inserted.length > 0) masterItem.id = inserted[0].id;
        }
      }
      
      if (hasError) {
        console.error("Supabase single location update error:", lastErrorMsg);
        showToast("서버 동기화 실패: " + lastErrorMsg, "danger");
      }
    } catch (err) {
      console.error("Supabase single location exception:", err);
      showToast("서버 동기화 오류: " + err.message, "danger");
    }
  }
  
  showToast(`해당 품목의 위치가 [${locStr}] (으)로 변경되었습니다.`, "success");
  playSuccessFeedback();
  renderStockLookup();
};

// --- Notice Popup Logic ---
window.checkNoticePopup = function(isAdminUser) {
  const isGuest = (typeof currentUser !== 'undefined' && currentUser && currentUser.toLowerCase().startsWith('guest'));
  
  if (isGuest) {
    const hideUntil = localStorage.getItem('warehouse_guest_manual_hide_until');
    if (hideUntil) {
      const hideDate = new Date(hideUntil);
      if (new Date() < hideDate) return;
    }
    const modal = document.getElementById('guest-manual-modal');
    if (modal) {
      modal.classList.add('active');
      if (typeof initGuestManualSignature === 'function') initGuestManualSignature();
      if (typeof nextGuestManualPage === 'function') nextGuestManualPage(1);
    }
  } else {
    const hideUntil = localStorage.getItem('warehouse_notice_hide_until');
    if (hideUntil) {
      const hideDate = new Date(hideUntil);
      if (new Date() < hideDate) return;
    }
    const modal = document.getElementById('notice-modal');
    if (modal) {
      modal.classList.add('active');
      initNoticeSignature();
    }
  }
};

let noticeSigCanvas, noticeSigCtx;
let isNoticeDrawing = false;
let noticeHasSignature = false;

function initNoticeSignature() {
  noticeSigCanvas = document.getElementById('notice-signature-pad');
  if (!noticeSigCanvas) return;
  noticeSigCtx = noticeSigCanvas.getContext('2d');
  
  const rect = noticeSigCanvas.getBoundingClientRect();
  noticeSigCanvas.width = rect.width;
  noticeSigCanvas.height = rect.height;
  
  noticeSigCtx.lineWidth = 2;
  noticeSigCtx.lineCap = 'round';
  noticeSigCtx.strokeStyle = '#0f172a';
  
  noticeSigCanvas.addEventListener('mousedown', noticeStartDraw);
  noticeSigCanvas.addEventListener('mousemove', noticeDraw);
  noticeSigCanvas.addEventListener('mouseup', noticeStopDraw);
  noticeSigCanvas.addEventListener('mouseout', noticeStopDraw);
  
  noticeSigCanvas.addEventListener('touchstart', noticeStartDraw, {passive: false});
  noticeSigCanvas.addEventListener('touchmove', noticeDraw, {passive: false});
  noticeSigCanvas.addEventListener('touchend', noticeStopDraw);
}

function noticeStartDraw(e) {
  e.preventDefault();
  isNoticeDrawing = true;
  noticeHasSignature = true;
  const pos = noticeGetPos(e);
  noticeSigCtx.beginPath();
  noticeSigCtx.moveTo(pos.x, pos.y);
}

function noticeDraw(e) {
  if (!isNoticeDrawing) return;
  e.preventDefault();
  const pos = noticeGetPos(e);
  noticeSigCtx.lineTo(pos.x, pos.y);
  noticeSigCtx.stroke();
}

function noticeStopDraw() {
  isNoticeDrawing = false;
}

function noticeGetPos(e) {
  const rect = noticeSigCanvas.getBoundingClientRect();
  let clientX = e.clientX;
  let clientY = e.clientY;
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  }
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

window.clearNoticeSignature = function() {
  if (!noticeSigCtx || !noticeSigCanvas) return;
  noticeSigCtx.clearRect(0, 0, noticeSigCanvas.width, noticeSigCanvas.height);
  noticeSigCtx.beginPath();
  noticeHasSignature = false;
};

window.confirmNoticeModal = function() {
  const nameInput = document.getElementById('notice-signature-name');
  if (!nameInput || !nameInput.value.trim()) {
    alert('이름을 입력해주세요.');
    return;
  }
  if (!noticeHasSignature) {
    alert('서명을 입력해주세요.');
    return;
  }
  try {
    if (typeof saveSignatureHistory === 'function') saveSignatureHistory(nameInput.value.trim(), '관리자');
  } catch (e) {
    console.error("Signature save error:", e);
  }
  
  const hideCheckbox = document.getElementById('notice-hide-week');
  if (hideCheckbox && hideCheckbox.checked) {
    try {
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      localStorage.setItem('warehouse_notice_hide_until', nextWeek.toISOString());
    } catch (e) { console.warn("localStorage error", e); }
  }
  
  document.getElementById('notice-modal').classList.remove('active');
};

window.updateAllBadges = function() {
  if (typeof orderLogs === "undefined" || !orderLogs) return;
  
  const pendingPicks = orderLogs.filter(item => item.status === "요청" || item.status === "보류");
  const activeOrders = orderLogs.filter(item => !item.status || item.status === "요청됨" || item.status === "보류");

  const badgePicklist = document.getElementById("badge-picklist");
  if (badgePicklist) {
    if (pendingPicks.length > 0) {
      badgePicklist.textContent = pendingPicks.length;
      badgePicklist.style.display = "inline-flex";
      badgePicklist.style.backgroundColor = "#ef4444";
      badgePicklist.style.position = "absolute";
      badgePicklist.style.top = "10px";
      badgePicklist.style.right = "10px";
    } else {
      badgePicklist.style.display = "none";
    }
  }

  const badgeOrder = document.getElementById("badge-order");
  if (badgeOrder) {
    if (activeOrders.length > 0) {
      badgeOrder.textContent = activeOrders.length;
      badgeOrder.style.display = "inline-flex";
      badgeOrder.style.backgroundColor = "#3b82f6";
      badgeOrder.style.position = "absolute";
      badgeOrder.style.top = "10px";
      badgeOrder.style.right = "10px";
    } else {
      badgeOrder.style.display = "none";
    }
  }

  const badgeMenuMain = document.getElementById("badge-menu-main");
  if (badgeMenuMain) {
    const totalCount = pendingPicks.length + activeOrders.length;
    if (totalCount > 0) {
      badgeMenuMain.textContent = totalCount;
      badgeMenuMain.style.display = "inline-flex";
      badgeMenuMain.style.backgroundColor = "#ef4444";
    } else {
      badgeMenuMain.style.display = "none";
    }
  }
};

window.exportStockToExcel = function() {
  if (typeof isAdminUser === "undefined" || !isAdminUser) {
    if (typeof showToast === "function") showToast("접근 권한이 없습니다. (관리자 전용)", "danger");
    return;
  }

  const stockMap = typeof buildStockMap === "function" ? buildStockMap() : new Map();
  if (stockMap.size === 0) {
    if (typeof showToast === "function") showToast("추출할 재고 데이터가 없습니다.", "danger");
    return;
  }

  const exportData = [];
  let index = 1;
  stockMap.forEach((data, artNo) => {
    let artName = "알 수 없는 품목";
    if (typeof masterCatalogMap !== "undefined" && masterCatalogMap.has(artNo)) {
      artName = masterCatalogMap.get(artNo);
    } else if (data.artName) {
      artName = data.artName;
    }
    
    exportData.push({
      "연번": index++,
      "아티클 이름": artName,
      "번호 (ARTNO)": artNo,
      "재고 수량": data.currentStock !== undefined ? data.currentStock : 0,
      "위치": data.location || "미지정"
    });
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "재고현황");

  const todayStr = new Date().toISOString().split("T")[0];
  XLSX.writeFile(workbook, `창고재고현황_${todayStr}.xlsx`);
  if (typeof showToast === "function") showToast("관리자 권한으로 엑셀 파일(.xlsx) 추출이 시작되었습니다!", "success");
};

// --- Guest Manual Modal Logic ---
let guestManualSigPad = null;
let guestManualSigCtx = null;
let guestManualHasSignature = false;
let currentGuestManualPage = 1;

window.initGuestManualSignature = function() {
  const canvas = document.getElementById('guest-manual-signature-pad');
  if (!canvas) return;
  
  guestManualSigPad = canvas;
  guestManualSigCtx = canvas.getContext('2d');
  
  const resizeCanvas = () => {
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth - 2;
    canvas.height = 120;
    if (typeof clearGuestSignature === 'function') clearGuestSignature();
  };
  resizeCanvas();
  
  let drawing = false;
  
  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  
  const startDraw = (e) => {
    e.preventDefault();
    drawing = true;
    guestManualHasSignature = true;
    const pos = getPos(e);
    guestManualSigCtx.beginPath();
    guestManualSigCtx.moveTo(pos.x, pos.y);
  };
  
  const draw = (e) => {
    e.preventDefault();
    if (!drawing) return;
    const pos = getPos(e);
    guestManualSigCtx.lineTo(pos.x, pos.y);
    guestManualSigCtx.strokeStyle = "#0f172a";
    guestManualSigCtx.lineWidth = 2;
    guestManualSigCtx.lineCap = "round";
    guestManualSigCtx.stroke();
  };
  
  const endDraw = (e) => {
    e.preventDefault();
    drawing = false;
    guestManualSigCtx.beginPath();
  };
  
  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseleave', endDraw);
  
  canvas.addEventListener('touchstart', startDraw, {passive: false});
  canvas.addEventListener('touchmove', draw, {passive: false});
  canvas.addEventListener('touchend', endDraw);
};

window.clearGuestSignature = function() {
  if (!guestManualSigCtx || !guestManualSigPad) return;
  guestManualSigCtx.clearRect(0, 0, guestManualSigPad.width, guestManualSigPad.height);
  guestManualSigCtx.beginPath();
  guestManualHasSignature = false;
};

window.nextGuestManualPage = function(pageNumber) {
  document.querySelectorAll('.guest-manual-page').forEach(page => {
    page.style.display = 'none';
  });
  
  const targetPage = document.getElementById(`guest-manual-page-${pageNumber}`);
  if (targetPage) {
    targetPage.style.display = 'block';
  }
  
  currentGuestManualPage = pageNumber;
};

window.confirmGuestManualModal = function() {
  const nameInput = document.getElementById('guest-signature-name');
  if (!nameInput || !nameInput.value.trim()) {
    alert('이름을 입력해주세요.');
    return;
  }
  if (!guestManualHasSignature) {
    alert('서명을 입력해주세요.');
    return;
  }
  try {
    if (typeof saveSignatureHistory === 'function') saveSignatureHistory(nameInput.value.trim(), '게스트');
  } catch (e) {
    console.error("Signature save error:", e);
  }
  
  const hideCheckbox = document.getElementById('guest-manual-hide-day');
  if (hideCheckbox && hideCheckbox.checked) {
    try {
      const nextDay = new Date();
      nextDay.setDate(nextDay.getDate() + 1);
      localStorage.setItem('warehouse_guest_manual_hide_until', nextDay.toISOString());
    } catch (e) { console.warn("localStorage error", e); }
  }
  
  document.getElementById('guest-manual-modal').classList.remove('active');
};

window.saveSignatureHistory = function(name, role) {
  let history = [];
  try {
    const data = localStorage.getItem('warehouse_signature_history');
    if (data) history = JSON.parse(data);
  } catch(e) {}
  
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  
  history.unshift({ name, role, date: dateStr, account: typeof currentUser !== "undefined" ? currentUser : "unknown" });
  
  const twoDaysAgo = Date.now() - (48 * 60 * 60 * 1000);
  history = history.filter(item => {
    if (!item.date) return false;
    const itemDate = new Date(item.date).getTime();
    return itemDate > twoDaysAgo;
  });
  
  if (history.length > 100) history = history.slice(0, 100);
  
  localStorage.setItem('warehouse_signature_history', JSON.stringify(history));
};

window.openSigHistoryModal = function() {
  const modal = document.getElementById('sig-history-modal');
  const listContainer = document.getElementById('sig-history-list');
  if (!modal || !listContainer) return;
  
  let history = [];
  try {
    const data = localStorage.getItem('warehouse_signature_history');
    if (data) history = JSON.parse(data);
  } catch(e) {}
  
  // Cleanup old history (keep only 48 hours)
  const twoDaysAgo = Date.now() - (48 * 60 * 60 * 1000);
  history = history.filter(item => {
    if (!item.date) return false;
    const itemDate = new Date(item.date).getTime();
    return itemDate > twoDaysAgo;
  });
  
  if (history.length === 0) {
    listContainer.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:20px 0;">서명 기록이 없습니다.</div>';
  } else {
    listContainer.innerHTML = history.map(item => `
      <div style="padding:10px; border:1px solid #e2e8f0; border-radius:6px; background:#f8fafc; font-size:13px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span style="font-weight:bold; color:#0f172a;">${item.name}</span>
          <span style="color:#64748b; font-size:12px;">${item.date}</span>
        </div>
        <div style="color:#475569;">계정: ${item.account} / 유형: ${item.role}</div>
      </div>
    `).join('');
  }
  
  modal.classList.add('active');
};

window.closeSigHistoryModal = function() {
  const modal = document.getElementById('sig-history-modal');
  if (modal) modal.classList.remove('active');
};

// --- Edit Unknown Item Name Logic ---
let currentEditItemNameArtNo = null;

window.openEditItemNameModal = function(artNo, currentName) {
  currentEditItemNameArtNo = artNo;
  
  let modal = document.getElementById("edit-item-name-modal");
  if (!modal) {
    const modalHtml = `
      <div id="edit-item-name-modal" class="modal-backdrop" onclick="closeEditItemNameModal()">
        <div class="modal-content" style="max-width: 400px;" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h3>품목명 수정</h3>
            <button type="button" class="close-btn" onclick="closeEditItemNameModal()"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            <p style="font-size:13px; color:#64748b; margin-bottom:15px;">알 수 없는 품목의 이름을 지정합니다.</p>
            <div class="form-group">
              <label>아티클 번호</label>
              <input type="text" id="edit-item-name-artno" readonly style="background:#f8fafc; font-weight:bold; color:#475569;">
            </div>
            <div class="form-group">
              <label>새 품목명</label>
              <input type="text" id="edit-item-name-input" placeholder="정확한 품목명을 입력하세요">
            </div>
            <button type="button" class="btn-submit" style="width:100%; margin-top:10px;" onclick="saveEditItemName()">저장 및 동기화</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML("beforeend", modalHtml);
    modal = document.getElementById("edit-item-name-modal");
  }
  
  document.getElementById("edit-item-name-artno").value = artNo;
  document.getElementById("edit-item-name-input").value = currentName === "알 수 없는 품목" || currentName === "알 수 없음" || currentName.includes("품목") ? "" : currentName;
  
  modal.classList.add("active");
  setTimeout(() => document.getElementById("edit-item-name-input").focus(), 100);
};

window.closeEditItemNameModal = function() {
  const modal = document.getElementById("edit-item-name-modal");
  if (modal) modal.classList.remove("active");
  currentEditItemNameArtNo = null;
};

window.saveEditItemName = async function() {
  if (!currentEditItemNameArtNo) return;
  const artNo = currentEditItemNameArtNo;
  const newName = document.getElementById("edit-item-name-input").value.trim();
  
  if (!newName) {
    showToast("품목명을 입력해주세요.", "danger");
    return;
  }
  
  // 1. Update Master Catalog
  let masterItem = masterCatalog.find(m => m.artNo === artNo);
  if (masterItem) {
    masterItem.artName = newName;
  } else {
    masterItem = { artNo: artNo, artName: newName, location: "미지정", hfb: "기본 HFB" };
    masterCatalog.push(masterItem);
  }
  
  saveMasterCatalog();
  rebuildMasterCatalogMap();
  
  // 2. Update History Logs
  let historyUpdated = false;
  historyLogs.forEach(log => {
    if (log.artNo === artNo) {
      log.artName = newName;
      historyUpdated = true;
    }
  });
  if (historyUpdated) {
    try {
      localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
    } catch(e){}
  }
  
  // 3. Update Order Logs
  let orderUpdated = false;
  orderLogs.forEach(log => {
    if (log.artNo === artNo) {
      log.artName = newName;
      orderUpdated = true;
    }
  });
  if (orderUpdated) {
    try {
      localStorage.setItem("warehouse_order_logs", JSON.stringify(orderLogs));
    } catch(e){}
  }
  
  // 4. Sync to Supabase
  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    try {
      // Sync master_catalog
      const dbPayload = {
        artno: masterItem.artNo,
        artname: masterItem.artName,
        location: masterItem.location || "미지정",
        hfb: masterItem.hfb || "기본 HFB"
      };
      
      if (masterItem.id) {
        await supabaseClient.from("master_catalog").update(dbPayload).eq("id", masterItem.id);
      } else {
        const { data: existing } = await supabaseClient.from("master_catalog").select("id").eq("artno", masterItem.artNo).maybeSingle();
        if (existing) {
          masterItem.id = existing.id;
          await supabaseClient.from("master_catalog").update(dbPayload).eq("id", existing.id);
        } else {
          const { data: inserted } = await supabaseClient.from("master_catalog").insert([dbPayload]).select();
          if (inserted && inserted.length > 0) masterItem.id = inserted[0].id;
        }
      }
      
      // Update inventory_logs artname
      await supabaseClient.from("inventory_logs").update({ artname: newName }).eq("artno", artNo);
      // Update order_requests artname
      await supabaseClient.from("order_requests").update({ artname: newName }).eq("artno", artNo);
      
    } catch (err) {
      console.error("Supabase item name update error:", err);
    }
  }
  
  showToast(`품목명이 [${newName}] (으)로 변경되었습니다.`, "success");
  if (typeof playSuccessFeedback === "function") playSuccessFeedback();
  
  closeEditItemNameModal();
  
  // Refresh views
  invalidateStockCache();
  if (typeof renderStockLookup === "function") renderStockLookup();
  if (typeof renderHistoryLogs === "function") renderHistoryLogs();
  if (typeof renderOrderLogs === "function") renderOrderLogs();
  if (typeof renderPickList === "function") renderPickList();
};


