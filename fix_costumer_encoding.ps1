# Script para arreglar caracteres UTF-8 corruptos en Costumer.html
$filePath = "c:\Users\Zombie\Documents\dashboard\frontend\Costumer.html"

# Leer archivo
$content = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)

# Log inicial
"1. Archivo leído" | Out-Default

# Hacer reemplazos
$original_size = $content.Length
$content = $content -replace [regex]::Escape("Ã¡"), "á"
$content = $content -replace [regex]::Escape("Ã©"), "é"
$content = $content -replace [regex]::Escape("Ã­"), "í"
$content = $content -replace [regex]::Escape("Ã³"), "ó"
$content = $content -replace [regex]::Escape("Ã "), "à"
$content = $content -replace [regex]::Escape("Ã"), "Á"
$content = $content -replace [regex]::Escape("Ã±"), "ñ"
$content = $content -replace [regex]::Escape("Ã‰"), "É"
$content = $content -replace [regex]::Escape("Ã"), "á"

# Escribir de vuelta
[System.IO.File]::WriteAllText($filePath, $content, [System.Text.Encoding]::UTF8)

"2. Reemplazos completados" |Out-Default
"3. Tamaño original: $original_size" | Out-Default
"4. Tamaño nuevo: $($content.Length)" | Out-Default
"5. LISTO" | Out-Default
