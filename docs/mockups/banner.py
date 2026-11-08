"""The photograph at the right of the admin banner.

Target Express sets a real photograph into the right third of its banner and
fades it left under a mask (components/app/page-banner.tsx). Ours is the two
Pepa cartons, lit on a dark shelf, built from the renders already published in
client/public/pepa so it can be remade whenever the packaging changes:

    python3 docs/mockups/banner.py

It writes client/public/banner.webp — a full-bleed scene, edge to edge, no
transparent gaps. The fading is the stylesheet's job, not the picture's.
"""

from PIL import Image, ImageFilter, ImageChops, ImageEnhance
import glob, os, math, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import r3d
import ohis
import civlily

PUB = os.path.join(os.path.dirname(__file__), "..", "..", "client", "public")
PUB = os.path.normpath(PUB)

W, H = 1440, 380


def pick(pattern):
    found = sorted(glob.glob(os.path.join(PUB, "pepa", pattern)))
    return found[0] if found else None


def key_out(path, tol=26):
    """The renders sit on a flat cream studio sweep; lift them off it."""
    im = Image.open(path).convert("RGB")
    bg = im.getpixel((2, 2))
    diff = ImageChops.difference(im, Image.new("RGB", im.size, bg)).convert("L")
    mask = diff.point(lambda v: 0 if v < tol else min(255, int((v - tol) * 8)))
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    out = im.convert("RGBA")
    out.putalpha(crush(mask))
    return out.crop(out.getbbox())


def crush(mask):
    """The studio sweep carries the render's own drop shadow, and a grey
    shadow on cream survives keying as a half-transparent smear — pale, and
    very visible once the carton is standing on a dark shelf. The carton
    itself is solid, so bending the alpha curve keeps it and takes the smear:
    255 stays 255, 128 falls to 27."""
    return mask.point(lambda a: int(255 * (a / 255) ** 3.0))


# ── the shelf: a dark surface with one pool of light on it ──────────────────
base = Image.new("RGB", (W, H))
px = base.load()
for x in range(W):
    t = x / (W - 1)
    for y in range(H):
        v = y / (H - 1)
        r = int(13 + 26 * t + 8 * v)
        g = int(11 + 13 * t + 6 * v)
        b = int(11 + 12 * t + 7 * v)
        px[x, y] = (r, g, b)
base = base.convert("RGBA")

# One warm light behind the cartons, so they stand out of the dark rather than
# floating in it. The earlier version lit the whole strip evenly and everything
# came out hazy.
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gp = glow.load()
for x in range(0, W, 2):
    for y in range(0, H, 2):
        d = math.hypot((x - 880) / 520, (y - 150) / 300)
        a = int(150 * max(0.0, 1 - d) ** 1.3)
        if a:
            for dx in (0, 1):
                for dy in (0, 1):
                    if x + dx < W and y + dy < H:
                        gp[x + dx, y + dy] = (232, 118, 92, a)
base = Image.alpha_composite(base, glow.filter(ImageFilter.GaussianBlur(52)))

shelf = Image.new("RGBA", (W, H), (0, 0, 0, 0))


def place(img, h, cx, cy, dim=0.0, mirror=True):
    """A carton on the shelf, with its contact shadow and a little of itself
    in the surface under it."""
    s = img.resize((max(1, int(img.width * h / img.height)), h), Image.LANCZOS)
    if dim:
        s = Image.alpha_composite(s, Image.new("RGBA", s.size, (6, 14, 12, int(255 * dim))))
    shadow = Image.new("RGBA", (s.width + 110, 60), (0, 0, 0, 0))
    blob = Image.new("RGBA", (s.width, 36), (0, 0, 0, 165))
    shadow.paste(blob, (55, 12), blob)
    shadow = shadow.filter(ImageFilter.GaussianBlur(20))
    shelf.alpha_composite(shadow, (cx - shadow.width // 2, cy + h // 2 - 22))
    if mirror:
        ref = s.transpose(Image.FLIP_TOP_BOTTOM).crop((0, 0, s.width, int(h * 0.34)))
        fade = Image.new("L", ref.size)
        fp = fade.load()
        for yy in range(ref.height):
            v = int(66 * (1 - yy / ref.height) ** 1.8)
            for xx in range(ref.width):
                fp[xx, yy] = v
        ref.putalpha(ImageChops.multiply(ref.split()[3], fade))
        shelf.alpha_composite(ref, (cx - ref.width // 2, cy + h // 2))
    shelf.alpha_composite(s, (cx - s.width // 2, cy - h // 2))


def drawn_carton(faces, dims, cam_kw, size):
    """One of the two brands we draw rather than photograph, keyed off its own
    studio sweep so it drops onto the shelf like the rendered Pepa plates."""
    bw, bh, bd = dims
    q = r3d.box_quads(bw, bh, bd, faces, sheen=0.12)
    cam = r3d.Camera(target=(0, bh / 2, 0), W=size[0] * 2, H=size[1] * 2, **cam_kw)
    # No ground shadow in the plate: place() lays a proper one on the shelf,
    # and a baked one would only have to be keyed back out again.
    layers = r3d.render(q, cam, light=(-0.45, 0.95, 0.6))
    flat = r3d.finish(layers, size[0], size[1], pad=0.03, bg=None).convert("RGB")
    bg = flat.getpixel((2, 2))
    diff = ImageChops.difference(flat, Image.new("RGB", flat.size, bg)).convert("L")
    mask = diff.point(lambda v: 0 if v < 10 else min(255, (v - 10) * 10))
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    out = flat.convert("RGBA")
    out.putalpha(crush(mask))
    return out.crop(out.getbbox())


hero = key_out(pick("hero-1000.*.webp") or pick("hero-700.*.webp"))
book = key_out(pick("kubwa-booklets-1000.*.webp") or pick("kubwa-booklets-700.*.webp"))
oh = drawn_carton(ohis.faces(46 / 74), (74, 115, 46),
                  dict(dist=330, az=34, el=15, fov=26), (620, 860))
# 125 x 58 x 112 from the supplier's dimensioned photograph: a low wide tray,
# which is also what the group needed between two upright cartons.
civ = drawn_carton(civlily.faces(112 / 125), (125, 58, 112),
                   dict(dist=430, az=30, el=22, fov=26), (760, 560))

# Left to right, and the stylesheet fades the left away: what must be seen
# stands furthest right. Three brands, one shelf.
place(book, 182, 206, 272, dim=0.34)   # Pepa, furthest into the fade
place(civ, 196, 572, 282, dim=0.10)    # Civlily
place(oh, 296, 892, 208, dim=0.03)     # OHIS
place(hero, 342, 1218, 190, dim=0.0)   # the tall Pepa carton

out = Image.alpha_composite(base, shelf)
out = ImageEnhance.Contrast(out).enhance(1.10)

# A gentle fall-off at the left edge so the stylesheet's mask has something
# dark to end on rather than a cut.
edge = Image.new("L", (W, H), 255)
ep = edge.load()
for x in range(200):
    v = int(255 * (x / 200) ** 1.4)
    for y in range(H):
        ep[x, y] = v
dark = Image.new("RGBA", (W, H), (13, 10, 10, 255))
out = Image.composite(out, dark, edge)

out.convert("RGB").save(os.path.join(PUB, "banner.webp"), "WEBP", quality=84, method=6)
print(os.path.join(PUB, "banner.webp"), out.size, os.path.getsize(os.path.join(PUB, "banner.webp")))
