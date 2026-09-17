"""Cut the King Size lid's pop-up tab out of the die-line along its own cut.

The tab is outlined by a brown cut line: sides at x 416.98 and 497.92 mm, a
bottom edge at y 189.40 mm and a rounded lobe below its left end reaching
about 201 mm, open along the lid's fold at y 157.2 mm. The fill runs inside
that outline, starting a few pixels below the fold so it cannot slip round
the ends of the side cuts."""
import sys, collections
from PIL import Image, ImageFilter
W = sys.argv[1]; K = 300 / 25.4; P = lambda v: int(round(v * K))
im = Image.open(W + "/kss2/p-1.png").convert("RGB")
x0, x1, yf, y1 = P(400.7), P(512.7), P(157.2), P(203.0)
CUT = (133, 108, 64)
region = im.crop((x0, yf, x1, y1))
cut = Image.new("L", region.size, 0); cp = cut.load(); rp = region.load()
for y in range(region.height):
    for x in range(region.width):
        if all(abs(a - b) <= 60 for a, b in zip(rp[x, y], CUT)):
            cp[x, y] = 255
cut = cut.filter(ImageFilter.MaxFilter(3)); cp = cut.load()
top = 5
seed = (P(457) - x0, P(175) - yf)
inside = bytearray(region.width * region.height)
q = collections.deque([seed]); inside[seed[1] * region.width + seed[0]] = 1
while q:
    x, y = q.popleft()
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if 0 <= nx < region.width and top <= ny < region.height:
            i = ny * region.width + nx
            if not inside[i] and not cp[nx, ny]:
                inside[i] = 1; q.append((nx, ny))
mask = Image.new("L", region.size, 0); mp = mask.load()
for y in range(top, region.height):
    for x in range(region.width):
        if inside[y * region.width + x]:
            mp[x, y] = 255
for y in range(top):
    for x in range(region.width):
        mp[x, y] = mp[x, top]
mask = mask.filter(ImageFilter.MaxFilter(3))          # take back the line's own width
# The logo's dark antialiased edges can look like cut colour and punch hairline
# holes; a closing fills them without moving the outline.
mask = mask.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
mp = mask.load()
xs = [x for x in range(region.width) if mp[x, top + 2]]
ys = [y for y in range(region.height) if any(mp[x, y] for x in range(0, region.width, 4))]
print("tab: x %.2f-%.2f mm, y %.2f-%.2f mm" % ((min(xs) + x0) / K, (max(xs) + x0) / K, (min(ys) + yf) / K, (max(ys) + yf) / K))
tab = region.convert("RGBA"); tab.putalpha(mask)
tab = tab.rotate(180)                                  # same way round as the lid texture
tab.save(W + "/f/kss_tab.png")
print("saved", tab.size)
