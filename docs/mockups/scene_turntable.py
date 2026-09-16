"""The 70 x 36 pack from eight angles around it, plus a view from above.
The key light turns with the camera so every face is shown lit, the way a
product photographer walks round a box rather than leaving one side in shade."""
import sys; SP = sys.argv[1]; sys.path.insert(0, SP)
from PIL import Image, ImageDraw, ImageFont
import r3d
F = SP + "/f/"; T = lambda n: Image.open(F + "t_" + n + ".png")
tex = {"front": T("n70_front"), "back": T("n70_back"), "left": T("n70_left"),
       "right": T("n70_right"), "top": T("n70_top")}
q = r3d.box_quads(74, 155, 48, tex, sheen=0.12)
KEY, SHADOW = (-0.5, 0.9, 0.6), (-0.30, 1.7, 0.45)
FW, FH = 820, 1000
frames = []
views = [(az, 14, f"{az}°") for az in range(0, 360, 45)] + [(35, 58, "From above")]
for az, el, label in views:
    cam = r3d.Camera(target=(0, 72 if el < 40 else 60, 0), dist=560 if el < 40 else 600,
                     az=az, el=el, fov=26, W=FW, H=FH)
    layers = r3d.render(q, cam, light=r3d.roty(KEY, az),
                        shadows=[(-37, 37, -24, 24, 155, (0, 0, 0), 0, 1.0)],
                        shadow_light=r3d.roty(SHADOW, az))
    img = r3d.finish(layers, FW, FH, pad=0.07)
    img.save(SP + f"/out/Pepa-70x36-angle-{az:03d}{'-top' if el > 40 else ''}.png")
    frames.append((label, img))
    print("rendered", label)

# contact sheet, 3 x 3
PT = 300/72.0
FT = lambda pt, b=False: ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Arial" + (" Bold" if b else "") + ".ttf", int(pt*PT/2.2))
S = 0.62; tw, th = int(FW*S), int(FH*S); PAD, GAP, HEAD = 56, 18, 150
cols, rows = 3, 3
W = PAD*2 + cols*tw + (cols-1)*GAP
H = PAD + HEAD + rows*th + (rows-1)*GAP + PAD
sheet = Image.new("RGB", (W, H), (244, 239, 230)); d = ImageDraw.Draw(sheet)
d.text((PAD, PAD), "Pepa 70 × 36 — every angle", font=FT(38, True), fill=(30, 26, 22))
d.text((PAD, PAD+70), "74 × 155 × 48 mm · 50 booklets · rendered from the -01 die-line", font=FT(22), fill=(120, 110, 98))
for i, (label, img) in enumerate(frames):
    r, c = divmod(i, cols)
    x, y = PAD + c*(tw+GAP), PAD + HEAD + r*(th+GAP)
    sheet.paste(img.resize((tw, th), Image.LANCZOS), (x, y))
    d.text((x+14, y+10), label, font=FT(22, True), fill=(120, 110, 98))
sheet.save(SP + "/out/Pepa-70x36-all-angles.png", optimize=True)
print("sheet", sheet.size)
