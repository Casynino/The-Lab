"""The images for the public page, on the page's own paper colour so they sit
in it rather than on a card. Each scene is framed for a phone column."""
import sys, os, hashlib; SP = sys.argv[1]; sys.path.insert(0, SP)
from PIL import Image
import r3d
import scene_kss as K
F = SP + "/f/"
T = lambda n: Image.open(F + n + ".png")
PAPER = (246, 241, 231)
paper = lambda W, H: Image.new("RGB", (W, H), PAPER)

def pack(pos=(0, 0, 0), yaw=0, layer=0):
    tex = {"front": T("t_n70_front"), "back": T("t_n70_back"), "left": T("t_n70_left"),
           "right": T("t_n70_right"), "top": T("t_n70_top")}
    return r3d.box_quads(74, 155, 48, tex, pos=pos, yaw=yaw, sheen=0.12, layer=layer)

def booklet70(pos=(0, 0, 0), yaw=0, y0=0, layer=0):
    edge = (222, 204, 178)
    tex = {"top": T("bk70_front"), "front": T("bk70_spine"), "left": edge, "right": edge}
    return r3d.box_quads(73, 5, 22.5, tex, pos=pos, yaw=yaw, y0=y0, sheen=0.08, layer=layer)

def pack_shadow(pos, yaw, s=1.0): return (-37, 37, -24, 24, 155, pos, yaw, s)
def bk70_shadow(pos, yaw, h=5, s=0.8): return (-36.5, 36.5, -11.25, 11.25, h, pos, yaw, s)
def kss_shadow(pos=(0, 0, 0), yaw=0, s=1.0): return (-K.w, K.w, -K.d, K.d, K.H, pos, yaw, s)

def shoot(quads, shadows, cam, W, H, pad, light=(-0.45, 0.95, 0.6)):
    # The camera canvas is twice the output and the camera stands well back,
    # so nothing is clipped at the frame edge; finish() fits it down.
    layers = r3d.render(quads, cam, light=light, shadows=shadows)
    return r3d.finish(layers, W, H, pad=pad, bg=paper(W, H))

scenes = {}

# 1 ── both products together ────────────────────────────────────────────────
np_, ny = (-K.w - 64, 0, 26), 30
bp, by = (K.w + 68, 0, 52), -14
b70p, b70y = (-K.w - 40, 0, 104), 12
q = (K.open_box() + K.booklet(bp, by)
     + r3d.transform(pack(), np_, ny, layer=8) + booklet70(b70p, b70y, layer=9))
sh = [kss_shadow(), (-K.w, K.w, -K.d-18, -K.d, 150, (0, 0, 0), 0, 0.5),
      (-55, 55, -13, 13, 4.3, bp, by, 0.85), pack_shadow(np_, ny), bk70_shadow(b70p, b70y)]
cam = r3d.Camera(target=(-8, 70, 18), dist=820, az=20, el=22, fov=32, W=2800, H=2100)
scenes["range"] = shoot(q, sh, cam, 1400, 1050, 0.04)

# 2 ── the small pack, front and back, with its booklets ──────────────────────
aP, aY = (-46, 0, 10), -24
bP, bY = (58, 0, -34), 180 - 24
# Side by side, never stacked: stacked, the lower booklet's logo peeked out
# beside the upper one's "50" and it read as "30 LEAVES".
k1, k1y = (-44, 0, 114), 8
k2, k2y = (42, 0, 120), -10
q = (pack(bP, bY, layer=0) + pack(aP, aY, layer=1)
     + booklet70(k1, k1y, layer=2) + booklet70(k2, k2y, layer=2))
sh = [pack_shadow(aP, aY), pack_shadow(bP, bY), bk70_shadow(k1, k1y), bk70_shadow(k2, k2y)]
cam = r3d.Camera(target=(4, 74, 26), dist=640, az=14, el=16, fov=30, W=2400, H=2160)
scenes["small"] = shoot(q, sh, cam, 1200, 1080, 0.04)

# 3 ── the King Size box open as a display ────────────────────────────────────
q = K.open_box() + K.booklet(bp, by)
sh = [kss_shadow(), (-K.w, K.w, -K.d-18, -K.d, 150, (0, 0, 0), 0, 0.5), (-55, 55, -13, 13, 4.3, bp, by, 0.85)]
cam = r3d.Camera(target=(34, 72, -14), dist=720, az=24, el=25, fov=30, W=2400, H=2160)
scenes["kss-open"] = shoot(q, sh, cam, 1200, 1080, 0.04)

# 4 ── the King Size box closed, from the front ───────────────────────────────
q = K.closed_box()
sh = [kss_shadow()]
cam = r3d.Camera(target=(0, 24, 0), dist=460, az=32, el=33, fov=30, W=2400, H=1720)
scenes["kss-closed"] = shoot(q, sh, cam, 1200, 860, 0.05)

out = os.path.join(SP, "page"); os.makedirs(out, exist_ok=True)
for name, img in scenes.items():
    img.save(os.path.join(out, name + "-full.png"))
    print("rendered", name, img.size)
