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
  // Fields are identified by CONTENT, not by position. The QR and the
  // Data Matrix printed on one label do not always list the fields in the
  // same order, and some labels omit a field entirely; a positional read
  // put quantities into the item-code column and vice-versa depending on
  // which code happened to decode first. Anchors:
  //   • LPN segment  — the one containing P + 11 digits (PalletNo.LPN)
  //   • Quantity     — the short pure number (≤6 digits) immediately
  //                    before the LPN segment; else the first such number
  //                    that is not the leading part number
  //   • Mfg date     — date-shaped segment (28-Nov-2025, 2025-11-28, …)
  //   • Plant/segment— segment carrying OEM/OES/AFM/EXP/TM or a plant code
  //                    (TM_BWL, OEM AAU, Spares CHN …)
  //   • Part number  — the first segment (never the LPN/date/plant)
  //   • Model code   — the next unassigned dotted/alphanumeric code
  //   • Work order   — the next unassigned long number (≥6 digits)
  // Anything left over is kept in extraFields so nothing is silently lost.
  const normalized = raw.replace(/[\x1D\x1E\x1F]/g, '@'); // GS1/DM separators
  if (normalized.includes('@')) {
    const parts = normalized.split('@').map((p) => p.trim());
    while (parts.length && parts[parts.length - 1] === '') parts.pop();
    if (parts.length >= 4) {
      const assigned = new Array(parts.length).fill(false);
      const take = (i) => { assigned[i] = true; return parts[i]; };
      const isDate = (t) => /^\d{1,2}[-/. ]?[A-Za-z]{3}[-/. ]?\d{2,4}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t) || /^\d{2}[-/]\d{2}[-/]\d{4}$/.test(t);
      const isQty = (t) => /^\d{1,6}$/.test(t);
      const isPlant = (t) => { const r = parsePlantField(t); return r.segment !== 'UNKNOWN' && r.segment !== 'UNSPEC' || !!r.plantCode; };

      const li = parts.findIndex((t) => LPN_REGEX.test(t));
      let palletNo = null, lpn = null, delimiter = '.';
      if (li !== -1) {
        const sp = splitPalletAndLpn(take(li));
        palletNo = sp.palletNo; lpn = sp.lpn; delimiter = sp.delimiter || '.';
      }

      let quantity = null;
      if (li > 0 && isQty(parts[li - 1]) && !assigned[li - 1]) quantity = take(li - 1);
      else {
        const qi = parts.findIndex((t, i) => i > 0 && !assigned[i] && isQty(t));
        if (qi !== -1) quantity = take(qi);
      }

      let mfgDate = null;
      const di = parts.findIndex((t, i) => !assigned[i] && isDate(t));
      if (di !== -1) mfgDate = take(di);

      let plant = null;
      if (li !== -1 && li + 1 < parts.length && !assigned[li + 1] && isPlant(parts[li + 1])) plant = take(li + 1);
      else {
        const pi = parts.findIndex((t, i) => !assigned[i] && i !== 0 && isPlant(t));
        if (pi !== -1) plant = take(pi);
      }

      let partNumber = null;
      if (!assigned[0] && parts[0]) partNumber = take(0);

      let modelCode = null;
      const mi = parts.findIndex((t, i) => !assigned[i] && t && !/^\d+$/.test(t) && t !== palletNo);
      if (mi !== -1) modelCode = take(mi);

      let workOrder = null;
      const wi = parts.findIndex((t, i) => !assigned[i] && /^\d{6,}$/.test(t));
      if (wi !== -1) workOrder = take(wi);

      // pallet number printed again at the end — same value, drop it
      parts.forEach((t, i) => { if (!assigned[i] && palletNo && t === palletNo) assigned[i] = true; });
      const extraFields = parts.filter((t, i) => !assigned[i] && t);

      return {
        ...base,
        qrType: 'Slot1',
        partNumber,
        modelCode,
        workOrder,
        quantity,
        palletNo,
        palletLpnDelimiter: delimiter,
        plant,
        mfgDate,
        lpn: lpn || null,
        extraFields: extraFields.length ? extraFields : undefined,
      };
    }
  }

  // --- Simple: "PalletNo<delimiter>LPN" with no "@" ---
  if (!normalized.includes('@')) {
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
  if (record.extraFields && record.extraFields.length) {
    rows.push(['Other', record.extraFields.join(' · ')]);
  }
  if (record.remarks) {
    rows.push(['Remarks', record.remarks]);
  }
  if (record.stockNote) {
    rows.push(['Note', record.stockNote]);
  }
  return rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
}
