"""The public page's hero: the 70 x 36 pack on the page's own paper colour."""
import sys; SP = sys.argv[1]; sys.path.insert(0, SP)
from PIL import Image
import r3d
F = SP + "/f/"; T = lambda n: Image.open(F + "t_" + n + ".png")
tex = {"front": T("n70_front"), "back": T("n70_back"), "left": T("n70_left"),
       "right": T("n70_right"), "top": T("n70_top")}
q = r3d.box_quads(74, 155, 48, tex, sheen=0.12)
cam = r3d.Camera(target=(0, 74, 0), dist=520, az=30, el=14, fov=26, W=1000, H=1300)
layers = r3d.render(q, cam, light=(-0.5, 0.9, 0.6), shadows=[(-37, 37, -24, 24, 155, (0, 0, 0), 0, 0.9)])
paper = Image.new("RGB", (900, 1200), (246, 241, 231))
img = r3d.finish(layers, 900, 1200, pad=0.05, bg=paper)
img.save(SP + "/pepa-box.jpg", quality=84, optimize=True, progressive=True)
print("hero", img.size)
