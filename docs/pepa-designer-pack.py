"""Build a designer's pack for the Pepa box: every face at true size, on A4,
with the dimensions written on it. Page 1 states what the box is and what the
question is, so the file explains itself without a covering note."""
from PIL import Image, ImageDraw, ImageFont
import sys, os
SP = sys.argv[1]
OUT = SP + "/pack"

DPI = 300
MM = DPI / 25.4
A4W, A4H = int(297 * MM), int(210 * MM)          # A4 landscape
BG = (255, 255, 255); INK = (26, 24, 20); SOFT = (122, 112, 98); RED = (163, 58, 31)
PT = DPI / 72.0                                   # points -> pixels at 300 dpi
FT = lambda pt, b=False: ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Arial" + (" Bold" if b else "") + ".ttf",
    int(round(pt * PT)))

FACES = [
    ("Front",     "bottom", 155, 74),
    ("Back",      "top",    155, 74),
    ("Top",       "front",  155, 48),
    ("Bottom",    "back",   155, 48),
    ("Left end",  "end",     48, 74),
    ("Right end", "end2",    48, 74),
]

pages = []

# ── page 1: what this is ────────────────────────────────────────────────────
p = Image.new("RGB", (A4W, A4H), BG); d = ImageDraw.Draw(p)
M = int(18 * MM)
d.text((M, M), "Pepa — box artwork", font=FT(26, True), fill=INK)
d.text((M, M + int(11 * MM)),
       "155 × 74 × 48 mm · 50 booklets per box · 32 leaves per booklet",
       font=FT(12), fill=SOFT)

body = [
    ("The carton", [
        "Measured off the die-line's own folds: the wrap is 74 mm across and 436 mm long,",
        "folding at 47.6 / 155 / 46.9 / 155. That gives a box of 155 × 74 × 48 mm.",
        "The end panels settle which way is up — the Maasai on one of them stands 74 mm tall.",
    ]),
    ("The question for the designer", [
        "The artwork is drawn for the box LYING DOWN: all type runs along the 155 mm side.",
        "Stood upright like the Civlily pack, every word lies on its side. (Next page.)",
        "Turning the panels 90° is not enough — the scenes are 155 mm-wide panoramas, so",
        "Kilimanjaro would run up the box. Portrait needs each face re-composed: wordmark",
        "and descriptor set vertically, scene upright across the bottom, as Civlily does it.",
    ]),
    ("The QR code", [
        "Already on the artwork, on both 155 × 48 faces. It reads",
        "HTTPS://THE-HAOLAB.VERCEL.APP/P and that page is live. Printed about 17 mm across —",
        "roughly 0.67 mm per module, which scans comfortably on a cheap phone.",
        "Keep it at 15 mm or larger and leave 3 mm clear on all four sides.",
    ]),
    ("Important", [
        "The faces on the following pages are 300 dpi images lifted from the supplied PDF,",
        "at true size, for layout and discussion. They are NOT print artwork — set final",
        "files from the original vector.",
    ]),
]
y = M + int(24 * MM)
for head, lines in body:
    red = head == "Important"
    d.text((M, y), head, font=FT(14, True), fill=RED if red else INK)
    y += int(8.4 * MM)
    for ln in lines:
        d.text((M, y), ln, font=FT(11), fill=RED if red else INK)
        y += int(6.4 * MM)
    y += int(5.5 * MM)
pages.append(p)

# ── page 2: the two ways up ─────────────────────────────────────────────────
p2 = Image.new("RGB", (A4W, A4H), BG)
thumb = Image.open(SP + "/pepa-direction.png").convert("RGB")
tw = A4W - M * 2
th = round(thumb.height * tw / thumb.width)
if th > A4H - M * 2:
    th = A4H - M * 2; tw = round(thumb.width * th / thumb.height)
thumb = thumb.resize((tw, th), Image.LANCZOS)
p2.paste(thumb, ((A4W - tw) // 2, (A4H - th) // 2))
pages.append(p2)

# ── one page per face, at true size ─────────────────────────────────────────
for label, key, w_mm, h_mm in FACES:
    src = Image.open(SP + f"/die2/{key}.png").convert("RGB")
    target = (int(round(w_mm * MM)), int(round(h_mm * MM)))
    face = src.resize(target, Image.LANCZOS)
    face.save(f"{OUT}/faces/pepa-{label.lower().replace(' ', '-')}-{w_mm}x{h_mm}mm.png",
              dpi=(DPI, DPI))

    pg = Image.new("RGB", (A4W, A4H), BG); dd = ImageDraw.Draw(pg)
    dd.text((M, M), label, font=FT(22, True), fill=INK)
    dd.text((M, M + int(9 * MM)), f"{w_mm} × {h_mm} mm · shown at true size",
            font=FT(11), fill=SOFT)
    x = (A4W - face.width) // 2
    y = M + int(22 * MM)
    dd.rectangle([x - 3, y - 3, x + face.width + 2, y + face.height + 2], outline=(200, 192, 178))
    pg.paste(face, (x, y))
    # a simple dimension line under the face
    ly = y + face.height + int(6 * MM)
    dd.line([(x, ly), (x + face.width, ly)], fill=SOFT, width=3)
    for tx in (x, x + face.width):
        dd.line([(tx, ly - int(1.6 * MM)), (tx, ly + int(1.6 * MM))], fill=SOFT, width=3)
    cap = f"{w_mm} mm"
    dd.text((x + face.width // 2 - dd.textlength(cap, font=FT(10)) // 2,
             ly + int(2.4 * MM)), cap, font=FT(10), fill=SOFT)
    pages.append(pg)

pdf = OUT + "/Pepa-box-artwork.pdf"
pages[0].save(pdf, save_all=True, append_images=pages[1:], resolution=DPI)
print("pdf", pdf, round(os.path.getsize(pdf) / 1024 / 1024, 1), "MB,", len(pages), "pages")
