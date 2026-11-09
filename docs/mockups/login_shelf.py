"""The cartons that used to stand on the horizon of the sign-in scene.

NOT WIRED TO ANYTHING SINCE 9 Nov 2026. The sign-in scene is the Tanzania map
with the rendered fleet now (docs/mockups/fleet.py), so nothing loads these and
the files are no longer committed — shipping 117 KB nobody looks at is 117 KB
off a rep's data bundle. The script still runs if the shelf is ever wanted
back; the plates it arranges live in plates.py, which the admin banner uses.


    python3 docs/mockups/login_shelf.py

Writes client/public/login-shelf.webp (transparent) and the three small
cartons that cross the floor in front of it. The plates themselves — the real
Pepa mockups and the OHIS photographs, cut off their studio sweeps — come from
plates.py, which the admin banner uses too so the two cannot drift apart. The
scene around them is CSS; see client/src/pages/login.css.
"""

from PIL import Image, ImageFilter, ImageChops, ImageEnhance
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plates import PEPA_TALL, PEPA_BOX, OHIS, CIVLILY, PUB

W, H = 1680, 760
BASE = 570          # the horizon: every carton stands with its feet on this line


shelf = Image.new("RGBA", (W, H), (0, 0, 0, 0))


def stand(img, h, cx, dim=0.0, reflect=0.24):
    """One carton standing on BASE: its contact shadow, a little of itself in
    the floor, then the carton."""
    s = img.resize((max(1, int(img.width * h / img.height)), h), Image.LANCZOS)
    if dim:
        s = Image.alpha_composite(s, Image.new("RGBA", s.size, (10, 6, 6, int(255 * dim))))

    shadow = Image.new("RGBA", (s.width + 140, 72), (0, 0, 0, 0))
    blob = Image.new("RGBA", (s.width + 10, 30), (0, 0, 0, 185))
    shadow.paste(blob, (65, 18), blob)
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    shelf.alpha_composite(shadow, (cx - shadow.width // 2, BASE - 26))

    if reflect:
        ref = s.transpose(Image.FLIP_TOP_BOTTOM).crop((0, 0, s.width, int(h * reflect)))
        fade = Image.new("L", ref.size)
        fp = fade.load()
        for yy in range(ref.height):
            v = int(56 * (1 - yy / ref.height) ** 1.9)
            for xx in range(ref.width):
                fp[xx, yy] = v
        ref.putalpha(ImageChops.multiply(ref.split()[3], fade))
        shelf.alpha_composite(ref, (cx - ref.width // 2, BASE))

    shelf.alpha_composite(s, (cx - s.width // 2, BASE - h))


# Left to right, the tall Pepa carton nearest the eye on the right — the phone
# crops to that end, so what must be seen stands there.
stand(CIVLILY, 230, 250, dim=0.20)
stand(PEPA_BOX, 250, 640, dim=0.08)
stand(OHIS, 330, 1060, dim=0.02)
stand(PEPA_TALL, 450, 1440, dim=0.0)

shelf = ImageEnhance.Contrast(shelf).enhance(1.06)
out = os.path.join(PUB, "login-shelf.webp")
shelf.save(out, "WEBP", quality=88, method=6)
print(out, shelf.size, os.path.getsize(out))


# ── the traffic on the near floor ───────────────────────────────────────────
# The boxes crossing the sign-in floor are the real cartons too, cut out small.
CRATES = {"pepa": (PEPA_TALL, 150), "ohis": (OHIS, 140), "civlily": (PEPA_BOX, 120)}

for name, (plate, h) in CRATES.items():
    s = plate.resize((max(1, int(plate.width * h / plate.height)), h), Image.LANCZOS)
    # Well down in the dark. These are out in front of the shelf, away from the
    # horizon that lights it, and Pepa's cream artwork at thirty pixels reads
    # as a white speck unless it is taken right down.
    s = Image.alpha_composite(s, Image.new("RGBA", s.size, (90, 30, 22, 90)))
    s = ImageEnhance.Brightness(s).enhance(0.5)
    p = os.path.join(PUB, f"crate-{name}.webp")
    s.save(p, "WEBP", quality=90, method=6)
    print(p, s.size, os.path.getsize(p))
