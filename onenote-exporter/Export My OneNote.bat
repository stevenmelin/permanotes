@echo off
title Export My OneNote
echo Exporting all your OneNote notebooks from this PC (no internet needed)...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Export-OneNote.ps1"
echo.
pause
