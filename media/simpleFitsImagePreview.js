(function () {
    class SimpleFitsImagePreview {
        constructor(options) {
            this.root = options.root;
            this.toolbarHost = options.toolbarHost || null;
            this.imageState = null;
            this.offscreenCanvas = document.createElement('canvas');
            this.offscreenContext = this.offscreenCanvas.getContext('2d');
            this.canvas = document.createElement('canvas');
            this.context = this.canvas.getContext('2d');
            this.devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
            this.scaleMode = 'zscale';
            this.stretchMode = 'linear';
            this.colorMap = 'gray';
            this.invertColorMap = false;
            this.zoom = 1;
            this.offsetX = 0;
            this.offsetY = 0;
            this.fitMode = true;
            this.dragState = null;
            this.cursorSample = null;
            this.lastWorld = null;

            this._build();
            this._bindEvents();
        }

        setLoading(message) {
            this.loadingOverlay.textContent = message;
            this.loadingOverlay.classList.remove('hidden');
        }

        clear(message) {
            this.imageState = null;
            this.cursorSample = null;
            this.lastWorld = null;
            this.primaryStatusEl.textContent = '';
            this.secondaryStatusEl.textContent = '';
            this.scaleSelect.value = 'zscale';
            this.stretchSelect.value = 'linear';
            this.colorSelect.value = 'gray';
            this.invertColorMap = false;
            this.invertButton.classList.remove('is-active');
            this.toolbar.classList.add('hidden');
            this._resizeCanvas();
            this._clearCanvas();
            if (message) {
                this.setLoading(message);
            } else {
                this.loadingOverlay.classList.add('hidden');
            }
        }

        setImage(payload) {
            const pixels = payload.pixels instanceof Float32Array
                ? payload.pixels
                : new Float32Array(payload.pixels);

            this.imageState = {
                key: payload.key,
                width: payload.width,
                height: payload.height,
                pixels,
                scaleModes: payload.scaleModes,
                wcs: payload.wcs || null,
            };

            this.scaleMode = payload.defaultScaleMode || 'zscale';
            this.stretchMode = payload.defaultStretch || 'linear';
            this.colorMap = payload.defaultColorMap || 'gray';
            this.invertColorMap = false;
            this.scaleSelect.value = this.scaleMode;
            this.stretchSelect.value = this.stretchMode;
            this.colorSelect.value = this.colorMap;
            this.invertButton.classList.remove('is-active');
            this.loadingOverlay.classList.add('hidden');
            this.toolbar.classList.remove('hidden');
            this._rebuildRaster();
            this.fitToView();
            this._renderStatus();
        }

        fitToView() {
            if (!this.imageState) {
                return;
            }
            const viewportWidth = this.viewport.clientWidth;
            const viewportHeight = this.viewport.clientHeight;
            if (!viewportWidth || !viewportHeight) {
                return;
            }

            const scale = Math.min(
                viewportWidth / this.imageState.width,
                viewportHeight / this.imageState.height,
            );

            this.zoom = Math.max(scale, 0.01);
            this.offsetX = (viewportWidth - this.imageState.width * this.zoom) / 2;
            this.offsetY = (viewportHeight - this.imageState.height * this.zoom) / 2;
            this.fitMode = true;
            this._render();
            this._renderStatus();
        }

        zoomIn() {
            this._zoomBy(1.25);
        }

        zoomOut() {
            this._zoomBy(0.8);
        }

        zoomToActual() {
            if (!this.imageState) {
                return;
            }
            const viewportWidth = this.viewport.clientWidth;
            const viewportHeight = this.viewport.clientHeight;
            this.zoom = 1;
            this.offsetX = (viewportWidth - this.imageState.width) / 2;
            this.offsetY = (viewportHeight - this.imageState.height) / 2;
            this.fitMode = false;
            this._render();
            this._renderStatus();
        }

        resize() {
            if (!this.imageState) {
                this._resizeCanvas();
                this._clearCanvas();
                return;
            }
            if (this.fitMode) {
                this.fitToView();
            } else {
                this._render();
            }
        }

        _build() {
            this.root.innerHTML = '';
            if (this.toolbarHost) {
                this.toolbarHost.innerHTML = '';
            }

            this.toolbar = document.createElement('div');
            this.toolbar.className = 'image-toolbar hidden';

            const zoomGroup = document.createElement('div');
            zoomGroup.className = 'image-toolbar-group';

            this.fitButton = createToolbarButton('Fit');
            this.oneToOneButton = createToolbarButton('100%');
            this.zoomOutButton = createToolbarButton('-');
            this.zoomInButton = createToolbarButton('+');
            zoomGroup.append(this.fitButton, this.oneToOneButton, this.zoomOutButton, this.zoomInButton);

            const controlsGroup = document.createElement('div');
            controlsGroup.className = 'image-toolbar-group';

            this.scaleSelect = createToolbarSelect([
                ['zscale', 'ZScale'],
                ['pct90', '90%'],
                ['pct95', '95%'],
                ['pct99', '99%'],
                ['pct995', '99.5%'],
                ['pct999', '99.9%'],
                ['pct9995', '99.95%'],
                ['pct9999', '99.99%'],
                ['minmax', 'Min/Max'],
            ]);
            this.stretchSelect = createToolbarSelect([
                ['linear', 'Linear'],
                ['sqrt', 'Sqrt'],
                ['log', 'Log'],
                ['asinh', 'Asinh'],
            ]);
            this.colorSelect = createToolbarSelect([
                ['gray', 'Gray'],
                ['viridis', 'Viridis'],
                ['plasma', 'Plasma'],
                ['inferno', 'Inferno'],
                ['magma', 'Magma'],
                ['cividis', 'Cividis'],
                ['cubehelix', 'Cubehelix'],
                ['coolwarm', 'CoolWarm'],
            ]);
            this.invertButton = createToolbarButton('Invert');

            controlsGroup.append(
                this.scaleSelect,
                this.stretchSelect,
                this.colorSelect,
                this.invertButton,
            );
            this.toolbar.append(zoomGroup, controlsGroup);

            this.viewport = document.createElement('div');
            this.viewport.className = 'image-viewport';
            this.canvas.className = 'image-canvas';
            this.loadingOverlay = document.createElement('div');
            this.loadingOverlay.className = 'image-loading hidden';
            this.viewport.append(this.canvas, this.loadingOverlay);

            const status = document.createElement('div');
            status.className = 'image-status';
            this.primaryStatusEl = document.createElement('div');
            this.primaryStatusEl.className = 'image-status-primary';
            this.secondaryStatusEl = document.createElement('div');
            this.secondaryStatusEl.className = 'image-status-secondary';
            status.append(this.primaryStatusEl, this.secondaryStatusEl);

            if (this.toolbarHost) {
                this.toolbarHost.appendChild(this.toolbar);
            } else {
                this.root.appendChild(this.toolbar);
            }
            this.root.append(this.viewport, status);
        }

        _bindEvents() {
            this.fitButton.addEventListener('click', () => this.fitToView());
            this.oneToOneButton.addEventListener('click', () => this.zoomToActual());
            this.zoomInButton.addEventListener('click', () => this.zoomIn());
            this.zoomOutButton.addEventListener('click', () => this.zoomOut());

            this.scaleSelect.addEventListener('change', () => {
                if (!this.imageState) {
                    return;
                }
                this.scaleMode = this.scaleSelect.value;
                this._rebuildRaster();
                this._render();
                this._renderStatus();
            });

            this.stretchSelect.addEventListener('change', () => {
                if (!this.imageState) {
                    return;
                }
                this.stretchMode = this.stretchSelect.value;
                this._rebuildRaster();
                this._render();
                this._renderStatus();
            });

            this.colorSelect.addEventListener('change', () => {
                if (!this.imageState) {
                    return;
                }
                this.colorMap = this.colorSelect.value;
                this._rebuildRaster();
                this._render();
            });

            this.invertButton.addEventListener('click', () => {
                if (!this.imageState) {
                    return;
                }
                this.invertColorMap = !this.invertColorMap;
                this.invertButton.classList.toggle('is-active', this.invertColorMap);
                this._rebuildRaster();
                this._render();
            });

            this.viewport.addEventListener('wheel', (event) => {
                if (!this.imageState) {
                    return;
                }
                event.preventDefault();
                const factor = event.deltaY < 0 ? 1.15 : 0.87;
                this._zoomBy(factor, event.offsetX, event.offsetY);
            }, { passive: false });

            this.viewport.addEventListener('pointerdown', (event) => {
                if (!this.imageState) {
                    return;
                }
                this.dragState = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    offsetX: this.offsetX,
                    offsetY: this.offsetY,
                };
                this.viewport.setPointerCapture(event.pointerId);
            });

            this.viewport.addEventListener('pointermove', (event) => {
                if (this.dragState && this.dragState.pointerId === event.pointerId) {
                    this.fitMode = false;
                    this.offsetX = this.dragState.offsetX + (event.clientX - this.dragState.startX);
                    this.offsetY = this.dragState.offsetY + (event.clientY - this.dragState.startY);
                    this._render();
                }
                this._handleCursorMove(event.offsetX, event.offsetY);
            });

            const clearPointer = () => {
                this.dragState = null;
            };

            this.viewport.addEventListener('pointerup', clearPointer);
            this.viewport.addEventListener('pointercancel', clearPointer);
            this.viewport.addEventListener('pointerleave', () => {
                this.cursorSample = null;
                this.lastWorld = null;
                this._renderStatus();
            });

            if (window.ResizeObserver) {
                this.resizeObserver = new ResizeObserver(() => this.resize());
                this.resizeObserver.observe(this.viewport);
            } else {
                window.addEventListener('resize', () => this.resize());
            }
        }

        _handleCursorMove(offsetX, offsetY) {
            if (!this.imageState) {
                return;
            }
            const imageX = (offsetX - this.offsetX) / this.zoom;
            const imageYFromTop = (offsetY - this.offsetY) / this.zoom;
            const pixelX = Math.floor(imageX);
            const pixelYFromTop = Math.floor(imageYFromTop);
            const pixelY = this.imageState.height - 1 - pixelYFromTop;
            const xCoord = imageX + 1;
            const yCoord = this.imageState.height - imageYFromTop;

            if (
                pixelX < 0 ||
                pixelYFromTop < 0 ||
                pixelX >= this.imageState.width ||
                pixelYFromTop >= this.imageState.height
            ) {
                this.cursorSample = null;
                this.lastWorld = null;
                this._renderStatus();
                return;
            }

            const pixelIndex = pixelY * this.imageState.width + pixelX;
            this.cursorSample = {
                pixelX,
                pixelY,
                xCoord,
                yCoord,
                value: this.imageState.pixels[pixelIndex],
            };
            this.lastWorld = computeWorldCoordinates(this.imageState.wcs, xCoord, yCoord);
            this._renderStatus();
        }

        _zoomBy(factor, anchorX, anchorY) {
            if (!this.imageState) {
                return;
            }

            const viewportWidth = this.viewport.clientWidth;
            const viewportHeight = this.viewport.clientHeight;
            const anchorViewportX = typeof anchorX === 'number' ? anchorX : viewportWidth / 2;
            const anchorViewportY = typeof anchorY === 'number' ? anchorY : viewportHeight / 2;

            const imageAnchorX = (anchorViewportX - this.offsetX) / this.zoom;
            const imageAnchorY = (anchorViewportY - this.offsetY) / this.zoom;
            const nextZoom = clamp(this.zoom * factor, 0.05, 64);

            this.offsetX = anchorViewportX - imageAnchorX * nextZoom;
            this.offsetY = anchorViewportY - imageAnchorY * nextZoom;
            this.zoom = nextZoom;
            this.fitMode = false;
            this._render();
            this._renderStatus();
        }

        _rebuildRaster() {
            if (!this.imageState) {
                return;
            }

            const limits = this.imageState.scaleModes[this.scaleMode] || this.imageState.scaleModes.zscale;
            const [low, high] = normalizeLimits(limits);
            const span = high - low || 1;
            const width = this.imageState.width;
            const height = this.imageState.height;
            const pixels = this.imageState.pixels;
            const imageData = new ImageData(width, height);
            const target = imageData.data;

            for (let displayY = 0; displayY < height; displayY += 1) {
                const sourceY = height - 1 - displayY;
                for (let x = 0; x < width; x += 1) {
                    const sourceIndex = sourceY * width + x;
                    const targetIndex = (displayY * width + x) * 4;
                    const value = pixels[sourceIndex];
                    let normalized = 0;
                    if (Number.isFinite(value)) {
                        normalized = (value - low) / span;
                        if (normalized < 0) {
                            normalized = 0;
                        } else if (normalized > 1) {
                            normalized = 1;
                        }
                        normalized = applyStretch(normalized, this.stretchMode);
                    }
                    const [red, green, blue] = sampleColorMap(normalized, this.colorMap, this.invertColorMap);
                    target[targetIndex] = red;
                    target[targetIndex + 1] = green;
                    target[targetIndex + 2] = blue;
                    target[targetIndex + 3] = 255;
                }
            }

            this.offscreenCanvas.width = width;
            this.offscreenCanvas.height = height;
            this.offscreenContext.putImageData(imageData, 0, 0);
        }

        _resizeCanvas() {
            const width = Math.max(1, this.viewport.clientWidth);
            const height = Math.max(1, this.viewport.clientHeight);
            this.canvas.width = Math.floor(width * this.devicePixelRatio);
            this.canvas.height = Math.floor(height * this.devicePixelRatio);
            this.canvas.style.width = `${width}px`;
            this.canvas.style.height = `${height}px`;
        }

        _render() {
            this._resizeCanvas();
            this._clearCanvas();

            if (!this.imageState) {
                return;
            }

            this.context.save();
            this.context.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
            this.context.imageSmoothingEnabled = false;
            if ('webkitImageSmoothingEnabled' in this.context) {
                this.context.webkitImageSmoothingEnabled = false;
            }
            if ('mozImageSmoothingEnabled' in this.context) {
                this.context.mozImageSmoothingEnabled = false;
            }
            if ('msImageSmoothingEnabled' in this.context) {
                this.context.msImageSmoothingEnabled = false;
            }
            this.context.drawImage(
                this.offscreenCanvas,
                Math.round(this.offsetX),
                Math.round(this.offsetY),
                Math.round(this.imageState.width * this.zoom),
                Math.round(this.imageState.height * this.zoom),
            );
            this.context.restore();
        }

        _clearCanvas() {
            this.context.save();
            this.context.setTransform(1, 0, 0, 1, 0, 0);
            this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.context.fillStyle = getViewerBackgroundColor();
            this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.context.restore();
        }

        _renderStatus() {
            if (!this.imageState) {
                this.primaryStatusEl.textContent = '';
                this.secondaryStatusEl.textContent = '';
                return;
            }

            const zoomPercent = `${Math.round(this.zoom * 100)}%`;
            this.primaryStatusEl.textContent = `Zoom ${zoomPercent}`;

            if (!this.cursorSample) {
                this.secondaryStatusEl.textContent = '';
                return;
            }

            const primaryParts = [
                `Zoom ${zoomPercent}`,
                `x, y = ${formatCursorCoordinate(this.cursorSample.xCoord)}, ${formatCursorCoordinate(this.cursorSample.yCoord)}`,
                `value ${formatSampleValue(this.cursorSample.value)}`,
            ];
            this.primaryStatusEl.textContent = primaryParts.join(' · ');

            if (this.lastWorld) {
                this.secondaryStatusEl.textContent = `RA, Dec (deg) = ${formatDegrees(this.lastWorld.raDeg)}, ${formatDegrees(this.lastWorld.decDeg)}`;
                return;
            }
            this.secondaryStatusEl.textContent = '';
        }
    }

    function createToolbarButton(label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'image-toolbar-button';
        button.textContent = label;
        return button;
    }

    function createToolbarSelect(options) {
        const select = document.createElement('select');
        select.className = 'image-toolbar-select';
        options.forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            select.appendChild(option);
        });
        return select;
    }

    function createToolbarLabel(labelText, control) {
        const label = document.createElement('label');
        label.className = 'image-toolbar-label';

        const text = document.createElement('span');
        text.className = 'image-toolbar-label-text';
        text.textContent = labelText;

        label.append(text, control);
        return label;
    }

    function sampleColorMap(value, colorMap, inverted) {
        const stops = COLOR_MAPS[colorMap] || COLOR_MAPS.gray;
        const normalized = clamp(inverted ? 1 - value : value, 0, 1);
        if (normalized <= 0) {
            return stops[0];
        }
        if (normalized >= 1) {
            return stops[stops.length - 1];
        }
        const scaled = normalized * (stops.length - 1);
        const lowerIndex = Math.floor(scaled);
        const upperIndex = Math.min(stops.length - 1, lowerIndex + 1);
        const mix = scaled - lowerIndex;
        return interpolateColor(stops[lowerIndex], stops[upperIndex], mix);
    }

    function interpolateColor(from, to, mix) {
        return [
            Math.round(from[0] + (to[0] - from[0]) * mix),
            Math.round(from[1] + (to[1] - from[1]) * mix),
            Math.round(from[2] + (to[2] - from[2]) * mix),
        ];
    }

    function applyStretch(value, mode) {
        switch (mode) {
            case 'sqrt':
                return Math.sqrt(value);
            case 'log':
                return Math.log10(1 + 1000 * value) / Math.log10(1001);
            case 'asinh':
                return Math.asinh(10 * value) / Math.asinh(10);
            case 'linear':
            default:
                return value;
        }
    }

    function normalizeLimits(limits) {
        const low = Number.isFinite(limits && limits[0]) ? limits[0] : 0;
        const high = Number.isFinite(limits && limits[1]) ? limits[1] : 1;
        if (high > low) {
            return [low, high];
        }
        const span = Math.abs(low) || 1;
        return [low - span * 0.5, high + span * 0.5];
    }

    function formatSampleValue(value) {
        if (!Number.isFinite(value)) {
            return 'NaN';
        }
        return Math.abs(value) >= 1000 || Math.abs(value) < 0.001
            ? value.toExponential(4)
            : value.toFixed(6).replace(/\.?0+$/, '');
    }

    function formatDegrees(value) {
        if (!Number.isFinite(value)) {
            return 'NaN';
        }
        return value.toFixed(6);
    }

    function formatCursorCoordinate(value) {
        if (!Number.isFinite(value)) {
            return 'NaN';
        }
        return value.toFixed(2);
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function computeWorldCoordinates(wcs, xCoord, yCoord) {
        if (!wcs) {
            return null;
        }

        const dx = xCoord - wcs.crpix[0];
        const dy = yCoord - wcs.crpix[1];
        const xiDeg = wcs.cd[0][0] * dx + wcs.cd[0][1] * dy;
        const etaDeg = wcs.cd[1][0] * dx + wcs.cd[1][1] * dy;

        if (wcs.projection === 'TAN') {
            return projectTan(wcs.crval[0], wcs.crval[1], xiDeg, etaDeg);
        }

        return {
            raDeg: normalizeDegrees(wcs.crval[0] + xiDeg),
            decDeg: wcs.crval[1] + etaDeg,
            frame: 'ICRS',
            unit: 'deg',
        };
    }

    function projectTan(ra0Deg, dec0Deg, xiDeg, etaDeg) {
        const ra0 = ra0Deg * (Math.PI / 180);
        const dec0 = dec0Deg * (Math.PI / 180);
        const xi = xiDeg * (Math.PI / 180);
        const eta = etaDeg * (Math.PI / 180);
        const denominator = Math.cos(dec0) - eta * Math.sin(dec0);
        const ra = ra0 + Math.atan2(xi, denominator);
        const dec = Math.atan2(
            Math.sin(dec0) + eta * Math.cos(dec0),
            Math.sqrt(denominator * denominator + xi * xi),
        );

        return {
            raDeg: normalizeDegrees(ra * (180 / Math.PI)),
            decDeg: dec * (180 / Math.PI),
            frame: 'ICRS',
            unit: 'deg',
        };
    }

    function normalizeDegrees(value) {
        const normalized = value % 360;
        return normalized < 0 ? normalized + 360 : normalized;
    }

    function getViewerBackgroundColor() {
        const styles = getComputedStyle(document.body);
        return styles.getPropertyValue('--vscode-editor-background').trim() || styles.backgroundColor || '#1e1e1e';
    }

    const COLOR_MAPS = {
        gray: [
            [0, 0, 0],
            [255, 255, 255],
        ],
        viridis: [
            [68, 1, 84],
            [59, 82, 139],
            [33, 145, 140],
            [94, 201, 98],
            [253, 231, 37],
        ],
        plasma: [
            [13, 8, 135],
            [84, 3, 160],
            [182, 55, 121],
            [251, 136, 97],
            [240, 249, 33],
        ],
        inferno: [
            [0, 0, 4],
            [66, 10, 104],
            [147, 38, 103],
            [221, 81, 58],
            [252, 255, 164],
        ],
        magma: [
            [0, 0, 4],
            [73, 15, 109],
            [182, 54, 121],
            [251, 136, 97],
            [252, 253, 191],
        ],
        cividis: [
            [0, 34, 78],
            [66, 78, 108],
            [101, 120, 112],
            [170, 170, 110],
            [253, 234, 69],
        ],
        cubehelix: [
            [0, 0, 0],
            [20, 54, 72],
            [33, 108, 92],
            [94, 166, 112],
            [182, 214, 146],
            [255, 255, 255],
        ],
        coolwarm: [
            [59, 76, 192],
            [120, 150, 220],
            [221, 221, 221],
            [230, 132, 110],
            [180, 4, 38],
        ],
    };

    window.SimpleFitsImagePreview = SimpleFitsImagePreview;
}());
