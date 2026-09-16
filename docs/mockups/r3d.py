"""A small perspective renderer for packaging mockups, PIL only.

Quads carry world-space corners in TL, TR, BR, BL order as seen from outside,
so a texture maps with its top-left on TL. Faces are lit by one directional
light plus ambient, drawn in an explicit layer order (then far-to-near), and
rendered at 2x before a downsample so every edge is antialiased.
"""
import math
from PIL import Image, ImageDraw, ImageFilter, ImageChops

SS = 2

def sub(a, b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def add(a, b): return (a[0]+b[0], a[1]+b[1], a[2]+b[2])
def mul(a, s): return (a[0]*s, a[1]*s, a[2]*s)
def dot(a, b): return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def norm(a):
    l = math.sqrt(dot(a, a)) or 1.0
    return (a[0]/l, a[1]/l, a[2]/l)
def roty(p, deg):
    r = math.radians(deg); c, s = math.cos(r), math.sin(r)
    return (p[0]*c + p[2]*s, p[1], -p[0]*s + p[2]*c)

class Camera:
    def __init__(self, target, dist, az, el, fov, W, H):
        a, e = math.radians(az), math.radians(el)
        self.eye = add(target, (dist*math.sin(a)*math.cos(e), dist*math.sin(e), dist*math.cos(a)*math.cos(e)))
        self.fwd = norm(sub(target, self.eye))
        self.right = norm(cross(self.fwd, (0, 1, 0)))
        self.up = cross(self.right, self.fwd)
        self.W, self.H = W*SS, H*SS
        self.f = (self.H/2) / math.tan(math.radians(fov)/2)
    def project(self, p):
        d = sub(p, self.eye)
        z = dot(d, self.fwd)
        return (self.W/2 + self.f*dot(d, self.right)/z, self.H/2 - self.f*dot(d, self.up)/z, z)

def _solve(M, b):
    n = len(b)
    for i in range(n):
        p = max(range(i, n), key=lambda r: abs(M[r][i]))
        M[i], M[p] = M[p], M[i]; b[i], b[p] = b[p], b[i]
        for r in range(i+1, n):
            f = M[r][i]/M[i][i]
            for c in range(i, n): M[r][c] -= f*M[i][c]
            b[r] -= f*b[i]
    x = [0.0]*n
    for i in range(n-1, -1, -1):
        x[i] = (b[i] - sum(M[i][c]*x[c] for c in range(i+1, n))) / M[i][i]
    return x

def _coeffs(dst, src):
    M, b = [], []
    for (dx, dy), (sx, sy) in zip(dst, src):
        M.append([dx, dy, 1, 0, 0, 0, -dx*sx, -dy*sx]); b.append(sx)
        M.append([0, 0, 0, dx, dy, 1, -dx*sy, -dy*sy]); b.append(sy)
    return _solve(M, b)

class Quad:
    def __init__(self, corners, tex=None, color=None, layer=0, sheen=0.10, twosided=False, shade=None):
        self.c = corners; self.tex = tex; self.color = color
        self.layer = layer; self.sheen = sheen; self.twosided = twosided; self.shade = shade
        tl, tr, br, bl = corners
        self.n = norm(cross(sub(bl, tl), sub(tr, tl)))
        self.center = mul(add(add(tl, tr), add(br, bl)), 0.25)

def box_quads(W, H, D, tex, pos=(0, 0, 0), yaw=0, layer=0, y0=0, sheen=0.10, skip=()):
    w, d = W/2, D/2
    F = {
        "front": [(-w, H, d), (w, H, d), (w, 0, d), (-w, 0, d)],
        "back":  [(w, H, -d), (-w, H, -d), (-w, 0, -d), (w, 0, -d)],
        "right": [(w, H, d), (w, H, -d), (w, 0, -d), (w, 0, d)],
        "left":  [(-w, H, -d), (-w, H, d), (-w, 0, d), (-w, 0, -d)],
        "top":   [(-w, H, -d), (w, H, -d), (w, H, d), (-w, H, d)],
    }
    out = []
    for k, cs in F.items():
        if k in skip or k not in tex: continue
        cs = [add(roty((p[0], p[1]+y0, p[2]), yaw), pos) for p in cs]
        t = tex[k]
        out.append(Quad(cs, tex=t if isinstance(t, Image.Image) else None,
                        color=None if isinstance(t, Image.Image) else t, layer=layer, sheen=sheen))
    return out

def _gradient(w, h, angle_deg):
    g = Image.linear_gradient("L").rotate(angle_deg, expand=True, fillcolor=128)
    return g.resize((max(1, w), max(1, h)), Image.BILINEAR)

def render(quads, cam, light=(-0.45, 0.85, 0.55), ambient=0.74, shadows=(), bg=None, shadow_light=(-0.30, 1.7, 0.45)):
    L = norm(light); SL = norm(shadow_light)
    canvas = Image.new("RGBA", (cam.W, cam.H), (0, 0, 0, 0))
    shade_layer = Image.new("RGBA", (cam.W, cam.H), (0, 0, 0, 0))

    # ground shadows first
    if shadows:
        sh = Image.new("L", (cam.W, cam.H), 0)
        sd = ImageDraw.Draw(sh)
        contact = Image.new("L", (cam.W, cam.H), 0)
        cd = ImageDraw.Draw(contact)
        aocc = Image.new("L", (cam.W, cam.H), 0)
        ao = ImageDraw.Draw(aocc)
        for (xmin, xmax, zmin, zmax, h, pos, yaw, strength) in shadows:
            pts = []
            corners = [(x, y, z) for x in (xmin, xmax) for z in (zmin, zmax) for y in (0, h)]
            for p in corners:
                wp = add(roty(p, yaw), pos)
                t = wp[1] / max(SL[1], 1e-3)
                g = (wp[0] - SL[0]*t, 0.0, wp[2] - SL[2]*t)
                pts.append(cam.project(g)[:2])
            hull = _hull(pts)
            sd.polygon(hull, fill=int(115*strength))
            foot = [cam.project(add(roty((x, 0, z), yaw), pos))[:2]
                    for (x, z) in ((xmin-2.5, zmin-2.5), (xmax+2.5, zmin-2.5), (xmax+2.5, zmax+2.5), (xmin-2.5, zmax+2.5))]
            cd.polygon(foot, fill=int(150*strength))
            core = [cam.project(add(roty((x, 0, z), yaw), pos))[:2]
                    for (x, z) in ((xmin+1.5, zmin+1.5), (xmax-1.5, zmin+1.5), (xmax-1.5, zmax-1.5), (xmin+1.5, zmax-1.5))]
            ao.polygon(core, fill=int(200*strength))
        sh = sh.filter(ImageFilter.GaussianBlur(17*SS))
        contact = contact.filter(ImageFilter.GaussianBlur(8*SS))
        aocc = aocc.filter(ImageFilter.GaussianBlur(2.2*SS))
        both = ImageChops.lighter(ImageChops.lighter(sh, contact), aocc)
        shadow_rgba = Image.new("RGBA", canvas.size, (40, 28, 18, 0))
        shadow_rgba.putalpha(both)
        shade_layer.alpha_composite(shadow_rgba)

    vis = []
    for q in quads:
        facing = dot(q.n, sub(cam.eye, q.center))
        if facing <= 0 and not q.twosided: continue
        pr = [cam.project(p) for p in q.c]
        if any(p[2] <= 1 for p in pr): continue
        depth = sum(p[2] for p in pr) / 4
        vis.append((q.layer, -depth, q, pr))
    vis.sort(key=lambda t: (t[0], t[1]))

    for _, _, q, pr in vis:
        xs = [p[0] for p in pr]; ys = [p[1] for p in pr]
        x0, y0 = int(math.floor(min(xs))) - 2, int(math.floor(min(ys))) - 2
        x1, y1 = int(math.ceil(max(xs))) + 2, int(math.ceil(max(ys))) + 2
        bw, bh = x1-x0, y1-y0
        if bw <= 1 or bh <= 1: continue
        dst = [(p[0]-x0, p[1]-y0) for p in pr]

        diffuse = max(0.0, dot(q.n, L))
        b = (ambient + (1.04-ambient)*diffuse) if q.shade is None else q.shade
        if q.tex is not None:
            src = q.tex.convert("RGBA")
            sw, sh_ = src.size
            warped = src.transform((bw, bh), Image.PERSPECTIVE,
                                   _coeffs(dst, [(0, 0), (sw, 0), (sw, sh_), (0, sh_)]), Image.BICUBIC)
        else:
            warped = Image.new("RGBA", (bw, bh), tuple(q.color) + (255,))
        r, g, bl, a = warped.split()
        f = lambda v: max(0, min(255, int(v*b)))
        r, g, bl = r.point(f), g.point(f), bl.point(f)

        mask = Image.new("L", (bw, bh), 0)
        ImageDraw.Draw(mask).polygon(dst, fill=255)
        a = ImageChops.multiply(a, mask)

        piece = Image.merge("RGBA", (r, g, bl, a))
        if q.sheen > 0:
            grad = _gradient(bw, bh, 35)
            grad = grad.point(lambda v: int(max(0, (v-110))*q.sheen*1.6))
            grad = ImageChops.multiply(grad, a)
            white = Image.new("RGBA", (bw, bh), (255, 250, 240, 0)); white.putalpha(grad)
            piece.alpha_composite(white)
        canvas.alpha_composite(piece, (x0, y0))
    return shade_layer, canvas

def _hull(points):
    pts = sorted(set((round(x, 2), round(y, 2)) for x, y in points))
    if len(pts) <= 2: return pts
    def cr(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cr(lower[-2], lower[-1], p) <= 0: lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cr(upper[-2], upper[-1], p) <= 0: upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]

def backdrop(W, H, inner=(250, 247, 241), outer=(226, 218, 204)):
    g = Image.radial_gradient("L").resize((W, H), Image.BILINEAR)
    a = Image.new("RGB", (W, H), inner); b = Image.new("RGB", (W, H), outer)
    return Image.composite(b, a, g)

def finish(layers, W, H, pad=0.08, bg=None):
    """Downsample, centre the OBJECT (not its shadow) on a soft backdrop."""
    shadow, obj = layers
    shadow = shadow.resize((shadow.width//SS, shadow.height//SS), Image.LANCZOS)
    obj = obj.resize((obj.width//SS, obj.height//SS), Image.LANCZOS)
    ob = obj.getbbox()
    sb = shadow.getbbox() or ob
    ux0, uy0 = min(ob[0], sb[0]), min(ob[1], sb[1])
    ux1, uy1 = max(ob[2], sb[2]), max(ob[3], sb[3])
    maxw, maxh = int(W*(1-2*pad)), int(H*(1-2*pad))
    s = min(maxw/(ob[2]-ob[0]), maxh/(ob[3]-ob[1]), 1.0)
    both = shadow.copy(); both.alpha_composite(obj)
    both = both.crop((ux0, uy0, ux1, uy1))
    if s < 1.0:
        both = both.resize((int(both.width*s), int(both.height*s)), Image.LANCZOS)
    ocx = ((ob[0]+ob[2])/2 - ux0)*s
    ocy = ((ob[1]+ob[3])/2 - uy0)*s
    out = (bg or backdrop(W, H)).convert("RGBA")
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer.paste(both, (int(W/2 - ocx), int(H/2 - ocy)), both)
    out.alpha_composite(layer)
    return out.convert("RGB")
