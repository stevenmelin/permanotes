@echo off
setlocal
rem Wraps the already-built app into PermaNotes-Setup.exe (with README). Does not rebuild the app.
cd /d "%~dp0.."
if not exist "release\win-unpacked\PermaNotes.exe" (
  echo No app found at release\win-unpacked\PermaNotes.exe. Run "Build Windows App.bat" first.
  goto fail
)
set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" (
  echo Inno Setup 6 is not installed. Get it free from https://jrsoftware.org/isdl.php then run this again.
  goto fail
)
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set VERSION=%%v
if not defined VERSION (
  echo Could not read the version from package.json.
  goto fail
)
echo [###############               ] 1/2  Building installer %VERSION%
"%ISCC%" /DMyAppVersion=%VERSION% "installer\permanotes.iss"
if errorlevel 1 goto fail
echo [##############################] 2/2  Done
echo.
echo DONE: release\PermaNotes-%VERSION%-Windows-Setup.exe
if not defined CI pause
exit /b 0

:fail
echo.
echo INSTALLER FAILED. The real error is printed above.
if not defined CI pause
exit /b 1
