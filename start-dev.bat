@echo off
setlocal

cd /d "%~dp0"

start "RuiWare Template API" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dev.ps1"

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173"

endlocal
