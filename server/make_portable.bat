@echo off
REM ============================================================================
REM  AIS PhyStock Server - PORTABLE FOLDER builder (no custom .exe at all)
REM  Produces  portable\AISPhyStockServer\  containing the official python.org
REM  runtime (signed by the Python Software Foundation) + the server files.
REM  Copy that folder to the data-center PC and double-click
REM  "AIS PhyStock Server.bat". Nothing to install, no admin, no PyInstaller
REM  binary for the antivirus to object to.
REM  Needs internet once (python.org + PyPI). No admin rights required.
REM ============================================================================
setlocal
cd /d "%~dp0"
if "%CI%"=="true" (set PAUSE=rem) else (set PAUSE=pause)
set PYVER=3.12.8
set OUT=portable\AISPhyStockServer
set PYDIR=%OUT%\python

if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%PYDIR%" || (echo cannot create %OUT% & %PAUSE% & exit /b 1)

echo [1/5] Downloading Python %PYVER% embeddable runtime ...
curl -L -# -o python-embed.zip https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-embed-amd64.zip || (echo download failed - check network/proxy & %PAUSE% & exit /b 1)
powershell -NoProfile -Command "Expand-Archive -Force -Path 'python-embed.zip' -DestinationPath '%PYDIR%'" || (echo unzip failed & %PAUSE% & exit /b 1)
del python-embed.zip

echo [2/5] Enabling site-packages in the embeddable runtime ...
for %%f in ("%PYDIR%\python*._pth") do (
  powershell -NoProfile -Command "(Get-Content '%%~f') -replace '^#\s*import site','import site' | Set-Content '%%~f'"
)

echo [3/5] Installing pip ...
curl -L -s -o get-pip.py https://bootstrap.pypa.io/get-pip.py || (echo get-pip download failed & %PAUSE% & exit /b 1)
"%PYDIR%\python.exe" get-pip.py --no-warn-script-location -q || (echo pip install failed & %PAUSE% & exit /b 1)
del get-pip.py

echo [4/5] Installing server packages ...
"%PYDIR%\python.exe" -m pip install -q --no-warn-script-location -r requirements.txt || (echo package install failed - check network/proxy & %PAUSE% & exit /b 1)

echo [5/5] Copying server files ...
copy /y server.py "%OUT%\" >nul
copy /y db.py "%OUT%\" >nul
copy /y countsheet.py "%OUT%\" >nul
copy /y tray.png "%OUT%\" >nul
copy /y icon.ico "%OUT%\" >nul
copy /y README.md "%OUT%\" >nul
xcopy /e /i /y static "%OUT%\static" >nul
> "%OUT%\AIS PhyStock Server.bat" (
  echo @echo off
  echo cd /d "%%~dp0"
  echo start "" "%%~dp0python\pythonw.exe" server.py
)
> "%OUT%\AIS PhyStock Server (console).bat" (
  echo @echo off
  echo cd /d "%%~dp0"
  echo "%%~dp0python\python.exe" server.py --no-tray
  echo pause
)

echo.
echo ==========================================================
echo  Portable server ready:  %~dp0%OUT%\
echo  Copy that whole folder to the data-center PC and run
echo  "AIS PhyStock Server.bat"  (tray icon, no window).
echo  Firewall rule for IT names:  ...\AISPhyStockServer\python\pythonw.exe
echo ==========================================================
%PAUSE%
