"""The OHIS carton, drawn clean.

The only OHIS pictures we hold are the price-list photographs in
"CIVLILY & OHIS .pdf" — a shrink-wrapped box held against a wall under a warm
bulb, creased, glared and with a thumb across one corner. Flattened and
colour-corrected it is still a photograph of a crumpled wrapper, and set
beside the Pepa renders it looks like what it is.

So the face is redrawn here from that photograph: same kraft board, same
layout, same words, same deep red wordmark — just without the wrapper. It
feeds the same r3d box the Pepa cartons use, so the two are lit by one light
and belong in one picture.
"""

from PIL import Image, ImageDraw, ImageFont
import math, os

HERE = os.path.dirname(os.path.abspath(__file__))
F = "/System/Library/Fonts/Supplemental/"

KRAFT = (201, 165, 103)
KRAFT_DARK = (178, 142, 84)
INK = (58, 42, 26)
RED = (158, 40, 36)
CREAM = (238, 228, 206)

W, H = 740, 1150


def font(name, size):
    return ImageFont.truetype(F + name, size)


def paper(w, h, base=KRAFT):
    """Kraft board: a soft vertical shade with a little fibre in it."""
    im = Image.new("RGB", (w, h), base)
    px = im.load()
    for y in range(h):
        t = y / max(1, h - 1)
        k = 1.0 - 0.07 * t
        row = (int(base[0] * k), int(base[1] * k), int(base[2] * k))
        for x in range(w):
            px[x, y] = row
    # fibre, cheap and deterministic: a fixed lattice rather than randomness,
    # so the same board comes out of every run
    for y in range(0, h, 3):
        for x in range((y // 3) % 3, w, 7):
            r, g, b = px[x, y]
            px[x, y] = (min(255, r + 6), min(255, g + 5), min(255, b + 4))
    return im


def tag(d, box, text, fnt):
    """A dark label block with cream letters, as on the board."""
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=(y1 - y0) // 5, fill=INK)
    tw = d.textlength(text, font=fnt)
    d.text(((x0 + x1 - tw) / 2, (y0 + y1) / 2), text, font=fnt, fill=CREAM, anchor="lm")


def arc_text(img, text, cx, cy, r, start, end, fnt, fill, flip=False):
    """Letters set around a circle, one glyph at a time."""
    n = max(1, len(text) - 1)
    for i, ch in enumerate(text):
        a = start + (end - start) * (i / n)
        layer = Image.new("RGBA", (120, 120), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.text((60, 60), ch, font=fnt, fill=fill, anchor="mm")
        layer = layer.rotate(-(a + 90) if not flip else -(a - 90), resample=Image.BICUBIC, center=(60, 60))
        x = cx + r * math.cos(math.radians(a))
        y = cy + r * math.sin(math.radians(a))
        img.paste(layer, (int(x - 60), int(y - 60)), layer)


def seal(size=250):
    """UNBLEACHED · ORIGINAL, around a leaf."""
    s = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(s)
    c, r = size / 2, size / 2 - 6
    d.ellipse((c - r, c - r, c + r, c + r), fill=(242, 233, 212, 255), outline=RED + (255,), width=5)
    d.ellipse((c - r + 16, c - r + 16, c + r - 16, c + r - 16), outline=RED + (255,), width=3)
    small = font("Arial Bold.ttf", 23)
    arc_text(s, "UNBLEACHED", c, c, r - 34, 200, 340, small, RED + (255,))
    arc_text(s, "ORIGINAL", c, c, r - 34, 140, 40, small, RED + (255,), flip=True)
    for k in range(6):
        a = math.radians(180 + k * 36)
        d.text((c + (r - 34) * math.cos(a), c + (r - 34) * math.sin(a)), "*", font=small, fill=RED, anchor="mm")
    # the leaf
    leaf = [(c, c - 32)]
    for k in range(1, 20):
        t = k / 20
        leaf.append((c + 25 * math.sin(math.pi * t) ** 0.8, c - 32 + 62 * t))
    for k in range(19, 0, -1):
        t = k / 20
        leaf.append((c - 25 * math.sin(math.pi * t) ** 0.8, c - 32 + 62 * t))
    d.polygon(leaf, fill=RED)
    d.line([(c, c - 30), (c, c + 28)], fill=(242, 233, 212), width=3)
    return s


def crown(size=120):
    """The little crown that sits over the wordmark."""
    c = Image.new("RGBA", (size, int(size * 0.62)), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    w, h = c.size
    d.polygon([(0, h), (0, h * 0.30), (w * 0.22, h * 0.62), (w * 0.5, h * 0.06),
               (w * 0.78, h * 0.62), (w, h * 0.30), (w, h)], fill=RED)
    d.rectangle((0, h * 0.84, w, h), fill=RED)
    for k in (0.0, 0.5, 1.0):
        x = max(5, min(w - 5, w * k))
        d.ellipse((x - 7, h * 0.30 - 9, x + 7, h * 0.30 + 5), fill=RED)
    return c


def roundel(size=150):
    """The S mark: a ring with the leaf-S inside it."""
    r = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(r)
    c, rad = size / 2, size / 2 - 4
    d.ellipse((c - rad, c - rad, c + rad, c + rad), fill=(243, 236, 219, 255), outline=INK + (255,), width=5)
    d.text((c, c + 2), "S", font=font("Baskerville.ttc", int(size * 0.74)), fill=RED, anchor="mm")
    return r


def front():
    """The display box's front, as on the real carton: the brown tag and the
    seal across the top, the crowned wordmark in the middle, and what is
    inside it spelled out underneath."""
    im = paper(W, H)
    d = ImageDraw.Draw(im)

    tag(d, (58, 70, 268, 140), "B R O W N", font("Arial Bold.ttf", 34))
    s = seal(196)
    im.paste(s, (482, 46), s)

    cr = crown(132)
    im.paste(cr, (int(W / 2 - cr.width / 2), 268), cr)

    # the wordmark, letter by letter so it can be tracked like the board's own
    f = font("Times New Roman Bold.ttf", 236)
    letters, track = "OHIS", 12
    total = sum(d.textlength(ch, font=f) for ch in letters) + track * (len(letters) - 1)
    x = (W - total) / 2
    for ch in letters:
        d.text((x, 500), ch, font=f, fill=RED, anchor="lm")
        x += d.textlength(ch, font=f) + track

    sub = font("Arial Bold.ttf", 28)
    t = "NATURAL UNBLEACHED ROLLING PAPERS"
    d.text(((W - d.textlength(t, font=sub)) / 2, 594), t, font=sub, fill=INK)

    king = font("Arial Bold.ttf", 46)
    t2 = "KINGSIZE SLIM"
    d.text(((W - d.textlength(t2, font=king)) / 2, 680), t2, font=king, fill=INK)
    t3 = "+  T I P S"
    d.text(((W - d.textlength(t3, font=king)) / 2, 740), t3, font=king, fill=RED)

    tag(d, (58, 862, 268, 932), "B R O W N", font("Arial Bold.ttf", 34))

    ro = roundel(148)
    im.paste(ro, (W - ro.width - 56, 850), ro)

    d.text((W / 2, 1052), "50 BOOKLETS  ·  32 LEAVES EACH",
           font=font("Arial Bold.ttf", 30), fill=INK, anchor="mm")
    return im


def side(w, h):
    """A plain board flank with the lid seam carried round."""
    im = paper(w, h, KRAFT_DARK)
    d = ImageDraw.Draw(im)
    d.line([(0, int(h * 318 / H)), (w, int(h * 318 / H))], fill=(160, 126, 72), width=3)
    f = font("Times New Roman Bold.ttf", max(18, int(w * 0.34)))
    d.text((w / 2, h * 0.52), "OHIS", font=f, fill=RED, anchor="mm")
    return im


def lid(w, h):
    im = paper(w, h, (193, 157, 96))
    d = ImageDraw.Draw(im)
    f = font("Times New Roman Bold.ttf", max(20, int(h * 0.34)))
    d.text((w / 2, h / 2), "OHIS", font=f, fill=RED, anchor="mm")
    return im


def faces(depth_ratio=0.62):
    """front / back / left / right / top, ready for r3d.box_quads."""
    fr = front()
    dw = int(W * depth_ratio)
    return {
        "front": fr,
        "back": fr.transpose(Image.FLIP_LEFT_RIGHT),
        "left": side(dw, H),
        "right": side(dw, H),
        "top": lid(W, dw),
    }


if __name__ == "__main__":
    front().save(os.path.join(HERE, "ohis-front.png"))
    print("wrote ohis-front.png")
