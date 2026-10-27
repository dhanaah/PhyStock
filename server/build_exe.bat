@echo off
REM Builds dist\AISPhyStockServer.exe  (single file, tray-only, no Python needed on the target PC)
REM Needs internet once (pip). No admin rights required.
cd /d "%~dp0"
where py >nul 2>&1 && set PY=py -3
if not defined PY where python >nul 2>&1 && set PY=python
if not defined PY (echo Python 3.9+ not found on PATH & pause & exit /b 1)

set VPY=.venv-build\Scripts\python.exe
if not exist "%VPY%" (
  echo Creating build environment ...
  %PY% -m venv .venv-build || (echo venv failed & pause & exit /b 1)
)
REM A venv can end up without pip (interrupted creation, or a Python
REM installed without ensurepip). Repair it rather than fail.
"%VPY%" -m pip --version >nul 2>&1
if errorlevel 1 (
  echo pip missing in build environment - repairing ...
  "%VPY%" -m ensurepip --upgrade >nul 2>&1
  "%VPY%" -m pip --version >nul 2>&1
  if errorlevel 1 (
    echo Recreating build environment ...
    rmdir /s /q .venv-build
    %PY% -m venv .venv-build || (echo venv failed & pause & exit /b 1)
    "%VPY%" -m ensurepip --upgrade >nul 2>&1
    "%VPY%" -m pip --version >nul 2>&1 || (
      echo Python has no pip/ensurepip. Fix once with:  %PY% -m ensurepip --upgrade
      echo ^(or reinstall Python from python.org with "pip" ticked^), then run this again.
      pause & exit /b 1
    )
  )
)
"%VPY%" -m pip install --upgrade pip >nul
"%VPY%" -m pip install -r requirements.txt pyinstaller || (echo pip install failed - check network/proxy & pause & exit /b 1)

if not exist icon.ico "%VPY%" make_icon.py

echo Building exe (this takes 1-3 minutes) ...
"%VPY%" -m PyInstaller --noconfirm --clean AISStockTakeServer.spec || (echo BUILD FAILED & pause & exit /b 1)

echo.
echo ==========================================================
echo  Built:  %~dp0dist\AISPhyStockServer.exe
echo  Deploy: copy ONLY that exe to the data-center PC, in its
echo          own folder (e.g. D:\AISStockTakeServer\). On first
echo          run it creates config.json, data\ and server.log
echo          next to itself.
echo ==========================================================
pause
