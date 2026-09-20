"""One sheet putting the two figures side by side, shot for shot.

The die is the same in both files and so is every word on it; the only thing
that differs is the man in the picture. Seeing the two boxes apart makes that
hard to judge, so each row here is the same camera on both designs.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

W = sys.argv[1]
PT = 300 / 72.0
FT = lambda pt, b=False: ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Arial" + (" Bold" if b else "") + ".ttf", int(pt * PT / 2.2))
INK, SOFT, BG = (30, 26, 22), (120, 110, 98), (244, 239, 230)
K = 300 / 25.4
SHEET = {"d1": "a", "d2": "b"}

def L(d, n):
    """The renders, plus one crop straight off the die so the drawing itself
    can be compared at full size — at box scale the two men are 8 mm tall."""
    if n == "figure":
        box = tuple(round(v * K) for v in (119.6, 370, 190.8, 423.2))
        return Image.open(f"{W}/{SHEET[d]}/p-1.png").convert("RGB").crop(box)
    return Image.open(f"{W}/{d}/out/Pepa-{n}.png").convert("RGB")

ROWS = [
    ("figure", "The figure, close up — off the 70 × 36 front panel"),
    ("small-front", "70 × 36 box — front"),
    ("small-open-display", "70 × 36 box — open as a display"),
    ("big-front", "King Size Slim box — front"),
    ("big-open-display", "King Size Slim — open as a display"),
]
NAMES = ("Design 1 — blue cloak", "Design 2 — red robe")

def fit(im, w, h):
    s = min(w / im.width, h / im.height)
    return im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)

WIDTH, PAD, GAP, HEAD, LAB = 2400, 80, 30, 200, 52
col = (WIDTH - 2 * PAD - GAP) // 2
tiles = [[fit(L(d, n), col, 900) for d in ("d1", "d2")] for n, _ in ROWS]
heights = [max(t.height for t in pair) for pair in tiles]
H = PAD + HEAD + sum(h + LAB + GAP for h in heights) + PAD
sheet = Image.new("RGB", (WIDTH, H), BG)
d = ImageDraw.Draw(sheet)
d.text((PAD, PAD), "Pepa — the two figures, side by side", font=FT(46, True), fill=INK)
d.text((PAD, PAD + 86), "Same box, same words, same die. Only the man in the picture differs.",
       font=FT(24), fill=SOFT)
for i, name in enumerate(NAMES):
    d.text((PAD + i * (col + GAP), PAD + 140), name, font=FT(26, True), fill=INK)
y = PAD + HEAD
for (n, label), pair, h in zip(ROWS, tiles, heights):
    for i, t in enumerate(pair):
        x = PAD + i * (col + GAP) + (col - t.width) // 2
        sheet.paste(t, (x, y + (h - t.height)))
    d.text((PAD, y + h + 12), label, font=FT(24, True), fill=SOFT)
    y += h + LAB + GAP
sheet.save(f"{W}/Pepa-two-designs.png", optimize=True)
print("Pepa-two-designs.png", sheet.size)
