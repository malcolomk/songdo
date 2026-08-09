const fs = require('fs');
let code = fs.readFileSync('custom.js', 'utf8');
const lines = code.split('\n');

const fixedCode = `
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
  
  let html = \`<button type="button" style="padding:8px 16px; border-radius:20px; font-size:14px; font-weight:bold; white-space:nowrap; border:none; cursor:pointer; \${window.currentPicklistLocation === '전체' ? 'background:#0f172a; color:white;' : 'background:#e2e8f0; color:#475569;'}" onclick="setPicklistLocation('전체')">모든 구역</button>\`;
  locArray.forEach(loc => {
    html += \`<button type="button" style="padding:8px 16px; border-radius:20px; font-size:14px; font-weight:bold; white-space:nowrap; border:none; cursor:pointer; \${window.currentPicklistLocation === loc ? 'background:#0f172a; color:white;' : 'background:#e2e8f0; color:#475569;'}" onclick="setPicklistLocation('\${loc}')">\${loc}</button>\`;
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
    container.innerHTML = \`<div style="text-align:center; color:#94a3b8; padding:20px; font-size:13px;">선택한 구역에 재고가 없습니다.</div>\`;
    return;
  }
  
  inventory.sort((a, b) => {
    const locDiff = (a.location || "").localeCompare(b.location || "", "ko");
    if (locDiff !== 0) return locDiff;
    return a.artNo.localeCompare(b.artNo);
  });
`;

// Find the start line for window.currentPicklistLocation = "전체";
let startIdx = lines.findIndex(l => l.includes('window.currentPicklistLocation = "전체"'));
// Find the end line for the sort function closing bracket
let endIdx = -1;
for (let i = startIdx + 1; i < lines.length; i++) {
  if (lines[i].includes('inventory.forEach((item) => {')) {
    endIdx = i - 1;
    while(lines[endIdx].trim() === '') endIdx--;
    break;
  }
}

if (startIdx >= 0 && endIdx >= startIdx) {
  lines.splice(startIdx, endIdx - startIdx + 1, fixedCode.trim());
  fs.writeFileSync('custom.js', lines.join('\n'), 'utf8');
  console.log("SUCCESS");
} else {
  console.log("COULD NOT FIND INDICES", startIdx, endIdx);
}
