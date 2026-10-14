// Parses the raw string decoded from a scanned code into a structured
// record. Three categories observed on AIS pallet labels:
//
//  Slot1  — the big "@"-delimited QR:
//           PartNumber@ModelCode@WorkOrder@Quantity@PalletNo.LPN@Plant@MfgDate@PalletNo
//  Simple — the small QR: PalletNo.LPN  (e.g. "CN20082.P08266135317")
//  Other  — anything else (e.g. the white "TM BWL" Data Matrix label,
//           handwritten/other formats). We fall back to a universal LPN
//           regex so uniqueness checking still works even for formats we
//           haven't fully mapped yet.
//
// The LPN itself is always the letter P followed by 11 digits — this
// pattern is the one thing consistent across every label type seen so
// far, so it's the anchor we use regardless of category.

export const LPN_REGEX = /P\d{11}/;

// Splits a "PalletNo<delimiter>LPN" fragment (e.g. "CN20082.P08266135317",
// "VQ-52.P11254812358.") into its parts, capturing whatever punctuation
// actually separates them on that particular label — labels aren't
// consistent about using ".", "-", or a space, so the original character
// is preserved rather than assumed, and reused whenever Pallet No + LPN
// are shown back together in the UI or report.
//
// IMPORTANT: the "P + 11 digits" regex is used only to LOCATE where the
// LPN starts — the captured LPN itself is everything from that point to
// the end of the field, not just the tightly-matched regex portion. Real
// LPNs can carry trailing punctuation as part of their actual value (a
// confirmed example: "VQ-52.P11254812358." — LPN is "P11254812358.",
// trailing dot included). Truncating that would silently change the LPN
// rather than just parsing it, which is never acceptable — the LPN must
// come through whole, exactly as scanned, with nothing trimmed off.
function splitPalletAndLpn(str) {
  const match = str.match(LPN_REGEX);
  if (!match) return { palletNo: null, lpn: null, delimiter: '' };
  const before = str.slice(0, match.index);
  const delimMatch = before.match(/([^A-Za-z0-9]+)$/);
  const delimiter = delimMatch ? delimMatch[0] : '';
  const palletNo = (delimiter ? before.slice(0, before.length - delimiter.length) : before) || null;
  const lpn = str.slice(match.index); // whole remainder, not match[0]
  return { palletNo, lpn, delimiter };
}

export function parseCode(rawInput) {
  const raw = (rawInput || '').trim();
  const base = {
    raw,
    lpn: null,
    partNumber: null,
    modelCode: null,
    workOrder: null,
    quantity: null,
    palletNo: null,
    palletLpnDelimiter: '.',
    plant: null,
    mfgDate: null,
  };

  if (!raw) {
    return { ...base, qrType: 'Unrecognized' };
  }

  // --- Slot1: rich "@" delimited record ---
  if (raw.includes('@')) {
    const parts = raw.split('@').map((p) => p.trim());
    if (parts.length >= 5) {
      const [partNumber, modelCode, workOrder, quantity, palletLpn, plant, mfgDate, palletNoRepeat] = parts;
      const { palletNo, lpn, delimiter } = splitPalletAndLpn(palletLpn);
      return {
        ...base,
        qrType: 'Slot1',
        partNumber: partNumber || null,
        modelCode: modelCode || null,
        workOrder: workOrder || null,
        quantity: quantity || null,
        palletNo: palletNo || palletNoRepeat || null,
        palletLpnDelimiter: delimiter || '.',
        plant: plant || null,
        mfgDate: mfgDate || null,
        lpn: lpn || palletLpn || null,
      };
    }
  }

  // --- Simple: "PalletNo<delimiter>LPN" with no "@" ---
  if (!raw.includes('@')) {
    const { palletNo, lpn, delimiter } = splitPalletAndLpn(raw);
    if (palletNo && lpn) {
      return {
        ...base,
        qrType: 'Simple',
        palletNo,
        palletLpnDelimiter: delimiter || '.',
        lpn,
      };
    }
  }

  // --- Other: unknown format, extract LPN if present anywhere ---
  const anyMatch = raw.match(LPN_REGEX);
  if (anyMatch) {
    return {
      ...base,
      qrType: 'Other',
      lpn: anyMatch[0],
    };
  }

  // --- Unrecognized: no LPN pattern found at all ---
  return { ...base, qrType: 'Unrecognized' };
}

// Business segment + plant code, both packed into the same "Plant" field
// on the label (e.g. "OEM CHN", "Spares BWL", "Exports PAT"). Real labels
// vary in spacing/punctuation/case ("OEM-CHN", "oem chn", "OEMCHN" etc.),
// so this splits on any non-alphanumeric run and also tries stripping
// separators entirely and matching known tokens as prefixes/suffixes.
const SEGMENT_SYNONYMS = {
  OEM: 'OEM',
  OES: 'OES',
  SPARE: 'OES',
  SPARES: 'OES',
  AFM: 'AFM',
  EXP: 'EXP',
  EXPORT: 'EXP',
  EXPORTS: 'EXP',
  TM: 'TM', // Raw Material — a separate axis from OEM/OES/AFM/EXP, seen
            // on the white "TM BWL" style labels (e.g. "TM_BWL").
};
const KNOWN_PLANT_CODES = ['BWL', 'CHN', 'PAL', 'PAT', 'TAU'];

export function parsePlantField(rawPlant) {
  const raw = (rawPlant || '').trim().toUpperCase();
  // Two distinct "unknown" cases, kept separate rather than lumped into
  // one "OTHER" bucket: UNSPEC means there was no Plant field to read at
  // all (expected for Simple/LPN-only scans, which don't carry one) —
  // nothing to fix. UNKNOWN means there WAS text in the Plant field but
  // it didn't match any known segment word — a real data-quality signal
  // worth checking (a new label-batch wording that needs adding to
  // SEGMENT_SYNONYMS above).
  let segment = raw ? 'UNKNOWN' : 'UNSPEC';
  let plantCode = null;

  if (!raw) return { segment, plantCode };

  // Pass 1: split on any run of non-alphanumeric characters (handles
  // spaces, hyphens, slashes, commas, etc. uniformly).
  const tokens = raw.split(/[^A-Z0-9]+/).filter(Boolean);
  for (const tok of tokens) {
    if (SEGMENT_SYNONYMS[tok]) segment = SEGMENT_SYNONYMS[tok];
    else if (KNOWN_PLANT_CODES.includes(tok)) plantCode = tok;
  }
  if (segment !== 'UNKNOWN' && plantCode) return { segment, plantCode };

  // Pass 2: no separator at all (e.g. "OEMCHN") — try matching known
  // segment words and plant codes as prefix/suffix of the whole string.
  const flat = raw.replace(/[^A-Z0-9]/g, '');
  if (segment === 'UNKNOWN') {
    for (const word of Object.keys(SEGMENT_SYNONYMS)) {
      if (flat.startsWith(word) || flat.endsWith(word)) {
        segment = SEGMENT_SYNONYMS[word];
        break;
      }
    }
  }
  if (!plantCode) {
    for (const code of KNOWN_PLANT_CODES) {
      if (flat.includes(code)) {
        plantCode = code;
        break;
      }
    }
  }

  return { segment, plantCode };
}

export function classifySegment(record) {
  return parsePlantField(record.plant).segment;
}

export function formatFieldRows(record) {
  // Ordered rows for the "ticket" display, skipping empty fields.
  // Pallet No is intentionally excluded here — it's already folded into
  // the main LPN line above (as "PalletNo<delimiter>LPN") to match the
  // Dashboard and CSV report, so repeating it as its own row would be
  // redundant.
  const { plantCode } = parsePlantField(record.plant);
  const rows = [
    ['Part Number', record.partNumber],
    ['Model Code', record.modelCode],
    ['Work Order', record.workOrder],
    ['Quantity', record.quantity],
    ['Segment', record.segment],
    ['Plant Code', plantCode],
    ['Mfg Date', record.mfgDate],
  ];
  if (record.physQty !== undefined && record.physQty !== null && record.physQty !== '') {
    rows.splice(4, 0, ['Phy. Qty', record.physQty]);
  }
  if (record.remarks) {
    rows.push(['Remarks', record.remarks]);
  }
  if (record.stockNote) {
    rows.push(['Note', record.stockNote]);
  }
  return rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
}
