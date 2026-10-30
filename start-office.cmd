@echo off
title MyOffice Antigravity
cd /d "%~dp0"
echo ==============================================
echo       MyOffice (Antigravity on Windows)       
echo ==============================================
echo Opening server at http://127.0.0.1:4310 ...
echo Press Ctrl+C to stop.
echo.
node scripts/start.mjs
pause
