# MyFits: astromy-fits-vscode

<div style='text-align:center'>
<img src="https://github.com/lmytime/astromy-fits-vscode/raw/HEAD/media/logo-large.png" width='100px'>
</div>
MyFits is a Visual Studio Code extension to preview astronomical FITS files.

> Install: Search `MyFits` in the VSCode extension store.

Image data:
<div style='text-align:center'>
<img src="https://github.com/lmytime/astromy-fits-vscode/raw/HEAD/media/img_example_MyFits.jpg">
</div>

---

Table data:
<div style='text-align:center'>
<img src="https://github.com/lmytime/astromy-fits-vscode/raw/HEAD/media/table_example_MyFits.png">
</div>

## Features

- Inspect every HDU header inside FITS, PHA, PI, ARF, and related files with instant keyword search.
- Render interactive 2‑D images with pixel-level zooming, panning, colour-map cycling, and vmin/vmax presets (ZScale, common percentiles, or Min/Max). WCS keywords (CD/PC+CDELT/CROTA) expose RA/Dec directly in the metadata bar.
- Preview binary and ASCII tables with column metadata, pagination, and global row search.
- Keep previews responsive by loading headers first and then fetching image/table payloads on demand.

> This extension is still under active development; please share ideas or issues!

## Known Issues

- Extremely large image/table HDUs can still exceed VS Code memory limits and will show a friendly preview error instead of hanging.
- Highly custom FITS table descriptors are normalized into string previews and may not preserve every original low-level formatting detail.

## Release Notes

Please check the `CHANGELOG.md` for the release notes.
