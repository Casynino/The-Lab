"""Render the Pepa display box from its final die-line, from two angles.

Geometry comes from the die-line's own folds, not from guesswork. The wrap is
74 mm across and 436 mm long, and its folds fall at 47.6 / 155 / 46.9 / 155 —
so the box is 155 x 74 x 48 mm. Which way up is settled by the end panels:
the Maasai on one of them stands 74 mm tall, so 74 is the height, not the
depth. That makes the 155 x 74 wrap panels the front and back, the 155 x 48
wings the top and bottom, and the 48 x 74 panels the two ends. 50 booklets of
70 x 36 mm papers stand in a row along the 155 mm length.
"""
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw
import sys
SP = sys.argv[1]

def solve(M, b):
    n = len(b)
    for i in range(n):
        p = max(range(i, n), key=lambda r: abs(M[r][i]))
        M[i], M[p] = M[p], M[i]; b[i], b[p] = b[p], b[i]
        for r in range(i + 1, n):
            f = M[r][i] / M[i][i]
            for c in range(i, n): M[r][c] -= f * M[i][c]
            b[r] -= f * b[i]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (b[i] - sum(M[i][c] * x[c] for c in range(i + 1, n))) / M[i][i]
    return x

def coeffs(dst, src):
    M, b = [], []
    for (dx, dy), (sx, sy) in zip(dst, src):
        M.append([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx]); b.append(sx)
        M.append([0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy]); b.append(sy)
    return solve(M, b)

def place(canvas, face, quad, shade=1.0):
    if shade != 1.0:
        face = ImageEnhance.Brightness(face.convert("RGB")).enhance(shade)
    w, h = canvas.size
    src = [(0, 0), (face.width, 0), (face.width, face.height), (0, face.height)]
    warped = face.convert("RGBA").transform(
        (w, h), Image.PERSPECTIVE, coeffs(quad, src), Image.BICUBIC)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon(quad, fill=255)
    canvas.paste(warped, (0, 0), mask)

F = {n: Image.open(SP + f"/die2/{n}.png") for n in
     ("front", "back", "top", "bottom", "end", "end2")}

def render(face_img, lid_img, end_img, scale=6.4):
    W, H, D = 155 * scale, 74 * scale, 48 * scale
    EZX, EZY = 0.40, -0.31
    PAD = 64
    CW = int(W + D * EZX + PAD * 2)
    CH = int(H + abs(D * EZY) + PAD * 2 + 26)
    ox, oy = PAD, PAD + abs(D * EZY)
    P = lambda x, y, z: (ox + x + z * EZX, oy + y + z * EZY)
    FTL, FTR, FBL, FBR = P(0,0,0), P(W,0,0), P(0,H,0), P(W,H,0)
    BTL, BTR, BBR      = P(0,0,D), P(W,0,D), P(W,H,D)

    c = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    sh = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    ImageDraw.Draw(sh).polygon(
        [(FBL[0]+12, FBL[1]+8), (FBR[0]+20, FBR[1]+8),
         (FBR[0]+20+D*EZX, FBR[1]+8+D*EZY*0.42),
         (FBL[0]+12+D*EZX, FBL[1]+8+D*EZY*0.42)], fill=(56, 36, 20, 120))
    c.alpha_composite(sh.filter(ImageFilter.GaussianBlur(20)))

    place(c, end_img,  [FTR, BTR, BBR, FBR], shade=0.80)
    place(c, lid_img,  [BTL, BTR, FTR, FTL], shade=1.05)
    place(c, face_img, [FTL, FTR, FBR, FBL], shade=1.0)

    d = ImageDraw.Draw(c)
    d.line([FTL, FTR], fill=(150, 118, 94, 110), width=2)
    d.line([FTR, BTR], fill=(120, 92, 70, 90),  width=2)
    d.line([FTR, FBR], fill=(120, 92, 70, 95),  width=2)
    return c.crop(c.getbbox())

# A: the Kilimanjaro front, the QR lid, and the Maasai end.
# B: the box turned right round — the 32 LEAVES back, the same lid seen from
# behind (so its type is upside down, as it would really be), the other end.
a = render(F["bottom"], F["front"], F["end2"])
b = render(F["top"], F["front"].rotate(180), F["end"])
for name, img in (("a", a), ("b", b)):
    img.save(SP + f"/view-{name}.png", optimize=True)
    print(name, img.size)
