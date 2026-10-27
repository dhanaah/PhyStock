@echo off
REM Installs the OCR engine (rapidocr + onnxruntime) into a folder that the
REM server loads at start-up. Kept outside the exe on purpose: the exe stays
REM the same kind of file the antivirus already accepts.
REM   make_ocr_pack.bat                      -> ocr\  (next to server.py, for python-source runs)
REM   make_ocr_pack.bat dist\AISPhyStockServer\ocr   -> beside the built exe
REM Needs internet once (pip). Uses the build venv's Python so the packages
REM match the Python version inside the exe.
cd /d "%~dp0"
set TARGET=%~1
if "%TARGET%"=="" set TARGET=ocr
set VPY=.venv-build\Scripts\python.exe
if not exist "%VPY%" (
  where py >nul 2>&1 && set PY=py -3
  if not defined PY set PY=python
  %PY% -m venv .venv-build || (echo venv failed & goto :fail)
  "%VPY%" -m ensurepip --upgrade >nul 2>&1
)
if exist "%TARGET%" rmdir /s /q "%TARGET%"
"%VPY%" -m pip install --no-warn-script-location --target "%TARGET%" -r requirements-ocr.txt || goto :fail
echo OCR engine installed in %TARGET%
if not "%~2"=="nopause" pause
exit /b 0
:fail
echo OCR pack install failed - check network/proxy
if not "%~2"=="nopause" pause
exit /b 1
