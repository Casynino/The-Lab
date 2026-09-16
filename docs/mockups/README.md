# Pepa packaging mockups

Rendered straight from the factory die-lines — no redrawing. PIL only.

```bash
W=/tmp/pepa-work && mkdir -p $W/n70 $W/kss2 $W/out
pdftoppm -r 300 -png "70×36刀版 -01.pdf" $W/n70/p
pdftoppm -r 300 -png "【7244】册子KSS本色13g无水印 OHIS棕色--.pdf" $W/kss2/p
python3 extract.py $W        # cut every face at its measured folds
python3 prep.py $W           # cut-outs → transparency, guide lines → creases
python3 scene_n70.py $W      # 70 x 36 pack, front and back
python3 scene_kss.py $W      # King Size Slim box: closed front/back, open display
python3 scene_turntable.py $W  # 70 x 36 pack from every angle
python3 scene_page.py $W     # the four pictures on the public page
python3 publish.py $W <repo> # encode + hash them, write the page's asset manifest
```

`publish.py` writes `client/public/pepa/*` and
`server/src/services/productPageAssets.json`. Never edit either by hand.
