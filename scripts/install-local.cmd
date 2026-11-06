@echo off
rem install-local.cmd - install the latest local build (release\win-unpacked) into %LOCALAPPDATA%\Claudex and start it.
rem Closes a running Claudex first; open sessions can be resumed afterwards.
echo Closing Claudex and installing the new build...
taskkill /IM Claudex.exe /F >nul 2>&1
timeout /t 3 /nobreak >nul
robocopy "%~dp0..\release\win-unpacked" "%LOCALAPPDATA%\Claudex" /MIR /R:10 /W:1 /NFL /NDL /NJH /NJS /NP
if %ERRORLEVEL% GEQ 8 (
  echo Install failed. Please run this again in a moment.
  pause
  exit /b 1
)
start "" "%LOCALAPPDATA%\Claudex\Claudex.exe"
