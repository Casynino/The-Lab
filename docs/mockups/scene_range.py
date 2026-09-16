"""Both products together, at true relative scale: the King Size Slim display
box open with a booklet beside it, and the 70 x 36 pack standing to its left."""
import sys; SP = sys.argv[1]; sys.path.insert(0, SP)
from PIL import Image
import r3d
import scene_kss as K
F = SP + "/f/"
T = lambda n: Image.open(F + "t_" + n + ".png")

n70 = {"front": T("n70_front"), "back": T("n70_back"), "left": T("n70_left"),
       "right": T("n70_right"), "top": T("n70_top")}
npos, nyaw = (-K.w - 60, 0, 30), 32
bpos, byaw = (K.w + 70, 0, 50), -14
q = K.open_box() + K.booklet(bpos, byaw) + r3d.box_quads(74, 155, 48, n70, pos=npos, yaw=nyaw, sheen=0.12, layer=8)
shadows = [(-K.w, K.w, -K.d, K.d, K.H, (0, 0, 0), 0, 1.0),
           (-K.w, K.w, -K.d-18, -K.d, 150, (0, 0, 0), 0, 0.5),
           (-55, 55, -13, 13, 4.3, bpos, byaw, 0.85),
           (-37, 37, -24, 24, 155, npos, nyaw, 1.0)]
cam = r3d.Camera(target=(-6, 78, 0), dist=760, az=20, el=22, fov=32, W=2400, H=1800)
layers = r3d.render(q, cam, light=(-0.45, 0.95, 0.60), shadows=shadows)
r3d.finish(layers, 2400, 1800, pad=0.06).save(SP + "/range.png")
print("rendered range")
