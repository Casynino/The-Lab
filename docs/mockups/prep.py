"""Turn raw die crops into render-ready textures: die-cut holes become real
transparency, and the printer's blue cut/fold guide lines become a quiet seam
so they read as a crease in the board rather than an annotation."""
from PIL import Image, ImageDraw
import sys
SP = sys.argv[1]; F = SP + "/f/"
MARK = (255, 0, 255)

def cut_hole(img, seeds, thresh=22):
    im = img.convert("RGB").copy()
    for s in seeds:
        px = im.getpixel(s)
        if min(px) > 225:
            ImageDraw.floodfill(im, s, MARK, thresh=thresh)
    alpha = Image.new("L", im.size, 255); ap = alpha.load(); ip = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if ip[x, y] == MARK: ap[x, y] = 0
    out = img.convert("RGBA"); out.putalpha(alpha)
    return out

def seam(img):
    """Only the printer's cut/fold guide: dark blue with almost no green,
    measured at (46, 49, 146). The sky and lake are (108, 185, 222) and must
    survive untouched. Core pixels first, then their antialiased fringe."""
    im = img.convert("RGBA"); p = im.load(); W, H = im.size
    core = set()
    for y in range(H):
        for x in range(W):
            r, g, b, a = p[x, y]
            if r < 85 and g < 85 and b > 105 and b - r > 55:
                core.add((x, y))
    SEAM = (148, 116, 94)
    for (x, y) in core:
        p[x, y] = SEAM + (p[x, y][3],)
    for (x, y) in core:
        for dx in (-2, -1, 0, 1, 2):
            for dy in (-2, -1, 0, 1, 2):
                xx, yy = x+dx, y+dy
                if 0 <= xx < W and 0 <= yy < H and (xx, yy) not in core:
                    r, g, b, a = p[xx, yy]
                    if b > r + 18 and b > g + 18:
                        p[xx, yy] = ((r+SEAM[0])//2, (g+SEAM[1])//2, (b+SEAM[2])//2, a)
    return im


def erase_folds(img):
    """The King Size file draws its fold lines in light blue, exactly
    (80, 173, 229). Folds are not printed, so they are erased, not creased.
    Only perfectly straight runs of that exact colour, at least 40 px long and
    at most 3 px thick, count — the lake's shoreline is (95, 166, 215) and is
    never touched. Each line is filled from the board just outside it."""
    im = img.convert("RGBA"); p = im.load(); W, H = im.size
    hit = lambda x, y: 0 <= x < W and 0 <= y < H and all(abs(a - b) <= 3 for a, b in zip(p[x, y][:3], (80, 173, 229)))
    marks = []
    for y in range(H):
        x = 0
        while x < W:
            if hit(x, y):
                s = x
                while x < W and hit(x, y): x += 1
                if x - s >= 40:
                    t = 1
                    while hit(s, y - t) or hit(s, y + t): t += 1
                    if t <= 3: marks.append(("h", y, s, x))
            else:
                x += 1
    for x in range(W):
        y = 0
        while y < H:
            if hit(x, y):
                s = y
                while y < H and hit(x, y): y += 1
                if y - s >= 40:
                    t = 1
                    while hit(x - t, s) or hit(x + t, s): t += 1
                    if t <= 3: marks.append(("v", x, s, y))
            else:
                y += 1
    for kind, i, a, b in marks:
        for j in range(a, b):
            if kind == "h":
                src = next((i + d for d in (-4, 4, -5, 5) if 0 <= i + d < H and not hit(j, i + d)), i)
                p[j, i] = p[j, src]
            else:
                src = next((i + d for d in (-4, 4, -5, 5) if 0 <= i + d < W and not hit(i + d, j)), i)
                p[i, j] = p[src, j]
    return im, len(marks)

kf, _ = erase_folds(Image.open(F+"kss_front.png"))
cut_hole(kf, [(kf.width//2, 1), (kf.width//2, 6)]).save(F+"t_kss_front.png")

fl, _ = erase_folds(Image.open(F+"kss_flap.png"))
w, h = fl.size
cut_hole(fl, [(1, h-2), (w-2, h-2), (4, h-4), (w-5, h-4)]).save(F+"t_kss_flap.png")

for n in ("n70_front", "n70_top", "n70_bottom", "n70_back", "n70_left", "n70_right",
          "kss_lid", "kss_left", "kss_right", "kss_back"):
    im, k = erase_folds(Image.open(F+n+".png"))
    if k: print(f"  {n}: erased {k} fold line(s)")
    seam(im).save(F+"t_"+n+".png")

# Booklet faces go through the same clean-up, keeping their own names.
for n in ("bk_front", "bk_back", "bk_spine", "bk70_front", "bk70_back", "bk70_spine"):
    im, k = erase_folds(Image.open(F+n+".png"))
    if k: print(f"  {n}: erased {k} fold line(s)")
    seam(im).save(F+n+".png")
print("textures ready")
