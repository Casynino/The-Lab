"""The Civlily display box, drawn clean.

From the supplier's own dimensioned photograph (125 x 112 x 58 mm): a copper
board that goes dark at the edges and warm in the middle, the white wordmark
outlined in brown across it, the 24 PER BOX seal and the UNBLEACHED tag.

Same reason as ohis.py — the only pictures we hold are price-list snaps and a
supplier render on a linen backdrop, and neither sits beside the Pepa cartons
without looking borrowed. Drawn here, it is lit by the same light as the rest.
"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math, os

HERE = os.path.dirname(os.path.abspath(__file__))
F = "/System/Library/Fonts/Supplemental/"

DARK = (74, 40, 26)
COPPER = (176, 104, 56)
TAN = (214, 160, 106)
CREAM = (246, 238, 224)

W, H = 1100, 510          # the 125 x 58 mm front, at 8.8 px/mm


def font(name, size):
    return ImageFont.truetype(F + name, size)


def board(w, h):
    """Copper, dark at the edges and warm through the middle, with a little
    cloud in it — the board is printed with a marbled wash."""
    im = Image.new("RGB", (w, h), DARK)
    px = im.load()
    for x in range(w):
        t = abs(x / (w - 1) - 0.5) * 2          # 0 in the middle, 1 at the edges
        for y in range(h):
            v = abs(y / (h - 1) - 0.42) * 2
            k = max(0.0, 1 - (0.70 * t ** 1.5 + 0.45 * v ** 1.7))
            px[x, y] = (int(DARK[0] + (COPPER[0] - DARK[0]) * k),
                        int(DARK[1] + (COPPER[1] - DARK[1]) * k),
                        int(DARK[2] + (COPPER[2] - DARK[2]) * k))
    cloud = Image.new("L", (w, h), 0)
    cd = ImageDraw.Draw(cloud)
    for i in range(26):
        a = i * 2.399
        cx = w / 2 + math.cos(a) * w * 0.26 * ((i % 5) / 5 + 0.3)
        cy = h / 2 + math.sin(a * 1.7) * h * 0.30 * ((i % 4) / 4 + 0.3)
        r = w * (0.05 + 0.035 * ((i % 6) / 6))
        cd.ellipse((cx - r, cy - r * 0.7, cx + r, cy + r * 0.7), fill=40 + (i % 5) * 9)
    cloud = cloud.filter(ImageFilter.GaussianBlur(w * 0.045))
    return Image.composite(Image.new("RGB", (w, h), TAN), im, cloud.point(lambda v: int(v * 0.55)))


def wordmark(d, cx, cy, size, text="Civlily"):
    """White, outlined in the board's own brown, with a soft drop."""
    f = font("Times New Roman Bold Italic.ttf", size)
    d.text((cx + size * 0.035, cy + size * 0.045), text, font=f, fill=(40, 20, 12), anchor="mm")
    d.text((cx, cy), text, font=f, fill=CREAM, anchor="mm",
           stroke_width=max(2, size // 26), stroke_fill=(52, 26, 16))


def seal(size=170, top="24", bottom="PER BOX"):
    s = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(s)
    c, r = size / 2, size / 2 - 3
    # a scalloped edge, as on the board
    for k in range(26):
        a = math.radians(k * 360 / 26)
        d.ellipse((c + r * math.cos(a) - size * 0.05, c + r * math.sin(a) - size * 0.05,
                   c + r * math.cos(a) + size * 0.05, c + r * math.sin(a) + size * 0.05), fill=TAN + (255,))
    d.ellipse((c - r * 0.94, c - r * 0.94, c + r * 0.94, c + r * 0.94), fill=TAN + (255,))
    d.ellipse((c - r * 0.78, c - r * 0.78, c + r * 0.78, c + r * 0.78), outline=(104, 58, 32, 255), width=3)
    d.text((c, c - size * 0.10), top, font=font("Arial Black.ttf", int(size * 0.34)), fill=(86, 46, 26), anchor="mm")
    d.text((c, c + size * 0.17), bottom, font=font("Arial Bold.ttf", int(size * 0.13)), fill=(86, 46, 26), anchor="mm")
    return s


def front():
    im = board(W, H)
    d = ImageDraw.Draw(im)
    wordmark(d, W * 0.40, H * 0.52, 212)
    d.text((W * 0.40 + 268, H * 0.52 - 74), "®", font=font("Arial Bold.ttf", 30), fill=CREAM, anchor="mm")

    s = seal(168)
    im.paste(s, (int(W * 0.76), int(H * 0.16)), s)

    # UNBLEACHED, in its outlined block
    tw, th = 300, 68
    tx, ty = int(W * 0.70), int(H * 0.70)
    d.rounded_rectangle((tx, ty, tx + tw, ty + th), radius=10, outline=CREAM, width=3)
    d.text((tx + tw / 2, ty + th / 2), "U N B L E A C H E D",
           font=font("Arial Bold.ttf", 25), fill=CREAM, anchor="mm")
    return im


def flank(w, h):
    im = board(w, h)
    d = ImageDraw.Draw(im)
    wordmark(d, w / 2, h * 0.54, int(h * 0.42))
    return im


def lid(w, h):
    im = board(w, h)
    d = ImageDraw.Draw(im)
    wordmark(d, w / 2, h / 2, int(min(w, h) * 0.34))
    return im


def faces(depth_ratio=0.896):
    """front / back / left / right / top for r3d.box_quads, 125 x 58 x 112."""
    fr = front()
    dw = int(W * depth_ratio)
    return {
        "front": fr,
        "back": fr.transpose(Image.FLIP_LEFT_RIGHT),
        "left": flank(dw, H),
        "right": flank(dw, H),
        "top": lid(W, dw),
    }


if __name__ == "__main__":
    front().save(os.path.join(HERE, "civlily-front.png"))
    print("wrote civlily-front.png")
