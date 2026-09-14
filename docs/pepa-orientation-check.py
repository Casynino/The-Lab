"""The revised file, rendered both ways up. The two big faces still read
landscape; the two narrow sides have been redrawn portrait. Whichever way the
box sits, one of those two is on its side."""
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw, ImageFont
import sys
SP = sys.argv[1]
sys.path.insert(0, SP)
from box import coeffs, place                       # same projection maths

D4 = SP + "/die4/"
L = lambda n: Image.open(D4 + n + "-asdrawn.png")

def render(W_mm, H_mm, D_mm, face, lid, end, scale=6.0):
    W, H, D = W_mm*scale, H_mm*scale, D_mm*scale
    EZX, EZY = 0.40, -0.31; PAD = 56
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

# Lying down: big faces read, the redrawn side lands on the lid and lies over.
lying = render(155, 74, 48,
               L("colB").rotate(90, expand=True),
               L("wingR").rotate(90, expand=True),
               L("endB").rotate(90, expand=True))
# Standing: the redrawn side reads, the big front goes over on its side.
standing = render(74, 155, 48,
                  L("colB"),
                  L("endB").rotate(180),
                  L("wingR").rotate(180))

BG=(246,241,231); INK=(32,28,24); SOFT=(120,110,98); RED=(163,58,31); GREEN=(28,110,64)
PT = 300/72.0
FT=lambda pt,b=False: ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Arial"+(" Bold" if b else "")+".ttf", int(round(pt*PT)))

PAD=70; GAP=70
TITLE=int(30*PT); SUB=int(15*PT); CAP=int(19*PT); LINE=int(14*PT)
head_h = TITLE + int(14*PT) + SUB + int(26*PT)
foot_h = CAP + int(12*PT) + LINE + int(8*PT) + LINE + int(18*PT)
h = max(lying.height, standing.height)
W = PAD*2 + lying.width + GAP + standing.width
H = PAD + head_h + h + foot_h + PAD//2
s = Image.new("RGB",(W,H),BG); d=ImageDraw.Draw(s)

y = PAD
d.text((PAD,y), "The revised file, both ways up", font=FT(30,True), fill=INK)
y += TITLE + int(10*PT)
d.text((PAD,y), "The big faces and the narrow sides now want opposite orientations.",
       font=FT(15), fill=SOFT)
y += SUB + int(26*PT)

s.paste(lying,(PAD, y+(h-lying.height)), lying)
x2 = PAD+lying.width+GAP
s.paste(standing,(x2, y+(h-standing.height)), standing)

yb = y + h + int(16*PT)
for x, title, good, bad in (
    (PAD, "Lying down", "Front reads.",
     "The lid — the redrawn side — lies over."),
    (x2, "Standing up", "The side panel reads.",
     "The front lies on its side."),
):
    d.text((x,yb), title, font=FT(19,True), fill=INK)
    d.text((x,yb+CAP+int(10*PT)), good, font=FT(14), fill=GREEN)
    d.text((x,yb+CAP+int(10*PT)+LINE+int(7*PT)), bad, font=FT(14), fill=RED)

s.save(SP+"/pepa-mixed-orientation.png", optimize=True)
print("wrote", s.size)
