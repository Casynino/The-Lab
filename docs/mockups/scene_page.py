"""Pictures for the Pepa Ndogo page behind the QR on the 70 x 36 box: the box
itself, the box open as a display with its booklets (laid out like the OHIS
display the owner sent), and front and back with booklets. On the page's own
paper colour so they sit in the page."""
import sys, os
W = sys.argv[1]; sys.path.insert(0, W)
from PIL import Image
import r3d
import scene_small_display as SD
booklet70 = SD.booklet70
F = W + "/f/"; T = lambda n: Image.open(F + n + ".png")
PAPER = (246, 241, 231)
OUT = os.path.join(W, "page"); os.makedirs(OUT, exist_ok=True)

def pack(pos=(0, 0, 0), yaw=0, layer=0):
    tex = {"front": T("t_n70_front"), "back": T("t_n70_back"), "left": T("t_n70_left"),
           "right": T("t_n70_right"), "top": T("t_n70_top")}
    return r3d.box_quads(74, 155, 48, tex, pos=pos, yaw=yaw, sheen=0.12, layer=layer)

PACK_SH = lambda pos=(0, 0, 0), yaw=0, s=1.0: (-37, 37, -24, 24, 155, pos, yaw, s)
BK_SH = lambda pos, yaw: (-36.5, 36.5, -11.25, 11.25, 5, pos, yaw, 0.8)

def shoot(q, sh, target, dist, az, el, fov, size, pad):
    cam = r3d.Camera(target=target, dist=dist, az=az, el=el, fov=fov, W=size[0] * 2, H=size[1] * 2)
    layers = r3d.render(q, cam, light=(-0.45, 0.95, 0.6), shadows=sh)
    return r3d.finish(layers, size[0], size[1], pad=pad, bg=Image.new("RGB", size, PAPER))

scenes = {}
scenes["hero"] = shoot(pack(), [PACK_SH()], (0, 76, 0), 640, 30, 13, 26, (1100, 1300), 0.06)

scenes["open"] = SD.scene(bg=Image.new("RGB", (1200, 1060), PAPER), size=(1200, 1060))

aP, aY, bP, bY = (-46, 0, 10), -24, (58, 0, -34), 156
k1, k1y, k2, k2y = (-44, 0, 114), 8, (42, 0, 120), -10
q = pack(bP, bY, layer=0) + pack(aP, aY, layer=1) + booklet70(k1, k1y, layer=2) + booklet70(k2, k2y, layer=2)
scenes["pair"] = shoot(q, [PACK_SH(aP, aY), PACK_SH(bP, bY), BK_SH(k1, k1y), BK_SH(k2, k2y)],
                       (4, 74, 26), 700, 14, 16, 30, (1200, 1080), 0.04)

for name, img in scenes.items():
    img.save(os.path.join(OUT, name + "-full.png"))
    print("rendered", name, img.size)
