// Expects a simple two-column CSV: Bay, Target (header row optional,
// detected automatically). Bay codes must match the Letter+2-digit format
// used everywhere else in the app (e.g. A01, X14).

function splitCsvLine(line) {
  return line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
}

export function parseBayTargetsCsv(text) {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const entries = [];
  const errors = [];

  if (lines.length === 0) {
    return { entries, errors: ['File is empty.'] };
  }

  let startIdx = 0;
  const firstCols = splitCsvLine(lines[0]);
  if (firstCols[0] && /bay/i.test(firstCols[0])) {
    startIdx = 1; // header row, skip it
  }

  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 2 || !cols[0]) {
      errors.push(`Line ${i + 1}: expected "Bay,Target" — got "${lines[i]}"`);
      continue;
    }
    const bay = cols[0].toUpperCase();
    if (!/^[A-Z]\d{2}$/.test(bay)) {
      errors.push(`Line ${i + 1}: "${cols[0]}" isn't a valid bay code (expected e.g. A01)`);
      continue;
    }
    const target = parseInt(cols[1], 10);
    if (!Number.isFinite(target) || target < 0) {
      errors.push(`Line ${i + 1}: "${cols[1]}" isn't a valid count for bay ${bay}`);
      continue;
    }
    entries.push({ bay, target });
  }

  return { entries, errors };
}

export function buildBayTargetsTemplateCsv() {
  return ['Bay,Target', 'A01,50', 'A02,40', 'B01,60'].join('\n');
}
