@echo off
rem Double-clic : installe ou met à jour le relais des diagnostics sur le VPS (voir install.sh)
chcp 65001 >nul
"C:\Program Files\Git\bin\bash.exe" "%~dp0install.sh"
echo.
pause
