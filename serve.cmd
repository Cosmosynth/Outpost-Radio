@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 goto nopython

echo.
echo   Outpost Radio  -^>  http://127.0.0.1:5173
echo   Press Ctrl+C to stop the server.
echo.

rem Give the server a moment to bind, then open the default browser.
start "" cmd /c "ping -n 2 127.0.0.1 >nul & explorer http://127.0.0.1:5173/"

python -m http.server 5173 --bind 127.0.0.1
exit /b 0

:nopython
echo.
echo   Python was not found on PATH.
echo.
echo   Install Python 3 (python.org) and run this again, or serve this folder
echo   with any static web server and open http://127.0.0.1:5173
echo.
echo   ES modules do not work from file://, so double-clicking index.html
echo   will not load the player.
echo.
pause
exit /b 1
