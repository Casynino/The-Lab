"""The 70 x 36 pack open as a counter display, laid out like the OHIS display
the owner sent: the carton lying down as a tray, booklets standing in rows,
the lid stood up behind as a header, one booklet beside it.

Lying down the carton is 74 wide, 155 long, 48 tall. A 73 x 22.5 x 5 mm
booklet stands across the 74 mm width; two layers of 22.5 mm fill the 48 mm
height; 25 to a layer along the 155 mm length makes 50. The long side panels
— sideways on a standing box — read level this way up. The lid hinges on the
74 mm end panel, and its cut 77 mm from that hinge is where the header stands.
Every wall is shown with its art reading level, and the header with the
lid's top half facing forward, as the OHIS display does."""
import sys, math, random
W = sys.argv[1]; sys.path.insert(0, W)
from PIL import Image
import r3d
from r3d import Quad, add, roty

F = W + "/f/"; OUT = W + "/out/"
T = lambda n: Image.open(F + n + ".png")
K = 300 / 25.4
BOARD = (238, 230, 216)
EDGE = (222, 204, 178)

X, Y, Z = 74.0, 48.0, 155.0
w, d, t = X / 2, Z / 2, 1.0
HEADER = 346.5 - 269.57                                  # 76.9 mm

lid = T("t_n70_front")
header_tex = lid.crop((0, 0, lid.width, round(HEADER * K - 4)))

def tray(pos=(0, 0, 0), yaw=0, lean=10.0, seed=5):
    q = []
    L = lambda cs, **kw: q.append(Quad(cs, **kw))
    # header: stood up on the back edge, leaning back a little
    a = math.radians(6)
    top = (0, Y + HEADER * math.cos(a), -d - HEADER * math.sin(a))
    L([(-w, top[1], top[2]), (w, top[1], top[2]), (w, Y, -d), (-w, Y, -d)], tex=header_tex, layer=0, sheen=0.12)
    # inside the tray
    L([(-w + t, Y, -d + t), (w - t, Y, -d + t), (w - t, 0, -d + t), (-w + t, 0, -d + t)], color=BOARD, layer=1, sheen=0)
    L([(-w + t, Y, d - t), (-w + t, Y, -d + t), (-w + t, 0, -d + t), (-w + t, 0, d - t)], color=BOARD, layer=1, sheen=0)
    L([(-w + t, 24.2, -d + t), (w - t, 24.2, -d + t), (w - t, 24.2, d - t), (-w + t, 24.2, d - t)],
      color=(92, 72, 56), layer=1, sheen=0, shade=1.0)
    # the top layer of booklets, spines up, leaning back together
    random.seed(seed)
    spine, cover = T("bk70_spine"), T("bk70_front")
    L_, H_, TH = 73.0, 22.5, 5.0
    s, c = math.sin(math.radians(lean)), math.cos(math.radians(lean))
    rows = 25
    pitch = (Z - 2 * t - TH - H_ * s) / (rows - 1)
    for i in reversed(range(rows)):                       # back to front, so nearer rows cover
        zf = d - t - i * pitch                            # front face, at the bottom
        y0 = 24.2
        jx = random.uniform(-0.3, 0.3)
        x0, x1 = -L_ / 2 + jx, L_ / 2 + jx
        up = (0, H_ * c, -H_ * s)
        ftl = (0, y0 + up[1], zf + up[2]); fbl = (0, y0, zf)
        btl = (0, ftl[1], ftl[2] - TH)
        P = lambda x, p: (x, p[1], p[2])
        L([P(x0, ftl), P(x1, ftl), P(x1, fbl), P(x0, fbl)], tex=cover, layer=2, sheen=0.04,
          shade=random.uniform(0.93, 1.0))
        L([P(x0, btl), P(x1, btl), P(x1, ftl), P(x0, ftl)], tex=spine, layer=2, sheen=0.03,
          shade=random.uniform(0.94, 1.02))
    # outside walls, art reading level
    tex = {"front": T("t_n70_bottom").rotate(180), "back": T("t_n70_top").rotate(180),
           "right": T("t_n70_right").rotate(90, expand=True), "left": T("t_n70_left").rotate(-90, expand=True)}
    q += r3d.box_quads(X, Y, Z, tex, sheen=0.12, layer=3)
    RIM = (250, 244, 234)
    for cs in ([(-w, Y, -d), (w, Y, -d), (w, Y, -d + t), (-w, Y, -d + t)],
               [(-w, Y, d - t), (w, Y, d - t), (w, Y, d), (-w, Y, d)],
               [(-w, Y, -d), (-w + t, Y, -d), (-w + t, Y, d), (-w, Y, d)],
               [(w - t, Y, -d), (w, Y, -d), (w, Y, d), (w - t, Y, d)]):
        L(cs, color=RIM, layer=4, sheen=0, shade=1.0)
    return r3d.transform(q, pos, yaw), top[1]

def booklet70(pos, yaw, layer=6):
    tex = {"top": T("bk70_front"), "front": T("bk70_spine"), "left": EDGE, "right": EDGE}
    return r3d.box_quads(73, 5, 22.5, tex, pos=pos, yaw=yaw, sheen=0.08, layer=layer)

def scene(bg=None, size=(1700, 1500), name="small-open-display"):
    q, header_top = tray()
    bpos, byaw = (82, 0, 52), -22
    q += booklet70(bpos, byaw)
    shadows = [(-w, w, -d, d, Y, (0, 0, 0), 0, 1.0),
               (-w, w, -d - 10, -d, header_top, (0, 0, 0), 0, 0.5),
               (-36.5, 36.5, -11.25, 11.25, 5, bpos, byaw, 0.8)]
    cam = r3d.Camera(target=(14, 52, -8), dist=760, az=38, el=27, fov=30, W=size[0] * 2, H=size[1] * 2)
    layers = r3d.render(q, cam, light=(-0.45, 0.95, 0.6), shadows=shadows)
    return r3d.finish(layers, size[0], size[1], pad=0.05, bg=bg)

if __name__ == "__main__":
    img = scene()
    img.save(OUT + "Pepa-small-open-display.png", optimize=True)
    print("rendered", img.size)
