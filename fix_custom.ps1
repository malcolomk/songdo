$content = [IO.File]::ReadAllText("custom.js", [Text.Encoding]::UTF8)
$index = $content.IndexOf("// --- Warehouse Location Setting Override ---")
if ($index -ge 0) {
    $content = $content.Substring(0, $index)
    [IO.File]::WriteAllText("custom.js", $content, [Text.Encoding]::UTF8)
}
