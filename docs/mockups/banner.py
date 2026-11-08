from PIL import Image, ImageFilter, ImageChops
import glob, os, math

PUB = "/Users/Nino/Desktop/Clients /3-Devs/Hao-Stock/client/public"
def pick(pat):
    f = sorted(glob.glob(os.path.join(PUB, "pepa", pat)))
    return f[0] if f else None

def key_out(path, tol=26):
    """Flat cream studio background -> alpha."""
    im = Image.open(path).convert("RGB")
    bg = im.getpixel((2, 2))
    diff = ImageChops.difference(im, Image.new("RGB", im.size, bg)).convert("L")
    # anything within tol of the background colour becomes transparent
    mask = diff.point(lambda v: 0 if v < tol else min(255, int((v - tol) * 8)))
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    out = im.convert("RGBA"); out.putalpha(mask)
    return out.crop(out.getbbox())

W, H = 2400, 250
# dark panel: deep green-black -> teal-black, same family as the app's glows
base = Image.new("RGB", (W, H))
px = base.load()
for x in range(W):
    t = x / (W - 1)
    r = int(10 + 6 * (1 - t));  g = int(16 + 20 * (1 - t) + 10 * t); b = int(14 + 10 * (1 - t) + 26 * t)
    for y in range(H):
        v = 1 - 0.18 * (y / (H - 1))
        px[x, y] = (int(r * v), int(g * v), int(b * v))
base = base.convert("RGBA")

# a soft lime light from the upper left, like the rest of the app
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gp = glow.load()
for x in range(0, W, 2):
    for y in range(0, H, 2):
        d = math.hypot((x - 160) / 700, (y + 40) / 300)
        a = max(0, int(44 * (1 - d)))
        if a:
            for dx in (0, 1):
                for dy in (0, 1):
                    if x + dx < W and y + dy < H:
                        gp[x + dx, y + dy] = (163, 230, 53, a)
base = Image.alpha_composite(base, glow.filter(ImageFilter.GaussianBlur(40)))

shelf = Image.new("RGBA", (W, H), (0, 0, 0, 0))

def place(img, h, cx, cy, dim=0.0):
    s = img.resize((max(1, int(img.width * h / img.height)), h), Image.LANCZOS)
    if dim:
        d = Image.new("RGBA", s.size, (6, 14, 12, int(255 * dim)))
        s = Image.alpha_composite(s, d)
    # contact shadow
    sh = Image.new("RGBA", (s.width + 80, 46), (0, 0, 0, 0))
    shd = Image.new("RGBA", (s.width, 30), (0, 0, 0, 120))
    sh.paste(shd, (40, 8), shd)
    sh = sh.filter(ImageFilter.GaussianBlur(16))
    shelf.alpha_composite(sh, (cx - sh.width // 2, cy + h // 2 - 18))
    shelf.alpha_composite(s, (cx - s.width // 2, cy - h // 2))

book = key_out(pick("kubwa-booklets-1000.*.webp") or pick("kubwa-booklets-700.*.webp"))
hero = key_out(pick("hero-1000.*.webp") or pick("hero-700.*.webp"))

place(hero, 190, 1988, 124, dim=0.08)
place(book, 152, 2296, 152, dim=0.02)
place(book, 112, 1790, 170, dim=0.34)

# fade the whole shelf out towards the left so the words sit on clean dark
fade = Image.new("L", (W, H))
fp = fade.load()
for x in range(W):
    t = (x - 1500) / 430
    v = 0 if t <= 0 else (255 if t >= 1 else int(255 * (t * t * (3 - 2 * t))))
    for y in range(H):
        fp[x, y] = v
shelf.putalpha(ImageChops.multiply(shelf.split()[3], fade))

out = Image.alpha_composite(base, shelf).convert("RGB")
out.save(os.path.join(PUB, "banner.webp"), "WEBP", quality=82, method=6)
print(out.size, os.path.getsize(os.path.join(PUB, "banner.webp")))
