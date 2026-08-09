$patch = [IO.File]::ReadAllText("temp_patch.js", [System.Text.Encoding]::UTF8)
$content = [IO.File]::ReadAllText("custom.js", [System.Text.Encoding]::UTF8)
$content = $content + "`r`n" + $patch
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[IO.File]::WriteAllText("custom.js", $content, $utf8NoBom)
