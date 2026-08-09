$path = "custom.js"
$text = [IO.File]::ReadAllText($path)
$lines = $text -split "`n"

$replaceStr = @"
          `${item.qty}개
        </div>
        <button type="button" style="background:#059669; color:white; border:none; margin-left:15px; font-weight:bold; border-radius:6px; padding:12px 16px; cursor:pointer; box-shadow:0 2px 4px rgba(5,150,105,0.2);" onclick="completePickItem_custom('`${item.id}')">
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
"@ -split "`r`n"

$startIdx = -1
$endIdx = -1

for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i].Contains('${item.qty}개') -and $lines[$i+1].Contains('currentSingleLocArtNo = artNo;')) {
        $startIdx = $i
        $endIdx = $i + 1
        break
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
    Write-Host "Failed to find indices."
}
