"""AIS PhyStock Server — the "data center" every scanner pushes to.

Run:  python server.py            (tray icon + web dashboard)
      python server.py --no-tray  (console only; also what start.bat uses
                                   when the tray library is unavailable)

Everything is served on one port (config.json → "port", default 8765):
  /                      live dashboard (open in any browser on the LAN)
  /api/v1/ping           reachability + server time (device "Test connection")
  /api/v1/scans   POST   batch upsert from a device, ACKed with receipts
  /api/v1/heartbeat POST device presence; reply carries the current bay targets
  /api/v1/events         server-sent events feeding the dashboard
  /api/v1/export.csv     every record of the current stock take

Created by: DT · v1.1.0
"""
import argparse
import asyncio
import csv
import io
import json
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, Response
from pydantic import BaseModel, Field

import db

SERVER_VERSION = "1.3.1"
# When frozen into an .exe (PyInstaller), config/data/log live NEXT TO THE
# EXE (so they survive upgrades and are easy to find), while bundled
# resources (static/) are unpacked into a temp dir exposed as sys._MEIPASS.
FROZEN = getattr(sys, "frozen", False)
BASE = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
RES = Path(getattr(sys, "_MEIPASS", BASE)) if FROZEN else BASE
CONFIG_PATH = BASE / "config.json"
DEFAULT_CONFIG = {
    "port": 8765,
    "serverName": "AIS PhyStock Data Center",
    "adminPin": "2468",
    "apiKey": "",
    "openDashboardOnStart": True,
}


def load_config() -> Dict[str, Any]:
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text("utf-8")))
            # Rename migration: an untouched pre-1.2 name follows the product name.
            if cfg.get("serverName") == "AIS Stock Take Data Center":
                cfg["serverName"] = DEFAULT_CONFIG["serverName"]
                CONFIG_PATH.write_text(json.dumps(cfg, indent=2), "utf-8")
        except Exception as e:  # noqa: BLE001
            print(f"[config] could not read config.json ({e}); using defaults")
    else:
        CONFIG_PATH.write_text(json.dumps(cfg, indent=2), "utf-8")
    return cfg


CONFIG = load_config()


def lan_ip() -> str:
    """Best-effort LAN address (the one a default route would use)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:  # noqa: BLE001
        return socket.gethostbyname(socket.gethostname())


def server_url() -> str:
    return f"http://{lan_ip()}:{CONFIG['port']}"


# ------------------------------------------------------------ event bus (SSE)

class EventBus:
    def __init__(self):
        self._subs: List[asyncio.Queue] = []
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def attach_loop(self, loop):
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subs.append(q)
        return q

    def unsubscribe(self, q):
        if q in self._subs:
            self._subs.remove(q)

    def publish(self, event: str, data: Any):
        payload = json.dumps({"event": event, "data": data, "at": db.now_iso()})
        if not self._loop:
            return

        def _push():
            for q in list(self._subs):
                try:
                    q.put_nowait(payload)
                except asyncio.QueueFull:
                    pass
        self._loop.call_soon_threadsafe(_push)


bus = EventBus()

from contextlib import asynccontextmanager


@asynccontextmanager
async def _lifespan(_app):
    bus.attach_loop(asyncio.get_running_loop())
    db.connect()
    yield


app = FastAPI(title="AIS PhyStock Server", version=SERVER_VERSION, docs_url=None, redoc_url=None, lifespan=_lifespan)


def check_key(x_api_key: Optional[str]):
    want = CONFIG.get("apiKey") or ""
    if want and x_api_key != want:
        raise HTTPException(status_code=401, detail="Invalid API key")


def check_pin(pin: Optional[str]):
    if pin != str(CONFIG.get("adminPin")):
        raise HTTPException(status_code=403, detail="Wrong admin PIN")


# ------------------------------------------------------------------ models

class ScanIn(BaseModel):
    id: str
    lpn: Optional[str] = None
    palletNo: Optional[str] = None
    palletLpnDelimiter: Optional[str] = None
    partNumber: Optional[str] = None
    modelCode: Optional[str] = None
    workOrder: Optional[str] = None
    quantity: Optional[Any] = None
    physQty: Optional[Any] = None
    remarks: Optional[str] = None
    segment: Optional[str] = None
    qrType: Optional[str] = None
    plant: Optional[str] = None
    mfgDate: Optional[str] = None
    raw: Optional[str] = None
    isDuplicate: Optional[bool] = False
    stockNote: Optional[str] = None
    user: Optional[str] = None
    warehouse: Optional[str] = None
    bay: Optional[str] = None
    timestamp: Optional[str] = None


class DupAttemptIn(BaseModel):
    id: str
    lpn: Optional[str] = None
    palletNo: Optional[str] = None
    qrType: Optional[str] = None
    kind: Optional[str] = None          # 'local' | 'cross-device'
    otherDevice: Optional[str] = None
    otherBay: Optional[str] = None
    raw: Optional[str] = None
    user: Optional[str] = None
    warehouse: Optional[str] = None
    bay: Optional[str] = None
    at: Optional[str] = None


class ScanBatch(BaseModel):
    deviceId: str
    deviceName: Optional[str] = None
    appVersion: Optional[str] = None
    scans: List[ScanIn] = Field(default_factory=list)
    dupAttempts: List[DupAttemptIn] = Field(default_factory=list)


class Heartbeat(BaseModel):
    deviceId: str
    deviceName: Optional[str] = None
    user: Optional[str] = None
    warehouse: Optional[str] = None
    bay: Optional[str] = None
    appVersion: Optional[str] = None
    total: Optional[int] = 0
    pending: Optional[int] = 0
    dupAttempts: List[DupAttemptIn] = Field(default_factory=list)


class TargetsIn(BaseModel):
    pin: str
    targets: Dict[str, Optional[int]]
    replace: bool = False


class PinIn(BaseModel):
    pin: str
    name: Optional[str] = None


def _to_row(s: ScanIn) -> Dict[str, Any]:
    return {
        "client_id": s.id, "lpn": s.lpn, "pallet_no": s.palletNo, "delimiter": s.palletLpnDelimiter,
        "part_number": s.partNumber, "model_code": s.modelCode, "work_order": s.workOrder,
        "quantity": None if s.quantity is None else str(s.quantity),
        "phys_qty": None if s.physQty in (None, "") else str(s.physQty),
        "remarks": s.remarks, "segment": s.segment, "qr_type": s.qrType, "plant": s.plant,
        "mfg_date": s.mfgDate, "raw": s.raw, "is_duplicate": 1 if s.isDuplicate else 0,
        "stock_note": s.stockNote, "user": s.user, "warehouse": s.warehouse, "bay": s.bay,
        "scanned_at": s.timestamp,
    }


# ------------------------------------------------------------------ API

@app.get("/api/v1/ping")
def ping():
    st = db.current_stocktake()
    return {
        "ok": True, "serverName": CONFIG["serverName"], "serverVersion": SERVER_VERSION,
        "serverTime": db.now_iso(), "stocktake": st, "requiresApiKey": bool(CONFIG.get("apiKey")),
    }


@app.post("/api/v1/scans")
def post_scans(batch: ScanBatch, request: Request, x_api_key: Optional[str] = Header(default=None)):
    check_key(x_api_key)
    ip = request.client.host if request.client else None
    rows = []
    for s in batch.scans:
        r = _to_row(s)
        r["device_id"] = batch.deviceId
        r["device_name"] = batch.deviceName
        rows.append(r)
    results = db.upsert_scans(rows, source_ip=ip)
    db.heartbeat({"device_id": batch.deviceId, "device_name": batch.deviceName, "app_version": batch.appVersion,
                  **({"user": rows[-1]["user"], "warehouse": rows[-1]["warehouse"], "bay": rows[-1]["bay"]} if rows else {})}, ip=ip)
    inserted = [r for r in results if r["status"] == "inserted"]
    if inserted:
        bus.publish("scans", {"count": len(inserted), "deviceName": batch.deviceName})
    dup_ids = db.add_dup_attempts([d.model_dump() for d in batch.dupAttempts], batch.deviceId, batch.deviceName) if batch.dupAttempts else []
    if dup_ids:
        bus.publish("dups", {"count": len(dup_ids), "deviceName": batch.deviceName})
    bus.publish("devices", None)
    return {"ok": True, "serverTime": db.now_iso(), "results": results, "dupAttemptIds": dup_ids, "bayTargets": db.get_bay_targets()}


@app.post("/api/v1/heartbeat")
def post_heartbeat(hb: Heartbeat, request: Request, x_api_key: Optional[str] = Header(default=None)):
    check_key(x_api_key)
    ip = request.client.host if request.client else None
    db.heartbeat({
        "device_id": hb.deviceId, "device_name": hb.deviceName, "user": hb.user, "warehouse": hb.warehouse,
        "bay": hb.bay, "app_version": hb.appVersion, "total": hb.total, "pending": hb.pending,
    }, ip=ip)
    dup_ids = db.add_dup_attempts([d.model_dump() for d in hb.dupAttempts], hb.deviceId, hb.deviceName) if hb.dupAttempts else []
    if dup_ids:
        bus.publish("dups", {"count": len(dup_ids), "deviceName": hb.deviceName})
    bus.publish("devices", None)
    return {"ok": True, "serverTime": db.now_iso(), "bayTargets": db.get_bay_targets(),
            "stocktake": db.current_stocktake(), "dupAttemptIds": dup_ids}


@app.get("/api/v1/lpn-check")
def lpn_check(lpn: str, qrType: Optional[str] = None, x_api_key: Optional[str] = Header(default=None)):
    """Pre-scan duplicate check — a linked device asks before it accepts
    a pallet, so a duplicate is refused at scan time across all devices."""
    check_key(x_api_key)
    hit = db.lpn_check(lpn, qrType)
    if not hit:
        return {"exists": False}
    return {"exists": True, "receipt": hit["receipt"], "deviceName": hit["device_name"], "user": hit["user"],
            "bay": hit["bay"], "receivedAt": hit["received_at"]}


@app.get("/api/v1/dup-attempts")
def get_dup_attempts(limit: int = 200):
    return {"dupAttempts": db.list_dup_attempts(limit=limit)}


@app.get("/api/v1/bay-targets")
def get_targets():
    return {"targets": db.get_bay_targets(), "stocktake": db.current_stocktake()}


@app.put("/api/v1/bay-targets")
def put_targets(body: TargetsIn):
    check_pin(body.pin)
    targets = db.set_bay_targets(body.targets, replace=body.replace)
    bus.publish("targets", targets)
    return {"ok": True, "targets": targets}


@app.get("/api/v1/stats")
def get_stats():
    return db.stats()


@app.get("/api/v1/devices")
def get_devices():
    return {"devices": db.list_devices()}


@app.get("/api/v1/scans")
def get_scans(limit: int = 5000):
    return {"scans": db.list_scans(limit=limit)}


@app.get("/api/v1/stocktakes")
def get_stocktakes():
    return {"stocktakes": db.list_stocktakes(), "current": db.current_stocktake()}


@app.post("/api/v1/admin/new-stocktake")
def new_stocktake(body: PinIn):
    check_pin(body.pin)
    name = body.name or f"Stock take {len(db.list_stocktakes()) + 1}"
    sid = db.start_new_stocktake(name)
    bus.publish("stocktake", {"id": sid, "name": name})
    return {"ok": True, "id": sid, "name": name}


@app.get("/api/v1/server-info")
def server_info():
    import qrcode
    import qrcode.image.svg
    url = server_url()
    setup = f"aisstocktake://server?url={url}"
    if CONFIG.get("apiKey"):
        setup += f"&key={CONFIG['apiKey']}"
    img = qrcode.make(setup, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=1)
    buf = io.BytesIO()
    img.save(buf)
    return {"url": url, "setupCode": setup, "qrSvg": buf.getvalue().decode("utf-8"),
            "serverName": CONFIG["serverName"], "version": SERVER_VERSION, "requiresApiKey": bool(CONFIG.get("apiKey"))}


CSV_COLS = [
    ("receipt", "Receipt No"), ("received_at", "Received At (server)"), ("scanned_at", "Scanned At (device)"),
    ("device_name", "Device"), ("user", "User"), ("warehouse", "Warehouse"), ("bay", "Bay"),
    ("lpn_combined", "LPN"), ("pallet_no", "Pallet No"), ("lpn", "LPN (raw)"), ("part_number", "Part Number"),
    ("model_code", "Model Code"), ("work_order", "Work Order"), ("quantity", "Qty"), ("phys_qty", "Phy. Qty"),
    ("segment", "Segment"), ("qr_type", "Code Type"), ("plant", "Plant"), ("mfg_date", "Mfg Date"),
    ("is_duplicate", "Duplicate (device)"), ("global_dup_of", "Duplicate of Receipt (cross-device)"),
    ("stock_note", "Note"), ("remarks", "Remarks"), ("client_id", "Client ID"), ("raw", "Raw Code"),
]


@app.get("/api/v1/export.csv")
def export_csv(stocktake_id: Optional[int] = None):
    rows = db.list_scans(limit=1_000_000, stocktake_id=stocktake_id)
    buf = io.StringIO()
    buf.write("﻿")  # BOM so Excel opens UTF-8 cleanly
    w = csv.writer(buf)
    w.writerow([h for _, h in CSV_COLS])
    for r in reversed(rows):  # oldest first
        r = dict(r)
        r["lpn_combined"] = f"{r['pallet_no']}{r.get('delimiter') or '.'}{r['lpn']}" if r.get("pallet_no") and r.get("lpn") else (r.get("lpn") or "")
        r["is_duplicate"] = "YES" if r.get("is_duplicate") else ""
        w.writerow([r.get(k, "") if r.get(k) is not None else "" for k, _ in CSV_COLS])
    dups = db.list_dup_attempts(limit=100000, stocktake_id=stocktake_id)
    if dups:
        w.writerow([])
        w.writerow(["DUPLICATE SCANS REFUSED (not counted)"])
        w.writerow(["Time (device)", "Device", "User", "Warehouse", "Bay", "LPN", "Pallet No", "Kind", "Already scanned by", "Their bay"])
        for d in reversed(dups):
            w.writerow([d.get("at") or "", d.get("device_name") or "", d.get("user") or "", d.get("warehouse") or "", d.get("bay") or "",
                        d.get("lpn") or "", d.get("pallet_no") or "", d.get("kind") or "", d.get("other_device") or "", d.get("other_bay") or ""])
    st = db.current_stocktake() or {}
    fname = f"AIS_PhyStock_{(st.get('name') or 'export').replace(' ', '_')}_{time.strftime('%Y%m%d_%H%M')}.csv"
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@app.get("/api/v1/events")
async def events(request: Request):
    q = bus.subscribe()

    async def gen():
        try:
            yield f"data: {json.dumps({'event': 'hello', 'data': None})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            bus.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/static/phystock-mark.png")
def mark_png():
    return Response(content=(RES / "static" / "phystock-mark.png").read_bytes(), media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


@app.get("/", response_class=HTMLResponse)
def dashboard():
    return (RES / "static" / "dashboard.html").read_text("utf-8")


# ------------------------------------------------------------------ tray

def _msgbox(title, text, flags=0x40):
    """Native Windows message box (no console needed). Silently no-op elsewhere."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, str(text), str(title), flags | 0x1000)
    except Exception:  # noqa: BLE001
        print(f"[{title}] {text}")


def _bring_to_front(win):
    """Windows won't let a background process steal focus unless it just
    received input — which it did (the tray menu click). Make sure of it."""
    try:
        win.update_idletasks()
        win.attributes("-topmost", True)
        win.lift()
        win.focus_force()
        import ctypes
        hwnd = ctypes.windll.user32.GetParent(win.winfo_id()) or win.winfo_id()
        ctypes.windll.user32.AllowSetForegroundWindow(-1)
        ctypes.windll.user32.SetForegroundWindow(hwnd)
        ctypes.windll.user32.BringWindowToTop(hwnd)
    except Exception:  # noqa: BLE001
        pass


def _ask_pin_powershell():
    """Masked PIN prompt via a tiny WinForms form in a PowerShell child
    process — used when tkinter is unavailable (embeddable/portable
    Python). Runs fine from any thread since it is a separate process.
    Returns the typed string, or None on cancel."""
    import subprocess
    script = r'''
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$f = New-Object System.Windows.Forms.Form
$f.Text = 'AIS PhyStock Server'
$f.Size = New-Object System.Drawing.Size(360,190)
$f.StartPosition = 'CenterScreen'
$f.FormBorderStyle = 'FixedDialog'
$f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.TopMost = $true
$f.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#15191D')
$l = New-Object System.Windows.Forms.Label
$l.Text = 'Enter the admin PIN to stop the server'
$l.ForeColor = 'White'; $l.Font = New-Object System.Drawing.Font('Segoe UI',10,[System.Drawing.FontStyle]::Bold)
$l.AutoSize = $true; $l.Location = New-Object System.Drawing.Point(20,18)
$t = New-Object System.Windows.Forms.TextBox
$t.UseSystemPasswordChar = $true; $t.Font = New-Object System.Drawing.Font('Consolas',14)
$t.Location = New-Object System.Drawing.Point(20,52); $t.Size = New-Object System.Drawing.Size(300,30)
$t.TextAlign = 'Center'
$ok = New-Object System.Windows.Forms.Button
$ok.Text = 'Stop server'; $ok.Location = New-Object System.Drawing.Point(200,100); $ok.Size = New-Object System.Drawing.Size(120,32)
$ok.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#FFC233'); $ok.FlatStyle = 'Flat'
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$c = New-Object System.Windows.Forms.Button
$c.Text = 'Cancel'; $c.Location = New-Object System.Drawing.Point(80,100); $c.Size = New-Object System.Drawing.Size(110,32)
$c.ForeColor = 'White'; $c.FlatStyle = 'Flat'
$c.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$f.Controls.AddRange(@($l,$t,$ok,$c)); $f.AcceptButton = $ok; $f.CancelButton = $c
$f.Add_Shown({ $f.Activate(); $t.Focus() })
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output ('PIN:' + $t.Text) } else { Write-Output 'CANCEL' }
'''
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
            capture_output=True, text=True, timeout=300,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout.strip().splitlines()
        last = out[-1] if out else "CANCEL"
        return last[4:] if last.startswith("PIN:") else None
    except Exception as e:  # noqa: BLE001
        _msgbox("AIS PhyStock Server", f"Could not open the PIN prompt: {e}", 0x10)
        return None


def _ask_pin(root):
    """Modal masked PIN prompt. MUST run on the Tk main thread (see
    run_tray — tray callbacks hand it over via root.after)."""
    import tkinter as tk
    result = {"pin": None}
    win = tk.Toplevel(root)
    win.title("AIS PhyStock Server")
    win.resizable(False, False)
    win.configure(bg="#15191D")
    tk.Label(win, text="Enter the admin PIN to stop the server", bg="#15191D", fg="#FFFFFF",
             font=("Segoe UI", 10, "bold"), padx=18, pady=12).pack()
    tk.Label(win, text="Scanners still pushing will queue until the server is back.",
             bg="#15191D", fg="#B7C0C9", font=("Segoe UI", 9), padx=18).pack()
    var = tk.StringVar()
    entry = tk.Entry(win, textvariable=var, show="•", font=("Consolas", 16), width=12, justify="center",
                     bg="#20262C", fg="#FFFFFF", insertbackground="#FFC233", relief="flat")
    entry.pack(pady=12, ipady=6)

    def ok(_=None):
        result["pin"] = var.get()
        win.destroy()

    def cancel(_=None):
        win.destroy()

    btns = tk.Frame(win, bg="#15191D")
    btns.pack(pady=(0, 14))
    tk.Button(btns, text="Cancel", command=cancel, width=10, bg="#20262C", fg="#FFFFFF", relief="flat",
              activebackground="#2A323A", activeforeground="#FFFFFF").pack(side="left", padx=6)
    tk.Button(btns, text="Stop server", command=ok, width=12, bg="#FFC233", fg="#14181C", relief="flat",
              font=("Segoe UI", 9, "bold"), activebackground="#FFD66A").pack(side="left", padx=6)
    win.bind("<Return>", ok)
    win.bind("<Escape>", cancel)
    win.protocol("WM_DELETE_WINDOW", cancel)
    # centre on screen
    win.update_idletasks()
    w, h = win.winfo_reqwidth(), win.winfo_reqheight()
    x = (win.winfo_screenwidth() - w) // 2
    y = (win.winfo_screenheight() - h) // 2
    win.geometry(f"+{x}+{y}")
    _bring_to_front(win)
    entry.focus_set()
    win.after(50, lambda: (_bring_to_front(win), entry.focus_set()))
    win.after(250, lambda: entry.focus_force())
    win.grab_set()
    root.wait_window(win)
    return result["pin"]


def _tray_image():
    from PIL import Image, ImageDraw
    for cand in (RES / "tray.png", BASE / "tray.png"):
        if cand.exists():
            try:
                return Image.open(cand).convert("RGBA")
            except Exception:  # noqa: BLE001
                pass
    img = Image.new("RGB", (64, 64), "#0B0E11")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((6, 6, 58, 58), radius=10, fill="#FFC233")
    d.rectangle((16, 16, 26, 26), fill="#0B0E11")
    d.rectangle((38, 16, 48, 26), fill="#0B0E11")
    d.rectangle((16, 38, 26, 48), fill="#0B0E11")
    d.rectangle((34, 34, 48, 48), fill="#0B0E11")
    return img


def run_tray(url: str, server):
    """Tray icon with: Open dashboard · Copy address · Status · Quit (PIN).

    Quitting deliberately requires the admin PIN — the server is the master
    copy of the count, and an operator closing it mid-shift (while scanners
    are still pushing) is exactly the kind of accident this prevents.

    Threading: pystray runs its menu callbacks on its own thread. A Tk
    dialog created there shows up but never receives keyboard input on
    Windows (no message loop on that thread). So the Tk root lives on the
    MAIN thread and owns the main loop; the tray icon runs detached, and
    callbacks hand work to the main thread with root.after(0, ...).
    """
    import pystray
    try:
        import tkinter as tk
    except Exception:  # noqa: BLE001
        tk = None

    if tk is None:
        # Portable/embeddable Python has no tkinter: run the icon on the main
        # thread and use the PowerShell prompt (a separate process, so the
        # callback thread is fine).
        def quit_app_ps(icon, item):
            pin = _ask_pin_powershell()
            if pin is None:
                return
            if str(pin).strip() != str(CONFIG.get("adminPin")):
                _msgbox("AIS PhyStock Server", "Wrong admin PIN — the server keeps running.", 0x10)
                return
            server.should_exit = True
            icon.stop()

        def status_ps(icon, item):
            try:
                st = db.stats(); devs = db.list_devices(); on = sum(1 for d in devs if d["online"])
                cur = db.current_stocktake() or {}
                _msgbox("AIS PhyStock Server", f"{cur.get('name', '')}\n\nReceived: {st['total']}   Unique LPNs: {st['uniqueLpns']}\n"
                        f"Devices online: {on} / {len(devs)}\n\nDashboard: {url}")
            except Exception as e:  # noqa: BLE001
                _msgbox("AIS PhyStock Server", f"Status unavailable: {e}", 0x30)

        icon = pystray.Icon(
            "AIS PhyStock Server", _tray_image(), f"AIS PhyStock Server — {url}",
            menu=pystray.Menu(
                pystray.MenuItem("Open dashboard", lambda i, it: webbrowser.open(url), default=True),
                pystray.MenuItem("Status…", status_ps),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Quit server (admin PIN)", quit_app_ps),
            ))
        icon.run()
        return

    root = tk.Tk()
    root.withdraw()

    def on_main(fn):
        root.after(0, fn)

    def open_dash(icon, item):
        webbrowser.open(url)

    def copy_addr(icon, item):
        def _do():
            try:
                root.clipboard_clear()
                root.clipboard_append(url)
                root.update()
            except Exception:  # noqa: BLE001
                pass
        on_main(_do)
        try:
            icon.notify(f"Copied {url}", "AIS PhyStock Server")
        except Exception:  # noqa: BLE001
            pass

    def status(icon, item):
        try:
            st = db.stats()
            devs = db.list_devices()
            on = sum(1 for d in devs if d["online"])
            cur = db.current_stocktake() or {}
            _msgbox("AIS PhyStock Server",
                    f"{cur.get('name', '')}\n\nReceived: {st['total']}   Unique LPNs: {st['uniqueLpns']}\n"
                    f"Devices online: {on} / {len(devs)}\n\nDashboard: {url}")
        except Exception as e:  # noqa: BLE001
            _msgbox("AIS PhyStock Server", f"Status unavailable: {e}", 0x30)

    def quit_app(icon, item):
        def _do():
            pin = _ask_pin(root)
            if pin is None:
                return
            if str(pin).strip() != str(CONFIG.get("adminPin")):
                _msgbox("AIS PhyStock Server", "Wrong admin PIN — the server keeps running.", 0x10)
                return
            server.should_exit = True
            try:
                icon.stop()
            except Exception:  # noqa: BLE001
                pass
            root.quit()
        on_main(_do)

    icon = pystray.Icon(
        "AIS PhyStock Server", _tray_image(), f"AIS PhyStock Server — {url}",
        menu=pystray.Menu(
            pystray.MenuItem("Open dashboard", open_dash, default=True),
            pystray.MenuItem("Copy server address", copy_addr),
            pystray.MenuItem("Status…", status),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit server (admin PIN)", quit_app),
        ))
    icon.run_detached()
    try:
        root.mainloop()
    finally:
        try:
            icon.stop()
        except Exception:  # noqa: BLE001
            pass
        try:
            root.destroy()
        except Exception:  # noqa: BLE001
            pass


def _setup_logging():
    """With pythonw there is no console — everything goes to data/server.log."""
    import logging
    from logging.handlers import RotatingFileHandler
    log_dir = BASE / "data"
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(log_dir / "server.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = [handler]
        lg.propagate = False
    if sys.stdout is None or sys.stderr is None:  # pythonw: route prints to the log too
        class _ToLog:
            def write(self, msg):
                msg = msg.rstrip()
                if msg:
                    logging.getLogger("stdout").info(msg)
            def flush(self):
                pass
        sys.stdout = sys.stderr = _ToLog()


def _whats_on_port(port: int) -> dict:
    """Identify what holds the port: our own server (ping answers), or
    another program (PID/name via netstat + tasklist on Windows)."""
    info = {}
    try:
        import urllib.request
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/ping", timeout=2) as r:
            data = json.loads(r.read().decode("utf-8"))
            if data.get("ok") and "serverVersion" in data:
                info["ours"] = True
                info["version"] = data.get("serverVersion")
                return info
    except Exception:  # noqa: BLE001
        pass
    if sys.platform.startswith("win"):
        try:
            import subprocess
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, timeout=10, creationflags=flags).stdout
            for line in out.splitlines():
                parts = line.split()
                if len(parts) >= 5 and parts[0].upper() == "TCP" and parts[1].endswith(f":{port}") and parts[3].upper() == "LISTENING":
                    info["pid"] = int(parts[4])
                    break
            if info.get("pid"):
                out = subprocess.run(["tasklist", "/FI", f"PID eq {info['pid']}", "/FO", "CSV", "/NH"],
                                     capture_output=True, text=True, timeout=10, creationflags=flags).stdout
                info["name"] = out.split(",")[0].strip('"') if out.strip() else "unknown"
        except Exception:  # noqa: BLE001
            pass
    return info


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("0.0.0.0", port))
            return True
        except OSError:
            return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-tray", action="store_true", help="run in the console without a tray icon")
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    if args.port:
        CONFIG["port"] = args.port

    _setup_logging()
    url = server_url()

    if not _port_free(CONFIG["port"]):
        who = _whats_on_port(CONFIG["port"])
        if who.get("ours"):
            _msgbox("AIS PhyStock Server",
                    f"AIS PhyStock Server is ALREADY RUNNING on this PC (v{who.get('version', '?')}).\n\n"
                    f"Its tray icon may be hidden under the  ^  arrow next to the clock.\n"
                    f"Use that icon to open the dashboard or quit it (admin PIN).\n\nDashboard: {url}", 0x40)
            if not args.no_browser:
                webbrowser.open(url)
        else:
            _msgbox("AIS PhyStock Server",
                    f"Port {CONFIG['port']} is taken by ANOTHER program"
                    f"{(' (PID ' + str(who['pid']) + ', ' + who['name'] + ')') if who.get('pid') else ''}.\n\n"
                    f"Either close that program, or change \"port\" in config.json "
                    f"(e.g. 8766) and start again — then re-scan the dashboard QR on the devices.", 0x30)
        return

    print("=" * 64)
    print(f"  AIS PhyStock Server v{SERVER_VERSION}")
    print(f"  Dashboard : {url}")
    print(f"  Devices   : point scanners at {url}  (or scan the QR on the dashboard)")
    print(f"  Database  : {db.DB_PATH}")
    print("=" * 64)

    config = uvicorn.Config(app, host="0.0.0.0", port=CONFIG["port"], log_level="info", access_log=False,
                            log_config=None)
    server = uvicorn.Server(config)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()

    if CONFIG.get("openDashboardOnStart") and not args.no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    use_tray = (not args.no_tray) and sys.platform.startswith("win")
    if use_tray:
        try:
            run_tray(url, server)
        except Exception as e:  # noqa: BLE001
            logging_msg = f"Tray icon failed ({e}); running headless. Stop it from Task Manager (pythonw.exe)."
            print(logging_msg)
            _msgbox("AIS PhyStock Server", logging_msg, 0x30)
            use_tray = False
    if not use_tray:
        try:
            while t.is_alive() and not server.should_exit:
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
    server.should_exit = True
    t.join(timeout=5)


if __name__ == "__main__":
    main()
