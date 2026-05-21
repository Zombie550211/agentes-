@echo off
title CRM Connecting — FastAPI
cd /d "%~dp0CRM_PYTHON"
echo Iniciando CRM Connecting en http://localhost:8000 ...
echo.
.venv\Scripts\python.exe run.py
pause
