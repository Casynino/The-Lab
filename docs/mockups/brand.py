"""ZELab's own mark — the hǎo Labs logo, renamed (Nino, 10 Nov 2026).

THE RENAME. The business is now called ZELab (www.zelab.site) and the logo had to
keep EXACTLY the old one's style and colours — "I don't want the new logo to look
different from the old logo". So the lockup is the old one with new letters:
    red   "ZE"   big, in the weight and rounded corners of the old red hǎo (drawn
                  here, stroke 132 on a 510 cap height), joined on one shared foot
                  with a thin knife-cut line between the two letters — where "hǎo"
                  stood. ("ZE is red and Lab is white", Nino 10 Nov 2026.)
    white "L"     just as BIG as the Z and E, but standing on its own, not joined to
                  the "ZE" ("I just want the L to be big as well");
    white "ab"    small, Nino's own lettering of "Labs" (cut from the official
                  artwork), where "Labs" stood — plain, no tone mark (he asked for
                  it off). No "s": the name is ZELab.
Colours are untouched: the same red (255,0,0) and white / ink.

History: Hao Labs' own mark, cut out of the official artwork.

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
    zel-mark.png          the mark alone: red "ZE" + big white "L", transparent
    zelab-dark.png        "ZEL" + "ab": red ZE, white Lab, for the app's near-black
    zelab-light.png       the same with Lab in ink, for white paper
    lab-dark.png          just "Lab" (big L + ab, white) — the sidebar header
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


hao = key_white(os.path.join(SRC, "hao-mark-source.png"))     # the OLD mark — now only the source of the logo's red
RED = hao.getpixel((50, 300))[:3]                               # (255, 0, 0): the logo's own red, never retuned
lock = above_tagline(key_white(os.path.join(SRC, "haotek-labs-source.png")))
g = gap_after_tek(lock)
labs = lock.crop((g[1], 0, lock.width, lock.height))
labs = labs.crop(labs.getbbox())


def zel_masks(S=4, H=510, s=106, t=92, zw=360, ew=308, lw=236, dz=134, soften=16,
              gap=9, gap2=24, mid_cut=36):
    """The big letters of ZELab, as two masks of the same size: "ZE" (to be red) and
    "L" (to be the word's colour, white on dark). Stroke 106 on a 510 cap height
    (0.21): Nino found the first drawing, at 96, slim beside the old hǎo, and the
    next, at 132, too chunky ("not too chunky but perfect") — and asked for the size
    of the text to be as nice as the old logo's, so the letters are close-set (a
    thin cut between them, the L's foot kept short) and the small word is large
    enough to be read as the main word, "Lab". "ZE" sit together the
    way the letters of the old "hǎo" did: every corner rounded, and JOINED — Z and E
    share one foot, with a thin knife-cut line between them (the old mark's letters
    were separated by such lines, and shared strokes where they met) and a small
    notch at the top. The "L" is just as big but STANDS ON ITS OWN, not joined to
    the "ZE" (Nino: "the L should not be connected with the ZE, I just want the L to
    be big as well"). Each letter is rounded ON ITS OWN so the thin line survives
    the rounding (rounding them together would close it); then the foot bar is laid
    across the Z-E join only."""
    from PIL import ImageFilter, ImageChops
    pad = 40 * S

    def rounded(fn, w):
        m = Image.new("L", (w * S + 2 * pad, H * S + 2 * pad), 0)
        fn(ImageDraw.Draw(m), lambda pts: [(pad + x * S, pad + y * S) for x, y in pts])
        return m.filter(ImageFilter.GaussianBlur(soften * S)).point(lambda v: 255 if v > 127 else 0)

    def z_letter(d, P):       # top bar, a diagonal of horizontal width dz, foot
        d.polygon(P([(0, 0), (zw, 0), (zw, t), (dz, H - t), (zw, H - t), (zw, H),
                     (0, H), (0, H - t), (zw - dz, t), (0, t)]), fill=255)

    mid = (H - t) / 2

    def e_letter(d, P):       # stem and three arms, the middle one a little shorter
        d.rectangle(P([(0, 0), (s, H)]), fill=255)
        for y0, y1, L in ((0, t, ew), (mid, mid + t, ew - mid_cut), (H - t, H, ew)):
            d.rectangle(P([(0, y0), (L, y1)]), fill=255)

    def l_letter(d, P):       # stem and foot
        d.rectangle(P([(0, 0), (s, H)]), fill=255)
        d.rectangle(P([(0, H - t), (lw, H)]), fill=255)

    ex = zw + gap
    lx = ex + ew + gap2
    W = lx + lw
    size = (W * S + 2 * pad, H * S + 2 * pad)
    ze = Image.new("L", size, 0)
    for fn, w, x in ((z_letter, zw, 0), (e_letter, ew, ex)):
        layer = Image.new("L", size, 0)
        layer.paste(rounded(fn, w), (x * S, 0))
        ze = ImageChops.lighter(ze, layer)
    # the shared foot: one bar laid across the Z-E join (and only that one)
    ImageDraw.Draw(ze).rectangle([pad + (zw - 60) * S, pad + (H - t) * S, pad + (ex + 60) * S, pad + H * S], fill=255)
    el = Image.new("L", size, 0)
    el.paste(rounded(l_letter, lw), (lx * S, 0))
    box = ImageChops.lighter(ze, el).getbbox()          # one box for both, so they stay in register
    out = []
    for m in (ze, el):
        m = m.filter(ImageFilter.GaussianBlur(S * 0.7)).crop(box)
        h = 512
        out.append(m.resize((round(m.width * h / m.height), h), Image.LANCZOS))
    return out


ZE_MASK, L_MASK = zel_masks()


def zel_image(l_rgb):
    """"ZE" in the logo's red and the big "L" in the word's colour."""
    out = Image.new("RGBA", ZE_MASK.size, (0, 0, 0, 0))
    out.paste(Image.new("RGBA", out.size, tuple(RED) + (255,)), (0, 0), ZE_MASK)
    out.paste(Image.new("RGBA", out.size, tuple(l_rgb) + (255,)), (0, 0), L_MASK)
    return out


mark = zel_image((255, 255, 255))               # the mark on its own (icons, sidebar): red ZE, white L


def glyph_runs(img, min_ink=24):
    """Column runs that hold ink: one per letter (or per touching pair)."""
    al = img.split()[3].load()
    cols = [sum(1 for y in range(img.height) if al[x, y] > min_ink) for x in range(img.width)]
    runs, start = [], None
    for x, n in enumerate(cols + [0]):
        if n and start is None:
            start = x
        elif not n and start is not None:
            runs.append((start, x - 1))
            start = None
    return runs, cols


def drop_specks(img, keep_ratio=0.04):
    """Remove stray bits: any connected piece of ink smaller than keep_ratio of the
    biggest piece. The "b" and the "s" touch in the artwork, so cutting the "s"
    off leaves a sliver of its tail beside the "b"."""
    from collections import deque
    al = img.split()[3]
    W, H = img.size
    px = al.load()
    seen = [[False] * W for _ in range(H)]
    pieces = []
    for y in range(H):
        for x in range(W):
            if px[x, y] > 24 and not seen[y][x]:
                q, pix = deque([(x, y)]), []
                seen[y][x] = True
                while q:
                    cx, cy = q.popleft()
                    pix.append((cx, cy))
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < W and 0 <= ny < H and px[nx, ny] > 24 and not seen[ny][nx]:
                            seen[ny][nx] = True
                            q.append((nx, ny))
                pieces.append(pix)
    big = max(len(p) for p in pieces)
    out = img.copy()
    op = out.load()
    for pix in pieces:
        if len(pix) < big * keep_ratio:
            for x, y in pix:
                op[x, y] = (0, 0, 0, 0)
    return out


def make_lab():
    """"ab": Nino's own a and b — the "L" is big and red now, and the "s" is gone
    (the name is ZELab). Returns the word cut clean of its neighbours."""
    runs, cols = glyph_runs(labs)
    # In the official artwork the foot of the "L" touches the "a", and the "b"
    # touches the "s": two runs, "La" and "bs".
    (l0, la1), (b0, bs1) = runs[0], runs[1]
    # The "L" stem is full height and its foot (a short bar) sits on the baseline.
    # The "a" begins where ink first appears AFTER the stem in the rows above the
    # foot — its widest part, mid-height — not where the column ink count climbs,
    # which the foot confuses and which clips the bowl flat.
    full = max(cols)
    stem_end = next(x for x in range(l0, la1) if cols[x] < full * 0.6)
    al = labs.split()[3].load()
    band = range(round(labs.height * 0.42), round(labs.height * 0.68))
    a0 = next(x for x in range(stem_end + 1, la1) if any(al[x, y] > 40 for y in band))
    a1 = la1
    # cut "bs" at the thinnest column in the middle of the run: that is the "s" starting
    lo, hi = b0 + round((bs1 - b0) * 0.40), b0 + round((bs1 - b0) * 0.70)
    cut = min(range(lo, hi), key=lambda x: cols[x])
    word = drop_specks(labs.crop((a0, 0, cut, labs.height)))
    box = word.getbbox()
    word = word.crop(box)
    a_alpha = labs.split()[3].crop((a0, 0, a1 + 1, labs.height))
    return {
        "word": word,
        "a_left": 0 - box[0],                  # the "a", in the word's own pixels
        "a_width": a1 - a0 + 1,
        "a_top": a_alpha.getbbox()[1] - box[1],
    }


LAB = make_lab()


def lab_at(height):
    """The word "ab" drawn `height` tall — a plain "a" (Nino, 10 Nov 2026: "I don't
    want the a to have the mark on top"; an earlier version carried the old
    logo's tone mark over it)."""
    word = LAB["word"]
    k = height / word.height
    return word.resize((round(word.width * k), height), Image.LANCZOS)


# "ZE" is the logo's red; "Lab" — the big "L" and the small "ab" — is white on the
# dark app and ink on paper, as "Labs" always was. (For a day it was a soft peach
# tint, because Nino said "Lab should be some soft colours"; his next words were
# "ZE is red and Lab is white boss" — white it is.)
WORD_ON_DARK = (255, 255, 255)
WORD_ON_LIGHT = INK


def lockup(word_rgb, height=320):
    """ZE (red) + L (big) + ab (small), the last two in the word's colour, all
    standing on one baseline, in the proportions of the official hǎo Labs artwork
    (the small word a little over half the mark's height)."""
    m = zel_image(word_rgb)
    m = m.resize((round(m.width * height / m.height), height), Image.LANCZOS)
    lh = round(height * 0.62)
    w = lab_at(lh)
    w = recolour(w, word_rgb)
    gapx = round(height * 0.035)
    out = Image.new("RGBA", (m.width + gapx + w.width, height), (0, 0, 0, 0))
    out.alpha_composite(m, (0, 0))
    # Baselines together: both sit on the foot of the artwork.
    out.alpha_composite(w, (m.width + gapx, height - w.height - round(height * 0.012)))
    return out.crop(out.getbbox())


def lab_lockup(word_rgb, height=320):
    """Just the word: the big L and the small "ab", no "ZE". Nino, 10 Nov 2026, looking at
    the sidebar header: "it should just say Lab, no need for ZELab up there". The same
    letters, the same size relationship and spacing as in the full lockup."""
    l = Image.new("RGBA", L_MASK.size, (0, 0, 0, 0))
    l.paste(Image.new("RGBA", l.size, tuple(word_rgb) + (255,)), (0, 0), L_MASK)
    l = l.crop(l.getbbox())
    l = l.resize((round(l.width * height / l.height), height), Image.LANCZOS)
    w = recolour(lab_at(round(height * 0.62)), word_rgb)
    gapx = round(height * 0.035)
    out = Image.new("RGBA", (l.width + gapx + w.width, height), (0, 0, 0, 0))
    out.alpha_composite(l, (0, 0))
    out.alpha_composite(w, (l.width + gapx, height - w.height - round(height * 0.012)))
    return out.crop(out.getbbox())


def save(im, *path):
    p = os.path.join(BRAND, *path)
    im.save(p, "PNG", optimize=True)
    print(p, im.size, os.path.getsize(p))


save(mark.resize((round(mark.width * 512 / mark.height), 512), Image.LANCZOS), "zel-mark.png")
save(lockup(WORD_ON_DARK), "zelab-dark.png")
save(lockup(WORD_ON_LIGHT), "zelab-light.png")
save(lab_lockup(WORD_ON_DARK), "lab-dark.png")      # the sidebar header says just "Lab"


def tile(px, glyph=0.80, radius=0.22, glow=True):
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
save(tile(512, glyph=0.62, radius=0), "app-maskable-512.png")
# iOS rounds the corners itself and puts black behind any transparency.
save(tile(180, glyph=0.74, radius=0), "apple-touch-icon.png")

# The browser tab. Each size is DRAWN at its own size (not shrunk from a big
# one), so the mark's strokes land on whole pixels; the mark is as wide as the
# tile allows because at 16px it is the only thing there.
fav = {n: tile(n, glyph=0.88 if n <= 32 else 0.84, radius=0.22, glow=False) for n in (16, 32, 48, 64)}
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
    lk = lockup(WORD_ON_DARK, height=round(lw * 0.34))
    lk = lk.resize((lw, round(lk.height * lw / lk.width)), Image.LANCZOS)
    im.paste(lk, ((W - lk.width) // 2, int(H * 0.42) - lk.height // 2), lk)
    d.text((W / 2, int(H * 0.42) + lk.height), "WWW.ZELAB.SITE",
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

lk = lockup(WORD_ON_DARK, height=150 * K)
lw = round(470 * K)
lk = lk.resize((lw, round(lk.height * lw / lk.width)), Image.LANCZOS)
LX = 76 * K
LY = 178 * K
card.paste(lk, (LX, LY), lk)
cd = ImageDraw.Draw(card)
cd.text((LX + 4 * K, LY + lk.height + 56 * K), "We keep Tanzania stocked.",
        font=ImageFont.truetype(F + "Avenir Next.ttc", 38 * K, index=5), fill=(236, 236, 238), anchor="ls")
# the address, letter-spaced by hand (PIL has no tracking)
tf = ImageFont.truetype(F + "Arial Bold.ttf", 18 * K)
tx = LX + 6 * K
for ch in "WWW.ZELAB.SITE":
    cd.text((tx, LY + lk.height + 108 * K), ch, font=tf, fill=(238, 49, 36), anchor="ls")
    tx += cd.textlength(ch, font=tf) + 4 * K
card = card.resize((W, H), Image.LANCZOS)
og = os.path.join(BRAND, "og-image.jpg")
card.save(og, "JPEG", quality=88, optimize=True, progressive=True)
print(og, card.size, os.path.getsize(og))
