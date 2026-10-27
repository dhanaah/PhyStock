@echo off
REM Diagnostic start: keeps a console window open so errors are visible.
REM Normal use is start.bat (tray icon, no window). Logs are also in data\server.log.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" call start.bat
".venv\Scripts\python.exe" server.py --no-tray
pause
