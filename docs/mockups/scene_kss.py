import sys, math, random; SP = sys.argv[1]; sys.path.insert(0, SP)
from PIL import Image
import r3d
from r3d import Quad, add, roty
F = SP + "/f/"
T = lambda n: Image.open(F + n + ".png")

W, H, D = 112, 55, 126
w, d = W/2, D/2
BOARD = (238, 230, 216)

def closed_box():
    tex = {"front": T("t_kss_front"), "back": T("t_kss_back"), "left": T("t_kss_left"),
           "right": T("t_kss_right"), "top": T("t_kss_lid")}
    q = r3d.box_quads(W, H, D, tex, sheen=0.10)
    # the lid's tuck flap sits just inside the front wall — it is what shows through the notch
    z = d - 1.2
    q.append(Quad([(-w+1.5, H-0.4, z), (w-1.5, H-0.4, z), (w-1.5, H-40, z), (-w+1.5, H-40, z)],
                  tex=T("t_kss_flap"), layer=-1, sheen=0, shade=0.80))
    return q

def open_box(tilt_deg=13):
    q = []
    tex = {"front": T("t_kss_front"), "back": T("t_kss_back"), "left": T("t_kss_left"), "right": T("t_kss_right")}
    q += r3d.box_quads(W, H, D, tex, sheen=0.10, layer=5)
    t = 1.2
    # inside faces of the carton
    q.append(Quad([(-w+t, H, -d+t), (w-t, H, -d+t), (w-t, 0, -d+t), (-w+t, 0, -d+t)], color=BOARD, layer=1, sheen=0))
    q.append(Quad([(-w+t, H, d-t), (-w+t, H, -d+t), (-w+t, 0, -d+t), (-w+t, 0, d-t)], color=BOARD, layer=1, sheen=0))
    q.append(Quad([(w-t, H, -d+t), (w-t, H, d-t), (w-t, 0, d-t), (w-t, 0, -d+t)], color=BOARD, layer=1, sheen=0))
    q.append(Quad([(w-t, H, d-t), (-w+t, H, d-t), (-w+t, 0, d-t), (w-t, 0, d-t)], color=BOARD, layer=1, sheen=0))
    # wall rims — the board's cut edge catching light
    for cs in ([(-w, H, -d), (w, H, -d), (w, H, -d+t), (-w, H, -d+t)],
               [(-w, H, -d), (-w+t, H, -d), (-w+t, H, d), (-w, H, d)],
               [(w-t, H, -d), (w, H, -d), (w, H, d), (w-t, H, d)],
               [(-w, H, d-t), (-13, H, d-t), (-13, H, d), (-w, H, d)],
               [(13, H, d-t), (w, H, d-t), (w, H, d), (13, H, d)]):
        q.append(Quad(cs, color=(250, 244, 234), layer=6, sheen=0, shade=1.0))
    # the dark depth between booklets
    q.append(Quad([(-w+t, 51.2, -d+t), (w-t, 51.2, -d+t), (w-t, 51.2, d-t), (-w+t, 51.2, d-t)],
                  color=(96, 74, 58), layer=2, sheen=0, shade=1.0))
    # 25 booklets standing, spines up
    random.seed(7)
    spine = T("bk_spine"); cover = T("bk_front")
    n = 25; pitch = (D - 2*t) / n; thick = pitch - 0.55
    L = 109.2
    for i in range(n):
        zf = d - t - i*pitch
        zb = zf - thick
        top = 52.0 + random.uniform(-0.25, 0.25)
        q.append(Quad([(-L/2, top, zb), (L/2, top, zb), (L/2, top, zf), (-L/2, top, zf)],
                      tex=spine, layer=3, sheen=0.04, shade=random.uniform(0.90, 1.0)))
        # the fold of each cover is rounded, so its front edge catches the light
        q.append(Quad([(-L/2, top+0.02, zf-0.7), (L/2, top+0.02, zf-0.7), (L/2, top+0.02, zf), (-L/2, top+0.02, zf)],
                      color=(255, 246, 236), layer=4, sheen=0, shade=1.0))
        if i == 0:
            q.append(Quad([(-L/2, top, zf), (L/2, top, zf), (L/2, top-26, zf), (-L/2, top-26, zf)],
                          tex=cover, layer=3, sheen=0.05))
    # the lid, stood up as the display
    a = math.radians(tilt_deg)
    up = (0, math.cos(a), -math.sin(a))
    base_l, base_r = (-w, H, -d), (w, H, -d)
    at = lambda p, s: add(p, (up[0]*s, up[1]*s, up[2]*s))
    q.append(Quad([at(base_l, 126), at(base_r, 126), base_r, base_l], tex=T("t_kss_lid"), layer=0, sheen=0.14))
    flap = T("t_kss_flap").rotate(180)
    q.append(Quad([at(base_l, 166), at(base_r, 166), at(base_r, 126), at(base_l, 126)], tex=flap, layer=0, sheen=0.14))
    return q

def booklet(pos, yaw):
    L, Tk, Wd = 110, 4.3, 26
    tex = {"top": T("bk_front"), "front": (214, 194, 166), "right": (206, 186, 158), "left": (206, 186, 158)}
    return r3d.box_quads(L, Tk, Wd, tex, pos=pos, yaw=yaw, sheen=0.08, layer=7)

if __name__ == "__main__":
    which = sys.argv[2] if len(sys.argv) > 2 else "all"
    box_shadow = (-w, w, -d, d, H, (0, 0, 0), 0, 1.0)
    if which in ("all", "closed"):
        q = closed_box()
        for name, az, light in (("front", 34, (-0.45, 0.95, 0.55)), ("back", 214, (0.45, 0.95, -0.55))):
            cam = r3d.Camera(target=(0, 24, 0), dist=410, az=az, el=34, fov=26, W=1700, H=1400)
            layers = r3d.render(q, cam, light=light, shadows=[box_shadow])
            r3d.finish(layers, 1700, 1400, pad=0.10).save(SP + f"/kss_closed_{name}.png")
            print("rendered closed", name)
    if which in ("all", "open"):
        bpos, byaw = (w + 78, 0, 42), -16
        q = open_box() + booklet(bpos, byaw)
        shadows = [box_shadow, (-w, w, -d-18, -d, 150, (0, 0, 0), 0, 0.55),
                   (-55, 55, -13, 13, 4.3, bpos, byaw, 0.85)]
        cam = r3d.Camera(target=(34, 74, -14), dist=640, az=24, el=25, fov=30, W=1900, H=1700)
        layers = r3d.render(q, cam, light=(-0.45, 0.95, 0.60), shadows=shadows)
        r3d.finish(layers, 1900, 1700, pad=0.06).save(SP + "/kss_open.png")
        print("rendered open")
