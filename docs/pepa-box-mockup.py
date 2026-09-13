"""Render a product shot of the Pepa pack from its own die-line.

The pack is 74 x 155 x 48 mm, standing upright — the same format as the
Civlily box. The die-line's wrap is 74 mm across and 427 mm long, which is
front (155) + bottom (48) + back (155) + top (48) plus a glue flap, so the
74 mm dimension is the pack's width and 155 mm its height. The side wings
are 48 x 155. Both faces below are lifted straight out of the print file.
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

S = 5.6
W, H, D = 74 * S, 155 * S, 48 * S
EZX, EZY = 0.42, -0.26                # depth runs back, up and to the right

PAD = 70
CW = int(W + D * EZX + PAD * 2)
CH = int(H + abs(D * EZY) + PAD * 2 + 30)
ox, oy = PAD, PAD + abs(D * EZY)

def P(x, y, z): return (ox + x + z * EZX, oy + y + z * EZY)

FTL, FTR = P(0, 0, 0), P(W, 0, 0)
FBL, FBR = P(0, H, 0), P(W, H, 0)
BTL, BTR = P(0, 0, D), P(W, 0, D)
BBR      = P(W, H, D)

canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))

sh = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
ImageDraw.Draw(sh).polygon(
    [(FBL[0] + 10, FBL[1] + 6), (FBR[0] + 18, FBR[1] + 6),
     (FBR[0] + 18 + D * EZX, FBR[1] + 6 + D * EZY * 0.45),
     (FBL[0] + 10 + D * EZX, FBL[1] + 6 + D * EZY * 0.45)],
    fill=(58, 38, 22, 115))
canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(20)))

front = Image.open(SP + "/die/f-front.png")   # wordmark panel, 74 x 155
side  = Image.open(SP + "/die/f-side.png")    # savannah strip,  48 x 155
top   = Image.new("RGB", (64, 64), front.convert("RGB").getpixel((430, 60)))

place(canvas, top,   [BTL, BTR, FTR, FTL], shade=1.05)
place(canvas, side,  [FTR, BTR, BBR, FBR], shade=0.86)
place(canvas, front, [FTL, FTR, FBR, FBL], shade=1.0)

d = ImageDraw.Draw(canvas)
d.line([FTL, FTR], fill=(150, 118, 94, 110), width=2)
d.line([FTR, BTR], fill=(122, 94, 72, 90),  width=2)
d.line([FTR, FBR], fill=(122, 94, 72, 95),  width=2)

canvas = canvas.crop(canvas.getbbox())
TARGET = 760
canvas = canvas.resize((TARGET, round(canvas.height * TARGET / canvas.width)), Image.LANCZOS)
canvas.save(SP + "/pepa-box.png", optimize=True)

flat = Image.new("RGB", canvas.size, (246, 241, 231))
flat.paste(canvas, (0, 0), canvas)
flat.save(SP + "/pepa-box.jpg", quality=84, optimize=True, progressive=True)
print("wrote", canvas.size)
