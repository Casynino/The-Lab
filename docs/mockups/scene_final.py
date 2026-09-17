"""Final-design mockups, one set per box, each shot framed on its own.

Small box: 70 x 36 pack, 74 x 155 x 48 mm.  Big box: King Size Slim display
box, 112 x 126 x 55 mm. Every face is lifted from the factory PDFs."""
import sys, os
W = sys.argv[1]; sys.path.insert(0, W)
from PIL import Image, ImageDraw, ImageFont
import r3d
import scene_kss as K
F = W + "/f/"; OUT = W + "/out/"
T = lambda n: Image.open(F + n + ".png")
os.makedirs(OUT, exist_ok=True)

def pack(pos=(0, 0, 0), yaw=0, layer=0):
    tex = {"front": T("t_n70_front"), "back": T("t_n70_back"), "left": T("t_n70_left"),
           "right": T("t_n70_right"), "top": T("t_n70_top")}
    return r3d.box_quads(74, 155, 48, tex, pos=pos, yaw=yaw, sheen=0.12, layer=layer)

def booklet70(pos=(0, 0, 0), yaw=0, layer=0):
    edge = (222, 204, 178)
    tex = {"top": T("bk70_front"), "front": T("bk70_spine"), "left": edge, "right": edge}
    return r3d.box_quads(73, 5, 22.5, tex, pos=pos, yaw=yaw, sheen=0.08, layer=layer)

PACK_SH = lambda pos=(0, 0, 0), yaw=0, s=1.0: (-37, 37, -24, 24, 155, pos, yaw, s)
BK70_SH = lambda pos, yaw: (-36.5, 36.5, -11.25, 11.25, 5, pos, yaw, 0.8)
KSS_SH = lambda pos=(0, 0, 0), yaw=0, s=1.0: (-K.w, K.w, -K.d, K.d, K.H, pos, yaw, s)
LID_SH = (-K.w, K.w, -K.d - 1, -K.d + 2, K.H + K.FOLD, (0, 0, 0), 0, 0.5)
TAB_SH = (K.TAB_X[0], K.TAB_X[1], -K.d - 1, -K.d + 2, K.H + K.FOLD + K.TAB_H, (0, 0, 0), 0, 0.4)
KEY, SHADOW = (-0.5, 0.9, 0.6), (-0.30, 1.7, 0.45)

def shoot(q, shadows, target, dist, az, el, fov, size, pad=0.07, turn_light=False):
    Wd, Ht = size
    cam = r3d.Camera(target=target, dist=dist, az=az, el=el, fov=fov, W=Wd * 2, H=Ht * 2)
    light = r3d.roty(KEY, az) if turn_light else KEY
    sl = r3d.roty(SHADOW, az) if turn_light else SHADOW
    layers = r3d.render(q, cam, light=light, shadows=shadows, shadow_light=sl)
    return r3d.finish(layers, Wd, Ht, pad=pad)

shots = {}
# ── small box ────────────────────────────────────────────────────────────────
q = pack()
shots["small-front"] = shoot(q, [PACK_SH()], (0, 76, 0), 640, 30, 13, 26, (1400, 1700))
shots["small-back"] = shoot(q, [PACK_SH()], (0, 76, 0), 640, 210, 13, 26, (1400, 1700), turn_light=True)
shots["small-top"] = shoot(q, [PACK_SH()], (0, 110, 0), 560, 20, 58, 28, (1400, 1500))
aP, aY, bP, bY = (-46, 0, 10), -24, (58, 0, -34), 156
k1, k1y, k2, k2y = (-44, 0, 114), 8, (42, 0, 120), -10
q = (pack(bP, bY, layer=0) + pack(aP, aY, layer=1) + booklet70(k1, k1y, layer=2) + booklet70(k2, k2y, layer=2))
shots["small-with-booklets"] = shoot(q, [PACK_SH(aP, aY), PACK_SH(bP, bY), BK70_SH(k1, k1y), BK70_SH(k2, k2y)],
                                     (4, 74, 26), 700, 14, 16, 30, (1700, 1500), pad=0.05)

# ── big box ──────────────────────────────────────────────────────────────────
q = K.closed_box()
shots["big-front"] = shoot(q, [KSS_SH()], (0, 26, 0), 520, 34, 32, 28, (1700, 1350))
shots["big-back"] = shoot(q, [KSS_SH()], (0, 26, 0), 520, 214, 20, 28, (1700, 1350), turn_light=True)
shots["big-top"] = shoot(q, [KSS_SH()], (0, 30, 0), 520, 18, 66, 28, (1500, 1500))
bp, by = (K.w + 68, 0, 52), -14
q = K.open_box() + K.booklet(bp, by)
shots["big-open-display"] = shoot(q, [KSS_SH(), LID_SH, TAB_SH, (-55, 55, -13, 13, 4.3, bp, by, 0.85)],
                                  (34, 62, -8), 720, 24, 25, 30, (1600, 1500), pad=0.05)
q = K.booklet((0, 0, 0), 0)
shots["big-booklet"] = shoot(q, [(-55, 55, -13, 13, 4.3, (0, 0, 0), 0, 0.85)], (0, 2, 0), 300, 12, 40, 26, (1600, 900), pad=0.08)

for name, img in shots.items():
    img.save(OUT + f"Pepa-{name}.png", optimize=True)
    print("shot", name, img.size)

# ── every angle, per box ─────────────────────────────────────────────────────
PT = 300 / 72.0
FT = lambda pt, b=False: ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Arial" + (" Bold" if b else "") + ".ttf", int(pt * PT / 2.2))
INK, SOFT, BG = (30, 26, 22), (120, 110, 98), (244, 239, 230)

def grid(frames, title, sub, fw, fh, cols, out):
    S = 0.62; tw, th = int(fw * S), int(fh * S); PAD, GAP, HEAD = 56, 18, 150
    rows = (len(frames) + cols - 1) // cols
    Wd = PAD * 2 + cols * tw + (cols - 1) * GAP
    Ht = PAD + HEAD + rows * th + (rows - 1) * GAP + PAD
    sheet = Image.new("RGB", (Wd, Ht), BG); d = ImageDraw.Draw(sheet)
    d.text((PAD, PAD), title, font=FT(38, True), fill=INK)
    d.text((PAD, PAD + 70), sub, font=FT(22), fill=SOFT)
    for i, (label, img) in enumerate(frames):
        r, c = divmod(i, cols)
        x, y = PAD + c * (tw + GAP), PAD + HEAD + r * (th + GAP)
        sheet.paste(img.resize((tw, th), Image.LANCZOS), (x, y))
        d.text((x + 14, y + 10), label, font=FT(22, True), fill=SOFT)
    sheet.save(out, optimize=True)
    print("grid", os.path.basename(out), sheet.size)

views = [(az, 14, f"{az}°") for az in range(0, 360, 45)] + [(35, 58, "From above")]
q = pack(); frames = []
for az, el, label in views:
    frames.append((label, shoot(q, [PACK_SH()], (0, 72 if el < 40 else 60, 0), 560 if el < 40 else 600,
                                az, el, 26, (820, 1000), turn_light=True)))
grid(frames, "Pepa 70 × 36 — every angle", "Small box · 74 × 155 × 48 mm · final design", 820, 1000, 3,
     OUT + "Pepa-small-every-angle.png")

views = [(az, 24, f"{az}°") for az in range(0, 360, 45)] + [(25, 66, "From above")]
q = K.closed_box(); frames = []
for az, el, label in views:
    frames.append((label, shoot(q, [KSS_SH()], (0, 26 if el < 40 else 30, 0), 470, az, el, 28, (1000, 820), turn_light=True)))
grid(frames, "Pepa King Size Slim — every angle", "Big box · 112 × 126 × 55 mm · final design", 1000, 820, 3,
     OUT + "Pepa-big-every-angle.png")
