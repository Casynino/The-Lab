"""Render a 3/4 product shot of the Pepa display box from its own die-line.

The box is 155 x 48 x 74 mm (long x tall x deep) — what the die-line's fold
geometry measures, and what 50 booklets of 70 x 36 mm papers occupy standing
on edge. The savannah scene is the front; the repeating wordmark panel is the
top. Both are lifted straight from the print file, so this is the real artwork,
not an impression of it.
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

# --- axonometric projection: parallel, so nothing warps oddly ----------------
S = 7.0
W, H, D = 155 * S, 48 * S, 74 * S
EZX, EZY = 0.40, -0.33                 # depth runs back, up and to the right

PAD = 60
CW = int(W + D * EZX + PAD * 2)
CH = int(H + abs(D * EZY) + PAD * 2 + 40)
ox = PAD
oy = PAD + abs(D * EZY)

def P(x, y, z): return (ox + x + z * EZX, oy + y + z * EZY)

FTL, FTR = P(0, 0, 0),  P(W, 0, 0)
FBL, FBR = P(0, H, 0),  P(W, H, 0)
BTL, BTR = P(0, 0, D),  P(W, 0, D)
BBR      = P(W, H, D)

canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))

# Shadow on the ground, before the box.
sh = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
ImageDraw.Draw(sh).polygon(
    [(FBL[0] + 14, FBL[1] + 10), (FBR[0] + 22, FBR[1] + 10),
     (FBR[0] + 22 + D * EZX, FBR[1] + 10 + D * EZY * 0.42),
     (FBL[0] + 14 + D * EZX, FBL[1] + 10 + D * EZY * 0.42)],
    fill=(58, 38, 22, 120))
canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(26)))

front = Image.open(SP + "/die/face-hero.png")   # savannah scene, 155 x 48
top   = Image.open(SP + "/die/face-lid.png")    # wordmark panel, 155 x 74

# The ends carry no artwork on the die-line, so they are flat board.
end = Image.new("RGB", (64, 64), front.convert("RGB").getpixel((40, 40)))

place(canvas, end,   [FTR, BTR, BBR, FBR], shade=0.78)
place(canvas, top,   [BTL, BTR, FTR, FTL], shade=1.04)
place(canvas, front, [FTL, FTR, FBR, FBL], shade=0.98)

d = ImageDraw.Draw(canvas)
d.line([FTL, FTR], fill=(148, 116, 92, 110), width=2)   # front/top fold
d.line([FTR, BTR], fill=(120, 92, 70, 90),  width=2)    # top/end fold
d.line([FTR, FBR], fill=(120, 92, 70, 80),  width=2)    # front/end fold

# Trim to what was actually drawn, then hand back a sensible delivery size.
bbox = canvas.getbbox()
canvas = canvas.crop(bbox)
TARGET = 1040
canvas = canvas.resize((TARGET, round(canvas.height * TARGET / canvas.width)), Image.LANCZOS)
canvas.save(SP + "/pepa-box.png", optimize=True)

# Delivered as JPEG on the page's own paper colour: a soft shadow needs more
# tones than a quantised PNG can hold, and every phone in the market can read
# a JPEG. The page background is a constant we control, so baking it is safe.
flat = Image.new("RGB", canvas.size, (246, 241, 231))
flat.paste(canvas, (0, 0), canvas)
flat.save(SP + "/pepa-box.jpg", quality=84, optimize=True, progressive=True)
print("wrote", canvas.size)
