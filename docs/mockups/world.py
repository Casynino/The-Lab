"""The sign-in scene, rendered as a looping film.

Nino, 9 Nov 2026, holding up bongolife.app, BlueWave and Super Drive: the
whole page should be the scene — the map, the road, the bike, the lorries
(branded), the ship, people working — moving like film, not sliding like
cut-outs. Bongo Life does it with a 5.6 MB MP4. This does it with an animated
WebP rendered here, in 3D, by the same renderer that makes the carton
mockups (r3d.py): one night at the Lab, a road out to the regions, a coast.

    python3 docs/mockups/world.py --preview portrait     one frame, to look at
    python3 docs/mockups/world.py --preview landscape
    python3 docs/mockups/world.py --loop portrait        the full loop (minutes)
    python3 docs/mockups/world.py --loop landscape

Writes into client/public/scene/:
    portrait.webp, portrait-poster.webp     phones (1080 x 1620)
    landscape.webp, landscape-poster.webp   computers (1920 x 1080)

Everything periodic divides the loop exactly, so it joins without a seam: a
lorry takes the whole loop to run the road, the second one is half a loop
behind, the bike runs it once, the ship crosses its lane once, the forklift
and the people ping-pong twice.

Units are arbitrary; a lorry is ~420 long. X runs along the dock, Z runs away
from it, Y is up.
"""

import math, os, sys, argparse, time, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import r3d
import ohis
import civlily

PUB = os.path.normpath(os.path.join(HERE, "..", "..", "client", "public"))
OUT = os.path.join(PUB, "scene")
os.makedirs(OUT, exist_ok=True)

FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
font = lambda size: ImageFont.truetype(FONT, size)

# ── materials: top face, side faces, end faces ──────────────────────────────
def M(top, side, end): return (top, side, end)
GROUND = M((60, 48, 44), (48, 38, 36), (54, 43, 40))
WATER = M((30, 34, 54), (22, 25, 40), (26, 29, 46))
TARMAC = M((70, 62, 60), (50, 44, 42), (58, 52, 50))
DASH = M((214, 204, 194), (160, 150, 142), (180, 170, 160))
WALL = M((236, 229, 224), (198, 188, 182), (218, 210, 204))
ROOF = M((252, 92, 74), (190, 30, 20), (222, 42, 30))
DARK = M((22, 15, 14), (14, 10, 9), (18, 12, 11))
STEEL = M((96, 86, 84), (64, 56, 54), (78, 70, 68))
BODY = M((250, 244, 240), (224, 214, 208), (238, 230, 225))
RED = M((255, 86, 68), (210, 36, 24), (238, 49, 36))
GLASS = M((54, 26, 22), (40, 18, 15), (46, 20, 17))
TYRE = M((28, 15, 13), (18, 10, 9), (22, 12, 11))
HI = M((255, 214, 92), (214, 168, 48), (234, 190, 66))
SKIN = M((122, 84, 62), (96, 64, 46), (108, 74, 54))
LAMP = M((255, 236, 200), (255, 236, 200), (255, 236, 200))
CARD = M((234, 202, 160), (192, 158, 116), (214, 181, 137))
NAVY = M((54, 60, 78), (36, 40, 54), (44, 49, 66))
FIELD = M((78, 60, 48), (0, 0, 0), (0, 0, 0))
FIELD2 = M((66, 56, 50), (0, 0, 0), (0, 0, 0))
BUSH = M((46, 50, 34), (28, 30, 20), (36, 40, 26))
HOUSE = M((206, 196, 190), (160, 150, 144), (184, 174, 168))
TIN = M((110, 96, 90), (74, 64, 60), (90, 78, 74))
QUAY = M((120, 110, 106), (84, 76, 72), (100, 92, 88))
TAN = M((234, 178, 112), (190, 132, 74), (212, 154, 92))
CONC = M((226, 210, 186), (182, 166, 144), (204, 188, 166))
BLUE = M((64, 128, 226), (40, 88, 172), (52, 106, 198))
GREEN = M((70, 176, 96), (40, 124, 64), (54, 150, 78))
PINK = M((242, 124, 176), (192, 84, 134), (216, 104, 154))
PURPLE = M((156, 92, 206), (104, 58, 152), (128, 74, 178))
SHIRTS = (HI, RED, BLUE, GREEN, PINK, BODY)
CLEAR = Image.new("RGBA", (4, 4), (0, 0, 0, 0))

def f(mat, **over):
    top, side, end = mat
    d = {"top": top, "right": side, "left": side, "front": end, "back": end}
    d.update(over)
    return d


def flat(W, D, mat, pos, yaw=0, y0=0, layer=0):
    """A surface, not a box: only the top face, and no sheen. The ground was
    drawn as boxes with sheen and every tile shaded itself differently, so the
    plain showed as a patchwork; the road was 150 little boxes and from a low
    angle their side faces stepped like a saw."""
    return r3d.box_quads(W, 1, D, {"top": mat[0]}, pos=pos, yaw=yaw, y0=y0, layer=layer, sheen=0.0)


# ── the brand, as textures ──────────────────────────────────────────────────
_mark = Image.open(os.path.join(PUB, "brand", "hao-mark.png")).convert("RGBA")
_lockup = Image.open(os.path.join(PUB, "brand", "hao-labs-dark.png")).convert("RGBA")
# The Pepa label, cut from the top of the 77x44 box render: it goes on the
# Pepa cartons. Nino, 10 Nov 2026: the brand is not to be shouted from
# billboards; it is to be on the boxes — big ones and small ones — moving
# through the picture.
PEPA_ART = Image.open(os.path.join(HERE, "product-src", "pepa-77x44-front.png")).convert("RGBA").crop((560, 200, 1440, 660))


def fit(im, w, h):
    s = min(w / im.width, h / im.height)
    return im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)


def panel_lorry(w=560, h=340):
    """The long side of a lorry: white, a red band, the mark, the name."""
    im = Image.new("RGBA", (w, h), (246, 240, 236, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([0, int(h * 0.63), w, int(h * 0.71)], fill=(238, 49, 36, 255))
    m = fit(_mark, int(w * 0.30), int(h * 0.42))
    im.alpha_composite(m, (int(w * 0.07), int(h * 0.12)))
    d.text((int(w * 0.42), int(h * 0.20)), "HAO LABS", font=font(int(h * 0.19)), fill=(26, 18, 17, 255))
    d.text((int(w * 0.42), int(h * 0.42)), "DISTRIBUTION", font=font(int(h * 0.10)), fill=(238, 49, 36, 255))
    return im


def panel_wall(w=800, h=260):
    """The shed's front wall: the mark, large, between the bays."""
    im = Image.new("RGBA", (w, h), (236, 229, 224, 255))
    m = fit(_mark, int(w * 0.22), int(h * 0.6))
    im.alpha_composite(m, ((w - m.width) // 2, int(h * 0.12)))
    d = ImageDraw.Draw(im)
    d.text(((w) // 2, int(h * 0.84)), "HAO LABS", font=font(int(h * 0.11)), fill=(26, 18, 17, 255), anchor="mm")
    return im


def panel_container(w=400, h=180, red=True, name=None):
    base = (226, 42, 30, 255) if red else (238, 231, 226, 255)
    im = Image.new("RGBA", (w, h), base)
    d = ImageDraw.Draw(im)
    for x in range(0, w, 14):
        d.rectangle([x, 0, x + 3, h], fill=(0, 0, 0, 38))
    m = fit(_mark, int(w * 0.22), int(h * 0.5))
    if not red:
        im.alpha_composite(m, (int(w * 0.06), int(h * 0.22)))
    else:
        white = Image.new("RGBA", m.size, (255, 255, 255, 0)); white.putalpha(m.split()[3])
        im.alpha_composite(white, (int(w * 0.06), int(h * 0.22)))
    if name:
        d.text((int(w * 0.62), int(h * 0.5)), name, font=font(int(h * 0.36)),
               fill=(255, 255, 255, 255) if red else (26, 18, 17, 255), anchor="mm")
    return im


def disc(spin, r=64):
    """A wheel seen from the side: tyre, rim, and a hub mark that turns."""
    im = Image.new("RGBA", (2 * r, 2 * r), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([0, 0, 2 * r - 1, 2 * r - 1], fill=(26, 14, 12, 255))
    d.ellipse([r * 0.42, r * 0.42, r * 1.58, r * 1.58], fill=(150, 132, 128, 255))
    d.ellipse([r * 0.8, r * 0.8, r * 1.2, r * 1.2], fill=(60, 50, 48, 255))
    for k in range(5):
        a = spin + k * 2 * math.pi / 5
        d.line([(r + r * 0.28 * math.cos(a), r + r * 0.28 * math.sin(a)),
                (r + r * 0.55 * math.cos(a), r + r * 0.55 * math.sin(a))], fill=(60, 50, 48, 255), width=max(2, r // 10))
    return im


def panel_sign(w=600, h=144):
    im = Image.new("RGBA", (w, h), (246, 240, 236, 255))
    l = fit(_lockup, int(w * 0.84), int(h * 0.7))
    # the lockup is white-on-dark; the board is light, so take the word dark
    r, g, b, a = l.split()
    dark = Image.new("RGBA", l.size, (26, 18, 17, 255))
    red = Image.merge("RGBA", (r, g, b, a))
    # keep the red mark as is, turn the white word dark: white pixels are those with r>200 and g>200
    px = red.load(); dp = dark.load(); out = Image.new("RGBA", l.size, (0, 0, 0, 0)); op = out.load()
    for y in range(l.height):
        for x in range(l.width):
            rr, gg, bb, aa = px[x, y]
            op[x, y] = (26, 18, 17, aa) if (rr > 180 and gg > 180 and bb > 180) else (rr, gg, bb, aa)
    im.alpha_composite(out, ((w - l.width) // 2, (h - l.height) // 2))
    return im


def panel_arcade(w=1200, h=110, n=9):
    """Kariakoo's crown: a row of arches between pale pillars, the way the
    1974 market reads in every painting of it."""
    im = Image.new("RGBA", (w, h), (216, 200, 176, 255))
    d = ImageDraw.Draw(im)
    cell = w / n
    for i in range(n):
        x0 = i * cell
        d.rectangle([x0, 0, x0 + cell * 0.14, h], fill=(236, 222, 200, 255))
        ax0, ax1 = x0 + cell * 0.2, x0 + cell * 0.94
        r = (ax1 - ax0) / 2
        d.rectangle([ax0, h * 0.3 + r, ax1, h], fill=(38, 24, 20, 255))
        d.ellipse([ax0, h * 0.3, ax1, h * 0.3 + 2 * r], fill=(38, 24, 20, 255))
    d.rectangle([0, 0, w, h * 0.08], fill=(172, 156, 134, 255))
    return im


def panel_shops(w=1200, h=240):
    """The ground floor: a run of dark shop openings, each with its own
    coloured awning."""
    im = Image.new("RGBA", (w, h), (234, 178, 112, 255))
    d = ImageDraw.Draw(im)
    top = h * 0.16
    d.rectangle([0, 0, w, top], fill=(238, 196, 60, 255))
    for x in range(int(w * 0.03), w, int(w * 0.11)):
        d.rectangle([x, top * 0.3, x + w * 0.05, top * 0.7], fill=(40, 28, 24, 255))
    n = 7
    cell = w / n
    cols = [(238, 49, 36), (255, 214, 92), (70, 176, 96), (64, 128, 226), (242, 124, 176), (238, 49, 36), (255, 214, 92)]
    for i in range(n):
        x0 = i * cell + cell * 0.12
        x1 = i * cell + cell * 0.88
        d.rectangle([x0, top + (h - top) * 0.28, x1, h], fill=(38, 24, 20, 255))
        d.rectangle([x0 - cell * 0.04, top + (h - top) * 0.2, x1 + cell * 0.04, top + (h - top) * 0.34], fill=cols[i] + (255,))
    return im


def panel_roof(w=820, h=580, nx=6, nz=4):
    """The roof from above: the grid of concrete funnels, each a square that
    drains to its own dark centre."""
    im = Image.new("RGBA", (w, h), (206, 190, 166, 255))
    d = ImageDraw.Draw(im)
    cw, ch = w / nx, h / nz
    for i in range(nx):
        for j in range(nz):
            x0, y0 = i * cw, j * ch
            d.rectangle([x0, y0, x0 + cw, y0 + ch], outline=(228, 214, 192, 255), width=4)
            for k, c in ((0.3, (190, 174, 150)), (0.16, (166, 150, 128)), (0.06, (110, 96, 80))):
                d.rectangle([x0 + cw / 2 - cw * k, y0 + ch / 2 - ch * k, x0 + cw / 2 + cw * k, y0 + ch / 2 + ch * k], fill=c + (255,))
    return im


def panel_flag(w=120, h=72):
    """Tanzania's flag: green, a black band edged in yellow, blue."""
    im = Image.new("RGBA", (w, h), (30, 150, 60, 255))
    d = ImageDraw.Draw(im)
    d.polygon([(0, h), (w, 0), (w, h)], fill=(40, 100, 210, 255))
    k = 0.22
    d.polygon([(0, h), (w * k, h), (w, h * k), (w, 0), (w - w * k, 0), (0, h - h * k)], fill=(255, 210, 60, 255))
    k2 = 0.14
    d.polygon([(0, h), (w * k2, h), (w, h * k2), (w, 0), (w - w * k2, 0), (0, h - h * k2)], fill=(20, 18, 18, 255))
    return im


def panel_bus(w=460, h=220):
    """A daladala's long side: white, a purple skirt with the route on it, a
    run of blue windows."""
    im = Image.new("RGBA", (w, h), (248, 244, 240, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([0, h * 0.6, w, h * 0.82], fill=(156, 92, 206, 255))
    d.rectangle([0, h * 0.82, w, h], fill=(120, 110, 116, 255))
    d.rectangle([0, h * 0.14, w, h * 0.5], fill=(70, 120, 190, 255))
    for x in range(0, w, 64):
        d.rectangle([x, h * 0.14, x + 6, h * 0.5], fill=(248, 244, 240, 255))
    return im


def panel_plane(w=560, h=70):
    """A cargo plane's flank: the mark at the nose, the name, a red cheat line."""
    im = Image.new("RGBA", (w, h), (248, 244, 240, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([0, h * 0.6, w, h * 0.72], fill=(238, 49, 36, 255))
    m = fit(_mark, int(w * 0.09), int(h * 0.5))
    im.alpha_composite(m, (int(w * 0.05), int(h * 0.1)))
    d.text((int(w * 0.17), int(h * 0.3)), "HAO LABS", font=font(int(h * 0.34)), fill=(26, 18, 17, 255), anchor="lm")
    d.text((int(w * 0.52), int(h * 0.3)), "CARGO", font=font(int(h * 0.22)), fill=(238, 49, 36, 255), anchor="lm")
    for x in range(int(w * 0.66), int(w * 0.96), 22):
        d.rectangle([x, h * 0.26, x + 10, h * 0.42], fill=(40, 48, 70, 255))
    return im


def disc_umbrella(cols, r=48):
    """A market umbrella from above: wedges of colour, round."""
    im = Image.new("RGBA", (2 * r, 2 * r), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    n = len(cols)
    for i, c in enumerate(cols):
        d.pieslice([0, 0, 2 * r - 1, 2 * r - 1], i * 360 / n, (i + 1) * 360 / n, fill=c + (255,))
    d.ellipse([r - 4, r - 4, r + 4, r + 4], fill=(40, 30, 26, 255))
    return im


UMBRELLAS = [disc_umbrella(c) for c in (
    ((238, 49, 36), (255, 214, 92), (70, 176, 96), (64, 128, 226)),
    ((64, 128, 226), (248, 244, 240)),
    ((238, 49, 36), (248, 244, 240)),
    ((255, 214, 92), (70, 176, 96), (238, 49, 36)),
)]
ARCADE_F = panel_arcade(n=9)
ARCADE_S = panel_arcade(w=820, n=6)
SHOPS_F = panel_shops()
SHOPS_S = panel_shops(w=820)
ROOF_TEX = panel_roof()
FLAG = panel_flag()
BUS_SIDE = panel_bus()
PLANE_SIDE = panel_plane()
LORRY_SIDE = panel_lorry()
SIGN_TEX = panel_sign()
WALL_TEX = panel_wall()
CONT_RED = panel_container(red=True)
CONT_WHITE = panel_container(red=False)


OHIS = ohis.faces(46 / 74)
CIV = civlily.faces(112 / 125)


def pepa_faces():
    """A Pepa master carton: kraft, the peach label on every side, the mark
    small in a corner, tape on the lid — built with the OHIS carton's own
    paper and lid so the two sit together as one shipment."""
    W, H = 740, 560
    fr = ohis.paper(W, H).convert("RGBA")
    lab = PEPA_ART.resize((int(W * 0.72), int(W * 0.72 * PEPA_ART.height / PEPA_ART.width)), Image.LANCZOS)
    fr.alpha_composite(lab, ((W - lab.width) // 2, (H - lab.height) // 2))
    m = fit(_mark, int(W * 0.1), int(H * 0.12))
    fr.alpha_composite(m, (int(W * 0.04), int(H * 0.82)))
    d = ImageDraw.Draw(fr)
    d.text((int(W * 0.96), int(H * 0.88)), "HAO LABS", font=font(int(H * 0.06)), fill=(58, 42, 26, 255), anchor="rm")
    dw = int(W * 0.62)
    return {"front": fr, "back": fr.transpose(Image.FLIP_LEFT_RIGHT), "left": ohis.side(dw, H).convert("RGBA"),
            "right": ohis.side(dw, H).convert("RGBA"), "top": ohis.lid(W, dw).convert("RGBA")}


PEPA = pepa_faces()
CARTONS = (OHIS, CIV, PEPA)
BIG = (58, 46, 58)                  # a master carton
SMALL = (30, 22, 30)                # an inner box, the one a hand carries


def carton(pos, yaw, brand, size=BIG, y0=0, layer=0):
    w, h, d = size
    return r3d.box_quads(w, h, d, brand, pos=pos, yaw=yaw, y0=y0, layer=layer)


def stack(pos, yaw, rnd, layers=2, smalls=3, layer=0):
    """A pallet of master cartons, two by two, a few inner boxes on top: the
    stock as it stands on the apron and outside every depot."""
    q = r3d.box_quads(124, 12, 124, f(STEEL), pos=pos, yaw=yaw, y0=0, layer=layer)
    w, h, d = BIG
    for lvl in range(layers):
        for (dx, dz) in ((-30, -30), (30, -30), (-30, 30), (30, 30)):
            off = yaw_about((dx, 0, dz), yaw)
            q += carton((pos[0] + off[0], 0, pos[2] + off[2]), yaw + rnd.uniform(-6, 6), CARTONS[rnd.randrange(3)],
                        y0=12 + lvl * h, layer=layer)
    top = 12 + layers * h
    for i in range(smalls):
        off = yaw_about((rnd.uniform(-34, 34), 0, rnd.uniform(-34, 34)), yaw)
        q += carton((pos[0] + off[0], 0, pos[2] + off[2]), yaw + rnd.uniform(-25, 25), CARTONS[rnd.randrange(3)],
                    size=SMALL, y0=top + (SMALL[1] if i == smalls - 1 and smalls > 2 else 0) * 0, layer=layer)
    return q


# ── the road: a spline with an arc-length table ─────────────────────────────
def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return tuple(0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2
                        + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3) for i in range(2))


class Road:
    def __init__(self, pts, samples=400):
        P = [pts[0]] + list(pts) + [pts[-1]]
        self.pts = []
        for i in range(1, len(P) - 2):
            for k in range(samples // (len(P) - 3)):
                self.pts.append(catmull(P[i - 1], P[i], P[i + 1], P[i + 2], k / (samples // (len(P) - 3))))
        self.pts.append(pts[-1])
        self.cum = [0.0]
        for a, b in zip(self.pts, self.pts[1:]):
            self.cum.append(self.cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        self.length = self.cum[-1]

    def at(self, s):
        """position (x, z) and heading (degrees, for yaw) at s in [0, 1]."""
        d = max(0.0, min(0.9999, s)) * self.length
        i = 0
        while self.cum[i + 1] < d: i += 1
        a, b = self.pts[i], self.pts[i + 1]
        seg = self.cum[i + 1] - self.cum[i]
        u = (d - self.cum[i]) / seg if seg else 0
        x, z = a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u
        # yaw turns a thing's nose (+X) toward (cos yaw, -sin yaw) on the
        # ground, so the heading along (dx, dz) is atan2(-dz, dx). It was
        # atan2(dx, dz) — a quarter turn out — and every lorry slid along the
        # road broadside (Nino, 10 Nov 2026: "the cars are moving sideways").
        yaw = math.degrees(math.atan2(-(b[1] - a[1]), b[0] - a[0]))
        return (x, z), yaw


# The road leaves along the front of the apron, bends away from the coast and
# runs inland to the far regions. The sea is on the near side, behind the
# camera's shoulder, so the port sits beside the Lab, which is where Dar is.
ROAD = Road([(-2800, 720), (-1800, 640), (-900, 580), (-200, 600), (700, 560), (1400, 260), (1950, -400), (2450, -1200), (2800, -2200), (3050, -3400), (3250, -4800), (3400, -6200)])
DEPOTS = [0.47, 0.62, 0.76]       # how far along the road each region sits
REGIONS = ["MOROGORO", "DODOMA", "MWANZA"]


def road_quads():
    q = []
    n = 150
    for i in range(n):
        (x0, z0), yaw = ROAD.at(i / n)
        (x1, z1), _ = ROAD.at((i + 1) / n)
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        seg = math.hypot(x1 - x0, z1 - z0) + 6
        q += flat(seg, 260, TARMAC, (cx, 0, cz), yaw=yaw, y0=2, layer=-1)
        q += flat(seg, 300, DARK, (cx, 0, cz), yaw=yaw, y0=1, layer=-1)       # the verge
        if i % 3 == 0:
            q += flat(seg * 0.5, 10, DASH, (cx, 0, cz), yaw=yaw, y0=3, layer=-1)
    return q


# ── the pieces ──────────────────────────────────────────────────────────────
def yaw_about(local, yaw):
    """box_quads rotates each box about its own pos; a vehicle is many boxes,
    so place parts relative to a heading."""
    a = math.radians(yaw)
    x, y, z = local
    return (x * math.cos(a) + z * math.sin(a), y, -x * math.sin(a) + z * math.cos(a))


def part(W, H, D, mat, pos, yaw, local, y0=0, layer=0, tex=None):
    lx, ly, lz = local
    off = yaw_about((lx, 0, lz), yaw)
    return r3d.box_quads(W, H, D, tex or f(mat), pos=(pos[0] + off[0], 0, pos[2] + off[2]), yaw=yaw, y0=y0 + ly, layer=layer)


def wheel(pos, yaw, local, r, spin, width=26, layer=0):
    """A tyre box whose outer faces carry a turning disc."""
    d = disc(spin)
    tex = f(TYRE, front=d, back=d)
    return part(width, 2 * r, 2 * r, TYRE, pos, yaw, (local[0], local[1], local[2]), y0=0, layer=layer, tex=tex)


def lorry(pos, yaw, spin, lit=True, layer=0, side=None):
    """Lorries drive along +X in their own frame: nose at +X."""
    side = side or LORRY_SIDE
    q = []
    q += part(420, 18, 112, STEEL, pos, yaw, (0, 26, 0), layer=layer)
    q += part(264, 160, 128, BODY, pos, yaw, (-68, 44, 0), layer=layer, tex=f(BODY, front=side, back=side))
    q += part(112, 112, 124, BODY, pos, yaw, (132, 44, 0), layer=layer)
    q += part(8, 48, 112, GLASS, pos, yaw, (188, 96, 0), layer=layer)
    q += part(80, 40, 128, GLASS, pos, yaw, (128, 100, 0), layer=layer)
    for dx in (-156, -68, 144):
        for dz in (-62, 62):
            q += wheel(pos, yaw, (dx, 0, dz), 30, spin, layer=layer)
    if lit:
        for dz in (-40, 40):
            hl = part(6, 14, 20, LAMP, pos, yaw, (192, 56, dz), layer=layer)
            for quad in hl: quad.shade = 1.18
            q += hl
    return q


def bike(pos, yaw, spin, stride, layer=0):
    """A boda with a box strapped on, rider leaning in."""
    q = []
    q += part(150, 10, 14, STEEL, pos, yaw, (0, 34, 0), layer=layer)           # frame
    q += part(12, 60, 10, STEEL, pos, yaw, (56, 34, 0), layer=layer)           # front fork
    q += part(36, 14, 30, STEEL, pos, yaw, (60, 90, 0), layer=layer)           # bars
    q += part(46, 22, 30, RED, pos, yaw, (-6, 50, 0), layer=layer)             # tank
    q += part(60, 46, 50, CARD, pos, yaw, (-62, 44, 0), layer=layer, tex=PEPA)  # the box on the rack
    q += wheel(pos, yaw, (60, 0, 0), 22, spin, width=12, layer=layer)
    q += wheel(pos, yaw, (-56, 0, 0), 22, spin, width=12, layer=layer)
    q += part(26, 44, 24, HI, pos, yaw, (-8, 64, 0), layer=layer)              # rider
    q += part(16, 16, 16, SKIN, pos, yaw, (4, 108, 0), layer=layer)
    q += part(22, 8, 8, DARK, pos, yaw, (10, 120, 0), layer=layer)             # helmet peak
    for k in (-1, 1):
        q += part(10, 38, 8, DARK, pos, yaw, (-4, 28, 14 * k), layer=layer)    # legs
    return q


def worker(pos, yaw, phase, layer=0, shirt=HI, box=None):
    """Walking: legs and arms swing with the phase, the box held in front."""
    sw = math.sin(phase * 2 * math.pi) * 14
    q = []
    q += part(20, 62, 22, DARK, pos, yaw, (sw, 0, -16), layer=layer)
    q += part(20, 62, 22, DARK, pos, yaw, (-sw, 0, 16), layer=layer)
    q += part(46, 66, 44, shirt, pos, yaw, (0, 62, 0), layer=layer)
    q += part(28, 28, 28, SKIN, pos, yaw, (0, 128, 0), layer=layer)
    q += part(62, 46, 50, CARD, pos, yaw, (42, 72, 0), layer=layer, tex=box or CARTONS[int(pos[0]) % 3])
    q += part(16, 16, 52, SKIN, pos, yaw, (22, 92, 0), layer=layer)
    return q


def forklift(pos, yaw, lift, layer=0):
    q = []
    q += part(118, 74, 84, HI, pos, yaw, (0, 22, 0), layer=layer)
    q += part(64, 46, 76, DARK, pos, yaw, (-26, 96, 0), layer=layer)
    for dx in (-52, 36):
        for dz in (-38, 38):
            q += part(10, 110, 10, STEEL, pos, yaw, (dx, 96, dz), layer=layer)
    q += part(110, 10, 92, STEEL, pos, yaw, (-8, 206, 0), layer=layer)
    for dz in (-30, 30):
        q += part(12, 150, 12, STEEL, pos, yaw, (66, 22, dz), layer=layer)
    q += part(66, 10, 86, STEEL, pos, yaw, (96, 74 + lift, 0), layer=layer)
    q += part(96, 46, 96, CARD, pos, yaw, (100, 84 + lift, 0), layer=layer, tex=OHIS)
    q += part(96, 46, 96, CARD, pos, yaw, (100, 131 + lift, 0), layer=layer, tex=PEPA)
    for dx in (-44, 52):
        for dz in (-44, 44):
            q += part(42, 42, 20, TYRE, pos, yaw, (dx, 0, dz), layer=layer)
    q += part(40, 54, 30, HI, pos, yaw, (-4, 96, 0), layer=layer)
    q += part(26, 26, 26, SKIN, pos, yaw, (-4, 150, 0), layer=layer)
    return q


def pallet(pos, n, brand, layer=0):
    q = r3d.box_quads(104, 12, 104, f(STEEL), pos=pos, y0=8, layer=layer)
    for lvl in range(n):
        tex = OHIS if brand == "ohis" else CIV if brand == "civ" else f(CARD)
        q += r3d.box_quads(96, 46, 96, tex, pos=pos, y0=20 + lvl * 47, layer=layer)
    return q


def shed(pos=(-330, 0, -200)):
    q = []
    q += r3d.box_quads(760, 250, 330, f(WALL, front=WALL_TEX), pos=pos, y0=8)
    q += r3d.box_quads(800, 20, 368, f(ROOF), pos=pos, y0=258)
    for x in (-610, -330, -50):
        q += r3d.box_quads(176, 152, 20, f(DARK), pos=(x, 0, pos[2] + 176), y0=8)
        q += r3d.box_quads(184, 13, 24, f(RED), pos=(x, 0, pos[2] + 176), y0=160)
        for lvl in range(3):
            q += r3d.box_quads(52, 34, 20, CARTONS[(lvl + 1) % 3], pos=(x - 42, 0, pos[2] + 170), y0=14 + lvl * 46)
            q += r3d.box_quads(52, 34, 20, CARTONS[lvl % 3], pos=(x + 42, 0, pos[2] + 170), y0=14 + lvl * 46)
    # the sign on the roof: the lockup on a lit white board
    q += r3d.box_quads(300, 72, 10, f(WALL, front=SIGN_TEX), pos=(pos[0] + 60, 0, pos[2] + 150), y0=278)
    return q


def depot(pos, yaw):
    q = []
    q += part(140, 70, 110, WALL, pos, yaw, (0, 0, 0))
    q += part(150, 12, 120, ROOF, pos, yaw, (0, 70, 0))
    q += part(44, 44, 6, DARK, pos, yaw, (0, 0, 56))
    q += part(8, 150, 8, STEEL, pos, yaw, (110, 0, 60))                       # lamp post
    lamp = part(22, 12, 22, LAMP, pos, yaw, (110, 150, 60))
    for quad in lamp: quad.shade = 1.2
    q += lamp
    return q


def ship(pos, bob, k=1.15, d=1):
    """A container ship. It sails the near water now, so it is drawn at its
    own scale against the lorries."""
    q = []
    p = (pos[0], 0, pos[2])
    q += r3d.box_quads(560 * k, 46 * k, 110 * k, f(NAVY), pos=p, y0=-10 * k + bob)
    q += r3d.box_quads(566 * k, 10 * k, 116 * k, f(RED), pos=p, y0=36 * k + bob)
    cols = [CONT_RED, CONT_WHITE, CONT_RED, CONT_WHITE, CONT_RED, CONT_RED]
    for i, x in enumerate(range(-210, 211, 84)):
        for lvl in range(3 if i % 2 == 0 else 2):
            t = cols[i % len(cols)]
            q += r3d.box_quads(78 * k, 30 * k, 96 * k, f(RED if i % 2 == 0 else BODY, front=t, back=t),
                               pos=(p[0] + x * k, 0, p[2]), y0=(46 + lvl * 31) * k + bob)
    q += r3d.box_quads(70 * k, 90 * k, 96 * k, f(BODY), pos=(p[0] + d * 240 * k, 0, p[2]), y0=46 * k + bob)
    q += r3d.box_quads(72 * k, 12 * k, 98 * k, f(GLASS), pos=(p[0] + d * 240 * k, 0, p[2]), y0=108 * k + bob)
    lamp = r3d.box_quads(8 * k, 8 * k, 8 * k, f(LAMP), pos=(p[0] + d * 240 * k, 0, p[2]), y0=136 * k + bob)
    for quad in lamp: quad.shade = 1.2
    q += lamp
    return q


def kariakoo(pos):
    """Kariakoo market, Dar es Salaam's big one (Nino, 10 Nov 2026, holding up
    three paintings of it). What makes it Kariakoo is the roof: a canopy of
    concrete trees, each a column flaring into a square funnel, pointed arches
    between them along the edge, the whole thing floating out past the walls
    of the shops below. So: a set-back block of shops, a ring of columns in
    the gallery under the overhang, the band of arches, the slab of funnels,
    and the flag."""
    q = []
    x, _, z = pos
    q += r3d.box_quads(700, 140, 470, f(TAN, front=SHOPS_F, back=SHOPS_F, left=SHOPS_S, right=SHOPS_S), pos=pos, y0=0)
    for cx in range(-400, 401, 160):
        for cz in (-290, 290):
            q += r3d.box_quads(26, 164, 26, f(CONC), pos=(x + cx, 0, z + cz), y0=0, sheen=0.0)
    for cz in (-145, 0, 145):
        for cx in (-400, 400):
            q += r3d.box_quads(26, 164, 26, f(CONC), pos=(x + cx, 0, z + cz), y0=0, sheen=0.0)
    q += r3d.box_quads(880, 70, 640, f(CONC, front=ARCADE_F, back=ARCADE_F, left=ARCADE_S, right=ARCADE_S), pos=pos, y0=164)
    q += r3d.box_quads(900, 16, 660, f(CONC, top=ROOF_TEX), pos=pos, y0=234)
    q += r3d.box_quads(6, 170, 6, f(STEEL), pos=(x + 400, 0, z + 280), y0=250)
    q += r3d.box_quads(66, 40, 2, f(BLUE, front=FLAG, back=FLAG.transpose(Image.FLIP_LEFT_RIGHT)), pos=(x + 436, 0, z + 280), y0=376)
    return q


def umbrella(pos, i, r=44):
    q = r3d.box_quads(5, 86, 5, f(DARK), pos=pos, y0=0, sheen=0.0)
    q += r3d.box_quads(2 * r, 5, 2 * r, {"top": UMBRELLAS[i % len(UMBRELLAS)], "left": CLEAR, "right": CLEAR, "front": CLEAR, "back": CLEAR},
                       pos=pos, y0=86, sheen=0.0)
    return q


def stall(pos, yaw, i):
    q = part(96, 40, 54, STEEL, pos, yaw, (0, 0, 0))
    if i % 2:
        for k, dx in enumerate((-30, 0, 30)):
            q += part(SMALL[0], SMALL[1], SMALL[2], CARD, pos, yaw, (dx, 40, 0), tex=CARTONS[(i + k) % 3])
    else:
        q += part(80, 22, 40, (GREEN, HI, RED, CARD)[i % 4], pos, yaw, (0, 40, 0))
    return q


def person(pos, yaw, shirt, phase=None):
    """Somebody standing, or walking if a phase is given: the market's crowd
    in the paintings' colours."""
    sw = math.sin(phase * 2 * math.pi) * 12 if phase is not None else 0
    q = []
    q += part(18, 58, 20, BLUE if shirt is not BLUE else DARK, pos, yaw, (sw, 0, -12))
    q += part(18, 58, 20, BLUE if shirt is not BLUE else DARK, pos, yaw, (-sw, 0, 12))
    q += part(40, 60, 38, shirt, pos, yaw, (0, 58, 0))
    q += part(26, 26, 26, SKIN, pos, yaw, (0, 120, 0))
    return q


def bus(pos, yaw, spin, layer=0):
    """A daladala: the white minibus with the purple skirt, the city's own
    distribution channel."""
    q = []
    q += part(230, 14, 100, STEEL, pos, yaw, (0, 24, 0), layer=layer)
    q += part(230, 108, 106, BODY, pos, yaw, (0, 36, 0), layer=layer, tex=f(BODY, front=BUS_SIDE, back=BUS_SIDE))
    q += part(8, 46, 96, GLASS, pos, yaw, (116, 76, 0), layer=layer)
    for dx in (-72, 72):
        for dz in (-50, 50):
            q += wheel(pos, yaw, (dx, 0, dz), 26, spin, width=20, layer=layer)
    return q


def underside(W, D, colour, pos, yaw, y, shade=0.5):
    """box_quads has no bottom face; a plane overhead shows its belly, so it
    gets one — two-sided, in shadow."""
    w, d = W / 2, D / 2
    cs = [r3d.add(r3d.roty((px, y, pz), yaw), pos) for (px, pz) in ((-w, -d), (w, -d), (w, d), (-w, d))]
    return [r3d.Quad(cs, color=colour, twosided=True, shade=shade, sheen=0.0)]


def plane(pos, yaw, k=1.3):
    """Hao Labs' cargo plane, high over the plain. Flies along +X in its own
    frame; `pos` carries its height in y."""
    x, y, z = pos
    p = (x, 0, z)
    q = []
    q += part(480 * k, 54 * k, 54 * k, BODY, p, yaw, (0, y, 0), tex=f(BODY, front=PLANE_SIDE, back=PLANE_SIDE))
    q += part(70 * k, 44 * k, 44 * k, RED, p, yaw, (270 * k, y + 4 * k, 0))
    q += part(16 * k, 34 * k, 40 * k, GLASS, p, yaw, (236 * k, y + 18 * k, 0))
    q += part(96 * k, 8 * k, 580 * k, BODY, p, yaw, (20 * k, y + 8 * k, 0))
    for side in (-1, 1):
        q += part(40 * k, 8 * k, 56 * k, RED, p, yaw, (10 * k, y + 8 * k, 300 * k * side))
        q += part(80 * k, 34 * k, 34 * k, DARK, p, yaw, (30 * k, y - 20 * k, 150 * k * side))
    q += part(90 * k, 100 * k, 8 * k, RED, p, yaw, (-200 * k, y + 40 * k, 0))
    q += part(60 * k, 6 * k, 220 * k, BODY, p, yaw, (-205 * k, y + 48 * k, 0))
    q += underside(480 * k, 54 * k, (214, 206, 200), p, yaw, y)
    wo = yaw_about((20 * k, 0, 0), yaw)
    q += underside(96 * k, 580 * k, (204, 196, 190), (p[0] + wo[0], 0, p[2] + wo[2]), yaw, y + 8 * k, shade=0.45)
    return q


def house(pos, yaw, w=90, d=70, h=50):
    q = []
    q += part(w, h, d, HOUSE, pos, yaw, (0, 0, 0))
    q += part(w + 10, 8, d + 10, TIN, pos, yaw, (0, h, 0))
    q += part(18, 24, 4, DARK, pos, yaw, (0, 0, d / 2 + 1))
    return q


def town(pos, yaw, rnd):
    """A few houses around a depot: a region is a place, not a shed."""
    q = []
    for i in range(5):
        a = rnd.uniform(0, 2 * math.pi); r = rnd.uniform(170, 330)
        off = (r * math.cos(a), 0, r * math.sin(a))
        q += house((pos[0] + off[0], 0, pos[2] + off[2]), yaw + rnd.uniform(-30, 30),
                   w=rnd.uniform(70, 110), d=rnd.uniform(60, 90), h=rnd.uniform(40, 56))
    return q


# ── the world at time t ──────────────────────────────────────────────────────
SHED = (-330, 0, -200)
BAY_LORRY = (-330, 0, 190)                        # backed up to the middle bay, loading
STACKS = ((-150, 200, 2, 0), (90, 170, 2, 8), (560, 180, 1, -12), (-520, 300, 2, 5), (330, 140, 1, 20))
SHORE = 900                                        # where the plain ends and the water begins
PORT = (520, 0, 790)                              # the quay: containers and a crane, beside the Lab
MARKET = (1100, 0, -1000)                         # Kariakoo, in the open behind the apron
LANE = SHORE + 760                                 # the ship's water


def crane(pos, reach):
    """A quay crane in the brand's red, boom out over the water, a container
    hanging under the trolley at `reach` (0 over the quay, 1 at the boom's end)."""
    q = []
    x, _, z = pos
    for dx in (-60, 60):
        for dz in (-70, 70):
            q += r3d.box_quads(28, 360, 28, f(RED), pos=(x + dx, 0, z + dz), y0=24)
    q += r3d.box_quads(150, 26, 180, f(RED), pos=(x, 0, z), y0=384)             # the portal
    q += r3d.box_quads(60, 30, 760, f(RED), pos=(x, 0, z + 290), y0=410)        # the boom
    tz = z - 60 + reach * 640
    q += r3d.box_quads(70, 24, 60, f(DARK), pos=(x, 0, tz), y0=386)             # the trolley
    hang = 130 + 110 * math.sin(reach * math.pi)
    q += r3d.box_quads(6, 386 - hang - 58, 6, f(STEEL), pos=(x, 0, tz), y0=hang + 58)
    q += r3d.box_quads(150, 58, 58, f(RED, front=CONT_RED, back=CONT_RED), pos=(x, 0, tz), y0=hang)
    return q


def container_yard(pos):
    q = []
    x, _, z = pos
    for i, dx in enumerate((-300, -140, 20, 180)):
        for lvl in range(2 if i % 2 else 3):
            red = (i + lvl) % 2 == 0
            t = CONT_RED if red else CONT_WHITE
            q += r3d.box_quads(150, 58, 58, f(RED if red else BODY, front=t, back=t), pos=(x + dx, 0, z), y0=24 + lvl * 59)
    return q


def tree(pos, h, rnd):
    q = r3d.box_quads(12, h, 12, f(DARK), pos=pos, sheen=0.0)
    w = h * rnd.uniform(0.9, 1.3)
    q += r3d.box_quads(w, h * 0.7, w, f(BUSH), pos=pos, y0=h * 0.8, sheen=0.0)
    return q


def near_road(x, z, r):
    s = min(1, max(0, (x + 2800) / 6200))
    for ds in (-0.06, 0, 0.06):
        (rx, rz), _ = ROAD.at(min(1, max(0, s + ds)))
        if math.hypot(x - rx, z - rz) < r: return True
    return False


def world(t):
    """Everything in the scene at loop time t in [0, 1): quads, ground
    shadows, the pools of light to paint afterwards, and the place names."""
    q, sh, lights, labels = [], [], [], []
    rnd = random.Random(11)
    # Ground and water, in tiles. One plane would be dropped whole the moment
    # a corner fell behind the camera; tiles lose only the tiles that do.
    T = 1500
    for gx in range(-9000, 13500, T):
        for gz in range(-18000, 7500, T):
            mat = WATER if gz + T / 2 > SHORE else GROUND
            q += flat(T + 4, T + 4, mat, (gx + T / 2, 0, gz + T / 2), layer=-3)
    # the shoreline: a pale lip of sand where the plain meets the water
    q += flat(22500, 50, M((132, 112, 98), (0, 0, 0), (0, 0, 0)), (2250, 0, SHORE), y0=1, layer=-2)
    # fields, bush and trees: the plain has to look like country, not a floor
    for _ in range(44):
        fx, fz = rnd.uniform(-7000, 12000), rnd.uniform(-12000, SHORE - 200)
        if abs(fz - 200) < 800 and abs(fx + 150) < 1200: continue        # not on the apron
        if fz > 500 and -1000 < fx < 1900: continue                       # not on the quay
        if abs(fz - MARKET[2]) < 900 and abs(fx - MARKET[0]) < 1100: continue   # not in the market
        q += flat(rnd.uniform(600, 1800), rnd.uniform(500, 1400), FIELD if rnd.random() < 0.5 else FIELD2,
                  (fx, 0, fz), yaw=rnd.uniform(-20, 20), y0=1, layer=-2)
    for _ in range(260):
        bx, bz = rnd.uniform(-7000, 12000), rnd.uniform(-12000, SHORE - 120)
        if abs(bz - 200) < 750 and abs(bx + 150) < 1150: continue
        if bz > 500 and -1000 < bx < 1900: continue
        if abs(bz - MARKET[2]) < 560 and abs(bx - MARKET[0]) < 760: continue
        if near_road(bx, bz, 260): continue
        if rnd.random() < 0.22:
            q += tree((bx, 0, bz), rnd.uniform(90, 170), rnd)
        else:
            sz = rnd.uniform(30, 80)
            q += r3d.box_quads(sz, sz * 0.8, sz, f(BUSH), pos=(bx, 0, bz), sheen=0.0)
    q += road_quads()

    # ── the Lab: apron, shed, stock, a lorry loading, a forklift, people ──
    q += flat(1500, 900, STEEL, (-150, 0, 200), y0=3, layer=-2)
    lights.append(((-100, 0, 300), 1000, 560, (255, 170, 120), 0.26))          # the floodlight
    q += shed(SHED)
    sh.append((-380, 380, -165, 165, 270, SHED, 0, 0.45))
    for x in (-610, -330, -50):
        lights.append(((x, 0, SHED[2] + 230), 190, 120, (255, 150, 110), 0.32))
    srnd = random.Random(17)
    for (px, pz, n, yaw) in STACKS:
        q += stack((px, 0, pz), yaw, srnd, layers=n)
        sh.append((-62, 62, -62, 62, 12 + n * BIG[1] + SMALL[1], (px, 0, pz), yaw, 0.4))
    # loose inner boxes by the bay, the ones about to be carried
    for i, (bx, bz) in enumerate(((-230, 120), (-205, 120), (-218, 142), (300, 420))):
        q += carton((bx, 0, bz), i * 17, CARTONS[i % 3], size=SMALL)
    q += lorry(BAY_LORRY, -90, 0, lit=False)
    sh.append((-212, 212, -64, 64, 200, BAY_LORRY, -90, 0.5))
    # the forklift: from the stacks to the lorry's side and back, twice a loop
    u = (math.cos(t * 4 * math.pi) + 1) / 2                     # 1 at the stacks, 0 at the lorry
    fp = (-180 + u * 410, 0, 330)
    going_out = math.sin(t * 4 * math.pi) > 0
    q += forklift(fp, 180 if going_out else 0, (1 - u) * 60)
    sh.append((-80, 110, -50, 50, 180, fp, 0, 0.45))
    # two people, out of step, facing the way they go
    for (x0, z0, dx, ph) in ((40, 470, 300, 0.0), (520, 420, -240, 0.5)):
        v = (math.cos((t + ph) * 4 * math.pi) + 1) / 2
        wp = (x0 + v * dx, 0, z0)
        yaw = 0 if (dx > 0) == (math.sin((t + ph) * 4 * math.pi) < 0) else 180
        q += worker(wp, yaw, (t + ph) * 8)
        sh.append((-40, 60, -34, 34, 156, wp, yaw, 0.4))

    # ── the city around it: houses either side of the coast road ──
    for (hx, hz, yaw) in ((-1300, 300, 4), (-1520, 170, -6), (-1740, 330, 8), (-1960, 210, -3), (-2200, 340, 5),
                          (-1250, 800, -4), (-1500, 820, 6), (-1780, 790, -5), (-2080, 830, 3), (-1150, 180, 2)):
        q += house((hx, 0, hz), yaw, w=90 + (hx % 40), d=70, h=46 + (hz % 14))
    for (tx, tz) in ((-1420, 420), (-1880, 450), (-1640, 880), (-2300, 760)):
        q += tree((tx, 0, tz), 130, rnd)
    lights.append(((-1650, 0, 300), 700, 300, (255, 200, 150), 0.12))
    lights.append(((-1650, 0, 820), 600, 160, (255, 200, 150), 0.10))

    # ── Kariakoo: the market, its umbrellas and stalls, its crowd, a daladala ──
    q += kariakoo(MARKET)
    sh.append((-415, 415, -295, 295, 234, MARKET, 0, 0.45))
    mx, mz = MARKET[0], MARKET[2] + 300                            # the front, toward the Lab
    for i, (ux, uz) in enumerate(((-300, 70), (-150, 110), (10, 80), (170, 110), (330, 70), (-420, -40), (480, -60), (520, 150))):
        q += umbrella((mx + ux, 0, mz + uz), i)
        q += stall((mx + ux, 0, mz + uz), 0, i)
    for i, (px, pz, yaw) in enumerate(((-360, 150, 20), (-230, 60, 160), (-80, 150, -30), (60, 40, 200), (230, 160, 10),
                                       (300, 50, 140), (420, 110, -60), (-470, 20, 90), (560, 20, 240), (140, 200, 180))):
        q += person((mx + px, 0, mz + pz), yaw, SHIRTS[i % len(SHIRTS)])
    for i, (x0, dx, ph) in enumerate(((-380, 520, 0.0), (420, -500, 0.4), (-120, 300, 0.7))):
        v = (math.cos((t + ph) * 2 * math.pi) + 1) / 2
        yaw = 0 if (dx > 0) == (math.sin((t + ph) * 2 * math.pi) < 0) else 180
        q += person((mx + x0 + v * dx, 0, mz + 220), yaw, SHIRTS[(i + 3) % len(SHIRTS)], phase=(t + ph) * 7)
    q += bus((mx + 650, 0, mz + 140), 0, 0)
    # two people crossing the apron empty-handed, the ones who have delivered
    for i, (x0, z0, dx, ph) in enumerate(((-700, 560, 1100, 0.15), (500, 600, -1100, 0.65))):
        v = (math.cos((t + ph) * 2 * math.pi) + 1) / 2
        yaw = 0 if (dx > 0) == (math.sin((t + ph) * 2 * math.pi) < 0) else 180
        q += person((x0 + v * dx, 0, z0), yaw, SHIRTS[(i + 1) % len(SHIRTS)], phase=(t + ph) * 7)
    # dockers walking the quay
    for i, (x0, dx, ph) in enumerate(((-300, 900, 0.3), (1200, -700, 0.8))):
        v = (math.cos((t + ph) * 2 * math.pi) + 1) / 2
        yaw = 0 if (dx > 0) == (math.sin((t + ph) * 2 * math.pi) < 0) else 180
        q += worker((x0 + v * dx, 0, SHORE - 40), yaw, (t + ph) * 8, shirt=SHIRTS[(i + 4) % len(SHIRTS)])
    lights.append(((mx, 0, mz + 100), 1100, 420, (255, 190, 140), 0.2))

    # ── the port: quay, containers, the crane working, the ship passing ──
    q += r3d.box_quads(2600, 24, 220, f(QUAY), pos=(500, 0, SHORE - 110), y0=0, sheen=0.0)
    q += container_yard((PORT[0] - 520, 0, PORT[2]))
    reach = (math.cos(t * 2 * math.pi) + 1) / 2
    q += crane(PORT, reach)
    lights.append(((PORT[0] - 200, 0, PORT[2]), 800, 260, (255, 210, 170), 0.16))
    sx = 5400 - t * 8600                                                        # arriving, bridge aft
    q += ship((sx, 0, LANE), math.sin(t * 4 * math.pi) * 7)
    lights.append(((sx + 760, 0, LANE), 720, 60, (255, 255, 255), 0.12))      # the wake
    lights.append(((sx - 330, 0, LANE), 70, 60, (255, 255, 255), 0.35))        # the bow wave
    t2 = (t + 0.5) % 1.0
    sx2 = -3400 + t2 * 8600                                                    # leaving, farther out
    q += ship((sx2, 0, LANE + 700), math.sin(t2 * 4 * math.pi + 1) * 7, k=0.95, d=-1)
    lights.append(((sx2 - 700, 0, LANE + 700), 650, 50, (255, 255, 255), 0.10))
    lights.append(((sx2 + 300, 0, LANE + 700), 60, 50, (255, 255, 255), 0.3))
    # the dock lights lie on the water in streaks, and the sky on the swell
    lights.append(((300, 0, SHORE + 300), 1800, 220, (255, 160, 120), 0.12))
    wrnd = random.Random(3)
    for _ in range(26):
        wx, wz = wrnd.uniform(-5000, 5000), wrnd.uniform(SHORE + 150, SHORE + 3600)
        lights.append(((wx, 0, wz + math.sin(t * 2 * math.pi + wx / 400) * 40), wrnd.uniform(300, 900), wrnd.uniform(14, 30), (150, 170, 220), 0.07))

    # ── the regions: a depot, a few houses, a lamp, someone waiting ──
    trnd = random.Random(5)
    for i, s in enumerate(DEPOTS):
        (x, z), yaw = ROAD.at(s)
        off = yaw_about((0, 0, 260), yaw)                        # beside the road, not on it
        p = (x + off[0], 0, z + off[2])
        q += depot(p, yaw)
        q += town(p, yaw, trnd)
        sh.append((-75, 75, -60, 60, 82, p, yaw, 0.4))
        lp = yaw_about((110, 0, 60), yaw)
        lights.append(((p[0] + lp[0], 0, p[2] + lp[2]), 260, 180, (255, 220, 160), 0.3))
        wo = yaw_about((60, 0, 120), yaw)
        q += worker((p[0] + wo[0], 0, p[2] + wo[2]), yaw + 90, 0.25, shirt=SHIRTS[i % len(SHIRTS)])
        so = yaw_about((-120, 0, 90), yaw)
        q += stack((p[0] + so[0], 0, p[2] + so[2]), yaw, srnd, layers=1, smalls=2)

    # ── on the road: two lorries and two bikes, spread around the loop ──
    for phase in (0.0, 0.33, 0.66):
        s = (t + phase) % 1.0
        (x, z), yaw = ROAD.at(s)
        q += lorry((x, 0, z), yaw, s * ROAD.length / 30.0)
        sh.append((-212, 212, -64, 64, 200, (x, 0, z), yaw, 0.5))
        ahead = yaw_about((420, 0, 0), yaw)
        lights.append(((x + ahead[0], 0, z + ahead[2]), 260, 120, (255, 236, 200), 0.26))
    for phase in (0.45, 0.92):
        s = (t + phase) % 1.0
        (x, z), yaw = ROAD.at(s)
        off = yaw_about((0, 0, -70), yaw)
        bp = (x + off[0], 0, z + off[2])
        q += bus(bp, yaw, s * ROAD.length / 26.0)
        sh.append((-116, 116, -54, 54, 150, bp, yaw, 0.5))
    for phase, side in ((0.17, 95), (0.5, -95), (0.83, 95)):
        s = (t + phase) % 1.0
        (x, z), yaw = ROAD.at(s)
        off = yaw_about((0, 0, side), yaw)
        bp = (x + off[0], 0, z + off[2])
        q += bike(bp, yaw, s * ROAD.length / 22.0, 0)
        sh.append((-75, 75, -22, 22, 120, bp, yaw, 0.45))
    # ── Hao Labs' plane: in from the far right, low over the plain, growing as
    # it comes, out past the camera's left shoulder. Heading set from the path.
    # Low — 450 units up — so on a phone it flies through the open band of
    # sky between the button and the market, not behind the logo (Nino,
    # 10 Nov 2026: "the plane should be down a little so even on the phone it
    # can be visible"). Kept out of `q` because the haze would wash a plane
    # this low to nothing; frame() draws it after the haze.
    A, B = (9000, 450, -4500), (-3000, 450, 2600)
    pp = tuple(A[i] + (B[i] - A[i]) * t for i in range(3))
    air = plane(pp, math.degrees(math.atan2(-(B[2] - A[2]), B[0] - A[0])))
    return q, sh, lights, labels, air


# ── light, painted on afterwards ────────────────────────────────────────────
def paint_lights(canvas, cam, lights):
    """Pools of light on the ground: the bays, the lamps, the headlamps, the
    ship's wake. Projected through the same camera, so a headlamp pool lands
    on the road in front of its lorry, not somewhere near it."""
    for (p, rx, rz, colour, alpha) in lights:
        pr = [cam.project((p[0] + rx * math.cos(a), 0, p[2] + rz * math.sin(a))) for a in
              [k * math.pi / 8 for k in range(16)]]
        if any(pt[2] <= 1 for pt in pr): continue                     # behind the camera
        pts = [pt[:2] for pt in pr]
        xs = [pt[0] for pt in pts]; ys = [pt[1] for pt in pts]
        pad = int(40 * r3d.SS)
        # only the part that can land on the canvas: a pool near the camera
        # projects to a box billions of pixels wide (see r3d.render)
        x0, y0 = max(int(min(xs)) - pad, 0), max(int(min(ys)) - pad, 0)
        x1, y1 = min(int(max(xs)) + pad, canvas.width), min(int(max(ys)) + pad, canvas.height)
        if x1 - x0 < 2 or y1 - y0 < 2: continue
        w, h = x1 - x0, y1 - y0
        m = Image.new("L", (w, h), 0)
        ImageDraw.Draw(m).polygon([(x - x0, y - y0) for x, y in pts], fill=int(255 * alpha))
        m = m.filter(ImageFilter.GaussianBlur(max(6, min(w, h) // 5)))
        glow = Image.new("RGBA", (w, h), colour + (0,)); glow.putalpha(m)
        canvas.alpha_composite(glow, (x0, y0))


def sky(W, H, horizon):
    """Night, a red dawn along the coast, a few stars."""
    im = Image.new("RGB", (W, H), (7, 6, 6))
    d = ImageDraw.Draw(im)
    for y in range(H):
        k = max(0.0, 1 - abs(y - horizon) / (H * 0.55))
        k = k ** 2.2
        d.line([(0, y), (W, y)], fill=(int(7 + 96 * k), int(6 + 24 * k), int(6 + 18 * k)))
    import random
    rnd = random.Random(7)
    for _ in range(int(W * H / 14000)):
        x, y = rnd.randrange(W), rnd.randrange(int(horizon * 0.95))
        b = rnd.randrange(90, 200)
        d.point((x, y), fill=(b, b - 10, b - 14))
    return im.convert("RGBA")


# ── cameras, one per orientation ────────────────────────────────────────────
CAMS = {
    # A phone is held upright, so the road has to climb the frame: the camera
    # looks along it, from out over the water, with the port and the Lab at
    # the foot and the regions receding to the dawn.
    "portrait": dict(size=(840, 1680), target=(400, 0, -250), dist=5300, az=-46, el=16, fov=50, label=40),
    "landscape": dict(size=(1600, 900), target=(720, 0, -500), dist=5600, az=-40, el=16, fov=38, label=26),
}


def horizon_of(c):
    """Where the true horizon falls in the frame, as a fraction from the top."""
    return 0.5 - math.tan(math.radians(c["el"])) / (2 * math.tan(math.radians(c["fov"]) / 2))


def haze(canvas, horizon):
    """Distance. The renderer has no fog, so the far plain would run into the
    sky along a hard edge; this lays the dusk's own colour over the picture,
    solid at the horizon and gone a third of the way down, which is what air
    does over thirty miles of plain."""
    W, H = canvas.size
    band = int(H * 0.30)
    grad = Image.new("L", (1, band))
    for y in range(band):
        grad.putpixel((0, y), int(236 * ((1 - y / band) ** 1.4)))
    grad = grad.resize((W, band))
    mask = Image.new("L", (W, H), 0)
    mask.paste(grad, (0, horizon))
    fog = Image.new("RGBA", (W, H), (100, 30, 24, 0)); fog.putalpha(mask)
    canvas.alpha_composite(fog)


def paint_labels(canvas, cam, labels, px):
    """Floating place names on a thin line down to the ground, the way Bongo
    Life pins its places: a map, not just a picture."""
    S = r3d.SS
    d = ImageDraw.Draw(canvas)
    fnt = font(int(px * S))
    for (p, text) in labels:
        gx, gy, gz = cam.project(p)
        if gz <= 1 or gx < -200 or gx > canvas.width + 200 or gy < 0 or gy > canvas.height: continue
        tw = d.textlength(text, font=fnt)
        pad, h = int(px * 0.6 * S), int(px * 1.7 * S)
        x0, y0 = int(gx - tw / 2 - pad), int(gy - h - px * 1.3 * S)
        x0 = int(max(px * 0.5 * S, min(x0, canvas.width - tw - 2 * pad - px * 0.5 * S)))
        tx = x0 + pad + tw / 2
        d.line([(gx, gy), (gx, y0 + h)], fill=(255, 120, 100, 200), width=max(2, int(px * 0.08 * S)))
        r = px * 0.2 * S
        d.ellipse([gx - r, gy - r, gx + r, gy + r], fill=(238, 49, 36, 255))
        d.rounded_rectangle([x0, y0, x0 + tw + 2 * pad, y0 + h], radius=int(h / 2), fill=(24, 16, 16, 228), outline=(255, 255, 255, 46), width=max(1, int(S)))
        d.text((tx, y0 + h / 2), text, font=fnt, fill=(255, 250, 246, 255), anchor="mm")


def frame(name, t):
    c = CAMS[name]
    W, H = c["size"]
    cam = r3d.Camera(target=c["target"], dist=c["dist"], az=c["az"], el=c["el"], fov=c["fov"], W=W, H=H)
    q, sh, lights, labels, air = world(t)
    shade, obj = r3d.render(q, cam, light=(0.45, 0.8, -0.6), ambient=0.66, shadows=sh)
    hz = int(cam.H * horizon_of(c))
    canvas = sky(cam.W, cam.H, hz)
    canvas.alpha_composite(shade)
    canvas.alpha_composite(obj)
    paint_lights(canvas, cam, lights)
    haze(canvas, hz)
    _, plane_img = r3d.render(air, cam, light=(0.45, 0.8, -0.6), ambient=0.78)
    canvas.alpha_composite(plane_img)
    paint_labels(canvas, cam, labels, c["label"])
    return canvas.convert("RGB").resize((W, H), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", choices=CAMS.keys())
    ap.add_argument("--loop", choices=CAMS.keys())
    ap.add_argument("--frames", type=int, default=240)
    ap.add_argument("--fps", type=int, default=10)
    ap.add_argument("--t", type=float, default=0.0)
    ap.add_argument("--dump", help="also keep every frame as a PNG in this folder, for cutting a video later")
    a = ap.parse_args()
    if a.preview:
        t0 = time.time()
        im = frame(a.preview, a.t)
        p = os.path.join(OUT, f"{a.preview}-preview.png")
        im.save(p)
        print(p, im.size, f"{time.time() - t0:.1f}s")
    if a.loop:
        frames = []
        t0 = time.time()
        for i in range(a.frames):
            frames.append(frame(a.loop, i / a.frames))
            if a.dump:
                os.makedirs(a.dump, exist_ok=True)
                frames[-1].save(os.path.join(a.dump, f"{a.loop}-{i:03d}.png"))
            if i % 10 == 0:
                print(f"  {i}/{a.frames}  {time.time() - t0:.0f}s", flush=True)
        poster = os.path.join(OUT, f"{a.loop}-poster.webp")
        frames[0].save(poster, "WEBP", quality=80, method=6)
        p = os.path.join(OUT, f"{a.loop}.webp")
        frames[0].save(p, "WEBP", save_all=True, append_images=frames[1:], duration=int(1000 / a.fps),
                       loop=0, quality=68, method=4, minimize_size=True, allow_mixed=True, kmax=a.frames)
        print(f"{p}  {os.path.getsize(p) / 1048576:.2f} MB   poster {os.path.getsize(poster) / 1024:.0f} KB   {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
