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
- Render interactive 2‑D images with pixel-level zooming, panning, colour-map cycling, and vmin/vmax presets (ZScale or 90–100 % coverage). WCS keywords (CD/PC+CDELT) automatically expose RA/Dec in the metadata bar.
- Preview binary/ASCII tables with column metadata, row filtering, and a guaranteed “first row” view even when the full HDU exceeds the inline limit.
- Skip bulk payloads automatically when images exceed ~30 MB or tables exceed ~15 MB (decimal base), while offering a one-click “Load […] anyway” action for huge datasets.

> This extension is still under active development; please share ideas or issues!

## Known Issues

- Extremely large files (>2 GB) are loaded in header-only mode; image/table payloads are skipped with a warning to keep VS Code responsive.
- Variable-length or highly custom table descriptors are surfaced as `[unsupported]` cells in the preview.
- Images are not shwon in pixelized grid.

## Release Notes

Please check the `CHANGELOG.md` for the release notes.
