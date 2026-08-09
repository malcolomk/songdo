$path = "custom.js"
$text = [IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
$lines = $text -split "`n"

$replaceStr = @"
      <label class="stock-card" style="display:flex; align-items:center; padding:15px; margin-bottom:12px; border-radius:12px; background:#ffffff; box-shadow:0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03); border:1px solid #e2e8f0; gap:15px; cursor:pointer; transition:all 0.2s ease;">
        <div style="display:flex; align-items:center; justify-content:center; width:24px; height:24px;">
          <input type="checkbox" class="std-picklist-cb" data-artno="`${item.artNo}" data-artname="`${item.artName.replace(/`"/g, "&quot;")}" data-maxqty="`${item.currentStock}" style="width:20px; height:20px; accent-color:#0ea5e9; cursor:pointer; transform:scale(1.2);">
        </div>
        
        <div style="flex:1;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="background:#f0f9ff; color:#0369a1; font-size:12px; font-weight:800; padding:4px 8px; border-radius:6px; border:1px solid #bae6fd;"><i class="fa-solid fa-map-pin"></i> `${item.location || '미지정'}</span>
            <span style="font-size:13px; font-weight:bold; color:#64748b; letter-spacing:0.5px;">`${item.artNo}</span>
          </div>
          <div style="font-size:15px; font-weight:900; margin-top:6px; color:#1e293b;">`${item.artName}</div>
          <div style="font-size:12px; color:#64748b; margin-top:4px; font-weight:600;"><i class="fa-solid fa-box"></i> 잔여 재고: <span style="color:#0ea5e9;">`${item.currentStock}개</span></div>
        </div>
        
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px; padding-left:10px; border-left:1px dashed #e2e8f0;">
          <span style="font-size:12px; font-weight:bold; color:#475569;">챙길 수량</span>
          <input type="number" id="std-qty-`${item.artNo}" value="`${item.currentStock}" min="1" max="`${item.currentStock}" onclick="event.stopPropagation();" onkeyup="event.stopPropagation();" style="width:70px; padding:8px; text-align:center; border:2px solid #e2e8f0; border-radius:8px; font-size:15px; font-weight:bold; color:#0f172a; outline:none; transition:border-color 0.2s;" onfocus="this.style.borderColor='#0ea5e9'" onblur="this.style.borderColor='#e2e8f0'">
        </div>
      </label>
"@ -split "`r`n"

$newLines = @()
for ($i = 0; $i -lt 1109; $i++) {
    $newLines += $lines[$i]
}
foreach ($line in $replaceStr) {
    $newLines += $line
}
for ($i = 1127; $i -lt $lines.Length; $i++) {
    $newLines += $lines[$i]
}

$newText = $newLines -join "`n"
[IO.File]::WriteAllText($path, $newText, [System.Text.Encoding]::UTF8)
Write-Host "Success! Upgraded aesthetics"
