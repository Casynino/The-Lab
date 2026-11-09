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
    favicon-32.png, ../favicon.ico                    the browser-tab icon
    og-image.jpg                                      the card a shared link shows

10 Nov 2026, Nino, looking at the browser tab: the icon was the red mark, small, on
a flat WHITE square — harsh on a dark tab strip and hard to read at 16px. The
tile is now the app's own near-black with the mark large on it (the red reads
at any size, on a dark or a light browser), and the same tile is used for the
home-screen icons. The share card (og-image.jpg) puts the Dar coast from the
sign-in page behind the lockup so a link in WhatsApp or Telegram looks like
Hao Labs instead of a bare address.
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


def tile(px, glyph=0.76, radius=0.22, glow=True):
    """The mark on its own tile: the app's near-black, the red mark large on it.
    A red mark on white (the old tile) was harsh on a dark browser and small at
    16px; on ink it reads at any size and sits in the app's own colours. From
    120px up the tile carries what the launch screen has — the house red,
    faint, rising from the bottom edge — and a hairline so its edge shows on a
    dark home screen. Small sizes stay flat and crisp."""
    n = px * SS
    base = Image.new("RGBA", (n, n), INK + (255,))
    if glow and px >= 120:
        d = ImageDraw.Draw(base)
        for y in range(n):
            t = max(0.0, (y / n - 0.40) / 0.60)
            v = int(46 * t * t)
            d.line([(0, y), (n, y)], fill=(10 + v, 10 + v // 5, 11 + v // 6, 255))
    mw = int(n * glyph)
    m = mark.resize((mw, max(1, round(mark.height * mw / mark.width))), Image.LANCZOS)
    base.alpha_composite(m, ((n - m.width) // 2, (n - m.height) // 2))
    mask = Image.new("L", (n, n), 0)
    md = ImageDraw.Draw(mask)
    if radius:
        md.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * radius), fill=255)
    else:
        md.rectangle([0, 0, n - 1, n - 1], fill=255)
    out = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    if radius and px >= 120:
        ring = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        ImageDraw.Draw(ring).rounded_rectangle(
            [0, 0, n - 1, n - 1], radius=int(n * radius), outline=(255, 255, 255, 26), width=max(2, n // 128))
        out.alpha_composite(ring)
    return out.resize((px, px), Image.LANCZOS)


save(tile(192), "app-192.png")
save(tile(512), "app-512.png")
# Android cuts its own shape out of a maskable icon, so the mark keeps well
# inside the circle it may be cut down to, and the tile is full-bleed.
save(tile(512, glyph=0.58, radius=0), "app-maskable-512.png")
# iOS rounds the corners itself and puts black behind any transparency.
save(tile(180, glyph=0.70, radius=0), "apple-touch-icon.png")

# The browser tab. Each size is DRAWN at its own size (not shrunk from a big
# one), so the mark's strokes land on whole pixels; the mark is as wide as the
# tile allows because at 16px it is the only thing there.
fav = {n: tile(n, glyph=0.86 if n <= 32 else 0.82, radius=0.22, glow=False) for n in (16, 32, 48, 64)}
save(fav[64], "favicon.png")
save(fav[32], "favicon-32.png")


def write_ico(path, images):
    """A real .ico (PNG inside) — browsers ask for /favicon.ico by that name
    whatever the page says, and the site used to answer with the web page."""
    import io, struct
    blobs = []
    for im in images:
        b = io.BytesIO()
        im.save(b, "PNG", optimize=True)
        blobs.append((im.width, b.getvalue()))
    head = struct.pack("<HHH", 0, 1, len(blobs))
    off = 6 + 16 * len(blobs)
    entries, data = b"", b""
    for w, blob in blobs:
        entries += struct.pack("<BBBBHHII", w % 256, w % 256, 0, 0, 1, 32, len(blob), off + len(data))
        data += blob
    with open(path, "wb") as f:
        f.write(head + entries + data)
    print(path, [i.size for i in images], os.path.getsize(path))


write_ico(os.path.join(PUB, "favicon.ico"), [fav[16], fav[32], fav[48]])

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


# ── the card a shared link shows ────────────────────────────────────────────
# 1200x630 (the size WhatsApp, Telegram, Facebook, LinkedIn and X all draw
# without cropping the middle). The Dar coast from the sign-in page comes up
# out of the dark on the right; the lockup and the line sit on the dark on the
# left. Kept under ~150 KB as a JPEG because WhatsApp drops big previews.
W, H, K = 1200, 630, 2
card = Image.new("RGB", (W * K, H * K), INK)
cd = ImageDraw.Draw(card)
for y in range(H * K):                        # the house red, faint, as on the launch screen
    t = 1 - abs(y - H * K * 0.40) / (H * K * 0.80)
    if t > 0:
        v = int(26 * t * t)
        cd.line([(0, y), (W * K, y)], fill=(10 + v, 10 + v // 4, 11 + v // 5))

scene = Image.open(os.path.join(PUB, "scene", "landscape-poster.webp")).convert("RGB")
sc = 0.9333 * K
scene = scene.resize((round(scene.width * sc), round(scene.height * sc)), Image.LANCZOS)
sx, sy = round(83 * K), round(-118 * K)       # the Lab lands right of centre, a little above the middle
ramp = Image.new("L", scene.size, 0)           # the picture comes up out of the dark, left to right
rp = ramp.load()
x0, x1 = round((200 - 83) * K), round((640 - 83) * K)
for x in range(scene.width):
    u = min(1.0, max(0.0, (x - x0) / (x1 - x0)))
    v = int(255 * u * u * (3 - 2 * u))
    for y in range(scene.height):
        rp[x, y] = v
card.paste(scene, (sx, sy), ramp)
# a little weight at the very bottom and top so the edges settle into the page
shade = Image.new("L", card.size, 0)
sp = ImageDraw.Draw(shade)
for y in range(H * K):
    e = max(0.0, 1 - y / (H * K * 0.16)) + max(0.0, (y / (H * K) - 0.86) / 0.14)
    sp.line([(0, y), (W * K, y)], fill=int(110 * min(1.0, e)))
card.paste(Image.new("RGB", card.size, INK), (0, 0), shade)

lk = lockup((255, 255, 255), height=150 * K)
lw = round(430 * K)
lk = lk.resize((lw, round(lk.height * lw / lk.width)), Image.LANCZOS)
LX = 76 * K
LY = 178 * K
card.paste(lk, (LX, LY), lk)
cd = ImageDraw.Draw(card)
cd.text((LX + 4 * K, LY + lk.height + 56 * K), "We keep Tanzania stocked.",
        font=ImageFont.truetype(F + "Avenir Next.ttc", 38 * K, index=5), fill=(236, 236, 238), anchor="ls")
# "HAO STOCK", letter-spaced by hand (PIL has no tracking)
tf = ImageFont.truetype(F + "Arial Bold.ttf", 18 * K)
tx = LX + 6 * K
for ch in "HAO STOCK":
    cd.text((tx, LY + lk.height + 108 * K), ch, font=tf, fill=(238, 49, 36), anchor="ls")
    tx += cd.textlength(ch, font=tf) + 4 * K
card = card.resize((W, H), Image.LANCZOS)
og = os.path.join(BRAND, "og-image.jpg")
card.save(og, "JPEG", quality=88, optimize=True, progressive=True)
print(og, card.size, os.path.getsize(og))
