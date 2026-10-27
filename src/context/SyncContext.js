import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AppState } from 'react-native';
import { useAppData } from './AppDataContext';
import { APP_VERSION, HEARTBEAT_SECONDS } from '../config';

// Data-center sync engine.
//
// Principles:
//  • Scanning never waits for the network. A scan is saved locally first;
//    the push happens afterwards and the operator never sees a delay.
//  • A record is only marked 'synced' once the server has ACKed it with a
//    receipt number. Anything else stays 'pending' and is retried —
//    automatically on every new scan, every heartbeat, on app foreground,
//    and on demand via the Sync button. Nothing is ever dropped.
//  • Re-sends are safe: the server keys records by the device-generated
//    scan id, so a lost ACK can never create a duplicate on the server.
//  • A heartbeat goes out every HEARTBEAT_SECONDS while a server is linked
//    and the app is in the foreground; its reply carries the server's bay
//    targets (server is the master once linked).

const SyncContext = createContext(null);

const REQUEST_TIMEOUT_MS = 6000;
const PUSH_DEBOUNCE_MS = 250;
const BATCH_SIZE = 100;
const RETRY_BACKOFF_MS = [3000, 8000, 20000, 45000];

function normalizeUrl(url) {
  let u = (url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '');
}

async function request(url, { method = 'GET', body, apiKey, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    if (!res.ok) {
      const detail = json?.detail || text || `HTTP ${res.status}`;
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function toServerScan(s) {
  return {
    id: s.id,
    lpn: s.lpn ?? null,
    palletNo: s.palletNo ?? null,
    palletLpnDelimiter: s.palletLpnDelimiter ?? null,
    partNumber: s.partNumber ?? null,
    modelCode: s.modelCode ?? null,
    workOrder: s.workOrder ?? null,
    quantity: s.quantity ?? null,
    physQty: s.physQty ?? null,
    remarks: s.remarks ?? null,
    segment: s.segment ?? null,
    qrType: s.qrType ?? null,
    plant: s.plant ?? s.rawPlant ?? null,
    mfgDate: s.mfgDate ?? null,
    raw: s.raw ?? null,
    isDuplicate: !!s.isDuplicate,
    stockNote: s.stockNote ?? null,
    user: s.user ?? null,
    warehouse: s.warehouse ?? null,
    bay: s.bay ?? null,
    timestamp: s.timestamp ?? null,
  };
}

export function SyncProvider({ children }) {
  const {
    ready, scans, stats, serverConfig, saveServerConfig, replaceBayTargets, applyScanPatches,
    dupAttempts, markDupAttemptsSynced, setRemoteDuplicateCheck,
    userName, bay, warehouse,
  } = useAppData();

  const [status, setStatus] = useState('off'); // 'off' | 'online' | 'offline' | 'syncing'
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);

  const scansRef = useRef(scans);
  scansRef.current = scans;
  const cfgRef = useRef(serverConfig);
  cfgRef.current = serverConfig;
  const sessionRef = useRef({ userName, bay, warehouse, total: stats.total, pending: stats.pendingSync });
  sessionRef.current = { userName, bay, warehouse, total: stats.total, pending: stats.pendingSync };

  const pushingRef = useRef(false);
  const pushTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const failCountRef = useRef(0);
  const dupListenersRef = useRef(new Set());

  const baseUrl = useMemo(() => normalizeUrl(serverConfig.url), [serverConfig.url]);
  const linked = !!baseUrl;

  const subscribeGlobalDup = useCallback((fn) => {
    dupListenersRef.current.add(fn);
    return () => dupListenersRef.current.delete(fn);
  }, []);

  const dupsRef = useRef(dupAttempts);
  dupsRef.current = dupAttempts;
  const statusRef = useRef(status);
  statusRef.current = status;

  const toServerDup = (d) => ({
    id: d.id, lpn: d.lpn ?? null, palletNo: d.palletNo ?? null, qrType: d.qrType ?? null, kind: d.kind ?? null,
    otherDevice: d.otherDevice ?? null, otherBay: d.otherBay ?? null, raw: d.raw ?? null,
    user: d.user ?? null, warehouse: d.warehouse ?? null, bay: d.bay ?? null, at: d.at ?? null,
  });
  const unsyncedDups = () => dupsRef.current.filter((d) => !d.synced).slice(0, 200).map(toServerDup);

  // Pre-scan duplicate check against the data center. Installed only while
  // linked AND currently online; a slow/failed answer (1.5 s) resolves to
  // null so scanning never blocks on the network — the record is accepted
  // locally and the later ACK flags it if it turns out to be a duplicate.
  useEffect(() => {
    if (!linked) { setRemoteDuplicateCheck(null); return undefined; }
    setRemoteDuplicateCheck(async (lpn, qrType) => {
      if (statusRef.current === 'offline' || statusRef.current === 'off') return null;
      const cfg = cfgRef.current;
      const url = normalizeUrl(cfg.url);
      try {
        return await request(`${url}/api/v1/lpn-check?lpn=${encodeURIComponent(lpn)}&qrType=${encodeURIComponent(qrType || '')}`,
          { apiKey: cfg.apiKey, timeoutMs: 1500 });
      } catch (e) {
        return null;
      }
    });
    return () => setRemoteDuplicateCheck(null);
  }, [linked, setRemoteDuplicateCheck]);

  const pendingList = useCallback(
    () => scansRef.current.filter((s) => s.syncStatus !== 'synced'),
    []
  );

  const pushNow = useCallback(async ({ manual = false } = {}) => {
    const cfg = cfgRef.current;
    const url = normalizeUrl(cfg.url);
    if (!url) {
      if (manual) setLastError('No data center linked yet.');
      return { ok: false, reason: 'unlinked' };
    }
    if (pushingRef.current) return { ok: false, reason: 'busy' };
    const pending = pendingList();
    if (pending.length === 0) {
      // Nothing to push — but unsynced duplicate refusals ride on the next
      // heartbeat (every 15 s); a manual Sync sends one now.
      if (manual) { setStatus('online'); setLastSyncAt(new Date()); heartbeat(); }
      return { ok: true, sent: 0 };
    }
    pushingRef.current = true;
    setStatus('syncing');
    let sent = 0;
    try {
      // Oldest first so receipts on the server follow scan order.
      const ordered = [...pending].reverse();
      for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
        const batch = ordered.slice(i, i + BATCH_SIZE);
        const resp = await request(`${url}/api/v1/scans`, {
          method: 'POST', apiKey: cfg.apiKey,
          body: {
            deviceId: cfg.deviceId, deviceName: cfg.deviceName, appVersion: APP_VERSION,
            scans: batch.map(toServerScan),
            dupAttempts: i === 0 ? unsyncedDups() : [],
          },
        });
        const patches = {};
        const dups = [];
        for (const r of resp.results || []) {
          const local = batch.find((b) => b.id === r.clientId);
          const globalDup = r.duplicateOf
            ? { receipt: r.duplicateOf.receipt, deviceName: r.duplicateOf.deviceName, user: r.duplicateOf.user, bay: r.duplicateOf.bay, receivedAt: r.duplicateOf.receivedAt }
            : null;
          patches[r.clientId] = {
            syncStatus: 'synced', syncReceipt: r.receipt, syncReceivedAt: r.receivedAt, globalDup,
          };
          // Only announce a cross-device duplicate the first time we learn
          // about it, and only for a real (non-local-duplicate) scan.
          if (globalDup && local && !local.globalDup && !local.isDuplicate) {
            dups.push({ clientId: r.clientId, lpn: local.lpn, ...globalDup });
          }
        }
        await applyScanPatches(patches);
        sent += Object.keys(patches).length;
        if (resp.bayTargets) replaceBayTargets(resp.bayTargets);
        if (resp.dupAttemptIds?.length) markDupAttemptsSynced(resp.dupAttemptIds);
        for (const d of dups) dupListenersRef.current.forEach((fn) => { try { fn(d); } catch (e) { /* ignore */ } });
      }
      failCountRef.current = 0;
      setLastError(null);
      setStatus('online');
      setLastSyncAt(new Date());
      return { ok: true, sent };
    } catch (e) {
      failCountRef.current += 1;
      setLastError(String(e?.message || e));
      setStatus('offline');
      // Automatic retry with backoff — the operator does nothing.
      const delay = RETRY_BACKOFF_MS[Math.min(failCountRef.current - 1, RETRY_BACKOFF_MS.length - 1)];
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => pushNow(), delay);
      return { ok: false, reason: 'error', error: e, sent };
    } finally {
      pushingRef.current = false;
    }
  }, [pendingList, applyScanPatches, replaceBayTargets, markDupAttemptsSynced]);

  const schedulePush = useCallback(() => {
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => pushNow(), PUSH_DEBOUNCE_MS);
  }, [pushNow]);

  // Push whenever something is pending (new scan, edit, re-link, backlog).
  useEffect(() => {
    if (!ready || !linked) return;
    if (stats.pendingSync > 0) schedulePush();
  }, [ready, linked, stats.pendingSync, scans, schedulePush]);

  const heartbeat = useCallback(async () => {
    const cfg = cfgRef.current;
    const url = normalizeUrl(cfg.url);
    if (!url) return;
    const sess = sessionRef.current;
    try {
      const resp = await request(`${url}/api/v1/heartbeat`, {
        method: 'POST', apiKey: cfg.apiKey, timeoutMs: 4000,
        body: {
          deviceId: cfg.deviceId, deviceName: cfg.deviceName, user: sess.userName, warehouse: sess.warehouse,
          bay: sess.bay, appVersion: APP_VERSION, total: sess.total, pending: sess.pending,
          dupAttempts: unsyncedDups(),
        },
      });
      if (resp?.bayTargets) replaceBayTargets(resp.bayTargets);
      if (resp?.dupAttemptIds?.length) markDupAttemptsSynced(resp.dupAttemptIds);
      if (resp?.stocktake) setServerInfo((prev) => ({ ...(prev || {}), stocktake: resp.stocktake }));
      setStatus((s) => (s === 'syncing' ? s : 'online'));
      setLastError(null);
      if (sess.pending > 0) pushNow();
    } catch (e) {
      setStatus((s) => (s === 'syncing' ? s : 'offline'));
      setLastError(String(e?.message || e));
    }
  }, [replaceBayTargets, pushNow, markDupAttemptsSynced]);

  // Heartbeat loop — only while linked and in the foreground.
  useEffect(() => {
    if (!ready || !linked) { setStatus('off'); return undefined; }
    let timer = null;
    let active = AppState.currentState === 'active';
    const tick = () => { if (active) heartbeat(); };
    tick();
    timer = setInterval(tick, HEARTBEAT_SECONDS * 1000);
    const sub = AppState.addEventListener('change', (st) => {
      const nowActive = st === 'active';
      if (nowActive && !active) { heartbeat(); pushNow(); }
      active = nowActive;
    });
    return () => { clearInterval(timer); sub.remove(); };
  }, [ready, linked, heartbeat, pushNow]);

  useEffect(() => () => {
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);

  const testConnection = useCallback(async (overrideUrl) => {
    const url = normalizeUrl(overrideUrl ?? cfgRef.current.url);
    if (!url) return { ok: false, error: 'Enter the data center address first.' };
    try {
      const info = await request(`${url}/api/v1/ping`, { apiKey: cfgRef.current.apiKey, timeoutMs: 4000 });
      if (!info?.ok) throw new Error('Unexpected reply — is that the AIS PhyStock Server?');
      setServerInfo(info);
      return { ok: true, info };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, []);

  // Link from a scanned setup QR: aisstocktake://server?url=http://10.0.0.5:8765
  const linkFromSetupCode = useCallback(async (raw) => {
    const m = /^aisstocktake:\/\/server\?(.*)$/i.exec((raw || '').trim());
    if (!m) return null;
    const params = {};
    for (const part of m[1].split('&')) {
      const [k, v] = part.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
    const url = normalizeUrl(params.url);
    if (!url) return null;
    await saveServerConfig({ url, ...(params.key ? { apiKey: params.key } : {}) });
    failCountRef.current = 0;
    return url;
  }, [saveServerConfig]);

  // ---- Count-sheet photo → bay targets (server OCR; the modal falls back to
  // on-device ML Kit when this throws or the device is not linked).
  const ocrCountSheet = useCallback(async (imageUri) => {
    const cfg = cfgRef.current; const sess = sessionRef.current;
    const url = normalizeUrl(cfg.url);
    if (!url) throw new Error('Not linked to a data center');
    const form = new FormData();
    form.append('image', { uri: imageUri, name: 'count_sheet.jpg', type: 'image/jpeg' });
    form.append('deviceId', cfg.deviceId || ''); form.append('deviceName', cfg.deviceName || '');
    form.append('user', sess?.userName || ''); form.append('warehouse', sess?.warehouse || ''); form.append('source', 'hht');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch(`${url}/api/v1/count-sheet/ocr`, {
        method: 'POST', body: form, signal: controller.signal,
        headers: cfg.apiKey ? { 'x-api-key': cfg.apiKey } : undefined,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.detail || `HTTP ${res.status}`);
      return json; // { sheetId, rows }
    } finally { clearTimeout(timer); }
  }, []);

  const applyCountSheet = useCallback(async ({ pin, sheetId, rows, engine, replace = false }) => {
    const cfg = cfgRef.current; const sess = sessionRef.current;
    const url = normalizeUrl(cfg.url);
    if (!url) throw new Error('Not linked to a data center');
    const json = await request(`${url}/api/v1/count-sheet/apply`, {
      method: 'POST', apiKey: cfg.apiKey, timeoutMs: 15000,
      body: { pin, sheetId: sheetId || null, rows, replace, engine: engine || 'server',
        deviceId: cfg.deviceId, deviceName: cfg.deviceName, user: sess?.userName, warehouse: sess?.warehouse },
    });
    if (json?.targets) replaceBayTargets(json.targets);
    return json;
  }, [replaceBayTargets]);

  const value = useMemo(() => ({
    linked, baseUrl, status, lastSyncAt, lastError, serverInfo,
    pendingCount: stats.pendingSync,
    pushNow, testConnection, linkFromSetupCode, subscribeGlobalDup, heartbeat, ocrCountSheet, applyCountSheet,
  }), [linked, baseUrl, status, lastSyncAt, lastError, serverInfo, stats.pendingSync, pushNow, testConnection, linkFromSetupCode, subscribeGlobalDup, heartbeat, ocrCountSheet, applyCountSheet]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used within SyncProvider');
  return ctx;
}

export const isSetupCode = (raw) => /^aisstocktake:\/\/server\?/i.test((raw || '').trim());
