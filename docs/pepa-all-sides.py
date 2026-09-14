"""Every face of the Pepa box on one sheet, plus two angles of the assembled
box. Face names follow the assembled box, not the die-line's layout."""
from PIL import Image, ImageDraw, ImageFont
import sys
SP = sys.argv[1]

BG = (246, 241, 231); INK = (32, 28, 24); SOFT = (120, 110, 96)
FT = lambda s, b=False: ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Arial" + (" Bold" if b else "") + ".ttf", s)

PPM = 6.2                                   # px per mm for the flat faces
FACES = [
    ("Front", "155 × 74 mm", "bottom"),
    ("Back",  "155 × 74 mm", "top"),
    ("Top",   "155 × 48 mm", "front"),
    ("Bottom","155 × 48 mm", "back"),
    ("Left end",  "48 × 74 mm", "end"),
    ("Right end", "48 × 74 mm", "end2"),
]

views = [Image.open(SP + f"/view-{n}.png").convert("RGBA") for n in ("a", "b")]

W = 2100
PAD = 60
COL = (W - PAD * 3) // 2

def fit(img, box_w):
    r = box_w / img.width
    return img.resize((box_w, max(1, round(img.height * r))), Image.LANCZOS)

view_t = [fit(v, COL) for v in views]
flat = []
for label, dims, key in FACES:
    im = Image.open(SP + f"/die2/{key}.png").convert("RGB")
    w = round(im.width / (300 / 25.4) * PPM)
    flat.append((label, dims, fit(im, min(w, COL))))

H = PAD + 70 + view_t[0].height + 60
rows = [flat[0:2], flat[2:4], flat[4:6]]
for r in rows:
    H += 46 + max(t[2].height for t in r) + 44
H += PAD

sheet = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(sheet)
d.text((PAD, PAD), "Pepa — 50 per box", font=FT(42, True), fill=INK)
d.text((PAD, PAD + 50), "155 × 74 × 48 mm · every face, measured off the die-line",
       font=FT(22), fill=SOFT)

y = PAD + 100
for i, v in enumerate(view_t):
    sheet.paste(v, (PAD + i * (COL + PAD), y), v)
y += view_t[0].height + 54

for r in rows:
    rh = max(t[2].height for t in r)
    for i, (label, dims, im) in enumerate(r):
        x = PAD + i * (COL + PAD)
        d.text((x, y), label, font=FT(24, True), fill=INK)
        d.text((x + d.textlength(label, font=FT(24, True)) + 14, y + 3), dims,
               font=FT(20), fill=SOFT)
        sheet.paste(im, (x, y + 36))
    y += 36 + rh + 44

sheet.save(SP + "/pepa-all-sides.png", optimize=True)
print("sheet", sheet.size)
