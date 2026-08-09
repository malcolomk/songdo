$path = "custom.js"
$text = [IO.File]::ReadAllText($path)
$lines = $text -split "`n"

$replaceStr = @"
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
  
  let html = `<button type="button" style="padding:8px 16px; border-radius:20px; font-size:14px; font-weight:bold; white-space:nowrap; border:none; cursor:pointer; `${window.currentPicklistLocation === '전체' ? 'background:#0f172a; color:white;' : 'background:#e2e8f0; color:#475569;'}`" onclick="setPicklistLocation('전체')">모든 구역</button>`;
  locArray.forEach(loc => {
    html += `<button type="button" style="padding:8px 16px; border-radius:20px; font-size:14px; font-weight:bold; white-space:nowrap; border:none; cursor:pointer; `${window.currentPicklistLocation === loc ? 'background:#0f172a; color:white;' : 'background:#e2e8f0; color:#475569;'}`" onclick="setPicklistLocation('`${loc}`')">`${loc}</button>`;
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
"@ -split "`r`n"

$startIdx = -1
$endIdx = -1

for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i].Contains("window.renderStandardLocationButtons = function() {")) {
        $startIdx = $i
    }
    if ($startIdx -ne -1 -and $i -gt $startIdx) {
        if ($lines[$i].Contains("inventory.sort((a, b) => {")) {
            $endIdx = $i + 4
            break
        }
    }
}

if ($startIdx -ne -1 -and $endIdx -ne -1) {
    $newLines = @()
    for ($i = 0; $i -lt $startIdx; $i++) {
        $newLines += $lines[$i]
    }
    foreach ($line in $replaceStr) {
        $newLines += $line
    }
    for ($i = $endIdx + 1; $i -lt $lines.Length; $i++) {
        $newLines += $lines[$i]
    }
    $newText = $newLines -join "`n"
    [IO.File]::WriteAllText($path, $newText, [System.Text.Encoding]::UTF8)
    Write-Host "Success! Replaced lines $startIdx to $endIdx"
} else {
    Write-Host "Failed to find indices. Start: $startIdx, End: $endIdx"
}
