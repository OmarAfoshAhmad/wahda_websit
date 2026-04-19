@echo off
setlocal

REM Restart development server for this workspace.
REM Uses the existing PowerShell script that stops old processes and starts npm run dev.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-dev.ps1"

endlocal
