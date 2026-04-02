# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com).

## [0.4.0] - 2026-04-02
### Added
- Add a lightweight built-in FITS image viewer with pixel-preserving zoom, pan, colormap switching, invert, percentile and Min/Max scale presets.
- Add real-time local WCS readout in the image status bar with RA/Dec shown in ICRS degrees.
- Add fast table pagination with global row search and fixed non-scrolling table controls.

### Changed
- Rework the preview pipeline to load FITS manifests first and fetch image/table payloads on demand.
- Move image preview to an extension-host fast path so small image HDUs open much faster.
- Move table preview to a local parser/cache path, making small tables load quickly and making global search responsive.
- Refine the bottom preview layout, metadata bar, footer, and table/image styling to better match the rest of the extension UI.

### Removed
- Remove the old JS9-based image preview path and the unused Pyodide/Astropy worker pipeline.
- Remove vendored JS9/Pyodide assets, obsolete helper scripts, and other dead code/resources that were no longer used at runtime.

## [0.3.1] - 2026-01-21
### Fixed
- Fixing the bug of image blinking.

## [0.3.0] - 2025-11-09
### Added
- Add new functions to preview image and table data.
- Allow searching in header.
- Update README for new functions.

## [0.2.1] - 2024-10-27
### Changed
- Resubmit adding change log.
- add an example screenshot in the readme.

## [0.2.0] - 2024-10-27
### Fixed
- Fixed bug that only part of headers are shown.
### Added
- Add a new feature to resize the divider bar.
- Add a new feature to show the file size.

## [0.1.3] - 2023-03-25
### Fixed
- Fixed bug when extension have no name.


## [0.1.2] - 2023-03-25
### Fixed
- Fixed the logo loading issue: remove logo temporarily.


## [0.1.1] - 2023-03-25
### Changed
- Update the readme and changelog.
- remove some debug info and unused comments.


## [0.1.0] - 2023-03-25
### Added
- Add the UI pape!

### Changed
- Change the color configuration.


## [0.0.2] - 2023-03-11
### Added
- Add logo for the extension, which is a galaxy-like logo. This logo is tentatively as the key logo of AstroMy project.
- Add this CHANGELOG.md file to take notes for the development of this extension.

### Changed
- Change the text color from cyan to the complementary colours of the background.

### Removed
- Remove the default helloworld command in the package.json file.


## [0.0.1] - 2023-03-01
### Added
- This is the first release of Myfits -- VSCode extension to preview the astronomy fits files.
- Only with the function of displaying headers.
