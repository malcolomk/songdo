
window.exportStockToExcel = function() {
  if (typeof isAdminUser === "undefined" || !isAdminUser) {
    if (typeof showToast === "function") showToast("접근 권한이 없습니다. (관리자 전용)", "danger");
    return;
  }

  const stockMap = typeof buildStockMap === "function" ? buildStockMap() : new Map();
  if (stockMap.size === 0) {
    if (typeof showToast === "function") showToast("출출할 재고 데이터가 없습니다.", "danger");
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
