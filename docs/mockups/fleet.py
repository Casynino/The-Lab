"""The fleet, the warehouse and the ship, rendered in 3D.

Nino, 9 Nov 2026, holding up bongolife.app: the sign-in scene should look
real, not like flat drawings. Bongo Life gets that with a 5.6 MB video that
downloads on every visit — too much for a tool his reps open several times a
day on mobile data. So the OBJECTS are rendered here, properly lit and with
real shadows, and the browser moves them. About 300 KB for the whole set, and
it stays sharp at any size.

    python3 docs/mockups/fleet.py

Writes transparent sprites into client/public/fleet/. Everything is built from
boxes because that is what r3d.py renders — which is also the low-poly look
the BlueWave illustration he pointed at uses, so the constraint and the style
agree for once.
"""

from PIL import Image
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import r3d

OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "client", "public", "fleet"))
os.makedirs(OUT, exist_ok=True)

# The house palette, in three tones per material: top face, side face, end face.
BODY = ((250, 244, 240), (226, 216, 210), (238, 230, 225))
RED = ((255, 86, 68), (212, 38, 26), (238, 49, 36))
GLASS = ((52, 24, 20), (40, 18, 15), (46, 20, 17))
TYRE = ((30, 16, 14), (20, 11, 10), (24, 13, 12))
HUB = ((150, 130, 126), (112, 94, 90), (130, 110, 106))
STEEL = ((70, 62, 60), (48, 42, 40), (58, 51, 49))
CARD = ((232, 200, 158), (190, 156, 114), (212, 179, 135))
ROOF = ((255, 96, 78), (198, 34, 24), (228, 46, 34))


def f(mat):
    """A box's five visible faces from one three-tone material."""
    top, side, end = mat
    return {"top": top, "right": side, "left": side, "front": end, "back": end}


def cutout(layers, width):
    """r3d.finish() always lands the object on an opaque studio sweep. These
    have to sit on a dark map instead, so this keeps the alpha: shadow under
    object, cropped to what is actually drawn, scaled to the width asked for."""
    shadow, obj = layers
    s = r3d.SS
    shadow = shadow.resize((shadow.width // s, shadow.height // s), Image.LANCZOS)
    obj = obj.resize((obj.width // s, obj.height // s), Image.LANCZOS)
    both = shadow.copy()
    both.alpha_composite(obj)
    both = both.crop(both.getbbox())
    h = max(1, round(both.height * width / both.width))
    return both.resize((width, h), Image.LANCZOS)


def save(im, name):
    p = os.path.join(OUT, name)
    im.save(p, "WEBP", quality=90, method=6)
    print(f"{p}  {im.width}x{im.height}  {os.path.getsize(p) / 1024:.0f} KB")


CAM = dict(az=-34, el=19, fov=24)      # negative az: everything faces LEFT,
                                       # which is the way out of Dar on every
                                       # route but Mtwara.


def shot(quads, target, dist, shadow, width, name, W=1600, H=1100):
    cam = r3d.Camera(target=target, dist=dist, W=W, H=H, **CAM)
    layers = r3d.render(quads, cam, light=(0.55, 0.95, 0.55), ambient=0.6, shadows=shadow)
    save(cutout(layers, width), name)


# ── the lorry: the long haul ────────────────────────────────────────────────
q = []
q += r3d.box_quads(210, 9, 56, f(STEEL), pos=(0, 0, 0), y0=13)
q += r3d.box_quads(132, 80, 64, f(BODY), pos=(-34, 0, 0), y0=22)
q += r3d.box_quads(133, 11, 65, f(RED), pos=(-34, 0, 0), y0=56)
q += r3d.box_quads(56, 56, 62, f(BODY), pos=(66, 0, 0), y0=22)
q += r3d.box_quads(3, 24, 56, f(GLASS), pos=(94, 0, 0), y0=48)
q += r3d.box_quads(40, 20, 64, f(GLASS), pos=(64, 0, 0), y0=50)
for x in (-78, -34, 72):
    for z in (-31, 31):
        q += r3d.box_quads(30, 30, 13, f(TYRE), pos=(x, 0, z))
        q += r3d.box_quads(13, 13, 14, f(HUB), pos=(x, 0, z), y0=8)
shot(q, (0, 48, 0), 600, [(-105, 105, -32, 32, 100, (0, 0, 0), 0, 0.55)], 300, "lorry.webp")

# ── the van: everything else ────────────────────────────────────────────────
q = []
q += r3d.box_quads(150, 8, 50, f(STEEL), pos=(0, 0, 0), y0=11)
q += r3d.box_quads(92, 62, 56, f(BODY), pos=(-22, 0, 0), y0=19)
q += r3d.box_quads(93, 9, 57, f(RED), pos=(-22, 0, 0), y0=42)
q += r3d.box_quads(44, 46, 54, f(BODY), pos=(46, 0, 0), y0=19)
q += r3d.box_quads(3, 20, 48, f(GLASS), pos=(67, 0, 0), y0=38)
q += r3d.box_quads(30, 17, 56, f(GLASS), pos=(45, 0, 0), y0=40)
for x in (-50, 50):
    for z in (-27, 27):
        q += r3d.box_quads(25, 25, 11, f(TYRE), pos=(x, 0, z))
        q += r3d.box_quads(11, 11, 12, f(HUB), pos=(x, 0, z), y0=7)
shot(q, (0, 38, 0), 520, [(-76, 76, -28, 28, 80, (0, 0, 0), 0, 0.5)], 230, "van.webp")

# ── the Lab: the shed everything leaves from ────────────────────────────────
q = []
q += r3d.box_quads(240, 86, 150, f(BODY), pos=(0, 0, 0))
q += r3d.box_quads(252, 14, 162, f(ROOF), pos=(0, 0, 0), y0=86)
for x in (-70, 0, 70):                       # the bays
    q += r3d.box_quads(44, 54, 4, f(GLASS), pos=(x, 0, 76))
q += r3d.box_quads(36, 32, 36, f(CARD), pos=(-150, 0, 40))   # stock on the apron
q += r3d.box_quads(34, 30, 34, f(CARD), pos=(-150, 0, 40), y0=32)
q += r3d.box_quads(36, 32, 36, f(CARD), pos=(-150, 0, -20))
shot(q, (0, 50, 0), 760, [(-126, 126, -81, 81, 100, (0, 0, 0), 0, 0.5)], 340, "warehouse.webp")

# ── a region's depot ────────────────────────────────────────────────────────
q = []
q += r3d.box_quads(120, 62, 92, f(BODY), pos=(0, 0, 0))
q += r3d.box_quads(130, 11, 102, f(ROOF), pos=(0, 0, 0), y0=62)
q += r3d.box_quads(40, 40, 4, f(GLASS), pos=(0, 0, 47))
shot(q, (0, 34, 0), 520, [(-65, 65, -51, 51, 73, (0, 0, 0), 0, 0.45)], 170, "depot.webp")

# ── the ship on the coast ───────────────────────────────────────────────────
q = []
q += r3d.box_quads(360, 46, 100, f(STEEL), pos=(0, 0, 0))
q += r3d.box_quads(366, 10, 106, f(RED), pos=(0, 0, 0), y0=46)
cols = [RED, BODY, CARD, BODY, RED]
for i, x in enumerate(range(-130, 131, 65)):
    for lvl in range(2 if i % 2 else 3):
        q += r3d.box_quads(58, 26, 86, f(cols[i]), pos=(x, 0, 0), y0=56 + lvl * 27)
q += r3d.box_quads(52, 70, 86, f(BODY), pos=(150, 0, 0), y0=56)   # the bridge
q += r3d.box_quads(54, 10, 88, f(GLASS), pos=(150, 0, 0), y0=104)
shot(q, (0, 70, 0), 980, [(-186, 186, -54, 54, 140, (0, 0, 0), 0, 0.45)], 380, "ship.webp")

# ── a pallet of stock ───────────────────────────────────────────────────────
q = []
for lvl in range(3):
    q += r3d.box_quads(54, 26, 54, f(CARD), pos=(0, 0, 0), y0=lvl * 27)
shot(q, (0, 40, 0), 420, [(-28, 28, -28, 28, 82, (0, 0, 0), 0, 0.45)], 120, "pallet.webp")
