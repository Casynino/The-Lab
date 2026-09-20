"""A presentation PDF per box, written for whoever prints and makes it.

Every number on these pages is measured off the factory die-line itself, at
300 dpi, not typed from memory: panel sizes come from the fold lines, the
display tear line from the perforation, the tab from its own cut. The pages
are bilingual because the die files are Chinese and the desk reading them is
not — English first, 中文 under it, so both sides point at the same panel.

    python3 spec.py <workspace>

Writes five PDFs into <workspace>/pdf: one per box per design, and one that
holds both designs side by side.
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont

W = sys.argv[1]
OUT = os.path.join(W, "pdf")
os.makedirs(OUT, exist_ok=True)

DPI = 200
MM = DPI / 25.4
PW, PH = round(210 * MM), round(297 * MM)
M = round(14 * MM)
INK, SOFT, RULE, BG = (26, 24, 22), (112, 106, 98), (208, 201, 190), (255, 255, 255)
ACCENT, WARN, PANEL = (138, 74, 42), (176, 106, 24), (246, 242, 234)

ARIAL = "/System/Library/Fonts/Supplemental/Arial"
HEI = "/System/Library/Fonts/STHeiti Medium.ttc"
_cache = {}

def F(pt, bold=False):
    key = ("en", pt, bold)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(ARIAL + (" Bold" if bold else "") + ".ttf", round(pt * DPI / 72))
    return _cache[key]

def Z(pt):
    key = ("zh", pt)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(HEI, round(pt * DPI / 72))
    return _cache[key]

def has_cjk(text):
    return any("\u2e80" <= ch <= "\u9fff" or "\uff00" <= ch <= "\uffef" for ch in text)

def mixed(pt, text, bold=False):
    """Arial has no Chinese glyphs and prints them as boxes — one line of copy
    that mixes the two languages has to be set in the Chinese face."""
    return Z(pt) if has_cjk(text) else F(pt, bold)

def wrap(d, text, font, width):
    """Chinese has no spaces to break on: a line of it set by the English rule
    is one word and runs off the page. Break it per character instead, and keep
    a closing bracket or a comma off the start of the next line."""
    if has_cjk(text):
        # Break per character, except that a run of Latin, digits or punctuation
        # — a file name, a URL, "269.57 mm" — travels as one unit: one line of
        # the deck broke "OHIS棕色-- 3.pdf" and left the "f" on its own.
        units, run = [], ""
        for ch in text:
            if has_cjk(ch) or ch.isspace():
                if run: units.append(run); run = ""
                units.append(ch)
            else:
                run += ch
        if run: units.append(run)
        hang = d.textlength("。", font=font)
        lines, line = [], ""
        for u in units:
            if d.textlength(line + u, font=font) > width - hang and line:
                if u in "。，、；：）》”」％%":
                    line += u; lines.append(line); line = ""
                    continue
                lines.append(line.rstrip()); line = u.lstrip()
            else:
                line += u
        if line.strip(): lines.append(line.rstrip())
        return lines
    words, lines, line = text.split(), [], ""
    for w in words:
        t = (line + " " + w).strip()
        if d.textlength(t, font=font) <= width or not line:
            line = t
        else:
            lines.append(line); line = w
    if line: lines.append(line)
    return lines

def para(d, xy, text, font, fill, width, leading=1.35):
    x, y = xy
    for ln in wrap(d, text, font, width):
        d.text((x, y), ln, font=font, fill=fill)
        y += round(font.size * leading)
    return y

def fit(im, w, h):
    s = min(w / im.width, h / im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)

class Deck:
    """The pages of one PDF, and the running footer they share."""

    def __init__(self, title, subtitle, source):
        self.pages, self.title, self.subtitle, self.source = [], title, subtitle, source

    def page(self, heading=None, zh=None):
        img = Image.new("RGB", (PW, PH), BG)
        d = ImageDraw.Draw(img)
        self.pages.append(img)
        y = M
        if heading is not None:
            pt = 21
            while pt > 12 and d.textlength(heading, font=F(pt, True)) > PW - 2 * M:
                pt -= 1
            d.text((M, y), heading, font=F(pt, True), fill=INK)
            y += round(21 * DPI / 72 * 1.15)
            if zh:
                d.text((M, y), zh, font=Z(12), fill=SOFT)
                y += round(12 * DPI / 72 * 1.5)
            y += round(3 * MM)
            d.line([(M, y), (PW - M, y)], fill=RULE, width=2)
            y += round(6 * MM)
        return img, d, y

    def save(self, path):
        for i, img in enumerate(self.pages, 1):
            d = ImageDraw.Draw(img)
            d.line([(M, PH - M - round(7 * MM)), (PW - M, PH - M - round(7 * MM))], fill=RULE, width=1)
            foot = f"{self.title} · {self.subtitle}"
            d.text((M, PH - M - round(5 * MM)), foot, font=F(8), fill=SOFT)
            d.text((PW - M, PH - M - round(5 * MM)), f"{i} / {len(self.pages)}", font=F(8), fill=SOFT, anchor="ra")
            d.text((M, PH - M - round(1.5 * MM)), f"Die-line: {self.source}", font=Z(8), fill=SOFT)
        self.pages[0].save(path, "PDF", resolution=DPI, save_all=True,
                           append_images=self.pages[1:])
        print("wrote", os.path.basename(path), f"{len(self.pages)} pages",
              f"{os.path.getsize(path)/1e6:.1f} MB")

def table(d, x, y, rows, width, label_w=None):
    """Label / 中文 / value, one line each, ruled."""
    label_w = label_w or round(width * 0.42)
    for en, zh, val in rows:
        d.text((x, y), en, font=F(10, True), fill=INK)
        if zh:
            zx = x + d.textlength(en, font=F(10, True)) + round(2 * MM)
            if zx + d.textlength(zh, font=Z(8)) < x + label_w:
                d.text((zx, y + round(0.4 * MM)), zh, font=Z(8), fill=SOFT)
            else:
                d.text((x, y + round(10 * DPI / 72 * 1.25)), zh, font=Z(8), fill=SOFT)
        vy = para(d, (x + label_w, y), val, mixed(10, val), INK, width - label_w)
        y = max(y + round(10 * DPI / 72 * 1.35), vy) + round(1.6 * MM)
        d.line([(x, y - round(0.8 * MM)), (x + width, y - round(0.8 * MM))], fill=RULE, width=1)
    return y

def caption(d, x, y, en, zh=None, w=None):
    d.text((x, y), en, font=F(10, True), fill=INK)
    y += round(10 * DPI / 72 * 1.3)
    if zh:
        d.text((x, y), zh, font=Z(8.5), fill=SOFT)
        y += round(8.5 * DPI / 72 * 1.5)
    return y

def note_block(d, x, y, w, title, zh, items):
    d.rectangle([x, y, x + w, y + round(9 * MM)], fill=PANEL)
    d.text((x + round(3 * MM), y + round(2 * MM)), title, font=F(12, True), fill=ACCENT)
    d.text((x + round(3 * MM) + d.textlength(title, font=F(12, True)) + round(3 * MM),
            y + round(2.6 * MM)), zh, font=Z(9), fill=SOFT)
    y += round(12 * MM)
    for en, zhl in items:
        d.ellipse([x + round(1 * MM), y + round(1.6 * MM), x + round(2.6 * MM), y + round(3.2 * MM)], fill=ACCENT)
        yy = para(d, (x + round(5 * MM), y), en, mixed(10, en), INK, w - round(5 * MM))
        yy = para(d, (x + round(5 * MM), yy), zhl, Z(8.5), SOFT, w - round(5 * MM), leading=1.5)
        y = yy + round(3 * MM)
    return y

# ── what each box is, measured off its own die ───────────────────────────────
K = 300 / 25.4                      # the die-lines are rendered at 300 dpi
# One string per box for its assembled size, so the drawing page and the fact
# table can never print the three numbers in two different orders.
SMALL_SIZE_TEXT = "74 × 155 × 48 mm (width × height × depth)"
KSS_SIZE_TEXT = "112 × 126 × 55 mm (width × depth × height)"

SMALL = dict(
    key="small", folder="n70", sheet_page=1,
    name="Pepa Ndogo — 70 × 36 box", short="70 × 36 box", zh="小盒 70 × 36 mm",
    box=(74, 155, 48), size_text=SMALL_SIZE_TEXT,
    sheet=(264, 464), scale=0.80,
    panels=[
        ("Front", "50 LEAVES, Pepa, scene, tear line", "正面", 118.2, 269.57, 192.2, 424.57, "74 × 155 mm"),
        ("Back", "pattern only, no text", "背面", 118.2, 66.57, 192.2, 221.57, "74 × 155 mm"),
        ("Top", "info panel, QR, and a 19 × 6 mm half-moon notch", "顶面", 118.2, 221.57, 192.2, 269.57, "74 × 48 mm"),
        ("Bottom", "the same QR again, and Pepa", "底面", 118.2, 18.57, 192.2, 66.57, "74 × 48 mm"),
        ("Side", "scene, 50 LEAVES, Pepa", "侧面", 70.3, 66.57, 118.2, 221.57, "48 × 155 mm"),
        ("Side", "scene, 50 LEAVES, Pepa", "侧面", 192.2, 66.57, 240.2, 221.57, "48 × 155 mm"),
        ("Tuck flap", "rounded tongue; its middle folds 2 mm higher", "插舌", 118.2, 424.57, 192.2, 445.6, "73 × 21 mm"),
        ("Glue flap", "closes the tube, one at each outer edge", "粘口", 57.23, 66.57, 70.3, 221.57, "13 × 155 mm"),
        ("Glue flap", "closes the tube, one at each outer edge", "粘口", 240.21, 66.57, 253.24, 221.57, "13 × 155 mm"),
        ("Booklet", "on the same sheet; end flaps reach 103 mm across", "内册", 25.6, 290.5, 98.6, 383.6, "73 × 93 mm flat"),
    ],
    tear=(118.2, 346.54, 192.2),
    facts=[
        ("Assembled box", "成盒尺寸", SMALL_SIZE_TEXT),
        ("Paper size", "纸张尺寸", "70 × 36 mm, brown, unfiltered, slow burn"),
        ("Leaves per booklet", "每本张数", "50"),
        ("Booklets per box", "每盒本数", "50"),
        ("Papers per box", "每盒张数", "2,500"),
        ("Booklet", "内册尺寸", "73 × 22.5 × 5 mm assembled, from a 73 × 93 mm blank"),
        ("Flat sheet", "展开尺寸", "264 × 464 mm, one box plus one booklet per sheet"),
        ("QR codes", "二维码", "Top panel, bottom panel and booklet — three codes, all https://the-haolab.vercel.app/p"),
    ],
    opening=[
        ("Tear along the perforation across the front: 77 mm below the top fold, 78 mm above the "
         "tuck crease at the bottom of the front panel.",
         "沿正面齿线撕开：该线位于顶部折线下方 77 mm、正面底部插舌压痕上方 78 mm 处。"),
        ("The box lies down as a tray; the torn top half stands up behind it as the header.",
         "盒子平放成托盘，撕下的上半部分立在后方作为展示头卡。"),
        ("50 booklets stand spine up in two layers of 25, along the 155 mm length.",
         "50 本内册书脊朝上，分两层各 25 本，沿 155 mm 长度排列。"),
    ],
)

KSS = dict(
    key="big", folder="kss2", sheet_page=1,
    name="Pepa King Size Slim — display box", short="King Size Slim", zh="大盒 King Size Slim",
    box=(112, 55, 126), size_text=KSS_SIZE_TEXT,
    sheet=(549, 431), scale=0.62,
    panels=[
        ("Front panel", "scene, Pepa, QR, thumb notch", "正面板", 162.73, 220.26, 274.7, 275.29, "112 × 55 mm"),
        ("Back panel", "info panel and QR", "背面板", 400.73, 220.26, 512.7, 275.29, "112 × 55 mm"),
        ("Side panel", "scene, 50 LEAVES, Pepa", "侧面板", 36.7, 220.26, 162.73, 275.29, "126 × 55 mm"),
        ("Side panel", "scene, 50 LEAVES, Pepa", "侧面板", 274.7, 220.26, 400.73, 275.29, "126 × 55 mm"),
        ("Lid", "hinge half: 50 LEAVES, Pepa tab; free half: scene, 50 PER BOX", "盒盖", 400.7, 94.2, 512.7, 220.26, "112 × 126 mm"),
        ("Pop-up tab", "cut into the lid; a 27 mm ear reaches 44 mm", "盒盖弹出舌片", 417.07, 157.23, 497.84, 189.44, "81 × 32 mm"),
        ("Lid tuck flap", "inside the front panel when closed, inside the back when displayed", "盒盖插舌", 400.7, 54.2, 512.7, 94.2, "112 × 40 mm"),
        ("Glue flap", "glued to the side panel", "粘口", 21.72, 220.26, 36.7, 275.29, "15 × 55 mm"),
    ],
    tear=None,
    facts=[
        ("Assembled box", "成盒尺寸", KSS_SIZE_TEXT),
        ("Paper size", "纸张尺寸", "108 × 44 mm King Size Slim, brown, unfiltered"),
        ("Leaves per booklet", "每本张数", "50 printed on the art (die sheet allows up to 60)"),
        ("Booklets per box", "每盒本数", "50"),
        ("Papers per box", "每盒张数", "2,500"),
        ("Booklet", "内册尺寸", "110 × 26 × 4 mm"),
        ("Colours and finish", "印刷工艺（4C 光油）", "4C + gloss varnish, as marked on the die"),
        ("Flat sheet", "展开尺寸", "549 × 431 mm; the booklet is on a second sheet, 401 × 325 mm"),
        ("QR codes", "二维码", "Front panel, back panel and booklet — three codes, all https://the-haolab.vercel.app/p"),
    ],
    opening=[
        ("Lift the lid off the front panel; it stays hinged on the back panel.",
         "将盒盖从正面板中抽出掀起，盒盖仍与背面板相连。"),
        ("Fold the lid across its middle, 63 mm from the hinge: the back half stands up, "
         "the front half folds forward so its printed scene faces the customer.",
         "盒盖在距背面板压痕线 63 mm 处对折：后半部分立起，前半部分向前翻，印刷画面朝向顾客。"),
        ("The Pepa tab, cut into the back half but joined to the front half, pops up above the fold. "
         "The tuck flap goes down inside the back panel.",
         "弹出舌片（Pepa 舌片）模切于盒盖后半部分内，但与前半部分相连，随前半部分翻起，立于折线之上；插舌向下插入背面板内侧。"),
    ],
)

def sheet_image(design, box):
    src = os.path.join(W, design["dir"], box["folder"], f"p-{box['sheet_page']}.png")
    return Image.open(src).convert("RGB")

def shot(design, box, name):
    return Image.open(os.path.join(W, design["dir"], "out", f"Pepa-{box['key']}-{name}.png")).convert("RGB")

# ── drawings ─────────────────────────────────────────────────────────────────
def dim_h(d, x0, x1, y, text, font=None):
    font = font or F(8)
    d.line([(x0, y), (x1, y)], fill=ACCENT, width=2)
    for x, s in ((x0, 1), (x1, -1)):
        d.line([(x, y - round(1.2 * MM)), (x, y + round(1.2 * MM))], fill=ACCENT, width=2)
        d.polygon([(x, y), (x + s * round(2.2 * MM), y - round(1 * MM)),
                   (x + s * round(2.2 * MM), y + round(1 * MM))], fill=ACCENT)
    w = d.textlength(text, font=font)
    d.rectangle([(x0 + x1) / 2 - w / 2 - 4, y - font.size * 0.75, (x0 + x1) / 2 + w / 2 + 4, y + font.size * 0.75], fill=BG)
    d.text(((x0 + x1) / 2, y), text, font=font, fill=ACCENT, anchor="mm")

def dim_v(d, x, y0, y1, text, font=None):
    font = font or F(8)
    d.line([(x, y0), (x, y1)], fill=ACCENT, width=2)
    for y, s in ((y0, 1), (y1, -1)):
        d.line([(x - round(1.2 * MM), y), (x + round(1.2 * MM), y)], fill=ACCENT, width=2)
        d.polygon([(x, y), (x - round(1 * MM), y + s * round(2.2 * MM)),
                   (x + round(1 * MM), y + s * round(2.2 * MM))], fill=ACCENT)
    w = d.textlength(text, font=font)
    d.rectangle([x - w / 2 - 4, (y0 + y1) / 2 - font.size * 0.75, x + w / 2 + 4, (y0 + y1) / 2 + font.size * 0.75], fill=BG)
    d.text((x, (y0 + y1) / 2), text, font=font, fill=ACCENT, anchor="mm")

def elevation(d, x, y, w_mm, h_mm, scale, title, zh, wide_label, tall_label):
    """One face drawn to scale, with its two dimensions on it."""
    w, h = round(w_mm * MM * scale), round(h_mm * MM * scale)
    d.rectangle([x, y, x + w, y + h], outline=INK, width=3, fill=PANEL)
    dim_h(d, x, x + w, y + h + round(6 * MM), wide_label)
    dim_v(d, x + w + round(7 * MM), y, y + h, tall_label)
    ty = y + h + round(11 * MM)
    d.text((x, ty), title, font=F(10, True), fill=INK)
    d.text((x, ty + round(10 * DPI / 72 * 1.25)), zh, font=Z(8.5), fill=SOFT)
    return x + w + round(22 * MM), ty + round(12 * MM)

def dieline_page(deck, design, box):
    """The flat sheet with every panel called out by number."""
    img, d, y = deck.page("The die-line, panel by panel", "展开刀版图·各面标注")
    sheet = sheet_image(design, box)
    avail_w, avail_h = PW - 2 * M, round(150 * MM)
    view = fit(sheet, avail_w, avail_h)
    sx = view.width / sheet.width * K          # page px per mm of sheet
    ox, oy = M + (avail_w - view.width) // 2, y
    img.paste(view, (ox, oy))
    d.rectangle([ox, oy, ox + view.width, oy + view.height], outline=RULE, width=1)
    legend = []
    for i, (short, desc, zh, x0, y0, x1, y1, size) in enumerate(box["panels"], 1):
        a = (ox + x0 * sx, oy + y0 * sx, ox + x1 * sx, oy + y1 * sx)
        d.rectangle(a, outline=ACCENT, width=3)
        # The badge sits inside the panel's own top-left corner, not its middle:
        # the tab is cut inside the lid, and two badges met in the same place.
        # The badge sits inside the panel's own top-left corner, not its middle:
        # the tab is cut inside the lid, and two badges met in the same place.
        # A narrow panel gets a smaller badge rather than one that spills onto
        # its neighbour — the 15 mm glue flap is narrower than a full badge.
        r = round(min(3.2 * MM, 0.34 * (a[2] - a[0]), 0.34 * (a[3] - a[1])))
        cx, cy = a[0] + r + round(0.8 * MM), a[1] + r + round(0.8 * MM)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT)
        d.text((cx, cy), str(i), font=F(max(6, round(11 * r / (3.2 * MM))), True), fill=BG, anchor="mm")
        legend.append((f"{i}  {short}", zh, f"{size}  ·  {desc}"))
    if box["tear"]:
        x0, ty, x1 = box["tear"]
        d.line([(ox + x0 * sx, oy + ty * sx), (ox + x1 * sx, oy + ty * sx)], fill=WARN, width=4)
        d.text((ox + x1 * sx + round(2 * MM), oy + ty * sx), "tear line 齿线", font=Z(8), fill=WARN, anchor="lm")
    y = oy + view.height + round(6 * MM)
    half = (PW - 2 * M - round(8 * MM)) // 2
    left, right = legend[: (len(legend) + 1) // 2], legend[(len(legend) + 1) // 2:]
    ya = table(d, M, y, left, half, label_w=round(half * 0.52))
    yb = table(d, M + half + round(8 * MM), y, right, half, label_w=round(half * 0.52))
    y = max(ya, yb) + round(4 * MM)
    para(d, (M, y), "Measured off this file at 300 dpi: every figure above is the distance between "
                    "its own fold or cut lines, not a figure typed from a previous version. Where a "
                    "fold is not drawn on the file, the note on the last page says so and gives the "
                    "position we took.",
         F(9), SOFT, PW - 2 * M)

def cover_page(deck, design, box):
    img, d, y = deck.page()
    d.text((M, y), "Pepa", font=F(40, True), fill=INK)
    y += round(40 * DPI / 72 * 1.1)
    d.text((M, y), box["name"], font=F(20, True), fill=ACCENT)
    y += round(20 * DPI / 72 * 1.25)
    d.text((M, y), box["zh"], font=Z(13), fill=SOFT)
    y += round(13 * DPI / 72 * 1.6)
    d.text((M, y), design["label"], font=F(12, True), fill=INK)
    d.text((M + d.textlength(design["label"], font=F(12, True)) + round(3 * MM), y + round(0.6 * MM)),
           design["zh"], font=Z(9.5), fill=SOFT)
    y += round(12 * DPI / 72 * 1.8)
    hero = fit(shot(design, box, "open-display"), PW - 2 * M, round(105 * MM))
    img.paste(hero, (M + (PW - 2 * M - hero.width) // 2, y))
    y += hero.height + round(4 * MM)
    y = caption(d, M, y, "The box as it is meant to stand on the counter",
                "开盒后作为柜台展示盒的状态")
    y += round(4 * MM)
    y = table(d, M, y, box["facts"], PW - 2 * M)
    y += round(3 * MM)
    d.rectangle([M, y, PW - M, y + round(20 * MM)], fill=PANEL)
    ty = y + round(4 * MM)
    d.text((M + round(4 * MM), ty), "Pepa is made for Hǎo-Labs (The Lab)", font=F(10, True), fill=INK)
    d.text((M + round(4 * MM), ty + round(5.5 * MM)),
           "Mbezi Goigi, Dar es Salaam, Tanzania · 0788 734 003 · haodealtz@gmail.com",
           font=F(10), fill=INK)
    d.text((M + round(4 * MM), ty + round(11 * MM)),
           "Questions on any measurement here come back to this address.", font=F(9), fill=SOFT)

def faces_page(deck, design, box):
    img, d, y = deck.page("The box closed, face by face", "闭合状态·各面")
    shots = [("front", "Front", "正面"), ("back", "Back", "背面"), ("top", "Top", "顶面")]
    w = (PW - 2 * M - round(8 * MM)) // 3
    ims = [fit(shot(design, box, n), w, round(95 * MM)) for n, _, _ in shots]
    top = max(im.height for im in ims)
    for i, ((n, en, zh), im) in enumerate(zip(shots, ims)):
        x = M + i * (w + round(4 * MM))
        img.paste(im, (x + (w - im.width) // 2, y + top - im.height))
        caption(d, x, y + top + round(3 * MM), en, zh)
    y += top + round(16 * MM)
    rows = [(p[0], p[2], f"{p[7]}  ·  {p[1]}") for p in box["panels"][:6]]
    y = table(d, M, y, rows, PW - 2 * M, label_w=round((PW - 2 * M) * 0.34))
    y += round(2 * MM)
    para(d, (M, y), "Every face also carries the background pattern and the kanga band. The lines "
                    "above name what else is printed on it.", F(9), SOFT, PW - 2 * M)

def display_page(deck, design, box):
    img, d, y = deck.page("Open, as a counter display", "开盒展示状态")
    hero = fit(shot(design, box, "open-display"), PW - 2 * M, round(120 * MM))
    img.paste(hero, (M + (PW - 2 * M - hero.width) // 2, y))
    y += hero.height + round(8 * MM)
    y = note_block(d, M, y, PW - 2 * M, "How it opens", "如何打开",
                   [(en, zh) for en, zh in box["opening"]])

def angles_page(deck, design, box):
    img, d, y = deck.page("Every angle", "各角度视图")
    grid = Image.open(os.path.join(W, design["dir"], "out", f"Pepa-{box['key']}-every-angle.png")).convert("RGB")
    # The grid PNG carries its own title (ink rows 70-172, tiles from 206).
    grid = grid.crop((0, 190, grid.width, grid.height))
    view = fit(grid, PW - 2 * M, PH - y - round(24 * MM))
    img.paste(view, (M + (PW - 2 * M - view.width) // 2, y))

def sizes_page(deck, design, box):
    """Three faces to one scale. The drawings are laid out from the numbers, not
    placed by eye, so a scale that would run a face off the page cannot."""
    img, d, y = deck.page("Sizes", "尺寸")
    bw, bh, bd = box["box"]
    avail_mm = (PW - 2 * M) / MM
    # Bound by the paper in BOTH directions. A scale chosen on width alone put
    # the small box's third drawing, the scale note and the facts table off the
    # bottom of the page, under the footer.
    room_mm = (PH - M - round(52 * MM) - y) / MM     # 52 mm holds the sentence,
    # Each drawing also costs 23 mm of caption under it, and there are two rows.
    s = min(0.92, (avail_mm - 46) / (bw + bd),        # the three fact rows and
            (room_mm - 52) / (bh + bd))               # the footer
    y0 = y
    x = M + round(4 * MM)
    x2, y2 = elevation(d, x, y + round(4 * MM), bw, bh, s, "Front / back", "正面 / 背面",
                       f"{bw} mm", f"{bh} mm")
    elevation(d, x2, y + round(4 * MM), bd, bh, s, "Side", "侧面", f"{bd} mm", f"{bh} mm")
    _, y3 = elevation(d, x, y2 + round(6 * MM), bw, bd, s, "Top / bottom", "顶面 / 底面",
                      f"{bw} mm", f"{bd} mm")
    y = y3 + round(6 * MM)
    y = para(d, (M, y), f"Drawn to scale 1 : {1/s:.2f} off the die-line. The box assembles to "
                        f"{box['size_text']}; board thickness is not in these figures.",
             F(9), SOFT, PW - 2 * M)
    y += round(3 * MM)
    y = table(d, M, y, box["facts"][:3], PW - 2 * M)

def booklet_page(deck, design, box):
    img, d, y = deck.page("The booklet inside", "内册")
    if box["key"] == "small":
        src, crop = sheet_image(design, box), (8.0, 288.5, 116.0, 385.5)
        rows = [("Assembled", "成品", "73 × 22.5 × 5 mm"),
                ("Flat", "展开", "73 × 93 mm blank on the box sheet; end flaps reach 103 mm across"),
                ("Leaves", "张数", "50 leaves of 70 × 36 mm paper"),
                ("Printed", "印刷内容", "Scene, 50 LEAVES, NATURAL UNREFINED ROLLING PAPERS, Pepa, QR")]
    else:
        src = Image.open(os.path.join(W, design["dir"], "kss2", "p-2.png")).convert("RGB")
        crop = (56.0, 85.5, 191.0, 188.0)
        rows = [("Assembled", "成品", "110 × 26 × 4 mm"),
                ("Cover panels", "封面各折段", "9 / 3.6 / 25.5 / 3.9 / 26.0 / 4.2 / 26.0 mm across the folds, tuck flap first"),
                ("Leaves", "张数", "50 leaves of 108 × 44 mm paper (die sheet allows up to 60)"),
                ("Printed", "印刷内容", "Scene, 50 LEAVES, NATURAL UNREFINED ROLLING PAPERS, Pepa, QR")]
    art = src.crop(tuple(round(v * K) for v in crop))
    view = fit(art, PW - 2 * M, round(95 * MM))
    img.paste(view, (M + (PW - 2 * M - view.width) // 2, y))
    d.rectangle([M + (PW - 2 * M - view.width) // 2, y,
                 M + (PW - 2 * M - view.width) // 2 + view.width, y + view.height], outline=RULE, width=1)
    y += view.height + round(4 * MM)
    y = caption(d, M, y, "Straight off the die-line — not to scale; sizes below",
                "取自刀版原图，图示非原尺寸，尺寸以下表为准")
    y += round(3 * MM)
    y = table(d, M, y, rows, PW - 2 * M)
    y += round(4 * MM)
    im = fit(shot(design, box, "booklet" if box["key"] == "big" else "with-booklets"), PW - 2 * M, round(70 * MM))
    img.paste(im, (M + (PW - 2 * M - im.width) // 2, y))

# ── what the factory has to be told ──────────────────────────────────────────
SHARED_NOTES = [
    ("No bleed anywhere on this file: the artwork stops exactly on the cut. Extend it 3 mm past "
     "every outer cut, or a 1 mm drift on the guillotine shows as a white edge on the box.",
     "本文件未留出血：图案正好止于裁切线。所有外轮廓裁切线处图案需向外延伸 3 mm 出血，否则裁切误差 1 mm 就会在盒边留出白边。"),
    ("None of the QR codes has a quiet zone: the white stops within a module of the code. Add 4 "
     "modules of white around each — about 3 mm on the box, about 1.3 mm on the booklet. Every code "
     "on these files was scanned and carries HTTPS://THE-HAOLAB.VERCEL.APP/P (upper case, as a QR "
     "in alphanumeric mode requires), which opens https://the-haolab.vercel.app/p.",
     "各二维码均无静区：白底在码边缘即止。请在每个码四周补足 4 个模块宽的空白 —— 盒面约 3 mm，内册约 1.3 mm。"
     "本文件所有二维码均已扫描校验，内容为 HTTPS://THE-HAOLAB.VERCEL.APP/P（大写，符合二维码字母数字模式要求），可打开 https://the-haolab.vercel.app/p。"),
    ("On both booklets the Pepa logo, the 50 and the QR sit under 2 mm from a crease — some under "
     "1 mm. Move them 2–3 mm clear before the run, so a fold does not press through the artwork. "
     "The boxes themselves are fine on this.",
     "两款内册上的 Pepa 标志、“50”及二维码距压痕线均不足 2 mm，部分不足 1 mm。开机前请调整至 2–3 mm，避免折线压到图文。盒体本身无此问题。"),
    ("The two booklets use the same illustration and the same words in different layouts, and "
     "neither prints its paper size. They are 73 mm and 110 mm long, so they can be told apart on "
     "a shelf but not in a box of loose stock. Print the paper size on each booklet.",
     "两种规格的内册使用相同插画与文案，仅排版不同，且都未印纸张尺寸。两者长度为 73 mm 与 110 mm，货架上可分辨，"
     "散装时无法分辨。建议在内册上加印纸张尺寸。"),
    ("“50 PER BOX” means 50 booklets, not 50 papers. Consider “50 BOOKLETS PER BOX”.",
     "“50 PER BOX”指 50 本内册，而非 50 张纸。建议改为“50 BOOKLETS PER BOX”。"),
    ("The brand owner, Hǎo-Labs, is not printed anywhere on the box or the booklet. Add it if it "
     "should be there.",
     "盒体与内册均未印品牌方 Hǎo-Labs，如需请补印。"),
]
BOX_NOTES = {
    "small": [
        ("The information panel on the top reads upside down when the box is seen from the front. "
         "Turn it 180° if it is meant to be read from the front of the box.",
         "顶面的说明文字从盒子正面看是倒置的。若需从正面阅读，请将该面内容旋转 180 度。"),
        ("The fold between the top and the front is not drawn on this file. We take it at 269.57 mm "
         "down the sheet — 48 mm from the back fold, which is the box's own depth, and 1.85 mm past "
         "where the dust flaps are cut short. The flaps at the bottom end stop 1.6 mm short of the "
         "edge in the same way. Please confirm the scoring position before the run.",
         "顶面与正面之间的压痕线在本文件中未绘制。我们按自刀版顶边向下 269.57 mm 处取值 —— 距背面压痕 48 mm，即该盒的盒深，"
         "且比防尘舌片的切口多出 1.85 mm；盒底一端的舌片同样比盒边短 1.6 mm，做法完全一致。开机前请确认压痕位置。"),
        ("The line across the front at 346.54 mm is drawn exactly like every crease and cut on this "
         "file, and the file has no line legend. Confirm it is perforated, not scored — the box "
         "opens as a display along it.",
         "正面 346.54 mm 处的线条与本文件其他压痕、裁切线画法完全相同，且文件无线型图例。请确认该线为齿线（打孔）而非压痕 —— 展示开盒即沿此线撕开。"),
        ("This file carries no specification block — board, colours and finish are not stated on it. "
         "Confirm them in writing before the run.",
         "本文件没有工艺说明框：纸板、颜色、表面处理均未注明，开机前请书面确认。"),
    ],
    "big": [
        ("The back panel prints “Size: 70 × 36 mm / Type: Paper Ndogo”. That is the small box's "
         "paper. This box holds King Size Slim, 108 × 44 mm.",
         "背面板印的是“Size: 70 × 36 mm / Type: Paper Ndogo”，那是小盒的纸张规格。本盒为 King Size Slim 108 × 44 mm。"),
        ("The box sheet's specification block reads 50 BOOKELES; it should read 50 BOOKLETS.",
         "盒身刀版规格框 SPECIFICATIONS 一栏写作 50 BOOKELES，应为 50 BOOKLETS。"),
        ("The booklet sheet — the second file, 401 × 325 mm — says 60 leaves max in its own block. "
         "That is the die's ceiling; we are running 50 leaves, as the artwork says.",
         "内册刀版（另一张 401 × 325 mm）工艺框写“60 leaves max”，那是刀版上限；我们按图案所印的 50 LEAVES 生产。"),
        ("The green on the sheet marks three different things: the 15 × 55 mm glue flap on the far "
         "left, the four hook-bottom flaps that fold into the base, and the legend band at the foot "
         "of the sheet, which is not part of the box at all. Confirm none of the green prints.",
         "刀版上的浅绿色标示三处内容：最左侧 15 × 55 mm 的粘口、底部四片勾底插接舌片，以及刀版下方的工艺说明带（不属于盒体）。请确认绿色区域均不印刷。"),
    ],
}

def notes_page(deck, design, box):
    img, d, y = deck.page("Before printing — please check", "印前确认事项")
    y = note_block(d, M, y, PW - 2 * M, "On this box", "本盒专有", BOX_NOTES[box["key"]])
    y += round(4 * MM)
    y = note_block(d, M, y, PW - 2 * M, "On both boxes", "两盒通用", SHARED_NOTES)

def box_deck(design, box):
    deck = Deck("Pepa", f"{box['name']} · {design['label']}", design[box["key"] + "_file"])
    cover_page(deck, design, box)
    faces_page(deck, design, box)
    angles_page(deck, design, box)
    display_page(deck, design, box)
    sizes_page(deck, design, box)
    dieline_page(deck, design, box)
    booklet_page(deck, design, box)
    notes_page(deck, design, box)
    deck.save(os.path.join(OUT, f"Pepa-{design['slug']}-{box['key']}-box.pdf"))

def all_deck(designs):
    deck = Deck("Pepa", "Both designs, both boxes", "four factory die-lines, September 2026")
    img, d, y = deck.page()
    d.text((M, y), "Pepa", font=F(40, True), fill=INK); y += round(40 * DPI / 72 * 1.1)
    d.text((M, y), "Two designs, two boxes", font=F(20, True), fill=ACCENT); y += round(20 * DPI / 72 * 1.25)
    d.text((M, y), "两款设计·两种盒型", font=Z(13), fill=SOFT); y += round(13 * DPI / 72 * 2.0)
    y = para(d, (M, y), "The four files are the same two boxes drawn twice. The die, every word, "
                        "the QR and all sizes are identical; the only difference is the figure in "
                        "the picture. Each design has its own pair of PDFs beside this one.",
             F(11), INK, PW - 2 * M)
    y += round(6 * MM)
    rows = []
    for dz in designs:
        rows.append((f"{dz['label']} — 70 × 36 box", dz["zh"], dz["small_file"]))
        rows.append((f"{dz['label']} — King Size Slim", dz["zh"], dz["big_file"]))
    y = table(d, M, y, rows, PW - 2 * M, label_w=round((PW - 2 * M) * 0.56))
    y += round(6 * MM)
    figs = []
    for dz in designs:
        src = Image.open(os.path.join(W, dz["dir"], "n70", "p-1.png")).convert("RGB")
        figs.append(src.crop(tuple(round(v * K) for v in (119.6, 370, 190.8, 423.2))))
    fw = (PW - 2 * M - round(6 * MM)) // 2
    for i, (dz, f_) in enumerate(zip(designs, figs)):
        im = fit(f_, fw, round(60 * MM))
        x = M + i * (fw + round(6 * MM))
        img.paste(im, (x, y))
        caption(d, x, y + im.height + round(2 * MM), dz["label"], dz["zh"])
    for box in (SMALL, KSS):
        for name, en, zh in (("open-display", "Open as a counter display", "开盒展示"),
                             ("front", "Closed, front", "闭合正面")):
            img, d, y = deck.page(f"{box['short']} — {en}", f"{box['zh']}·{zh}")
            w = (PW - 2 * M - round(6 * MM)) // 2
            ims = [fit(shot(dz, box, name), w, round(150 * MM)) for dz in designs]
            top = max(im.height for im in ims)
            for i, (dz, im) in enumerate(zip(designs, ims)):
                x = M + i * (w + round(6 * MM))
                img.paste(im, (x + (w - im.width) // 2, y + top - im.height))
                caption(d, x, y + top + round(3 * MM), dz["label"], dz["zh"])
            yy = y + top + round(14 * MM)
            yy = caption(d, M, yy, "Same box either way — these figures hold for both designs",
                         "两款设计盒型一致：以下参数通用")
            table(d, M, yy + round(2 * MM), box["facts"][:5], PW - 2 * M)
    img, d, y = deck.page("Before printing — please check", "印前确认事项")
    y = note_block(d, M, y, PW - 2 * M, "70 × 36 box", "小盒", BOX_NOTES["small"])
    y += round(3 * MM)
    note_block(d, M, y, PW - 2 * M, "King Size Slim", "大盒", BOX_NOTES["big"])
    # The shared checks are the ones the factory reads most; they get a page of
    # their own here rather than a slice of the list.
    img, d, y = deck.page("Before printing — both boxes", "印前确认事项／两盒通用")
    note_block(d, M, y, PW - 2 * M, "Both boxes", "两盒通用", SHARED_NOTES)
    deck.save(os.path.join(OUT, "Pepa-all-designs.pdf"))

DESIGNS = [
    dict(dir="d1", slug="design-1-blue", label="Design 1 — blue cloak", zh="设计一·蓝披风",
         small_file="70×36刀版 0 2.pdf", big_file="【7244】册子KSS本色13g无水印 OHIS棕色-- 3.pdf"),
    dict(dir="d2", slug="design-2-red", label="Design 2 — red robe", zh="设计二·红袍",
         small_file="70×36刀版 -02-.pdf", big_file="【7244】册子KSS本色13g无水印 OHIS棕色--1.pdf"),
]

if __name__ == "__main__":
    for design in DESIGNS:
        for box in (SMALL, KSS):
            box_deck(design, box)
    all_deck(DESIGNS)
