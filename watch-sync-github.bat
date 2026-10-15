@echo off
setlocal
cd /d "%~dp0"
start "RuiWare GitHub auto-sync" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\watch-sync-github.ps1"
echo RuiWare GitHub auto-sync started in a minimized window.
echo Log: %~dp0sync-github.log
endlocal
