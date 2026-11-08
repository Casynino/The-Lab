"""The pictures a phone needs to put The Lab on its home screen.

A website open in a browser tab always keeps the address bar, on every phone
and in every browser — no page can hide it. The only full screen is the one
the person installs. That needs real icons (the browser will not scale a
favicon up for a home screen) and, on an iPhone, a launch picture per screen
size or the app opens on a white flash.

    python3 docs/mockups/app_icons.py

Writes into client/public/brand/:
    app-192.png, app-512.png     the icon Android and the desktop use
    app-maskable-512.png         the same mark inside Android's safe circle
    apple-touch-icon.png         180px, square — iOS rounds it itself
    splash/<w>x<h>@<r>.png       the iPhone launch screens

The mark is the favicon's: the lime tile with the open carton on it
(client/public/favicon.svg). Both are drawn from the same coordinates below,
so changing one means changing the other.
"""

from PIL import Image, ImageDraw, ImageFont
import os

PUB = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "client", "public"))
BRAND = os.path.join(PUB, "brand")
SPLASH_DIR = os.path.join(BRAND, "splash")
os.makedirs(SPLASH_DIR, exist_ok=True)

RED = (238, 49, 36, 255)        # brand-500 — Hao Labs' own red
INK = (10, 10, 11, 255)         # the page's own near-black
WHITE = (255, 255, 255, 255)    # the mark sits white on the red tile
SS = 4                          # drawn at four times, then shrunk

F = "/System/Library/Fonts/Supplemental/"
font = lambda name, size: ImageFont.truetype(F + name, size)

# The carton, in the favicon's own 64-unit square.
HEX = [(32, 13), (51, 24), (51, 40), (32, 51), (13, 40), (13, 24)]
SPOKES = [[(32, 13), (32, 32)], [(32, 32), (51, 24)], [(32, 32), (13, 24)]]


def carton(d, cx, cy, size, colour=WHITE):
    """The open carton: a cube seen corner-on, one line, round corners."""
    k = size / 64
    w = max(2, int(3.5 * k))
    at = lambda p: (cx + (p[0] - 32) * k, cy + (p[1] - 32) * k)
    pts = [at(p) for p in HEX]
    d.line(pts + [pts[0]], fill=colour, width=w, joint="curve")
    for a, b in SPOKES:
        d.line([at(a), at(b)], fill=colour, width=w)
    # Round every corner by hand: PIL's joint="curve" rounds the joins but not
    # the ends, and the three spokes end in the middle of the face.
    for p in pts + [at(a) for s in SPOKES for a in s]:
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=colour)


def tile(px, glyph=0.62, radius=0.22, bg=RED):
    """The lime tile with the carton on it. `glyph` is how much of the tile the
    carton takes — Android masks a maskable icon down to a circle, so that one
    is drawn smaller."""
    n = px * SS
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if radius:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * radius), fill=bg)
    else:
        d.rectangle([0, 0, n - 1, n - 1], fill=bg)
    carton(d, n / 2, n / 2, n * glyph)
    return im.resize((px, px), Image.LANCZOS)


def save(im, *path):
    p = os.path.join(BRAND, *path)
    im.save(p, "PNG", optimize=True)
    print(p, im.size, os.path.getsize(p))


save(tile(192), "app-192.png")
save(tile(512), "app-512.png")
# Maskable: no rounded corners of our own (Android cuts its own shape out of
# it) and the mark kept well inside the circle it may be cut down to.
save(tile(512, glyph=0.42, radius=0), "app-maskable-512.png")
# iOS rounds the corners itself and puts black behind any transparency, so
# this one is a full square.
save(tile(180, glyph=0.60, radius=0), "apple-touch-icon.png")


# ── the iPhone launch screens ───────────────────────────────────────────────
# Every portrait iPhone still in use. A size with no picture of its own opens
# on a white flash, so the list is long on purpose.
SPLASH = [
    (440, 956, 3), (430, 932, 3), (428, 926, 3), (420, 912, 3), (414, 896, 3),
    (414, 896, 2), (414, 736, 3), (402, 874, 3), (393, 852, 3), (390, 844, 3),
    (375, 812, 3), (375, 667, 2), (320, 568, 2),
]

for w, h, r in SPLASH:
    W, H = w * r, h * r
    im = Image.new("RGB", (W, H), INK[:3])
    d = ImageDraw.Draw(im)
    # The same faint lime wash the app itself sits on (client/src/index.css).
    for y in range(H):
        t = 1 - abs(y - H * 0.42) / (H * 0.72)
        if t > 0:
            v = int(26 * t * t)
            d.line([(0, y), (W, y)], fill=(10 + v, 10 + v // 4, 11 + v // 5))
    side = int(min(W, H) * 0.22)
    im.paste(tile(side), ((W - side) // 2, int(H * 0.40) - side // 2), tile(side))
    d.text((W / 2, int(H * 0.40) + side * 0.82), "HAO LABS",
           font=font("Arial Bold.ttf", int(side * 0.19)), fill=(244, 244, 245), anchor="mm")
    d.text((W / 2, int(H * 0.40) + side * 1.12), "HAO STOCK",
           font=font("Arial Bold.ttf", int(side * 0.10)), fill=(255, 95, 75), anchor="mm")
    p = os.path.join(SPLASH_DIR, f"{w}x{h}@{r}.png")
    im.save(p, "PNG", optimize=True)

print(f"{len(SPLASH)} launch screens in {SPLASH_DIR}")
