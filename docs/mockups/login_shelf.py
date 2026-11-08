"""The cartons that stand on the horizon of the sign-in scene.

The sign-in page is one full screen with the brand on it (Nino, 9 Nov 2026,
after Super Drive's): a night floor running away to a lime horizon, and the
shelf of real product standing on that line. This writes the shelf on its own,
on nothing — no backdrop, no edge fade — so the stylesheet can stand it
wherever the horizon falls and light it from behind:

    python3 docs/mockups/login_shelf.py

It writes client/public/login-shelf.webp (transparent). The scene around it is
CSS; see client/src/pages/login.css.

Same four cartons as the admin banner and the same source plates, so the two
pictures cannot drift apart: Pepa booklets, Civlily's wide tray, OHIS, and the
tall Pepa carton. Here they share ONE baseline — on the banner they sit on a
shelf seen from above, here they stand on a floor seen almost edge-on.
"""

from PIL import Image, ImageFilter, ImageChops, ImageEnhance
import glob, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import r3d
import ohis
import civlily

PUB = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "client", "public"))

W, H = 1560, 720
BASE = 540          # the horizon: every carton stands with its feet on this line


def pick(pattern):
    found = sorted(glob.glob(os.path.join(PUB, "pepa", pattern)))
    return found[0] if found else None


def crush(mask):
    """A keyed drop shadow survives as a half-transparent smear, pale and very
    visible on a dark floor. The carton itself is solid, so bending the alpha
    curve keeps it and takes the smear: 255 stays 255, 128 falls to 27."""
    return mask.point(lambda a: int(255 * (a / 255) ** 3.0))


def key_out(path, tol=26):
    """The published renders sit on a flat cream studio sweep; lift them off."""
    im = Image.open(path).convert("RGB")
    bg = im.getpixel((2, 2))
    diff = ImageChops.difference(im, Image.new("RGB", im.size, bg)).convert("L")
    mask = diff.point(lambda v: 0 if v < tol else min(255, int((v - tol) * 8)))
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    out = im.convert("RGBA")
    out.putalpha(crush(mask))
    return out.crop(out.getbbox())


def drawn_carton(faces, dims, cam_kw, size):
    """The two brands we draw rather than photograph, keyed off their own
    sweep so they drop onto the floor like the rendered Pepa plates."""
    bw, bh, bd = dims
    q = r3d.box_quads(bw, bh, bd, faces, sheen=0.12)
    cam = r3d.Camera(target=(0, bh / 2, 0), W=size[0] * 2, H=size[1] * 2, **cam_kw)
    layers = r3d.render(q, cam, light=(-0.45, 0.95, 0.6))
    flat = r3d.finish(layers, size[0], size[1], pad=0.03, bg=None).convert("RGB")
    bg = flat.getpixel((2, 2))
    diff = ImageChops.difference(flat, Image.new("RGB", flat.size, bg)).convert("L")
    mask = diff.point(lambda v: 0 if v < 10 else min(255, (v - 10) * 10))
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    out = flat.convert("RGBA")
    out.putalpha(crush(mask))
    return out.crop(out.getbbox())


shelf = Image.new("RGBA", (W, H), (0, 0, 0, 0))


def stand(img, h, cx, dim=0.0, reflect=0.26):
    """One carton standing on BASE: its contact shadow, a little of itself in
    the floor, then the carton."""
    s = img.resize((max(1, int(img.width * h / img.height)), h), Image.LANCZOS)
    if dim:
        s = Image.alpha_composite(s, Image.new("RGBA", s.size, (6, 14, 12, int(255 * dim))))

    # The dark the carton presses into the floor right under its feet.
    shadow = Image.new("RGBA", (s.width + 140, 72), (0, 0, 0, 0))
    blob = Image.new("RGBA", (s.width + 10, 30), (0, 0, 0, 180))
    shadow.paste(blob, (65, 18), blob)
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    shelf.alpha_composite(shadow, (cx - shadow.width // 2, BASE - 26))

    if reflect:
        ref = s.transpose(Image.FLIP_TOP_BOTTOM).crop((0, 0, s.width, int(h * reflect)))
        fade = Image.new("L", ref.size)
        fp = fade.load()
        for yy in range(ref.height):
            v = int(58 * (1 - yy / ref.height) ** 1.9)
            for xx in range(ref.width):
                fp[xx, yy] = v
        ref.putalpha(ImageChops.multiply(ref.split()[3], fade))
        shelf.alpha_composite(ref, (cx - ref.width // 2, BASE))

    shelf.alpha_composite(s, (cx - s.width // 2, BASE - h))


hero = key_out(pick("hero-1000.*.webp") or pick("hero-700.*.webp"))
book = key_out(pick("kubwa-booklets-1000.*.webp") or pick("kubwa-booklets-700.*.webp"))
oh = drawn_carton(ohis.faces(46 / 74), (74, 115, 46),
                  dict(dist=330, az=34, el=15, fov=26), (620, 860))
civ = drawn_carton(civlily.faces(112 / 125), (125, 58, 112),
                   dict(dist=430, az=30, el=22, fov=26), (760, 560))

# Left to right across the floor, the tall carton nearest the eye on the right
# — the phone crops to the right-hand end, so what must be seen stands there.
stand(book, 252, 278, dim=0.16)
stand(civ, 258, 620, dim=0.08)
stand(oh, 384, 952, dim=0.02)
stand(hero, 442, 1296, dim=0.0)

shelf = ImageEnhance.Contrast(shelf).enhance(1.08)
out = os.path.join(PUB, "login-shelf.webp")
shelf.save(out, "WEBP", quality=88, method=6, lossless=False)
print(out, shelf.size, os.path.getsize(out))
