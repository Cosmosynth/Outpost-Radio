@echo off
setlocal
cd /d "%~dp0"

rem Prefer the py launcher, then python. The Windows Store aliases answer `where`
rem but fail when executed, so prove each candidate can actually import sys.
set "PY="
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PY=py -3"
)
if not defined PY (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import sys" >nul 2>nul
    if not errorlevel 1 set "PY=python"
  )
)
if not defined PY goto nopython

echo.
echo   Outpost Radio  -^>  http://127.0.0.1:5173
echo   Press Ctrl+C to stop the server.
echo.

rem Give the server a moment to bind, then open the default browser.
start "" cmd /c "ping -n 2 127.0.0.1 >nul & explorer http://127.0.0.1:5173/"

%PY% -m http.server 5173 --bind 127.0.0.1
if errorlevel 1 (
  echo.
  echo   The server stopped with an error. Port 5173 may already be in use.
  pause
)
exit /b 0

:nopython
echo.
echo   No working Python 3 was found on PATH.
echo.
echo   Install Python 3 (python.org) and run this again, or serve this folder
echo   with any static web server and open http://127.0.0.1:5173
echo.
echo   ES modules do not work from file://, so double-clicking index.html
echo   will not load the player.
echo.
pause
exit /b 1
