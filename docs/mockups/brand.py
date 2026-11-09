"""Hao Labs' own mark, cut out of the official artwork.

Nino, 9 Nov 2026: "why don't you use our logo". The brand files are flat ink on
a white sheet, so this lifts the ink off the sheet — alpha from how far the
darkest channel sits from white, then the ink un-premultiplied back out of it,
which is what keeps the red a true red instead of a washed pink at the edges.

    python3 docs/mockups/brand.py

Sources (copied into the repo so this is reproducible):
    brand-src/hao-mark-source.png    the red hao on its own
    brand-src/haotek-labs-source.png the hǎotek Labs lockup — the word "Labs"
                                     is cut from here, so it is Nino's own
                                     lettering and not a guess at the face.

Writes into client/public/brand/:
    hao-mark.png          the red mark, transparent
    hao-labs-dark.png     mark + "Labs" in white, for the app's near-black
    hao-labs-light.png    mark + "Labs" in ink, for white paper
    app-180/192/512, maskable, favicon.png, splash/*   the home-screen set
"""

from PIL import Image, ImageChops, ImageDraw, ImageFont
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "brand-src")
PUB = os.path.normpath(os.path.join(HERE, "..", "..", "client", "public"))
BRAND = os.path.join(PUB, "brand")
SPLASH_DIR = os.path.join(BRAND, "splash")
os.makedirs(SPLASH_DIR, exist_ok=True)

INK = (10, 10, 11)              # the app's near-black
SS = 4
F = "/System/Library/Fonts/Supplemental/"


def key_white(path):
    """Flat ink on a white sheet, lifted off it."""
    im = Image.open(path).convert("RGB")
    r, g, b = im.split()
    alpha = ImageChops.invert(ImageChops.darker(ImageChops.darker(r, g), b))
    px, ap = im.load(), alpha.load()
    out = Image.new("RGBA", im.size)
    op = out.load()
    for y in range(im.height):
        for x in range(im.width):
            a = ap[x, y]
            if a < 4:
                op[x, y] = (0, 0, 0, 0)
                continue
            f = a / 255.0
            pr, pg, pb = px[x, y]
            clip = lambda v: min(255, max(0, int(v)))
            op[x, y] = (clip((pr - 255 * (1 - f)) / f),
                        clip((pg - 255 * (1 - f)) / f),
                        clip((pb - 255 * (1 - f)) / f), a)
    return out.crop(out.getbbox())


def recolour(img, rgb):
    """Keep the shape, change the ink — for "Labs" on a dark page."""
    out = Image.new("RGBA", img.size, rgb + (0,))
    out.putalpha(img.split()[3])
    return out


def widest_blank(filled):
    """The widest run of empty lines in a row/column profile."""
    best, run = None, None
    for i, on in enumerate(list(filled) + [True]):
        if not on and run is None:
            run = i
        elif on and run is not None:
            if best is None or i - run > best[1] - best[0]:
                best = (run, i)
            run = None
    return best


def above_tagline(img):
    """The artwork is the lockup over a small tagline — GOOD TECH DELIVERED.
    The widest blank row run is the air between them; everything above it is
    the lockup. Without this the crop takes the tail of the tagline with it
    and the word comes out as "Labs LIVERED"."""
    al = img.split()[3].load()
    rows = [any(al[x, y] > 24 for x in range(img.width)) for y in range(img.height)]
    g = widest_blank(rows)
    return img.crop((0, 0, img.width, g[0])) if g else img


def gap_after_tek(img):
    """The widest blank column run is the space before "Labs"."""
    al = img.split()[3].load()
    cols = [any(al[x, y] > 24 for y in range(img.height)) for x in range(img.width)]
    return widest_blank(cols)


mark = key_white(os.path.join(SRC, "hao-mark-source.png"))
lock = above_tagline(key_white(os.path.join(SRC, "haotek-labs-source.png")))
g = gap_after_tek(lock)
labs = lock.crop((g[1], 0, lock.width, lock.height))
labs = labs.crop(labs.getbbox())


def lockup(word_rgb, height=320):
    """mark + Labs, standing on one baseline, in the proportions of the
    official hǎo Labs artwork."""
    m = mark.resize((round(mark.width * height / mark.height), height), Image.LANCZOS)
    # "Labs" reads at a little over half the mark's full height — the mark
    # carries a breve above its own letters, the word does not.
    lh = round(height * 0.545)
    w = labs.resize((round(labs.width * lh / labs.height), lh), Image.LANCZOS)
    w = recolour(w, word_rgb)
    gapx = round(height * 0.10)
    out = Image.new("RGBA", (m.width + gapx + w.width, height), (0, 0, 0, 0))
    out.alpha_composite(m, (0, 0))
    # Baselines together: both sit on the foot of the artwork.
    out.alpha_composite(w, (m.width + gapx, height - w.height - round(height * 0.012)))
    return out.crop(out.getbbox())


def save(im, *path):
    p = os.path.join(BRAND, *path)
    im.save(p, "PNG", optimize=True)
    print(p, im.size, os.path.getsize(p))


save(mark.resize((round(mark.width * 512 / mark.height), 512), Image.LANCZOS), "hao-mark.png")
save(lockup((255, 255, 255)), "hao-labs-dark.png")
save(lockup(INK), "hao-labs-light.png")


def tile(px, glyph=0.70, radius=0.22, bg=(255, 255, 255, 255)):
    """The mark on its own tile. White, the way the logo is drawn — a red mark
    on a red tile would disappear."""
    n = px * SS
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if radius:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * radius), fill=bg)
    else:
        d.rectangle([0, 0, n - 1, n - 1], fill=bg)
    mw = int(n * glyph)
    m = mark.resize((mw, max(1, round(mark.height * mw / mark.width))), Image.LANCZOS)
    im.alpha_composite(m, ((n - m.width) // 2, (n - m.height) // 2))
    return im.resize((px, px), Image.LANCZOS)


save(tile(192), "app-192.png")
save(tile(512), "app-512.png")
# Android cuts its own shape out of a maskable icon, so the mark keeps well
# inside the circle it may be cut down to, and the tile is full-bleed.
save(tile(512, glyph=0.52, radius=0), "app-maskable-512.png")
# iOS rounds the corners itself and puts black behind any transparency.
save(tile(180, glyph=0.68, radius=0), "apple-touch-icon.png")
save(tile(64, glyph=0.72, radius=0.22), "favicon.png")

# ── the iPhone launch screens ───────────────────────────────────────────────
SPLASH = [
    (440, 956, 3), (430, 932, 3), (428, 926, 3), (420, 912, 3), (414, 896, 3),
    (414, 896, 2), (414, 736, 3), (402, 874, 3), (393, 852, 3), (390, 844, 3),
    (375, 812, 3), (375, 667, 2), (320, 568, 2),
]

for w, h, r in SPLASH:
    W, H = w * r, h * r
    im = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(im)
    for y in range(H):                       # the house red, faint, behind it
        t = 1 - abs(y - H * 0.42) / (H * 0.72)
        if t > 0:
            v = int(30 * t * t)
            d.line([(0, y), (W, y)], fill=(10 + v, 10 + v // 4, 11 + v // 5))
    lw = int(W * 0.56)
    lk = lockup((255, 255, 255), height=round(lw * 0.34))
    lk = lk.resize((lw, round(lk.height * lw / lk.width)), Image.LANCZOS)
    im.paste(lk, ((W - lk.width) // 2, int(H * 0.42) - lk.height // 2), lk)
    d.text((W / 2, int(H * 0.42) + lk.height), "HAO STOCK",
           font=ImageFont.truetype(F + "Arial Bold.ttf", int(W * 0.028)),
           fill=(238, 49, 36), anchor="mm")
    im.save(os.path.join(SPLASH_DIR, f"{w}x{h}@{r}.png"), "PNG", optimize=True)

print(f"{len(SPLASH)} launch screens in {SPLASH_DIR}")
