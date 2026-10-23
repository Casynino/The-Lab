"""A brief for a die pattern that has no artwork on it yet.

The 77 x 44 carton arrived as a blank pattern: cut, fold and perforation lines,
paste areas, and nothing else. Whoever lays the artwork on it needs three
things that are easy to get wrong — the panel sizes as the die actually draws
them, the words the box must carry, and WHICH QR code goes on it. The last one
matters most: the other two Pepa dies both carry the 70 x 36 box's code, which
is why two different boxes scanned to the same page.

Every figure here is measured off the pattern at 300 dpi, the same rule the
spec decks follow: nothing is typed from memory.

    python3 pattern_brief.py <workspace>

Reads  <workspace>/n77/p-1.png   (pdftoppm -r 300 of the pattern)
       <workspace>/out/Pepa-QR-76x44.png  (the code this box must carry)
Writes <workspace>/pdf/Pepa-77x44-pattern-brief.pdf
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont

W = sys.argv[1]
OUT = os.path.join(W, "pdf"); os.makedirs(OUT, exist_ok=True)
DPI = 200; MM = DPI / 25.4
PW, PH = round(210 * MM), round(297 * MM)
M = round(14 * MM)
INK, SOFT, RULE, BG = (26, 24, 22), (112, 106, 98), (208, 201, 190), (255, 255, 255)
ACCENT, WARN, PANEL = (138, 74, 42), (176, 106, 24), (246, 242, 234)
ARIAL = "/System/Library/Fonts/Supplemental/Arial"
HEI = "/System/Library/Fonts/STHeiti Medium.ttc"
_f = {}
def F(pt, bold=False):
    k = ("e", pt, bold)
    if k not in _f: _f[k] = ImageFont.truetype(ARIAL + (" Bold" if bold else "") + ".ttf", round(pt * DPI / 72))
    return _f[k]
def Z(pt):
    k = ("z", pt)
    if k not in _f: _f[k] = ImageFont.truetype(HEI, round(pt * DPI / 72))
    return _f[k]

# Measured off the pattern (see the module docstring for how).
WALLS = [("Long wall", 125.98), ("Short wall", 81.03), ("Long wall", 125.98), ("Short wall", 81.07)]
GEOM = [
    ("Carton", "81 × 126 × 55 mm", "外箱尺寸"),
    ("Wall band height", "55.04 mm", "围板高度"),
    ("Walls, in order round the box", "126 · 81 · 126 · 81 mm", "四面围板"),
    ("Lid", "81 × 126 mm, rounded corners", "盒盖"),
    ("Tear line (perforation)", "233.30 mm from the sheet top", "齿线位置"),
    ("Bottom", "Hook bottom, paste areas marked", "勾底"),
    ("Paper inside", "77 × 44 mm", "纸张尺寸"),
    ("Booklets per box", "50", "每盒本数"),
]
PRINT_TEXT = [
    ("Colour", "Brown"),
    ("Size", "77 × 44 mm"),
    ("Type", "Paper Ndogo Kubwa (Unfiltered)"),
    ("Feature", "Slow Burn"),
]

def text(d, xy, s, font, fill=INK):
    d.text(xy, s, font=font, fill=fill)
    return xy[1] + font.size * 1.35

def rule(d, y, x0=M, x1=PW - M):
    d.line([(x0, y), (x1, y)], fill=RULE, width=2); return y + round(3 * MM)

page = Image.new("RGB", (PW, PH), BG)
d = ImageDraw.Draw(page)
y = M
y = text(d, (M, y), "Pepa Ndogo Kubwa — 77 × 44", F(22, True))
y = text(d, (M, y), "Die pattern brief · 1 1-4 SIZE 50入勾底 (120309)", Z(11), SOFT)
y = text(d, (M, y), "给工厂的刀版说明", Z(11), SOFT)
y = rule(d, y + round(2 * MM))

# ── the warning that this whole sheet exists for ────────────────────────────
box_h = round(26 * MM)
d.rectangle([M, round(y), PW - M, round(y) + box_h], fill=(253, 246, 235), outline=WARN, width=3)
ty = y + round(4 * MM)
ty = text(d, (M + round(5 * MM), ty), "This box must carry its OWN QR code", F(13, True), WARN)
ty = text(d, (M + round(5 * MM), ty), "The other two Pepa dies both carry the 70 × 36 box's code. Printing that code here", F(10), INK)
ty = text(d, (M + round(5 * MM), ty), "sends this box's customers to the wrong product page.", F(10), INK)
ty = text(d, (M + round(5 * MM), ty), "此盒必须使用自己的二维码。", Z(10), INK)
y += box_h + round(6 * MM)

# the code itself, printed on the page at its true minimum size
qr_path = os.path.join(W, "out", "Pepa-QR-76x44.png")
if os.path.exists(qr_path):
    side = round(28 * MM)
    qr = Image.open(qr_path).convert("RGB").resize((side, side), Image.NEAREST)
    page.paste(qr, (PW - M - side, round(y)))
    ty = y
    ty = text(d, (M, ty), "The code for this box", F(13, True))
    ty = text(d, (M, ty), "HTTPS://THE-HAOLAB.VERCEL.APP/P2", F(11, True), ACCENT)
    ty = text(d, (M, ty), "25 × 25 modules, 4-module quiet zone included in the file.", F(10), SOFT)
    ty = text(d, (M, ty), "Print at 14 mm or larger (0.42 mm per module).", F(10), SOFT)
    ty = text(d, (M, ty), "Capitals are deliberate — they keep the code at 25 modules.", F(10), SOFT)
    ty = text(d, (M, ty), "二维码印刷尺寸不小于 14 毫米，留白已包含在文件内。", Z(10), SOFT)
    y = max(ty, y + side) + round(5 * MM)
y = rule(d, y)

# ── measured geometry ───────────────────────────────────────────────────────
y = text(d, (M, y), "The pattern, as the die draws it", F(13, True))
y = text(d, (M, y), "Measured off the supplied pattern at 300 dpi · 量自刀版文件", Z(9), SOFT)
y += round(2 * MM)
for label, value, zh in GEOM:
    d.text((M, y), label, font=F(10), fill=INK)
    d.text((M + round(66 * MM), y), value, font=F(10, True), fill=INK)
    d.text((M + round(132 * MM), y), zh, font=Z(10), fill=SOFT)
    y += round(6.2 * MM)
y = rule(d, y + round(1 * MM))

# ── the words the box must carry ────────────────────────────────────────────
y = text(d, (M, y), "What the information panel must say", F(13, True))
y = text(d, (M, y), "The King Size die prints “Size: 70 × 36 mm / Type: Paper Ndogo” — that is the small", F(9), SOFT)
y = text(d, (M, y), "box's text. This box's panel reads:", F(9), SOFT)
y += round(2 * MM)
d.rectangle([M, round(y), PW - M, round(y) + round(26 * MM)], fill=PANEL)
ty = y + round(4 * MM)
for k, v in PRINT_TEXT:
    d.text((M + round(5 * MM), ty), f"{k}:", font=F(10, True), fill=INK)
    d.text((M + round(28 * MM), ty), v, font=F(10), fill=INK)
    ty += round(5 * MM)
y += round(26 * MM) + round(5 * MM)

# ── the pattern itself ──────────────────────────────────────────────────────
pat = os.path.join(W, "n77", "p-1.png")
if os.path.exists(pat):
    im = Image.open(pat).convert("RGB")
    # The sheet is mostly empty board. Trim to the drawing, so it is readable
    # here rather than a stamp in the corner.
    from PIL import ImageChops
    bbox = ImageChops.difference(im, Image.new("RGB", im.size, (255, 255, 255))) \
        .convert("L").point(lambda v: 255 if v > 18 else 0).getbbox()
    if bbox:
        pad = 40
        im = im.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                      min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad)))
    avail_w = PW - 2 * M
    avail_h = PH - M - y
    sc = min(avail_w / im.width, avail_h / im.height)
    im = im.resize((round(im.width * sc), round(im.height * sc)), Image.LANCZOS)
    page.paste(im, (M, round(y)))

page.save(os.path.join(OUT, "Pepa-77x44-pattern-brief.pdf"), "PDF", resolution=DPI)
print("wrote Pepa-77x44-pattern-brief.pdf")
