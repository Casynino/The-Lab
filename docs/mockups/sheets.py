"""One presentation sheet per box: a large hero, then the supporting shots."""
import sys
from PIL import Image, ImageDraw, ImageFont
W = sys.argv[1]; O = W + "/out/"
PT = 300 / 72.0
FT = lambda pt, b=False: ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Arial" + (" Bold" if b else "") + ".ttf", int(pt * PT / 2.2))
INK, SOFT, BG = (30, 26, 22), (120, 110, 98), (244, 239, 230)
L = lambda n: Image.open(O + f"Pepa-{n}.png").convert("RGB")

def fit(im, w=None, h=None):
    s = min((w / im.width) if w else 9e9, (h / im.height) if h else 9e9)
    return im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)

def sheet(title, sub, hero, hero_label, tiles, out, WIDTH=2400):
    PAD, GAP, HEAD, LAB = 80, 24, 190, 44
    heroi = fit(L(hero), w=WIDTH - 2 * PAD, h=1500)
    cols = len(tiles)
    tw = (WIDTH - 2 * PAD - GAP * (cols - 1)) // cols
    tims = [fit(L(n), w=tw, h=900) for n, _ in tiles]
    th = max(t.height for t in tims)
    H = PAD + HEAD + heroi.height + LAB + GAP * 2 + th + LAB + PAD
    s = Image.new("RGB", (WIDTH, H), BG); d = ImageDraw.Draw(s)
    d.text((PAD, PAD), title, font=FT(46, True), fill=INK)
    d.text((PAD, PAD + 86), sub, font=FT(24), fill=SOFT)
    y = PAD + HEAD
    s.paste(heroi, ((WIDTH - heroi.width) // 2, y))
    d.text((PAD, y + heroi.height + 10), hero_label, font=FT(22, True), fill=SOFT)
    y += heroi.height + LAB + GAP * 2
    for i, ((n, lab), t) in enumerate(zip(tiles, tims)):
        x = PAD + i * (tw + GAP) + (tw - t.width) // 2
        s.paste(t, (x, y + (th - t.height)))
        d.text((PAD + i * (tw + GAP), y + th + 10), lab, font=FT(22, True), fill=SOFT)
    s.save(out, optimize=True); print(out.split("/")[-1], s.size)

sheet("Pepa 70 × 36 — small box", "Pepa Ndogo · 74 × 155 × 48 mm · 50 booklets of 50 leaves · final design",
      "small-with-booklets", "Front and back, with booklets",
      [("small-front", "Front"), ("small-back", "Back"), ("small-top", "Top — info panel and QR")],
      O + "Pepa-small-box-sheet.png")
sheet("Pepa King Size Slim — big box", "112 × 126 × 55 mm display box · 50 booklets of 108 × 44 mm papers · final design",
      "big-open-display", "Open as a display, with a booklet",
      [("big-front", "Closed — front"), ("big-back", "Closed — back, info panel"), ("big-top", "Lid from above")],
      O + "Pepa-big-box-sheet.png")
