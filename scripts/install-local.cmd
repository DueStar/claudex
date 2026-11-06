@echo off
rem install-local.cmd - put the latest local build (release\win-unpacked) into %LOCALAPPDATA%\Claudex and start it.
rem Closes a running Claudex first (open sessions can be resumed afterwards).
chcp 65001 >nul
echo Claudex 를 닫고 새 버전을 설치해요...
taskkill /IM Claudex.exe /F >nul 2>&1
timeout /t 3 /nobreak >nul
robocopy "%~dp0..\release\win-unpacked" "%LOCALAPPDATA%\Claudex" /MIR /R:10 /W:1 /NFL /NDL /NJH /NJS /NP
if %ERRORLEVEL% GEQ 8 (
  echo 설치에 실패했어요. 잠시 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)
start "" "%LOCALAPPDATA%\Claudex\Claudex.exe"
