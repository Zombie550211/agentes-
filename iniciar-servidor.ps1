Set-Location "$PSScriptRoot\CRM_PYTHON"
Write-Host "Iniciando CRM Connecting en http://localhost:8000 ..." -ForegroundColor Cyan
.venv\Scripts\uvicorn main:app --host 0.0.0.0 --port 8000 --reload
