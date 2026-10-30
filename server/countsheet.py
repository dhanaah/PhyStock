"""Bay count-sheet photo → table of (bay, count).

Uses RapidOCR (ONNX, pip-only — no executables, so nothing for the
antivirus to object to). Works for both the printed template (bay codes
pre-printed, digit boxes) and free-form handwritten "Bay | Count" sheets.

Pipeline:
  1. load image, fix EXIF orientation, downscale very large photos
  2. OCR → text fragments with boxes and confidence
  3. cluster fragments into physical rows by vertical centre
  4. in each row: the leftmost bay-looking token = bay, the rightmost
     number = count; common OCR confusions in the digit part are
     normalised (O→0, I/l→1, S→5, B→8, Z→2)
  5. return rows with a confidence and a `needsReview` flag so the HHT /
     dashboard can highlight doubtful cells

Nothing here writes targets — the caller shows the table for review and
only then saves it through the normal bay-targets path.
"""
import io
import re
import logging
from pathlib import Path

from PIL import Image, ImageOps

_ocr = None


def _engine():
    """rapidocr (3.x, Python 3.8-3.13) preferred; rapidocr-onnxruntime (1.x,
    Python <=3.12) as fallback. Both are pure pip wheels + ONNX models."""
    global _ocr
    if _ocr is None:
        import logging
        logging.getLogger("RapidOCR").setLevel(logging.WARNING)
        try:
            from rapidocr import RapidOCR
        except ImportError:
            from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    return _ocr


def _run_ocr(arr):
    """Normalise both engines' outputs to [(box, text, score), ...]."""
    eng = _engine()
    try: out = eng(arr, use_det=True, use_cls=True, use_rec=True)   # explicit: a rec-only call (box reading) must not stick
    except TypeError: out = eng(arr)
    if isinstance(out, tuple):            # rapidocr-onnxruntime: (result, elapse)
        res = out[0] or []
        return [(box, txt, float(score)) for box, txt, score in res]
    boxes = getattr(out, "boxes", None)   # rapidocr 3.x: RapidOCROutput
    if boxes is None:
        return []
    return [(box.tolist() if hasattr(box, "tolist") else box, txt, float(score))
            for box, txt, score in zip(boxes, out.txts, out.scores)]


BAY_RE = re.compile(r"^([A-Z])[\s\-_.]?([0-9OIlSBZ]{2})$")
NUM_RE = re.compile(r"^[0-9OIlSBZ]{1,6}$")
DIGIT_FIX = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "|": "1", "S": "5", "B": "8", "Z": "2", "z": "2"})
HEADER_WORDS = {"BAY", "COUNT", "QTY", "PHYSICAL", "TARGET", "PALLETS", "TOTAL", "SL", "NO", "S.NO"}


def _norm_digits(s):
    return s.translate(DIGIT_FIX)


def _as_bay(tok):
    t = tok.strip().upper().replace(" ", "")
    m = BAY_RE.match(t)
    if not m:
        return None
    return f"{m.group(1)}{_norm_digits(m.group(2))}"


def _as_count(tok):
    t = tok.strip().replace(" ", "").replace(",", "")
    if not NUM_RE.match(t):
        return None
    try:
        return int(_norm_digits(t))
    except ValueError:
        return None


def load_image(data: bytes, max_side=2200) -> Image.Image:
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im).convert("RGB")
    w, h = im.size
    if max(w, h) > max_side:
        s = max_side / max(w, h)
        im = im.resize((int(w * s), int(h * s)), Image.LANCZOS)
    return im


def ocr_fragments(im: Image.Image):
    import numpy as np
    arr = np.array(im)
    frags = []
    for box, text, score in _run_ocr(arr):
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        frags.append({
            "text": text.strip(), "score": float(score),
            "x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": max(ys),
            "cy": (min(ys) + max(ys)) / 2, "h": max(ys) - min(ys),
        })
    return frags


def group_rows(frags):
    """Cluster fragments whose vertical centres are within ~0.6 of the
    median fragment height. Handles slightly tilted photos because rows
    are matched by centre, not by exact y."""
    if not frags:
        return []
    heights = sorted(f["h"] for f in frags)
    med_h = heights[len(heights) // 2] or 20
    tol = med_h * 0.6
    rows = []
    for f in sorted(frags, key=lambda f: f["cy"]):
        if rows and abs(rows[-1]["cy"] - f["cy"]) <= tol:
            rows[-1]["items"].append(f)
            n = len(rows[-1]["items"])
            rows[-1]["cy"] = (rows[-1]["cy"] * (n - 1) + f["cy"]) / n
        else:
            rows.append({"cy": f["cy"], "items": [f]})
    for r in rows:
        r["items"].sort(key=lambda f: f["x0"])
    return rows


def extract_rows(frags):
    out = []
    for r in group_rows(frags):
        items = r["items"]
        texts = [i["text"] for i in items]
        line = " ".join(texts)
        up = line.upper()
        # skip headers / titles
        if any(w in up.split() for w in HEADER_WORDS) and not any(_as_bay(t) for t in texts):
            continue
        # tokens may be glued ("A01 120") — split on whitespace too
        tokens = []
        for it in items:
            parts = [t for t in re.split(r"\s+", it["text"]) if t]
            i = 0
            while i < len(parts):
                # "B 01" written with a gap -> one bay token
                if i + 1 < len(parts) and re.match(r"^[A-Za-z]$", parts[i]) and re.match(r"^[0-9OIlSBZ]{2}$", parts[i + 1]):
                    tokens.append({"text": parts[i] + parts[i + 1], "score": it["score"], "x0": it["x0"]})
                    i += 2
                    continue
                tokens.append({"text": parts[i], "score": it["score"], "x0": it["x0"]})
                i += 1
        bay = None; bay_score = 0.0
        count = None; count_score = 0.0
        digit_run = []                                   # single characters written one per box → one number
        for t in tokens:
            b = _as_bay(t["text"])
            if b and bay is None:
                bay, bay_score = b, t["score"]; digit_run = []
                continue
            c = _as_count(t["text"])
            if c is not None:
                if len(t["text"].strip()) == 1 and bay is not None:
                    digit_run.append((t["text"].strip(), t["score"]))
                    count = int(_norm_digits("".join(d for d, _ in digit_run)))
                    count_score = min(sc for _, sc in digit_run)
                else:
                    digit_run = []
                    count, count_score = c, t["score"]  # rightmost number wins
        if bay is None and count is None:
            continue
        conf = min(bay_score or 0.0, count_score or 0.0) if (bay and count is not None) else 0.0
        out.append({
            "bay": bay, "count": count, "confidence": round(conf, 2),
            "needsReview": bay is None or count is None or conf < 0.6,
            "raw": line,
        })
    return out


# ---------------------------------------------------------------- printed template: one digit per box
# The dashboard's "Print sheet" template has, per bay row, a strip of square boxes with one digit each.
# A general text detector misses most isolated handwritten digits inside small boxes, so for those
# sheets we find the boxes geometrically and read each box on its own with the recogniser.

BOX_FIX = {"O": "0", "o": "0", "Q": "0", "D": "0", "C": "0", "c": "0", "U": "0", "I": "1", "l": "1", "|": "1", "S": "5", "s": "5",
           "B": "8", "Z": "2", "z": "2", "g": "9", "q": "9", "G": "6", "b": "6", "T": "7", "A": "4"}


def _find_cells(gray):
    """Rectangular cells of a ruled table (any aspect) → rows [{cy, h, cells:[(x,y,w,h)]}], left→right.
    Works for the printed template (digit boxes are small square cells) and for any hand-drawn table."""
    import cv2
    H, W = gray.shape
    th = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 12)
    cnts, _ = cv2.findContours(th, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    cells = []
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        if w < 22 or h < 18 or w > W * 0.6 or h > H * 0.25: continue        # too small / the whole table
        if not 0.25 < w / h < 12: continue
        if cv2.contourArea(c) < 0.6 * w * h: continue                        # not a filled rectangle outline
        if any(abs(x - d[0]) < 8 and abs(y - d[1]) < 8 and abs(w - d[2]) < 16 for d in cells): continue
        cells.append((x, y, w, h))
    if len(cells) < 2: return []
    hs = sorted(h for *_, h in cells); medh = hs[len(hs) // 2]
    cells.sort(key=lambda b: b[1] + b[3] / 2)
    rows = []
    for b in cells:
        cy = b[1] + b[3] / 2
        if rows and abs(rows[-1]["cy"] - cy) < medh * 0.45:
            rows[-1]["cells"].append(b); rows[-1]["cy"] = sum(q[1] + q[3] / 2 for q in rows[-1]["cells"]) / len(rows[-1]["cells"])
        else:
            rows.append({"cy": cy, "cells": [b]})
    out = []
    for r in rows:
        cs = sorted(r["cells"], key=lambda b: b[0])
        def inside(a, b):   # a lies inside b (with a little slack)
            return a[0] >= b[0] - 4 and a[1] >= b[1] - 4 and a[0] + a[2] <= b[0] + b[2] + 4 and a[1] + a[3] <= b[1] + b[3] + 4
        def is_sq(c): return 0.7 < c[2] / c[3] < 1.4
        # a frame holding >= 3 similar squares is the template's count cell: keep the digit boxes, drop the frame
        frames = [c for c in cs if sum(1 for o in cs if o is not c and inside(o, c) and is_sq(o) and o[3] >= 0.5 * c[3]) >= 3]
        cs = [c for c in cs if c not in frames]
        # a closed handwritten shape ("0", "8", "6") inside a cell is not a cell: drop the small inner rectangle
        cs = [c for c in cs if not any(o is not c and inside(c, o) and c[2] * c[3] < 0.5 * o[2] * o[3] for o in cs)]
        # a rectangle that merely wraps a cell of similar height is a merged outer frame: drop the outer one
        cs = [c for c in cs if not any(o is not c and inside(o, c) and o[3] >= 0.6 * c[3] for o in cs)]
        if len(cs) >= 2: out.append({"cy": r["cy"], "h": medh, "cells": cs})
    return out


def _read_cell(gray, box):
    """One cell → (text, score, ink_ratio). Empty cell → ('', 1.0, ink)."""
    import cv2
    import numpy as np
    x, y, w, h = box; mx = max(3, int(w * 0.08)); my = max(3, int(h * 0.12))
    crop = gray[y + my:y + h - my, x + mx:x + w - mx]
    if crop.size == 0: return "", 0.0, 0.0
    t = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    ink = float((t > 0).mean())
    if ink < 0.012: return "", 1.0, ink
    scale = max(1.0, min(3.0, 48.0 / max(1, crop.shape[0])))
    pad = cv2.copyMakeBorder(crop, 10, 10, 18, 18, cv2.BORDER_CONSTANT, value=int(np.median(crop)))
    pad = cv2.resize(pad, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    return _rec_line(cv2.cvtColor(pad, cv2.COLOR_GRAY2RGB)) + (ink,)


def _rec_line(rgb):
    """Recognise one already-cropped text line → (text, score)."""
    eng = _engine()
    try:
        out = eng(rgb, use_det=False, use_cls=False)            # rapidocr 3.x
        txt = (out.txts[0] if out.txts else "") or ""
        sc = float(out.scores[0]) if out.scores else 0.0
    except TypeError:                                           # rapidocr-onnxruntime 1.x
        res, _ = eng(rgb, use_det=False, use_cls=False)
        txt, sc = (res[0][0], float(res[0][1])) if res else ("", 0.0)
    return txt.strip(), sc


def _fix_digits(txt):
    """Number text → digits: common letter look-alikes fixed, separators / stray dots dropped."""
    t = re.sub(r"[\s,.\-_'`·:;]", "", txt or "")
    return "".join(BOX_FIX.get(ch, ch) for ch in t)


def _row_from_cells(gray, cells):
    """One table row → {bay, count, confidence, needsReview, raw} or None (header / no bay in the row)."""
    reads = [(_read_cell(gray, c), c) for c in cells]
    bay_i = next((i for i, ((txt, sc, ink), c) in enumerate(reads) if _as_bay(txt)), None)
    if bay_i is None: return None
    bay = _as_bay(reads[bay_i][0][0])
    bscore = reads[bay_i][0][1]
    right = [(r, c) for r, c in reads[bay_i + 1:]]
    if not right: return {"bay": bay, "count": None, "confidence": 0.0, "needsReview": True, "raw": bay}
    # one digit per box?  → ≥3 near-square cells of similar size directly after the bay cell
    sq = []
    for r, c in right:
        if 0.7 < c[2] / c[3] < 1.4 and (not sq or abs(c[2] - sq[-1][1][2]) < sq[-1][1][2] * 0.3): sq.append((r, c))
        else: break
    raw, digits, scores, bad = [], [], [], False
    if len(sq) >= 3:
        for (txt, sc, ink), c in sq:
            if txt == "":
                raw.append("[ ]")
                if digits: bad = True                           # a gap between digits → unclear
                continue
            d = _fix_digits(txt); raw.append(f"[{txt}]")
            if not (d.isascii() and d.isdigit()): bad = True; continue
            digits.append(d); scores.append(sc)
        count = int("".join(digits)) if digits else None
    else:
        count = None
        for (txt, sc, ink), c in right:                          # first cell to the right that holds a number
            if txt == "": raw.append("[ ]"); continue
            d = _fix_digits(txt)
            d2, sc2 = _read_digits_split(gray, c)                # same cell, digit by digit
            raw.append(f"[{txt}{'' if d2 in ('', d) else ' | ' + d2}]")
            ok1 = d.isascii() and d.isdigit() and len(d) <= 6
            ok2 = d2 != "" and len(d2) <= 6
            if ok1 and (d2 == d or not ok2):
                count = int(d); scores.append(max(sc, sc2 if d2 == d else 0.0)); break
            if ok2 and not ok1:
                count = int(d2); scores.append(sc2); bad = bad or sc2 < 0.6; break
            if ok1 and ok2 and d2 != d:                          # the two readings disagree → person decides
                count = int(d if sc >= sc2 else d2); scores.append(min(sc, sc2)); bad = True; break
            bad = True                                           # text where a number was expected → let a person look
    conf = min([bscore] + scores) if scores else 0.0
    return {"bay": bay, "count": count, "confidence": round(conf, 2),
            "needsReview": bad or count is None or conf < 0.6, "raw": f"{bay} {''.join(raw)}", "source": "cells"}


def _read_digits_split(gray, box):
    """Split a cell's ink into separate strokes (digits), read each like a box, join → (digits, min score).
    Returns ('', 0) when the strokes do not all read as digits."""
    import cv2
    import numpy as np
    x, y, w, h = box; mx = max(3, int(w * 0.06)); my = max(3, int(h * 0.1))
    crop = gray[y + my:y + h - my, x + mx:x + w - mx]
    if crop.size == 0: return "", 0.0
    t = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    t = cv2.morphologyEx(t, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(t, 8)
    hmin = max(8, int(crop.shape[0] * 0.2))
    comps = [tuple(stats[i]) for i in range(1, n) if stats[i][3] >= hmin and stats[i][2] >= 3]
    if not comps or len(comps) > 6: return "", 0.0
    comps.sort(key=lambda c: c[0])
    # merge pieces that overlap horizontally (a broken stroke), e.g. the two parts of a "5"
    merged = []
    for cx, cy, cw, ch, _a in comps:
        if merged and cx < merged[-1][0] + merged[-1][2] * 0.5:
            px, py, pw, ph = merged[-1]; nx, ny = min(px, cx), min(py, cy)
            merged[-1] = (nx, ny, max(px + pw, cx + cw) - nx, max(py + ph, cy + ch) - ny)
        else: merged.append((cx, cy, cw, ch))
    digits, scores = [], []
    for cx, cy, cw, ch in merged:
        pad = max(6, int(ch * 0.25))
        sub = crop[max(0, cy - pad):cy + ch + pad, max(0, cx - pad):cx + cw + pad]
        scale = max(1.0, min(4.0, 48.0 / max(1, sub.shape[0])))
        sub = cv2.copyMakeBorder(sub, 8, 8, 16, 16, cv2.BORDER_CONSTANT, value=int(np.median(crop)))
        sub = cv2.resize(sub, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        txt, sc = _rec_line(cv2.cvtColor(sub, cv2.COLOR_GRAY2RGB))
        d = _fix_digits(txt)
        if not (d.isascii() and d.isdigit() and len(d) == 1): return "", 0.0
        digits.append(d); scores.append(sc)
    return "".join(digits), (min(scores) if scores else 0.0)


def _table_rows(im):
    """Rows read cell by cell from any ruled table (printed template or hand-drawn). None if no table found."""
    import cv2
    import numpy as np
    gray = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2GRAY)
    grid = _find_cells(gray)
    if len(grid) < 1: return None
    rows = [r for r in (_row_from_cells(gray, g["cells"]) for g in grid) if r]
    return rows or None


def _band_reread(im, frags, rows):
    """Plain lists (no table): for a bay with no count, re-read the strip of paper to its right as one line."""
    import cv2
    import numpy as np
    gray = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2GRAY); H, W = gray.shape
    byb = {_as_bay(f["text"]): f for f in frags if _as_bay(f["text"])}
    for r in rows:
        if not r["bay"] or r["bay"] not in byb: continue
        f = byb[r["bay"]]; h = max(10, int(f["h"]))
        y0 = max(0, int(f["cy"] - h * 0.9)); y1 = min(H, int(f["cy"] + h * 0.9))
        x0 = min(W - 1, int(f["x1"] + h * 0.3)); x1 = W
        band = gray[y0:y1, x0:x1]
        if band.size == 0: continue
        scale = max(1.0, min(3.0, 48.0 / band.shape[0]))
        band = cv2.resize(band, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        txt, sc = _rec_line(cv2.cvtColor(band, cv2.COLOR_GRAY2RGB))
        m = re.search(r"[0-9OoQDCcUIlSsBZzgqGbTA|]{1,6}(?:[\s.]?[0-9OoQDCcUIlSsBZzgqGbTA|]){0,5}", txt or "")
        if not m: continue
        d = _fix_digits(m.group(0))
        if not (d.isascii() and d.isdigit()): continue
        n = int(d)
        if r["count"] is None:                                   # detector missed the number → take the band reading
            r["count"] = n; r["confidence"] = round(min(f["score"], sc), 2)
            r["needsReview"] = sc < 0.6; r["raw"] = f"{r['bay']} {txt}"; r["source"] = "band"
        elif n != r["count"]:                                    # two readings disagree → a person decides
            if sc > (r["confidence"] or 0): r["count"] = n
            r["needsReview"] = True; r["raw"] = f"{r['raw']} | strip: {txt}"; r["source"] = "band?"
    return rows


def parse_count_sheet(data: bytes):
    im = load_image(data)
    frags = ocr_fragments(im)
    rows = None
    try:
        rows = _table_rows(im)                                   # ruled table: read cell by cell
    except Exception:  # noqa: BLE001 — never let the table path break the generic one
        logging.getLogger("phystock").exception("count-sheet: table reading failed, using text rows")
        rows = None
    mode = "table"
    generic = extract_rows(frags)
    if not rows:
        rows = generic; mode = "freeform"
        try: rows = _band_reread(im, frags, rows)               # plain list: re-read the strip right of each bay
        except Exception: logging.getLogger("phystock").exception("count-sheet: band re-read failed")  # noqa: BLE001
    else:
        seen = {r["bay"] for r in rows}
        rows += [r for r in generic if r["bay"] and r["bay"] not in seen]   # bays written outside the table
    rows.sort(key=lambda r: (r["bay"] or "~"))
    return {"rows": rows, "fragments": len(frags), "width": im.size[0], "height": im.size[1], "mode": mode}


def make_thumbnail(data: bytes, max_side=480) -> bytes:
    im = load_image(data, max_side=max_side)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80)
    return buf.getvalue()
