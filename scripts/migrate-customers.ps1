# Script para migrar clientes de costumers a colecciones por agente
# 
# Uso:
#   .\migrate-customers.ps1          # Dry-run (simulación)
#   .\migrate-customers.ps1 -Apply   # Ejecutar migración real

param(
    [switch]$Apply
)

$scriptPath = "scripts\mongo\migrate_customers_to_agent_collections.js"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MIGRACIÓN DE CLIENTES POR AGENTE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($Apply) {
    Write-Host "⚠️  MODO: APPLY (Se harán cambios reales en la base de datos)" -ForegroundColor Yellow
    Write-Host ""
    $confirmation = Read-Host "¿Estás seguro de continuar? (S/N)"
    
    if ($confirmation -ne 'S' -and $confirmation -ne 's') {
        Write-Host ""
        Write-Host "❌ Migración cancelada por el usuario" -ForegroundColor Red
        exit 0
    }
    
    Write-Host ""
    Write-Host "▶️  Ejecutando migración..." -ForegroundColor Green
    node $scriptPath --apply
} else {
    Write-Host "🔍 MODO: DRY-RUN (Solo simulación, no se harán cambios)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "▶️  Ejecutando simulación..." -ForegroundColor Green
    node $scriptPath
}

Write-Host ""
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Proceso completado exitosamente" -ForegroundColor Green
} else {
    Write-Host "❌ El proceso terminó con errores (código: $LASTEXITCODE)" -ForegroundColor Red
}
Write-Host ""
