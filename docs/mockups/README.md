# Pepa packaging mockups

Rendered straight from the factory die-lines — no redrawing. PIL only.

The workspace holds one folder per design, because `spec.py` compares them;
with one design going to print that folder is `d1` and everything runs inside it.

```bash
W=/tmp/pepa-work/d1 && mkdir -p $W/n70 $W/kss2 $W/n77 $W/out $W/page
pdftoppm -r 300 -png "70×36刀版 0 3.pdf" $W/n70/p                                # 70 x 36 box, FINAL (25 Oct 2026)
pdftoppm -r 300 -png "【7244】册子KSS本色13g无水印 OHIS棕色-- 4.pdf" $W/kss2/p     # the artwork the 77 x 44 box borrows
pdftoppm -r 300 -png "77x44 50入勾底 120309.pdf" $W/n77/p                        # the 77 x 44 hook-bottom pattern, blank
cp *.py qr.js $W/ && cd $W
node qr.js $W                      # each box's own code, as a file — nothing else writes these
python3 extract.py $W              # cut every face at its measured folds
python3 prep.py $W                 # cut-outs -> transparency, guide lines -> creases / erased
python3 tab.py $W                  # the lid's pop-up Pepa tab, cut along its die line
python3 scene_final.py $W          # hero shots, back, above, every-angle sheets
python3 scene_small_display.py $W  # 70 x 36 box open as a display (OHIS layout)
python3 sheets.py $W               # one presentation sheet per box
python3 scene_page.py $W           # the three pictures on the /p page
python3 scene_kubwa.py $W          # the three pictures on the /p2 page
python3 publish.py $W <repo>       # encode + hash them, write the page's asset manifest
python3 layout77.py $W             # the artwork laid on the 77 x 44 pattern, as a proof
python3 pattern_brief.py $W        # what the 77 x 44 box must carry, for whoever draws it
cd /tmp/pepa-work && python3 spec.py /tmp/pepa-work     # the factory deck, per box
```

`publish.py` rewrites the manifest whole, so **every** picture a page still
points at has to be rendered in the same run — `scene_page.py` and
`scene_kubwa.py` both, or the box left out loses its pictures.

There is no King Size product. `scene_final.py` and `spec.py` still carry that
box, and they draw it only when its shots are in `out/`; deleting
`out/Pepa-big-*` before `sheets.py` and `spec.py` keeps it out of what goes to
the factory. The second product is **Pepa Ndogo Kubwa, 77 × 44**, whose carton
is the hook-bottom pattern above — not the King Size carton.

Two more, for showing the work rather than shipping it:

```bash
python3 compare.py $W              # both designs side by side, shot for shot
python3 spec.py $W                 # a bilingual PDF per box per design, for the factory
```

`spec.py` expects the workspace to hold one folder per design (`d1`, `d2`), each with its
own `n70/`, `kss2/` and `out/`. Every figure it prints is measured off the die-line at
300 dpi; where a fold is not drawn on the file, the notes page says so and gives the
position taken. Do not type a size into it that the die does not show.

`publish.py` writes `client/public/pepa/*` and
`server/src/services/productPageAssets.json`; never edit either by hand. It
keeps the previous release's pictures one more deploy, so a page still cached
at the edge never points at a deleted file.

Each box's QR page describes that box only: `/p` is the 70 × 36, `/p2` the
77 × 44. The codes are written by `qr.js` and print in CAPITALS — a QR has a
cheaper mode for capitals and digits, and the page lower-cases the path it
receives so a scan of `/P` still lands.
