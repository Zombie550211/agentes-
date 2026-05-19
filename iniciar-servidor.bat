@echo off
title CRM Connecting — FastAPI
cd /d "%~dp0CRM_PYTHON"
echo Iniciando CRM Connecting en http://localhost:8000 ...
echo.
.venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8000 --reload
pause
