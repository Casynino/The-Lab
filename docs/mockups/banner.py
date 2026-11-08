"""The photograph at the right of the admin banner.

Target Express sets a real photograph into the right third of its banner and
fades it left under a mask (components/app/page-banner.tsx). Ours is the two
Pepa cartons, lit on a dark shelf, built from the renders already published in
client/public/pepa so it can be remade whenever the packaging changes:

    python3 docs/mockups/banner.py

It writes client/public/banner.webp — a full-bleed scene, edge to edge, no
transparent gaps. The fading is the stylesheet's job, not the picture's.
"""

from PIL import Image, ImageFilter, ImageChops
import glob, os, math

PUB = os.path.join(os.path.dirname(__file__), "..", "..", "client", "public")
PUB = os.path.normpath(PUB)

W, H = 1080, 360


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
    out.putalpha(mask)
    return out.crop(out.getbbox())


# ── the shelf: a dark surface with one light on it ───────────────────────────
base = Image.new("RGB", (W, H))
px = base.load()
for x in range(W):
    t = x / (W - 1)
    for y in range(H):
        v = y / (H - 1)
        r = int(9 + 10 * t + 4 * v)
        g = int(20 + 22 * t + 6 * v)
        b = int(16 + 20 * t + 8 * v)
        px[x, y] = (r, g, b)
base = base.convert("RGBA")

glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gp = glow.load()
for x in range(0, W, 2):
    for y in range(0, H, 2):
        d = math.hypot((x - 620) / 460, (y - 110) / 300)
        a = max(0, int(120 * (1 - d)))
        if a:
            for dx in (0, 1):
                for dy in (0, 1):
                    if x + dx < W and y + dy < H:
                        gp[x + dx, y + dy] = (150, 210, 120, a)
base = Image.alpha_composite(base, glow.filter(ImageFilter.GaussianBlur(46)))

shelf = Image.new("RGBA", (W, H), (0, 0, 0, 0))


def place(img, h, cx, cy, dim=0.0):
    s = img.resize((max(1, int(img.width * h / img.height)), h), Image.LANCZOS)
    if dim:
        s = Image.alpha_composite(s, Image.new("RGBA", s.size, (6, 14, 12, int(255 * dim))))
    shadow = Image.new("RGBA", (s.width + 90, 54), (0, 0, 0, 0))
    blob = Image.new("RGBA", (s.width, 34), (0, 0, 0, 150))
    shadow.paste(blob, (45, 10), blob)
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    shelf.alpha_composite(shadow, (cx - shadow.width // 2, cy + h // 2 - 20))
    shelf.alpha_composite(s, (cx - s.width // 2, cy - h // 2))


hero = key_out(pick("hero-1000.*.webp") or pick("hero-700.*.webp"))
book = key_out(pick("kubwa-booklets-1000.*.webp") or pick("kubwa-booklets-700.*.webp"))

place(book, 170, 250, 250, dim=0.34)   # behind, further off
place(hero, 296, 520, 182, dim=0.06)   # the tall carton, the hero of it
place(book, 212, 850, 236, dim=0.02)   # the open box and its booklets

out = Image.alpha_composite(base, shelf)

# A gentle fall-off at the left edge so the stylesheet's mask has something
# dark to end on rather than a cut.
edge = Image.new("L", (W, H), 255)
ep = edge.load()
for x in range(240):
    v = int(255 * (x / 240) ** 1.4)
    for y in range(H):
        ep[x, y] = v
dark = Image.new("RGBA", (W, H), (7, 16, 13, 255))
out = Image.composite(out, dark, edge)

out.convert("RGB").save(os.path.join(PUB, "banner.webp"), "WEBP", quality=84, method=6)
print(os.path.join(PUB, "banner.webp"), out.size, os.path.getsize(os.path.join(PUB, "banner.webp")))
