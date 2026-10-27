"""Generates icon.ico (tray + exe icon) — run automatically by build_exe.bat."""
from PIL import Image, ImageDraw

def draw(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 64
    d.rounded_rectangle((6*s, 6*s, 58*s, 58*s), radius=10*s, fill="#FFC233")
    for box in [(16, 16, 26, 26), (38, 16, 48, 26), (16, 38, 26, 48), (34, 34, 48, 48)]:
        d.rectangle(tuple(v*s for v in box), fill="#0B0E11")
    return img

sizes = [16, 24, 32, 48, 64, 128, 256]
draw(256).save("icon.ico", sizes=[(x, x) for x in sizes])
print("icon.ico written")
