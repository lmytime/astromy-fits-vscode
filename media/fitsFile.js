(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    class RpcClient {
        constructor() {
            this.nextId = 1;
            this.pending = new Map();
            window.addEventListener('message', (event) => {
                const { type, body } = event.data || {};
                if (type !== 'response' || !body) {
                    return;
                }
                const pending = this.pending.get(body.requestId);
                if (!pending) {
                    return;
                }
                this.pending.delete(body.requestId);
                if (body.error) {
                    pending.reject(new Error(body.error));
                    return;
                }
                pending.resolve(body.result);
            });
        }

        request(method, args) {
            const requestId = this.nextId++;
            return new Promise((resolve, reject) => {
                this.pending.set(requestId, { resolve, reject });
                vscode.postMessage({
                    type: 'request',
                    requestId,
                    method,
                    args,
                });
            });
        }
    }

    class FitsEditor {
        constructor() {
            this.rpc = new RpcClient();
            this.manifest = null;
            this.config = null;
            this.selectedIndex = -1;
            this.headerCardsCache = new Map();
            this.headerCardsPromises = new Map();
            this.tableStates = new Map();
            this.imagePayloadCache = new Map();
            this.imagePayloadPromises = new Map();
            this.rowElements = [];
            this.topCollapsed = false;

            this.titleEl = document.querySelector('.title');
            this.leftContainer = document.querySelector('.left-container');
            this.rightContainer = document.querySelector('.right-container');
            this.bottomMeta = document.querySelector('.data-meta');
            this.dataPlaceholder = document.querySelector('.data-placeholder');
            this.imagePane = document.querySelector('.image-pane');
            this.tablePane = document.querySelector('.table-pane');
            this.topContainer = document.querySelector('.top-container');
            this.dividerHorizontal = document.getElementById('divider-horizontal');
            this.bottomMetaMain = document.createElement('div');
            this.bottomMetaMain.className = 'data-meta-main';
            this.bottomMetaActions = document.createElement('div');
            this.bottomMetaActions.className = 'data-meta-actions hidden';
            this.bottomMeta.innerHTML = '';
            this.bottomMeta.append(this.bottomMetaMain, this.bottomMetaActions);

            if (!window.SimpleFitsImagePreview) {
                throw new Error('SimpleFitsImagePreview is not available.');
            }

            this.imagePreview = new window.SimpleFitsImagePreview({
                root: this.imagePane,
                toolbarHost: this.bottomMetaActions,
            });

            this.titleEl.addEventListener('click', () => this.toggleTopPanel());
            this._registerSplitters();
        }

        async init(initPayload) {
            this.manifest = initPayload.manifest;
            this.config = initPayload.config;

            this._renderSummary();
            this._renderHduList();
            this._hideAllDataPanes();
            this._setHeaderPlaceholder('Select an HDU to inspect its header.');

            if (this.manifest.hdus.length > 0) {
                await this.selectHdu(0);
            }
        }

        async selectHdu(index) {
            if (!this.manifest || !this.manifest.hdus[index]) {
                return;
            }

            this.selectedIndex = index;
            this.rowElements.forEach((row) => {
                row.classList.toggle('selected', Number(row.dataset.index) === index);
            });

            await Promise.all([
                this._renderHeader(index),
                this._renderData(index),
            ]);
        }

        toggleTopPanel() {
            this.topCollapsed = !this.topCollapsed;
            this.topContainer.classList.toggle('collapsed', this.topCollapsed);
            this.dividerHorizontal.classList.toggle('collapsed', this.topCollapsed);
            this.imagePreview.resize();
        }

        _registerSplitters() {
            const dividerVertical = document.getElementById('divider-vertical');
            const dividerHorizontal = document.getElementById('divider-horizontal');

            let resizingWidth = false;
            dividerVertical.addEventListener('mousedown', () => {
                if (this.topCollapsed) {
                    return;
                }
                resizingWidth = true;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });

            document.addEventListener('mousemove', (event) => {
                if (!resizingWidth) {
                    return;
                }
                this.leftContainer.style.width = `${Math.max(220, event.clientX - 20)}px`;
                this.imagePreview.resize();
            });

            document.addEventListener('mouseup', () => {
                if (resizingWidth) {
                    document.body.style.cursor = 'default';
                    document.body.style.userSelect = 'auto';
                }
                resizingWidth = false;
            });

            let resizingHeight = false;
            dividerHorizontal.addEventListener('mousedown', () => {
                if (this.topCollapsed) {
                    return;
                }
                resizingHeight = true;
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';
            });

            document.addEventListener('mousemove', (event) => {
                if (!resizingHeight) {
                    return;
                }
                this.topContainer.style.height = `${Math.max(160, event.clientY - 50 - 4)}px`;
                this.imagePreview.resize();
            });

            document.addEventListener('mouseup', () => {
                if (resizingHeight) {
                    document.body.style.cursor = 'default';
                    document.body.style.userSelect = 'auto';
                }
                resizingHeight = false;
            });
        }

        _renderSummary() {
            const imageCount = this.manifest.hdus.filter((hdu) => hdu.kind === 'image').length;
            const tableCount = this.manifest.hdus.filter((hdu) => hdu.kind === 'table').length;
            const readableSize = humanFileSize(this.manifest.fileSize);
            this.titleEl.innerHTML = `${this.manifest.hduCount} HDU${this.manifest.hduCount !== 1 ? 's' : ''}<span id="longtitle">, ${imageCount} image${imageCount !== 1 ? 's' : ''}, ${tableCount} table${tableCount !== 1 ? 's' : ''} <span id="filesize">${readableSize}</span></span>`;
        }

        _renderHduList() {
            const table = document.createElement('table');
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');

            ['HDU', 'Extension', 'Type', 'Dimensions'].forEach((label) => {
                const th = document.createElement('th');
                th.textContent = label;
                headerRow.appendChild(th);
            });

            thead.appendChild(headerRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            this.manifest.hdus.forEach((hdu) => {
                const row = document.createElement('tr');
                row.dataset.index = String(hdu.index);

                const extensionLabel = hdu.index === 0 ? 'PRIMARY' : (hdu.extName || 'EXTENSION');
                const typeLabel = hdu.kind === 'image' ? 'image' : (hdu.kind === 'table' ? 'table' : hdu.type.toLowerCase());
                const dimensionsLabel = hdu.dimensions.length ? hdu.dimensions.join('x') : '-';

                [hdu.index, extensionLabel, typeLabel, dimensionsLabel].forEach((value) => {
                    const cell = document.createElement('td');
                    cell.textContent = String(value);
                    row.appendChild(cell);
                });

                row.addEventListener('click', () => {
                    void this.selectHdu(hdu.index);
                });
                tbody.appendChild(row);
            });

            table.appendChild(tbody);
            this.leftContainer.innerHTML = '';
            this.leftContainer.appendChild(table);
            this.rowElements = Array.from(tbody.querySelectorAll('tr'));
        }

        async _renderHeader(index) {
            this._setHeaderPlaceholder('Loading header...');
            const expectedIndex = index;

            try {
                const cards = await this._ensureHeaderCards(index);
                if (this.selectedIndex !== expectedIndex) {
                    return;
                }
                this.rightContainer.innerHTML = '';
                this._mountHeaderSearch(cards);
            } catch (error) {
                if (this.selectedIndex !== expectedIndex) {
                    return;
                }
                this._setHeaderPlaceholder(error instanceof Error ? error.message : String(error));
            }
        }

        async _renderData(index) {
            const hdu = this.manifest.hdus[index];
            const expectedIndex = index;
            this._renderMeta(hdu);
            this._hideAllDataPanes();

            try {
                if (hdu.kind === 'image') {
                    this._showImagePane('Loading image preview...');
                    await this._renderImage(hdu, expectedIndex);
                } else if (hdu.kind === 'table') {
                    this._showPlaceholder('Loading table preview...');
                    await this._renderTable(hdu, expectedIndex);
                } else {
                    this._showPlaceholder('No preview is available for this HDU.');
                }
            } catch (error) {
                if (this.selectedIndex !== expectedIndex) {
                    return;
                }
                this._showPlaceholder(error instanceof Error ? error.message : String(error));
            }
        }

        _renderMeta(hdu) {
            const extensionLabel = hdu.index === 0 ? 'PRIMARY' : (hdu.extName || 'EXTENSION');
            const dimensionsLabel = hdu.dimensions.length ? hdu.dimensions.join('x') : 'no data axes';
            const bitpixLabel = typeof hdu.bitpix === 'number' ? `BITPIX ${hdu.bitpix}` : null;
            const sizeLabel = hdu.hasData ? humanFileSize(hdu.dataByteLength) : 'no payload';
            const items = [
                `HDU ${hdu.index}`,
                extensionLabel,
                hdu.kind,
                dimensionsLabel,
                bitpixLabel,
                sizeLabel,
            ].filter(Boolean);
            this.bottomMetaMain.textContent = items.join(' • ');
            this.bottomMetaActions.classList.toggle('hidden', hdu.kind !== 'image');
        }

        _mountHeaderSearch(cards) {
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
                const filtered = term ? cards.filter((line) => line.toLowerCase().includes(term)) : cards;
                pre.innerHTML = '';
                if (!filtered.length) {
                    pre.textContent = 'No matches.';
                    return;
                }
                filtered.forEach((line, lineIndex) => {
                    appendHighlightedLine(pre, line, term);
                    if (lineIndex < filtered.length - 1) {
                        pre.appendChild(document.createTextNode('\n'));
                    }
                });
            };

            input.addEventListener('input', renderLines);
            renderLines();

            this.rightContainer.appendChild(searchBar);
            this.rightContainer.appendChild(scrollArea);
        }

        async _renderImage(hdu, expectedIndex) {
            const payload = await this._ensureImagePayload(hdu.index);
            if (this.selectedIndex !== expectedIndex) {
                return;
            }
            this.imagePreview.setImage(payload);
            this.imagePane.classList.remove('hidden');
            this.imagePreview.resize();
        }

        async _renderTable(hdu, expectedIndex) {
            const state = this._getOrCreateTableState(hdu.index);
            state.requestToken += 1;
            const requestToken = state.requestToken;
            const meta = await this._ensureTableMeta(hdu.index);
            if (this.selectedIndex !== expectedIndex || state.requestToken !== requestToken) {
                return;
            }
            state.meta = meta;

            const totalForPaging = state.filterTerm ? (state.totalMatchedRows || meta.totalRows) : meta.totalRows;
            const page = Math.max(0, Math.min(state.page, Math.max(0, Math.ceil(Math.max(1, totalForPaging) / state.pageSize) - 1)));
            const pageResult = await this.rpc.request('getTablePage', {
                hduIndex: hdu.index,
                page,
                pageSize: state.pageSize,
                searchTerm: state.filterTerm,
            });
            if (this.selectedIndex !== expectedIndex || state.requestToken !== requestToken) {
                return;
            }
            state.page = pageResult.page;
            state.rows = pageResult.rows;
            state.totalRows = pageResult.totalRows;
            state.totalMatchedRows = pageResult.totalMatchedRows;

            this._drawTable(hdu.index);
        }

        _drawTable(index) {
            const state = this.tableStates.get(index);
            if (!state || !state.meta) {
                return;
            }

            this._hideAllDataPanes();
            this.tablePane.classList.remove('hidden');

            const columns = state.meta.columns;
            const visibleTotalRows = state.filterTerm ? state.totalMatchedRows : state.totalRows;
            const pageCount = Math.max(1, Math.ceil(Math.max(1, visibleTotalRows) / state.pageSize));
            const pageRows = state.rows;
            const activeElement = document.activeElement;
            const shouldRestoreFilterFocus = Boolean(activeElement && activeElement.classList && activeElement.classList.contains('search-input') && this.tablePane.contains(activeElement));
            const filterSelectionStart = shouldRestoreFilterFocus ? activeElement.selectionStart : null;
            const filterSelectionEnd = shouldRestoreFilterFocus ? activeElement.selectionEnd : null;

            const wrapper = document.createElement('div');
            wrapper.className = 'table-preview';

            const controls = document.createElement('div');
            controls.className = 'table-controls';

            const filterInput = document.createElement('input');
            filterInput.className = 'search-input';
            filterInput.type = 'search';
            filterInput.placeholder = 'Search all rows...';
            filterInput.value = state.searchInputValue;
            filterInput.addEventListener('input', () => {
                state.searchInputValue = filterInput.value;
                state.page = 0;
                window.clearTimeout(state.searchDebounceHandle);
                state.searchDebounceHandle = window.setTimeout(() => {
                    state.filterTerm = state.searchInputValue.trim().toLowerCase();
                    void this._renderTable(this.manifest.hdus[index], index);
                }, 150);
            });

            const pageSizeSelect = document.createElement('select');
            pageSizeSelect.className = 'scale-select';
            this.config.tablePageSizes.forEach((pageSize) => {
                const option = document.createElement('option');
                option.value = String(pageSize);
                option.textContent = `${pageSize} rows`;
                if (pageSize === state.pageSize) {
                    option.selected = true;
                }
                pageSizeSelect.appendChild(option);
            });
            pageSizeSelect.addEventListener('change', async () => {
                state.pageSize = Number(pageSizeSelect.value);
                state.page = 0;
                await this._renderTable(this.manifest.hdus[index], index);
            });

            const prevButton = createActionButton('<', async () => {
                if (state.page <= 0) {
                    return;
                }
                state.page -= 1;
                await this._renderTable(this.manifest.hdus[index], index);
            });
            prevButton.disabled = state.page <= 0;

            const nextButton = createActionButton('>', async () => {
                if (state.page >= pageCount - 1) {
                    return;
                }
                state.page += 1;
                await this._renderTable(this.manifest.hdus[index], index);
            });
            nextButton.disabled = state.page >= pageCount - 1;

            const summary = document.createElement('div');
            summary.className = 'table-summary';
            const visibleStart = pageRows.length ? state.page * state.pageSize + 1 : 0;
            const visibleEnd = pageRows.length ? state.page * state.pageSize + pageRows.length : 0;
            summary.textContent = state.filterTerm
                ? `Matches ${visibleStart}-${visibleEnd} of ${state.totalMatchedRows} • Page ${state.page + 1}/${pageCount}`
                : `Rows ${visibleStart}-${visibleEnd} of ${state.totalRows} • Page ${state.page + 1}/${pageCount}`;

            controls.append(filterInput, pageSizeSelect, prevButton, nextButton, summary);
            wrapper.appendChild(controls);

            const scrollArea = document.createElement('div');
            scrollArea.className = 'table-scroll';

            const table = document.createElement('table');
            table.className = 'data-table';

            const thead = document.createElement('thead');
            const headRow = document.createElement('tr');
            columns.forEach((column) => {
                const th = document.createElement('th');
                const label = document.createElement('div');
                label.textContent = column.name;
                th.appendChild(label);

                if (column.unit) {
                    const unit = document.createElement('span');
                    unit.className = 'unit-label';
                    unit.textContent = column.unit;
                    th.appendChild(unit);
                }

                if (column.format || column.dtype) {
                    const format = document.createElement('span');
                    format.className = 'format-label';
                    format.textContent = column.format || column.dtype;
                    th.appendChild(format);
                }

                headRow.appendChild(th);
            });
            thead.appendChild(headRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            if (!pageRows.length) {
                const emptyRow = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = columns.length;
                td.className = 'no-results';
                td.textContent = state.filterTerm ? 'No matching rows found.' : 'No rows available.';
                emptyRow.appendChild(td);
                tbody.appendChild(emptyRow);
            } else {
                pageRows.forEach((row) => {
                    const tr = document.createElement('tr');
                    row.forEach((cell) => {
                        const td = document.createElement('td');
                        appendHighlightedLine(td, cell || '', state.filterTerm);
                        tr.appendChild(td);
                    });
                    tbody.appendChild(tr);
                });
            }

            table.appendChild(tbody);
            scrollArea.appendChild(table);
            wrapper.appendChild(scrollArea);

            this.tablePane.innerHTML = '';
            this.tablePane.appendChild(wrapper);
            if (shouldRestoreFilterFocus) {
                filterInput.focus();
                const selectionStart = typeof filterSelectionStart === 'number' ? filterSelectionStart : filterInput.value.length;
                const selectionEnd = typeof filterSelectionEnd === 'number' ? filterSelectionEnd : filterInput.value.length;
                filterInput.setSelectionRange(selectionStart, selectionEnd);
            }
        }

        _hideAllDataPanes() {
            this.dataPlaceholder.classList.add('hidden');
            this.imagePane.classList.add('hidden');
            this.imagePreview.clear();
            this.tablePane.classList.add('hidden');
        }

        _showPlaceholder(text) {
            this._hideAllDataPanes();
            this.dataPlaceholder.textContent = text;
            this.dataPlaceholder.classList.remove('hidden');
        }

        _showImagePane(message) {
            this.dataPlaceholder.classList.add('hidden');
            this.tablePane.classList.add('hidden');
            this.imagePane.classList.remove('hidden');
            this.imagePreview.setLoading(message);
        }

        _setHeaderPlaceholder(text) {
            this.rightContainer.innerHTML = '';
            const placeholder = document.createElement('div');
            placeholder.className = 'placeholder header-placeholder';
            placeholder.textContent = text;
            this.rightContainer.appendChild(placeholder);
        }

        _getOrCreateTableState(index) {
            let state = this.tableStates.get(index);
            if (!state) {
                state = {
                    page: 0,
                    pageSize: this.config.defaultTablePageSize,
                    filterTerm: '',
                    searchInputValue: '',
                    searchDebounceHandle: 0,
                    requestToken: 0,
                    rows: [],
                    totalRows: 0,
                    totalMatchedRows: 0,
                    meta: null,
                };
                this.tableStates.set(index, state);
            }
            return state;
        }

        async _ensureHeaderCards(index) {
            if (this.headerCardsCache.has(index)) {
                return this.headerCardsCache.get(index);
            }
            if (this.headerCardsPromises.has(index)) {
                return this.headerCardsPromises.get(index);
            }

            const promise = this.rpc.request('getHeaderCards', { hduIndex: index })
                .then((cards) => {
                    this.headerCardsCache.set(index, cards);
                    this.headerCardsPromises.delete(index);
                    return cards;
                })
                .catch((error) => {
                    this.headerCardsPromises.delete(index);
                    throw error;
                });

            this.headerCardsPromises.set(index, promise);
            return promise;
        }

        async _ensureTableMeta(index) {
            const state = this._getOrCreateTableState(index);
            if (state.meta) {
                return state.meta;
            }
            const meta = await this.rpc.request('getTableMeta', { hduIndex: index });
            state.meta = meta;
            state.totalRows = meta.totalRows;
            state.totalMatchedRows = meta.totalRows;
            return meta;
        }

        async _ensureImagePayload(index) {
            if (this.imagePayloadCache.has(index)) {
                return this.imagePayloadCache.get(index);
            }
            if (this.imagePayloadPromises.has(index)) {
                return this.imagePayloadPromises.get(index);
            }

            const promise = this.rpc.request('getImagePreview', { hduIndex: index })
                .then((result) => {
                    const payload = {
                        key: buildImageKey(index),
                        width: result.width,
                        height: result.height,
                        pixels: new Float32Array(result.pixels),
                        scaleModes: result.scaleModes,
                        defaultScaleMode: result.defaultScaleMode,
                        defaultStretch: result.defaultStretch,
                        wcs: result.wcs,
                    };
                    this._cacheImagePayload(index, payload);
                    this.imagePayloadPromises.delete(index);
                    return payload;
                })
                .catch((error) => {
                    this.imagePayloadPromises.delete(index);
                    throw error;
                });

            this.imagePayloadPromises.set(index, promise);
            return promise;
        }

        _cacheImagePayload(index, payload) {
            if (this.imagePayloadCache.has(index)) {
                this.imagePayloadCache.delete(index);
            }
            this.imagePayloadCache.set(index, payload);
            while (this.imagePayloadCache.size > 2) {
                const oldestIndex = this.imagePayloadCache.keys().next().value;
                this.imagePayloadCache.delete(oldestIndex);
            }
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

    function createActionButton(label, handler) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'action-button';
        button.textContent = label;
        button.addEventListener('click', () => {
            void handler();
        });
        return button;
    }

    function humanFileSize(bytes) {
        if (!bytes) {
            return '0 B';
        }
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        const value = bytes / Math.pow(1024, exponent);
        return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
    }

    function buildImageKey(index) {
        return `image-hdu-${index}`;
    }

    const editor = new FitsEditor();

    window.addEventListener('message', async (event) => {
        const { type, body } = event.data || {};
        if (type === 'init') {
            await editor.init(body);
        }
    });

    vscode.postMessage({ type: 'ready' });
}());
