"""The loading dock: the sign-in scene, rendered in 3D.

Nino, 9 Nov 2026: "I want to see the machine, I want to see people, I want to
see real movement". So this is not a map any more — it is the Lab's own dock:
the shed with its bays open, racking inside, pallets of real stock on the
apron, a forklift working, people carrying boxes to a lorry, and the lorry
pulling out.

    python3 docs/mockups/dock.py

Every layer is rendered through ONE camera at the SAME full frame size, with a
transparent background, so the browser can stack them with no alignment work:
each object is already in its right place in the picture. The actors are their
own layers so CSS can slide them along the ground.

The ground vectors printed at the end are how far one metre of world X and Z
move on screen — the browser needs them to slide anything along the dock
without it floating off the floor.
"""

from PIL import Image
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import r3d

OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "client", "public", "dock"))
os.makedirs(OUT, exist_ok=True)

W, H = 1500, 950                      # the frame every layer shares
CAM = r3d.Camera(target=(60, 95, 150), dist=3500, az=-32, el=22, fov=26, W=W * r3d.SS, H=H * r3d.SS)

# three tones per material: top, side, end
WALL = ((238, 231, 226), (206, 196, 190), (222, 214, 208))
ROOF = ((255, 96, 78), (196, 32, 22), (226, 44, 32))
FLOOR = ((46, 38, 36), (34, 28, 27), (40, 33, 31))
DARK = ((26, 18, 17), (17, 12, 11), (21, 15, 14))
STEEL = ((78, 68, 66), (52, 45, 43), (64, 56, 54))
CARD = ((234, 202, 160), (192, 158, 116), (214, 181, 137))
CARD2 = ((226, 190, 146), (182, 146, 104), (204, 168, 124))
BODY = ((250, 244, 240), (226, 216, 210), (238, 230, 225))
RED = ((255, 86, 68), (212, 38, 26), (238, 49, 36))
GLASS = ((52, 24, 20), (40, 18, 15), (46, 20, 17))
TYRE = ((30, 16, 14), (20, 11, 10), (24, 13, 12))
HI = ((255, 214, 92), (214, 168, 48), (234, 190, 66))      # hi-vis
SKIN = ((122, 84, 62), (96, 64, 46), (108, 74, 54))


def f(mat):
    top, side, end = mat
    return {"top": top, "right": side, "left": side, "front": end, "back": end}


def layer(quads, name, shadows=()):
    """One transparent layer of the same frame, so they stack without maths."""
    sh, ob = r3d.render(quads, CAM, light=(0.5, 0.95, 0.5), ambient=0.6, shadows=shadows)
    s = r3d.SS
    sh = sh.resize((W, H), Image.LANCZOS)
    ob = ob.resize((W, H), Image.LANCZOS)
    out = sh.copy()
    out.alpha_composite(ob)
    p = os.path.join(OUT, name)
    out.save(p, "WEBP", quality=88, method=6)
    print(f"{name:18} {os.path.getsize(p)/1024:6.0f} KB")


# ── the ground and the shed ────────────────────────────────────────────────
bg = []
bg += r3d.box_quads(2000, 8, 1150, f(FLOOR), pos=(0, 0, 120))              # apron
bg += r3d.box_quads(2000, 3, 24, f(STEEL), pos=(0, 0, 500), y0=8)          # painted edge
bg += r3d.box_quads(760, 250, 330, f(WALL), pos=(-330, 0, -200), y0=8)     # the shed
bg += r3d.box_quads(800, 20, 368, f(ROOF), pos=(-330, 0, -200), y0=258)
# three bays, open and dark, standing proud of the wall so they read
for x in (-610, -330, -50):
    bg += r3d.box_quads(176, 152, 20, f(DARK), pos=(x, 0, -24), y0=8)
    bg += r3d.box_quads(184, 13, 24, f(RED), pos=(x, 0, -24), y0=160)
    # racking just inside the dark, so the shed is not a solid block
    for lvl in range(3):
        bg += r3d.box_quads(52, 34, 20, f(CARD2), pos=(x - 42, 0, -30), y0=14 + lvl * 46)
        bg += r3d.box_quads(52, 34, 20, f(CARD), pos=(x + 42, 0, -30), y0=14 + lvl * 46)
layer(bg, "bg.webp", shadows=[(-380, 380, -165, 165, 270, (-330, 0, -200), 0, 0.45)])

# ── pallets waiting on the apron ───────────────────────────────────────────
PALLETS = ((-210, 190, 3), (-60, 300, 2), (90, 170, 3), (-330, 330, 2))
st = []
for (px, pz, n) in PALLETS:
    st += r3d.box_quads(104, 12, 104, f(STEEL), pos=(px, 0, pz), y0=8)     # the pallet
    for lvl in range(n):
        m = CARD if (lvl + px) % 2 else CARD2
        st += r3d.box_quads(96, 46, 96, f(m), pos=(px, 0, pz), y0=20 + lvl * 47)
layer(st, "stacks.webp",
      shadows=[(-52, 52, -52, 52, 20 + n * 47, (px, 0, pz), 0, 0.4) for (px, pz, n) in PALLETS])

# ── the lorry, backed up to the apron ──────────────────────────────────────
def lorry(pos):
    q = []
    q += r3d.box_quads(420, 18, 112, f(STEEL), pos=pos, y0=26)
    q += r3d.box_quads(264, 160, 128, f(BODY), pos=(pos[0] - 68, 0, pos[2]), y0=44)
    q += r3d.box_quads(266, 22, 130, f(RED), pos=(pos[0] - 68, 0, pos[2]), y0=112)
    q += r3d.box_quads(112, 112, 124, f(BODY), pos=(pos[0] + 132, 0, pos[2]), y0=44)
    q += r3d.box_quads(8, 48, 112, f(GLASS), pos=(pos[0] + 188, 0, pos[2]), y0=96)
    q += r3d.box_quads(80, 40, 128, f(GLASS), pos=(pos[0] + 128, 0, pos[2]), y0=100)
    for dx in (-156, -68, 144):
        for dz in (-62, 62):
            q += r3d.box_quads(60, 60, 26, f(TYRE), pos=(pos[0] + dx, 0, pos[2] + dz))
            q += r3d.box_quads(26, 26, 28, f(HI), pos=(pos[0] + dx, 0, pos[2] + dz), y0=16)
    return q

LORRY_AT = (690, 0, 210)
layer(lorry(LORRY_AT), "lorry.webp",
      shadows=[(-212, 212, -64, 64, 200, LORRY_AT, 0, 0.5)])

# ── the forklift, with a pallet on the forks ───────────────────────────────
def forklift(pos):
    q = []
    q += r3d.box_quads(118, 74, 84, f(HI), pos=pos, y0=22)                 # body
    q += r3d.box_quads(64, 46, 76, f(DARK), pos=(pos[0] - 26, 0, pos[2]), y0=96)   # seat back
    for dx in (-52, 36):                                                    # cab posts
        for dz in (-38, 38):
            q += r3d.box_quads(10, 110, 10, f(STEEL), pos=(pos[0] + dx, 0, pos[2] + dz), y0=96)
    q += r3d.box_quads(110, 10, 92, f(STEEL), pos=(pos[0] - 8, 0, pos[2]), y0=206)
    for dz in (-30, 30):                                                    # mast
        q += r3d.box_quads(12, 150, 12, f(STEEL), pos=(pos[0] + 66, 0, pos[2] + dz), y0=22)
    q += r3d.box_quads(66, 10, 86, f(STEEL), pos=(pos[0] + 96, 0, pos[2]), y0=74)   # forks
    q += r3d.box_quads(96, 46, 96, f(CARD), pos=(pos[0] + 100, 0, pos[2]), y0=84)   # its load
    q += r3d.box_quads(96, 46, 96, f(CARD2), pos=(pos[0] + 100, 0, pos[2]), y0=131)
    for dx in (-44, 52):                                                    # wheels
        for dz in (-44, 44):
            q += r3d.box_quads(42, 42, 20, f(TYRE), pos=(pos[0] + dx, 0, pos[2] + dz))
    # the driver
    q += r3d.box_quads(40, 54, 30, f(HI), pos=(pos[0] - 4, 0, pos[2]), y0=96)
    q += r3d.box_quads(26, 26, 26, f(SKIN), pos=(pos[0] - 4, 0, pos[2]), y0=150)
    return q

FORK_AT = (250, 0, 330)
layer(forklift(FORK_AT), "forklift.webp",
      shadows=[(-80, 110, -50, 50, 180, FORK_AT, 0, 0.45)])

# ── two people, carrying ───────────────────────────────────────────────────
def worker(pos, stride):
    q = []
    for dz, k in ((-16, 1), (16, -1)):                                      # legs
        q += r3d.box_quads(20, 62, 22, f(DARK), pos=(pos[0] + stride * k, 0, pos[2] + dz))
    q += r3d.box_quads(46, 66, 44, f(HI), pos=pos, y0=62)                   # hi-vis
    q += r3d.box_quads(28, 28, 28, f(SKIN), pos=pos, y0=128)                # head
    q += r3d.box_quads(70, 50, 56, f(CARD), pos=(pos[0] + 44, 0, pos[2]), y0=72)  # the box
    q += r3d.box_quads(16, 16, 52, f(SKIN), pos=(pos[0] + 22, 0, pos[2]), y0=92)  # arms
    return q

WALK_A = (40, 0, 430)
WALK_B = (440, 0, 400)
for n, (at, stride) in enumerate(((WALK_A, 16), (WALK_B, -16)), start=1):
    layer(worker(at, stride), f"worker{n}.webp",
          shadows=[(-40, 60, -34, 34, 156, at, 0, 0.4)])

print("\nground vectors (pixels per 100 world units, at this frame size):")
o = CAM.project((0, 0, 0)); x1 = CAM.project((100, 0, 0)); z1 = CAM.project((0, 0, 100))
print(f"  +X -> ({(x1[0]-o[0])/r3d.SS:6.2f}, {(x1[1]-o[1])/r3d.SS:6.2f})")
print(f"  +Z -> ({(z1[0]-o[0])/r3d.SS:6.2f}, {(z1[1]-o[1])/r3d.SS:6.2f})")
