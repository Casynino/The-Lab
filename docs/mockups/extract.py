"""Cut every face out of the rendered die-lines, measured off their fold lines.

Render the PDFs first (poppler):
  pdftoppm -r 300 -png "70×36刀版 -01.pdf" <work>/n70/p
  pdftoppm -r 300 -png "【7244】册子KSS本色13g无水印 OHIS棕色--.pdf" <work>/kss2/p
then:  python3 extract.py <work>  &&  python3 prep.py <work>

70 x 36 pack (74 x 155 x 48): column 118.2-192.2 mm, wings 70.3-118.2 and
192.2-240.2; folds at 18.5 / 66.5 / 221.5 / 267.6 / 422.6 down the column.
The back and both sides are turned 180 degrees because the wrap rolls about
the page's horizontal axis — seen from outside, they are upside down on the
sheet.

King Size Slim box (112 x 126 x 55): walls 126 / 112 / 126 / 112 from
36.7 mm, 220.2-275.3 mm tall; lid 400.7-512.7 x 94.2-220.2 hinged off the back
wall; tuck flap 54.2-94.2. Booklet (110 x 26 x 4): cover folds at 100.1 /
125.6 / 129.5 / 155.4 / 159.7 / 185.7 on page 2, 68.3-178.4 mm across.
"""
import sys, os
from PIL import Image
W = sys.argv[1]; F = os.path.join(W, "f"); os.makedirs(F, exist_ok=True)
K = 300/25.4; P = lambda v: int(round(v*K)); I = 4

def cut(img, x0, y0, x1, y1, name, rot=0):
    c = img.crop((P(x0)+I, P(y0)+I, P(x1)-I, P(y1)-I))
    if rot: c = c.rotate(rot, expand=True)
    c.save(os.path.join(F, name + ".png"))

n = Image.open(os.path.join(W, "n70/p-1.png")).convert("RGB")
cut(n, 118.2, 267.6, 192.2, 422.6, "n70_front")
cut(n, 118.2,  66.5, 192.2, 221.5, "n70_back", 180)
cut(n, 118.2, 221.5, 192.2, 267.6, "n70_top")
cut(n, 118.2,  18.5, 192.2,  66.5, "n70_bottom")
cut(n,  70.3,  66.5, 118.2, 221.5, "n70_left", 180)
cut(n, 192.2,  66.5, 240.2, 221.5, "n70_right", 180)

k = Image.open(os.path.join(W, "kss2/p-1.png")).convert("RGB")
for name, (a, z) in {"kss_left": (36.7, 162.7), "kss_front": (162.7, 274.7),
                     "kss_right": (274.7, 400.7), "kss_back": (400.7, 512.7)}.items():
    cut(k, a, 220.2, z, 275.3, name)
cut(k, 400.7, 94.2, 512.7, 220.2, "kss_lid", 180)
cut(k, 400.7, 54.2, 512.7,  94.2, "kss_flap", 180)

b = Image.open(os.path.join(W, "kss2/p-2.png")).convert("RGB")
bx0, bx1 = P(68.3), P(178.4)
b.crop((bx0+I, P(159.7)+I, bx1-I, P(185.7)-I)).save(os.path.join(F, "bk_front.png"))
b.crop((bx0+I, P(129.5)+I, bx1-I, P(155.4)-I)).rotate(180).save(os.path.join(F, "bk_back.png"))
b.crop((bx0+I, P(155.4)+1, bx1-I, P(159.7)-1)).save(os.path.join(F, "bk_spine.png"))
b.crop((bx0+I, P(100.1)+I, bx1-I, P(125.6)-I)).save(os.path.join(F, "bk_inner.png"))
print("faces written to", F)
