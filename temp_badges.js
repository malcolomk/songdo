
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
