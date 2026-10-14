import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as session from '../storage/storage';
import { parseCode, classifySegment } from '../utils/qrParser';
import * as Device from 'expo-device';

// Rugged Android scanner makers. On these, the built-in scan engine is the
// primary tool, so hardware mode is the default; anywhere else, camera.
// The operator can always switch; a choice, once made, is remembered.
const RUGGED_MAKERS = /zebra|symbol|motorola solutions|honeywell|urovo|datalogic|newland|cipherlab|chainway|point mobile|unitech|m3 mobile|seuic|idata|sunmi|keyence|denso|panasonic/i;
export function detectHardwareScanner() {
  const hay = `${Device.manufacturer || ''} ${Device.brand || ''} ${Device.modelName || ''}`;
  return RUGGED_MAKERS.test(hay);
}

const AppDataContext = createContext(null);

const KNOWN_SEGMENTS = new Set(['OEM', 'OES', 'AFM', 'EXP', 'TM']);

function formatDisplayTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function AppDataProvider({ children }) {
  const [userName, setUserName] = useState(null);
  const [bay, setBay] = useState(null);
  const [warehouse, setWarehouse] = useState(null);
  const [scans, setScansState] = useState([]);
  // Authoritative in-memory copy, always current even between renders, so
  // back-to-back scans each build on the latest array rather than on a
  // stale closure — and storage never has to be re-read to find it.
  const scansRef = useRef([]);
  const setScans = useCallback((next) => {
    scansRef.current = next;
    setScansState(next);
  }, []);
  const [scanMode, setScanModeState] = useState('camera');
  const [bayTargets, setBayTargetsState] = useState({});
  const [serverConfig, setServerConfigState] = useState({ url: '', deviceId: '', deviceName: '', apiKey: '' });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [sess, existingScans, mode, targets, server] = await Promise.all([
        session.getSession(), session.getScans(), session.getScanMode(), session.getBayTargets(),
        session.getServerConfig(),
      ]);
      setServerConfigState(server);
      if (sess) {
        setUserName(sess.userName);
        setBay(sess.bay);
        setWarehouse(sess.warehouse || null);
      }
      setScans(existingScans);
      setScanModeState(mode || (detectHardwareScanner() ? 'hardware' : 'camera'));
      setBayTargetsState(targets);
      setReady(true);
    })();
  }, []);

  const saveServerConfig = useCallback(async (cfg) => {
    const next = { ...serverConfig, ...cfg };
    setServerConfigState(next);
    await session.saveServerConfig(next);
    return next;
  }, [serverConfig]);

  // Server is the master for bay targets once a data center is linked —
  // whatever it sends on a heartbeat replaces the local set outright.
  const replaceBayTargets = useCallback((targets) => {
    setBayTargetsState((prev) => {
      const next = {};
      for (const [b, t] of Object.entries(targets || {})) next[b] = Number(t);
      const same = Object.keys(next).length === Object.keys(prev).length
        && Object.keys(next).every((k) => prev[k] === next[k]);
      if (same) return prev;
      session.saveBayTargets(next);
      return next;
    });
  }, []);

  const setScanMode = useCallback(async (mode) => {
    setScanModeState(mode);
    await session.saveScanMode(mode);
  }, []);

  const setBayTarget = useCallback(async (bayCode, targetCount) => {
    setBayTargetsState((prev) => {
      const next = { ...prev };
      if (targetCount === null || targetCount === undefined || targetCount === '') {
        delete next[bayCode];
      } else {
        next[bayCode] = Number(targetCount);
      }
      session.saveBayTargets(next);
      return next;
    });
  }, []);

  const importBayTargets = useCallback(async (entries) => {
    setBayTargetsState((prev) => {
      const next = { ...prev };
      for (const { bay: bayCode, target } of entries) {
        next[bayCode] = Number(target);
      }
      session.saveBayTargets(next);
      return next;
    });
  }, []);

  const startSession = useCallback(async (name, bayValue, warehouseValue) => {
    setUserName(name);
    setBay(bayValue);
    setWarehouse(warehouseValue);
    await session.saveSession({ userName: name, bay: bayValue, warehouse: warehouseValue });
  }, []);

  const changeBay = useCallback(async (bayValue) => {
    setBay(bayValue);
    await session.saveSession({ userName, bay: bayValue, warehouse });
  }, [userName, warehouse]);

  const changeWarehouse = useCallback(async (warehouseValue) => {
    setWarehouse(warehouseValue);
    await session.saveSession({ userName, bay, warehouse: warehouseValue });
  }, [userName, bay]);

  const endSession = useCallback(async () => {
    setUserName(null);
    setBay(null);
    setWarehouse(null);
    await session.clearSession();
  }, []);

  // LPN -> segment, sourced only from Detailed (Slot1) scans, which are
  // the only ones that actually carry a Plant field. Simple/LPN-only
  // scans have nothing to classify from directly, so they inherit the
  // segment of a matching Detailed scan when one exists in the dataset.
  const lpnSegmentMap = useMemo(() => {
    const map = new Map();
    for (const s of scans) {
      if (s.qrType === 'Slot1' && s.lpn && KNOWN_SEGMENTS.has(s.segment)) {
        map.set(s.lpn, s.segment);
      }
    }
    return map;
  }, [scans]);

  const recordScan = useCallback(async (rawValue) => {
    const parsed = parseCode(rawValue);
    const now = new Date();

    // Look up against the live array (not the memoized maps from the last
    // render) so two scans landing before React re-renders still see
    // each other — otherwise a rapid double-pull of the same label could
    // slip through as two "new" records.
    const live = scansRef.current;
    const seenBefore = (lpn) => live.some((s) => s.lpn === lpn);
    const seenDetailed = (lpn) => live.some((s) => s.lpn === lpn && s.qrType === 'Slot1');

    let isDuplicate = false;
    let stockNote = null;
    if (parsed.lpn) {
      if (parsed.qrType === 'Simple') {
        // LPN-only code — a stock/Oracle-pick style scan. Only a
        // duplicate if this LPN has already been seen at all (detailed
        // or simple); otherwise it's a legitimate first sighting, noted
        // as such rather than flagged.
        isDuplicate = seenBefore(parsed.lpn);
        if (!isDuplicate) stockNote = 'LPN Stock (Oracle Pick)';
      } else if (parsed.qrType === 'Slot1') {
        // Detailed code — only counts as a duplicate against another
        // Detailed scan of the same LPN. An earlier LPN-only "stock"
        // note for the same pallet doesn't block its real count.
        isDuplicate = seenDetailed(parsed.lpn);
      } else {
        isDuplicate = seenBefore(parsed.lpn);
      }
    }

    const ownSegment = classifySegment(parsed);
    const segment = KNOWN_SEGMENTS.has(ownSegment) ? ownSegment
      : (parsed.lpn && lpnSegmentMap.get(parsed.lpn)) || ownSegment;

    const scan = {
      id: `${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: now.toISOString(),
      timestampDisplay: formatDisplayTimestamp(now),
      user: userName,
      bay,
      warehouse,
      isDuplicate,
      stockNote,
      physQty: null,
      remarks: null,
      segment,
      ...parsed,
      // Data-center sync bookkeeping. Every record starts 'pending' even
      // when no server is linked yet — the moment one is, the whole
      // backlog goes up. Nothing is ever dropped.
      syncStatus: 'pending',
      syncReceipt: null,
      syncReceivedAt: null,
      globalDup: null,
    };
    // Update state first so the UI/beep respond immediately; the disk
    // write is queued behind it and serialized in storage.js.
    const next = [scan, ...scansRef.current];
    setScans(next);
    session.saveScans(next).catch(() => {});
    return scan;
  }, [userName, bay, warehouse, lpnSegmentMap, setScans]);

  const updateScanFields = useCallback(async (id, patch) => {
    try {
      // An edit to Phy. Qty / Remarks has to reach the server too.
      const withSync = ('physQty' in patch || 'remarks' in patch) ? { ...patch, syncStatus: 'pending' } : patch;
      const next = await session.updateScan(id, withSync, scansRef.current);
      setScans(next);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e };
    }
  }, []);

  // Batch-apply sync results (receipts, status, cross-device duplicate
  // info) to many records with ONE state update and ONE disk write.
  const applyScanPatches = useCallback(async (patchesById) => {
    const ids = Object.keys(patchesById);
    if (ids.length === 0) return;
    const next = scansRef.current.map((s) => (patchesById[s.id] ? { ...s, ...patchesById[s.id] } : s));
    setScans(next);
    await session.saveScans(next).catch(() => {});
  }, [setScans]);

  const addManyScans = useCallback(async (incoming) => {
    const { merged, addedCount } = await session.mergeScans(incoming, scansRef.current);
    setScans(merged);
    return addedCount;
  }, []);

  const wipeAllScans = useCallback(async () => {
    await session.clearScans();
    setScans([]);
  }, []);

  const stats = useMemo(() => {
    const total = scans.length;
    const uniqueLpns = new Set(scans.filter((s) => s.lpn).map((s) => s.lpn)).size;
    const duplicates = scans.filter((s) => s.isDuplicate).length;
    const byType = { Slot1: 0, Simple: 0, Other: 0, Unrecognized: 0 };
    const bySegment = { OEM: 0, OES: 0, AFM: 0, EXP: 0, TM: 0, UNSPEC: 0, UNKNOWN: 0 };
    const byBay = {};
    const byBayUnique = {};
    let pendingSync = 0;
    let crossDeviceDuplicates = 0;
    for (const s of scans) {
      if (s.syncStatus !== 'synced') pendingSync += 1;
      if (s.globalDup && !s.isDuplicate) crossDeviceDuplicates += 1;
      byType[s.qrType] = (byType[s.qrType] || 0) + 1;
      if (!s.isDuplicate) {
        const seg = s.segment || 'UNSPEC';
        bySegment[seg] = (bySegment[seg] || 0) + 1;
      }
      if (s.bay) {
        byBay[s.bay] = (byBay[s.bay] || 0) + 1;
        if (!s.isDuplicate) byBayUnique[s.bay] = (byBayUnique[s.bay] || 0) + 1;
      }
    }
    return { total, uniqueLpns, duplicates, byType, bySegment, byBay, byBayUnique, pendingSync, crossDeviceDuplicates };
  }, [scans]);

  // Admin-set expected count vs. actual (unique, non-duplicate) scans per
  // bay — surfaces as a "pending to scan" alert on the Scan screen and a
  // progress table on Dashboard/Reports.
  const bayProgress = useMemo(() => {
    const bays = new Set([...Object.keys(bayTargets), ...Object.keys(stats.byBayUnique)]);
    return Array.from(bays).sort().map((b) => {
      const target = bayTargets[b] ?? null;
      const scanned = stats.byBayUnique[b] || 0;
      const pending = target !== null ? Math.max(target - scanned, 0) : null;
      return { bay: b, target, scanned, pending };
    });
  }, [bayTargets, stats.byBayUnique]);

  const value = {
    ready,
    userName,
    bay,
    warehouse,
    scans,
    stats,
    scanMode,
    setScanMode,
    bayTargets,
    setBayTarget,
    importBayTargets,
    bayProgress,
    startSession,
    changeBay,
    changeWarehouse,
    endSession,
    recordScan,
    updateScanFields,
    addManyScans,
    wipeAllScans,
    serverConfig,
    saveServerConfig,
    replaceBayTargets,
    applyScanPatches,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
