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
from pathlib import Path

from PIL import Image, ImageOps

_ocr = None


def _engine():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    return _ocr


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
    res, _ = _engine()(arr)
    frags = []
    for box, text, score in (res or []):
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
        for t in tokens:
            b = _as_bay(t["text"])
            if b and bay is None:
                bay, bay_score = b, t["score"]
                continue
            c = _as_count(t["text"])
            if c is not None:
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


def parse_count_sheet(data: bytes):
    im = load_image(data)
    frags = ocr_fragments(im)
    rows = extract_rows(frags)
    return {"rows": rows, "fragments": len(frags), "width": im.size[0], "height": im.size[1]}


def make_thumbnail(data: bytes, max_side=480) -> bytes:
    im = load_image(data, max_side=max_side)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80)
    return buf.getvalue()
