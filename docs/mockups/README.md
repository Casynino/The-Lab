# Pepa packaging mockups

Rendered straight from the factory die-lines — no redrawing. PIL only.

```bash
W=/tmp/pepa-work && mkdir -p $W/n70 $W/kss2 $W/out $W/page
pdftoppm -r 300 -png "70×36刀版 0.pdf" $W/n70/p                                  # small box, final
pdftoppm -r 300 -png "【7244】册子KSS本色13g无水印 OHIS棕色-- 2.pdf" $W/kss2/p     # King Size box + booklet, final
cp *.py $W/ && cd $W
python3 extract.py $W              # cut every face at its measured folds
python3 prep.py $W                 # cut-outs -> transparency, guide lines -> creases / erased
python3 tab.py $W                  # the King Size lid's pop-up Pepa tab, cut along its die line
python3 scene_final.py $W          # both boxes: hero shots, back, above, every-angle sheets
python3 scene_small_display.py $W  # small box open as a display (OHIS layout)
python3 sheets.py $W               # one presentation sheet per box
python3 scene_page.py $W           # the three pictures on the Pepa Ndogo QR page
python3 publish.py $W <repo>       # encode + hash them, write the page's asset manifest
```

`publish.py` writes `client/public/pepa/*` and
`server/src/services/productPageAssets.json`; never edit either by hand. It
keeps the previous release's pictures one more deploy, so a page still cached
at the edge never points at a deleted file.

The QR page behind the 70 x 36 box describes that box only. The King Size Slim
box will get its own QR and page.
