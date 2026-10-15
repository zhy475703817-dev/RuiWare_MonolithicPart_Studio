@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sync-github.ps1"
if errorlevel 1 (
    echo Synchronization failed. Local files are preserved. Review the error above.
    pause
    exit /b 1
)
pause
