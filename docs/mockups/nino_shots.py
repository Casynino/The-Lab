"""Fresh screenshots of Nino's live sites, for the cards on /nino.

Nino, 10 Nov 2026, looking at the page on his phone: the ORA picture (and the
others) were the old look of the sites — "it should show the new view of ORA
and the other sites too". The pictures in client/public/nino are the live home
pages as they are NOW, so they are retaken, not edited.

    python3 docs/mockups/nino_shots.py            # all twelve
    python3 docs/mockups/nino_shots.py ora target # just those

How: a separate, clean copy of Chrome (its own throw-away profile, so nothing of
Nino's own browsing is touched) is driven in REAL time by nino_shots_capture.mjs:
each public address is opened at 1440x900, the load event is waited for, then a
few more seconds are given for intros to finish, then the picture is taken. (Chrome's
own --screenshot flag runs the page on a made-up clock and photographs intros
half-done.) Each picture is cut to 1200x750 (16:10 — the card crops from the top,
object-cover object-top) and written as WebP into client/public/nino/. Only PUBLIC
home pages: Hao Labs' own card is its sign-in screen, never a signed-in dashboard.

The list below is the LIVE list in client/src/pages/nino.work.js — keep them in
step.
"""

import os
import subprocess
import sys
import tempfile

from PIL import Image

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "client", "public", "nino"))

# slug: (address, seconds to let the page settle after it has loaded). Most are
# done at once. A few open with an intro — ORA counts to 100 behind a neon logo,
# HA Group fades its words in, Reckless Lab shows a gate — and a picture taken
# mid-intro is a picture of the loader, not of the site.
SITES = {
    "haolabs":    ("https://hao-stock.vercel.app/login", 6),
    "vegas":      ("https://www.vegashoteltz.com", 8),
    "superdrive": ("https://super-drive-os.vercel.app", 6),
    "target":     ("https://targetexpressaircargo.com", 8),
    "swiftcargo": ("https://www.swiftcargotz.com", 8),
    "aitransit":  ("https://ai-transit-rouge.vercel.app", 8),
    "eatradelink": ("https://www.eatradelink.com", 10),
    "haodeals":   ("https://www.haodealtz.com", 6),
    "hagroup":    ("https://hag-mancom.vercel.app", 10),
    "kotes":      ("https://kotes.vercel.app", 8),
    "ora":        ("https://www.ora.co.tz", 18),
    "reckless":   ("https://www.recklesslab.shop", 14),
}

HERE_MJS = os.path.join(HERE, "nino_shots_capture.mjs")


def main(only):
    import json
    raw_dir = tempfile.mkdtemp(prefix="nino-shots-")
    todo = [{"slug": k, "url": u, "settle": t} for k, (u, t) in SITES.items() if not only or k in only]
    print("raw captures in", raw_dir)
    subprocess.run(["node", HERE_MJS, raw_dir, json.dumps(todo)], timeout=60 * len(todo) + 120)
    for site in todo:
        raw = os.path.join(raw_dir, f"{site['slug']}.png")
        if not os.path.exists(raw):
            print(f"  {site['slug']}: NO CAPTURE ({site['url']}) — the old picture is left as it was")
            continue
        im = Image.open(raw).convert("RGB")
        im = im.crop((0, 0, im.width, min(im.height, round(im.width * 10 / 16)))).resize((1200, 750), Image.LANCZOS)
        dest = os.path.join(OUT, f"{site['slug']}.webp")
        im.save(dest, "WEBP", quality=82, method=6)
        print(f"  {site['slug']}: {os.path.getsize(dest) // 1024} KB  <- {site['url']}")


if __name__ == "__main__":
    main(set(sys.argv[1:]))
