"""Lay the Pepa artwork onto the blank 77 x 44 die pattern.

The 1 1-4 pattern arrived with cut, fold and perforation lines and nothing
else. This places the artwork on it panel by panel, at the sizes the die
actually draws, and prints the box's OWN code and its OWN panel text — the two
things the other dies get wrong.

It is a LAYOUT PROOF, not a press file: the panels come from the wider carton's
artwork, cropped to these narrower walls, so a designer still has to redraw the
scene to fit rather than crop it. What it settles is placement, sizes, the code
and the wording, which is what sends a box to print wrong.

    python3 layout77.py <workspace>

Reads  <workspace>/n77/p-1.png      the pattern at 300 dpi
       <workspace>/f/kss_*.png      the artwork's faces, already cut
       <workspace>/out/Pepa-QR-77x44.png
Writes <workspace>/out/Pepa-77x44-layout.png
       <workspace>/pdf/Pepa-77x44-layout-proof.pdf
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageChops

W = sys.argv[1]
F = os.path.join(W, "f")
OUT = os.path.join(W, "out"); PDF = os.path.join(W, "pdf")
os.makedirs(OUT, exist_ok=True); os.makedirs(PDF, exist_ok=True)
DPI = 300
K = DPI / 25.4
P = lambda mm: int(round(mm * K))
ARIAL = "/System/Library/Fonts/Supplemental/Arial"
font = lambda pt, bold=False: ImageFont.truetype(ARIAL + (" Bold" if bold else "") + ".ttf", int(pt * DPI / 72))

# Measured off the pattern at 300 dpi — see pattern_brief.py for the full table.
WALL_TOP, WALL_BOT = 233.30, 287.74          # the tear line and the bottom fold
LID_TOP, LID_BOT = 107.27, 233.30            # 126 mm, hinged off the back wall
FLAP_TOP = 67.39                             # the tuck flap above the lid
XS = [79.21, 205.19, 286.22, 412.20, 493.23] # wall folds, left to right
# Which face of the supplied artwork goes on which wall. The 126 mm walls take
# the 126 mm faces as they are; the 81 mm walls take a 112 mm face cropped to
# the middle, which keeps the scene's horizon and loses its edges.
PANELS = [
    ("kss_left",  0),   # 126 mm
    ("kss_front", 1),   # 81 mm  <- cropped
    ("kss_right", 2),   # 126 mm
    ("kss_back",  3),   # 81 mm  <- cropped, and re-lettered below
]

# The pale board behind the print, taken from a flat patch of the pattern on
# the lid rather than from the scene, so covered areas match their surroundings.
def board_colour():
    im = Image.open(os.path.join(F, "kss_lid.png")).convert("RGB")
    return im.getpixel((im.width // 2, int(im.height * 0.08)))

BOARD = board_colour()

def fit(face, box_w_mm, box_h_mm):
    """Scale a face to fit the panel whole, padded rather than cropped.

    The supplied artwork is drawn for a 112 mm wall; these are 81. Cropping to
    the middle sliced "NATURAL UNREFINED ROLLING PAPERS" and half the 50, which
    tells a designer nothing. Fitting the whole face and padding with board
    keeps every element legible and makes plain what has to be redrawn.
    """
    im = Image.open(os.path.join(F, face + ".png")).convert("RGB")
    w, h = P(box_w_mm), P(box_h_mm)
    sc = min(w / im.width, h / im.height)
    im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
    panel = Image.new("RGB", (w, h), BOARD)
    panel.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
    return panel

pattern = Image.open(os.path.join(W, "n77", "p-1.png")).convert("RGB")
sheet = Image.new("RGB", pattern.size, (255, 255, 255))

# ── the four walls ──────────────────────────────────────────────────────────
for face, i in PANELS:
    x0, x1 = XS[i], XS[i + 1]
    sheet.paste(fit(face, x1 - x0, WALL_BOT - WALL_TOP), (P(x0), P(WALL_TOP)))

# ── the lid and its tuck flap, off the back wall ────────────────────────────
sheet.paste(fit("kss_lid", XS[4] - XS[3], LID_BOT - LID_TOP), (P(XS[3]), P(LID_TOP)))
if os.path.exists(os.path.join(F, "kss_flap.png")):
    sheet.paste(fit("kss_flap", XS[4] - XS[3], LID_TOP - FLAP_TOP), (P(XS[3]), P(FLAP_TOP)))

# ── the information panel: this box's own words, and its own code ───────────
# The supplied artwork prints the 70 x 36 box's text here. It is covered and
# re-set rather than cropped, because a wrong figure on a carton is the one
# mistake that cannot be corrected after the run.
d = ImageDraw.Draw(sheet)
bx0, bx1 = P(XS[3]), P(XS[4])
by0, by1 = P(WALL_TOP), P(WALL_BOT)
# Edge to edge: the supplied artwork's own QR sits on this panel too, and a
# box carrying two codes is worse than one carrying the wrong code.
d.rectangle([bx0, by0, bx1, by1], fill=BOARD)
pad = P(3)

qr_path = os.path.join(OUT, "Pepa-QR-77x44.png")
qr_mm = 16                                            # over the 14 mm floor
if os.path.exists(qr_path):
    qr = Image.open(qr_path).convert("RGB").resize((P(qr_mm), P(qr_mm)), Image.NEAREST)
    sheet.paste(qr, (bx1 - pad - P(qr_mm) - P(2), by0 + (by1 - by0 - P(qr_mm)) // 2))

tx = bx0 + pad + P(3)
ty = by0 + P(12)
for label, value in (("Colour:", "Brown"), ("Size:", "77 × 44 mm"),
                     ("Type:", "Paper Ndogo Kubwa (Unfiltered)"), ("Feature:", "Slow Burn")):
    d.text((tx, ty), label, font=font(6, True), fill=(32, 28, 24))
    d.text((tx + P(13), ty), value, font=font(6), fill=(32, 28, 24))
    ty += P(6)

# ── the die's own line work, over the artwork ───────────────────────────────
# Multiply keeps every cut, fold and perforation visible on top of the print,
# which is what the factory registers against.
sheet = ImageChops.multiply(sheet, pattern)

sheet.save(os.path.join(OUT, "Pepa-77x44-layout.png"), optimize=True)
sheet.convert("RGB").save(os.path.join(PDF, "Pepa-77x44-layout-proof.pdf"), "PDF", resolution=DPI)
print("wrote Pepa-77x44-layout.png and Pepa-77x44-layout-proof.pdf", sheet.size)
