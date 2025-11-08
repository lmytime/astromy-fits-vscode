// This script runs inside the VS Code webview
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const DEFAULT_TOP_HEIGHT = 220;

    const COLOR_GRADIENTS = {
        inferno: [
            { pos: 0.0, rgb: [0, 0, 4] },
            { pos: 0.2, rgb: [34, 9, 81] },
            { pos: 0.4, rgb: [111, 23, 126] },
            { pos: 0.6, rgb: [187, 55, 84] },
            { pos: 0.8, rgb: [249, 142, 8] },
            { pos: 1.0, rgb: [252, 255, 164] },
        ],
        viridis: [
            { pos: 0.0, rgb: [68, 1, 84] },
            { pos: 0.25, rgb: [59, 82, 139] },
            { pos: 0.5, rgb: [33, 145, 140] },
            { pos: 0.75, rgb: [94, 201, 97] },
            { pos: 1.0, rgb: [253, 231, 37] },
        ],
        magma: [
            { pos: 0.0, rgb: [0, 0, 3] },
            { pos: 0.25, rgb: [46, 5, 74] },
            { pos: 0.5, rgb: [123, 3, 167] },
            { pos: 0.75, rgb: [215, 67, 118] },
            { pos: 1.0, rgb: [252, 253, 191] },
        ],
        plasma: [
            { pos: 0.0, rgb: [13, 8, 135] },
            { pos: 0.25, rgb: [126, 3, 168] },
            { pos: 0.5, rgb: [203, 71, 119] },
            { pos: 0.75, rgb: [248, 149, 64] },
            { pos: 1.0, rgb: [240, 249, 33] },
        ],
    };

    const COLOR_MAPS = {
        grayscale: (value) => {
            const v = Math.round(value * 255);
            return [v, v, v];
        },
        inferno: (value) => gradientColor(COLOR_GRADIENTS.inferno, value),
        viridis: (value) => gradientColor(COLOR_GRADIENTS.viridis, value),
        magma: (value) => gradientColor(COLOR_GRADIENTS.magma, value),
        plasma: (value) => gradientColor(COLOR_GRADIENTS.plasma, value),
    };

    class FitsEditor {
        constructor(parent) {
            this.parent = parent;
            this.data = null;
            this.selectedIndex = -1;
            this.rowElements = [];
            this.pendingImageLoads = new Set();
            this.imageStates = new Map();
            this.topCollapsed = false;
            this._initLayout(parent);
            this._registerSplitters();
        }

        _initLayout(parent) {
            parent.innerHTML = `<header class="header"></header>
            <div class="top-container">
                <div class="left-container"></div>
                <div class="divider-vertical" id="divider-vertical"></div>
                <div class="right-container"><div class="placeholder">Select an HDU to inspect its header.</div></div>
            </div>
            <div class="divider-horizontal" id="divider-horizontal"></div>
            <div class="bottom-container">
                <div class="placeholder">Select an HDU to preview image or table data.</div>
            </div>
            <footer>
                <div>MyFits @ AstroMy Project | Designed by <a href="https://lmytime.com">Mingyu Li</a></div>
                <div>Department of Astronomy | Tsinghua University, Beijing</div>
            </footer>`;

            this.headerEl = parent.querySelector('.header');
            this.topContainer = parent.querySelector('.top-container');
            this.leftContainer = parent.querySelector('.left-container');
            this.rightContainer = parent.querySelector('.right-container');
            this.bottomContainer = parent.querySelector('.bottom-container');
            this.dividerHorizontal = document.getElementById('divider-horizontal');

            this.summaryEl = document.createElement('div');
            this.summaryEl.className = 'title';
			this.summaryEl.addEventListener('click', () => this.toggleTopPanel());
            this.headerEl.appendChild(this.summaryEl);

            this.topContainer.style.height = `${DEFAULT_TOP_HEIGHT}px`;
        }

        toggleTopPanel() {
            this.topCollapsed = !this.topCollapsed;
            this.topContainer.classList.toggle('collapsed', this.topCollapsed);
            this.dividerHorizontal.classList.toggle('collapsed', this.topCollapsed);
        }

        _registerSplitters() {
            const dividerV = document.getElementById('divider-vertical');
            const dividerH = document.getElementById('divider-horizontal');
            const left = this.leftContainer;
            const top = this.topContainer;

            let isResizingW = false;
            dividerV.addEventListener('mousedown', () => {
                if (this.topCollapsed) {
                    return;
                }
                isResizingW = true;
                document.body.style.cursor = 'col-resize';
				document.body.style.userSelect = 'none';
            });

            document.addEventListener('mousemove', (event) => {
                if (!isResizingW) {
                    return;
                }
                left.style.width = `${Math.max(220, event.clientX - 20)}px`;
            });

            document.addEventListener('mouseup', () => {
                if (isResizingW) {
                    document.body.style.cursor = 'default';
                }
                isResizingW = false;
				document.body.style.userSelect = 'auto';
            });

            let isResizingH = false;
            dividerH.addEventListener('mousedown', () => {
                if (this.topCollapsed) {
                    return;
                }
                isResizingH = true;
                document.body.style.cursor = 'row-resize';
				document.body.style.userSelect = 'none';
            });

            document.addEventListener('mousemove', (event) => {
                if (!isResizingH) {
                    return;
                }
                top.style.height = `${Math.max(160, event.clientY - 50 - 4)}px`;
            });

            document.addEventListener('mouseup', () => {
                if (isResizingH) {
                    document.body.style.cursor = 'default';
                }
                isResizingH = false;
				document.body.style.userSelect = 'auto';
            });
        }

        async init(data) {
            this.data = data;
            if (!data) {
                return;
            }
            this._renderSummary();
            this._renderHduList();
            if (data.hdus.length > 0) {
                this._selectHdu(0);
            }
        }

        _renderSummary() {
            if (!this.data) {
                return;
            }
            const imageCount = this.data.hdus.filter(h => h.type === 'IMAGE' || (h.index === 0 && h.dimensions.length > 0)).length;
            const tableCount = this.data.hdus.filter(h => h.type === 'BINTABLE' || h.type === 'TABLE').length;
            this.summaryEl.innerHTML = `${this.data.Nhdus} HDU${this.data.Nhdus !== 1 ? 's' : ''}<span id="longtitle">, ${imageCount} image${imageCount !== 1 ? 's' : ''}, ${tableCount} table${tableCount !== 1 ? 's' : ''} <span id="filesize">${this.data.filesize}</span></span>`;
        }

        _renderHduList() {
            if (!this.data) {
                return;
            }
            this.leftContainer.innerHTML = '';
            const table = document.createElement('table');
            table.setAttribute('name', 'extTable');

            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            ['HDU', 'Extension', 'Type', 'Dimensions'].forEach(text => {
                const th = document.createElement('th');
                th.textContent = text;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            this.data.hdus.forEach(hdu => {
                const row = document.createElement('tr');
                row.dataset.index = String(hdu.index);

                const extensionName = hdu.index === 0 ? 'PRIMARY' : (hdu.name || 'EXTENSION');
                const typeLabel = mapTypeLabel(hdu);
                const dims = hdu.dimensions.length ? hdu.dimensions.join('×') : '—';

                [
                    hdu.index,
                    extensionName,
                    typeLabel,
                    dims
                ].forEach(value => {
                    const cell = document.createElement('td');
                    cell.textContent = value.toString();
                    row.appendChild(cell);
                });

                row.addEventListener('click', () => this._selectHdu(hdu.index));
                tbody.appendChild(row);
            });

            table.appendChild(tbody);
            this.leftContainer.appendChild(table);
            this.rowElements = Array.from(tbody.querySelectorAll('tr'));
        }

        _selectHdu(index) {
            if (!this.data || !this.data.hdus[index]) {
                return;
            }
            this.selectedIndex = index;
            this.rowElements.forEach(row => {
                row.classList.toggle('selected', Number(row.dataset.index) === index);
            });
            this._renderHeader(index);
            this._renderData(index);
        }

        _renderHeader(index) {
            const raw = this.data?.rawheaders[index] || [];
            this.rightContainer.innerHTML = '';

            if (!raw.length) {
                this.rightContainer.appendChild(this._buildMessage('No header entries were found for this HDU.'));
                return;
            }

            const searchBar = document.createElement('div');
            searchBar.className = 'search-bar';
            const input = document.createElement('input');
            input.className = 'search-input';
            input.type = 'search';
            input.placeholder = 'Search header keywords...';
            searchBar.appendChild(input);

            const scrollArea = document.createElement('div');
            scrollArea.className = 'header-scroll';
            const pre = document.createElement('pre');
            pre.className = 'header-pre';
            scrollArea.appendChild(pre);

            const renderLines = () => {
                const term = input.value.trim().toLowerCase();
                const filtered = term ? raw.filter(line => line.toLowerCase().includes(term)) : raw;
                pre.innerHTML = '';
                if (!filtered.length) {
                    pre.textContent = 'No matches.';
                    return;
                }
                filtered.forEach((line, idx) => {
                    appendHighlightedLine(pre, line, term);
                    if (idx < filtered.length - 1) {
                        pre.appendChild(document.createTextNode('\n'));
                    }
                });
            };

            input.addEventListener('input', renderLines);
            renderLines();

            this.rightContainer.appendChild(searchBar);
            this.rightContainer.appendChild(scrollArea);
        }

        _renderData(index) {
            if (!this.data) {
                return;
            }
            const hdu = this.data.hdus[index];
            this.bottomContainer.innerHTML = '';

            const meta = document.createElement('div');
            meta.className = 'data-meta';
            const metaText = document.createElement('div');
            metaText.className = 'data-meta-text';
            metaText.textContent = [`HDU ${hdu.index}`, mapTypeLabel(hdu), hdu.name || null, hdu.dimensions.length ? hdu.dimensions.join('×') : 'no data axes']
                .filter(Boolean)
                .join(' • ');
            meta.appendChild(metaText);

            this.bottomContainer.appendChild(meta);

            const metaActions = document.createElement('div');
            metaActions.className = 'meta-actions';

            const wcs = extractWcs(hdu.header);
            let metaElements = null;
            if ((hdu.dataLocation?.kind === 'image') || hdu.imagePreview) {
                const infoBar = document.createElement('div');
                infoBar.className = 'image-info';
                const coordSpan = document.createElement('span');
                coordSpan.textContent = 'Pixel: (—, —)';
                const valueSpan = document.createElement('span');
                valueSpan.textContent = 'Value: —';
                infoBar.append(coordSpan, valueSpan);
                meta.appendChild(infoBar);

                let wcsSpan;
                if (wcs) {
                    wcsSpan = document.createElement('div');
                    wcsSpan.className = 'wcs-info';
                    wcsSpan.textContent = 'WCS: —';
                    meta.appendChild(wcsSpan);
                }

                metaElements = { coordSpan, valueSpan, actions: metaActions, wcsSpan, wcs };
            }

            meta.appendChild(metaActions);

            const hasInlineImageData = !!(hdu.imagePreview && Array.isArray(hdu.imagePreview.values) && hdu.imagePreview.values.length);

            if (!hasInlineImageData && hdu.dataLocation?.kind === 'image') {
                this._renderLoadRequest(index, hdu.dataSkippedReason || 'Image data is larger than the automatic preview limit.');
                return;
            }

            if (hasInlineImageData && hdu.imagePreview) {
                this._renderImagePreview(index, hdu.imagePreview, metaElements);
                return;
            }

            if (hdu.tablePreview) {
                this._renderTablePreview(hdu, hdu.tablePreview);
                if (hdu.tablePreview.message) {
                    this.bottomContainer.appendChild(this._buildMessage(hdu.tablePreview.message));
                }
                return;
            }

            if (hdu.dataSkippedReason) {
                this.bottomContainer.appendChild(this._buildMessage(hdu.dataSkippedReason));
                return;
            }

            this.bottomContainer.appendChild(this._buildMessage('No data is available for this HDU.'));
        }

        _renderImagePreview(index, preview, metaElements) {
            const state = this._getImageState(index, preview);
            const wrapper = document.createElement('div');
            wrapper.className = 'image-preview';

            const stage = document.createElement('div');
            stage.className = 'image-stage';
            stage.tabIndex = 0;

            const canvas = document.createElement('canvas');
            stage.appendChild(canvas);

            const metaActions = metaElements?.actions;

            wrapper.appendChild(stage);
            this.bottomContainer.appendChild(wrapper);

            const shadedCanvas = document.createElement('canvas');
            shadedCanvas.width = preview.width;
            shadedCanvas.height = preview.height;
            const shadedCtx = shadedCanvas.getContext('2d', { willReadFrequently: true });
            const ctx = canvas.getContext('2d');
            shadedCtx.imageSmoothingEnabled = false;
            ctx.imageSmoothingEnabled = false;
            const dpr = window.devicePixelRatio || 1;

            const ensureTranslate = () => {
                if (!state.translate) {
                    const rect = stage.getBoundingClientRect();
                    state.translate = {
                        x: rect.width / 2,
                        y: rect.height / 2,
                    };
                }
            };

            const getViewCenter = () => ({
                x: (stage.clientWidth / 2 - state.translate.x) / state.zoom + preview.width / 2,
                y: (stage.clientHeight / 2 - state.translate.y) / state.zoom + preview.height / 2,
            });

            const draw = () => {
                const width = stage.clientWidth || stage.offsetWidth || preview.width;
                const height = stage.clientHeight || stage.offsetHeight || preview.height;
                if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
                    canvas.width = Math.max(1, Math.floor(width * dpr));
                    canvas.height = Math.max(1, Math.floor(height * dpr));
                    canvas.style.width = `${width}px`;
                    canvas.style.height = `${height}px`;
                }
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.save();
                ctx.scale(dpr, dpr);
                ctx.translate(state.translate.x, state.translate.y);
                ctx.scale(state.zoom, state.zoom);
                ctx.translate(-preview.width / 2, -preview.height / 2);
                ctx.drawImage(shadedCanvas, 0, 0);
                ctx.restore();
            };

            const rebuildShading = () => {
                const imageData = shadedCtx.createImageData(preview.width, preview.height);
                const data = imageData.data;
                const values = preview.values || [];
                const low = Math.min(state.blackPoint, state.whitePoint - Number.EPSILON);
                const high = Math.max(state.whitePoint, low + Number.EPSILON);
                const denom = high - low || 1;
                const colorMap = COLOR_MAPS[state.colormap] || COLOR_MAPS.grayscale;
                for (let y = 0; y < preview.height; y++) {
                    for (let x = 0; x < preview.width; x++) {
                        const raw = values[y * preview.width + x] ?? low;
                        const normalized = clamp((raw - low) / denom, 0, 1);
                        const [r, g, b] = colorMap(normalized);
                        const invY = preview.height - 1 - y;
                        const idx = (invY * preview.width + x) * 4;
                        data[idx] = r;
                        data[idx + 1] = g;
                        data[idx + 2] = b;
                        data[idx + 3] = 255;
                    }
                }
                shadedCtx.putImageData(imageData, 0, 0);
                draw();
            };

            const applyZScale = () => {
                const { min, max } = computeZScale(preview);
                state.blackPoint = min;
                state.whitePoint = max;
                if (scaleSelect) {
                    scaleSelect.value = 'zscale';
                }
                rebuildShading();
            };

            const applyPercentileScale = (coverage) => {
                const upper = clamp(coverage, 0, 100);
                const lowerPercent = (100 - upper) / 2;
                state.blackPoint = percentileToValue(preview, lowerPercent);
                state.whitePoint = percentileToValue(preview, 100 - lowerPercent);
                if (scaleSelect) {
                    const coverageMap = {
                        90: 'p90',
                        95: 'p95',
                        99: 'p99',
                        99.5: 'p99_5',
                        99.9: 'p99_9',
                        99.95: 'p99_95',
                        99.99: 'p99_99',
                        100: 'p100',
                    };
                    if (coverageMap[coverage]) {
                        scaleSelect.value = coverageMap[coverage];
                    }
                }
                rebuildShading();
            };

            const updateZoom = (targetZoom) => {
                const zoom = clamp(targetZoom, 0.1, 16);
                const center = getViewCenter();
                state.zoom = zoom;
                state.translate.x = stage.clientWidth / 2 - (center.x - preview.width / 2) * state.zoom;
                state.translate.y = stage.clientHeight / 2 - (center.y - preview.height / 2) * state.zoom;
                draw();
            };

            const computeFitZoom = () => {
                const width = stage.clientWidth || stage.offsetWidth || preview.width;
                const height = stage.clientHeight || stage.offsetHeight || preview.height;
                const fit = Math.min(width / preview.width, height / preview.height, 1);
                return clamp(fit, 0.1, 16);
            };

            let scaleSelect;
            if (metaActions) {
                metaActions.innerHTML = '';
                scaleSelect = document.createElement('select');
                scaleSelect.className = 'scale-select';
                const scaleOptions = [
                    { value: 'zscale', label: 'ZScale' },
                    { value: 'p90', label: '90%' },
                    { value: 'p95', label: '95%' },
                    { value: 'p99', label: '99%' },
                    { value: 'p99_5', label: '99.5%' },
                    { value: 'p99_9', label: '99.9%' },
                    { value: 'p99_95', label: '99.95%' },
                    { value: 'p99_99', label: '99.99%' },
                    { value: 'p100', label: '100%' },
                ];
                scaleOptions.forEach(({ value, label }) => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = label;
                    scaleSelect.appendChild(option);
                });
                scaleSelect.value = 'zscale';
                const coverageMap = {
                    p90: 90,
                    p95: 95,
                    p99: 99,
                    p99_5: 99.5,
                    p99_9: 99.9,
                    p99_95: 99.95,
                    p99_99: 99.99,
                    p100: 100,
                };
                scaleSelect.addEventListener('change', () => {
                    if (scaleSelect.value === 'zscale') {
                        applyZScale();
                        return;
                    }
                    const coverage = coverageMap[scaleSelect.value];
                    if (coverage) {
                        applyPercentileScale(coverage);
                    }
                });

                const colorBtn = createMetaButton('🎨', 'Cycle colour map', () => {
                    const keys = Object.keys(COLOR_MAPS);
                    const idx = keys.indexOf(state.colormap);
                    state.colormap = keys[(idx + 1) % keys.length];
                    rebuildShading();
                });
                const zoomOutBtn = createMetaButton('−', 'Zoom out', () => updateZoom(state.zoom / 1.2));
                const zoomInBtn = createMetaButton('+', 'Zoom in', () => updateZoom(state.zoom * 1.2));

                metaActions.append(scaleSelect, colorBtn, zoomOutBtn, zoomInBtn);
            }

            let dragState = null;
            stage.addEventListener('pointerdown', (event) => {
                ensureTranslate();
                stage.setPointerCapture(event.pointerId);
                dragState = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    translateX: state.translate?.x ?? 0,
                    translateY: state.translate?.y ?? 0,
                };
            });

            stage.addEventListener('pointermove', (event) => {
                if (!dragState || event.pointerId !== dragState.pointerId) {
                    return;
                }
                ensureTranslate();
                const dx = event.clientX - dragState.startX;
                const dy = event.clientY - dragState.startY;
                state.translate.x = dragState.translateX + dx;
                state.translate.y = dragState.translateY + dy;
                draw();
            });

            const endDrag = (event) => {
                if (dragState && event.pointerId === dragState.pointerId) {
                    stage.releasePointerCapture(event.pointerId);
                    dragState = null;
                }
            };
            stage.addEventListener('pointerup', endDrag);
            stage.addEventListener('pointercancel', endDrag);

            stage.addEventListener('wheel', (event) => {
                event.preventDefault();
                const direction = event.deltaY < 0 ? 1.1 : 0.9;
                updateZoom(state.zoom * direction);
            }, { passive: false });

            stage.addEventListener('dblclick', () => {
                state.zoom = computeFitZoom();
                ensureTranslate();
                state.translate.x = stage.clientWidth / 2;
                state.translate.y = stage.clientHeight / 2;
                draw();
            });

            stage.addEventListener('mousemove', (event) => {
                const coords = getImageCoordsFromStage(event, canvas, state, preview);
                if (!metaElements) {
                    return;
                }
                if (!coords) {
                    metaElements.coordSpan.textContent = 'Pixel: (—, —)';
                    metaElements.valueSpan.textContent = 'Value: —';
                    if (metaElements.wcsSpan) {
                        metaElements.wcsSpan.textContent = 'WCS: —';
                    }
                    return;
                }
                const sourceY = preview.height - 1 - coords.y;
                const sampleIdx = sourceY * preview.width + coords.x;
                const raw = preview.values?.[sampleIdx];
                metaElements.coordSpan.textContent = `Pixel: (${coords.x}, ${coords.y})`;
                metaElements.valueSpan.textContent = typeof raw === 'number' ? `Value: ${formatPixel(raw)}` : 'Value: —';
                if (metaElements.wcsSpan && metaElements.wcs) {
                    const world = pixelToWorld(coords.x, sourceY, metaElements.wcs);
                    metaElements.wcsSpan.textContent = world ? `WCS: ${formatRaDec(world.ra, world.dec)}` : 'WCS: —';
                }
            });

            stage.addEventListener('mouseleave', () => {
                if (metaElements) {
                    metaElements.coordSpan.textContent = 'Pixel: (—, —)';
                    metaElements.valueSpan.textContent = 'Value: —';
                    if (metaElements.wcsSpan) {
                        metaElements.wcsSpan.textContent = 'WCS: —';
                    }
                }
            });

            const resizeObserver = new ResizeObserver(() => {
                ensureTranslate();
                if (state.translate) {
                    const center = getViewCenter();
                    state.translate.x = stage.clientWidth / 2 - (center.x - preview.width / 2) * state.zoom;
                    state.translate.y = stage.clientHeight / 2 - (center.y - preview.height / 2) * state.zoom;
                }
                draw();
            });
            resizeObserver.observe(stage);

            ensureTranslate();
            state.zoom = Math.max(0.1, state.zoom || computeFitZoom());
            applyZScale();
        }

        _renderTablePreview(hdu, preview) {
            const wrapper = document.createElement('div');
            wrapper.className = 'table-preview';

            const searchBar = document.createElement('div');
            searchBar.className = 'search-bar';
            const input = document.createElement('input');
            input.className = 'search-input';
            input.type = 'search';
            input.placeholder = 'Search table rows...';
            searchBar.appendChild(input);
            wrapper.appendChild(searchBar);

            const table = document.createElement('table');
            table.className = 'data-table';

            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            preview.columns.forEach(col => {
                const th = document.createElement('th');
                const label = document.createElement('div');
                label.textContent = col.name;
                th.appendChild(label);
                if (col.unit) {
                    const unit = document.createElement('span');
                    unit.className = 'unit-label';
                    unit.textContent = col.unit;
                    th.appendChild(unit);
                }
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');

            const renderRows = () => {
                const term = input.value.trim().toLowerCase();
                const rows = term
                    ? preview.rows.filter(row => row.some(cell => (cell ?? '').toLowerCase().includes(term)))
                    : preview.rows;
                tbody.innerHTML = '';
                if (!rows.length) {
                    const emptyRow = document.createElement('tr');
                    const td = document.createElement('td');
                    td.colSpan = preview.columns.length;
                    td.className = 'no-results';
                    td.textContent = 'No matching rows.';
                    emptyRow.appendChild(td);
                    tbody.appendChild(emptyRow);
                    return;
                }
                rows.forEach(row => {
                    const tr = document.createElement('tr');
                    row.forEach(cell => {
                        const td = document.createElement('td');
                        appendHighlightedLine(td, cell ?? '', term);
                        tr.appendChild(td);
                    });
                    tbody.appendChild(tr);
                });
            };

            input.addEventListener('input', renderRows);
            renderRows();

            table.appendChild(tbody);
            wrapper.appendChild(table);
            this.bottomContainer.appendChild(wrapper);
        }

        _renderLoadRequest(index, reason) {
            const card = document.createElement('div');
            card.className = 'data-message';
            card.textContent = reason;

            const button = document.createElement('button');
            button.className = 'action-button';
            button.textContent = this.pendingImageLoads.has(index) ? 'Loading…' : 'Load image anyway';
            button.disabled = this.pendingImageLoads.has(index);
            button.addEventListener('click', () => this._requestImageLoad(index, button));
            card.appendChild(document.createElement('br'));
            card.appendChild(button);

            this.bottomContainer.appendChild(card);
        }

        _requestImageLoad(index, button) {
            if (this.pendingImageLoads.has(index)) {
                return;
            }
            this.pendingImageLoads.add(index);
            if (button) {
                button.disabled = true;
                button.textContent = 'Loading…';
            }
            vscode.postMessage({ type: 'requestImage', hduIndex: index });
        }

        onImageLoaded(index, preview) {
            if (!this.data?.hdus[index]) {
                return;
            }
            this.pendingImageLoads.delete(index);
            this.data.hdus[index].imagePreview = preview;
            this.data.hdus[index].dataSkippedReason = undefined;
            if (this.selectedIndex === index) {
                this._renderData(index);
            }
        }

        onPayloadError(index, error) {
            this.pendingImageLoads.delete(index);
            if (typeof index === 'number' && this.selectedIndex === index) {
                this.bottomContainer.appendChild(this._buildMessage(error || 'Failed to load payload.'));
            }
        }

        _buildMessage(text) {
            const div = document.createElement('div');
            div.className = 'data-message';
            div.textContent = text;
            return div;
        }

        _getImageState(index, preview) {
            if (!this.imageStates.has(index)) {
                const cuts = computeZScale(preview);
                this.imageStates.set(index, {
                    zoom: 1,
                    colormap: 'grayscale',
                    blackPoint: cuts.min,
                    whitePoint: cuts.max,
                    translate: null,
                });
            }
            return this.imageStates.get(index);
        }
    }

    function mapTypeLabel(hdu) {
        if (hdu.type === 'PRIMARY') {
            return hdu.dimensions.length ? 'image' : 'primary';
        }
        switch (hdu.type) {
            case 'IMAGE':
                return 'image';
            case 'BINTABLE':
            case 'TABLE':
                return 'table';
            default:
                return hdu.type.toLowerCase();
        }
    }

    function appendHighlightedLine(parent, text, term) {
        const content = text || '';
        if (!term) {
            parent.appendChild(document.createTextNode(content));
            return;
        }
        const lower = content.toLowerCase();
        let lastIndex = 0;
        let matchIndex = lower.indexOf(term);
        while (matchIndex !== -1) {
            if (matchIndex > lastIndex) {
                parent.appendChild(document.createTextNode(content.slice(lastIndex, matchIndex)));
            }
            const mark = document.createElement('mark');
            mark.textContent = content.slice(matchIndex, matchIndex + term.length);
            parent.appendChild(mark);
            lastIndex = matchIndex + term.length;
            matchIndex = lower.indexOf(term, lastIndex);
        }
        if (lastIndex < content.length) {
            parent.appendChild(document.createTextNode(content.slice(lastIndex)));
        }
        if (!content.length) {
            parent.appendChild(document.createTextNode('\u00A0'));
        }
    }

    function gradientColor(stops, value) {
        const t = clamp(value, 0, 1);
        for (let i = 1; i < stops.length; i++) {
            const current = stops[i];
            const prev = stops[i - 1];
            if (t <= current.pos) {
                const span = current.pos - prev.pos || 1;
                const ratio = (t - prev.pos) / span;
                return [
                    Math.round(prev.rgb[0] + (current.rgb[0] - prev.rgb[0]) * ratio),
                    Math.round(prev.rgb[1] + (current.rgb[1] - prev.rgb[1]) * ratio),
                    Math.round(prev.rgb[2] + (current.rgb[2] - prev.rgb[2]) * ratio)
                ];
            }
        }
        return stops[stops.length - 1].rgb;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function getValueSample(preview, maxSize = 4096) {
        if (preview.__sample) {
            return preview.__sample;
        }
        const values = preview.values || [];
        if (!values.length) {
            preview.__sample = [];
            return preview.__sample;
        }
        const step = Math.max(1, Math.floor(values.length / maxSize));
        const sample = [];
        for (let i = 0; i < values.length; i += step) {
            sample.push(values[i]);
        }
        sample.sort((a, b) => a - b);
        preview.__sample = sample;
        return sample;
    }

    function percentileToValue(preview, percent) {
        const sample = getValueSample(preview);
        if (!sample.length) {
            return 0;
        }
        const clamped = clamp(percent, 0, 100) / 100;
        const idx = Math.min(sample.length - 1, Math.max(0, Math.round(clamped * (sample.length - 1))));
        return sample[idx];
    }

    function computeZScale(preview, contrast = 0.25) {
        const sample = getValueSample(preview);
        if (!sample.length) {
            return { min: 0, max: 1 };
        }
        const n = sample.length;
        if (n < 2) {
            const v = sample[0];
            return { min: v, max: v + 1 };
        }
        let sumX = 0;
        let sumY = 0;
        let sumXX = 0;
        let sumXY = 0;
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += sample[i];
            sumXX += i * i;
            sumXY += i * sample[i];
        }
        const denom = n * sumXX - sumX * sumX || 1;
        const slope = (n * sumXY - sumX * sumY) / denom;
        const intercept = (sumY - slope * sumX) / n;
        const center = (n - 1) / 2;
        let z1 = (intercept + slope * center) - (center * slope) / contrast;
        let z2 = z1 + (slope * (n - 1)) / contrast;
        const minPixel = sample[0];
        const maxPixel = sample[n - 1];
        if (!Number.isFinite(z1) || !Number.isFinite(z2) || z2 <= z1) {
            z1 = minPixel;
            z2 = maxPixel;
        }
        if (z2 - z1 < (maxPixel - minPixel) / 1000) {
            z1 = minPixel;
            z2 = maxPixel;
        }
        return { min: z1, max: z2 };
    }

    function createMetaButton(label, title, handler) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'meta-button';
        button.textContent = label;
        button.title = title;
        button.addEventListener('click', handler);
        return button;
    }

    function getImageCoordsFromStage(event, canvas, state, preview) {
        if (!state.translate || !state.zoom) {
            return undefined;
        }
        const rect = canvas.getBoundingClientRect();
        const cssX = event.clientX - rect.left;
        const cssY = event.clientY - rect.top;
        const x = Math.floor((cssX - state.translate.x) / state.zoom + preview.width / 2);
        const yTop = Math.floor((cssY - state.translate.y) / state.zoom + preview.height / 2);
        const y = preview.height - 1 - yTop;
        if (x < 0 || x >= preview.width || y < 0 || y >= preview.height) {
            return undefined;
        }
        return { x, y };
    }

    function formatPixel(value) {
        if (!Number.isFinite(value)) {
            return '—';
        }
        if (Math.abs(value) >= 1e4 || Math.abs(value) <= 1e-3) {
            return value.toExponential(4);
        }
        return Number.isInteger(value) ? value.toString() : value.toFixed(4);
    }

    function extractWcs(header) {
        if (!header) {
            return undefined;
        }
        const ctype1 = normalizeHeaderString(header['CTYPE1']);
        const ctype2 = normalizeHeaderString(header['CTYPE2']);
        if (!ctype1 || !ctype2) {
            return undefined;
        }
        const upper1 = ctype1.toUpperCase();
        const upper2 = ctype2.toUpperCase();
        if (!upper1.includes('RA') || !upper2.includes('DEC')) {
            return undefined;
        }
        const crpix1 = headerNumber(header['CRPIX1']);
        const crpix2 = headerNumber(header['CRPIX2']);
        const crval1 = headerNumber(header['CRVAL1']);
        const crval2 = headerNumber(header['CRVAL2']);
        const cd11 = headerNumber(header['CD1_1']);
        const cd12 = headerNumber(header['CD1_2']);
        const cd21 = headerNumber(header['CD2_1']);
        const cd22 = headerNumber(header['CD2_2']);
        if ([crpix1, crpix2, crval1, crval2, cd11, cd12, cd21, cd22].some(value => !Number.isFinite(value))) {
            return undefined;
        }
        return {
            refPixel: [crpix1, crpix2],
            refWorld: [crval1, crval2],
            matrix: [
                [cd11, cd12],
                [cd21, cd22],
            ],
        };
    }

    function pixelToWorld(x, y, wcs) {
        if (!wcs) {
            return undefined;
        }
        const xPix = x + 1;
        const yPix = y + 1;
        const dx = xPix - wcs.refPixel[0];
        const dy = yPix - wcs.refPixel[1];
        const xi = wcs.matrix[0][0] * dx + wcs.matrix[0][1] * dy;
        const eta = wcs.matrix[1][0] * dx + wcs.matrix[1][1] * dy;
        const xiRad = deg2rad(xi);
        const etaRad = deg2rad(eta);
        const ra0 = deg2rad(wcs.refWorld[0]);
        const dec0 = deg2rad(wcs.refWorld[1]);
        const denom = Math.cos(dec0) - etaRad * Math.sin(dec0);
        const numerator = Math.sin(dec0) + etaRad * Math.cos(dec0);
        const raRad = Math.atan2(xiRad, denom) + ra0;
        const decRad = Math.atan2(numerator, Math.sqrt(xiRad * xiRad + denom * denom));
        if (!Number.isFinite(raRad) || !Number.isFinite(decRad)) {
            return undefined;
        }
        return {
            ra: wrapDegrees(rad2deg(raRad)),
            dec: rad2deg(decRad),
        };
    }

    function formatRaDec(raDeg, decDeg) {
        return `RA ${raDeg.toFixed(5)}°  Dec ${decDeg.toFixed(5)}°`;
    }

    function deg2rad(value) {
        return value * Math.PI / 180;
    }

    function rad2deg(value) {
        return value * 180 / Math.PI;
    }

    function wrapDegrees(value) {
        let result = value % 360;
        if (result < 0) {
            result += 360;
        }
        return result;
    }

    function headerNumber(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string') {
            const parsed = Number(value.replace(/'/g, '').trim());
            return Number.isFinite(parsed) ? parsed : undefined;
        }
        return undefined;
    }

    function normalizeHeaderString(value) {
        if (typeof value === 'string') {
            return value.replace(/'/g, '').trim();
        }
        if (typeof value === 'number') {
            return value.toString();
        }
        return undefined;
    }

    const container = document.querySelector('.fits-container');
    const editor = new FitsEditor(container);

    window.addEventListener('message', async (event) => {
        const { type, body } = event.data;
        switch (type) {
            case 'init':
                await editor.init(body.value);
                return;
            case 'imageLoaded':
                editor.onImageLoaded(body.index, body.preview);
                return;
            case 'payloadError':
                editor.onPayloadError(body.index, body.error);
                return;
            default:
                break;
        }
    });

    vscode.postMessage({ type: 'ready' });
}());
