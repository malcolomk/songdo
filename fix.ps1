$bytes = [System.IO.File]::ReadAllBytes("app.js")
$str = [System.Text.Encoding]::UTF8.GetString($bytes)
$str = $str -replace 'location: row\.location \|\| ".*?,', 'location: row.location || "",'
[System.IO.File]::WriteAllText("app.js", $str, [System.Text.Encoding]::UTF8)
