@echo off
setlocal enabledelayedexpansion
rem install-local.cmd - install the latest local build (release\win-unpacked) into
rem %LOCALAPPDATA%\spawn, optionally put a shortcut on the Desktop, and start it.
rem Closes a running spawn first; open sessions can be resumed afterwards.
rem
rem   install-local.cmd                 ask about the Desktop shortcut
rem   install-local.cmd --shortcut      make the shortcut, ask nothing
rem   install-local.cmd --no-shortcut   skip the shortcut, ask nothing

set "SHORTCUT=ask"
:parse
if "%~1"=="" goto parsed
if /i "%~1"=="--shortcut" set "SHORTCUT=yes"
if /i "%~1"=="--no-shortcut" set "SHORTCUT=no"
shift
goto parse
:parsed

set "SOURCE=%~dp0..\release\win-unpacked"
set "TARGET=%LOCALAPPDATA%\spawn"

if not exist "%SOURCE%\spawn.exe" (
  echo No build found at "%SOURCE%".
  echo Build one first:  node scripts\release.mjs "notes"
  pause
  exit /b 1
)

echo Closing spawn and installing the new build...
taskkill /IM spawn.exe /F >nul 2>&1
rem the app was Claudex.exe until 1.3.35 (an older install may still be running)
taskkill /IM Claudex.exe /F >nul 2>&1
timeout /t 3 /nobreak >nul
robocopy "%SOURCE%" "%TARGET%" /MIR /R:10 /W:1 /NFL /NDL /NJH /NJS /NP
if %ERRORLEVEL% GEQ 8 (
  echo Install failed. Please run this again in a moment.
  pause
  exit /b 1
)

if "%SHORTCUT%"=="ask" (
  set "ANSWER="
  set /p "ANSWER=Put a spawn shortcut on the Desktop? [Y/n] "
  if /i "!ANSWER!"=="n" (set "SHORTCUT=no") else (set "SHORTCUT=yes")
)

if "%SHORTCUT%"=="yes" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0desktop-shortcut.ps1" -InstallDir "%TARGET%"
  if errorlevel 1 echo Could not create the Desktop shortcut - spawn is still installed at "%TARGET%".
)

start "" "%TARGET%\spawn.exe"
endlocal
