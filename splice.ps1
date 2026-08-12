$content = Get-Content "custom.js" -Encoding UTF8 | Select-Object -First 1326
$restored = Get-Content "restore_custom.js" -Encoding UTF8
$content + $restored | Set-Content "custom.js" -Encoding UTF8
