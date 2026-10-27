@echo off
REM AIS PhyStock Server - starts silently in the system tray (no console window).
REM First run only: creates .venv and installs packages (needs internet once).
cd /d "%~dp0"
if exist ".venv\Scripts\pythonw.exe" goto run

where py >nul 2>&1 && set PY=py -3
if not defined PY where python >nul 2>&1 && set PY=python
if not defined PY (
  echo Python 3.9+ was not found. Install it from python.org with "Install for current user only"
  echo ^(no admin needed^), tick "Add python.exe to PATH", then run this file again.
  pause & exit /b 1
)
echo Creating virtual environment and installing packages ...
%PY% -m venv .venv || (echo venv failed & pause & exit /b 1)
".venv\Scripts\python.exe" -m pip --version >nul 2>&1 || ".venv\Scripts\python.exe" -m ensurepip --upgrade >nul 2>&1
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
".venv\Scripts\python.exe" -m pip install -r requirements.txt || (echo pip install failed - check network/proxy & pause & exit /b 1)

:run
start "" ".venv\Scripts\pythonw.exe" server.py
exit
