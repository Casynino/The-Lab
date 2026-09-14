"""The Pepa King Size Slim display box, rendered from its own die-line.

Spec block on the sheet: die cut KING SIZE SLIM 108 x 44 mm, box
112 x 126 x 55 mm, 50 booklets. The fold lines measure 126 / 112 / 126 / 112
around the walls at 55 mm high, with a 112 x 126 lid hinged off the back wall
and a thumb notch on the front — the same format as the OHIS box.
"""
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw
import sys
SP = sys.argv[1]
sys.path.insert(0, SP)
from box import coeffs, place

D = SP + "/ohis/"
L = lambda n: Image.open(D + n + ".png")

def render(scale=6.4, ezx=0.40, ezy=-0.60):
    W, H, DP = 112*scale, 55*scale, 126*scale
    PAD = 70
    CW = int(W + DP*ezx + PAD*2)
    CH = int(H + abs(DP*ezy) + PAD*2 + 30)
    ox, oy = PAD, PAD + abs(DP*ezy)
    P = lambda x,y,z: (ox + x + z*ezx, oy + y + z*ezy)
    FTL,FTR,FBL,FBR = P(0,0,0),P(W,0,0),P(0,H,0),P(W,H,0)
    BTL,BTR,BBR     = P(0,0,DP),P(W,0,DP),P(W,H,DP)

    c = Image.new("RGBA",(CW,CH),(0,0,0,0))
    sh = Image.new("RGBA",(CW,CH),(0,0,0,0))
    ImageDraw.Draw(sh).polygon(
        [(FBL[0]+12,FBL[1]+9),(FBR[0]+20,FBR[1]+9),
         (FBR[0]+20+DP*ezx,FBR[1]+9+DP*ezy*0.40),
         (FBL[0]+12+DP*ezx,FBL[1]+9+DP*ezy*0.40)], fill=(58,38,22,120))
    c.alpha_composite(sh.filter(ImageFilter.GaussianBlur(22)))

    # The lid reads from the front of the box, so the image's top row — the
    # one carrying 50 LEAVES — lands on the BACK edge and Pepa sits nearest
    # the viewer. Put it the other way and the whole lid reads upside down.
    place(c, L("front"),  [FTR, BTR, BBR, FBR], shade=0.84)   # 126 wall, branded
    place(c, L("lid"),    [BTL, BTR, FTR, FTL], shade=1.04)
    place(c, L("side"),   [FTL, FTR, FBR, FBL], shade=0.97)   # 112 wall + notch

    d = ImageDraw.Draw(c)
    d.line([FTL,FTR], fill=(150,118,94,110), width=2)
    d.line([FTR,BTR], fill=(122,94,72,95),  width=2)
    d.line([FTR,FBR], fill=(122,94,72,100), width=2)
    return c.crop(c.getbbox())

img = render()
img.save(SP + "/pepa-kss-box.png", optimize=True)
flat = Image.new("RGB", img.size, (246,241,231)); flat.paste(img,(0,0),img)
flat.save(SP + "/pepa-kss-box.jpg", quality=84, optimize=True, progressive=True)
print("wrote", img.size)
