# AIS PhyStock Server (Data Center) — v1.4.0

The one PC on the warehouse network that every scanner pushes to. Receives
each scan the moment it is logged, ACKs it with a receipt number, shows a
live dashboard of all devices and all records, flags pallets scanned by
more than one device, holds the bay targets, and exports the consolidated
count as CSV.

Created by: DT

## What's in the folder

| File | Purpose |
|---|---|
| `start.bat` | Double-click to run. First run creates `.venv` and installs the packages (needs internet once). After that it starts **silently in the system tray — no window at all**. |
| `start_console.bat` | Diagnostic only: keeps a console window open so you can watch messages. |
| `data/server.log` | Everything the server does (rotating, 2 MB × 3). Look here when there is no window. |
| `server.py` | The server (FastAPI + Uvicorn). Single port, default `8765`. |
| `db.py` | SQLite storage. Database file: `data/stocktake.sqlite3`. |
| `static/dashboard.html` | The live web dashboard. |
| `config.json` | Created on first run. `port`, `serverName`, `adminPin` (default `2468`), optional `apiKey`. |
| `requirements.txt` | Python packages. |

## Option A — portable folder (recommended: nothing for the antivirus to block)

Trend Micro / Apex One flags unsigned PyInstaller executables as "unknown
threats". This option has **no custom exe at all**: the folder contains the
official python.org runtime (signed by the Python Software Foundation) and
the server files. The only processes that run are `pythonw.exe` /
`powershell.exe`, both signed.

1. On a PC with internet (hotspot is fine): unzip this kit, double-click
   **`make_portable.bat`**. It downloads the Python 3.12 embeddable runtime
   (~11 MB) and the packages, and produces `portable\AISPhyStockServer\`
   (~60 MB). No admin rights.
2. Copy that **whole folder** to the data-center PC, e.g.
   `D:\AISPhyStockServer\`.
3. Double-click **`AIS PhyStock Server.bat`** inside it. No window opens;
   the yellow tray icon appears and the dashboard opens. First run creates
   `config.json`, `data\stocktake.sqlite3`, `data\server.log` in that
   folder. (`AIS PhyStock Server (console).bat` keeps a window open for
   diagnostics.)
4. Firewall rule for IT: *allow inbound TCP 8765 for
   `D:\AISPhyStockServer\python\pythonw.exe`*.
5. Autostart: `Win+R` → `shell:startup` → shortcut to `AIS PhyStock Server.bat`.

Upgrading = copy the new `server.py`, `db.py` and `static\` over the old
ones. The tray's *Quit (admin PIN)* prompt in this mode is a small
PowerShell form (the embeddable runtime has no tkinter) — same behaviour.

## Option A2 — exe build (if your antivirus allows it)

`build_exe.bat` → `dist\AISPhyStockServer\` (folder with the exe; the
single-file form was dropped because it is the one AV heuristics dislike
most). If Apex One still quarantines it, ask IT to whitelist the folder, or
simply use Option A.

## Option B — run from Python source (Windows PC, no admin rights needed)

1. **Python** — if `python --version` in a Command Prompt doesn't show 3.9 or
   newer, install from python.org with **"Install for current user only"**
   (no admin), ticking **Add python.exe to PATH**.
2. Copy this folder anywhere, e.g. `D:\AISPhyStockServer`.
3. Run `start_console.bat`. First run installs packages (if the office
   proxy blocks pip, run it once on a hotspot — it's a one-time download).
4. The dashboard opens in your browser at `http://<this-PC-IP>:8765`.
   The address and a **QR code** are shown top-right.
5. **Windows Firewall — the one step that needs IT.** Windows blocks new
   inbound connections by default. Ask IT for a one-time rule:
   *"Allow inbound TCP port 8765 on the Domain/Private network for
   `D:\AISPhyStockServer\.venv\Scripts\python.exe` and `pythonw.exe`"*.
   Until that rule exists, scanners will report *Offline* while the
   dashboard works fine on the PC itself.
   Quick check from any other PC on the network: open
   `http://<server-IP>:8765/api/v1/ping` in a browser — you should see
   `{"ok":true,...}`.
6. Change the admin PIN in `config.json` (`adminPin`) before rollout.

Afterwards just use `start.bat` — no window opens; a yellow QR icon
appears in the system tray. Right-click it:

- **Open dashboard** (double-click does the same)
- **Copy server address**
- **Status…** — received / unique / devices online, in a message box
- **Quit server (admin PIN)** — asks for the admin PIN (`adminPin` in
  `config.json`). A wrong PIN leaves the server running. This is
  deliberate: the server holds the master count, and nobody should be
  able to close it mid-shift by accident while scanners are still pushing.

Starting it twice is harmless — the second start just shows "already
running". It uses well under 1% CPU when idle and only writes inside its
own folder; nothing else on the PC is affected.

To start automatically with Windows (no admin): press `Win+R`, type
`shell:startup`, and put a shortcut to `start.bat` in that folder.

## Linking a scanner

On the device, Scan screen → scan the QR on the dashboard (camera or
trigger). The app shows *DATA CENTER LINKED* and the cloud chip in the
header turns green. Alternatively Reports → *Data center* → type the
address (e.g. `192.168.1.20:8765`) → *Test connection* → *Save & link*.

Give each device a clear name in that sheet (e.g. `TC22-BAY-A`) — that's
what the dashboard shows.

## How data flows (no-loss guarantees)

- Each scan is saved on the device first, then pushed. A record is only
  marked **synced** on the device after this server ACKs it with a
  **receipt number** and **received-at** timestamp. Both are stored on the
  device and appear in both the device CSV and the server CSV, so the two
  can be reconciled line by line.
- Records are keyed by the device-generated scan ID. A device re-sending a
  scan (lost ACK, retry) **updates** the existing row — it can never create
  a second one.
- Pending records are retried automatically (new scan, heartbeat every
  15 s, app foreground, with backoff) and on demand via **Sync now**.
- SQLite runs in WAL mode; a power cut mid-write cannot corrupt the file.
- Edits to Phy. Qty / Remarks on the device are pushed the same way.
- Device **Clear all** never touches the server. **Start new stock take**
  on the dashboard (admin PIN) archives the current one — nothing is
  deleted, old stock takes stay exportable.

## Duplicates (refused at scan time)

From app v1.4.0 a duplicate is **refused on the device** before it is
recorded. While the device can reach this server it asks
`/api/v1/lpn-check` first, so a pallet already counted by *any* device is
refused with *REFUSED · ALREADY COUNTED BY TC22-A @ A01*; a pallet already
counted on the same device is refused locally. Every refusal is logged
and synced — see the *Duplicates refused* card, the per-device count and
the CSV's audit block. If the device was offline at the time, the scan is
accepted locally and flagged when its ACK arrives (*Flagged after sync*
tile). The rule mirrors the device's own: an LPN-only code is a duplicate
if the LPN exists at all; a Detailed code is a duplicate only against an
earlier Detailed scan.

## Bay targets

Set once on the dashboard — *Edit targets* opens an editor: type into the
table, or **upload a CSV** (`Bay,Target` per line, e.g. `A01,120`; header
row optional; *Template* downloads an example). Admin PIN required. Every linked device receives them on its next heartbeat and
shows progress exactly as before. While linked, the per-device target
editor is hidden — the server is the master.

### From a photo of the count sheet (OCR)

The physical count is usually written on paper first. Instead of typing it:

- **Dashboard:** *Edit targets* → **From photo** — drop a photo/scan of the
  sheet. It is read into the table; rows the reader was not sure about
  are **red** and must be corrected or removed before *Save* is allowed.
- **HHT:** *Reports → Bay progress → Photo count sheet → targets* — take the
  photo on the device; it is read on the server (falls back to the
  device's own reader if the server is unreachable), reviewed on the
  device, then applied with the admin PIN.
- **Print sheet** (in the editor) opens a printable template with the bays
  pre-printed and one box per digit — this reads most reliably. A neat
  handwritten `BAY  COUNT` list (e.g. `A01  120`) also works.

Every photo and what was read from it is kept under `data/sheets/` and
listed in the dashboard's **Count sheets** card for audit, with whether it
was applied. The reader is RapidOCR 3.x (`rapidocr` + `onnxruntime`, pip-only, Python 3.8–3.13 — no extra programs to
install and nothing for the antivirus to block). First read after start-up
takes a few seconds while the model loads.

## API (for anything else you want to integrate)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/ping` | reachability, server time, current stock take |
| POST | `/api/v1/scans` | `{deviceId, deviceName, appVersion, scans:[…]}` → receipts + `duplicateOf` + `bayTargets` |
| POST | `/api/v1/heartbeat` | device presence → `bayTargets` |
| GET | `/api/v1/stats`, `/devices`, `/scans?limit=`, `/stocktakes`, `/bay-targets` | dashboard data |
| PUT | `/api/v1/bay-targets` | `{pin, targets:{A01:120}, replace}` |
| POST | `/api/v1/count-sheet/ocr` | multipart `image` (+ deviceId/deviceName/user/warehouse) → `{sheetId, rows:[{bay,count,confidence,needsReview,raw}]}` |
| POST | `/api/v1/count-sheet/apply` | `{pin, sheetId, rows:[{bay,count}], replace}` → targets (audited) |
| GET | `/api/v1/count-sheets`, `/count-sheets/{id}/image?thumb=1` | audit list + stored photo |
| GET | `/print/count-sheet?bays=A01-A20,B01&warehouse=` | printable count-sheet template |
| POST | `/api/v1/admin/new-stocktake` | `{pin, name}` |
| GET | `/api/v1/export.csv?stocktake_id=` | CSV, oldest first, Excel-ready |
| GET | `/api/v1/events` | server-sent events (dashboard live feed) |

Set `"apiKey": "something"` in `config.json` to require an `x-api-key`
header from devices (then add `&key=something` when typing the address in
the app, or include it in the setup QR by regenerating it — the dashboard
QR includes the key automatically if set).

## Changelog

- **1.4.0** — **Count sheet from a photo.** New OCR endpoint
  (`countsheet.py`, RapidOCR) reads a photographed/scanned bay count sheet
  into `{bay, count}` rows with a *needs review* flag; dashboard *Edit
  targets* gets a **From photo** drop zone (red rows block saving until
  checked), a **Print sheet** template, and a **Count sheets** audit card
  (photo thumbnail, rows read, applied or not). HHT uploads through the
  same endpoint. New table `count_sheets`; photos under `data/sheets/`.
  Requirements add `rapidocr`, `onnxruntime`, `python-multipart`, `numpy`.

- **1.3.1** — proper **bay-targets editor** on the dashboard (replaces the
  browser prompt): editable table, **CSV upload** (`Bay,Target`, header
  optional, drag-and-drop or click — the same file format the HHT used),
  template download, admin PIN in the dialog, merge-by-bay on upload,
  duplicate-bay check, empty target = remove. Devices pick up changes on
  the next heartbeat.
- **1.3.0** — duplicates refused at scan time (pairs with app v1.4.0):
  `GET /api/v1/lpn-check?lpn=&qrType=` lets a device refuse a pallet
  already counted on ANY device before accepting it; refusals are stored
  (`dup_attempts`, idempotent, sent in `/scans` and `/heartbeat` bodies)
  and shown in a *Duplicates refused* card, a tile, per-device counts and
  a CSV block. Tiles re-labelled: Received · Unique LPNs · Duplicates
  refused · Flagged after sync (offline scans found duplicate on ACK).
- **1.2.3** — the "already running" message now says *what* holds the
  port: our own server (and reminds you the tray icon may be under the ^
  overflow arrow, then opens the dashboard) or another program (with its
  PID and name, and the advice to change `port` in `config.json`).
- **1.2.2** — antivirus-proof deployment: `make_portable.bat` builds a
  portable folder on the official python.org embeddable runtime (no
  PyInstaller exe). Exe build switched to one-folder form. PIN prompt has
  a PowerShell fallback for runtimes without tkinter.
- **1.2.1** — dashboard motion: panels expand/collapse smoothly (height
  transition) with the chevron rotating, cards fade and rise one after
  another on load, buttons squeeze on press, side panel slides. Honours
  the OS "reduce motion" setting. Rebuild the exe to pick it up.
- **1.2.0** — renamed to **AIS PhyStock**. New logo/icon set (stacked glass
  sheets inside scanner brackets with an amber scan line): tray icon, exe
  icon, dashboard favicon and header. Exe is now `AISPhyStockServer.exe`.
  CSV export filename prefix `AIS_PhyStock_`. API and data format are
  unchanged — v1.1.x devices keep working.
- **1.1.5** — Quit-PIN dialog didn't accept keyboard input (it was created
  on the tray's callback thread, which has no input loop on Windows). The
  dialog now runs on the main thread, is brought to the foreground and
  focused, centred, masked, Enter = confirm / Esc = cancel. Rebuild the
  exe to pick this up.
- **1.1.4** — dashboard layout: every panel collapses (click its title),
  **◫ Panel** hides the whole right column, **▤ Records only** collapses
  everything except the records table so it fills the screen (press
  again to restore the previous layout). Keyboard: `F` = records only,
  `S` = side panel. The layout is remembered per browser. The exe bundles
  the dashboard, so rebuild it (`build_exe.bat`) to pick this up.
- **1.1.3** — single-file **.exe build kit** (`build_exe.bat` +
  PyInstaller spec). When frozen, config/data/log live next to the exe and
  the dashboard files are bundled inside it.
- **1.1.2** — tray-only operation: `start.bat` launches with `pythonw`
  (no console window), all output goes to `data/server.log`, tray menu
  gains *Copy server address* and *Status…*, and **Quit requires the
  admin PIN**. Double-start shows an "already running" box instead of a
  crash.
- **1.1.1** — first-run fix: on some Python builds (seen on 3.14/Windows)
  the "current stock take" pointer was stored empty, and every API call
  then failed with `int() argument must be … not 'NoneType'`. The pointer
  is now self-healing (falls back to the newest stock take and repairs
  itself; creates the first stock take if none exists). Also moved to the
  FastAPI lifespan handler (removes the startup deprecation warning).
  **Upgrade**: replace `server.py` and `db.py` — your `data/` folder and
  `config.json` are kept and repaired automatically on next start.
- **1.1.0** — initial release.

## Troubleshooting

- *Scanner says Offline, dashboard works on the PC* → firewall rule (step 5).
- *Scanner says Offline, ping URL fails from another PC too* → wrong IP
  (the PC may have Wi-Fi and LAN; use the one on the warehouse network) or
  the PC went to sleep. Set the PC's power plan to never sleep.
- *"already running" but you see no window* → it IS running: `pythonw.exe`
  has no window and the tray icon is often under the **^** arrow next to
  the clock. Check with `netstat -ano | findstr :8765` and
  `tasklist | findstr /i python`. Quit it from the tray (PIN) or
  `taskkill /PID <pid> /F`.
- *"port taken by another program"* → change `port` in `config.json`.
- *Need the raw database* → `data/stocktake.sqlite3`; open with DB Browser
  for SQLite (portable version needs no admin).
