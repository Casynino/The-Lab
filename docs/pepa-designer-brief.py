"""A two-page brief for the packaging designer: what is wrong with the current
artwork for a standing box, and the layout to move to."""
from PIL import Image, ImageDraw, ImageFont
import sys, os
SP = sys.argv[1]

DPI = 300; MM = DPI / 25.4; PT = DPI / 72.0
A4W, A4H = int(210 * MM), int(297 * MM)
BG=(255,255,255); INK=(26,24,20); SOFT=(120,110,98); RED=(163,58,31); LINE=(206,198,184)
GREEN=(28,110,64)
FT = lambda pt, b=False: ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Arial" + (" Bold" if b else "") + ".ttf",
    int(round(pt * PT)))
M = int(16 * MM)

def para(d, x, y, lines, size=10.5, fill=INK, lead=6.0, bold=False):
    for ln in lines:
        d.text((x, y), ln, font=FT(size, bold), fill=fill)
        y += int(lead * MM)
    return y

pages = []

# ── page 1 ──────────────────────────────────────────────────────────────────
p = Image.new("RGB", (A4W, A4H), BG); d = ImageDraw.Draw(p)
d.text((M, M), "Pepa box — what needs to change", font=FT(23, True), fill=INK)
y = para(d, M, M + int(12 * MM), [
    "The carton is right. The artwork is laid out for the wrong orientation."],
    size=12, fill=SOFT, lead=7)

y += int(3 * MM)
d.text((M, y), "The problem", font=FT(13, True), fill=INK); y += int(8 * MM)
y = para(d, M, y, [
    "The carton is 155 × 74 × 48 mm, and that does not need to change.",
    "The current artwork is composed for the box LYING DOWN: every word runs along",
    "the 155 mm side. Stand the box up like the Civlily pack and all of it reads sideways.",
])

img = Image.open(SP + "/pepa-direction.png").convert("RGB")
w = A4W - M * 2
img = img.resize((w, round(img.height * w / img.width)), Image.LANCZOS)
y += int(4 * MM)
p.paste(img, (M, y)); y += img.height + int(6 * MM)

d.text((M, y), "Why rotating the panels will not do it", font=FT(13, True), fill=RED)
y += int(8 * MM)
y = para(d, M, y, [
    "Each big panel is a 155 mm-wide panorama. Turn it 90° and Kilimanjaro runs UP the box,",
    "the lake stands on end, and the beadwork bands that frame the top and bottom become",
    "stripes down the sides. The faces have to be re-composed for portrait, not transformed.",
], fill=RED)

y += int(5 * MM)
d.text((M, y), "Which face becomes which, once it stands up", font=FT(13, True), fill=INK)
y += int(9 * MM)
rows = [
    ("Now", "Standing box", "Size"),
    ("The two 155 × 74 panels", "Front and back", "74 wide × 155 tall"),
    ("The two 155 × 48 panels (QR)", "Left and right sides", "48 wide × 155 tall"),
    ("The two 48 × 74 ends", "Top and bottom", "74 × 48"),
]
colx = [M, M + int(62 * MM), M + int(118 * MM)]
for i, r in enumerate(rows):
    b = i == 0
    for cx, cell in zip(colx, r):
        d.text((cx, y), cell, font=FT(10.5, b), fill=SOFT if b else INK)
    y += int(6.4 * MM)
    if b:
        d.line([(M, y - int(1.6 * MM)), (A4W - M, y - int(1.6 * MM))], fill=LINE, width=2)
y += int(2 * MM)
para(d, M, y, [
    "Note the Maasai. He stands 74 mm tall on an end panel today, so once the box is upright",
    "he ends up lying on the top or the bottom. He belongs in the front scene, as on Civlily.",
], fill=RED)
pages.append(p)

# ── page 2: the target layout ───────────────────────────────────────────────
p = Image.new("RGB", (A4W, A4H), BG); d = ImageDraw.Draw(p)
d.text((M, M), "The layout to move to", font=FT(23, True), fill=INK)
para(d, M, M + int(12 * MM),
     ["Front face, 74 × 155 mm — following the Civlily pack the client sent."],
     size=12, fill=SOFT)

SC = 7.6                                    # px per mm for the wireframe
bw, bh = int(74 * SC), int(155 * SC)
bx, by = M, M + int(26 * MM)
d.rectangle([bx, by, bx + bw, by + bh], outline=INK, width=4)

def zone(y0, y1, label, sub=None, col=GREEN, dashed=False):
    yy0, yy1 = by + int(y0 * SC), by + int(y1 * SC)
    d.rectangle([bx + 8, yy0, bx + bw - 8, yy1], outline=col, width=3)
    tx = bx + bw + int(6 * MM)
    d.line([(bx + bw, (yy0 + yy1) // 2), (tx - int(2 * MM), (yy0 + yy1) // 2)], fill=col, width=2)
    d.text((tx, (yy0 + yy1) // 2 - int(4 * MM)), label, font=FT(11, True), fill=col)
    if sub:
        d.text((tx, (yy0 + yy1) // 2 + int(0.6 * MM)), sub, font=FT(9.5), fill=SOFT)

zone(2, 9,    "Beadwork band", "horizontal, full width")
zone(12, 24,  "50 PER BOX", "black badge, horizontal, top right")
zone(26, 100, "Pepa wordmark + descriptor", "both vertical, reading bottom to top")
zone(104, 148,"Savannah scene", "upright, full 74 mm width — redrawn, not squeezed")
zone(149, 153,"Beadwork band", "horizontal, full width")

d.text((bx, by + bh + int(5 * MM)), "74 mm", font=FT(10), fill=SOFT)
d.text((bx - int(1 * MM), by - int(6 * MM)), "155 mm tall", font=FT(10), fill=SOFT)

y = by + bh + int(16 * MM)
d.text((M, y), "The QR code — do not regenerate it by eye", font=FT(13, True), fill=INK)
y += int(8 * MM)
y = para(d, M, y, [
    "It must encode exactly:  HTTPS://THE-HAOLAB.VERCEL.APP/P",
    "Keep it UPPERCASE. Lower case forces the code into byte mode, which needs more modules",
    "and makes every module smaller at the same printed size.",
    "Print it 15 mm or larger, with 3 mm clear on all four sides. It is ~21 mm today, which is good.",
    "It can live on a 48 mm side or on the back — anywhere it keeps that size and clear space.",
])
y += int(4 * MM)
d.text((M, y), "Also still to place", font=FT(13, True), fill=INK); y += int(8 * MM)
para(d, M, y, [
    "‘50 LEAVES’ — it is on the current artwork and must survive the re-layout.",
    "Final files to be set from the original vector, not from any image supplied for reference.",
])
pages.append(p)

out = SP + "/Pepa-designer-brief.pdf"
pages[0].save(out, save_all=True, append_images=pages[1:], resolution=DPI)
print("wrote", out, round(os.path.getsize(out)/1024/1024, 2), "MB")
