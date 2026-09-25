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

// --- Realtime Global Data Refresh ---
window.refreshAppRealtime = async function() {
  const icon = document.getElementById("global-refresh-icon");
  const btn = document.getElementById("btn-global-refresh");
  if (icon) icon.classList.add("fa-spin");
  if (btn) btn.style.opacity = "0.7";

  try {
    if (typeof loadDataFromSupabase === "function") {
      await loadDataFromSupabase();
    }
    if (typeof rebuildMasterCatalogMap === "function") rebuildMasterCatalogMap();
    if (typeof invalidateStockCache === "function") invalidateStockCache();

    // Re-render all views
    if (typeof renderStockLookup === "function") renderStockLookup();
    if (typeof renderHistoryLogs === "function") renderHistoryLogs();
    if (typeof renderOrderLogs === "function") renderOrderLogs();
    if (typeof renderStandardPickList === "function") renderStandardPickList();
    if (typeof renderStandardInventory === "function") renderStandardInventory();
    if (typeof renderPicklistInventory === "function") renderPicklistInventory();
    if (typeof updateMfaqBadge === "function") updateMfaqBadge();
    if (typeof populateArticleFilterDropdown === "function") populateArticleFilterDropdown();
    if (typeof loadProductThumbnails === "function") loadProductThumbnails();

    showToast("최신 데이터로 실시간 동기화되었습니다! 🔄", "success");
    if (typeof playSuccessFeedback === "function") playSuccessFeedback();
  } catch (err) {
    console.error("Refresh error:", err);
    showToast("데이터 동기화 중 오류가 발생했습니다.", "danger");
  } finally {
    setTimeout(() => {
      if (icon) icon.classList.remove("fa-spin");
      if (btn) btn.style.opacity = "1";
    }, 600);
  }
};

// ==========================================
// --- Smart Notification Center Engine ---
// ==========================================

window.getUserNotifications = function() {
  const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : 'guest';
  try {
    const saved = localStorage.getItem(`warehouse_notifications_${user}`);
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    return [];
  }
};

window.saveUserNotifications = function(notifications) {
  const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : 'guest';
  try {
    localStorage.setItem(`warehouse_notifications_${user}`, JSON.stringify(notifications));
  } catch (e) {}
  if (typeof window.updateNotificationBadge === 'function') window.updateNotificationBadge();
};

window.addUserNotification = function(notif) {
  const list = window.getUserNotifications();
  const isDuplicate = list.some(item => item.id === notif.id || (item.message === notif.message && Math.abs(Date.now() - (item.timestamp || 0)) < 5000));
  if (isDuplicate) return;

  const newEntry = {
    id: notif.id || `notif_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    type: notif.type || 'info',
    title: notif.title || '오더 알림',
    message: notif.message,
    time: notif.time || new Date().toISOString(),
    read: false,
    timestamp: Date.now(),
    orderId: notif.orderId || null
  };

  list.unshift(newEntry);
  if (list.length > 50) list.pop();
  window.saveUserNotifications(list);
  
  if (typeof playSuccessFeedback === 'function') playSuccessFeedback();
};

window.updateNotificationBadge = function() {
  const list = window.getUserNotifications();
  const unreadCount = list.filter(item => !item.read).length;

  const badge = document.getElementById("notif-badge");
  const modalBadge = document.getElementById("notif-unread-count-badge");

  if (badge) {
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }
  }

  if (modalBadge) {
    if (unreadCount > 0) {
      modalBadge.textContent = `${unreadCount}건 미확인`;
      modalBadge.style.display = "inline-block";
    } else {
      modalBadge.style.display = "none";
    }
  }
};

window.openNotificationModal = function() {
  const modal = document.getElementById("notification-modal");
  if (!modal) return;
  modal.style.display = "flex";
  window.renderNotificationList();
};

window.closeNotificationModal = function() {
  const modal = document.getElementById("notification-modal");
  if (modal) modal.style.display = "none";
};

window.renderNotificationList = function() {
  const container = document.getElementById("notification-list-container");
  if (!container) return;

  const list = window.getUserNotifications();
  window.updateNotificationBadge();

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:#94a3b8;">
        <i class="fa-regular fa-bell-slash" style="font-size:32px; color:#cbd5e1; margin-bottom:10px; display:block;"></i>
        <p style="font-size:13.5px; font-weight:600; color:#64748b;">새로운 알림이 없습니다.</p>
        <span style="font-size:11.5px; color:#94a3b8;">오더 요청 및 승인/보류 내역이 여기에 표시됩니다.</span>
      </div>
    `;
    return;
  }

  let html = "";
  list.forEach(item => {
    let iconClass = "fa-solid fa-bell";
    let iconBg = "#e0f2fe";
    let iconColor = "#0284c7";
    let borderAccent = "#e2e8f0";

    if (item.type === "order_request") {
      iconClass = "fa-solid fa-cart-arrow-down";
      iconBg = "#dbeafe";
      iconColor = "#1d4ed8";
      borderAccent = "#3b82f6";
    } else if (item.type === "order_accept") {
      iconClass = "fa-solid fa-circle-check";
      iconBg = "#dcfce7";
      iconColor = "#15803d";
      borderAccent = "#10b981";
    } else if (item.type === "order_hold") {
      iconClass = "fa-solid fa-circle-exclamation";
      iconBg = "#fee2e2";
      iconColor = "#b91c1c";
      borderAccent = "#ef4444";
    } else if (item.type === "order_complete") {
      iconClass = "fa-solid fa-boxes-packing";
      iconBg = "#f3e8ff";
      iconColor = "#7e22ce";
      borderAccent = "#8b5cf6";
    }

    let timeStr = item.time;
    if (item.time && String(item.time).includes('T')) {
      try {
        const d = new Date(item.time);
        const yy = d.getFullYear().toString().slice(2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        timeStr = `${yy}.${mm}.${dd} ${hh}:${min}`;
      } catch(e) {}
    } else if (item.time) {
      timeStr = String(item.time).replace(/-/g, '.').substring(2);
    }

    html += `
      <div class="notification-item" onclick="onNotificationClick('${item.id}')" style="display:flex; align-items:flex-start; gap:10px; padding:12px; margin-bottom:8px; border-radius:10px; background:${item.read ? '#ffffff' : '#f0fdf4'}; border:1px solid ${item.read ? '#e2e8f0' : borderAccent}; cursor:pointer; transition:all 0.15s ease; position:relative; box-shadow:0 1px 3px rgba(0,0,0,0.03);">
        ${!item.read ? `<div style="position:absolute; top:10px; right:10px; width:7px; height:7px; border-radius:50%; background:#ef4444;"></div>` : ''}
        <div style="width:34px; height:34px; border-radius:50%; background:${iconBg}; color:${iconColor}; display:flex; align-items:center; justify-content:center; font-size:14px; flex-shrink:0; margin-top:2px;">
          <i class="${iconClass}"></i>
        </div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
            <strong style="font-size:13px; color:#0f172a;">${item.title}</strong>
            <span style="font-size:10.5px; color:#94a3b8;">${timeStr}</span>
          </div>
          <div style="font-size:12.5px; color:#334155; line-height:1.4; word-break:keep-all;">${item.message}</div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
};

window.navigateToTab = function(rawTabId) {
  let cleanId = rawTabId ? String(rawTabId).replace(/^tab-/, '') : 'order';
  
  if (typeof closeNotificationModal === 'function') closeNotificationModal();
  
  if (typeof switchTab === 'function') {
    const navBtn = document.querySelector(`.bottom-nav .nav-item[onclick*="${cleanId}"]`) ||
                   document.querySelector(`.bottom-nav .nav-item:first-child`);
    switchTab(cleanId, navBtn);
  } else {
    document.querySelectorAll(".tab-page").forEach(page => page.classList.remove("active"));
    const target = document.getElementById(`tab-${cleanId}`);
    if (target) target.classList.add("active");
  }
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.onNotificationClick = function(id) {
  const list = window.getUserNotifications();
  const target = list.find(item => item.id === id);
  if (target) {
    target.read = true;
    window.saveUserNotifications(list);
    window.renderNotificationList();
  }
  window.closeNotificationModal();
  window.navigateToTab('order');
};

window.markAllNotificationsAsRead = function() {
  const list = window.getUserNotifications();
  list.forEach(item => item.read = true);
  window.saveUserNotifications(list);
  window.renderNotificationList();
  if (typeof showToast === 'function') showToast("모든 알림을 읽음 처리했습니다.", "info");
};

window.clearAllNotifications = function() {
  if (!confirm("알림 내역을 모두 삭제하시겠습니까?")) return;
  window.saveUserNotifications([]);
  window.renderNotificationList();
  if (typeof showToast === 'function') showToast("알림 내역을 비웠습니다.", "info");
};

// ==========================================
// --- Order Likes Engine ---
// ==========================================

window.getOrderLikesMap = function() {
  try {
    const saved = localStorage.getItem("warehouse_order_likes");
    return saved ? JSON.parse(saved) : {};
  } catch (e) {
    return {};
  }
};

window.saveOrderLikesMap = function(map) {
  try {
    localStorage.setItem("warehouse_order_likes", JSON.stringify(map));
  } catch (e) {}
};

window.toggleOrderLike = async function(originalIndex) {
  if (typeof isViewerUser !== 'undefined' && isViewerUser) {
    if (typeof showToast === 'function') showToast("Viewer(읽기 전용) 계정은 좋아요를 누를 수 없습니다.", "warning");
    return;
  }

  if (typeof orderLogs === 'undefined' || !orderLogs[originalIndex]) return;
  const order = orderLogs[originalIndex];
  const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : 'guest';
  const orderKey = String(order.id || `${order.artNo}_${order.date}_${order.user}`);

  const likesMap = window.getOrderLikesMap();
  let userList = likesMap[orderKey] || (Array.isArray(order.likes) ? order.likes : []);

  const hasLiked = userList.includes(user);
  if (hasLiked) {
    userList = userList.filter(u => u !== user);
    if (typeof showToast === 'function') showToast(`🤍 좋아요를 취소했습니다.`, "info");
  } else {
    userList.push(user);
    if (typeof showToast === 'function') showToast(`❤️ '${order.artName || order.artNo}' 오더에 공감했습니다!`, "success");
    if (typeof playSuccessFeedback === 'function') playSuccessFeedback();
  }

  likesMap[orderKey] = userList;
  order.likes = userList;
  window.saveOrderLikesMap(likesMap);

  // Sync to Supabase if connected
  if (typeof supabaseClient !== 'undefined' && supabaseClient && order.id) {
    try {
      await supabaseClient.from('order_requests').update({ likes: userList }).eq('id', order.id);
    } catch (e) {
      console.warn("Supabase likes update error (ignorable if column absent):", e);
    }
  }

  if (typeof renderOrderLogs === 'function') renderOrderLogs();
};

// Check user notifications on login / session start
window.checkUserNotificationsOnLogin = function() {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  const user = currentUser;
  const isAdmin = typeof isAdminUser !== 'undefined' && isAdminUser;
  const isViewer = typeof isViewerUser !== 'undefined' && isViewerUser;

  if (isViewer) {
    const badge = document.getElementById("notif-badge");
    if (badge) badge.style.display = "none";
    return;
  }

  const currentNotifs = window.getUserNotifications();
  let newlyAddedCount = 0;

  if (isAdmin) {
    // 👑 Admin user: Check for all pending orders from general users
    const pendingOrders = (typeof orderLogs !== 'undefined') ? orderLogs.filter(o => o.status === "요청됨" || o.status === "요청" || o.status === "대기") : [];
    pendingOrders.forEach(order => {
      const orderIdStr = String(order.id || `${order.artNo}_${order.date}`);
      const alreadyHas = currentNotifs.some(n => n.orderId === orderIdStr);
      if (!alreadyHas) {
        const requester = order.user || "동료";
        const artName = order.artName || order.artNo;
        currentNotifs.push({
          id: `notif_order_${orderIdStr}`,
          type: "order_request",
          title: "오더 요청 도착",
          message: `${requester}님이 '${artName}' ${order.qty}개를 오더 요청했습니다.`,
          time: order.created_at || order.date,
          read: false,
          timestamp: Date.now(),
          orderId: orderIdStr
        });
        newlyAddedCount++;
      }
    });

    if (newlyAddedCount > 0) {
      window.saveUserNotifications(currentNotifs);
      if (typeof showAlarmNotification === 'function') {
        showAlarmNotification(`🔔 미확인 오더 요청 ${newlyAddedCount}건이 있습니다. 알림함을 확인하세요!`, "success");
      }
    } else {
      window.updateNotificationBadge();
    }
  } else {
    // 👤 General User: Check for updates on their own submitted orders
    const myOrders = (typeof orderLogs !== 'undefined') ? orderLogs.filter(o => o.user === user) : [];
    myOrders.forEach(order => {
      if (!order.status || order.status === "요청" || order.status === "요청됨") return;
      const orderIdStr = String(order.id || `${order.artNo}_${order.date}`);
      const notifKey = `notif_status_${orderIdStr}_${order.status}`;
      const alreadyHas = currentNotifs.some(n => n.id === notifKey);
      
      if (!alreadyHas) {
        let notifType = "order_accept";
        let notifTitle = "오더 승인 완료";
        let notifMsg = `요청하신 '${order.artName}' ${order.qty}개 오더가 수락되었습니다!`;

        if (order.status === "보류") {
          notifType = "order_hold";
          notifTitle = "오더 보류 안내";
          notifMsg = `요청하신 '${order.artName}' ${order.qty}개 오더가 보류되었습니다.`;
        } else if (order.status === "출고완료" || order.status === "완료") {
          notifType = "order_complete";
          notifTitle = "출고 완료 안내";
          notifMsg = `요청하신 '${order.artName}' ${order.qty}개가 창고에서 출고 완료되었습니다.`;
        }

        currentNotifs.push({
          id: notifKey,
          type: notifType,
          title: notifTitle,
          message: notifMsg,
          time: order.created_at || order.date,
          read: false,
          timestamp: Date.now(),
          orderId: orderIdStr
        });
        newlyAddedCount++;
      }
    });

    if (newlyAddedCount > 0) {
      window.saveUserNotifications(currentNotifs);
      if (typeof showAlarmNotification === 'function') {
        showAlarmNotification(`🔔 요청하신 오더 상태가 변경되었습니다. 알림함을 확인하세요!`, "success");
      }
    } else {
      window.updateNotificationBadge();
    }
  }
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
  if (typeof isViewerUser !== 'undefined' && isViewerUser) {
    if (typeof showToast === 'function') showToast("Viewer(읽기 전용) 계정은 기록을 삭제할 수 없습니다.", "warning");
    return;
  }
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

  if (startDate) {
    filteredLogs = filteredLogs.filter(log => log.date >= startDate);
  }
  if (endDate) {
    filteredLogs = filteredLogs.filter(log => log.date <= endDate);
  }
  if (typeFilter && typeFilter !== "ALL") {
    filteredLogs = filteredLogs.filter(log => log.type === typeFilter);
  }
  if (articleFilter && articleFilter !== "ALL") {
    filteredLogs = filteredLogs.filter(log => {
      let cleanLogArt = String(log.artNo || "").trim().replace(/\D/g, '');
      let cleanFilterArt = String(articleFilter).trim().replace(/\D/g, '');
      return cleanLogArt === cleanFilterArt;
    });
  }

  if (isDefaultFilter) {
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

    const deleteBtnHtml = (typeof isViewerUser === 'undefined' || !isViewerUser)
      ? `<button type="button" class="btn-sm" style="background:#fee2e2; color:#b91c1c; border:none; padding:4px 8px; border-radius:4px; font-size:10px; margin-top:4px; cursor:pointer;" onclick="confirmDeleteHistoryLog('${log.id}')"><i class="fa-solid fa-trash"></i> 삭제</button>`
      : '';

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
        ${deleteBtnHtml}
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
  if (typeof isViewerUser !== 'undefined' && isViewerUser) {
    showToast("Viewer(읽기 전용) 모드에서는 출고 완료 처리가 불가능합니다.", "danger");
    return;
  }

  if (typeof orderLogs === "undefined" || !orderLogs) return;

  let pickItem = orderLogs.find(log => String(log.id) === String(id));
  if (!pickItem && typeof id === 'number') {
    pickItem = orderLogs[id];
  }
  if (!pickItem) {
    showToast("해당 챙기기 항목을 찾을 수 없습니다.", "danger");
    return;
  }

  if (pickItem.status === "출고완료" || pickItem.status === "완료") {
    showToast("이미 출고 완료 처리된 항목입니다.", "info");
    return;
  }

  const rawNo = String(pickItem.artNo || pickItem.artno || "").trim();
  const cleanNo = rawNo.replace(/\D/g, '').padStart(8, '0');
  const resolvedName = pickItem.artName || pickItem.artname || (typeof masterCatalogMap !== 'undefined' ? masterCatalogMap.get(cleanNo) : "") || "창고 품목";
  const pickQty = parseInt(pickItem.qty, 10) || 1;

  if (!confirm(`'${resolvedName}' ${pickQty}개를 창고에서 챙기셨습니까?\n(확인 시 실시간 재고에서 즉시 차감 및 출고 완료 처리됩니다)`)) {
    return;
  }

  try {
    // 1. Update order status in memory & localStorage
    pickItem.status = "출고완료";
    try {
      localStorage.setItem("warehouse_order_logs", JSON.stringify(orderLogs));
    } catch(e) {}

    // 2. Sync order update to Supabase
    if (typeof supabaseClient !== "undefined" && supabaseClient && pickItem.id && String(pickItem.id).indexOf('.') === -1) {
      try {
        await supabaseClient
          .from('order_requests')
          .update({ status: '출고완료' })
          .eq('id', pickItem.id);
      } catch (err) {
        console.warn("Supabase order_requests update error:", err);
      }
    }

    // 3. Create outbound inventory log
    const todayStr = (typeof getAppLocalDateString === "function") 
      ? getAppLocalDateString() 
      : new Date().toISOString().split('T')[0];

    const newLog = {
      date: todayStr,
      type: "출고",
      artNo: cleanNo,
      artName: resolvedName,
      qty: pickQty,
      user: (typeof currentUser !== "undefined" && currentUser) ? currentUser : "system"
    };

    if (typeof historyLogs !== "undefined") {
      historyLogs.unshift(newLog);
      try {
        localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
      } catch(e) {}
    }

    // 4. Sync new outbound log to Supabase inventory_logs
    if (typeof supabaseClient !== "undefined" && supabaseClient) {
      try {
        const dbLog = {
          date: newLog.date,
          type: newLog.type,
          artNo: newLog.artNo,
          qty: newLog.qty,
          user: newLog.user
        };
        const { data, error } = await supabaseClient
          .from("inventory_logs")
          .insert([dbLog])
          .select();
        if (!error && data && data.length > 0) {
          newLog.id = data[0].id;
          newLog.created_at = data[0].created_at;
          try {
            localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
          } catch(e) {}
        }
      } catch (supaErr) {
        console.warn("Supabase saveHistoryLogs error:", supaErr);
      }
    }

    // 5. Invalidate stock cache
    if (typeof invalidateStockCache === "function") {
      invalidateStockCache();
    }

    showToast(`🎉 '${resolvedName}' ${pickQty}개 출고 완료! (재고 차감 완료)`, "success");
    if (typeof playSuccessFeedback === "function") playSuccessFeedback();

    // 6. Refresh all views
    if (typeof renderStandardPickList === "function") renderStandardPickList();
    if (typeof renderStandardInventory === "function") renderStandardInventory();
    if (typeof renderStandardLocationButtons === "function") renderStandardLocationButtons();
    if (typeof renderStockLookup === "function") renderStockLookup();
    if (typeof renderHistoryLogs === "function") renderHistoryLogs();
    if (typeof renderOrderLogs === "function") renderOrderLogs();
    if (typeof updateDashboard === "function") updateDashboard();

  } catch (err) {
    console.error("Pick complete error:", err);
    showToast("출고 완료 처리 실패: " + err.message, "danger");
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

window.currentStockLocationFilter = "ALL";

window.renderStockLocationDashboard = function() {
  const container = document.getElementById("stock-location-dashboard");
  if (!container) return;

  const stockMap = buildStockMap();
  
  const stats = {
    ALL: { name: "전체 구역", items: 0, totalStock: 0, icon: "fa-boxes-stacked", color: "#0058a3", bg: "#eff6ff", border: "#bfdbfe" },
    B1: { name: "B1 구역", items: 0, totalStock: 0, icon: "fa-warehouse", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
    B2: { name: "B2 구역", items: 0, totalStock: 0, icon: "fa-warehouse", color: "#0284c7", bg: "#f0f9ff", border: "#bae6fd" },
    "B2 램프": { name: "B2 램프", items: 0, totalStock: 0, icon: "fa-mountain-sun", color: "#4f46e5", bg: "#eef2ff", border: "#c7d2fe" },
    B3: { name: "B3 구역", items: 0, totalStock: 0, icon: "fa-pallet", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
    "미지정": { name: "위치 미지정", items: 0, totalStock: 0, icon: "fa-triangle-exclamation", color: "#d97706", bg: "#fffbeb", border: "#fde68a" }
  };

  stockMap.forEach(item => {
    let cleanNo = String(item.artNo || "").trim();
    let loc = "미지정";
    const matchedMaster = masterCatalog.find(m => {
      const mNo = String(m.artNo || m.artno || "").trim();
      return mNo === cleanNo || mNo.replace(/\D/g, '') === cleanNo.replace(/\D/g, '');
    });
    if (matchedMaster && matchedMaster.location && matchedMaster.location !== "미지정" && matchedMaster.location.trim() !== "") {
      loc = matchedMaster.location.trim();
    } else if (item.location && item.location !== "미지정" && item.location.trim() !== "") {
      loc = item.location.trim();
    }

    const qty = Math.max(0, item.currentStock || 0);
    
    stats.ALL.items++;
    stats.ALL.totalStock += qty;

    if (loc === "미지정" || !loc) {
      stats["미지정"].items++;
      stats["미지정"].totalStock += qty;
    } else if (loc.includes("B2 램프") || loc.includes("램프")) {
      stats["B2 램프"].items++;
      stats["B2 램프"].totalStock += qty;
    } else if (loc.includes("B1")) {
      stats.B1.items++;
      stats.B1.totalStock += qty;
    } else if (loc.includes("B2")) {
      stats.B2.items++;
      stats.B2.totalStock += qty;
    } else if (loc.includes("B3")) {
      stats.B3.items++;
      stats.B3.totalStock += qty;
    } else {
      if (!stats[loc]) {
        stats[loc] = { name: loc, items: 0, totalStock: 0, icon: "fa-location-dot", color: "#475569", bg: "#f8fafc", border: "#cbd5e1" };
      }
      stats[loc].items++;
      stats[loc].totalStock += qty;
    }
  });

  const activeKey = window.currentStockLocationFilter || "ALL";
  const zoneKeys = ["ALL", "B1", "B2", "B2 램프", "B3", "미지정"];
  Object.keys(stats).forEach(k => {
    if (!zoneKeys.includes(k)) zoneKeys.push(k);
  });

  let html = `
    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:12px; box-shadow:0 1px 3px rgba(0,0,0,0.03);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <div style="font-size:12.5px; font-weight:900; color:#0f172a; display:flex; align-items:center; gap:5px;">
          <i class="fa-solid fa-map-location-dot" style="color:#0058a3;"></i> 창고 구역별 실시간 재고 현황
        </div>
        <span style="font-size:10.5px; font-weight:800; color:#64748b;">원클릭 구역 필터</span>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:7px;">
  `;

  zoneKeys.forEach(k => {
    const s = stats[k];
    if (!s) return;
    const isActive = (activeKey === k);
    const isUnreg = (k === "미지정");
    
    html += `
      <div onclick="filterStockByLocation('${k}')" style="cursor:pointer; padding:8px 10px; border-radius:10px; background:${isActive ? s.bg : '#ffffff'}; border:${isActive ? '2px solid ' + s.color : '1.5px solid ' + (isUnreg && s.items > 0 ? '#fde68a' : '#e2e8f0')}; box-shadow:${isActive ? '0 3px 8px rgba(0,0,0,0.08)' : '0 1px 2px rgba(0,0,0,0.02)'}; transition:all 0.15s ease; position:relative; overflow:hidden;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
          <span style="font-size:11.5px; font-weight:900; color:${isActive ? s.color : '#0f172a'}; display:flex; align-items:center; gap:4px;">
            <i class="fa-solid ${s.icon}" style="color:${s.color}; font-size:11px;"></i> ${s.name}
          </span>
          ${isActive ? `<span style="font-size:9px; font-weight:900; background:${s.color}; color:#fff; padding:1px 4px; border-radius:4px;">선택됨</span>` : ''}
        </div>
        <div style="display:flex; align-items:baseline; justify-content:space-between; font-size:11px; color:#64748b;">
          <span>보유 <strong style="color:#0f172a; font-weight:800;">${s.items}</strong>종</span>
          <span style="font-weight:900; font-size:13px; color:${isUnreg && s.totalStock > 0 ? '#d97706' : s.color};">${s.totalStock}<span style="font-size:10px; font-weight:700; color:#64748b; margin-left:1px;">개</span></span>
        </div>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  container.innerHTML = html;
};

window.filterStockByLocation = function(locStr) {
  window.currentStockLocationFilter = locStr;
  if (typeof switchTab === 'function') {
    const stockNavBtn = document.querySelector('.bottom-nav .nav-item:nth-child(2)');
    switchTab('stock', stockNavBtn);
  }
  if (typeof renderStockLookup === 'function') {
    renderStockLookup();
  }
};

window.renderMenuLocationWidget = function() {
  const container = document.getElementById("menu-location-summary-widget");
  if (!container) return;

  const stockMap = buildStockMap();
  const stats = {
    B1: { items: 0, qty: 0, color: "#2563eb", bg: "#eff6ff" },
    B2: { items: 0, qty: 0, color: "#0284c7", bg: "#f0f9ff" },
    "B2 램프": { items: 0, qty: 0, color: "#4f46e5", bg: "#eef2ff" },
    B3: { items: 0, qty: 0, color: "#7c3aed", bg: "#f5f3ff" },
    "미지정": { items: 0, qty: 0, color: "#d97706", bg: "#fffbeb" }
  };

  stockMap.forEach(item => {
    let cleanNo = String(item.artNo || "").trim();
    let loc = "미지정";
    const matchedMaster = masterCatalog.find(m => {
      const mNo = String(m.artNo || m.artno || "").trim();
      return mNo === cleanNo || mNo.replace(/\D/g, '') === cleanNo.replace(/\D/g, '');
    });
    if (matchedMaster && matchedMaster.location && matchedMaster.location !== "미지정" && matchedMaster.location.trim() !== "") {
      loc = matchedMaster.location.trim();
    } else if (item.location && item.location !== "미지정" && item.location.trim() !== "") {
      loc = item.location.trim();
    }
    const qty = Math.max(0, item.currentStock || 0);
    if (loc === "미지정" || !loc) { stats["미지정"].items++; stats["미지정"].qty += qty; }
    else if (loc.includes("B2 램프") || loc.includes("램프")) { stats["B2 램프"].items++; stats["B2 램프"].qty += qty; }
    else if (loc.includes("B1")) { stats.B1.items++; stats.B1.qty += qty; }
    else if (loc.includes("B2")) { stats.B2.items++; stats.B2.qty += qty; }
    else if (loc.includes("B3")) { stats.B3.items++; stats.B3.qty += qty; }
  });

  let html = `
    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:12px 14px; box-shadow:0 1px 3px rgba(0,0,0,0.02);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:12.5px; font-weight:900; color:#0f172a;"><i class="fa-solid fa-layer-group" style="color:#0058a3; margin-right:4px;"></i> 구역별 창고 재고 현황</span>
        <span style="font-size:11px; font-weight:700; color:#0058a3; cursor:pointer;" onclick="filterStockByLocation('ALL')">전체 재고 보기 <i class="fa-solid fa-chevron-right" style="font-size:9px;"></i></span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(68px, 1fr)); gap:6px;">
        <div onclick="filterStockByLocation('B1')" style="cursor:pointer; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:6px 8px; text-align:center;">
          <div style="font-size:11px; font-weight:900; color:#2563eb; display:flex; align-items:center; justify-content:center; gap:3px;"><i class="fa-solid fa-warehouse" style="font-size:10px;"></i>B1</div>
          <div style="font-size:13px; font-weight:900; color:#0f172a;">${stats.B1.qty}<span style="font-size:10px; font-weight:normal; color:#64748b;">개</span></div>
        </div>
        <div onclick="filterStockByLocation('B2')" style="cursor:pointer; background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:6px 8px; text-align:center;">
          <div style="font-size:11px; font-weight:900; color:#0284c7; display:flex; align-items:center; justify-content:center; gap:3px;"><i class="fa-solid fa-warehouse" style="font-size:10px;"></i>B2</div>
          <div style="font-size:13px; font-weight:900; color:#0f172a;">${stats.B2.qty}<span style="font-size:10px; font-weight:normal; color:#64748b;">개</span></div>
        </div>
        <div onclick="filterStockByLocation('B2 램프')" style="cursor:pointer; background:#eef2ff; border:1px solid #c7d2fe; border-radius:8px; padding:6px 8px; text-align:center;">
          <div style="font-size:11px; font-weight:900; color:#4f46e5; display:flex; align-items:center; justify-content:center; gap:3px;"><i class="fa-solid fa-mountain-sun" style="font-size:10px;"></i>B2 램프</div>
          <div style="font-size:13px; font-weight:900; color:#0f172a;">${stats["B2 램프"].qty}<span style="font-size:10px; font-weight:normal; color:#64748b;">개</span></div>
        </div>
        <div onclick="filterStockByLocation('B3')" style="cursor:pointer; background:#f5f3ff; border:1px solid #ddd6fe; border-radius:8px; padding:6px 8px; text-align:center;">
          <div style="font-size:11px; font-weight:900; color:#7c3aed; display:flex; align-items:center; justify-content:center; gap:3px;"><i class="fa-solid fa-pallet" style="font-size:10px;"></i>B3</div>
          <div style="font-size:13px; font-weight:900; color:#0f172a;">${stats.B3.qty}<span style="font-size:10px; font-weight:normal; color:#64748b;">개</span></div>
        </div>
        ${stats["미지정"].items > 0 ? `
        <div onclick="filterStockByLocation('미지정')" style="cursor:pointer; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:6px 8px; text-align:center;" title="위치 미지정 품목">
          <div style="font-size:11px; font-weight:900; color:#d97706; display:flex; align-items:center; justify-content:center; gap:3px;"><i class="fa-solid fa-triangle-exclamation" style="font-size:10px;"></i>미지정</div>
          <div style="font-size:13px; font-weight:900; color:#b45309;">${stats["미지정"].items}<span style="font-size:10px; font-weight:normal; color:#92400e;">종</span></div>
        </div>` : ''}
      </div>
    </div>
  `;
  container.innerHTML = html;
};

const originalRenderStockLookup = window.renderStockLookup;
window.renderStockLookup = function() {
  const container = document.getElementById("stock-cards-container");
  if (!container) return;

  if (typeof renderStockLocationDashboard === "function") {
    renderStockLocationDashboard();
  }

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

  // Location filter
  if (window.currentStockLocationFilter && window.currentStockLocationFilter !== "ALL") {
    if (window.currentStockLocationFilter === "미지정") {
      filteredList = filteredList.filter(item => !item.location || item.location === "미지정" || item.location.trim() === "");
    } else if (window.currentStockLocationFilter === "B2 램프") {
      filteredList = filteredList.filter(item => item.location && (item.location.includes("B2 램프") || item.location.includes("램프")));
    } else {
      filteredList = filteredList.filter(item => item.location && item.location.includes(window.currentStockLocationFilter));
    }
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
      <div class="${cardClass} stock-card-item" data-artno="${item.artNo}" style="display:flex; align-items:flex-start; padding:12px 14px; gap:12px; border-radius:14px; background:#ffffff; border:1px solid #e2e8f0; margin-bottom:10px; box-shadow:0 1px 3px rgba(0,0,0,0.02); transition:all 0.15s ease;">
        <!-- Left: Checkbox & Product Image -->
        <div style="display:flex; flex-direction:column; align-items:center; gap:6px; flex-shrink:0;">
          <input type="checkbox" class="stock-checkbox" value="${item.artNo}" onchange="updateBulkSelection()" style="width:17px; height:17px; accent-color:#0058a3; cursor:pointer;">
          ${getProductThumbHtml(item.artNo, item.artName, 54)}
        </div>

        <!-- Center & Main Details -->
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:5px;">
          <!-- Top Line: HFB + ArtNo + Status Badge -->
          <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
            <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
              ${item.hfb ? `<span style="background:#eff6ff; color:#0284c7; font-size:10px; font-weight:800; padding:1px 5px; border-radius:4px; border:1px solid #bfdbfe;">${item.hfb}</span>` : ''}
              <span class="ssc-artno" style="font-size:12.5px; font-weight:800; color:#334155; font-family:monospace;">${item.artNo}</span>
            </div>
            <span class="ssc-status ${statusClass}" style="font-size:10.5px; padding:2px 7px; border-radius:12px; font-weight:800; background:${isOut ? '#fee2e2' : isLow ? '#fef3c7' : '#dcfce7'}; color:${isOut ? '#b91c1c' : isLow ? '#b45309' : '#15803d'}; border:1px solid ${isOut ? '#fca5a5' : isLow ? '#fde68a' : '#bbf7d0'}; flex-shrink:0;">${statusText}</span>
          </div>

          <!-- Product Name & Stock Quantity -->
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px;">
            <div style="font-size:13.5px; font-weight:800; color:#0f172a; line-height:1.35; word-break:break-all;">
              ${item.artName}${(item.artName.includes("알 수 없") || item.artName.includes("품목명 없") || item.artName.includes("신규") || item.artName.includes("기타") || item.artName === "") ? `<button type="button" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; border-radius:4px; padding:2px 6px; font-size:10px; cursor:pointer; flex-shrink:0; margin-left:4px;" onclick="openEditItemNameModal('${item.artNo}', '${item.artName.replace(/'/g, "\\'")}')"><i class="fa-solid fa-pen"></i> 이름 수정</button>` : ""}
            </div>
            <div class="ssc-qty" style="display:flex; align-items:baseline; gap:2px; flex-shrink:0; text-align:right;">
              <span class="ssc-num" style="font-size:18px; font-weight:900; color:${isOut ? '#ef4444' : isLow ? '#d97706' : '#0f172a'};">${item.currentStock}</span>
              <span class="ssc-unit" style="font-size:11.5px; color:#64748b; font-weight:700;">개</span>
            </div>
          </div>

          <!-- Bottom Line: Location & Quick In/Out Action Buttons -->
          <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap; margin-top:2px;">
            <div style="display:flex; align-items:center; gap:5px;">
              <span style="background:#f8fafc; color:#475569; font-weight:700; font-size:11px; padding:2px 7px; border-radius:6px; display:inline-flex; align-items:center; gap:4px; border:1px solid #e2e8f0;">
                <i class="fa-solid fa-location-dot" style="color:#0058a3; font-size:10px;"></i> 구역: ${item.location}
              </span>
              <button type="button" style="background:#eff6ff; color:#0058a3; border:1px solid #bfdbfe; font-size:10px; font-weight:800; padding:2px 6px; border-radius:6px; cursor:pointer;" onclick="setSingleLocation('${item.artNo}')">구역 변경</button>
            </div>
            <div class="ssc-quick-btns" style="display:flex; gap:5px;">
              <button type="button" class="btn-sm btn-quick-in" style="padding:4px 9px; font-size:11px; font-weight:800; border-radius:6px; background:#f0fdf4; color:#166534; border:1px solid #bbf7d0; cursor:pointer;" onclick="quickActionRegister('${item.artNo}', '입고')">+ 입고</button>
              <button type="button" class="btn-sm btn-quick-out" style="padding:4px 9px; font-size:11px; font-weight:800; border-radius:6px; background:#fff1f2; color:#9f1239; border:1px solid #fecdd3; cursor:pointer;" onclick="quickActionRegister('${item.artNo}', '출고')">- 출고</button>
            </div>
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

// --- 1-Touch Simplified Warehouse-by-Warehouse Picklist System ---

window.currentPicklistZone = "B1";
window.currentPicklistMode = "queue"; // "queue" or "stock"
window.picklistStockSearchQuery = "";

function getOrderItemLocation(item) {
  let cleanNo = String(item.artNo || item.artno || "").trim();
  if (cleanNo.length > 0 && cleanNo.length <= 8) {
    cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
  }
  let masterItem = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog.find(m => {
    const mNo = String(m.artNo || m.artno || "").trim();
    return mNo === cleanNo || mNo.replace(/\D/g, '') === cleanNo.replace(/\D/g, '');
  }) : null;
  if (masterItem && masterItem.location && masterItem.location !== "미지정" && masterItem.location.trim() !== "") {
    return masterItem.location.trim();
  }
  const stockMap = (typeof buildStockMap === "function") ? buildStockMap() : null;
  if (stockMap) {
    const stockEntry = stockMap.get(cleanNo) || stockMap.get(cleanNo.replace(/\D/g, ''));
    if (stockEntry && stockEntry.location && stockEntry.location !== "미지정" && stockEntry.location.trim() !== "") {
      return stockEntry.location.trim();
    }
  }
  return "미지정";
}

window.getProductLatestUpdateTime = function(artNo) {
  if (!artNo) return { text: "기록 없음", exactTime: "-", relative: "", raw: null, action: "", user: "" };
  let cleanNo = String(artNo).trim();
  if (cleanNo.length > 0 && cleanNo.length <= 8) {
    cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
  }
  const digitsOnly = cleanNo.replace(/\D/g, '');

  let latestDate = null;
  let latestAction = "";
  let latestUser = "";

  // 1. Scan historyLogs for latest transaction of this article
  if (typeof historyLogs !== "undefined" && Array.isArray(historyLogs)) {
    for (let i = 0; i < historyLogs.length; i++) {
      const log = historyLogs[i];
      const logNo = String(log.artNo || log.artno || "").trim();
      const logDigits = logNo.replace(/\D/g, '');
      if (logNo === cleanNo || (digitsOnly && logDigits === digitsOnly)) {
        const timeVal = log.created_at || log.createdAt || (log.date ? (log.time ? `${log.date}T${log.time}` : log.date) : null);
        if (timeVal) {
          const d = new Date(timeVal);
          if (!isNaN(d.getTime())) {
            if (!latestDate || d > latestDate) {
              latestDate = d;
              latestAction = `${log.type || '입출고'} ${log.qty || 0}개`.trim();
              latestUser = log.user || log.worker || "";
            }
          }
        }
      }
    }
  }

  // 2. Scan masterCatalog for latest location / catalog update timestamp
  if (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) {
    const mItem = masterCatalog.find(m => {
      const mNo = String(m.artNo || m.artno || "").trim();
      return mNo === cleanNo || (digitsOnly && mNo.replace(/\D/g, '') === digitsOnly);
    });
    if (mItem) {
      const mTime = mItem.updatedAt || mItem.updated_at || mItem.created_at;
      if (mTime) {
        const md = new Date(mTime);
        if (!isNaN(md.getTime())) {
          if (!latestDate || md > latestDate) {
            latestDate = md;
            if (!latestAction) latestAction = "구역/정보 변경";
          }
        }
      }
    }
  }

  if (!latestDate) {
    return { text: "최근 기록 없음", exactTime: "-", relative: "", raw: null, action: "", user: "" };
  }

  const now = new Date();
  const diffMs = now - latestDate;
  const diffMin = Math.floor(diffMs / 60000);

  const month = String(latestDate.getMonth() + 1).padStart(2, '0');
  const day = String(latestDate.getDate()).padStart(2, '0');
  const hours = String(latestDate.getHours()).padStart(2, '0');
  const mins = String(latestDate.getMinutes()).padStart(2, '0');
  const exactTime = `${month}/${day} ${hours}:${mins}`;

  let relative = "";
  if (diffMin < 1) relative = "방금 전";
  else if (diffMin < 60) relative = `${diffMin}분 전`;
  else if (diffMin < 1440) relative = `${Math.floor(diffMin / 60)}시간 전`;
  else if (diffMin < 1440 * 7) relative = `${Math.floor(diffMin / 1440)}일 전`;

  const displayText = relative ? `${relative} (${exactTime})` : exactTime;

  return {
    text: displayText,
    exactTime: exactTime,
    relative: relative,
    raw: latestDate,
    action: latestAction,
    user: latestUser
  };
};

function isLocationMatch(itemLoc, targetZone) {
  if (targetZone === "전체") return true;
  const loc = (itemLoc || "미지정").trim();
  if (targetZone === "미지정") {
    return !loc || loc === "미지정" || loc === "";
  }
  if (targetZone === "B2 램프") {
    return loc.includes("B2 램프") || loc.includes("램프");
  }
  if (targetZone === "B2") {
    return loc.includes("B2") && !loc.includes("램프");
  }
  return loc.includes(targetZone);
}

window.setPicklistZone = function(zone) {
  window.currentPicklistZone = zone;
  renderSimplePicklist();
};

window.setPicklistMode = function(mode) {
  window.currentPicklistMode = mode;
  const btnQueue = document.getElementById("picklist-mode-queue-btn");
  const btnStock = document.getElementById("picklist-mode-stock-btn");
  if (btnQueue && btnStock) {
    if (mode === "queue") {
      btnQueue.style.background = "#ffffff";
      btnQueue.style.color = "#059669";
      btnQueue.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
      btnStock.style.background = "transparent";
      btnStock.style.color = "#64748b";
      btnStock.style.boxShadow = "none";
    } else {
      btnStock.style.background = "#ffffff";
      btnStock.style.color = "#2563eb";
      btnStock.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
      btnQueue.style.background = "transparent";
      btnQueue.style.color = "#64748b";
      btnQueue.style.boxShadow = "none";
    }
  }
  renderSimplePicklist();
};

window.renderPicklistZoneTabs = function() {
  const container = document.getElementById("picklist-zone-tabs");
  if (!container) return;

  const pendingOrders = (typeof orderLogs !== "undefined" && Array.isArray(orderLogs)) 
    ? orderLogs.filter(item => ["출고대기", "대기", "요청", "요청됨", "승인", "수락"].includes(item.status))
    : [];

  const zoneCounts = {
    B1: 0,
    B2: 0,
    "B2 램프": 0,
    B3: 0,
    "미지정": 0,
    "전체": pendingOrders.length
  };

  pendingOrders.forEach(item => {
    const loc = getOrderItemLocation(item);
    if (loc.includes("B2 램프") || loc.includes("램프")) {
      zoneCounts["B2 램프"]++;
    } else if (loc.includes("B1")) {
      zoneCounts.B1++;
    } else if (loc.includes("B2")) {
      zoneCounts.B2++;
    } else if (loc.includes("B3")) {
      zoneCounts.B3++;
    } else {
      zoneCounts["미지정"]++;
    }
  });

  const zones = ["B1", "B2", "B2 램프", "B3", "미지정", "전체"];
  let html = "";

  zones.forEach(zone => {
    const isActive = (window.currentPicklistZone === zone);
    const count = zoneCounts[zone] || 0;
    const badgeHtml = count > 0 
      ? `<span style="display:inline-flex; align-items:center; justify-content:center; background:${isActive ? '#ef4444' : '#ef4444'}; color:#ffffff; font-size:10px; font-weight:900; padding:1px 5px; border-radius:10px; margin-left:3px; min-width:16px;">${count}</span>`
      : '';

    let zoneIcon = 'fa-warehouse';
    if (zone === '전체') zoneIcon = 'fa-boxes-stacked';
    else if (zone === '미지정') zoneIcon = 'fa-triangle-exclamation';
    else if (zone === 'B2 램프') zoneIcon = 'fa-mountain-sun';
    else if (zone === 'B3') zoneIcon = 'fa-pallet';

    html += `
      <button type="button" onclick="setPicklistZone('${zone}')" style="flex-shrink:0; padding:6px 11px; border-radius:18px; font-size:12.5px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; white-space:nowrap; transition:all 0.15s ease; ${isActive ? 'background:#0f172a; color:#ffffff; border:1.5px solid #0f172a; box-shadow:0 2px 5px rgba(0,0,0,0.15);' : 'background:#ffffff; color:#334155; border:1px solid #cbd5e1;'}">
        <i class="fa-solid ${zoneIcon}" style="margin-right:4px; color:${isActive ? '#38bdf8' : (zone === '미지정' ? '#d97706' : '#0058a3')}; font-size:11.5px;"></i>
        ${zone} ${badgeHtml}
      </button>
    `;
  });

  container.innerHTML = html;
};

window.renderSimplePicklist = function() {
  const container = document.getElementById("picklist-active-container");
  if (!container) return;

  renderPicklistZoneTabs();

  const selectedZone = window.currentPicklistZone || "B1";
  const pendingOrders = (typeof orderLogs !== "undefined" && Array.isArray(orderLogs))
    ? orderLogs.filter(item => ["출고대기", "대기", "요청", "요청됨", "승인", "수락"].includes(item.status))
    : [];

  const zoneQueueOrders = pendingOrders.filter(item => isLocationMatch(getOrderItemLocation(item), selectedZone));
  
  const stockMap = (typeof buildStockMap === "function") ? buildStockMap() : new Map();
  const zoneStockItems = Array.from(stockMap.values()).filter(item => item.currentStock > 0 && isLocationMatch(item.location, selectedZone));

  // Update badge in tab menu
  const badgePicklist = document.getElementById("badge-picklist");
  if (badgePicklist) {
    if (pendingOrders.length > 0) {
      badgePicklist.textContent = pendingOrders.length;
      badgePicklist.style.display = "inline-flex";
    } else {
      badgePicklist.style.display = "none";
    }
  }

  // Update tab texts
  const queueTabText = document.getElementById("picklist-queue-tab-text");
  const stockTabText = document.getElementById("picklist-stock-tab-text");
  if (queueTabText) queueTabText.textContent = `챙길 대기열 (${zoneQueueOrders.length}건)`;
  if (stockTabText) stockTabText.textContent = `${selectedZone} 실재고 (${zoneStockItems.length}종)`;

  if (window.currentPicklistMode === "queue") {
    renderPicklistQueueView(container, selectedZone, zoneQueueOrders);
  } else {
    renderPicklistStockView(container, selectedZone, zoneStockItems);
  }
};

function renderPicklistQueueView(container, selectedZone, items) {
  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:45px 20px; background:#ffffff; border-radius:14px; border:1px dashed #cbd5e1; margin-top:4px;">
        <div style="width:56px; height:56px; border-radius:50%; background:#f0fdf4; color:#16a34a; display:inline-flex; align-items:center; justify-content:center; font-size:26px; margin-bottom:12px;">
          <i class="fa-solid fa-check"></i>
        </div>
        <h3 style="font-size:15px; font-weight:800; color:#0f172a; margin:0 0 6px 0;">[${selectedZone}] 구역에 대기 중인 오더가 없습니다!</h3>
        <p style="font-size:12.5px; color:#64748b; margin:0 0 16px 0;">현재 ${selectedZone} 창고에서 챙겨야 할 요청 항목이 모두 완료되었습니다.</p>
        <button type="button" class="btn-submit" onclick="setPicklistMode('stock')" style="display:inline-flex; align-items:center; gap:6px; padding:10px 18px; font-size:13px; font-weight:800; background:#0058a3; color:white; border-radius:8px; border:none; cursor:pointer;">
          <i class="fa-solid fa-boxes-stacked"></i> ${selectedZone} 창고 실재고에서 직접 챙기기
        </button>
      </div>
    `;
    return;
  }

  let html = `
    <!-- Top Action Bar for Batch Complete -->
    <div style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:12px; padding:12px 14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
      <div>
        <div style="font-size:13px; font-weight:900; color:#15803d; display:flex; align-items:center; gap:5px;">
          <i class="fa-solid fa-bolt" style="color:#16a34a;"></i> ${selectedZone} 대기 항목 ${items.length}건
        </div>
        <div style="font-size:11px; color:#166534; margin-top:2px;">모든 품목을 챙긴 후 한 번에 완료할 수 있습니다.</div>
      </div>
      <button type="button" onclick="completeAllZonePickItems('${selectedZone}')" style="background:#16a34a; color:#ffffff; font-size:12.5px; font-weight:900; border:none; padding:9px 14px; border-radius:8px; cursor:pointer; white-space:nowrap; box-shadow:0 2px 6px rgba(22,163,74,0.3); display:inline-flex; align-items:center; gap:5px;">
        <i class="fa-solid fa-circle-check"></i> 전체 일괄 챙김
      </button>
    </div>

    <!-- Cards List -->
    <div class="picklist-cards-list" style="display:flex; flex-direction:column; gap:10px;">
  `;

  items.forEach(item => {
    let cleanNo = String(item.artNo || item.artno || "").trim();
    if (cleanNo.length > 0 && cleanNo.length <= 8) {
      cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
    }
    const location = getOrderItemLocation(item);
    const displayName = item.artName || item.artname || (typeof masterCatalogMap !== 'undefined' ? masterCatalogMap.get(cleanNo) : "") || "창고 품목";
    const qty = parseInt(item.qty, 10) || 1;
    const reqUser = item.user || "요청";
    const rawReqTime = item.created_at || item.createdAt || item.date || "";
    let reqDateStr = "-";
    if (rawReqTime) {
      const d = new Date(rawReqTime);
      if (!isNaN(d.getTime())) {
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        const exact = `${month}/${day} ${hours}:${mins}`;
        const diffMin = Math.floor((new Date() - d) / 60000);
        if (diffMin < 1) reqDateStr = `방금 전 (${exact})`;
        else if (diffMin < 60) reqDateStr = `${diffMin}분 전 (${exact})`;
        else if (diffMin < 1440) reqDateStr = `${Math.floor(diffMin/60)}시간 전 (${exact})`;
        else reqDateStr = exact;
      } else {
        reqDateStr = rawReqTime;
      }
    }

    html += `
      <div class="stock-card-item" style="background:#ffffff; border:1px solid #e2e8f0; border-left:4px solid #059669; border-radius:14px; padding:10px 12px; box-shadow:0 1px 3px rgba(0,0,0,0.03); display:flex; gap:10px; align-items:flex-start;">
        <!-- Left: Product Image -->
        <div style="flex-shrink:0;">
          ${typeof getProductThumbHtml === 'function' ? getProductThumbHtml(cleanNo, displayName, 48) : ''}
        </div>

        <!-- Center: Product Info -->
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
            <span style="background:#ecfdf5; color:#047857; font-size:10.5px; font-weight:800; padding:2px 6px; border-radius:6px; border:1px solid #a7f3d0; display:inline-flex; align-items:center; gap:3px;">
              <i class="fa-solid fa-location-dot"></i> ${location}
            </span>
            <button type="button" onclick="event.stopPropagation(); event.preventDefault(); setSingleLocation('${cleanNo}')" style="background:#eff6ff; color:#0058a3; border:1px solid #bfdbfe; font-size:9.5px; font-weight:800; padding:1px 5px; border-radius:4px; cursor:pointer;" title="구역/위치 변경">
              <i class="fa-solid fa-pen-to-square"></i> 구역 변경
            </button>
            <span style="font-size:11.5px; font-weight:bold; color:#64748b; font-family:monospace;">${cleanNo}</span>
          </div>

          <div style="font-size:13.5px; font-weight:900; color:#0f172a; line-height:1.3; word-break:keep-all; overflow-wrap:break-word;">
            ${displayName}
          </div>

          <div style="font-size:11px; color:#64748b; display:flex; align-items:center; gap:8px; margin-top:2px;">
            <span><i class="fa-solid fa-user" style="color:#94a3b8; font-size:10px;"></i> ${reqUser}</span>
            <span><i class="fa-regular fa-clock" style="color:#0058a3; font-size:10px;"></i> 요청 시각: <strong style="color:#1e293b; font-weight:800;">${reqDateStr}</strong></span>
          </div>

          <!-- Bottom Action Row: Qty Highlight & 1-Click Complete Button -->
          <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; margin-top:6px; padding-top:8px; border-top:1px dashed #f1f5f9;">
            <div style="display:flex; align-items:baseline; gap:3px;">
              <span style="font-size:11px; font-weight:700; color:#64748b;">챙길 수량:</span>
              <span style="font-size:17px; font-weight:900; color:#059669;">${qty}</span>
              <span style="font-size:10.5px; font-weight:700; color:#64748b;">개</span>
            </div>

            <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
              <button type="button" onclick="modifyPickItem_custom('${item.id}')" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; font-weight:700; font-size:10.5px; border-radius:6px; padding:0 7px; height:28px; cursor:pointer; white-space:nowrap;" title="수량 변경">
                수정
              </button>
              <button type="button" onclick="deletePickItem_custom('${item.id}')" style="background:#fee2e2; color:#ef4444; border:1px solid #fca5a5; font-weight:700; font-size:10.5px; border-radius:6px; padding:0 7px; height:28px; cursor:pointer; white-space:nowrap;" title="삭제">
                삭제
              </button>
              <button type="button" onclick="completePickItem_custom('${item.id}')" style="background:#059669; color:#ffffff; font-weight:900; font-size:12px; border:none; border-radius:8px; padding:0 11px; height:28px; cursor:pointer; box-shadow:0 2px 4px rgba(5,150,105,0.25); display:inline-flex; align-items:center; gap:4px; white-space:nowrap;">
                <i class="fa-solid fa-check"></i> 챙김 완료
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
  if (typeof loadProductThumbnails === "function") loadProductThumbnails();
}

function renderPicklistStockView(container, selectedZone, items) {
  const searchQuery = (window.picklistStockSearchQuery || "").trim().toLowerCase();
  let filteredList = items;
  if (searchQuery) {
    filteredList = filteredList.filter(item =>
      item.artNo.toLowerCase().includes(searchQuery) ||
      item.artName.toLowerCase().includes(searchQuery)
    );
  }

  filteredList.sort((a, b) => (a.location || "").localeCompare(b.location || "", "ko") || a.artNo.localeCompare(b.artNo));

  let html = `
    <!-- Search & Bulk Pick Header -->
    <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:10px 12px; margin-bottom:12px; display:flex; flex-direction:column; gap:8px;">
      <div style="display:flex; gap:8px; align-items:center;">
        <div style="position:relative; flex:1;">
          <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:#94a3b8; font-size:13px;"></i>
          <input type="text" id="picklist-stock-search-input" value="${window.picklistStockSearchQuery || ''}" placeholder="${selectedZone} 구역 품번 또는 품명 검색..." oninput="onPicklistStockSearch(this.value)" style="width:100%; padding:9px 12px 9px 34px; border:1.5px solid #cbd5e1; border-radius:8px; font-size:13px; font-weight:700; outline:none; box-sizing:border-box;">
        </div>
        ${searchQuery ? `<button type="button" onclick="clearPicklistStockSearch()" style="background:#f1f5f9; border:1px solid #cbd5e1; color:#64748b; border-radius:8px; padding:8px 12px; font-size:12px; font-weight:bold; cursor:pointer;">초기화</button>` : ''}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; padding-top:4px;">
        <label style="font-size:12px; font-weight:800; color:#0058a3; cursor:pointer; display:flex; align-items:center; gap:5px; user-select:none;">
          <input type="checkbox" id="picklist-stock-select-all" onclick="togglePicklistStockSelectAll(this.checked)" style="width:17px; height:17px; accent-color:#0058a3; cursor:pointer;">
          전체 선택 (<span id="picklist-stock-selected-count">0</span>개)
        </label>
        <button type="button" id="btn-batch-stock-pick" onclick="batchDirectPickFromStock()" style="display:none; background:#2563eb; color:white; border:none; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:900; cursor:pointer; box-shadow:0 2px 4px rgba(37,99,235,0.25);">
          <i class="fa-solid fa-cart-flatbed"></i> 선택 항목 일괄 챙기기
        </button>
      </div>
    </div>
  `;

  if (filteredList.length === 0) {
    html += `
      <div style="text-align:center; padding:40px 20px; background:#ffffff; border-radius:14px; border:1px dashed #cbd5e1;">
        <i class="fa-solid fa-box-open" style="font-size:32px; color:#cbd5e1; margin-bottom:10px; display:block;"></i>
        <p style="font-weight:700; color:#64748b; font-size:13px; margin:0;">${searchQuery ? '검색 조건에 맞는 재고 품목이 없습니다.' : selectedZone + ' 구역에 보유 재고가 없습니다.'}</p>
      </div>
    `;
    container.innerHTML = html;
    return;
  }

  html += `<div class="picklist-cards-list" style="display:flex; flex-direction:column; gap:10px;">`;

  filteredList.forEach(item => {
    let cleanNo = String(item.artNo || "").trim();
    if (cleanNo.length > 0 && cleanNo.length <= 8) {
      cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
    }
    const displayName = item.artName || "기타 품목";
    const currentStock = item.currentStock || 0;
    const initialQty = 1;
    const updateInfo = (typeof window.getProductLatestUpdateTime === "function")
      ? window.getProductLatestUpdateTime(cleanNo)
      : { text: "최근 기록 없음", action: "", user: "" };

    html += `
      <div class="stock-card-item" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:10px 12px; box-shadow:0 1px 3px rgba(0,0,0,0.03); display:flex; gap:10px; align-items:flex-start;">
        <!-- Left: Checkbox & Product Image -->
        <div style="display:flex; flex-direction:column; align-items:center; gap:5px; flex-shrink:0;">
          <input type="checkbox" class="picklist-stock-cb" data-artno="${cleanNo}" data-artname="${displayName.replace(/"/g, "&quot;")}" data-maxqty="${currentStock}" onchange="updatePicklistStockSelection()" style="width:17px; height:17px; accent-color:#0058a3; cursor:pointer;">
          ${typeof getProductThumbHtml === 'function' ? getProductThumbHtml(cleanNo, displayName, 46) : ''}
        </div>

        <!-- Center & Right -->
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
            <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
              <span style="background:#f0f9ff; color:#0369a1; font-size:10.5px; font-weight:800; padding:2px 6px; border-radius:4px; border:1px solid #bae6fd;">
                <i class="fa-solid fa-location-dot"></i> ${item.location || '미지정'}
              </span>
              <button type="button" onclick="event.stopPropagation(); event.preventDefault(); setSingleLocation('${cleanNo}')" style="background:#eff6ff; color:#0058a3; border:1px solid #bfdbfe; font-size:9.5px; font-weight:800; padding:1px 5px; border-radius:4px; cursor:pointer;" title="구역/위치 변경">
                <i class="fa-solid fa-pen-to-square"></i> 구역 변경
              </button>
              <span style="font-size:11.5px; font-weight:bold; color:#64748b; font-family:monospace;">${cleanNo}</span>
            </div>
            <span style="font-size:11px; color:#64748b; font-weight:700;">재고 <strong style="color:#0f172a; font-size:13px; font-weight:900;">${currentStock}</strong>개</span>
          </div>

          <div style="font-size:13.5px; font-weight:900; color:#0f172a; line-height:1.3; word-break:keep-all; overflow-wrap:break-word;">
            ${displayName}
          </div>

          <!-- Product Update Date & Time Info -->
          <div style="font-size:11px; color:#64748b; display:flex; align-items:center; gap:5px; margin-top:2px; flex-wrap:wrap; line-height:1.3;">
            <span style="display:inline-flex; align-items:center; gap:3px;">
              <i class="fa-regular fa-clock" style="color:#0058a3; font-size:10px;"></i>
              <span style="color:#64748b; font-weight:700;">업데이트:</span>
              <strong style="color:#0f172a; font-weight:800;">${updateInfo.text}</strong>
            </span>
            ${updateInfo.action ? `
              <span style="color:#cbd5e1;">·</span>
              <span style="background:#f1f5f9; color:#475569; font-size:10px; font-weight:700; padding:1px 5px; border-radius:4px; border:1px solid #e2e8f0;">
                ${updateInfo.action}${updateInfo.user ? ` (${updateInfo.user})` : ''}
              </span>
            ` : ''}
          </div>

          <!-- Bottom: Pick Quantity Controls & Direct Pick Button -->
          <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; margin-top:6px; padding-top:8px; border-top:1px dashed #f1f5f9;">
            <div style="display:flex; align-items:center; gap:3px; flex-shrink:0;">
              <button type="button" onclick="adjustDirectPickQty('${cleanNo}', -1)" style="width:26px; height:28px; border:1px solid #cbd5e1; background:#f8fafc; border-radius:6px; font-size:13px; font-weight:900; cursor:pointer; color:#334155; display:flex; align-items:center; justify-content:center; flex-shrink:0;">-</button>
              <input type="number" id="direct-pick-qty-${cleanNo}" value="${initialQty}" min="1" max="${currentStock}" style="width:38px; height:28px; text-align:center; border:1.5px solid #cbd5e1; border-radius:6px; font-size:13px; font-weight:900; color:#0f172a; outline:none; padding:0;" onfocus="this.style.borderColor='#0058a3'" onblur="this.style.borderColor='#cbd5e1'">
              <button type="button" onclick="adjustDirectPickQty('${cleanNo}', 1, ${currentStock})" style="width:26px; height:28px; border:1px solid #cbd5e1; background:#f8fafc; border-radius:6px; font-size:13px; font-weight:900; cursor:pointer; color:#334155; display:flex; align-items:center; justify-content:center; flex-shrink:0;">+</button>
              <button type="button" onclick="setDirectPickQtyMax('${cleanNo}', ${currentStock})" style="font-size:10.5px; font-weight:800; background:#eff6ff; color:#0058a3; border:1px solid #bfdbfe; border-radius:4px; padding:0 6px; height:28px; line-height:28px; cursor:pointer; white-space:nowrap; flex-shrink:0;">최대</button>
            </div>

            <button type="button" onclick="handleDirectPickSubmit('${cleanNo}', '${displayName.replace(/'/g, "\\'")}')" style="background:#0058a3; color:#ffffff; font-weight:800; font-size:12px; border:none; border-radius:8px; padding:0 10px; height:28px; cursor:pointer; box-shadow:0 2px 4px rgba(0,88,163,0.25); display:inline-flex; align-items:center; gap:4px; white-space:nowrap; flex-shrink:0;">
              <i class="fa-solid fa-bolt"></i> 바로 챙기기
            </button>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
  if (typeof loadProductThumbnails === "function") loadProductThumbnails();
}

window.onPicklistStockSearch = function(val) {
  window.picklistStockSearchQuery = val;
  const container = document.getElementById("picklist-active-container");
  if (container) {
    const selectedZone = window.currentPicklistZone || "B1";
    const stockMap = (typeof buildStockMap === "function") ? buildStockMap() : new Map();
    const zoneStockItems = Array.from(stockMap.values()).filter(item => item.currentStock > 0 && isLocationMatch(item.location, selectedZone));
    renderPicklistStockView(container, selectedZone, zoneStockItems);
    const input = document.getElementById("picklist-stock-search-input");
    if (input) {
      input.focus();
      input.setSelectionRange(val.length, val.length);
    }
  }
};

window.clearPicklistStockSearch = function() {
  window.picklistStockSearchQuery = "";
  renderSimplePicklist();
};

window.adjustDirectPickQty = function(artNo, delta, maxStock = 9999) {
  const input = document.getElementById(`direct-pick-qty-${artNo}`);
  if (!input) return;
  let val = parseInt(input.value, 10) || 1;
  val += delta;
  if (val < 1) val = 1;
  if (val > maxStock) val = maxStock;
  input.value = val;
};

window.setDirectPickQtyMax = function(artNo, maxStock) {
  const input = document.getElementById(`direct-pick-qty-${artNo}`);
  if (input) input.value = maxStock;
};

window.handleDirectPickSubmit = async function(artNo, artName) {
  if (typeof isViewerUser !== 'undefined' && isViewerUser) {
    showToast("Viewer(읽기 전용) 모드에서는 출고 처리가 불가능합니다.", "danger");
    return;
  }
  const input = document.getElementById(`direct-pick-qty-${artNo}`);
  const qty = parseInt(input ? input.value : 1, 10) || 1;
  await window.directPickFromStock(artNo, artName, qty);
};

window.directPickFromStock = async function(artNo, artName, pickQty) {
  if (typeof isViewerUser !== 'undefined' && isViewerUser) {
    showToast("Viewer(읽기 전용) 모드에서는 출고 처리가 불가능합니다.", "danger");
    return;
  }

  let cleanNo = String(artNo || "").trim();
  if (cleanNo.length > 0 && cleanNo.length <= 8) {
    cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
  }
  const name = artName || (typeof masterCatalogMap !== 'undefined' ? masterCatalogMap.get(cleanNo) : "") || "창고 품목";
  const qty = parseInt(pickQty, 10) || 1;

  if (!confirm(`'${name}' ${qty}개를 [${window.currentPicklistZone || '창고'}] 구역에서 바로 챙기셨습니까?\n(확인 시 실시간 재고에서 즉시 차감 및 출고 완료됩니다)`)) {
    return;
  }

  try {
    const todayStr = (typeof getAppLocalDateString === "function") 
      ? getAppLocalDateString() 
      : new Date().toISOString().split('T')[0];

    const newLog = {
      date: todayStr,
      type: "출고",
      artNo: cleanNo,
      artName: name,
      qty: qty,
      user: (typeof currentUser !== "undefined" && currentUser) ? currentUser : "system"
    };

    if (typeof historyLogs !== "undefined") {
      historyLogs.unshift(newLog);
      try {
        localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
      } catch(e) {}
    }

    if (typeof supabaseClient !== "undefined" && supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from("inventory_logs")
          .insert([{
            date: newLog.date,
            type: newLog.type,
            artNo: newLog.artNo,
            qty: newLog.qty,
            user: newLog.user
          }])
          .select();
        if (!error && data && data.length > 0) {
          newLog.id = data[0].id;
          newLog.created_at = data[0].created_at;
          try {
            localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
          } catch(e) {}
        }
      } catch (err) {
        console.warn("Supabase direct pick insert error:", err);
      }
    }

    if (typeof invalidateStockCache === "function") invalidateStockCache();
    if (typeof renderStockLookup === "function") renderStockLookup();
    if (typeof renderHistoryLogs === "function") renderHistoryLogs();
    renderSimplePicklist();

    showToast(`✅ [${cleanNo}] ${name} ${qty}개 챙김(출고) 완료!`, "success");
    if (typeof playSuccessFeedback === "function") playSuccessFeedback();
  } catch (err) {
    console.error("Direct pick error:", err);
    showToast("출고 처리 중 오류가 발생했습니다: " + err.message, "danger");
  }
};

window.updatePicklistStockSelection = function() {
  const checkboxes = document.querySelectorAll('.picklist-stock-cb:checked');
  const count = checkboxes.length;
  const countSpan = document.getElementById('picklist-stock-selected-count');
  const batchBtn = document.getElementById('btn-batch-stock-pick');
  if (countSpan) countSpan.textContent = count;
  if (batchBtn) {
    batchBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  }
};

window.togglePicklistStockSelectAll = function(isChecked) {
  const checkboxes = document.querySelectorAll('.picklist-stock-cb');
  checkboxes.forEach(cb => cb.checked = isChecked);
  window.updatePicklistStockSelection();
};

window.batchDirectPickFromStock = async function() {
  if (typeof isViewerUser !== 'undefined' && isViewerUser) {
    showToast("Viewer(읽기 전용) 모드에서는 출고 처리가 불가능합니다.", "danger");
    return;
  }
  const checkboxes = document.querySelectorAll('.picklist-stock-cb:checked');
  if (checkboxes.length === 0) return;

  const itemsToPick = [];
  checkboxes.forEach(cb => {
    const artNo = cb.dataset.artno;
    const artName = cb.dataset.artname;
    const maxQty = parseInt(cb.dataset.maxqty, 10) || 1;
    const input = document.getElementById(`direct-pick-qty-${artNo}`);
    let qty = parseInt(input ? input.value : 1, 10) || 1;
    if (qty > maxQty) qty = maxQty;
    itemsToPick.push({ artNo, artName, qty });
  });

  if (!confirm(`선택한 ${itemsToPick.length}개 품목을 모두 챙기시겠습니까?\n(확인 시 실시간 재고에서 즉시 차감 및 출고 완료됩니다)`)) {
    return;
  }

  const todayStr = (typeof getAppLocalDateString === "function") 
    ? getAppLocalDateString() 
    : new Date().toISOString().split('T')[0];

  const dbLogs = [];
  for (const item of itemsToPick) {
    const newLog = {
      date: todayStr,
      type: "출고",
      artNo: item.artNo,
      artName: item.artName,
      qty: item.qty,
      user: (typeof currentUser !== "undefined" && currentUser) ? currentUser : "system"
    };
    if (typeof historyLogs !== "undefined") {
      historyLogs.unshift(newLog);
    }
    dbLogs.push({
      date: newLog.date,
      type: newLog.type,
      artNo: newLog.artNo,
      qty: newLog.qty,
      user: newLog.user
    });
  }

  try {
    localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
  } catch(e) {}

  if (typeof supabaseClient !== "undefined" && supabaseClient && dbLogs.length > 0) {
    try {
      await supabaseClient.from("inventory_logs").insert(dbLogs);
    } catch(e) {
      console.warn("Supabase batch direct pick insert error:", e);
    }
  }

  if (typeof invalidateStockCache === "function") invalidateStockCache();
  if (typeof renderStockLookup === "function") renderStockLookup();
  if (typeof renderHistoryLogs === "function") renderHistoryLogs();
  renderSimplePicklist();

  showToast(`🎉 ${itemsToPick.length}개 품목 일괄 챙김(출고)이 완료되었습니다!`, "success");
  if (typeof playSuccessFeedback === "function") playSuccessFeedback();
};

window.completeAllZonePickItems = async function(zone) {
  if (typeof isViewerUser !== 'undefined' && isViewerUser) {
    showToast("Viewer(읽기 전용) 모드에서는 출고 완료 처리가 불가능합니다.", "danger");
    return;
  }

  const pendingOrders = (typeof orderLogs !== "undefined" && Array.isArray(orderLogs))
    ? orderLogs.filter(item => ["출고대기", "대기", "요청", "요청됨", "승인", "수락"].includes(item.status))
    : [];

  const zoneItems = pendingOrders.filter(item => isLocationMatch(getOrderItemLocation(item), zone));
  if (zoneItems.length === 0) {
    showToast("완료 처리할 대기 품목이 없습니다.", "warning");
    return;
  }

  if (!confirm(`[${zone}] 구역의 대기 품목 (${zoneItems.length}건)을 모두 챙김 완료(출고) 처리하시겠습니까?\n(확인 시 실시간 재고에서 즉시 차감됩니다)`)) {
    return;
  }

  const todayStr = (typeof getAppLocalDateString === "function") 
    ? getAppLocalDateString() 
    : new Date().toISOString().split('T')[0];

  const dbLogs = [];
  const orderIdsToUpdate = [];

  zoneItems.forEach(item => {
    item.status = "출고완료";
    if (item.id && String(item.id).indexOf('.') === -1) {
      orderIdsToUpdate.push(item.id);
    }

    let cleanNo = String(item.artNo || item.artno || "").trim();
    if (cleanNo.length > 0 && cleanNo.length <= 8) {
      cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
    }
    const resolvedName = item.artName || item.artname || (typeof masterCatalogMap !== 'undefined' ? masterCatalogMap.get(cleanNo) : "") || "창고 품목";
    const pickQty = parseInt(item.qty, 10) || 1;

    const newLog = {
      date: todayStr,
      type: "출고",
      artNo: cleanNo,
      artName: resolvedName,
      qty: pickQty,
      user: (typeof currentUser !== "undefined" && currentUser) ? currentUser : "system"
    };

    if (typeof historyLogs !== "undefined") {
      historyLogs.unshift(newLog);
    }

    dbLogs.push({
      date: newLog.date,
      type: newLog.type,
      artNo: newLog.artNo,
      qty: newLog.qty,
      user: newLog.user
    });
  });

  try {
    localStorage.setItem("warehouse_order_logs", JSON.stringify(orderLogs));
    localStorage.setItem("warehouse_history_logs", JSON.stringify(historyLogs));
  } catch(e) {}

  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    try {
      if (orderIdsToUpdate.length > 0) {
        for (const oId of orderIdsToUpdate) {
          await supabaseClient.from('order_requests').update({ status: '출고완료' }).eq('id', oId);
        }
      }
      if (dbLogs.length > 0) {
        await supabaseClient.from('inventory_logs').insert(dbLogs);
      }
    } catch(err) {
      console.warn("Supabase batch complete error:", err);
    }
  }

  if (typeof invalidateStockCache === "function") invalidateStockCache();
  if (typeof renderStockLookup === "function") renderStockLookup();
  if (typeof renderHistoryLogs === "function") renderHistoryLogs();
  renderSimplePicklist();

  showToast(`🎉 [${zone}] 대기 항목 ${zoneItems.length}건 일괄 챙김 완료!`, "success");
  if (typeof playSuccessFeedback === "function") playSuccessFeedback();
};

window.modifyPickItem_custom = async function(id) {
  if (typeof isViewerUser !== 'undefined' && isViewerUser) {
    showToast("Viewer(읽기 전용) 모드에서는 수정이 불가능합니다.", "danger");
    return;
  }
  const pickItem = orderLogs.find(log => String(log.id) === String(id));
  if (!pickItem) return;

  const currentQty = parseInt(pickItem.qty, 10) || 1;
  const input = prompt(`[${pickItem.artName}] 챙길 수량을 수정하세요:`, currentQty);
  if (input === null) return;
  const newQty = parseInt(input, 10);
  if (isNaN(newQty) || newQty <= 0) {
    showToast("올바른 수량을 입력해주세요.", "warning");
    return;
  }

  pickItem.qty = newQty;
  try {
    localStorage.setItem("warehouse_order_logs", JSON.stringify(orderLogs));
  } catch(e) {}

  if (typeof supabaseClient !== "undefined" && supabaseClient && pickItem.id && String(pickItem.id).indexOf('.') === -1) {
    try {
      await supabaseClient.from('order_requests').update({ qty: newQty }).eq('id', pickItem.id);
    } catch(e) {}
  }

  renderSimplePicklist();
  showToast("수량이 변경되었습니다.", "success");
};

window.deletePickItem_custom = async function(id) {
  if (typeof isViewerUser !== 'undefined' && isViewerUser) {
    showToast("Viewer(읽기 전용) 모드에서는 삭제가 불가능합니다.", "danger");
    return;
  }
  const index = orderLogs.findIndex(log => String(log.id) === String(id));
  if (index === -1) return;
  const pickItem = orderLogs[index];

  if (!confirm(`'${pickItem.artName}' (${pickItem.qty}개) 항목을 챙기기 대기 목록에서 삭제하시겠습니까?`)) {
    return;
  }

  const orderId = pickItem.id;
  orderLogs.splice(index, 1);

  try {
    localStorage.setItem("warehouse_order_logs", JSON.stringify(orderLogs));
  } catch(e) {}

  if (typeof supabaseClient !== "undefined" && supabaseClient && orderId && String(orderId).indexOf('.') === -1) {
    try {
      await supabaseClient.from('order_requests').delete().eq('id', orderId);
    } catch(e) {}
  }

  renderSimplePicklist();
  showToast("대기 목록에서 삭제되었습니다.", "success");
};

// Aliases for backwards compatibility
window.renderPickList = function() { renderSimplePicklist(); };
window.renderStandardPickList = function() { renderSimplePicklist(); };
window.renderStandardInventory = function() { renderSimplePicklist(); };
window.renderStandardLocationButtons = function() { renderSimplePicklist(); };

const origSwitchTabStandard = window.switchTab;
window.switchTab = function(tabId, btnElement) {
  if (typeof origSwitchTabStandard === "function") origSwitchTabStandard(tabId, btnElement);
  
  if (tabId === "picklist" || tabId === "tab-picklist") {
    if (typeof renderStandardLocationButtons === "function") renderStandardLocationButtons();
    if (typeof renderStandardPickList === "function") renderStandardPickList();
  } else if (tabId === "stock" || tabId === "tab-stock") {
    if (typeof renderStockLocationDashboard === "function") renderStockLocationDashboard();
  } else if (tabId === "menu" || tabId === "tab-menu") {
    if (typeof renderMenuLocationWidget === "function") renderMenuLocationWidget();
  } else if (tabId === "register" || tabId === "tab-register") {
    if (typeof updateRegLocationButtons === "function") updateRegLocationButtons();
    const artNoVal = document.getElementById("reg-artno") ? document.getElementById("reg-artno").value.trim() : "";
    if (typeof updateRegLocationGuideBanner === "function") updateRegLocationGuideBanner(artNoVal);
  }
};

let currentSingleLocArtNo = null;

window.setSingleLocation = function(artNo) {
  let cleanNo = String(artNo || "").trim();
  if (cleanNo.length > 0 && cleanNo.length <= 8) {
    cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
  }
  currentSingleLocArtNo = cleanNo;
  
  let masterItem = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog.find(m => {
    const mNo = String(m.artNo || m.artno || "").trim();
    return mNo === cleanNo || mNo.replace(/\D/g, '') === cleanNo.replace(/\D/g, '');
  }) : null;
  
  const artName = masterItem ? (masterItem.artName || masterItem.artname) : ((typeof masterCatalogMap !== 'undefined' && masterCatalogMap) ? masterCatalogMap.get(cleanNo) : "") || "알 수 없음";
  const currentLoc = (masterItem && masterItem.location) ? masterItem.location : "미지정";
  
  const titleEl = document.getElementById("single-loc-artname");
  if (titleEl) {
    titleEl.innerHTML = `<span style="font-size:15px; font-weight:800; color:#0f172a;">[${cleanNo}] ${artName}</span><br><span style="color:#0058a3; font-weight:700; font-size:12.5px; display:inline-flex; align-items:center; gap:4px; margin-top:4px;"><i class="fa-solid fa-location-dot"></i> 현재 구역: <strong>${currentLoc}</strong></span>`;
  }
  
  // Dynamically populate location buttons
  const btnContainer = document.getElementById("single-loc-quick-buttons");
  if (btnContainer) {
    const locSet = new Set(["B1", "B2", "B2 램프", "B3"]);
    if (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) {
      masterCatalog.forEach(m => {
        if (m.location && m.location !== "미지정" && m.location.trim() !== "") {
          m.location.split(',').map(l => l.trim()).forEach(l => { if (l) locSet.add(l); });
        }
      });
    }
    const locList = Array.from(locSet).sort();
    let btnHtml = "";
    locList.forEach(loc => {
      const isCurrent = (currentLoc === loc);
      btnHtml += `<button type="button" class="btn-secondary" style="flex:1; min-width:65px; padding:10px 12px; font-weight:bold; font-size:14px; border-radius:8px; cursor:pointer; transition:all 0.15s; ${isCurrent ? 'background:#0058a3; color:white; border:1px solid #0058a3;' : 'background:#f1f5f9; color:#334155; border:1px solid #cbd5e1;'}" onclick="saveSingleLocation('${loc}')">${loc}${isCurrent ? ' (현재)' : ''}</button>`;
    });
    btnContainer.innerHTML = btnHtml;
  }
  
  const customInput = document.getElementById("single-loc-custom-input");
  if (customInput) {
    customInput.value = (currentLoc !== "미지정") ? currentLoc : "";
  }
  
  const modal = document.getElementById("single-loc-modal");
  if (modal) modal.classList.add("active");
};

window.closeSingleLocationModal = function() {
  const modal = document.getElementById("single-loc-modal");
  if (modal) modal.classList.remove("active");
  currentSingleLocArtNo = null;
};

window.submitCustomSingleLocation = function() {
  const input = document.getElementById("single-loc-custom-input");
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    showToast("변경할 구역명을 입력해주세요.", "warning");
    return;
  }
  saveSingleLocation(val);
};

window.saveSingleLocation = async function(locStr) {
  if (!currentSingleLocArtNo) return;
  const targetLoc = (locStr || "").trim();
  if (!targetLoc) {
    showToast("구역명을 입력해주세요.", "warning");
    return;
  }
  
  let cleanNo = String(currentSingleLocArtNo).trim();
  if (cleanNo.length > 0 && cleanNo.length <= 8) {
    cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
  }
  
  let masterItem = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog.find(m => {
    const mNo = String(m.artNo || m.artno || "").trim();
    return mNo === cleanNo || mNo.replace(/\D/g, '') === cleanNo.replace(/\D/g, '');
  }) : null;
  
  if (masterItem) {
    masterItem.location = targetLoc;
    masterItem.artNo = cleanNo;
  } else {
    const fallbackName = ((typeof masterCatalogMap !== 'undefined' && masterCatalogMap) ? masterCatalogMap.get(cleanNo) : "") || "기타 품목";
    masterItem = { artNo: cleanNo, artName: fallbackName, location: targetLoc, hfb: "기본 HFB" };
    if (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) {
      masterCatalog.push(masterItem);
    }
  }
  
  // 1. Save locally
  if (typeof saveMasterCatalog === "function") saveMasterCatalog();
  if (typeof invalidateStockCache === "function") invalidateStockCache();
  
  // 2. Sync to Supabase
  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    try {
      const dbPayload = {
        artno: masterItem.artNo,
        artname: masterItem.artName || masterItem.artname || "기타 품목",
        location: masterItem.location,
        hfb: masterItem.hfb || "기본 HFB"
      };
      
      let hasError = false;
      let lastErrorMsg = "";
      
      if (masterItem.id) {
        const { error } = await supabaseClient.from("master_catalog").update(dbPayload).eq("id", masterItem.id);
        if (error) { hasError = true; lastErrorMsg = error.message; }
      } else {
        const { data: existing, error: selErr } = await supabaseClient.from("master_catalog").select("id").eq("artno", masterItem.artNo);
        if (existing && existing.length > 0) {
          masterItem.id = existing[0].id;
          const { error: updErr } = await supabaseClient.from("master_catalog").update(dbPayload).eq("id", existing[0].id);
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
  
  // 3. Close modal & reset
  closeSingleLocationModal();
  
  // 4. Invalidate & Refresh all views
  if (typeof invalidateStockCache === "function") invalidateStockCache();
  if (typeof renderStandardLocationButtons === "function") renderStandardLocationButtons();
  if (typeof renderStandardInventory === "function") renderStandardInventory();
  if (typeof renderStandardPickList === "function") renderStandardPickList();
  if (typeof renderStockLookup === "function") renderStockLookup();
  if (typeof updateDashboard === "function") updateDashboard();
  
  showToast(`[${cleanNo}] 위치가 [${targetLoc}] (으)로 변경되었습니다.`, "success");
  if (typeof playSuccessFeedback === "function") playSuccessFeedback();
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
      badgeOrder.style.backgroundColor = "#ef4444";
      badgeOrder.style.color = "#ffffff";
      badgeOrder.style.fontWeight = "900";
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
    
    const digitsOnly = String(artNo).replace(/\D/g, '');
    const numVal = digitsOnly ? parseInt(digitsOnly, 10) : artNo;

    exportData.push({
      "연번": index++,
      "아티클 이름": artName,
      "번호 (ARTNO)": numVal,
      "재고 수량": data.currentStock !== undefined ? Number(data.currentStock) : 0,
      "위치": data.location || "미지정"
    });
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);

  for (let r = 2; r <= exportData.length + 1; r++) {
    const artCell = worksheet['C' + r];
    if (artCell && typeof artCell.v === 'number') {
      artCell.t = 'n';
      artCell.z = '00000000';
    }
  }

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
  if (typeof isViewerUser !== 'undefined' && isViewerUser) {
    showToast("Viewer(읽기 전용) 계정은 품목명을 수정할 수 없습니다.", "warning");
    return;
  }
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

/* ==========================================================================
   MORNING STORE INBOUND (아침 매장 입고 - 바코드 스캐너 건 전용) ENGINE
   ========================================================================== */

window.storeInboundCart = [];
window.isContinuousScanMode = true; // Default to ON for rapid gun scanning
window.lastScannedBarcode = "";
window.lastScanTimestamp = 0;
window.activeStoreProduct = null;

// Sound AudioContext synthesizer for scan beep
let scanAudioCtx = null;
function playScanBeep(isDouble = false) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!scanAudioCtx) scanAudioCtx = new AudioContext();
    if (scanAudioCtx.state === 'suspended') scanAudioCtx.resume();
    
    const now = scanAudioCtx.currentTime;
    const osc = scanAudioCtx.createOscillator();
    const gain = scanAudioCtx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(1800, now + 0.08);
    
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    
    osc.connect(gain);
    gain.connect(scanAudioCtx.destination);
    
    osc.start(now);
    osc.stop(now + 0.08);

    if (isDouble) {
      setTimeout(() => {
        try {
          const osc2 = scanAudioCtx.createOscillator();
          const gain2 = scanAudioCtx.createGain();
          const now2 = scanAudioCtx.currentTime;
          osc2.type = "sine";
          osc2.frequency.setValueAtTime(1600, now2);
          osc2.frequency.exponentialRampToValueAtTime(2200, now2 + 0.08);
          gain2.gain.setValueAtTime(0.25, now2);
          gain2.gain.exponentialRampToValueAtTime(0.01, now2 + 0.08);
          osc2.connect(gain2);
          gain2.connect(scanAudioCtx.destination);
          osc2.start(now2);
          osc2.stop(now2 + 0.08);
        } catch(e){}
      }, 100);
    }
  } catch(e) {
    console.warn("Scan beep error:", e);
  }
}

function playScanHaptic() {
  if (navigator && typeof navigator.vibrate === "function") {
    try { navigator.vibrate([70]); } catch(e){}
  }
}

function playWarningBeep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!scanAudioCtx) scanAudioCtx = new AudioContext();
    if (scanAudioCtx.state === 'suspended') scanAudioCtx.resume();
    
    const now = scanAudioCtx.currentTime;
    
    // First warning buzz tone (low pitch sawtooth 300Hz)
    const osc1 = scanAudioCtx.createOscillator();
    const gain1 = scanAudioCtx.createGain();
    osc1.type = "sawtooth";
    osc1.frequency.setValueAtTime(300, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.16);
    osc1.connect(gain1);
    gain1.connect(scanAudioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.16);

    // Second deeper warning tone
    setTimeout(() => {
      try {
        const now2 = scanAudioCtx.currentTime;
        const osc2 = scanAudioCtx.createOscillator();
        const gain2 = scanAudioCtx.createGain();
        osc2.type = "sawtooth";
        osc2.frequency.setValueAtTime(220, now2);
        gain2.gain.setValueAtTime(0.35, now2);
        gain2.gain.exponentialRampToValueAtTime(0.01, now2 + 0.28);
        osc2.connect(gain2);
        gain2.connect(scanAudioCtx.destination);
        osc2.start(now2);
        osc2.stop(now2 + 0.28);
      } catch(e){}
    }, 170);
  } catch(e) {
    console.warn("Warning beep error:", e);
  }
}

function playWarningHaptic() {
  if (navigator && typeof navigator.vibrate === "function") {
    try { navigator.vibrate([150, 100, 150]); } catch(e){}
  }
}

window.playWarningBeep = playWarningBeep;
window.playWarningHaptic = playWarningHaptic;

// Global Barcode Scanner Gun Keystroke Interceptor for #tab-store-inbound
let globalScannerBuffer = "";
let globalScannerTimer = null;

document.addEventListener("keydown", function(e) {
  const storeTab = document.getElementById("tab-store-inbound");
  if (!storeTab || !storeTab.classList.contains("active")) return;

  const activeEl = document.activeElement;
  const inputEl = document.getElementById("store-barcode-input");

  // If already in barcode input, let its onkeydown handle Enter
  if (activeEl && activeEl.id === "store-barcode-input") {
    return;
  }

  // Handle Enter key from hardware scanner gun
  if (e.key === "Enter") {
    if (globalScannerBuffer.trim().length >= 3) {
      e.preventDefault();
      const scannedCode = globalScannerBuffer.trim();
      globalScannerBuffer = "";
      handleStoreBarcodeInput(scannedCode);
    }
    return;
  }

  // Rapid buffer for hardware scanner gun
  if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    globalScannerBuffer += e.key;
    clearTimeout(globalScannerTimer);
    globalScannerTimer = setTimeout(() => {
      globalScannerBuffer = "";
    }, 150);
  }
});

// Auto-focus barcode input when clicking anywhere in store-inbound tab
document.addEventListener("click", function(e) {
  const storeTab = document.getElementById("tab-store-inbound");
  if (!storeTab || !storeTab.classList.contains("active")) return;

  if (
    e.target.closest("button") || 
    e.target.closest("a") || 
    (e.target.tagName === "INPUT" && e.target.id !== "store-barcode-input") ||
    e.target.closest(".autocomplete-dropdown") ||
    e.target.closest(".modal-backdrop") ||
    e.target.closest(".modal-content") ||
    e.target.closest(".autocomplete-item")
  ) {
    return;
  }

  const inputEl = document.getElementById("store-barcode-input");
  if (inputEl) inputEl.focus();
});

// Live Autocomplete for Morning Store Inbound Search
window.handleStoreAutocompleteInput = function(query) {
  let cleanQuery = String(query || '').trim().toLowerCase();
  const dropdown = document.getElementById("store-barcode-dropdown");
  if (!dropdown) return;

  if (!cleanQuery) {
    dropdown.classList.remove("active");
    dropdown.innerHTML = "";
    return;
  }

  const digitsOnly = cleanQuery.replace(/\D/g, '');
  if (digitsOnly.length > 8) {
    cleanQuery = digitsOnly.slice(0, 8);
  }

  const catalog = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog : [];
  const matches = catalog.filter(item => 
    (item.artNo && item.artNo.toLowerCase().includes(cleanQuery)) ||
    (item.artName && item.artName.toLowerCase().includes(cleanQuery)) ||
    (item.hfb && item.hfb.toLowerCase().includes(cleanQuery))
  ).slice(0, 12);

  if (matches.length === 0) {
    dropdown.classList.remove("active");
    dropdown.innerHTML = "";
    return;
  }

  dropdown.innerHTML = matches.map(item => `
    <div class="autocomplete-item" onclick="selectStoreAutocompleteItem('${item.artNo}')" style="display:flex; align-items:center; gap:10px; padding:10px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; background:#ffffff;">
      ${typeof getProductThumbHtml === 'function' ? getProductThumbHtml(item.artNo, item.artName, 44) : ''}
      <div class="art-info" style="flex:1; min-width:0;">
        <div class="art-no-row" style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
          ${item.hfb ? `<span style="background:#eff6ff; color:#0058a3; font-size:10px; font-weight:800; padding:1px 6px; border-radius:4px;">${item.hfb}</span>` : ''}
          <span class="art-no" style="font-weight:900; color:#0058a3; font-size:13px;">${item.artNo}</span>
        </div>
        <div class="art-name" style="font-size:12.5px; font-weight:700; color:#0f172a; white-space:normal; line-height:1.35;">${item.artName}</div>
      </div>
      <div style="display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:8px; background:#eff6ff; border:1px solid #bfdbfe; flex-shrink:0;">
        <i class="fa-solid fa-cart-plus" style="color:#0058a3; font-size:13.5px;"></i>
      </div>
    </div>
  `).join("");

  dropdown.classList.add("active");
  if (typeof loadProductThumbnails === "function") loadProductThumbnails();
};

window.selectStoreAutocompleteItem = function(artNo) {
  const dropdown = document.getElementById("store-barcode-dropdown");
  if (dropdown) {
    dropdown.classList.remove("active");
    dropdown.innerHTML = "";
  }
  const input = document.getElementById("store-barcode-input");
  if (input) input.value = artNo;
  
  handleStoreBarcodeInput(artNo);
};

window.onContinuousScanToggle = function(checked) {
  window.isContinuousScanMode = checked;
  if (checked) {
    showToast("⚡ 연속 빠른 담기 모드가 켜졌습니다. (스캔 시 자동 +1)", "success");
  } else {
    showToast("일반 스캔 모드로 전환되었습니다. (수량 직접 지정)", "info");
  }
};

// Master Product Resolver (Extracts front 8 digits for long barcode gun outputs)
function resolveMasterProduct(query) {
  if (!query) return null;
  const rawStr = String(query).trim();
  const digitsOnly = rawStr.replace(/\D/g, '');
  
  let targetArtNo = "";
  let front8 = "";
  let back8 = "";

  if (digitsOnly.length > 0 && digitsOnly.length <= 8) {
    targetArtNo = digitsOnly.padStart(8, '0');
  } else if (digitsOnly.length > 8) {
    // Barcode scanner outputs long strings (e.g. 90618173230792) -> Front 8 digits is the IKEA article number!
    front8 = digitsOnly.slice(0, 8);
    back8 = digitsOnly.slice(-8);
    targetArtNo = front8;
  } else {
    targetArtNo = rawStr;
  }

  // 1. Direct match in masterCatalog
  let found = (typeof masterCatalog !== "undefined" ? masterCatalog : []).find(
    m => m.artNo === targetArtNo || 
         (front8 && (m.artNo === front8 || String(m.artNo).replace(/\D/g, '') === front8)) ||
         m.artNo === digitsOnly || 
         String(m.artNo).replace(/\D/g, '') === digitsOnly ||
         (back8 && (m.artNo === back8 || String(m.artNo).replace(/\D/g, '') === back8))
  );

  // 2. Check masterCatalogMap
  let artName = "";
  if (found) {
    artName = found.artName;
    targetArtNo = found.artNo;
  } else if (typeof masterCatalogMap !== "undefined" && masterCatalogMap) {
    artName = (front8 && masterCatalogMap.get(front8)) ||
              masterCatalogMap.get(targetArtNo) || 
              masterCatalogMap.get(digitsOnly) || 
              (back8 && masterCatalogMap.get(back8)) || "";
    if (artName) {
      if (front8 && masterCatalogMap.get(front8)) targetArtNo = front8;
      found = { artNo: targetArtNo, artName: artName };
    }
  }

  // 3. Substring match
  if (!found && rawStr.length >= 3) {
    found = (typeof masterCatalog !== "undefined" ? masterCatalog : []).find(
      m => (m.artName && m.artName.toLowerCase().includes(rawStr.toLowerCase())) ||
           (m.artNo && m.artNo.includes(rawStr))
    );
    if (found) {
      targetArtNo = found.artNo;
    }
  }

  if (found) {
    return {
      artNo: found.artNo || targetArtNo,
      artName: found.artName || "매장 입고 품목",
      hfb: found.hfb || "일반",
      location: found.location || "매장",
      isUnregistered: false
    };
  }

  // Fallback for unregistered products (always use front 8 digits if scanned code was longer than 8)
  return {
    artNo: targetArtNo || rawStr,
    artName: "미등록 신규 품목",
    hfb: "일반",
    location: "매장",
    isUnregistered: true
  };
}

// Unregistered Product Warning Modal Handlers
let pendingUnregisteredScan = null;

window.openUnregisteredProductModal = function(artNo, qty) {
  pendingUnregisteredScan = { artNo, qty };
  const modal = document.getElementById("unreg-barcode-modal");
  const artNoEl = document.getElementById("unreg-modal-artno");
  const artNameInput = document.getElementById("unreg-modal-artname");
  
  if (artNoEl) artNoEl.textContent = artNo;
  if (artNameInput) artNameInput.value = "";
  if (modal) modal.classList.add("active");
};

window.closeUnregisteredProductModal = function() {
  pendingUnregisteredScan = null;
  const modal = document.getElementById("unreg-barcode-modal");
  if (modal) modal.classList.remove("active");
  const inputEl = document.getElementById("store-barcode-input");
  if (inputEl) {
    inputEl.value = "";
    inputEl.focus();
  }
};

window.confirmAddUnregisteredProduct = function() {
  if (!pendingUnregisteredScan) return;
  const { artNo, qty } = pendingUnregisteredScan;
  const artNameInput = document.getElementById("unreg-modal-artname");
  const customName = (artNameInput && artNameInput.value.trim()) ? artNameInput.value.trim() : "미등록 신규 품목";

  // Add to cart
  addStoreInboundCartItem(artNo, customName, qty);
  
  // Show flash notification banner in active product box
  const box = document.getElementById("store-active-product-box");
  if (box) {
    const existingInCart = window.storeInboundCart.find(i => i.artNo === artNo);
    const curTotalQty = existingInCart ? existingInCart.qty : qty;
    box.style.display = "block";
    box.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="product-thumb-container" style="width:42px; height:42px; min-width:42px; min-height:42px;">
          <div class="product-thumb-placeholder"><i class="fa-solid fa-couch"></i></div>
        </div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:5px; margin-bottom:1px;">
            <span style="font-size:12.5px; font-weight:900; color:#0058a3;">${artNo}</span>
            <span style="font-size:10px; font-weight:800; background:#eff6ff; color:#0058a3; padding:1px 6px; border-radius:4px; border:1px solid #bfdbfe;">+${qty}개 담김 (미등록)</span>
          </div>
          <div style="font-size:11.5px; font-weight:800; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${customName}</div>
        </div>
      </div>
    `;
  }

  showToast(`[${artNo}] ${customName} (+${qty}개 등록됨)`, "warning");
  playScanBeep(false);

  closeUnregisteredProductModal();
};

// Barcode Scanner Input Handler
window.handleStoreBarcodeInput = function(inputValue) {
  const inputEl = document.getElementById("store-barcode-input");
  const rawQuery = String(inputValue || (inputEl ? inputEl.value : "")).trim();
  
  const dropdown = document.getElementById("store-barcode-dropdown");
  if (dropdown) {
    dropdown.classList.remove("active");
    dropdown.innerHTML = "";
  }
  
  if (!rawQuery) {
    showToast("바코드 또는 아티클 번호를 입력해주세요.", "warning");
    return;
  }

  const product = resolveMasterProduct(rawQuery);
  if (!product) {
    showToast(`품목을 찾을 수 없습니다: ${rawQuery}`, "danger");
    return;
  }

  if (inputEl) {
    inputEl.value = "";
  }

  const scanQtyEl = document.getElementById("store-scan-qty");
  let scanQty = scanQtyEl ? parseInt(scanQtyEl.value, 10) : 1;
  if (isNaN(scanQty) || scanQty < 1) scanQty = 1;

  // If unregistered product, trigger warning tone/haptic & prompt modal with QR barcode guidance!
  if (product.isUnregistered) {
    playWarningBeep();
    playWarningHaptic();
    openUnregisteredProductModal(product.artNo, scanQty);
    return;
  }

  playScanBeep(window.isContinuousScanMode);
  playScanHaptic();

  if (inputEl) {
    inputEl.focus();
  }

  // Continuous Fast Add Mode (Default)
  if (window.isContinuousScanMode) {
    addStoreInboundCartItem(product.artNo, product.artName, scanQty);
    
    // Show instant flash notification banner
    const box = document.getElementById("store-active-product-box");
    if (box) {
      const existingInCart = window.storeInboundCart.find(i => i.artNo === product.artNo);
      const curTotalQty = existingInCart ? existingInCart.qty : scanQty;
      box.style.display = "block";
      box.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          ${typeof getProductThumbHtml === 'function' ? getProductThumbHtml(product.artNo, product.artName, 42) : ''}
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:5px; margin-bottom:1px;">
              <span style="font-size:12.5px; font-weight:900; color:#0058a3;">${product.artNo}</span>
              <span style="font-size:10px; font-weight:800; background:#eff6ff; color:#0058a3; padding:1px 6px; border-radius:4px; border:1px solid #bfdbfe;">+${scanQty}개 담김 (총 ${curTotalQty}개)</span>
            </div>
            <div style="font-size:11.5px; font-weight:800; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${product.artName}</div>
          </div>
        </div>
      `;
      if (typeof loadProductThumbnails === "function") loadProductThumbnails();
    }

    showToast(`⚡ [${product.artNo}] ${product.artName} (+${scanQty}개 담김)`, "success");
    return;
  }

  // Normal Mode: Show active product box with quantity stepper
  window.activeStoreProduct = { ...product, qty: scanQty };
  renderStoreActiveProduct();
};

// Render Scanned Active Product Details
function renderStoreActiveProduct() {
  const box = document.getElementById("store-active-product-box");
  if (!box || !window.activeStoreProduct) {
    if (box) box.style.display = "none";
    return;
  }

  const p = window.activeStoreProduct;
  const currentStock = (typeof calculateStock === "function") ? calculateStock(p.artNo) : "-";

  box.style.display = "block";
  box.innerHTML = `
    <div style="display:flex; gap:10px; align-items:center; margin-bottom:8px;">
      ${typeof getProductThumbHtml === 'function' ? getProductThumbHtml(p.artNo, p.artName, 52) : ''}
      <div style="flex:1; min-width:0;">
        <div style="display:flex; align-items:center; gap:5px; margin-bottom:2px;">
          <span style="font-size:13px; font-weight:900; color:#0058a3;">${p.artNo}</span>
          <span style="font-size:10px; font-weight:700; background:#f1f5f9; color:#475569; padding:1px 5px; border-radius:4px;">현재재고 ${currentStock}개</span>
        </div>
        <div style="font-size:12.5px; font-weight:800; color:#0f172a; word-break:break-all; line-height:1.2;">${p.artName}</div>
      </div>
    </div>

    <!-- Quantity Stepper & Quick Add Buttons -->
    <div style="display:flex; flex-direction:column; gap:6px; background:#ffffff; padding:8px 10px; border-radius:8px; border:1px solid #e2e8f0;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:11.5px; font-weight:700; color:#475569;">매장 입고 수량</span>
        <div style="display:flex; align-items:center; gap:4px;">
          <button type="button" onclick="adjustActiveStoreQty(-1)" style="width:30px; height:30px; border-radius:6px; border:1px solid #cbd5e1; background:#f8fafc; font-size:14px; font-weight:800; cursor:pointer;">-</button>
          <input type="number" id="store-active-qty" value="${p.qty}" min="1" style="width:55px; height:30px; text-align:center; font-size:14px; font-weight:900; color:#0f172a; border:1px solid #cbd5e1; border-radius:6px; background:#ffffff;" onchange="updateActiveStoreQty(this.value)">
          <button type="button" onclick="adjustActiveStoreQty(1)" style="width:30px; height:30px; border-radius:6px; border:1px solid #cbd5e1; background:#f8fafc; font-size:14px; font-weight:800; cursor:pointer;">+</button>
        </div>
      </div>

      <!-- Quick Add Buttons -->
      <div style="display:flex; gap:4px; justify-content:flex-end;">
        <button type="button" onclick="adjustActiveStoreQty(1)" style="padding:2px 8px; font-size:10.5px; font-weight:700; border-radius:4px; background:#f1f5f9; border:1px solid #e2e8f0; color:#334155; cursor:pointer;">+1</button>
        <button type="button" onclick="adjustActiveStoreQty(5)" style="padding:2px 8px; font-size:10.5px; font-weight:700; border-radius:4px; background:#f1f5f9; border:1px solid #e2e8f0; color:#334155; cursor:pointer;">+5</button>
        <button type="button" onclick="adjustActiveStoreQty(10)" style="padding:2px 8px; font-size:10.5px; font-weight:700; border-radius:4px; background:#f1f5f9; border:1px solid #e2e8f0; color:#334155; cursor:pointer;">+10</button>
      </div>
    </div>

    <!-- Actions -->
    <div style="display:flex; gap:6px; margin-top:8px;">
      <button type="button" onclick="confirmAddActiveStoreProduct()" style="flex:1; height:36px; border-radius:8px; background:#ffffff; border:1px solid #0058a3; color:#0058a3; font-size:12.5px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px;">
        <i class="fa-solid fa-cart-plus"></i> 목록에 담기
      </button>
      <button type="button" onclick="directSaveActiveStoreProduct()" style="flex:1.2; height:36px; border-radius:8px; background:#0058a3; border:none; color:#ffffff; font-size:12.5px; font-weight:900; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px; box-shadow:0 2px 6px rgba(0,88,163,0.25);">
        <i class="fa-solid fa-bolt"></i> ⚡ 바로 입고 저장
      </button>
    </div>
  `;

  if (typeof loadProductThumbnails === "function") loadProductThumbnails();
}

window.adjustActiveStoreQty = function(delta) {
  if (!window.activeStoreProduct) return;
  window.activeStoreProduct.qty = Math.max(1, (window.activeStoreProduct.qty || 1) + delta);
  const input = document.getElementById("store-active-qty");
  if (input) input.value = window.activeStoreProduct.qty;
};

window.updateActiveStoreQty = function(val) {
  if (!window.activeStoreProduct) return;
  const num = parseInt(val, 10);
  window.activeStoreProduct.qty = isNaN(num) || num < 1 ? 1 : num;
};

window.confirmAddActiveStoreProduct = function() {
  if (!window.activeStoreProduct) return;
  const p = window.activeStoreProduct;
  addStoreInboundCartItem(p.artNo, p.artName, p.qty);
  window.activeStoreProduct = null;
  const box = document.getElementById("store-active-product-box");
  if (box) box.style.display = "none";
};

window.directSaveActiveStoreProduct = async function() {
  if (!window.activeStoreProduct) return;
  const p = window.activeStoreProduct;
  addStoreInboundCartItem(p.artNo, p.artName, p.qty);
  window.activeStoreProduct = null;
  const box = document.getElementById("store-active-product-box");
  if (box) box.style.display = "none";
  await processStoreInboundCart();
};

// ==========================================================================
// LOCAL DATE UTILITIES (KST Timezone Safe, Prevents UTC Morning Shift Bug)
// ==========================================================================
function getLocalDateString(d = new Date()) {
  const target = (d instanceof Date && !isNaN(d)) ? d : new Date();
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

window.getLocalDateString = getLocalDateString;
window.getTodayDateString = function() {
  return getLocalDateString(new Date());
};
window.getYesterdayDateString = function() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getLocalDateString(d);
};

// Quick Date Setters for Store Inbound
window.setStoreInboundDateToday = function() {
  const input = document.getElementById("store-inbound-date");
  if (input) {
    const today = window.getTodayDateString();
    input.value = today;
    window.onStoreInboundDateChange(today);
  }
};

window.setStoreInboundDateYesterday = function() {
  const input = document.getElementById("store-inbound-date");
  if (input) {
    const yesterday = window.getYesterdayDateString();
    input.value = yesterday;
    window.onStoreInboundDateChange(yesterday);
  }
};

// Quantity Stepper for Store Inbound
window.stepStoreScanQty = function(delta) {
  const q = document.getElementById("store-scan-qty");
  if (q) {
    const cur = parseInt(q.value, 10) || 1;
    q.value = Math.max(1, cur + delta);
  }
};

let storeInboundPendingBtnElem = null;

// Handle Store Inbound Menu Click (Shows Notice Popup for all accounts)
window.handleStoreInboundMenuClick = function(btnElement) {
  storeInboundPendingBtnElem = btnElement;
  openStoreInboundNoticeModal();
};

window.openStoreInboundNoticeModal = function() {
  const modal = document.getElementById("store-inbound-notice-modal");
  if (modal) {
    modal.classList.add("active");
  } else {
    // Fallback if modal not present
    switchTab('store-inbound', storeInboundPendingBtnElem || document.querySelector('.bottom-nav .nav-item:first-child'));
  }
};

window.closeStoreInboundNoticeModal = function() {
  const modal = document.getElementById("store-inbound-notice-modal");
  if (modal) modal.classList.remove("active");
};

window.confirmStoreInboundNotice = function() {
  closeStoreInboundNoticeModal();
  switchTab('store-inbound', storeInboundPendingBtnElem || document.querySelector('.bottom-nav .nav-item:first-child'));
};

// When user changes date picker in Store Inbound
window.onStoreInboundDateChange = function(newDate) {
  const targetDate = newDate || window.getTodayDateString();
  
  // 1. Update all staged items in the cart
  if (window.storeInboundCart && window.storeInboundCart.length > 0) {
    window.storeInboundCart.forEach(item => {
      item.date = targetDate;
    });
  }

  // 2. Re-render Cart & Saved List for this date
  renderStoreInboundCart();
  renderStoreInboundSavedList();
};

// Cart Item Management
function addStoreInboundCartItem(artNo, artName, qty = 1) {
  const storeDateEl = document.getElementById("store-inbound-date");
  const selectedDate = (storeDateEl && storeDateEl.value) 
    ? storeDateEl.value 
    : window.getTodayDateString();

  const existing = window.storeInboundCart.find(item => item.artNo === artNo);
  if (existing) {
    existing.qty += qty;
    existing.date = selectedDate;
  } else {
    window.storeInboundCart.unshift({
      artNo: artNo,
      artName: artName,
      qty: qty,
      date: selectedDate,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  }
  renderStoreInboundCart();
}

window.removeStoreInboundCartItem = function(index) {
  window.storeInboundCart.splice(index, 1);
  renderStoreInboundCart();
};

window.setStoreCartItemQty = function(index, val) {
  if (!window.storeInboundCart[index]) return;
  const num = parseInt(val, 10);
  window.storeInboundCart[index].qty = isNaN(num) || num < 1 ? 1 : num;
  renderStoreInboundCart();
};

window.adjustStoreCartItemQty = function(index, delta) {
  if (!window.storeInboundCart[index]) return;
  window.storeInboundCart[index].qty = Math.max(1, window.storeInboundCart[index].qty + delta);
  renderStoreInboundCart();
};

window.clearStoreInboundCart = function() {
  if (window.storeInboundCart.length === 0) return;
  if (!confirm("매장 입고 대기 목록을 모두 비우시겠습니까?")) return;
  window.storeInboundCart = [];
  renderStoreInboundCart();
};

// Render Cart
function renderStoreInboundCart() {
  const container = document.getElementById("store-inbound-cart-items");
  const saveSection = document.getElementById("store-inbound-save-section");
  const badge = document.getElementById("store-cart-badge");
  const menuBadge = document.getElementById("badge-store-inbound");
  const totalQtyEl = document.getElementById("store-cart-total-qty");
  const cartDateLabel = document.getElementById("store-cart-date-label");

  const storeDateEl = document.getElementById("store-inbound-date");
  const selectedDate = (storeDateEl && storeDateEl.value) ? storeDateEl.value : window.getTodayDateString();

  if (cartDateLabel) {
    cartDateLabel.textContent = selectedDate;
  }

  const totalCount = window.storeInboundCart.length;
  const totalQty = window.storeInboundCart.reduce((sum, item) => sum + (item.qty || 0), 0);

  if (badge) badge.textContent = `${totalCount}건 (${totalQty}개)`;
  if (menuBadge) {
    if (totalCount > 0) {
      menuBadge.style.display = "inline-block";
      menuBadge.textContent = String(totalCount);
    } else {
      menuBadge.style.display = "none";
    }
  }

  if (totalQtyEl) totalQtyEl.textContent = `${totalQty}개`;

  if (!container) return;

  if (totalCount === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:18px; color:#94a3b8; font-size:12px;">
        <i class="fa-solid fa-barcode" style="font-size:24px; margin-bottom:4px; display:block; opacity:0.5;"></i>
        스캔하거나 입력한 입고 대기 품목이 없습니다. (${selectedDate})
      </div>
    `;
    if (saveSection) saveSection.style.display = "none";
    return;
  }

  if (saveSection) saveSection.style.display = "block";

  let html = "";
  window.storeInboundCart.forEach((item, idx) => {
    html += `
      <div class="store-cart-item">
        ${typeof getProductThumbHtml === 'function' ? getProductThumbHtml(item.artNo, item.artName, 42) : ''}
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
            <span style="font-size:12px; font-weight:900; color:#0058a3;">${item.artNo}</span>
            <span style="font-size:9.5px; background:#f1f5f9; color:#475569; padding:1px 5px; border-radius:4px; font-weight:700;">${item.date || selectedDate}</span>
            <span style="font-size:9.5px; color:#64748b;">${item.time || ''}</span>
          </div>
          <div style="font-size:11.5px; font-weight:800; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.artName}</div>
        </div>
        <div style="display:flex; align-items:center; gap:3px; flex-shrink:0;">
          <button type="button" onclick="adjustStoreCartItemQty(${idx}, -1)" style="width:26px; height:28px; border-radius:6px; border:1px solid #cbd5e1; background:#f8fafc; font-size:13px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center;">-</button>
          <input type="number" min="1" value="${item.qty}" onchange="setStoreCartItemQty(${idx}, this.value)" onfocus="this.select()" style="width:48px; height:28px; text-align:center; font-size:14px; font-weight:900; color:#0f172a; border:1.5px solid #cbd5e1; border-radius:6px; background:#ffffff; padding:0 2px; -moz-appearance:textfield;" title="수량 직접 입력">
          <button type="button" onclick="adjustStoreCartItemQty(${idx}, 1)" style="width:26px; height:28px; border-radius:6px; border:1px solid #cbd5e1; background:#f8fafc; font-size:13px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center;">+</button>
          <button type="button" onclick="removeStoreInboundCartItem(${idx})" style="background:none; border:none; color:#94a3b8; font-size:14px; cursor:pointer; padding:2px 4px; margin-left:2px;" title="삭제">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  if (typeof loadProductThumbnails === "function") loadProductThumbnails();
}

// Render Saved Store Inbound Records for Selected Date
window.renderStoreInboundSavedList = function() {
  const container = document.getElementById("store-inbound-saved-items");
  const dateLabel = document.getElementById("store-saved-date-label");
  const badge = document.getElementById("store-saved-badge");

  const storeDateEl = document.getElementById("store-inbound-date");
  const selectedDate = (storeDateEl && storeDateEl.value) ? storeDateEl.value : window.getTodayDateString();

  if (dateLabel) dateLabel.textContent = selectedDate;

  if (typeof storeInboundLogs === "undefined" || !storeInboundLogs) {
    if (container) {
      container.innerHTML = `
        <div style="text-align:center; padding:16px; color:#94a3b8; font-size:12px;">
          <i class="fa-regular fa-folder-open" style="font-size:20px; display:block; margin-bottom:4px; opacity:0.5;"></i>
          매장 입고 기록을 불러오는 중입니다...
        </div>
      `;
    }
    return;
  }

  // Filter logs for selected date
  const filtered = storeInboundLogs.filter(log => {
    const logDate = (log.date || (log.created_at ? log.created_at.split('T')[0] : "")).trim();
    return logDate === selectedDate;
  });

  const totalCount = filtered.length;
  const totalQty = filtered.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);

  if (badge) {
    badge.textContent = `${totalCount}건 (${totalQty}개)`;
  }

  if (!container) return;

  if (totalCount === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:18px; color:#94a3b8; font-size:12px; background:#f8fafc; border-radius:10px; border:1px dashed #cbd5e1;">
        <i class="fa-regular fa-calendar-xmark" style="font-size:22px; display:block; margin-bottom:4px; opacity:0.5;"></i>
        해당 일자(${selectedDate})에 완료된 매장 입고 기록이 없습니다.
      </div>
    `;
    return;
  }

  let html = "";
  filtered.forEach((log) => {
    const rawNo = String(log.artNo || log.artno || "").trim();
    const cleanNo = rawNo.replace(/\D/g, '').padStart(8, '0');
    const artName = log.artName || log.artname || (typeof masterCatalogMap !== 'undefined' ? masterCatalogMap.get(cleanNo) : "매장 입고 품목");
    const qty = Number(log.qty) || 1;
    const user = log.user || "매장";
    const timeStr = log.time || (log.created_at ? new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "");

    html += `
      <div class="store-saved-item" id="store-saved-${log.id}">
        ${typeof getProductThumbHtml === 'function' ? getProductThumbHtml(cleanNo, artName, 40) : ''}
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:5px;">
            <span style="font-size:12px; font-weight:900; color:#0058a3;">${cleanNo}</span>
            <span style="font-size:9.5px; color:#64748b;">${timeStr} · ${user}</span>
          </div>
          <div style="font-size:11.5px; font-weight:800; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${artName}</div>
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
          <span style="font-size:12.5px; font-weight:900; color:#107c41; background:#ecfdf5; border:1px solid #a7f3d0; padding:2px 8px; border-radius:6px;">
            ${qty}개
          </span>
          ${(typeof isAdminUser !== 'undefined' && isAdminUser) ? `
            <button type="button" onclick="deleteStoreInboundLog('${log.id}')" style="background:none; border:none; color:#94a3b8; font-size:13px; cursor:pointer; padding:3px;" title="이 입고 기록 삭제">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  if (typeof loadProductThumbnails === "function") loadProductThumbnails();
};

// Delete a single saved store inbound log
window.deleteStoreInboundLog = async function(id) {
  const target = (typeof storeInboundLogs !== "undefined") ? storeInboundLogs.find(l => String(l.id) === String(id)) : null;
  const artName = target ? (target.artName || target.artNo) : "선택 품목";

  if (!confirm(`[${artName}] 매장 입고 기록을 삭제하시겠습니까?`)) {
    return;
  }

  try {
    if (typeof supabaseClient !== "undefined" && supabaseClient) {
      await supabaseClient.from('store_inbound_logs').delete().eq('id', id);
    }
  } catch (err) {
    console.warn("Supabase store inbound delete error:", err);
  }

  if (typeof storeInboundLogs !== "undefined") {
    storeInboundLogs = storeInboundLogs.filter(l => String(l.id) !== String(id));
    localStorage.setItem("warehouse_store_inbound_logs", JSON.stringify(storeInboundLogs));
  }

  // Refresh views
  if (typeof invalidateStockCache === "function") invalidateStockCache();
  if (typeof renderStockLookup === "function") renderStockLookup();
  if (typeof renderHistoryLogs === "function") renderHistoryLogs();
  if (typeof updateDashboard === "function") updateDashboard();
  renderStoreInboundSavedList();

  showToast("매장 입고 기록이 삭제되었습니다.", "info");
};

// Process and Save Store Inbound Cart (Available to all accounts)
window.processStoreInboundCart = async function() {
  if (window.storeInboundCart.length === 0) {
    showToast("입고 처리할 품목이 없습니다.", "warning");
    return;
  }

  const saveBtn = document.getElementById("btn-save-store-inbound");
  const originalBtnText = saveBtn ? saveBtn.innerHTML : "";
  if (saveBtn) {
    saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 매장 입고 저장 중...`;
    saveBtn.disabled = true;
  }

  const storeDateEl = document.getElementById("store-inbound-date");
  const selectedDateStr = (storeDateEl && storeDateEl.value) 
    ? storeDateEl.value 
    : window.getTodayDateString();

  const totalItemCount = window.storeInboundCart.length;
  const totalItemQty = window.storeInboundCart.reduce((sum, i) => sum + (i.qty || 0), 0);

  // Guarantee date strictly matches the selected date in UI
  const payload = window.storeInboundCart.map(item => ({
    date: selectedDateStr,
    type: "매장입고",
    artno: item.artNo,
    artname: item.artName,
    qty: item.qty,
    user: (typeof currentUser !== "undefined" && currentUser) ? currentUser : "매장"
  }));

  try {
    if (typeof supabaseClient !== "undefined" && supabaseClient) {
      const { data, error } = await supabaseClient
        .from('store_inbound_logs')
        .insert(payload)
        .select();

      if (error) throw error;
      
      if (data && typeof storeInboundLogs !== "undefined") {
        data.forEach(inserted => {
          let cleanNo = String(inserted.artno || inserted.artNo || "").trim();
          const digitsOnly = cleanNo.replace(/\D/g, '');
          if (digitsOnly.length > 0 && digitsOnly.length <= 8) {
            cleanNo = digitsOnly.padStart(8, '0');
          }
          storeInboundLogs.unshift({
            ...inserted,
            date: inserted.date || selectedDateStr,
            artNo: cleanNo,
            artName: inserted.artname || inserted.artName || (typeof masterCatalogMap !== 'undefined' ? masterCatalogMap.get(cleanNo) : "매장 입고 품목")
          });
        });
        localStorage.setItem("warehouse_store_inbound_logs", JSON.stringify(storeInboundLogs));
      }
    } else {
      // Local fallback
      if (typeof storeInboundLogs !== "undefined") {
        payload.forEach(p => {
          storeInboundLogs.unshift({
            id: Date.now() + Math.random(),
            date: p.date,
            type: p.type,
            artNo: p.artno,
            artName: p.artname,
            qty: p.qty,
            user: p.user
          });
        });
        localStorage.setItem("warehouse_store_inbound_logs", JSON.stringify(storeInboundLogs));
      }
    }

    // Refresh app views
    if (typeof invalidateStockCache === "function") invalidateStockCache();
    if (typeof renderStockLookup === "function") renderStockLookup();
    if (typeof renderHistoryLogs === "function") renderHistoryLogs();
    if (typeof updateDashboard === "function") updateDashboard();

    showToast(`🎉 [${selectedDateStr}] 매장 입고 완료! (${totalItemCount}개 품목 / 총 ${totalItemQty}개)`, "success");
    if (typeof playSuccessFeedback === "function") playSuccessFeedback();

    window.storeInboundCart = [];
    renderStoreInboundCart();
    renderStoreInboundSavedList();

  } catch (err) {
    console.error("Store inbound save error:", err);
    showToast("매장 입고 저장 중 오류가 발생했습니다.", "danger");
  } finally {
    if (saveBtn) {
      saveBtn.innerHTML = originalBtnText;
      saveBtn.disabled = false;
    }
  }
};

// ==========================================================================
// STORE INBOUND EXCEL EXPORT (.XLSX) - ALL ADMIN ACCOUNTS SUPPORTED
// ==========================================================================
window.exportStoreInboundToExcel = async function(selectedDateOnly = false) {
  if (typeof isAdminUser === 'undefined' || !isAdminUser) {
    showToast("매장 입고 엑셀 추출은 관리자(Admin) 전용 기능입니다.", "danger");
    return;
  }

  if (typeof XLSX === "undefined") {
    showToast("엑셀 내보내기 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.", "warning");
    return;
  }

  const storeDateEl = document.getElementById("store-inbound-date");
  const selectedDateStr = (storeDateEl && storeDateEl.value) ? storeDateEl.value : window.getTodayDateString();

  let dataToExport = [];

  // 1. Fetch from Supabase store_inbound_logs
  if (typeof supabaseClient !== "undefined" && supabaseClient) {
    try {
      let query = supabaseClient
        .from('store_inbound_logs')
        .select('*')
        .order('id', { ascending: false });

      if (selectedDateOnly) {
        query = query.eq('date', selectedDateStr);
      }

      const { data: dbLogs, error } = await query;

      if (!error && dbLogs && dbLogs.length > 0) {
        dataToExport = dbLogs.map(row => {
          let cleanNo = String(row.artno || row.artNo || "").trim();
          const digitsOnly = cleanNo.replace(/\D/g, '');
          if (digitsOnly.length > 0 && digitsOnly.length <= 8) {
            cleanNo = digitsOnly.padStart(8, '0');
          }
          return {
            ...row,
            artNo: cleanNo,
            artName: row.artname || row.artName || (typeof masterCatalogMap !== 'undefined' ? masterCatalogMap.get(cleanNo) : "매장 입고 품목")
          };
        });
      }
    } catch(e) {
      console.warn("Fetch store_inbound_logs error:", e);
    }
  }

  // 2. Fallback to memory storeInboundLogs
  if (dataToExport.length === 0 && typeof storeInboundLogs !== "undefined" && storeInboundLogs.length > 0) {
    if (selectedDateOnly) {
      dataToExport = storeInboundLogs.filter(log => (log.date || (log.created_at ? log.created_at.split('T')[0] : "")) === selectedDateStr);
    } else {
      dataToExport = [...storeInboundLogs];
    }
  }

  // 3. Fallback to current unsaved cart if exporting selected date
  if (dataToExport.length === 0 && window.storeInboundCart && window.storeInboundCart.length > 0) {
    dataToExport = window.storeInboundCart.map(item => ({
      date: item.date || selectedDateStr,
      type: "매장입고(대기)",
      artNo: item.artNo,
      artName: item.artName,
      qty: item.qty,
      user: (typeof currentUser !== "undefined" && currentUser) ? currentUser : "매장"
    }));
  }

  if (dataToExport.length === 0) {
    showToast(selectedDateOnly ? `선택한 날짜(${selectedDateStr})에 추출할 매장 입고 내역이 없습니다.` : "추출할 매장 입고 내역이 없습니다.", "warning");
    return;
  }

  const rows = dataToExport.map((log, index) => {
    const rawNo = String(log.artNo || log.artno || "").trim();
    const digitsOnly = rawNo.replace(/\D/g, '');
    const numVal = digitsOnly ? parseInt(digitsOnly, 10) : rawNo;
    return {
      "연번": index + 1,
      "입고일자": log.date || (log.created_at ? log.created_at.split('T')[0] : "-"),
      "구분": log.type || "매장입고",
      "아티클 번호 (ARTNO)": numVal,
      "품목명": log.artName || log.artname || "-",
      "입고 수량": Number(log.qty) || 1,
      "등록자": log.user || "매장",
      "등록일시": log.created_at || log.time || "-"
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Set explicit numeric cell format for formulas (VLOOKUP, INDEX/MATCH, SUMIF)
  for (let r = 2; r <= rows.length + 1; r++) {
    const artCell = worksheet['D' + r];
    if (artCell && typeof artCell.v === 'number') {
      artCell.t = 'n';
      artCell.z = '00000000';
    }
    const qtyCell = worksheet['F' + r];
    if (qtyCell && typeof qtyCell.v === 'number') {
      qtyCell.t = 'n';
      qtyCell.z = '#,##0';
    }
  }

  // Column widths
  worksheet["!cols"] = [
    { wch: 6 },  // 연번
    { wch: 12 }, // 입고일자
    { wch: 10 }, // 구분
    { wch: 14 }, // 아티클 번호
    { wch: 35 }, // 품목명
    { wch: 10 }, // 입고 수량
    { wch: 12 }, // 등록자
    { wch: 22 }  // 등록일시
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "매장입고기록");
  
  const fileName = selectedDateOnly ? `매장입고_기록_${selectedDateStr}.xlsx` : `매장입고_전체기록_${window.getTodayDateString()}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  showToast(`📊 매장 입고 기록 (${dataToExport.length}건) 엑셀 추출이 완료되었습니다!`, "success");
  if (typeof playSuccessFeedback === "function") playSuccessFeedback();
};

// --- Warehouse Location Guidance & Mandatory Inbound Location Validation ---

window.updateRegLocationGuideBanner = function(artNo, optLoc, optType) {
  const banner = document.getElementById("reg-location-guide-banner");
  if (!banner) return;

  const cleanNo = artNo ? String(artNo).trim() : "";
  if (!cleanNo) {
    banner.style.display = "none";
    banner.innerHTML = "";
    return;
  }

  // Determine Type (입고 or 출고)
  let type = optType;
  if (!type) {
    const checkedOption = document.querySelector('input[name="reg-type"]:checked');
    type = checkedOption ? checkedOption.value : "입고";
  }

  // Find Location
  const locInput = document.getElementById("reg-location");
  let currentLoc = optLoc !== undefined ? optLoc : (locInput ? locInput.value.trim() : "");

  if (!currentLoc) {
    let masterItem = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) ? masterCatalog.find(m => {
      const mNo = String(m.artNo || m.artno || "").trim();
      return mNo === cleanNo || mNo.replace(/\D/g, '') === cleanNo.replace(/\D/g, '');
    }) : null;

    if (masterItem && masterItem.location && masterItem.location !== "미지정" && masterItem.location.trim() !== "") {
      currentLoc = masterItem.location.trim();
      if (locInput && !locInput.value.trim()) {
        locInput.value = currentLoc;
        if (typeof updateRegLocationButtons === "function") updateRegLocationButtons();
      }
    }
  }

  const isUnspecified = !currentLoc || currentLoc === "미지정" || currentLoc.trim() === "";

  if (isUnspecified) {
    banner.style.display = "block";
    banner.style.background = "#fffbeb";
    banner.style.border = "1.5px solid #fde68a";
    banner.style.padding = "10px 12px";
    banner.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <div style="width:34px; height:34px; border-radius:8px; background:#fef3c7; color:#d97706; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0;">
          <i class="fa-solid fa-triangle-exclamation"></i>
        </div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:12.5px; font-weight:900; color:#b45309;">⚠️ 위치 미지정 품목</span>
            <span style="font-size:10px; font-weight:800; background:#fef3c7; color:#92400e; padding:1px 5px; border-radius:4px;">구역 지정 필요</span>
          </div>
          <div style="font-size:11.5px; font-weight:700; color:#92400e; margin-top:2px;">
            보관 구역이 설정되지 않았습니다. 입고 시 아래 구역(B1, B2, B2 램프, B3)을 선택해 주세요!
          </div>
        </div>
      </div>
    `;
  } else {
    if (type === "출고") {
      banner.style.display = "block";
      banner.style.background = "#fff1f2";
      banner.style.border = "1.5px solid #fecdd3";
      banner.style.padding = "10px 12px";
      banner.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:34px; height:34px; border-radius:8px; background:#ffe4e6; color:#e11d48; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0;">
            <i class="fa-solid fa-box-open"></i>
          </div>
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:13px; font-weight:900; color:#9f1239;">📍 [${currentLoc}] 구역 보관 품목</span>
              <span style="font-size:10px; font-weight:800; background:#ffe4e6; color:#be123c; padding:1px 6px; border-radius:4px;">출고 픽업</span>
            </div>
            <div style="font-size:12px; font-weight:800; color:#be123c; margin-top:2px;">
              <strong style="text-decoration:underline;">${currentLoc}</strong> 구역 선반에서 물건을 챙기세요.
            </div>
          </div>
        </div>
      `;
    } else {
      banner.style.display = "block";
      banner.style.background = "#eff6ff";
      banner.style.border = "1.5px solid #bfdbfe";
      banner.style.padding = "10px 12px";
      banner.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:34px; height:34px; border-radius:8px; background:#dbeafe; color:#0284c7; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0;">
            <i class="fa-solid fa-arrow-down-to-bracket"></i>
          </div>
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:13px; font-weight:900; color:#0369a1;">📍 [${currentLoc}] 구역 보관 품목</span>
              <span style="font-size:10px; font-weight:800; background:#dbeafe; color:#0058a3; padding:1px 6px; border-radius:4px;">입고 이동</span>
            </div>
            <div style="font-size:12px; font-weight:800; color:#0058a3; margin-top:2px;">
              이 물건은 <strong style="text-decoration:underline;">${currentLoc}</strong> 구역으로 이동하여 보관하세요.
            </div>
          </div>
        </div>
      `;
    }
  }
};

// Bind inputs for realtime location guide sync
document.addEventListener("DOMContentLoaded", () => {
  const regArtNo = document.getElementById("reg-artno");
  if (regArtNo) {
    regArtNo.addEventListener("input", () => {
      window.updateRegLocationGuideBanner(regArtNo.value.trim());
    });
  }
  const regLoc = document.getElementById("reg-location");
  if (regLoc) {
    regLoc.addEventListener("input", () => {
      if (typeof updateRegLocationButtons === "function") updateRegLocationButtons();
      const artNoVal = regArtNo ? regArtNo.value.trim() : "";
      window.updateRegLocationGuideBanner(artNoVal, regLoc.value.trim());
    });
  }
});

// ==========================================
// 🏢 Enhanced Songdo MFAQ System (제품 검색, HFB 자동 연동, 실시간 카운트)
// ==========================================

window.selectedMfaqProduct = null;

// --- MFAQ Category Management & Editing Engine ---
window.getMfaqCategories = function() {
  try {
    const saved = localStorage.getItem("warehouse_mfaq_categories");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch(e) {}
  return ["제품 질문/요청", "매장 질문"];
};

window.saveMfaqCategories = function(cats) {
  try {
    localStorage.setItem("warehouse_mfaq_categories", JSON.stringify(cats));
  } catch(e) {}
  window.updateMfaqCategoryDropdowns();
};

window.updateMfaqCategoryDropdowns = function() {
  const cats = window.getMfaqCategories();

  // 1. Filter dropdown
  const filterEl = document.getElementById("mfaq-filter-category");
  if (filterEl) {
    const currentVal = filterEl.value;
    let html = '<option value="all">전체 구분</option>';
    cats.forEach(c => {
      html += `<option value="${c}">${c}</option>`;
    });
    filterEl.innerHTML = html;
    if (cats.includes(currentVal) || currentVal === "all") {
      filterEl.value = currentVal;
    } else {
      filterEl.value = "all";
    }
  }

  // 2. New MFAQ modal dropdown
  const newCatEl = document.getElementById("mfaq-new-category");
  if (newCatEl) {
    const currentVal = newCatEl.value;
    let html = '';
    cats.forEach(c => {
      html += `<option value="${c}">${c}</option>`;
    });
    newCatEl.innerHTML = html;
    if (cats.includes(currentVal)) {
      newCatEl.value = currentVal;
    } else if (cats.length > 0) {
      newCatEl.value = cats[0];
    }
  }

  // 3. Edit modal dropdown
  const editCatEl = document.getElementById("edit-mfaq-category");
  if (editCatEl) {
    const currentVal = editCatEl.value;
    let html = '';
    cats.forEach(c => {
      html += `<option value="${c}">${c}</option>`;
    });
    editCatEl.innerHTML = html;
    if (cats.includes(currentVal)) {
      editCatEl.value = currentVal;
    }
  }
};

// Open Category Manager Modal
window.openMfaqCategoryMgrModal = function() {
  window.renderMfaqCategoryMgrList();
  const modal = document.getElementById("mfaq-category-mgr-modal");
  if (modal) modal.classList.add("active");
  const input = document.getElementById("mfaq-new-category-input");
  if (input) {
    input.value = "";
    setTimeout(() => input.focus(), 100);
  }
};

window.closeMfaqCategoryMgrModal = function() {
  const modal = document.getElementById("mfaq-category-mgr-modal");
  if (modal) modal.classList.remove("active");
};

window.renderMfaqCategoryMgrList = function() {
  const container = document.getElementById("mfaq-category-list-container");
  if (!container) return;
  const cats = window.getMfaqCategories();

  container.innerHTML = cats.map((cat, idx) => {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:9px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="width:22px; height:22px; border-radius:50%; background:#e2e8f0; color:#475569; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center;">${idx + 1}</span>
          <span style="font-size:13.5px; font-weight:800; color:#0f172a;">${cat}</span>
        </div>
        <div style="display:flex; gap:5px;">
          <button type="button" onclick="editMfaqCategoryName('${cat.replace(/'/g, "\\'")}')" style="background:#ffffff; border:1px solid #cbd5e1; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:700; color:#0058a3; cursor:pointer;" title="이름 수정">
            <i class="fa-solid fa-pen"></i> 수정
          </button>
          ${cats.length > 1 ? `
            <button type="button" onclick="deleteMfaqCategory('${cat.replace(/'/g, "\\'")}')" style="background:#ffffff; border:1px solid #cbd5e1; border-radius:6px; padding:4px 9px; font-size:12px; font-weight:700; color:#ef4444; cursor:pointer;" title="삭제">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
};

window.addNewMfaqCategory = function() {
  const input = document.getElementById("mfaq-new-category-input");
  const name = (input?.value || "").trim();
  if (!name) {
    showToast("카테고리 이름을 입력해 주세요.", "warning");
    return;
  }
  const cats = window.getMfaqCategories();
  if (cats.includes(name)) {
    showToast("이미 등록된 카테고리 이름입니다.", "warning");
    return;
  }
  cats.push(name);
  window.saveMfaqCategories(cats);
  window.renderMfaqCategoryMgrList();
  renderMfaq();
  if (input) input.value = "";
  showToast(`'${name}' 카테고리가 추가되었습니다!`, "success");
};

window.editMfaqCategoryName = async function(oldName) {
  const newName = prompt(`'${oldName}' 카테고리의 새 이름을 입력하세요:`, oldName);
  if (!newName || newName.trim() === oldName) return;
  const cleanName = newName.trim();

  let cats = window.getMfaqCategories();
  const idx = cats.indexOf(oldName);
  if (idx !== -1) {
    cats[idx] = cleanName;
    window.saveMfaqCategories(cats);
  }

  // Update existing items matching oldName
  let countUpdated = 0;
  (mfaqLogs || []).forEach(log => {
    if (log.category === oldName) {
      log.category = cleanName;
      log.lastUpdated = new Date().toISOString();
      countUpdated++;
      if (typeof supabaseClient !== 'undefined' && supabaseClient) {
        supabaseClient.from("mfaq_logs").update({ category: cleanName }).eq("id", log.id).then();
      }
    }
  });

  if (countUpdated > 0) saveMfaqLogs();
  renderMfaq();
  window.renderMfaqCategoryMgrList();
  showToast(`카테고리 이름이 '${cleanName}'(으)로 변경되었습니다. (기존 ${countUpdated}건 항목 반영)`, "success");
};

window.deleteMfaqCategory = function(catName) {
  const cats = window.getMfaqCategories();
  if (cats.length <= 1) {
    showToast("최소 1개 이상의 카테고리가 필요합니다.", "warning");
    return;
  }
  if (!confirm(`'${catName}' 카테고리를 삭제하시겠습니까?`)) return;

  const newCats = cats.filter(c => c !== catName);
  window.saveMfaqCategories(newCats);
  window.renderMfaqCategoryMgrList();
  renderMfaq();
  showToast(`'${catName}' 카테고리가 삭제되었습니다.`, "success");
};

// 1클릭 퀵 카테고리 변경 모달
window.openMfaqCategoryChangeModal = function(id, event) {
  if (event) event.stopPropagation();
  const log = (mfaqLogs || []).find(l => l.id === id);
  if (!log) return;
  const p = window.parseMfaqItem(log);
  const titleEl = document.getElementById("mfaq-change-cat-item-title");
  const optionsDiv = document.getElementById("mfaq-change-cat-options");
  if (titleEl) {
    titleEl.textContent = p.hasProduct ? `${p.cleanNo} ${p.artName}` : (log.question || "-");
  }

  const cats = window.getMfaqCategories();
  if (optionsDiv) {
    optionsDiv.innerHTML = cats.map(cat => {
      const isCurrent = (log.category === cat) || 
                        (cat === "제품 질문/요청" && (log.category === "제품 요청" || log.category === "제품 질문")) ||
                        (cat === "매장 질문" && log.category === "일반 질문");
      const isProduct = cat.includes("제품");
      const icon = isProduct ? 'fa-box' : 'fa-store';
      const bg = isCurrent ? '#0058a3' : '#f8fafc';
      const color = isCurrent ? '#ffffff' : '#0f172a';
      const border = isCurrent ? '#0058a3' : '#cbd5e1';

      return `
        <button type="button" onclick="quickChangeMfaqCategory('${id}', '${cat.replace(/'/g, "\\'")}')" style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:${bg}; color:${color}; border:1.5px solid ${border}; border-radius:10px; font-size:14px; font-weight:800; cursor:pointer; transition:all 0.15s;">
          <span style="display:flex; align-items:center; gap:8px;">
            <i class="fa-solid ${icon}"></i> ${cat}
          </span>
          ${isCurrent ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-chevron-right" style="font-size:11px; opacity:0.5;"></i>'}
        </button>
      `;
    }).join('');
  }

  const modal = document.getElementById("mfaq-category-change-modal");
  if (modal) modal.classList.add("active");
};

window.closeMfaqCategoryChangeModal = function() {
  const modal = document.getElementById("mfaq-category-change-modal");
  if (modal) modal.classList.remove("active");
};

window.quickChangeMfaqCategory = async function(id, newCat) {
  const log = (mfaqLogs || []).find(l => l.id === id);
  if (!log) return;
  const oldCat = log.category;
  if (oldCat === newCat) {
    window.closeMfaqCategoryChangeModal();
    return;
  }

  log.category = newCat;
  log.lastUpdated = new Date().toISOString();
  saveMfaqLogs();
  renderMfaq();
  window.closeMfaqCategoryChangeModal();
  showToast(`카테고리가 '${newCat}'(으)로 변경되었습니다!`, "success");

  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    try {
      await supabaseClient
        .from("mfaq_logs")
        .update({ category: newCat, last_updated: log.lastUpdated })
        .eq("id", id);
    } catch(e) {
      console.warn("Update category error:", e);
    }
  }
};

// --- MFAQ Item Edit Modal with Product Search Support ---
window.selectedEditMfaqProduct = null;

window.onEditMfaqCategoryChange = function(category) {
  const searchSec = document.getElementById("edit-mfaq-product-search-section");
  const qLabel = document.getElementById("edit-mfaq-question-label");
  const qInput = document.getElementById("edit-mfaq-question");

  if (category === "매장 질문" || category === "일반 질문") {
    if (qLabel) qLabel.innerHTML = '매장 질문 내용 <span style="color:#ef4444;">*</span>';
    if (qInput) qInput.placeholder = "매장 관련 질문 내용을 입력하세요";
    if (searchSec) searchSec.style.display = "none";
  } else {
    // "제품 질문/요청" 및 기타 제품 카테고리
    if (qLabel) qLabel.innerHTML = '상세 메모 / 추가 내용 <span style="font-size:11.5px; font-weight:normal; color:#64748b;">(선택)</span>';
    if (qInput) qInput.placeholder = "추가 질문이나 요청 메모를 입력하세요 (선택)";
    if (searchSec) searchSec.style.display = "block";
  }
};

window.handleEditMfaqProductSearch = function(query) {
  const cleanQuery = (query || "").trim().toLowerCase();
  const dropdown = document.getElementById("edit-mfaq-product-autocomplete-dropdown");
  if (!dropdown) return;

  if (!cleanQuery) {
    dropdown.classList.remove("active");
    dropdown.innerHTML = "";
    return;
  }

  if (typeof masterCatalog === "undefined" || !Array.isArray(masterCatalog)) {
    dropdown.classList.remove("active");
    return;
  }

  const queryDigits = cleanQuery.replace(/\D/g, '');
  const matches = masterCatalog.filter(item => {
    const itemArtNo = String(item.artNo || "").toLowerCase();
    const itemDigits = itemArtNo.replace(/\D/g, '');
    const itemName = String(item.artName || "").toLowerCase();
    const itemHfb = String(item.hfb || "").toLowerCase();

    return itemName.includes(cleanQuery) ||
           (queryDigits.length >= 2 && itemDigits.includes(queryDigits)) ||
           itemArtNo.includes(cleanQuery) ||
           itemHfb.includes(cleanQuery);
  }).slice(0, 15);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div style="padding:10px 12px; font-size:12px; color:#94a3b8; text-align:center;">일치하는 제품이 없습니다.</div>';
    dropdown.classList.add("active");
    return;
  }

  dropdown.innerHTML = matches.map(item => {
    let cleanNo = String(item.artNo || "").trim();
    if (cleanNo.length > 0 && cleanNo.length <= 8) {
      cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
    }
    const hfbBadge = item.hfb ? `<span style="background:#0058a3; color:#ffffff; font-size:10px; font-weight:900; padding:1px 6px; border-radius:4px; display:inline-flex; align-items:center; gap:2px;"><i class="fa-solid fa-tag"></i> ${item.hfb}</span>` : '';
    const locBadge = item.location && item.location !== '미지정' ? `<span style="background:#f0f9ff; color:#0284c7; font-size:10px; font-weight:800; padding:1px 5px; border-radius:4px; border:1px solid #bae6fd;">${item.location}</span>` : '';

    return `
      <div class="autocomplete-item" onclick="selectEditMfaqProduct('${cleanNo}')" style="display:flex; align-items:center; gap:10px; padding:8px 12px; border-bottom:1px solid #f1f5f9; cursor:pointer; background:#ffffff;">
        <div style="flex-shrink:0;">
          ${typeof getProductThumbHtml === 'function' ? getProductThumbHtml(cleanNo, item.artName, 40) : ''}
        </div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin-bottom:2px;">
            ${hfbBadge}
            <span style="font-family:monospace; font-size:12px; font-weight:900; color:#0058a3;">${cleanNo}</span>
            ${locBadge}
          </div>
          <div style="font-size:13px; font-weight:800; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.artName}</div>
        </div>
        <div style="display:flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:6px; background:#eff6ff; border:1px solid #bfdbfe; color:#0058a3; flex-shrink:0;">
          <i class="fa-solid fa-check"></i>
        </div>
      </div>
    `;
  }).join("");

  dropdown.classList.add("active");
  if (typeof loadProductThumbnails === "function") loadProductThumbnails();
};

window.setEditMfaqSelectedProduct = function(artNo, artName, hfb, location) {
  let cleanNo = String(artNo || "").trim();
  if (cleanNo.length > 0 && cleanNo.length <= 8) {
    cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
  }

  window.selectedEditMfaqProduct = {
    artNo: cleanNo,
    artName: artName || "창고 품목",
    hfb: hfb || "기타 HFB",
    location: location || ""
  };

  const card = document.getElementById("edit-mfaq-selected-product-card");
  const thumbDiv = document.getElementById("edit-mfaq-selected-thumb");
  const hfbText = document.getElementById("edit-mfaq-selected-hfb-text");
  const artNoSpan = document.getElementById("edit-mfaq-selected-artno");
  const locSpan = document.getElementById("edit-mfaq-selected-location");
  const nameDiv = document.getElementById("edit-mfaq-selected-artname");

  if (card && thumbDiv && hfbText && artNoSpan && nameDiv) {
    thumbDiv.innerHTML = typeof getProductThumbHtml === 'function' ? getProductThumbHtml(cleanNo, artName, 44) : '';
    hfbText.textContent = hfb || "HFB";
    artNoSpan.textContent = cleanNo;
    nameDiv.textContent = artName || cleanNo;
    if (locSpan) {
      if (location && location !== '미지정') {
        locSpan.textContent = location;
        locSpan.style.display = "inline-block";
      } else {
        locSpan.style.display = "none";
      }
    }
    card.style.display = "block";
  }

  const searchInput = document.getElementById("edit-mfaq-product-search-input");
  if (searchInput) searchInput.value = `${cleanNo} (${artName})`;

  if (typeof loadProductThumbnails === "function") loadProductThumbnails();
};

window.selectEditMfaqProduct = function(artNo) {
  let cleanNo = String(artNo || "").trim();
  if (cleanNo.length > 0 && cleanNo.length <= 8) {
    cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
  }

  const matched = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog))
    ? masterCatalog.find(m => String(m.artNo || m.artno || "").replace(/\D/g, '') === cleanNo)
    : null;

  const artName = matched ? (matched.artName || matched.artname || "") : (typeof masterCatalogMap !== "undefined" ? masterCatalogMap.get(cleanNo) : "") || "창고 품목";
  const hfb = matched ? (matched.hfb || "기타 HFB") : "기타 HFB";
  const location = matched ? (matched.location || "") : "";

  window.setEditMfaqSelectedProduct(cleanNo, artName, hfb, location);

  const dropdown = document.getElementById("edit-mfaq-product-autocomplete-dropdown");
  if (dropdown) {
    dropdown.classList.remove("active");
    dropdown.innerHTML = "";
  }
};

window.clearEditMfaqSelectedProduct = function() {
  window.selectedEditMfaqProduct = null;
  const searchInput = document.getElementById("edit-mfaq-product-search-input");
  if (searchInput) searchInput.value = "";
  const card = document.getElementById("edit-mfaq-selected-product-card");
  if (card) card.style.display = "none";
  const dropdown = document.getElementById("edit-mfaq-product-autocomplete-dropdown");
  if (dropdown) {
    dropdown.classList.remove("active");
    dropdown.innerHTML = "";
  }
};

// MFAQ 항목 수정 모달 (카테고리 + 제품 검색 + 메모/질문 내용 동시 수정)
window.openMfaqEditModal = function(id) {
  const log = (mfaqLogs || []).find(l => l.id === id);
  if (!log) return;
  const p = window.parseMfaqItem(log);

  const idEl = document.getElementById("edit-mfaq-id");
  if (idEl) idEl.value = id;

  // Populate category select
  const catSelect = document.getElementById("edit-mfaq-category");
  let currentCat = log.category || "제품 질문/요청";
  if (catSelect) {
    const cats = window.getMfaqCategories();
    catSelect.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
    if (cats.includes(log.category)) {
      currentCat = log.category;
    } else if (log.category === "제품 요청" || log.category === "제품 질문") {
      currentCat = "제품 질문/요청";
    } else if (log.category === "일반 질문") {
      currentCat = "매장 질문";
    } else {
      currentCat = cats[0] || "제품 질문/요청";
    }
    catSelect.value = currentCat;
  }

  // Populate product info if item has product
  if (p.hasProduct) {
    window.setEditMfaqSelectedProduct(p.cleanNo, p.artName, p.hfb, p.location);
  } else {
    window.clearEditMfaqSelectedProduct();
  }

  // Populate question/memo input
  const qInput = document.getElementById("edit-mfaq-question");
  if (qInput) {
    qInput.value = p.hasProduct ? (p.extraNote || "") : (log.question || "");
  }

  // Synchronize category mode (show/hide product search & update labels)
  window.onEditMfaqCategoryChange(currentCat);

  const modal = document.getElementById("mfaq-edit-modal");
  if (modal) modal.classList.add("active");
};

window.closeMfaqEditModal = function() {
  const modal = document.getElementById("mfaq-edit-modal");
  if (modal) modal.classList.remove("active");
  const dropdown = document.getElementById("edit-mfaq-product-autocomplete-dropdown");
  if (dropdown) dropdown.classList.remove("active");
};

window.handleEditMfaqSubmit = async function(event) {
  event.preventDefault();
  const id = document.getElementById("edit-mfaq-id")?.value;
  const newCat = document.getElementById("edit-mfaq-category")?.value;
  const newText = document.getElementById("edit-mfaq-question")?.value.trim() || "";

  const log = (mfaqLogs || []).find(l => l.id === id);
  if (!log) return;

  let newQuestion = "";
  if (newCat === "매장 질문" || newCat === "일반 질문") {
    if (!newText) {
      showToast("매장 질문 내용을 입력해 주세요!", "warning");
      return;
    }
    newQuestion = newText;
    log.artNo = "";
    log.artName = "";
    log.hfb = "";
  } else {
    // 제품 카테고리
    if (window.selectedEditMfaqProduct) {
      const prod = window.selectedEditMfaqProduct;
      log.artNo = prod.artNo;
      log.artName = prod.artName;
      log.hfb = prod.hfb;
      newQuestion = newText ? `[${prod.artNo}] ${prod.artName} - ${newText}` : `[${prod.artNo}] ${prod.artName}`;
    } else {
      if (!newText) {
        showToast("제품을 검색하여 선택하거나 내용을 입력해 주세요!", "warning");
        return;
      }
      newQuestion = newText;
    }
  }

  log.category = newCat;
  log.question = newQuestion;
  log.lastUpdated = new Date().toISOString();

  saveMfaqLogs();
  renderMfaq();
  closeMfaqEditModal();
  showToast("MFAQ 항목이 수정되었습니다!", "success");

  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    try {
      await supabaseClient
        .from("mfaq_logs")
        .update({
          category: log.category,
          question: log.question,
          last_updated: log.lastUpdated
        })
        .eq("id", id);
    } catch(e) {
      console.warn("Update MFAQ item error:", e);
    }
  }
};

// Dismiss MFAQ autocomplete dropdowns on outside click (capture phase works through modal stopPropagation)
document.addEventListener("click", (e) => {
  if (!e.target.closest("#edit-mfaq-product-search-section")) {
    const editDrop = document.getElementById("edit-mfaq-product-autocomplete-dropdown");
    if (editDrop) editDrop.classList.remove("active");
  }
  if (!e.target.closest("#mfaq-product-search-section")) {
    const addDrop = document.getElementById("mfaq-product-autocomplete-dropdown");
    if (addDrop) addDrop.classList.remove("active");
  }
}, true);

// Parse MFAQ item into product information and extra note
window.parseMfaqItem = function(log) {
  let artNo = log.artNo || "";
  let artName = log.artName || "";
  let hfb = log.hfb || "";
  let rawQuestion = String(log.question || "").trim();
  let extraNote = "";
  let location = "";

  // 1. Try to extract [artNo] from question string (e.g. "[10456789] BILLY 책장 - 재고 문의" or "[104.567.89]")
  const bracketMatch = rawQuestion.match(/\[([\d\.\s]{6,12})\]/);
  if (bracketMatch) {
    if (!artNo) artNo = bracketMatch[1].replace(/\D/g, '');
    let rest = rawQuestion.slice(bracketMatch[0].length).trim();
    if (rest.startsWith("-") || rest.startsWith(":")) rest = rest.slice(1).trim();
    extraNote = rest;
  } else {
    // 2. Try to find standalone 8-digit number
    const numMatch = rawQuestion.match(/\b(\d{8})\b/);
    if (numMatch) {
      if (!artNo) artNo = numMatch[1];
      extraNote = rawQuestion.replace(numMatch[0], '').trim();
    } else {
      extraNote = rawQuestion;
    }
  }

  let cleanNo = String(artNo || "").trim();
  if (cleanNo.length > 0 && cleanNo.length <= 8) {
    cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
  }

  // 3. Match against masterCatalog
  if (cleanNo && typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) {
    const matched = masterCatalog.find(m => {
      const mNo = String(m.artNo || m.artno || "").trim().replace(/\D/g, '');
      return mNo === cleanNo;
    });
    if (matched) {
      if (!artName) artName = matched.artName || matched.artname || "";
      if (!hfb) hfb = matched.hfb || "";
      location = matched.location || "";
    }
  }

  // 4. Try masterCatalogMap for product name
  if (cleanNo && !artName && typeof masterCatalogMap !== "undefined" && masterCatalogMap) {
    artName = masterCatalogMap.get(cleanNo) || "";
  }

  // Deduplicate: If extraNote starts with or repeats artName, clean it up
  if (extraNote && artName) {
    let cleanNote = extraNote.trim();
    if (cleanNote.toLowerCase().startsWith(artName.trim().toLowerCase())) {
      cleanNote = cleanNote.slice(artName.trim().length).trim();
      if (cleanNote.startsWith("-") || cleanNote.startsWith(":")) {
        cleanNote = cleanNote.slice(1).trim();
      }
    }
    extraNote = cleanNote;
  }

  // If extraNote just repeats the artNo, clear it
  if (extraNote && cleanNo && extraNote.replace(/\D/g, '') === cleanNo) {
    extraNote = "";
  }

  return {
    cleanNo,
    artName: artName || (cleanNo ? "창고 품목" : ""),
    hfb: hfb || (cleanNo ? "기타 HFB" : ""),
    location,
    extraNote,
    hasProduct: !!cleanNo,
    fullQuestion: rawQuestion
  };
};

window.openMfaqModal = function() {
  window.selectedMfaqProduct = null;
  const searchInput = document.getElementById("mfaq-product-search-input");
  if (searchInput) searchInput.value = "";
  const card = document.getElementById("mfaq-selected-product-card");
  if (card) card.style.display = "none";
  const dropdown = document.getElementById("mfaq-product-autocomplete-dropdown");
  if (dropdown) {
    dropdown.classList.remove("active");
    dropdown.innerHTML = "";
  }
  const qInput = document.getElementById("mfaq-new-question");
  if (qInput) {
    qInput.value = "";
    qInput.placeholder = "추가 질문이나 요청 메모를 입력하세요 (선택)";
  }
  const catSelect = document.getElementById("mfaq-new-category");
  if (catSelect) {
    catSelect.value = "제품 질문/요청";
  }
  window.onMfaqCategoryChange("제품 질문/요청");
  
  const modal = document.getElementById("mfaq-modal");
  if (modal) modal.classList.add("active");

  setTimeout(() => {
    if (searchInput) searchInput.focus();
  }, 100);
};

window.closeMfaqModal = function() {
  const modal = document.getElementById("mfaq-modal");
  if (modal) modal.classList.remove("active");
  const dropdown = document.getElementById("mfaq-product-autocomplete-dropdown");
  if (dropdown) dropdown.classList.remove("active");
};

window.onMfaqCategoryChange = function(category) {
  const searchSec = document.getElementById("mfaq-product-search-section");
  const qLabel = document.getElementById("mfaq-question-label");
  const qInput = document.getElementById("mfaq-new-question");

  if (category === "매장 질문" || category === "일반 질문") {
    if (qLabel) qLabel.innerHTML = '매장 질문 내용 <span style="color:#ef4444;">*</span>';
    if (qInput) qInput.placeholder = "매장 운영 관련 질문 내용을 입력하세요";
    if (searchSec) searchSec.style.display = "none";
    window.clearMfaqSelectedProduct();
  } else {
    // "제품 질문/요청"
    if (qLabel) qLabel.innerHTML = '상세 메모 / 추가 내용 <span style="font-size:11.5px; font-weight:normal; color:#64748b;">(선택)</span>';
    if (qInput) qInput.placeholder = "추가 질문이나 요청 메모를 입력하세요 (선택)";
    if (searchSec) searchSec.style.display = "block";
  }
};

window.handleMfaqProductSearch = function(query) {
  const cleanQuery = (query || "").trim().toLowerCase();
  const dropdown = document.getElementById("mfaq-product-autocomplete-dropdown");
  if (!dropdown) return;

  if (!cleanQuery) {
    dropdown.classList.remove("active");
    dropdown.innerHTML = "";
    return;
  }

  if (typeof masterCatalog === "undefined" || !Array.isArray(masterCatalog)) {
    dropdown.classList.remove("active");
    return;
  }

  const queryDigits = cleanQuery.replace(/\D/g, '');
  const matches = masterCatalog.filter(item => {
    const itemArtNo = String(item.artNo || "").toLowerCase();
    const itemDigits = itemArtNo.replace(/\D/g, '');
    const itemName = String(item.artName || "").toLowerCase();
    const itemHfb = String(item.hfb || "").toLowerCase();

    return itemName.includes(cleanQuery) ||
           (queryDigits.length >= 2 && itemDigits.includes(queryDigits)) ||
           itemArtNo.includes(cleanQuery) ||
           itemHfb.includes(cleanQuery);
  }).slice(0, 15);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div style="padding:10px 12px; font-size:12px; color:#94a3b8; text-align:center;">일치하는 제품이 없습니다.</div>';
    dropdown.classList.add("active");
    return;
  }

  dropdown.innerHTML = matches.map(item => {
    let cleanNo = String(item.artNo || "").trim();
    if (cleanNo.length > 0 && cleanNo.length <= 8) {
      cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
    }
    const hfbBadge = item.hfb ? `<span style="background:#0058a3; color:#ffffff; font-size:10px; font-weight:900; padding:1px 6px; border-radius:4px; display:inline-flex; align-items:center; gap:2px;"><i class="fa-solid fa-tag"></i> ${item.hfb}</span>` : '';
    const locBadge = item.location && item.location !== '미지정' ? `<span style="background:#f0f9ff; color:#0284c7; font-size:10px; font-weight:800; padding:1px 5px; border-radius:4px; border:1px solid #bae6fd;">${item.location}</span>` : '';

    return `
      <div class="autocomplete-item" onclick="selectMfaqProduct('${cleanNo}')" style="display:flex; align-items:center; gap:10px; padding:8px 12px; border-bottom:1px solid #f1f5f9; cursor:pointer; background:#ffffff;">
        <div style="flex-shrink:0;">
          ${typeof getProductThumbHtml === 'function' ? getProductThumbHtml(cleanNo, item.artName, 40) : ''}
        </div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin-bottom:2px;">
            ${hfbBadge}
            <span style="font-family:monospace; font-size:12px; font-weight:900; color:#0058a3;">${cleanNo}</span>
            ${locBadge}
          </div>
          <div style="font-size:13px; font-weight:800; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.artName}</div>
        </div>
        <div style="display:flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:6px; background:#eff6ff; border:1px solid #bfdbfe; color:#0058a3; flex-shrink:0;">
          <i class="fa-solid fa-check"></i>
        </div>
      </div>
    `;
  }).join("");

  dropdown.classList.add("active");
  if (typeof loadProductThumbnails === "function") loadProductThumbnails();
};

window.selectMfaqProduct = function(artNo) {
  let cleanNo = String(artNo || "").trim();
  if (cleanNo.length > 0 && cleanNo.length <= 8) {
    cleanNo = cleanNo.replace(/\D/g, '').padStart(8, '0');
  }

  const matched = (typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog))
    ? masterCatalog.find(m => String(m.artNo || m.artno || "").replace(/\D/g, '') === cleanNo)
    : null;

  const artName = matched ? (matched.artName || matched.artname || "") : (typeof masterCatalogMap !== "undefined" ? masterCatalogMap.get(cleanNo) : "") || "창고 품목";
  const hfb = matched ? (matched.hfb || "기타 HFB") : "기타 HFB";
  const location = matched ? (matched.location || "") : "";

  window.selectedMfaqProduct = {
    artNo: cleanNo,
    artName: artName,
    hfb: hfb,
    location: location
  };

  const dropdown = document.getElementById("mfaq-product-autocomplete-dropdown");
  if (dropdown) {
    dropdown.classList.remove("active");
    dropdown.innerHTML = "";
  }

  const searchInput = document.getElementById("mfaq-product-search-input");
  if (searchInput) searchInput.value = `${cleanNo} (${artName})`;

  const card = document.getElementById("mfaq-selected-product-card");
  const thumbDiv = document.getElementById("mfaq-selected-thumb");
  const hfbText = document.getElementById("mfaq-selected-hfb-text");
  const artNoSpan = document.getElementById("mfaq-selected-artno");
  const locSpan = document.getElementById("mfaq-selected-location");
  const nameDiv = document.getElementById("mfaq-selected-artname");

  if (card && thumbDiv && hfbText && artNoSpan && nameDiv) {
    thumbDiv.innerHTML = typeof getProductThumbHtml === 'function' ? getProductThumbHtml(cleanNo, artName, 44) : '';
    hfbText.textContent = hfb;
    artNoSpan.textContent = cleanNo;
    nameDiv.textContent = artName;
    if (locSpan) {
      if (location && location !== '미지정') {
        locSpan.textContent = location;
        locSpan.style.display = "inline-block";
      } else {
        locSpan.style.display = "none";
      }
    }
    card.style.display = "block";
  }

  const qInput = document.getElementById("mfaq-new-question");
  if (qInput && !qInput.value) {
    qInput.placeholder = "추가 질문이나 요청 메모를 입력하세요 (선택)";
  }
};

window.clearMfaqSelectedProduct = function() {
  window.selectedMfaqProduct = null;
  const searchInput = document.getElementById("mfaq-product-search-input");
  if (searchInput) searchInput.value = "";
  const card = document.getElementById("mfaq-selected-product-card");
  if (card) card.style.display = "none";
  const qInput = document.getElementById("mfaq-new-question");
  if (qInput) qInput.placeholder = "추가 질문이나 요청 메모를 입력하세요 (선택)";
};

window.formatMfaqTime = function(timeStr) {
  if (!timeStr) return "-";
  const d = new Date(timeStr);
  if (isNaN(d.getTime())) return timeStr;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${mins}`;
};

window.toggleMfaqHistory = function(id) {
  const box = document.getElementById(`mfaq-history-box-${id}`);
  const chevron = document.getElementById(`mfaq-history-chevron-${id}`);
  if (!box) return;
  if (box.style.display === "none" || !box.style.display) {
    box.style.display = "block";
    if (chevron) chevron.style.transform = "rotate(180deg)";
  } else {
    box.style.display = "none";
    if (chevron) chevron.style.transform = "rotate(0deg)";
  }
};

window.handleAddMfaqSubmit = async function(event) {
  event.preventDefault();
  const category = document.getElementById("mfaq-new-category") ? document.getElementById("mfaq-new-category").value : "제품 질문/요청";
  const extraText = document.getElementById("mfaq-new-question") ? document.getElementById("mfaq-new-question").value.trim() : "";
  const activeUser = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : 'system';
  const now = new Date().toISOString();

  let artNo = "";
  let artName = "";
  let hfb = "";
  let questionFormatted = "";

  if (window.selectedMfaqProduct) {
    artNo = window.selectedMfaqProduct.artNo;
    artName = window.selectedMfaqProduct.artName;
    hfb = window.selectedMfaqProduct.hfb;
    questionFormatted = extraText ? `[${artNo}] ${artName} - ${extraText}` : `[${artNo}] ${artName}`;
  } else if (extraText) {
    // Try to detect article number from typed text
    const numMatch = extraText.match(/\b(\d{8})\b/);
    if (numMatch && typeof masterCatalog !== "undefined" && Array.isArray(masterCatalog)) {
      const matched = masterCatalog.find(m => String(m.artNo || "").replace(/\D/g, '') === numMatch[1]);
      if (matched) {
        artNo = matched.artNo;
        artName = matched.artName;
        hfb = matched.hfb || "기타 HFB";
        const note = extraText.replace(numMatch[0], '').trim();
        questionFormatted = note ? `[${artNo}] ${artName} - ${note}` : `[${artNo}] ${artName}`;
      } else {
        questionFormatted = extraText;
      }
    } else {
      questionFormatted = extraText;
    }
  } else {
    showToast(category === "매장 질문" ? "매장 질문 내용을 입력해 주세요!" : "제품을 선택하거나 상세 내용을 입력해 주세요!", "warning");
    return;
  }

  const existing = mfaqLogs.find(l => l.question === questionFormatted && l.category === category);
  if (existing) {
    existing.count = (existing.count || 0) + 1;
    existing.lastUpdated = now;
    if (artNo && !existing.artNo) existing.artNo = artNo;
    if (artName && !existing.artName) existing.artName = artName;
    if (hfb && !existing.hfb) existing.hfb = hfb;
    if (!existing.history) {
      existing.history = [{ user: existing.createdBy || 'system', time: existing.createdAt || now, type: 'create', label: '최초 등록' }];
    }
    existing.history.push({
      user: activeUser,
      time: now,
      type: 'tap',
      label: `+1 탭 (${existing.count}번째)`
    });

    showToast(`이미 등록된 항목입니다. ${activeUser}님의 탭으로 질문 횟수가 +1 (${existing.count}건) 증가했습니다!`, "success");

    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      try {
        await supabaseClient
          .from("mfaq_logs")
          .update({ count: existing.count, last_updated: existing.lastUpdated })
          .eq("id", existing.id);
      } catch (e) {
        console.warn("MFAQ update Supabase error:", e);
      }
    }
  } else {
    const newLog = {
      id: "mfaq_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      category: category,
      question: questionFormatted,
      artNo: artNo,
      artName: artName,
      hfb: hfb,
      count: 1,
      createdBy: activeUser,
      history: [
        { user: activeUser, time: now, type: 'create', label: '최초 등록' }
      ],
      createdAt: now,
      lastUpdated: now
    };
    mfaqLogs.unshift(newLog);
    showToast(`새 MFAQ 항목이 등록되었습니다! (등록자: ${activeUser})`, "success");

    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      try {
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
      } catch (e) {
        console.warn("MFAQ insert Supabase error:", e);
      }
    }
  }

  saveMfaqLogs();
  updateMfaqBadge();
  closeMfaqModal();
  renderMfaq();
};

window.renderMfaq = function() {
  const container = document.getElementById("mfaq-list-container");
  if (!container) return;

  const filterCategory = document.getElementById("mfaq-filter-category")?.value || "all";
  const searchQuery = (document.getElementById("mfaq-search")?.value || "").trim().toLowerCase();

  let filtered = (mfaqLogs || []).map(log => {
    const parsed = window.parseMfaqItem(log);
    let history = log.history || log.tapHistory || [];
    if (!history || history.length === 0) {
      history = [{
        user: log.createdBy || log.user || "system",
        time: log.createdAt || log.lastUpdated || new Date().toISOString(),
        type: "create",
        label: "최초 등록"
      }];
    }
    return { ...log, _parsed: parsed, _history: history };
  });

  if (filterCategory !== "all") {
    if (filterCategory === "제품 질문/요청") {
      filtered = filtered.filter(item => 
        item.category === "제품 질문/요청" || item.category === "제품 요청" || item.category === "제품 질문" || item.category === "제품 문의"
      );
    } else if (filterCategory === "매장 질문") {
      filtered = filtered.filter(item => 
        item.category === "매장 질문" || item.category === "일반 질문"
      );
    } else {
      filtered = filtered.filter(item => item.category === filterCategory);
    }
  }

  if (searchQuery) {
    const queryDigits = searchQuery.replace(/\D/g, '');
    filtered = filtered.filter(item => {
      const p = item._parsed;
      const qText = String(item.question || "").toLowerCase();
      const pName = String(p.artName || "").toLowerCase();
      const pHfb = String(p.hfb || "").toLowerCase();
      const pLoc = String(p.location || "").toLowerCase();
      const pArtNo = String(p.cleanNo || "").toLowerCase();
      const creator = String(item.createdBy || "").toLowerCase();
      const historyUsers = item._history.map(h => String(h.user || "").toLowerCase()).join(" ");

      return qText.includes(searchQuery) ||
             pName.includes(searchQuery) ||
             pHfb.includes(searchQuery) ||
             pLoc.includes(searchQuery) ||
             creator.includes(searchQuery) ||
             historyUsers.includes(searchQuery) ||
             (queryDigits.length >= 2 && pArtNo.includes(queryDigits)) ||
             pArtNo.includes(searchQuery);
    });
  }

  filtered.sort((a, b) => {
    if ((b.count || 1) !== (a.count || 1)) return (b.count || 1) - (a.count || 1);
    return new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0);
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:45px 20px; background:#ffffff; border-radius:14px; border:1px dashed #cbd5e1; margin-top:10px;">
        <i class="fa-solid fa-clipboard-question" style="font-size:32px; color:#cbd5e1; margin-bottom:10px; display:block;"></i>
        <h4 style="font-size:14px; font-weight:800; color:#0f172a; margin:0 0 4px 0;">등록된 MFAQ 항목이 없습니다.</h4>
        <p style="font-size:12px; color:#64748b; margin:0;">${searchQuery ? '검색어에 일치하는 질문이나 제품, 작성자가 없습니다.' : '하단의 [+ 새 질문 / 제품 요청 등록] 버튼을 눌러 첫 항목을 등록해보세요!'}</p>
      </div>
    `;
    return;
  }

  let html = `<div class="mfaq-cards-list" style="display:flex; flex-direction:column; gap:10px;">`;

  filtered.forEach((item, idx) => {
    const p = item._parsed;
    const historyList = item._history || [];
    const creatorUser = item.createdBy || (historyList[0] ? historyList[0].user : "system");
    
    // Find last tap action
    const tapActions = historyList.filter(h => h.type === 'tap');
    const lastTap = tapActions.length > 0 ? tapActions[tapActions.length - 1] : null;

    const timeAgo = Math.floor((new Date() - new Date(item.lastUpdated || item.createdAt || Date.now())) / 60000);
    const timeStr = timeAgo < 1 ? '방금 전' : timeAgo < 60 ? `${timeAgo}분 전` : timeAgo < 1440 ? `${Math.floor(timeAgo/60)}시간 전` : `${Math.floor(timeAgo/1440)}일 전`;

    let catBg = "#f1f5f9";
    let catColor = "#475569";
    let catBorder = "#cbd5e1";
    let displayCategory = item.category || "매장 질문";

    if (item.category === "제품 질문/요청" || item.category === "제품 요청" || item.category === "제품 질문" || item.category === "제품 문의") {
      catBg = "#eff6ff"; catColor = "#1d4ed8"; catBorder = "#bfdbfe";
      displayCategory = "제품 질문/요청";
    } else if (item.category === "매장 질문" || item.category === "일반 질문") {
      catBg = "#fef3c7"; catColor = "#b45309"; catBorder = "#fde68a";
      displayCategory = "매장 질문";
    }

    html += `
      <div class="stock-card-item mfaq-card-item" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:10px 12px; box-shadow:0 1px 3px rgba(0,0,0,0.03); display:flex; gap:10px; align-items:flex-start;">
        <!-- Left: Product Image (46px) or Store Icon -->
        <div style="display:flex; flex-direction:column; align-items:center; gap:5px; flex-shrink:0;">
          ${p.hasProduct 
            ? (typeof getProductThumbHtml === 'function' ? getProductThumbHtml(p.cleanNo, p.artName, 46) : '')
            : `<div style="width:46px; height:46px; border-radius:8px; background:#eff6ff; color:#0058a3; display:flex; align-items:center; justify-content:center; font-size:20px; border:1px solid #bfdbfe;"><i class="fa-solid fa-store"></i></div>`
          }
        </div>

        <!-- Center & Right -->
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px;">
          <!-- Top Row: Badges & Creator Info -->
          <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
            <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
              <span onclick="openMfaqCategoryChangeModal('${item.id}', event)" style="background:${catBg}; color:${catColor}; font-size:10.5px; font-weight:800; padding:2px 7px; border-radius:4px; border:1px solid ${catBorder}; cursor:pointer; display:inline-flex; align-items:center; gap:3px; white-space:nowrap;" title="클릭하여 카테고리 변경">
                ${displayCategory} <i class="fa-solid fa-caret-down" style="font-size:8px; opacity:0.8;"></i>
              </span>
              ${p.hasProduct && p.hfb ? `
                <span style="background:#0058a3; color:#ffffff; font-size:9.5px; font-weight:900; padding:2px 5px; border-radius:4px;">
                  ${p.hfb}
                </span>
              ` : ''}
              ${p.hasProduct && p.cleanNo ? `
                <span style="font-size:11.5px; font-weight:bold; color:#64748b; font-family:monospace;">${p.cleanNo}</span>
              ` : ''}
            </div>
            <span style="font-size:11px; color:#64748b; font-weight:700; white-space:nowrap;">
              ${creatorUser} · ${timeStr}
            </span>
          </div>

          <!-- Title / Main Text -->
          <div style="font-size:13.5px; font-weight:900; color:#0f172a; line-height:1.3; word-break:keep-all; overflow-wrap:break-word;">
            ${p.hasProduct ? p.artName : item.question}
          </div>
          ${p.hasProduct && p.extraNote ? `
            <div style="font-size:12px; color:#475569; margin-top:1px; line-height:1.25;">
              <i class="fa-regular fa-comment-dots" style="color:#0058a3; font-size:10px;"></i> ${p.extraNote}
            </div>
          ` : ''}

          <!-- Bottom Row: Controls with dashed top border -->
          <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; margin-top:6px; padding-top:8px; border-top:1px dashed #f1f5f9;">
            <!-- Left: History Button & Last Tap -->
            <div style="display:flex; align-items:center; gap:5px; flex-shrink:0;">
              <button type="button" onclick="toggleMfaqHistory('${item.id}')" style="background:#f8fafc; border:1px solid #cbd5e1; color:#334155; font-size:11px; font-weight:800; padding:0 8px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; height:28px;" title="탭 및 등록 내역 보기">
                <i class="fa-solid fa-clock-rotate-left" style="color:#0058a3;"></i> 히스토리 ${historyList.length}건
                <i id="mfaq-history-chevron-${item.id}" class="fa-solid fa-caret-down" style="font-size:9px; transition:transform 0.2s ease;"></i>
              </button>
              ${lastTap ? `
                <span style="font-size:11px; color:#16a34a; font-weight:800; white-space:nowrap;">
                  최근: +${lastTap.user}
                </span>
              ` : ''}
            </div>

            <!-- Right: +1 Tap Button & Edit & Delete -->
            <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
              <button type="button" onclick="incrementMfaqCount('${item.id}')" style="background:#0058a3; color:#ffffff; font-weight:800; font-size:12px; border:none; border-radius:8px; padding:0 10px; height:28px; cursor:pointer; box-shadow:0 2px 4px rgba(0,88,163,0.25); display:inline-flex; align-items:center; gap:4px; white-space:nowrap; flex-shrink:0;" title="탭하여 건수 +1">
                <i class="fa-solid fa-bolt"></i> +1 탭 <span style="opacity:0.6;">|</span> <strong style="font-size:13px; font-weight:900;">${item.count || 1}</strong>
              </button>
              <button type="button" onclick="openMfaqEditModal('${item.id}')" style="width:28px; height:28px; border:1px solid #cbd5e1; background:#f8fafc; border-radius:6px; font-size:12px; cursor:pointer; color:#475569; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;" title="수정">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button type="button" onclick="deleteMfaqItem('${item.id}')" style="width:28px; height:28px; border:1px solid #cbd5e1; background:#f8fafc; border-radius:6px; font-size:12px; cursor:pointer; color:#94a3b8; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;" onmouseover="this.style.color='#ef4444'; this.style.borderColor='#fca5a5'; this.style.background='#fef2f2';" onmouseout="this.style.color='#94a3b8'; this.style.borderColor='#cbd5e1'; this.style.background='#f8fafc';" title="삭제">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>

          <!-- Collapsible Timeline Box -->
          <div id="mfaq-history-box-${item.id}" style="display:none; margin-top:8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:8px 10px; font-size:11px;">
            <div style="font-weight:900; color:#0f172a; margin-bottom:6px; display:flex; justify-content:space-between; font-size:11px;">
              <span><i class="fa-solid fa-timeline" style="color:#0058a3;"></i> 질문 등록 및 +1 탭 상세 히스토리</span>
              <span style="color:#64748b;">총 ${historyList.length}건</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:4px; max-height:120px; overflow-y:auto;">
              ${historyList.map(h => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 8px; background:#ffffff; border:1px solid #e2e8f0; border-radius:5px;">
                  <span style="font-weight:700; color:#0f172a;">${h.type === 'create' ? '📝 최초 등록' : '👆 +1 탭'}: ${h.user || 'system'}</span>
                  <span style="color:#94a3b8; font-size:10px; font-family:monospace;">${window.formatMfaqTime(h.time)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
  if (typeof loadProductThumbnails === "function") loadProductThumbnails();
};

window.incrementMfaqCount = async function(id) {
  const log = mfaqLogs.find(l => l.id === id);
  if (log) {
    const activeUser = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : 'system';
    const now = new Date().toISOString();

    log.count = (log.count || 1) + 1;
    log.lastUpdated = now;

    if (!log.history) {
      log.history = [{ user: log.createdBy || 'system', time: log.createdAt || now, type: 'create', label: '최초 등록' }];
    }
    log.history.push({
      user: activeUser,
      time: now,
      type: 'tap',
      label: `+1 탭 (${log.count}번째)`
    });

    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      try {
        await supabaseClient
          .from("mfaq_logs")
          .update({ count: log.count, last_updated: log.lastUpdated })
          .eq("id", id);
      } catch (e) {
        console.warn("MFAQ update count error:", e);
      }
    }

    saveMfaqLogs();
    renderMfaq();
    showToast(`질문 건수가 +1 증가했습니다! (탭 작업자: ${activeUser}, 현재 ${log.count}건)`, "success");
  }
};

window.deleteMfaqItem = async function(id) {
  if (!confirm("이 MFAQ 항목을 삭제하시겠습니까?")) return;
  mfaqLogs = mfaqLogs.filter(l => l.id !== id);
  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    try {
      await supabaseClient.from("mfaq_logs").delete().eq("id", id);
    } catch (e) {
      console.warn("Delete MFAQ error:", e);
    }
  }
  saveMfaqLogs();
  updateMfaqBadge();
  renderMfaq();
  showToast("MFAQ 항목이 삭제되었습니다.", "success");
};

window.exportMfaqToExcel = function() {
  if (typeof XLSX === "undefined") {
    showToast("엑셀 라이브러리를 불러오지 못했습니다.", "danger");
    return;
  }
  if (!mfaqLogs || mfaqLogs.length === 0) {
    showToast("추출할 MFAQ 데이터가 없습니다.", "danger");
    return;
  }
  const exportData = mfaqLogs.map(log => {
    const p = window.parseMfaqItem(log);
    const history = log.history || log.tapHistory || [];
    const creator = log.createdBy || (history[0] ? history[0].user : "system");
    const lastTap = history.filter(h => h.type === 'tap').pop();
    const historyText = history.map(h => `${h.user || 'system'}(${h.type === 'create' ? '등록' : '+1탭'} ${window.formatMfaqTime(h.time)})`).join(" > ");

    let cat = log.category || "매장 질문";
    if (cat === "제품 요청" || cat === "제품 질문" || cat === "제품 문의") cat = "제품 질문/요청";
    else if (cat === "일반 질문") cat = "매장 질문";

    return {
      "카테고리": cat,
      "아티클 번호": p.cleanNo || "-",
      "제품명": p.artName || "-",
      "HFB (부서/구역)": p.hfb || "-",
      "보관 구역": p.location || "-",
      "질문/요청 상세": p.extraNote || log.question || "-",
      "전체 질문 내용": log.question,
      "누적 건수": log.count || 1,
      "등록자 (작성자)": creator,
      "최근 탭한 사람": lastTap ? `${lastTap.user} (${window.formatMfaqTime(lastTap.time)})` : "-",
      "전체 탭 히스토리": historyText || "-",
      "등록 일시": log.createdAt || "-",
      "마지막 업데이트": log.lastUpdated || "-"
    };
  });
  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Songdo_MFAQ");
  XLSX.writeFile(wb, `Songdo_MFAQ_${new Date().toISOString().split("T")[0]}.xlsx`);
  showToast("MFAQ 엑셀 파일이 성공적으로 다운로드되었습니다. 📊", "success");
};







