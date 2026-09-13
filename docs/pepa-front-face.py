"""Compose the Pepa pack front in the layout of the Civlily pack he showed me.

Every element is lifted out of his own die-line: the patterned peach ground
with its green side bands, the wordmark, and the savannah. The one addition
is the "50 PER BOX" badge, which the Civlily pack carries and the Pepa
die-line does not — it states a fact that is already true of the pack.
"""
from PIL import Image, ImageDraw, ImageFont
import sys
SP = sys.argv[1]

MM = 12                       # px per mm
FW, FH = 74 * MM, 155 * MM    # the front face, 888 x 1860

page = Image.open(SP + "/die/page-1.png").convert("RGB")

# Ground: the front panel exactly as the die-line draws it — 74 x 155 mm
# between its own fold lines, so the green side bands keep their full-height
# text instead of being clipped mid-word. The wordmark already sits high on
# the panel, where the Civlily wordmark sits.
ground = page.crop((1396, 786, 2271, 2616)).resize((FW, FH), Image.LANCZOS)
face = ground.copy()

# The savannah, scaled to fill the bottom band and cropped to the stretch that
# carries the Maasai, the drums and Kilimanjaro — Civlily's framing.
# Cropped below y=240 so the bold "ROLLING PAPERS" line that sits in the
# strip's sky stays out of the band — it is set separately on the face.
BAND = 45 * MM
strip = page.crop((830, 786, 1396, 2616)).rotate(90, expand=True)
scene = strip.crop((1199, 240, 1735, 566)).resize((FW, BAND), Image.LANCZOS)
face.paste(scene, (0, FH - BAND))

d = ImageDraw.Draw(face)

# "50 PER BOX", top right.
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 40)
label = "50 PER BOX"
tw = d.textbbox((0, 0), label, font=font)
bw, bh = tw[2] - tw[0] + 44, tw[3] - tw[1] + 30
bx, by = FW - bw - 62, 88
d.rectangle([bx, by, bx + bw, by + bh], fill=(26, 24, 22))
d.text((bx + 22 - tw[0], by + 15 - tw[1]), label, font=font, fill=(255, 255, 255))

face.save(SP + "/die/pepa-front.png")
print("front face:", face.size)
