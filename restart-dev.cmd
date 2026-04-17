@echo off
setlocal

REM restart-dev.cmd
REM Runs the PowerShell restart script for Windows users.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-dev.ps1"

endlocal
