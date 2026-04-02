import * as vscode from 'vscode';
import { Disposable, disposeAll } from './dispose';
import { getNonce } from './util';
import { loadImagePreview, loadTablePreview, type FitsManifest, type HduManifest, type TablePreviewData, loadHeaderCards, scanFitsManifest } from './fitsParser';

const DEFAULT_TABLE_PAGE_SIZE = 50;
const TABLE_PAGE_SIZES = [50, 100, 200, 500];

type RequestMethod = 'getHeaderCards' | 'getImagePreview' | 'getTableMeta' | 'getTablePage';

interface RequestMessage {
	type: 'request';
	requestId: number;
	method: RequestMethod;
	args?: Record<string, any>;
}

interface InitPayload {
	manifest: FitsManifest;
	config: {
		defaultTablePageSize: number;
		tablePageSizes: number[];
	};
}

class LruCache<K, V> {
	constructor(private readonly limit: number) { }

	private readonly store = new Map<K, V>();

	public get(key: K): V | undefined {
		const value = this.store.get(key);
		if (typeof value === 'undefined') {
			return undefined;
		}
		this.store.delete(key);
		this.store.set(key, value);
		return value;
	}

	public set(key: K, value: V): void {
		if (this.store.has(key)) {
			this.store.delete(key);
		}
		this.store.set(key, value);
		if (this.store.size > this.limit) {
			const oldest = this.store.keys().next().value as K | undefined;
			if (typeof oldest !== 'undefined') {
				this.store.delete(oldest);
			}
		}
	}
}

class FitsDocument extends Disposable implements vscode.CustomDocument {
	public static async create(uri: vscode.Uri, backupId: string | undefined): Promise<FitsDocument> {
		const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
		const manifest = await scanFitsManifest(dataFile.fsPath);
		return new FitsDocument(uri, manifest);
	}

	private readonly headerCardsCache = new LruCache<number, string[]>(24);
	private readonly tablePreviewCache = new LruCache<number, TablePreviewData>(8);
	private readonly tableSearchCache = new Map<number, { term: string; matches: number[] }>();
	private readonly inflightHeaderCards = new Map<number, Promise<string[]>>();
	private readonly inflightTablePreviews = new Map<number, Promise<TablePreviewData>>();

	private constructor(
		private readonly _uri: vscode.Uri,
		private readonly _documentData: FitsManifest
	) {
		super();
	}

	public get uri(): vscode.Uri { return this._uri; }
	public get documentData(): FitsManifest { return this._documentData; }

	private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
	public readonly onDidDispose = this._onDidDispose.event;

	public async getHeaderCards(index: number): Promise<string[]> {
		const cached = this.headerCardsCache.get(index);
		if (cached) {
			return cached;
		}

		const existing = this.inflightHeaderCards.get(index);
		if (existing) {
			return existing;
		}

		const hdu = this.getHdu(index);
		const promise = loadHeaderCards(this._documentData.filePath, hdu)
			.then(cards => {
				this.headerCardsCache.set(index, cards);
				this.inflightHeaderCards.delete(index);
				return cards;
			})
			.catch(error => {
				this.inflightHeaderCards.delete(index);
				throw error;
			});

		this.inflightHeaderCards.set(index, promise);
		return promise;
	}

	public async getTableMeta(index: number): Promise<{ columns: TablePreviewData['columns']; totalRows: number }> {
		const table = await this.getTablePreview(index);
		return {
			columns: table.columns,
			totalRows: table.totalRows,
		};
	}

	public async getTablePage(index: number, page: number, pageSize: number, searchTerm: string): Promise<{
		rows: string[][];
		page: number;
		pageSize: number;
		totalRows: number;
		totalMatchedRows: number;
	}> {
		const table = await this.getTablePreview(index);
		const normalizedTerm = searchTerm.trim().toLowerCase();
		const start = Math.max(0, page * pageSize);
		const end = start + pageSize;

		if (!normalizedTerm) {
			this.tableSearchCache.delete(index);
			return {
				rows: table.rows.slice(start, end),
				page,
				pageSize,
				totalRows: table.totalRows,
				totalMatchedRows: table.totalRows,
			};
		}

		const matches = this.getMatchingTableRows(index, table, normalizedTerm);
		const rows = matches.slice(start, end).map(rowIndex => table.rows[rowIndex]);

		return {
			rows,
			page,
			pageSize,
			totalRows: table.totalRows,
			totalMatchedRows: matches.length,
		};
	}

	private getHdu(index: number): HduManifest {
		const hdu = this._documentData.hdus[index];
		if (!hdu) {
			throw new Error(`Unable to locate HDU ${index}.`);
		}
		return hdu;
	}

	private async getTablePreview(index: number): Promise<TablePreviewData> {
		const cached = this.tablePreviewCache.get(index);
		if (cached) {
			return cached;
		}
		const existing = this.inflightTablePreviews.get(index);
		if (existing) {
			return existing;
		}

		const hdu = this.getHdu(index);
		const promise = loadTablePreview(this._documentData.filePath, hdu)
			.then((table) => {
				this.tablePreviewCache.set(index, table);
				this.tableSearchCache.delete(index);
				this.inflightTablePreviews.delete(index);
				return table;
			})
			.catch((error) => {
				this.inflightTablePreviews.delete(index);
				throw error;
			});
		this.inflightTablePreviews.set(index, promise);
		return promise;
	}

	private getMatchingTableRows(index: number, table: TablePreviewData, term: string): number[] {
		const cached = this.tableSearchCache.get(index);
		let sourceIndices: number[];
		if (cached && term.startsWith(cached.term)) {
			sourceIndices = cached.matches;
		} else {
			sourceIndices = Array.from({ length: table.searchIndex.length }, (_, rowIndex) => rowIndex);
		}

		const matches: number[] = [];
		for (const rowIndex of sourceIndices) {
			if (table.searchIndex[rowIndex].includes(term)) {
				matches.push(rowIndex);
			}
		}
		this.tableSearchCache.set(index, { term, matches });
		return matches;
	}

	public dispose(): void {
		this._onDidDispose.fire();
		super.dispose();
	}
}

export class FitsEditorProvider implements vscode.CustomReadonlyEditorProvider<FitsDocument> {
	private static readonly viewType = 'astronomy.fits';
	private readonly webviews = new WebviewCollection();

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			FitsEditorProvider.viewType,
			new FitsEditorProvider(context),
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: false,
			}
		);
	}

	constructor(private readonly context: vscode.ExtensionContext) { }

	public async openCustomDocument(
		uri: vscode.Uri,
		openContext: { backupId?: string },
		_token: vscode.CancellationToken
	): Promise<FitsDocument> {
		const document = await FitsDocument.create(uri, openContext.backupId);
		const listeners: vscode.Disposable[] = [];
		document.onDidDispose(() => disposeAll(listeners));
		return document;
	}

	public async resolveCustomEditor(
		document: FitsDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		this.webviews.add(document.uri, webviewPanel);

		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri],
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		webviewPanel.webview.onDidReceiveMessage(async (message: unknown) => {
			await this.onMessage(document, webviewPanel, message);
		});
	}

	private async onMessage(document: FitsDocument, panel: vscode.WebviewPanel, message: unknown): Promise<void> {
		const payload = message as { type?: string };
		switch (payload?.type) {
			case 'ready':
				this.postMessage<InitPayload>(panel, 'init', {
					manifest: document.documentData,
					config: {
						defaultTablePageSize: DEFAULT_TABLE_PAGE_SIZE,
						tablePageSizes: TABLE_PAGE_SIZES,
					},
				});
				return;
			case 'request':
				await this.handleRequest(document, panel, message as RequestMessage);
				return;
			default:
				return;
		}
	}

	private async handleRequest(document: FitsDocument, panel: vscode.WebviewPanel, message: RequestMessage): Promise<void> {
		const requestId = message.requestId;
		try {
			let result: unknown;
			switch (message.method) {
				case 'getHeaderCards': {
					const hduIndex = readHduIndex(message.args);
					result = await document.getHeaderCards(hduIndex);
					break;
				}
				case 'getImagePreview': {
						const hduIndex = readHduIndex(message.args);
						const hdu = document.documentData.hdus[hduIndex];
						let preview;
						try {
							preview = await loadImagePreview(document.documentData.filePath, hdu);
						} catch (error) {
							throw rewriteImagePreviewError(error, hdu);
						}
						result = {
							width: preview.width,
							height: preview.height,
							pixels: toArrayBuffer(new Uint8Array(preview.pixels.buffer, preview.pixels.byteOffset, preview.pixels.byteLength)),
							scaleModes: preview.scaleModes,
							defaultScaleMode: preview.defaultScaleMode,
							defaultStretch: preview.defaultStretch,
							wcs: preview.wcs,
						};
						break;
				}
				case 'getTableMeta': {
					const hduIndex = readHduIndex(message.args);
					result = await document.getTableMeta(hduIndex);
					break;
				}
				case 'getTablePage': {
					const hduIndex = readHduIndex(message.args);
					const page = readPage(message.args);
					const pageSize = readPageSize(message.args);
					const searchTerm = typeof message.args?.searchTerm === 'string' ? message.args.searchTerm : '';
					result = await document.getTablePage(hduIndex, page, pageSize, searchTerm);
					break;
				}
				default:
					throw new Error(`Unsupported request method: ${message.method}`);
			}

			this.postMessage(panel, 'response', {
				requestId,
				result,
			});
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.postMessage(panel, 'response', {
				requestId,
				error: errorMessage,
			});
		}
	}

	private getHtmlForWebview(webview: vscode.Webview): string {
		const nonce = getNonce();
		const extensionUri = this.context.extensionUri;

		const fitsScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'fitsFile.js'));
		const imagePreviewScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'simpleFitsImagePreview.js'));
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'fitsFile.css'));

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta
					http-equiv="Content-Security-Policy"
					content="default-src 'none'; img-src ${webview.cspSource} blob: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource} blob: 'unsafe-eval' 'wasm-unsafe-eval'; connect-src ${webview.cspSource} blob: data:; worker-src ${webview.cspSource} blob:; child-src ${webview.cspSource} blob:; font-src ${webview.cspSource} data:;"
				>
				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetUri}" rel="stylesheet" />
				<link href="${styleVSCodeUri}" rel="stylesheet" />
				<link href="${styleMainUri}" rel="stylesheet" />

				<title>MyFits</title>
			</head>
			<body>
				<div class="fits-container">
					<header class="header">
						<div class="title"></div>
					</header>

					<div class="top-container">
						<div class="left-container"></div>
						<div class="divider-vertical" id="divider-vertical"></div>
						<div class="right-container">
							<div class="placeholder header-placeholder">Select an HDU to inspect its header.</div>
						</div>
					</div>

					<div class="divider-horizontal" id="divider-horizontal"></div>

						<div class="bottom-container">
							<div class="data-meta"></div>
							<div class="data-stack">
								<div class="placeholder data-placeholder">Select an HDU to preview image or table data.</div>
								<div class="image-pane hidden"></div>
								<div class="table-pane"></div>
							</div>
						</div>

							<footer>MyFilter @ AstroMy Project | Designed by&nbsp;<a href="https://lmytime.com">Mingyu Li</a></footer>
						</div>
				<script nonce="${nonce}" src="${imagePreviewScriptUri}"></script>
				<script nonce="${nonce}" src="${fitsScriptUri}"></script>
			</body>
			</html>`;
	}

	private postMessage<T>(panel: vscode.WebviewPanel, type: string, body: T): void {
		panel.webview.postMessage({ type, body });
	}
}

class WebviewCollection {
	private readonly webviews = new Set<{ resource: string; webviewPanel: vscode.WebviewPanel }>();

	public add(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel): void {
		const entry = { resource: uri.toString(), webviewPanel };
		this.webviews.add(entry);
		webviewPanel.onDidDispose(() => {
			this.webviews.delete(entry);
		});
	}
}

function readHduIndex(args: Record<string, any> | undefined): number {
	const hduIndex = args?.hduIndex;
	if (typeof hduIndex !== 'number' || !Number.isInteger(hduIndex) || hduIndex < 0) {
		throw new Error('A valid HDU index is required.');
	}
	return hduIndex;
}

function readPage(args: Record<string, any> | undefined): number {
	const page = args?.page;
	if (typeof page !== 'number' || !Number.isInteger(page) || page < 0) {
		throw new Error('A valid page is required.');
	}
	return page;
}

function readPageSize(args: Record<string, any> | undefined): number {
	const pageSize = args?.pageSize;
	if (typeof pageSize !== 'number' || !Number.isInteger(pageSize) || pageSize <= 0 || pageSize > 5000) {
		throw new Error('A valid page size is required.');
	}
	return pageSize;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function rewriteImagePreviewError(error: unknown, hdu: HduManifest): Error {
	const message = error instanceof Error ? error.message : String(error);
	if (/Array buffer allocation failed|Invalid typed array length|Cannot create a Buffer larger than/i.test(message)) {
		const dimensionsLabel = hdu.dimensions.length ? hdu.dimensions.join('x') : 'unknown size';
		const sizeLabel = humanFileSize(hdu.dataByteLength);
		return new Error(
			`This image HDU is too large for the built-in preview (${dimensionsLabel}, ${sizeLabel} raw data). ` +
			`Try another HDU or use a downsampled FITS file.`
		);
	}
	return error instanceof Error ? error : new Error(message);
}

function humanFileSize(bytes: number): string {
	if (!bytes) {
		return '0 B';
	}
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	const value = bytes / Math.pow(1024, exponent);
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
}
