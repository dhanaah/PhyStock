// expo-file-system's default export moved to a new File/Directory API and
// deprecated the old string-based methods. The "legacy" subpath keeps the
// simple writeAsStringAsync/readAsStringAsync API we use here working.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Matches the same "PalletNo<delimiter>LPN" reconstruction used on the
// Dashboard, so the LPN column in the report reads identically to what's
// shown on screen — same original punctuation, not a generic separator.
function combinedLpn(s) {
  if (s.palletNo && s.lpn) {
    return `${s.palletNo}${s.palletLpnDelimiter || '.'}${s.lpn}`;
  }
  return s.lpn || '';
}

// The report format the team asked for: Timestamp, User, Bay, LPN,
// Part Number, Qty, QR Type — plus a few extra columns that don't hurt and
// help trace back a record if something looks wrong.
const REPORT_COLUMNS = [
  ['timestampDisplay', 'Timestamp'],
  ['user', 'User'],
  ['warehouse', 'Warehouse'],
  ['bay', 'Bay'],
  ['lpn', 'LPN'],
  ['partNumber', 'Part Number'],
  ['quantity', 'Qty'],
  ['physQty', 'Phy. Qty'],
  ['segment', 'Segment'],
  ['qrType', 'QR Type'],
  ['stockNote', 'Note'],
  ['remarks', 'Remarks'],
  ['palletNo', 'Pallet No'],
  ['modelCode', 'Model Code'],
  ['syncReceipt', 'Server Receipt No'],
  ['syncReceivedAt', 'Received At (server)'],
  ['syncStatus', 'Sync Status'],
  ['globalDupText', 'Already Scanned By'],
  ['id', 'Record ID'],
  ['raw', 'Raw Scan'],
];

export function buildReportCsv(scans, bayProgress) {
  const header = REPORT_COLUMNS.map(([, label]) => csvEscape(label)).join(',');
  const rows = scans.map((s) =>
    REPORT_COLUMNS.map(([key]) => csvEscape(
      key === 'lpn' ? combinedLpn(s)
        : key === 'globalDupText' ? (s.globalDup ? `${s.globalDup.deviceName || ''} ${s.globalDup.bay ? '@ ' + s.globalDup.bay : ''} (#${s.globalDup.receipt})`.trim() : '')
        : s[key]
    )).join(',')
  );
  const lines = [header, ...rows];

  // Append a bay-progress summary block, if any admin targets are set —
  // keeps the physical-count vs. scanned picture inside the same file
  // the team already receives, rather than a separate report.
  const withTargets = (bayProgress || []).filter((p) => p.target !== null);
  if (withTargets.length > 0) {
    lines.push('');
    lines.push('BAY PROGRESS SUMMARY');
    lines.push(['Bay', 'Scanned', 'Target', 'Pending'].map(csvEscape).join(','));
    for (const p of withTargets) {
      lines.push([p.bay, p.scanned, p.target, p.pending].map(csvEscape).join(','));
    }
  }
  return lines.join('\n');
}

function timestampSlug() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// The team-facing report exports unique data only — duplicate-flagged
// scans are excluded so the file reflects a clean count. The full history
// (including duplicates) stays available via the JSON backup for audit
// or merge purposes.
export async function exportAndShareCsv(scans, bayLabel, bayProgress) {
  const uniqueScans = scans.filter((s) => !s.isDuplicate);
  const csv = buildReportCsv(uniqueScans, bayProgress);
  const fileName = `PhyStock_${bayLabel || 'All'}_${timestampSlug()}.csv`.replace(/\s+/g, '_');
  const fileUri = FileSystem.documentDirectory + fileName;
  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Send stock-take report' });
  }
  return { fileUri, exportedCount: uniqueScans.length, skippedCount: scans.length - uniqueScans.length };
}

export async function exportAndShareBackupJson(scans) {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), scans }, null, 2);
  const fileName = `PhyStock_Backup_${timestampSlug()}.json`;
  const fileUri = FileSystem.documentDirectory + fileName;
  await FileSystem.writeAsStringAsync(fileUri, payload, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: 'Share backup for merging' });
  }
  return fileUri;
}

export async function readBackupJson(fileUri) {
  const content = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.UTF8 });
  const parsed = JSON.parse(content);
  if (!parsed || !Array.isArray(parsed.scans)) {
    throw new Error('This file does not look like a PhyStock backup.');
  }
  return parsed.scans;
}
