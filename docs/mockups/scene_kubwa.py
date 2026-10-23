"""Pictures for the Pepa Ndogo Kubwa page, the 77 x 44 box behind the /p2 code.

Its carton is 81 x 126 x 55 mm, hook bottom, from the 1 1-4 pattern. The
artwork supplied for it is drawn for a 112 mm wall, so each face is fitted to
these narrower panels here — a picture may squeeze a tree by a few per cent,
which nobody can see, where a print file may not.

The information panel is re-lettered rather than reused: the supplied artwork
prints the 70 x 36 box's figures and the 70 x 36 box's QR, and this page exists
precisely so the two boxes stop being confused for each other.

Re-render these when the real artwork for this carton arrives.

    python3 scene_kubwa.py <workspace>     ->  <workspace>/page/kubwa-*-full.png
"""
import sys, os
W = sys.argv[1]; sys.path.insert(0, W)
from PIL import Image, ImageDraw, ImageFont
import r3d

F = W + "/f/"
OUT = os.path.join(W, "page"); os.makedirs(OUT, exist_ok=True)
PAPER = (246, 241, 231)
DPI = 300; K = DPI / 25.4
BOX_W, BOX_H, BOX_D = 81, 55, 126          # the carton, off the pattern
ARIAL = "/System/Library/Fonts/Supplemental/Arial"
font = lambda pt, b=False: ImageFont.truetype(ARIAL + (" Bold" if b else "") + ".ttf", int(pt * DPI / 72))

def fill(face, w_mm, h_mm):
    """Fit a supplied face to a panel of this carton, filling it."""
    im = Image.open(F + face + ".png").convert("RGB")
    w, h = int(w_mm * K), int(h_mm * K)
    sc = max(w / im.width, h / im.height)
    im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
    return im.crop(((im.width - w) // 2, (im.height - h) // 2,
                    (im.width - w) // 2 + w, (im.height - h) // 2 + h))

def info_panel(w_mm, h_mm, qr_path):
    """This box's own information panel: its figures, and its own code."""
    base = fill("kss_back", w_mm, h_mm)
    board = base.getpixel((base.width // 2, int(base.height * 0.1)))
    panel = Image.new("RGB", base.size, board)
    d = ImageDraw.Draw(panel)
    pad = int(3 * K)
    if os.path.exists(qr_path):
        side = int(16 * K)
        qr = Image.open(qr_path).convert("RGB").resize((side, side), Image.NEAREST)
        panel.paste(qr, (panel.width - pad - side, (panel.height - side) // 2))
    y = int(12 * K)
    for label, value in (("Colour:", "Brown"), ("Size:", "77 × 44 mm"),
                         ("Type:", "Paper Ndogo Kubwa (Unfiltered)"), ("Feature:", "Slow Burn")):
        d.text((pad + int(3 * K), y), label, font=font(6, True), fill=(32, 28, 24))
        d.text((pad + int(16 * K), y), value, font=font(6), fill=(32, 28, 24))
        y += int(6 * K)
    return panel

def box(pos=(0, 0, 0), yaw=0, layer=0):
    # The front is taken from a landscape face, not from the supplied front:
    # that one carries the 70 x 36 box's QR, and a picture showing a second code
    # on this carton would undo the whole point of giving it its own.
    #
    # The landscape crops gracefully to a narrower panel — a tree moves, nothing
    # breaks — where the lettered faces do not.
    tex = {
        "front": fill("kss_right", BOX_W, BOX_H),
        "back": info_panel(BOX_W, BOX_H, os.path.join(W, "out", "Pepa-QR-77x44.png")),
        "left": fill("kss_left", BOX_D, BOX_H),
        "right": fill("kss_right", BOX_D, BOX_H),
        "top": fill("kss_lid", BOX_W, BOX_D),
    }
    return r3d.box_quads(BOX_W, BOX_H, BOX_D, tex, pos=pos, yaw=yaw, sheen=0.12, layer=layer)

# A booklet of 77 x 44 papers. The leaves fold in half across the 44, so the
# booklet is about 80 x 26 mm, and 5 mm thick for fifty of them.
#
# Its cover is the supplied Pepa booklet artwork. The same cover serves both
# sizes: it carries the brand and the fifty-leaf count this box also holds, and
# no size and no code of its own, so nothing on it belongs to the other box.
# It is fitted to these proportions, which squeezes it by a few per cent, the
# same as the box faces above.
BK_L, BK_T, BK_W = 80, 5, 26

def fit(name, w_mm, h_mm):
    """A supplied face at a panel's exact proportions, whole, nothing cropped."""
    im = Image.open(F + name + ".png").convert("RGB")
    return im.resize((int(w_mm * K), int(h_mm * K)), Image.LANCZOS)

def booklet(pos, yaw, layer=7):
    edge = (214, 194, 166)
    tex = {"top": fit("bk70_front", BK_L, BK_W), "front": fit("bk70_spine", BK_L, BK_T),
           "left": edge, "right": edge}
    return r3d.box_quads(BK_L, BK_T, BK_W, tex, pos=pos, yaw=yaw, sheen=0.08, layer=layer)

BK_SH = lambda pos, yaw: (-BK_L / 2, BK_L / 2, -BK_W / 2, BK_W / 2, BK_T, pos, yaw, 0.85)

SH = lambda pos=(0, 0, 0), yaw=0, s=1.0: (-BOX_W / 2, BOX_W / 2, -BOX_D / 2, BOX_D / 2, BOX_H, pos, yaw, s)

def shoot(q, sh, target, dist, az, el, fov, size, pad=0.07):
    cam = r3d.Camera(target=target, dist=dist, az=az, el=el, fov=fov, W=size[0] * 2, H=size[1] * 2)
    layers = r3d.render(q, cam, light=(-0.45, 0.95, 0.6), shadows=sh)
    return r3d.finish(layers, size[0], size[1], pad=pad, bg=Image.new("RGB", size, PAPER))

# Low elevations on purpose: the long landscape walls are the faces that fit
# this carton honestly, and the lid — cropped from a wider sheet — reads as
# pattern rather than as sliced lettering.
# The box with the booklets that come out of it, so a scan shows what is
# actually bought — the same thing the 70 x 36 page shows.
bp1, by1 = (-28, 0, BOX_D / 2 + 33), 8
bp2, by2 = (30, 0, BOX_D / 2 + 50), -10

scenes = {
    # Closed, three-quarters: what a shopkeeper sees on the counter.
    "kubwa-hero": shoot(box(), [SH()], (0, 26, 0), 520, 38, 16, 28, (1200, 1000)),
    # The information panel, which carries this box's own code.
    "kubwa-back": shoot(box(), [SH()], (0, 26, 0), 520, 206, 14, 28, (1200, 1000)),
    # The box and its booklets.
    "kubwa-booklets": shoot(
        box() + booklet(bp1, by1) + booklet(bp2, by2, layer=8),
        [SH(), BK_SH(bp1, by1), BK_SH(bp2, by2)],
        (0, 24, 54), 660, 16, 18, 30, (1200, 1000), pad=0.04),
}
for name, img in scenes.items():
    img.save(os.path.join(OUT, name + "-full.png"), optimize=True)
    print("picture", name, img.size)
