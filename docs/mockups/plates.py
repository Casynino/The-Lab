"""The product plates, cut off their studio sweeps.

One keyer, one set of cartons, shared by everything that shows the product —
the sign-in shelf (login_shelf.py) and the admin banner (banner.py) — so the
two pictures cannot drift apart.

Sources in product-src/ are the real ones: the final Pepa mockups from
Pepa-final and the OHIS supplier photographs (Nino, 9 Nov 2026 — "why don't
you use our product as well… why do you use wrong pictures even in banners").
"""

from PIL import Image, ImageFilter, ImageChops, ImageEnhance, ImageDraw
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import r3d
import civlily

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "product-src")
PUB = os.path.normpath(os.path.join(HERE, "..", "..", "client", "public"))

def crush(mask):
    """A keyed drop shadow survives as a half-transparent smear, pale and very
    visible on a dark floor. The carton itself is solid, so bending the alpha
    curve keeps it and takes the smear: 255 stays 255, 128 falls to 27."""
    return mask.point(lambda a: int(255 * (a / 255) ** 3.0))


def key_out(path, tol=22, trim=None):
    """A product shot on its studio sweep, lifted off it.

    Two things a flat-colour key gets wrong on these, and both of them erased
    most of a carton the first time:

    * The sweep is not one colour. It runs 226 at the top of the frame to 233
      in the middle and back — so the background is measured PER ROW, from the
      eight columns at each edge stretched back across the frame.
    * Pepa's artwork is pale cream on a pale cream sweep. Judged by lightness
      the front face differs by about 19, under any useful threshold; judged
      by its furthest channel it differs by 31, because the difference is in
      the green and the blue, not the brightness. So the mask is the widest
      channel difference, not the luminance of it.
    """
    im = Image.open(path).convert("RGB")
    if trim:
        im = im.crop(trim)
    w, h = im.size
    edges = Image.new("RGB", (16, h))
    edges.paste(im.crop((0, 0, 8, h)), (0, 0))
    edges.paste(im.crop((w - 8, 0, w, h)), (8, 0))
    sweep = edges.resize((w, h), Image.BILINEAR)

    dr, dg, db = ImageChops.difference(im, sweep).split()
    diff = ImageChops.lighter(ImageChops.lighter(dr, dg), db)
    # A steep ramp, not a gentle one. Pepa's pale face clears the threshold by
    # only a dozen or so, and a gentle ramp left it half-transparent — which on
    # a black floor reads as a dark box, not a cream one. This takes anything
    # clearly off-sweep to fully opaque and leaves a narrow band for the edge.
    # A difference key cannot carry these on its own. Pepa's artwork is a pale
    # cream swirl on a pale cream sweep: whole swathes of the face differ from
    # the background by less than the box's own edges do, so thresholding alone
    # punches black holes straight through the carton.
    #
    # So the threshold is only used to find the OUTLINE, which is dark and
    # certain, and the inside is filled by reachability: flood the background
    # in from the four corners, and whatever the flood cannot reach is, by
    # definition, enclosed by the carton — however pale it is.
    outline = diff.point(lambda v: 255 if v >= tol else 0)
    outline = outline.filter(ImageFilter.MaxFilter(3))      # close hairline gaps
    flood = outline.copy()
    for seed in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        ImageDraw.floodfill(flood, seed, 128, thresh=0)
    inside = flood.point(lambda v: 255 if v == 0 else 0)
    mask = ImageChops.lighter(outline, inside)
    # Back in by one more than was grown: the outline's outermost pixels are
    # half sweep, and left on they ring every carton with a pale fringe.
    mask = mask.filter(ImageFilter.MinFilter(5))
    mask = mask.filter(ImageFilter.GaussianBlur(0.7))
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out.crop(out.getbbox())


def drawn_carton(faces, dims, cam_kw, size):
    """Civlily, which we draw — there is no photograph of it yet."""
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




# ── the cartons ─────────────────────────────────────────────────────────────
# The carton occupies columns 319-1085 of a 1400-wide frame; past that is only
# its cast shadow, whose outer edge closes a ring the flood cannot get inside,
# so it came away as a pale wedge stuck to the box. Cut the frame before
# keying and the problem does not arise.
PEPA_TALL = key_out(os.path.join(SRC, "pepa-70x36-front.png"), trim=(0, 0, 1110, 1700))
PEPA_BOX = key_out(os.path.join(SRC, "pepa-77x44-front.png"))
OHIS = key_out(os.path.join(SRC, "ohis-display.png"), tol=16)
# 125 x 58 x 112 from the supplier's dimensioned photograph. Civlily is drawn,
# not photographed — there is no studio shot of it yet.
CIVLILY = drawn_carton(civlily.faces(112 / 125), (125, 58, 112),
                       dict(dist=430, az=30, el=22, fov=26), (760, 560))
