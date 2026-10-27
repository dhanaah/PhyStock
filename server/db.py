"""SQLite storage for AIS Stock Take Server.

One file, WAL mode (a power cut mid-write cannot corrupt the database),
all writes serialized through a single lock. Every scan row is keyed by
the client_id the device generated, so a device re-sending the same scan
(retry after a lost ACK) can never create a second row.
"""
import json
import sqlite3
import threading
import time
from pathlib import Path

import sys
_BASE = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
DB_PATH = _BASE / "data" / "stocktake.sqlite3"
_lock = threading.RLock()
_conn = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS stocktakes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT
);
CREATE TABLE IF NOT EXISTS scans (
  receipt       INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     TEXT NOT NULL UNIQUE,
  stocktake_id  INTEGER NOT NULL,
  device_id     TEXT NOT NULL,
  device_name   TEXT,
  user          TEXT,
  warehouse     TEXT,
  bay           TEXT,
  lpn           TEXT,
  pallet_no     TEXT,
  delimiter     TEXT,
  part_number   TEXT,
  model_code    TEXT,
  work_order    TEXT,
  quantity      TEXT,
  phys_qty      TEXT,
  remarks       TEXT,
  segment       TEXT,
  qr_type       TEXT,
  plant         TEXT,
  mfg_date      TEXT,
  raw           TEXT,
  is_duplicate  INTEGER DEFAULT 0,
  stock_note    TEXT,
  scanned_at    TEXT,
  received_at   TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  global_dup_of INTEGER,
  source_ip     TEXT
);
CREATE INDEX IF NOT EXISTS idx_scans_lpn ON scans(stocktake_id, lpn);
CREATE INDEX IF NOT EXISTS idx_scans_device ON scans(device_id);
CREATE TABLE IF NOT EXISTS devices (
  device_id    TEXT PRIMARY KEY,
  device_name  TEXT,
  user         TEXT,
  warehouse    TEXT,
  bay          TEXT,
  app_version  TEXT,
  total        INTEGER DEFAULT 0,
  pending      INTEGER DEFAULT 0,
  ip           TEXT,
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bay_targets (
  stocktake_id INTEGER NOT NULL,
  bay          TEXT NOT NULL,
  target       INTEGER NOT NULL,
  PRIMARY KEY (stocktake_id, bay)
);
CREATE TABLE IF NOT EXISTS dup_attempts (
  id           TEXT PRIMARY KEY,
  stocktake_id INTEGER NOT NULL,
  device_id    TEXT,
  device_name  TEXT,
  user         TEXT,
  warehouse    TEXT,
  bay          TEXT,
  lpn          TEXT,
  pallet_no    TEXT,
  qr_type      TEXT,
  kind         TEXT,
  other_device TEXT,
  other_bay    TEXT,
  raw          TEXT,
  at           TEXT,
  received_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dup_st ON dup_attempts(stocktake_id);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
"""

SCAN_FIELDS = [
    "client_id", "device_id", "device_name", "user", "warehouse", "bay", "lpn",
    "pallet_no", "delimiter", "part_number", "model_code", "work_order",
    "quantity", "phys_qty", "remarks", "segment", "qr_type", "plant",
    "mfg_date", "raw", "is_duplicate", "stock_note", "scanned_at",
]


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()) + f".{int((time.time() % 1) * 1000):03d}"


def connect():
    global _conn
    with _lock:
        if _conn is None:
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, isolation_level=None)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.execute("PRAGMA synchronous=NORMAL")
            _conn.executescript(SCHEMA)
            if current_stocktake_id() is None:
                start_new_stocktake("Stock take 1")
        return _conn


def current_stocktake_id():
    """Id of the active stock take. Self-healing: if the pointer row is
    missing or unreadable, fall back to the newest stock take (and repair
    the pointer); if there are no stock takes at all, return None so the
    caller creates one."""
    with _lock:
        row = _conn.execute("SELECT value FROM meta WHERE key='current_stocktake'").fetchone()
        try:
            if row is not None and row["value"] is not None and str(row["value"]).strip():
                return int(row["value"])
        except (TypeError, ValueError):
            pass
        latest = _conn.execute("SELECT MAX(id) AS id FROM stocktakes").fetchone()
        if latest is None or latest["id"] is None:
            return None
        _conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('current_stocktake', ?)", (str(latest["id"]),))
        return int(latest["id"])


def current_stocktake():
    c = connect()
    sid = _sid()
    row = c.execute("SELECT * FROM stocktakes WHERE id=?", (sid,)).fetchone()
    return dict(row) if row else None


def start_new_stocktake(name):
    with _lock:
        c = connect() if _conn is None else _conn
        sid = current_stocktake_id()
        if sid is not None:
            c.execute("UPDATE stocktakes SET ended_at=? WHERE id=? AND ended_at IS NULL", (now_iso(), sid))
        cur = c.execute("INSERT INTO stocktakes(name, started_at) VALUES (?, ?)", (name, now_iso()))
        new_id = cur.lastrowid
        if not new_id:
            new_id = c.execute("SELECT MAX(id) AS id FROM stocktakes").fetchone()["id"]
        c.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('current_stocktake', ?)", (str(new_id),))
        return int(new_id)


def list_stocktakes():
    c = connect()
    rows = c.execute("SELECT * FROM stocktakes ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------- scans

def _find_global_dup(c, sid, lpn, qr_type, client_id):
    """Mirror of the device's own duplicate rule, applied across devices.

    - LPN-only (Simple) code: duplicate if the LPN exists at all already.
    - Detailed (Slot1) code: duplicate only against an earlier Detailed scan
      (an LPN-only stock note never blocks the real count).
    Only rows from a *different* client_id count — a device re-sending its
    own record must not be told it duplicated itself.
    """
    if not lpn:
        return None
    if qr_type == "Slot1":
        row = c.execute(
            "SELECT receipt, device_name, user, bay, received_at FROM scans "
            "WHERE stocktake_id=? AND lpn=? AND qr_type='Slot1' AND client_id<>? "
            "ORDER BY receipt LIMIT 1", (sid, lpn, client_id)).fetchone()
    else:
        row = c.execute(
            "SELECT receipt, device_name, user, bay, received_at FROM scans "
            "WHERE stocktake_id=? AND lpn=? AND client_id<>? "
            "ORDER BY receipt LIMIT 1", (sid, lpn, client_id)).fetchone()
    return dict(row) if row else None


def upsert_scans(scans, source_ip=None):
    """Insert or update a batch. Returns one result per input scan:
    {clientId, receipt, receivedAt, status: 'inserted'|'updated', duplicateOf: {...}|None}
    """
    results = []
    with _lock:
        c = connect()
        sid = _sid()
        ts = now_iso()
        c.execute("BEGIN")
        try:
            for s in scans:
                cid = s.get("client_id")
                if not cid:
                    continue
                existing = c.execute("SELECT receipt, received_at, global_dup_of FROM scans WHERE client_id=?", (cid,)).fetchone()
                dup = _find_global_dup(c, sid, s.get("lpn"), s.get("qr_type"), cid)
                if existing:
                    # Edits (phys_qty / remarks) and re-sends land here.
                    c.execute(
                        "UPDATE scans SET phys_qty=?, remarks=?, updated_at=? WHERE client_id=?",
                        (s.get("phys_qty"), s.get("remarks"), ts, cid))
                    receipt = existing["receipt"]
                    received_at = existing["received_at"]
                    status = "updated"
                else:
                    cols = SCAN_FIELDS + ["stocktake_id", "received_at", "updated_at", "global_dup_of", "source_ip"]
                    vals = [s.get(f) for f in SCAN_FIELDS] + [sid, ts, ts, dup["receipt"] if dup else None, source_ip]
                    cur = c.execute(
                        f"INSERT INTO scans({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", vals)
                    receipt = cur.lastrowid
                    received_at = ts
                    status = "inserted"
                results.append({
                    "clientId": cid,
                    "receipt": receipt,
                    "receivedAt": received_at,
                    "status": status,
                    "duplicateOf": ({
                        "receipt": dup["receipt"], "deviceName": dup["device_name"],
                        "user": dup["user"], "bay": dup["bay"], "receivedAt": dup["received_at"],
                    } if dup else None),
                })
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise
    return results


def _sid():
    """Current stock take id, creating the first one if the DB is empty."""
    sid = current_stocktake_id()
    if sid is None:
        sid = start_new_stocktake("Stock take 1")
    return sid


def lpn_check(lpn, qr_type=None):
    """Pre-scan check used by devices to refuse a duplicate at scan time.
    Same rule as _find_global_dup but across ALL devices (including the
    asking one — a device that lost its own records must still be told)."""
    c = connect()
    sid = _sid()
    if not lpn:
        return None
    if qr_type == "Slot1":
        row = c.execute("SELECT receipt, device_name, user, bay, received_at FROM scans "
                        "WHERE stocktake_id=? AND lpn=? AND qr_type='Slot1' ORDER BY receipt LIMIT 1", (sid, lpn)).fetchone()
    else:
        row = c.execute("SELECT receipt, device_name, user, bay, received_at FROM scans "
                        "WHERE stocktake_id=? AND lpn=? ORDER BY receipt LIMIT 1", (sid, lpn)).fetchone()
    return dict(row) if row else None


def add_dup_attempts(items, device_id, device_name):
    """Idempotent audit of duplicate scans refused on devices."""
    ids = []
    with _lock:
        c = connect()
        sid = _sid()
        ts = now_iso()
        c.execute("BEGIN")
        for d in items:
            if not d.get("id"):
                continue
            c.execute("INSERT OR IGNORE INTO dup_attempts(id, stocktake_id, device_id, device_name, user, warehouse, bay, lpn, pallet_no, "
                      "qr_type, kind, other_device, other_bay, raw, at, received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (d["id"], sid, device_id, device_name, d.get("user"), d.get("warehouse"), d.get("bay"), d.get("lpn"),
                       d.get("palletNo"), d.get("qrType"), d.get("kind"), d.get("otherDevice"), d.get("otherBay"), d.get("raw"),
                       d.get("at"), ts))
            ids.append(d["id"])
        c.execute("COMMIT")
    return ids


def list_dup_attempts(limit=200, stocktake_id=None):
    c = connect()
    sid = stocktake_id or _sid()
    rows = c.execute("SELECT * FROM dup_attempts WHERE stocktake_id=? ORDER BY received_at DESC LIMIT ?", (sid, limit)).fetchall()
    return [dict(r) for r in rows]


def list_scans(limit=5000, stocktake_id=None):
    c = connect()
    sid = stocktake_id or _sid()
    rows = c.execute("SELECT * FROM scans WHERE stocktake_id=? ORDER BY receipt DESC LIMIT ?", (sid, limit)).fetchall()
    return [dict(r) for r in rows]


def stats(stocktake_id=None):
    c = connect()
    sid = stocktake_id or _sid()
    total = c.execute("SELECT COUNT(*) FROM scans WHERE stocktake_id=?", (sid,)).fetchone()[0]
    unique = c.execute("SELECT COUNT(DISTINCT lpn) FROM scans WHERE stocktake_id=? AND lpn IS NOT NULL", (sid,)).fetchone()[0]
    local_dups = c.execute("SELECT COUNT(*) FROM scans WHERE stocktake_id=? AND is_duplicate=1", (sid,)).fetchone()[0]
    global_dups = c.execute("SELECT COUNT(*) FROM scans WHERE stocktake_id=? AND global_dup_of IS NOT NULL AND is_duplicate=0", (sid,)).fetchone()[0]
    seg_rows = c.execute(
        "SELECT COALESCE(segment,'UNSPEC') AS seg, COUNT(*) AS n FROM scans "
        "WHERE stocktake_id=? AND is_duplicate=0 AND global_dup_of IS NULL GROUP BY seg", (sid,)).fetchall()
    by_segment = {"OEM": 0, "OES": 0, "AFM": 0, "EXP": 0, "TM": 0, "UNSPEC": 0, "UNKNOWN": 0}
    for r in seg_rows:
        by_segment[r["seg"]] = by_segment.get(r["seg"], 0) + r["n"]
    bay_rows = c.execute(
        "SELECT bay, COUNT(*) AS n FROM scans WHERE stocktake_id=? AND is_duplicate=0 AND global_dup_of IS NULL AND bay IS NOT NULL GROUP BY bay",
        (sid,)).fetchall()
    by_bay = {r["bay"]: r["n"] for r in bay_rows}
    targets = get_bay_targets(sid)
    bays = sorted(set(by_bay) | set(targets))
    progress = []
    for b in bays:
        t = targets.get(b)
        sc = by_bay.get(b, 0)
        progress.append({"bay": b, "target": t, "scanned": sc, "pending": (max(t - sc, 0) if t is not None else None)})
    dup_attempts = c.execute("SELECT COUNT(*) FROM dup_attempts WHERE stocktake_id=?", (sid,)).fetchone()[0]
    return {
        "total": total, "uniqueLpns": unique, "duplicates": local_dups, "duplicateAttempts": dup_attempts,
        "crossDeviceDuplicates": global_dups, "bySegment": by_segment,
        "byBay": by_bay, "bayProgress": progress,
    }


# ---------------------------------------------------------------- devices

def heartbeat(d, ip=None):
    with _lock:
        c = connect()
        ts = now_iso()
        c.execute(
            "INSERT INTO devices(device_id, device_name, user, warehouse, bay, app_version, total, pending, ip, first_seen, last_seen) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(device_id) DO UPDATE SET device_name=excluded.device_name, user=excluded.user, "
            "warehouse=excluded.warehouse, bay=excluded.bay, app_version=excluded.app_version, total=excluded.total, "
            "pending=excluded.pending, ip=excluded.ip, last_seen=excluded.last_seen",
            (d.get("device_id"), d.get("device_name"), d.get("user"), d.get("warehouse"), d.get("bay"),
             d.get("app_version"), d.get("total") or 0, d.get("pending") or 0, ip, ts, ts))


def list_devices(online_window_s=45):
    c = connect()
    sid = _sid()
    rows = c.execute("SELECT * FROM devices ORDER BY last_seen DESC").fetchall()
    out = []
    now = time.time()
    for r in rows:
        d = dict(r)
        try:
            last = time.mktime(time.strptime(d["last_seen"][:19], "%Y-%m-%dT%H:%M:%S"))
        except Exception:
            last = 0
        d["online"] = (now - last) <= online_window_s
        d["secondsSinceSeen"] = int(now - last)
        d["received"] = c.execute(
            "SELECT COUNT(*) FROM scans WHERE stocktake_id=? AND device_id=?", (sid, d["device_id"])).fetchone()[0]
        d["dupRejected"] = c.execute(
            "SELECT COUNT(*) FROM dup_attempts WHERE stocktake_id=? AND device_id=?", (sid, d["device_id"])).fetchone()[0]
        out.append(d)
    return out


# ---------------------------------------------------------------- bay targets

def get_bay_targets(stocktake_id=None):
    c = connect()
    sid = stocktake_id or _sid()
    rows = c.execute("SELECT bay, target FROM bay_targets WHERE stocktake_id=?", (sid,)).fetchall()
    return {r["bay"]: r["target"] for r in rows}


def set_bay_targets(targets, replace=False):
    with _lock:
        c = connect()
        sid = _sid()
        c.execute("BEGIN")
        if replace:
            c.execute("DELETE FROM bay_targets WHERE stocktake_id=?", (sid,))
        for bay, target in targets.items():
            if target is None or target == "":
                c.execute("DELETE FROM bay_targets WHERE stocktake_id=? AND bay=?", (sid, bay))
            else:
                c.execute("INSERT OR REPLACE INTO bay_targets(stocktake_id, bay, target) VALUES (?,?,?)", (sid, bay, int(target)))
        c.execute("COMMIT")
        return get_bay_targets(sid)
