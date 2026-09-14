"""Every panel of the revised file, each turned so it reads, labelled with the
box orientation it needs. The two columns should agree. They do not."""
from PIL import Image, ImageDraw, ImageFont
import sys
SP = sys.argv[1]; D = SP + "/die4/"
BG=(246,241,231); INK=(32,28,24); SOFT=(120,110,98); RED=(163,58,31); GREEN=(28,110,64)
PT=300/72.0
FT=lambda pt,b=False: ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Arial"+(" Bold" if b else "")+".ttf", int(round(pt*PT)))

PANELS = [
    ("Front",     "colB", 90,  "155 × 74 mm", "lying down", False),
    ("Back",      "colA", 90,  "155 × 74 mm", "lying down", False),
    ("Left side", "wingL",180, "48 × 155 mm", "standing up", True),
    ("Right side","wingR",180, "48 × 155 mm", "standing up", True),
    ("End (QR)",  "endA", 90,  "74 × 48 mm",  "lying down", False),
    ("End (QR)",  "endB", 90,  "74 × 48 mm",  "lying down", False),
]
PPM = 5.4
imgs=[]
for label,key,rot,dims,needs,odd in PANELS:
    im = Image.open(D+key+"-asdrawn.png").convert("RGB")
    im = im.rotate(rot, expand=True)
    w = round(im.width/(300/25.4)*PPM)
    im = im.resize((w, round(im.height*w/im.width)), Image.LANCZOS)
    imgs.append((label,dims,needs,odd,im))

PAD=70; LBL=int(150*300/25.4/6)          # a label column beside each panel
COLW=max(i[4].width for i in imgs)
LABW=560
W=PAD*2+COLW+56+LABW
rowh=[i[4].height for i in imgs]
H=PAD+int(30*PT)+int(26*PT)+sum(r+int(30*PT) for r in rowh)+PAD
s=Image.new("RGB",(W,H),BG); d=ImageDraw.Draw(s)
d.text((PAD,PAD), "What each panel needs", font=FT(24,True), fill=INK)
d.text((PAD,PAD+int(30*PT)), "All six should agree. Four say one thing, two say the other.",
       font=FT(13), fill=SOFT)
y=PAD+int(30*PT)+int(30*PT)
lx = PAD+COLW+56
for label,dims,needs,odd,im in imgs:
    col = RED if odd else GREEN
    s.paste(im,(PAD,y))
    d.text((lx,y+int(2*PT)), label, font=FT(15,True), fill=INK)
    d.text((lx,y+int(16*PT)), dims, font=FT(12), fill=SOFT)
    d.text((lx,y+int(34*PT)), "needs the box", font=FT(11), fill=SOFT)
    d.text((lx,y+int(47*PT)), needs, font=FT(14,True), fill=col)
    y+=im.height+int(30*PT)
s.save(SP+"/pepa-panel-audit.png", optimize=True)
print("wrote", s.size)
