import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  SCANS: 'ais_stocktake_scans_v1',
  SESSION: 'ais_stocktake_session_v1',
  SCAN_MODE: 'ais_stocktake_scan_mode_v1',
  BAY_TARGETS: 'ais_stocktake_bay_targets_v1',
  SERVER: 'ais_stocktake_server_v1',
};

// --- Data-center (server) link: url + this device's identity ---

export async function getServerConfig() {
  const raw = await AsyncStorage.getItem(KEYS.SERVER);
  const cfg = raw ? JSON.parse(raw) : {};
  if (!cfg.deviceId) {
    // Stable per-install identity; survives app restarts, regenerated only
    // on reinstall. The server keys devices by it.
    cfg.deviceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    cfg.deviceName = cfg.deviceName || `Scanner-${cfg.deviceId.slice(-4).toUpperCase()}`;
    await AsyncStorage.setItem(KEYS.SERVER, JSON.stringify(cfg));
  }
  return { url: cfg.url || '', deviceId: cfg.deviceId, deviceName: cfg.deviceName || '', apiKey: cfg.apiKey || '' };
}

export async function saveServerConfig(cfg) {
  await AsyncStorage.setItem(KEYS.SERVER, JSON.stringify(cfg));
}

// --- Bay targets (admin-set expected physical count per bay) ---

export async function getBayTargets() {
  const raw = await AsyncStorage.getItem(KEYS.BAY_TARGETS);
  return raw ? JSON.parse(raw) : {};
}

export async function saveBayTargets(targets) {
  await AsyncStorage.setItem(KEYS.BAY_TARGETS, JSON.stringify(targets));
}

// --- Scan mode ('camera' | 'hardware') ---

// null = the operator has never chosen; the context then picks a default
// from the device type (rugged scanner → hardware, phone → camera).
export async function getScanMode() {
  const raw = await AsyncStorage.getItem(KEYS.SCAN_MODE);
  return raw === 'camera' || raw === 'hardware' ? raw : null;
}

export async function saveScanMode(mode) {
  await AsyncStorage.setItem(KEYS.SCAN_MODE, mode);
}

// --- Session (user name + bay) ---

export async function getSession() {
  const raw = await AsyncStorage.getItem(KEYS.SESSION);
  return raw ? JSON.parse(raw) : null;
}

export async function saveSession(session) {
  await AsyncStorage.setItem(KEYS.SESSION, JSON.stringify(session));
}

export async function clearSession() {
  await AsyncStorage.removeItem(KEYS.SESSION);
}

// --- Scans ---

export async function getScans() {
  const raw = await AsyncStorage.getItem(KEYS.SCANS);
  return raw ? JSON.parse(raw) : [];
}

// All scan writes go through one serialized queue. Scans can arrive
// faster than AsyncStorage can commit (a hardware scanner fired twice in
// quick succession, or a camera decoding several codes in one frame),
// and two overlapping setItem calls for the same key can land out of
// order — the older array winning and silently dropping a scan. Chaining
// every write behind the previous one guarantees last-write-wins is
// also newest-data-wins.
let writeChain = Promise.resolve();

export function saveScans(scans) {
  const payload = JSON.stringify(scans);
  const run = () => AsyncStorage.setItem(KEYS.SCANS, payload);
  writeChain = writeChain.then(run, run);
  return writeChain;
}

// The context keeps the authoritative in-memory array and passes it in,
// so these no longer re-read + re-parse the entire dataset from disk on
// every single scan (which scaled linearly with the size of the stock
// take — thousands of records meant tens of milliseconds of JSON work
// per trigger pull, on the JS thread, between the pull and the beep).

export async function addScan(scan, current) {
  const next = [scan, ...current];
  await saveScans(next);
  return next;
}

export async function mergeScans(incomingScans, current) {
  const existingIds = new Set(current.map((s) => s.id));
  const toAdd = incomingScans.filter((s) => !existingIds.has(s.id));
  const merged = [...toAdd, ...current];
  await saveScans(merged);
  return { merged, addedCount: toAdd.length };
}

export async function updateScan(id, patch, current) {
  if (!id) throw new Error('updateScan called without an id');
  const exists = current.some((s) => s.id === id);
  if (!exists) throw new Error('No stored scan matches that record — it may have been cleared.');
  const next = current.map((s) => (s.id === id ? { ...s, ...patch } : s));
  await saveScans(next);
  return next;
}

export function clearScans() {
  const run = () => AsyncStorage.removeItem(KEYS.SCANS);
  writeChain = writeChain.then(run, run);
  return writeChain;
}
