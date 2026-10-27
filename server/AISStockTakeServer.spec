# PyInstaller spec — build with build_exe.bat (or: pyinstaller AISStockTakeServer.spec)
# -*- mode: python ; coding: utf-8 -*-
import sys
from PyInstaller.utils.hooks import collect_submodules

hidden = (
    collect_submodules("uvicorn")
    + collect_submodules("pystray")
    + ["PIL.Image", "PIL.ImageDraw", "qrcode", "qrcode.image.svg", "tkinter", "tkinter.simpledialog",
       "anyio._backends._asyncio", "sqlite3"]
)

a = Analysis(
    ["server.py"],
    pathex=["."],
    binaries=[],
    datas=[("static", "static"), ("tray.png", ".")],
    hiddenimports=hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=["matplotlib", "numpy", "scipy", "pandas", "IPython", "jupyter"],
    noarchive=False,
)
pyz = PYZ(a.pure)
# One-folder build (exe + _internal\). Single-file builds unpack
# themselves into %TEMP% at start-up, which is the behaviour antivirus
# heuristics dislike most; the folder form is flagged far less often.
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="AISPhyStockServer",
    icon="icon.ico" if sys.platform.startswith("win") else None,
    console=False,          # tray only — no console window
    disable_windowed_traceback=False,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="AISPhyStockServer")
