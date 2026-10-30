// Count-sheet photo → rows of { bay, count, confidence, needsReview, raw }.
//
// Two engines produce the same shape:
//   • server  — POST the photo to the data center (RapidOCR); preferred.
//   • device  — ML Kit text recognition on the HHT (offline fallback).
// The row-building logic below mirrors countsheet.py on the server so both
// read a sheet the same way: cluster text lines into physical rows, take the
// leftmost bay-looking token as the bay and the rightmost number as the count.

const BAY_RE = /^([A-Z])[\s\-_.]?([0-9OIlSBZ]{2})$/;
const NUM_RE = /^[0-9OIlSBZ]{1,6}$/;
const DIGIT_FIX = { O: '0', o: '0', I: '1', l: '1', '|': '1', S: '5', B: '8', Z: '2', z: '2' };
const HEADER_WORDS = new Set(['BAY', 'COUNT', 'QTY', 'PHYSICAL', 'TARGET', 'PALLETS', 'TOTAL', 'SL', 'NO', 'S.NO']);

const normDigits = (s) => s.replace(/[OoIl|SBZz]/g, (c) => DIGIT_FIX[c] ?? c);

export function asBay(tok) {
  const t = String(tok || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = BAY_RE.exec(t);
  return m ? `${m[1]}${normDigits(m[2])}` : null;
}

export function asCount(tok) {
  const t = String(tok || '').trim().replace(/[\s,]/g, '');
  if (!NUM_RE.test(t)) return null;
  const n = Number(normDigits(t));
  return Number.isFinite(n) ? n : null;
}

/**
 * fragments: [{ text, x0, y0, x1, y1, score? }] in image pixels.
 * Returns rows in top-to-bottom order.
 */
export function extractRows(fragments) {
  const frags = fragments
    .filter((f) => f && f.text)
    .map((f) => ({ ...f, cy: (f.y0 + f.y1) / 2, h: Math.max(1, f.y1 - f.y0), score: f.score ?? 0.75 }));
  if (!frags.length) return [];
  const heights = frags.map((f) => f.h).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)] || 20;
  const tol = medH * 0.6;

  const rows = [];
  for (const f of [...frags].sort((a, b) => a.cy - b.cy)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.cy - f.cy) <= tol) {
      last.items.push(f);
      last.cy = (last.cy * (last.items.length - 1) + f.cy) / last.items.length;
    } else {
      rows.push({ cy: f.cy, items: [f] });
    }
  }

  const out = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x0 - b.x0);
    const texts = r.items.map((i) => i.text);
    const line = texts.join(' ');
    const words = line.toUpperCase().split(/\s+/);
    if (words.some((w) => HEADER_WORDS.has(w)) && !texts.some((t) => asBay(t))) continue;

    const tokens = [];
    for (const it of r.items) {
      const parts = it.text.split(/\s+/).filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        // "B 01" written with a gap → one bay token
        if (i + 1 < parts.length && /^[A-Z]$/i.test(parts[i]) && /^[0-9OIlSBZ]{2}$/.test(parts[i + 1])) {
          tokens.push({ text: parts[i] + parts[i + 1], score: it.score }); i++; continue;
        }
        tokens.push({ text: parts[i], score: it.score });
      }
    }
    let bay = null; let bayScore = 0; let count = null; let countScore = 0;
    let run = [];                                   // one digit per box → join into one number
    for (const t of tokens) {
      const b = asBay(t.text);
      if (b && bay === null) { bay = b; bayScore = t.score; run = []; continue; }
      const c = asCount(t.text);
      if (c !== null) {
        if (t.text.trim().length === 1 && bay !== null) {
          run.push(t);
          count = Number(normDigits(run.map((x) => x.text.trim()).join('')));
          countScore = Math.min(...run.map((x) => x.score));
        } else { run = []; count = c; countScore = t.score; } // rightmost number wins
      }
    }
    if (bay === null && count === null) continue;
    const conf = bay && count !== null ? Math.min(bayScore, countScore) : 0;
    out.push({
      bay, count, confidence: Math.round(conf * 100) / 100,
      needsReview: bay === null || count === null || conf < 0.6,
      raw: line,
    });
  }
  return out;
}

/** ML Kit result → fragments. Uses lines (not blocks) so "A01" and "120" in
 *  separate columns still land in one physical row. */
export function fragmentsFromMlKit(result) {
  const frags = [];
  for (const block of result?.blocks || []) {
    const lines = block.lines && block.lines.length ? block.lines : [block];
    for (const ln of lines) {
      const f = ln.frame || ln.boundingBox || block.frame;
      if (!f || !ln.text) continue;
      const left = f.left ?? f.x ?? 0; const top = f.top ?? f.y ?? 0;
      const width = f.width ?? ((f.right ?? left) - left); const height = f.height ?? ((f.bottom ?? top) - top);
      frags.push({ text: ln.text, x0: left, y0: top, x1: left + width, y1: top + height, score: 0.75 });
    }
  }
  return frags;
}

/** Validate reviewed rows before applying. Returns { ok, error, rows }. */
export function validateReviewedRows(rows) {
  const seen = new Set();
  const clean = [];
  for (const r of rows) {
    const bay = String(r.bay || '').trim().toUpperCase();
    if (!bay) continue;
    if (!/^[A-Z][0-9]{2}$/.test(bay)) return { ok: false, error: `"${bay}" is not a bay code (e.g. A01)` };
    if (seen.has(bay)) return { ok: false, error: `Bay ${bay} appears twice` };
    seen.add(bay);
    const c = r.count === '' || r.count === null || r.count === undefined ? null : Number(r.count);
    if (c !== null && (!Number.isInteger(c) || c < 0)) return { ok: false, error: `Count for ${bay} must be a whole number` };
    clean.push({ bay, count: c });
  }
  if (!clean.length) return { ok: false, error: 'No bay rows to apply' };
  return { ok: true, rows: clean };
}
