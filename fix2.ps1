$bytes = [System.IO.File]::ReadAllBytes("app.js")
$str = [System.Text.Encoding]::UTF8.GetString($bytes)
$str = $str -replace 'location: newRecord\.location \|\| ".*?",', 'location: newRecord.location || "",'
[System.IO.File]::WriteAllText("app.js", $str, [System.Text.Encoding]::UTF8)
