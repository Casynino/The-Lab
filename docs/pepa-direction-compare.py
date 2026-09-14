"""Same artwork, same carton, two ways up — so the direction question answers
itself. Left: the box lying down, which is how the artwork is drawn. Right:
the same box stood on its end like the Civlily pack, with nothing rotated."""
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw, ImageFont
import sys
SP = sys.argv[1]
sys.path.insert(0, SP)
from box import solve, coeffs, place          # reuse the same projection maths

F = {n: Image.open(SP + f"/die2/{n}.png") for n in
     ("front", "back", "top", "bottom", "end", "end2")}

def render(W_mm, H_mm, D_mm, face, lid, end, scale=6.0):
    W, H, D = W_mm*scale, H_mm*scale, D_mm*scale
    EZX, EZY = 0.40, -0.31
    PAD = 56
    CW, CH = int(W + D*EZX + PAD*2), int(H + abs(D*EZY) + PAD*2 + 24)
    ox, oy = PAD, PAD + abs(D*EZY)
    P = lambda x,y,z: (ox + x + z*EZX, oy + y + z*EZY)
    FTL,FTR,FBL,FBR = P(0,0,0),P(W,0,0),P(0,H,0),P(W,H,0)
    BTL,BTR,BBR     = P(0,0,D),P(W,0,D),P(W,H,D)
    c = Image.new("RGBA",(CW,CH),(0,0,0,0))
    sh = Image.new("RGBA",(CW,CH),(0,0,0,0))
    ImageDraw.Draw(sh).polygon(
        [(FBL[0]+10,FBL[1]+7),(FBR[0]+16,FBR[1]+7),
         (FBR[0]+16+D*EZX,FBR[1]+7+D*EZY*0.42),
         (FBL[0]+10+D*EZX,FBL[1]+7+D*EZY*0.42)], fill=(56,36,20,115))
    c.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
    place(c, end, [FTR,BTR,BBR,FBR], shade=0.80)
    place(c, lid, [BTL,BTR,FTR,FTL], shade=1.05)
    place(c, face,[FTL,FTR,FBR,FBL], shade=1.0)
    d = ImageDraw.Draw(c)
    d.line([FTL,FTR], fill=(150,118,94,110), width=2)
    d.line([FTR,BTR], fill=(120,92,70,90), width=2)
    d.line([FTR,FBR], fill=(120,92,70,95), width=2)
    return c.crop(c.getbbox())

# Lying down: the artwork as drawn.
flat = render(155, 74, 48, F["bottom"], F["front"], F["end2"])
# Stood on its end, nothing rotated — the type goes with it.
tall = render(74, 155, 48,
              F["bottom"].rotate(-90, expand=True),
              F["end2"].rotate(-90, expand=True),
              F["front"].rotate(-90, expand=True))

BG=(246,241,231); INK=(32,28,24); SOFT=(120,110,96); RED=(163,58,31)
FT=lambda s,b=False: ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Arial"+(" Bold" if b else "")+".ttf", s)
PAD=56; GAP=56
h = max(flat.height, tall.height)
W = PAD*2 + flat.width + GAP + tall.width
H = PAD + 76 + h + 96
sheet = Image.new("RGB",(W,H),BG); d=ImageDraw.Draw(sheet)
d.text((PAD,PAD), "Same artwork, same carton — two ways up", font=FT(38,True), fill=INK)
y = PAD+72
sheet.paste(flat,(PAD, y + (h-flat.height)), flat)
x2 = PAD+flat.width+GAP
sheet.paste(tall,(x2, y + (h-tall.height)), tall)
yb = y+h+18
d.text((PAD, yb), "Lying down — as the artwork is drawn", font=FT(26,True), fill=INK)
d.text((PAD, yb+34), "Everything reads. 155 × 74 × 48 mm.", font=FT(22), fill=SOFT)
d.text((x2, yb), "Stood up like the Civlily pack", font=FT(26,True), fill=RED)
d.text((x2, yb+34), "Nothing rotated — so every word lies on its side.", font=FT(22), fill=RED)
sheet.save(SP+"/pepa-direction.png", optimize=True)
print("wrote", sheet.size)
