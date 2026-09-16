import sys; SP = sys.argv[1]; sys.path.insert(0, SP)
from PIL import Image
import r3d
F = SP + "/f/"
T = lambda n: Image.open(F + "t_" + n + ".png")

W, H, D = 74, 155, 48
tex = {"front": T("n70_front"), "back": T("n70_back"), "left": T("n70_left"),
       "right": T("n70_right"), "top": T("n70_top")}
quads = r3d.box_quads(W, H, D, tex, sheen=0.12)
shadow = [(-W/2, W/2, -D/2, D/2, H, (0, 0, 0), 0, 1.0)]

for name, az in (("front", 32), ("back", 212)):
    cam = r3d.Camera(target=(0, 74, 0), dist=520, az=az, el=16, fov=26, W=1400, H=1600)
    light = (-0.5, 0.9, 0.6) if name == "front" else (0.5, 0.9, -0.6)
    layer = r3d.render(quads, cam, light=light, shadows=shadow)
    r3d.finish(layer, 1400, 1600, pad=0.07).save(SP + f"/n70_{name}.png")
    print("rendered", name)
