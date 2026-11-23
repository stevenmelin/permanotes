@echo off
setlocal
rem Builds PermaNotes.exe (in release\win-unpacked). Double-click to run.
cd /d "%~dp0.."
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org then run this again.
  goto fail
)
echo.
echo [#######                       ] 1/4  Installing dependencies
call npm ci
if errorlevel 1 goto fail
echo.
echo [##############                ] 2/4  Checking the code
call npm run audit
if errorlevel 1 goto fail
call npm run typecheck
if errorlevel 1 goto fail
call npm test
if errorlevel 1 goto fail
echo.
echo [######################        ] 3/4  Building the app
call npm run build
if errorlevel 1 goto fail
echo.
echo [##############################] 4/4  Packaging PermaNotes.exe
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx electron-builder --win --x64 --dir --publish never
if errorlevel 1 goto fail
if not exist "release\win-unpacked\PermaNotes.exe" (
  echo Expected release\win-unpacked\PermaNotes.exe but it was not created.
  goto fail
)
echo.
echo DONE: release\win-unpacked\PermaNotes.exe
echo Next: double-click "Build Windows Installer.bat" to make the installer.
if not defined CI pause
exit /b 0

:fail
echo.
echo BUILD FAILED. The real error is printed above.
if not defined CI pause
exit /b 1
