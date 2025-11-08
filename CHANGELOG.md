# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com).

## [0.2.2] - 2024-10-28
### Changed
- Overhauled the FITS image viewer to stream full-depth pixel data, default to z-scale cuts, and show true pixel values in the metadata bar.
- Moved zoom/scale controls into the metadata row (preset percentiles plus colour cycling) with a live `vmin/vmax` overlay.
- Rebuilt the canvas renderer to match the JS9-style pan/zoom flow (fit-to-view by default, translation even for small images, zoom buttons+wheels centered on the viewport) while eliminating the old custom-cut panel.
- Added a WCS readout (RA/Dec) whenever a CD matrix exists and flipped the image vertically so pixel `(0,0)` sits at the lower-left; rendering now keeps the pixelated look no matter how far you zoom in.
- Default zoom now fits the viewport, centers automatically, and prevents drift when the image is smaller than the window; dedicated +/- buttons keep zooming around the current view center.
- Large FITS payloads no longer embed massive pixel arrays in the initial message, preventing `Invalid string length` crashes; oversized images require an explicit “Load image” action.

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
