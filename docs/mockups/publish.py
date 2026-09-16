"""Encode the page scenes for the web and write the asset manifest the page reads.

Each picture ships at two widths (700 for phones, 1000 for larger screens) as
WebP with a JPEG fallback. Every file is named by a hash of ITS OWN bytes, so a
changed file is always a new URL — no phone, CDN edge or WhatsApp preview can
keep an old box, and the one-year immutable cache on /pepa/* stays safe.
The manifest is generated: never edit it by hand."""
import sys, os, json, hashlib, glob
from PIL import Image
SP, REPO = sys.argv[1], sys.argv[2]
PUB = os.path.join(REPO, "client", "public", "pepa")
os.makedirs(PUB, exist_ok=True)
WIDTHS = (700, 1000)
ALT = {
    "range": "Pepa 70 × 36 pack and Pepa King Size Slim display box",
    "small": "Pepa 70 × 36 pack, front and back, with two booklets",
    "kss-open": "Pepa King Size Slim display box, open, with a booklet",
    "kss-closed": "Pepa King Size Slim display box, closed",
}
def write(img, name, width, ext, **kw):
    tmp = os.path.join(PUB, f".tmp.{ext}")
    img.save(tmp, **kw)
    h = hashlib.sha256(open(tmp, "rb").read()).hexdigest()[:10]
    fn = f"{name}-{width}.{h}.{ext}"
    os.replace(tmp, os.path.join(PUB, fn))
    return {"w": width, "src": f"/pepa/{fn}", "bytes": os.path.getsize(os.path.join(PUB, fn))}

manifest = {}
for name, alt in ALT.items():
    src = Image.open(os.path.join(SP, "page", name + "-full.png")).convert("RGB")
    entry = {"alt": alt, "webp": [], "jpg": []}
    for width in WIDTHS:
        img = src.resize((width, round(src.height * width / src.width)), Image.LANCZOS)
        entry["webp"].append(write(img, name, width, "webp", format="WEBP", quality=80, method=6))
        entry["jpg"].append(write(img, name, width, "jpg", format="JPEG", quality=80, optimize=True, progressive=True))
        if width == max(WIDTHS):
            entry["w"], entry["h"] = img.width, img.height
    manifest[name] = entry
    print(f"{name:11s} " + "  ".join(f"{e['w']}w webp {e['bytes']//1024}KB" for e in entry["webp"]))
# Only once every new file and the manifest are written are old files removed,
# so a run that fails part-way never leaves the manifest pointing at nothing.
out = os.path.join(REPO, "server", "src", "services", "productPageAssets.json")
tmp_manifest = out + ".tmp"
with open(tmp_manifest, "w") as fh:
    json.dump(manifest, fh, indent=2, ensure_ascii=False); fh.write("\n")
os.replace(tmp_manifest, out)
keep = {os.path.basename(f["src"]) for m in manifest.values() for f in m["webp"] + m["jpg"]}
for old in glob.glob(os.path.join(PUB, "*")):
    if os.path.basename(old) not in keep:
        os.remove(old)
print("phone total (700w webp):", sum(m["webp"][0]["bytes"] for m in manifest.values()) // 1024, "KB")
