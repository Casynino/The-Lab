"""Cut the OFFICIAL ZELab logo into the pieces the app needs.

Nino, 10 Nov 2026: "these are the official logos — use them wherever a logo is
needed: the sign-in page, the QR page behind the boxes, the moving scene, the
sidebar, the icons — and save them in our project so they are kept." Everything
here is cut from his own file, `brand-src/zelab-official-logo.pdf` (a vector PDF:
ten shapes, no pictures, no text). Nothing is redrawn and no colour is changed,
except the one thing every logo does on a dark page: the BLACK parts go white
(on the near-black app they would simply vanish). The red stays exactly his red.

    pip install pymupdf          # this script only; brand.py itself needs just Pillow
    python3 docs/mockups/official_logo.py

Writes into docs/mockups/brand-src/official/ (and brand.py takes it from there):
    logo-light.svg / .png     the whole logo, his colours (red + black)   -> white pages
    logo-dark.svg  / .png     the whole logo, black parts white           -> the app, the scene
    lab-light / lab-dark      just the black letters "Lab"                -> the sidebar header
    mark-light / mark-dark    the red "ZE" with its swoosh and blocks     -> the icons

The ten shapes, in the order the PDF draws them (checked by looking at each one):
    0 red block (top)   1 black block   2 black block   3 black "b"   4 black "L"
    5 red "Z"           6 red "E"       7 black "a"     8 black swoosh   9 red foot of the "Z"
"""

import os
import re
import shutil
import sys

import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "brand-src", "zelab-official-logo.pdf")
OUT = os.path.join(HERE, "brand-src", "official")
os.makedirs(OUT, exist_ok=True)

RED = "#fa0101"      # his red, as it is in the PDF (250, 1, 1)
BLACK = "#000000"
WHITE = "#ffffff"

PARTS = {
    "logo": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    "lab": [3, 4, 7],
    "mark": [0, 1, 2, 5, 6, 8, 9],
}


def main(pdf=SRC):
    if not os.path.exists(pdf):
        sys.exit(f"missing {pdf}")
    doc = pymupdf.open(pdf)
    page = doc[0]
    drawings = page.get_drawings()
    assert len(drawings) == 10, f"expected the ten shapes of the official logo, found {len(drawings)}"
    svg = page.get_svg_image(text_as_path=True)
    paths = re.findall(r"<path\b[^>]*/>", svg)
    assert len(paths) == 10, "SVG paths do not match the drawings"

    def bbox(idx):
        r = pymupdf.Rect()
        for i in idx:
            r |= drawings[i]["rect"]
        return r

    def colour_of(i):
        f = drawings[i].get("fill")
        return RED if f and f[0] > 0.5 else BLACK

    for name, idx in PARTS.items():
        box = bbox(idx)
        pad = 0.5
        vb = f"{box.x0 - pad:.2f} {box.y0 - pad:.2f} {box.width + 2 * pad:.2f} {box.height + 2 * pad:.2f}"
        for tone in ("light", "dark"):
            body = []
            for i in idx:
                fill = colour_of(i)
                if tone == "dark" and fill == BLACK:
                    fill = WHITE
                d = re.search(r'\sd="([^"]+)"', paths[i]).group(1)
                eo = ' fill-rule="evenodd"' if 'fill-rule="evenodd"' in paths[i] else ""
                body.append(f'<path d="{d}" fill="{fill}"{eo}/>')
            doc_svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" '
                       f'width="{box.width + 2 * pad:.0f}" height="{box.height + 2 * pad:.0f}" role="img" '
                       f'aria-label="ZELab">\n' + "\n".join(body) + "\n</svg>\n")
            svg_path = os.path.join(OUT, f"{name}-{tone}.svg")
            open(svg_path, "w").write(doc_svg)
            # a big transparent PNG of the same thing, 2400 px tall
            sdoc = pymupdf.open(svg_path)
            sp = sdoc[0]
            zoom = 2400 / sp.rect.height
            pix = sp.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=True)
            png_path = os.path.join(OUT, f"{name}-{tone}.png")
            pix.save(png_path)
            print(f"{name}-{tone}: {os.path.getsize(svg_path) / 1024:.1f} KB svg, {pix.width}x{pix.height} png")


if __name__ == "__main__":
    main()
