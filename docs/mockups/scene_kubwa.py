"""Pictures of the Pepa Ndogo Kubwa box — the 77 x 44, behind the /p2 code.

Carton 81 x 126 x 55 mm, hook bottom, from `77x44 50入勾底 120310.pdf`.

Everything here now comes off that box's own die. Until this file arrived with
artwork on it, these pictures were built by fitting the King Size box's faces
to these narrower panels and re-lettering the information panel by hand, with
a warning in the code that it had to be redone. This box has its own artwork —
a different Maasai from the 70 x 36 box, its own information panel, its own
booklet on page 2 — so nothing of it is borrowed or invented any more.

    python3 scene_kubwa.py <workspace>
      -> <workspace>/page/kubwa-*-full.png     the pictures on /p2
      -> <workspace>/out/Pepa-kubwa-*.png      the shots the factory deck uses
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
W = sys.argv[1]; sys.path.insert(0, W)
import r3d

F = W + "/f/"
PAGE = os.path.join(W, "page"); os.makedirs(PAGE, exist_ok=True)
OUT = os.path.join(W, "out"); os.makedirs(OUT, exist_ok=True)
PAPER = (246, 241, 231)
T = lambda n: Image.open(F + n + ".png")

# The carton, measured off its own pattern: walls 126 / 81 / 126 / 81 and a
# 54.44 mm band, which is the 81 x 126 x 55 the die block states.
BOX_W, BOX_H, BOX_D = 81, 55, 126
# The booklet, off page 2 of the same file: "26.2 x 4.15 x 80 mm".
BK_L, BK_T, BK_W = 80, 4.15, 26.2

def box(pos=(0, 0, 0), yaw=0, layer=0):
    # The two 126 mm walls carry the same scene, so which is left and which is
    # right cannot be told apart and does not need to be.
    tex = {
        "front": T("t_n77_front"),      # Pepa, the code, and the thumb notch
        "back": T("t_n77_back"),        # the information panel and its own code
        "left": T("t_n77_left"),
        "right": T("t_n77_right"),
        "top": T("t_n77_lid"),
    }
    q = r3d.box_quads(BOX_W, BOX_H, BOX_D, tex, sheen=0.12, layer=layer + 1)
    # The thumb notch is a real hole in the front wall. With nothing behind it
    # the picture shows the background through the box, which reads as a hole
    # punched in the mockup rather than as a notch to lift the lid by.
    w, d, t = BOX_W / 2, BOX_D / 2, 1.2
    inside = r3d.Quad([(-w + t, BOX_H - t, d - t), (w - t, BOX_H - t, d - t),
                       (w - t, 0, d - t), (-w + t, 0, d - t)],
                      color=(104, 83, 65), layer=layer, sheen=0, shade=1.0)
    return r3d.transform([inside] + q, pos, yaw)

def booklet(pos, yaw, layer=7):
    edge = (214, 194, 166)
    tex = {"top": T("bk77_front"), "front": T("bk77_spine"), "left": edge, "right": edge}
    return r3d.box_quads(BK_L, BK_T, BK_W, tex, pos=pos, yaw=yaw, sheen=0.08, layer=layer)

SH = lambda pos=(0, 0, 0), yaw=0, s=1.0: (-BOX_W / 2, BOX_W / 2, -BOX_D / 2, BOX_D / 2, BOX_H, pos, yaw, s)
BK_SH = lambda pos, yaw: (-BK_L / 2, BK_L / 2, -BK_W / 2, BK_W / 2, BK_T, pos, yaw, 0.85)
KEY, SHADOW = (-0.45, 0.95, 0.6), (-0.30, 1.7, 0.45)

def shoot(q, sh, target, dist, az, el, fov, size, pad=0.07, bg=None, turn_light=False):
    cam = r3d.Camera(target=target, dist=dist, az=az, el=el, fov=fov, W=size[0] * 2, H=size[1] * 2)
    light = r3d.roty(KEY, az) if turn_light else KEY
    sl = r3d.roty(SHADOW, az) if turn_light else SHADOW
    layers = r3d.render(q, cam, light=light, shadows=sh, shadow_light=sl)
    return r3d.finish(layers, size[0], size[1], pad=pad, bg=bg)

# Two booklets in front of the box, framed the way the 70 x 36 page frames its
# pair, so the two pages read as one set.
BP1, BY1 = (-28, 0, BOX_D / 2 + 33), 8
BP2, BY2 = (30, 0, BOX_D / 2 + 50), -10

def with_booklets():
    return (box() + booklet(BP1, BY1) + booklet(BP2, BY2, layer=8),
            [SH(), BK_SH(BP1, BY1), BK_SH(BP2, BY2)])

# ── the three pictures on /p2 ───────────────────────────────────────────────
# Shot from high enough that the lid reads. The lid's words are set for
# somebody standing at the front of the box, so a low three-quarter view —
# which is what these pictures used before the real lid artwork arrived —
# shows them lying on their side.
paper = lambda s: Image.new("RGB", s, PAPER)
page = {}
page["kubwa-hero"] = shoot(box(), [SH()], (0, 26, 0), 540, 34, 34, 28, (1200, 1000), bg=paper((1200, 1000)))
# From behind, the lid's words are upside down because they are set for the
# front. Kept low, so the panel is the picture and the lid is an edge.
page["kubwa-back"] = shoot(box(), [SH()], (0, 24, 0), 480, 208, 15, 28, (1200, 1000),
                           bg=paper((1200, 1000)), turn_light=True)
q, sh = with_booklets()
page["kubwa-booklets"] = shoot(q, sh, (0, 20, 62), 560, 20, 26, 30, (1200, 1000), pad=0.03,
                               bg=paper((1200, 1000)))
for name, img in page.items():
    img.save(os.path.join(PAGE, name + "-full.png"), optimize=True)
    print("picture", name, img.size)

# ── the shots the factory deck prints ───────────────────────────────────────
shots = {}
shots["front"] = shoot(box(), [SH()], (0, 26, 0), 540, 34, 34, 28, (1700, 1350))
shots["back"] = shoot(box(), [SH()], (0, 24, 0), 480, 208, 15, 28, (1700, 1350), turn_light=True)
shots["top"] = shoot(box(), [SH()], (0, 30, 0), 520, 18, 66, 28, (1500, 1500))
q, sh = with_booklets()
shots["with-booklets"] = shoot(q, sh, (0, 20, 62), 580, 20, 26, 30, (1700, 1400), pad=0.04)
shots["booklet"] = shoot(booklet((0, 0, 0), 0), [BK_SH((0, 0, 0), 0)], (0, 2, 0), 250, 12, 40, 26,
                         (1600, 900), pad=0.08)
for name, img in shots.items():
    img.save(os.path.join(OUT, f"Pepa-kubwa-{name}.png"), optimize=True)
    print("shot", name, img.size)

# ── every angle, on one sheet ───────────────────────────────────────────────
PT = 300 / 72.0
FT = lambda pt, b=False: ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Arial" + (" Bold" if b else "") + ".ttf", int(pt * PT / 2.2))
INK, SOFT, BG = (30, 26, 22), (120, 110, 98), (244, 239, 230)
views = [(az, 30, f"{az}°") for az in range(0, 360, 45)] + [(25, 66, "From above")]
frames = []
for az, el, label in views:
    frames.append((label, shoot(box(), [SH()], (0, 26 if el < 40 else 30, 0), 470, az, el, 28,
                                (1000, 820), turn_light=True)))
S = 0.62; fw, fh = 1000, 820; tw, th = int(fw * S), int(fh * S); PAD, GAP, HEAD, cols = 56, 18, 150, 3
rows = (len(frames) + cols - 1) // cols
sheet = Image.new("RGB", (PAD * 2 + cols * tw + (cols - 1) * GAP,
                          PAD * 2 + HEAD + rows * th + (rows - 1) * GAP), BG)
d = ImageDraw.Draw(sheet)
d.text((PAD, PAD), "Pepa Ndogo Kubwa 77 × 44 — every angle", font=FT(38, True), fill=INK)
d.text((PAD, PAD + 70), "81 × 126 × 55 mm hook-bottom box · 50 booklets of 50 leaves · final design",
       font=FT(22), fill=SOFT)
for i, (label, im) in enumerate(frames):
    r, c = divmod(i, cols)
    x, y = PAD + c * (tw + GAP), PAD + HEAD + r * (th + GAP)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y))
    d.text((x + 14, y + 10), label, font=FT(22, True), fill=SOFT)
sheet.save(os.path.join(OUT, "Pepa-kubwa-every-angle.png"), optimize=True)
print("grid Pepa-kubwa-every-angle.png", sheet.size)
