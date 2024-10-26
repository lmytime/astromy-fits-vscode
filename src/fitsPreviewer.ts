import * as vscode from 'vscode';
import { Disposable, disposeAll } from './dispose';
import { getNonce } from './util';
import { PrimaryHDU } from 'fits-reader';




/**
 * Define the type of edits used in fits files.
 */

interface FitsDocumentDelegate {
	getFileData(): Promise<object>;
}

/**
 * Define the document (the data model) used for fits files.
 */
class FitsDocument extends Disposable implements vscode.CustomDocument {

	static async create(
		uri: vscode.Uri,
		backupId: string | undefined,
		delegate: FitsDocumentDelegate,
	): Promise<FitsDocument | PromiseLike<FitsDocument>> {
		// If we have a backup, read that. Otherwise read the resource from the workspace
		const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
		const fileData = await FitsDocument.readFile(dataFile);
		return new FitsDocument(uri, fileData, delegate);
	}

	private static async readFile(uri: vscode.Uri): Promise<object> {
		const fits = new PrimaryHDU(uri.fsPath);
		const hdu = await fits.load();
		const header = hdu.getHdu().getHeaderMap();
		const rawheader = hdu.getHdu().getRawHeaders();
		const headerObj = Object.fromEntries(header);
		const structure = hdu.getStructures();
		const rawheader_hdu = [rawheader]
		rawheader_hdu.push(...structure.map((s) => s.getRawHeaders()));
		// clear pure sapce-like values in the array rawheader_hdus
		rawheader_hdu.forEach((h) => {
			for (let key in h) {
				if (typeof h[key] === "string" && h[key].trim() == "") {
					delete h[key];
				}
			}
		});

		let Nhdus = 0;
		let headerh_hdu = { "hdu0": headerObj }
		if (structure) {
			Nhdus = 1 + structure.length;
			for (let i = 0; i < structure.length; i++) {
				const hh = structure[i].getHeaderMap();
				const hho = Object.fromEntries(hh);
				// add new key value pair to object
				headerh_hdu = { ...headerh_hdu, [`hdu${i + 1}`]: hho };
			}
		}

		// Get the file size of the file of vscode.Uri type
		const fileStat = await vscode.workspace.fs.stat(uri);
		const fileSize = fileStat.size;
		// make the file size human readable
		const fileSizeInKB = fileSize / 1000;
		const fileSizeInMB = fileSizeInKB / 1000;
		const fileSizeInGB = fileSizeInMB / 1000;
		const fileSizePretty = fileSizeInGB > 1 ? `${fileSizeInGB.toFixed(1)} GB` : fileSizeInMB > 1 ? `${fileSizeInMB.toFixed(1)} MB` : fileSizeInKB > 1 ? `${fileSizeInKB.toFixed(1)} KB` : `${fileSize} B`;

		return { Nhdus, headers: headerh_hdu, filesize: fileSizePretty, rawheaders: rawheader_hdu };
		// return {why: "why"};
	}

	private readonly _uri: vscode.Uri;

	private _documentData: object;

	private readonly _delegate: FitsDocumentDelegate;

	private constructor(
		uri: vscode.Uri,
		initialContent: object,
		delegate: FitsDocumentDelegate
	) {
		super();
		this._uri = uri;
		this._documentData = initialContent;
		this._delegate = delegate;
	}

	public get uri() { return this._uri; }

	public get documentData(): object { return this._documentData; }

	private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
	/**
	 * Fired when the document is disposed of.
	 */
	public readonly onDidDispose = this._onDidDispose.event;

	/**
	 * Called by VS Code when there are no more references to the document.
	 *
	 * This happens when all editors for it have been closed.
	 */
	dispose(): void {
		this._onDidDispose.fire();
		super.dispose();
	}
}



/**
 * Provider for paw draw editors.
 *
 * Paw draw editors are used for `.pawDraw` files, which are just `.png` files with a different file extension.
 *
 * This provider demonstrates:
 *
 * - How to implement a custom editor for binary files.
 * - Setting up the initial webview for a custom editor.
 * - Loading scripts and styles in a custom editor.
 * - Communication between VS Code and the custom editor.
 * - Using CustomDocuments to store information that is shared between multiple custom editors.
 * - Implementing save, undo, redo, and revert.
 * - Backing up a custom editor.
 */
export class FitsEditorProvider implements vscode.CustomReadonlyEditorProvider<FitsDocument> {

	private static newPawDrawFileId = 1;

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			FitsEditorProvider.viewType,
			new FitsEditorProvider(context),
			{
				// For this demo extension, we enable `retainContextWhenHidden` which keeps the
				// webview alive even when it is not visible. You should avoid using this setting
				// unless is absolutely required as it does have memory overhead.
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: false,
			});
	}

	private static readonly viewType = 'astronomy.fits';

	/**
	 * Tracks all known webviews
	 */
	private readonly webviews = new WebviewCollection();

	constructor(
		private readonly _context: vscode.ExtensionContext
	) { }

	//#region CustomEditorProvider
	async openCustomDocument(
		uri: vscode.Uri,
		openContext: { backupId?: string },
		_token: vscode.CancellationToken
	): Promise<FitsDocument> {
		const document: FitsDocument = await FitsDocument.create(uri, openContext.backupId, {
			getFileData: async () => {
				return {};
			}
		});

		const listeners: vscode.Disposable[] = [];

		// listeners.push(document.onDidChange(e => {
		// 	// Tell VS Code that the document has been edited by the use.
		// 	this._onDidChangeCustomDocument.fire({
		// 		document,
		// 		...e,
		// 	});
		// }));

		// listeners.push(document.onDidChangeContent(e => {
		// 	// Update all webviews when the document changes
		// 	for (const webviewPanel of this.webviews.get(document.uri)) {
		// 		this.postMessage(webviewPanel, 'update', {
		// 			edits: e.edits,
		// 			content: e.content,
		// 		});
		// 	}
		// }));

		document.onDidDispose(() => disposeAll(listeners));

		return document;
	}

	async resolveCustomEditor(
		document: FitsDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Add the webview to our internal set of active webviews
		this.webviews.add(document.uri, webviewPanel);
		// console.log(document.uri, webviewPanel);
		// console.log(FITS);


		// Setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e));

		// Wait for the webview to be properly ready before we init
		webviewPanel.webview.onDidReceiveMessage(e => {
			if (e.type === 'ready') {
				this.postMessage(webviewPanel, 'init', {
					value: document.documentData
					// document.documentData
					// value: Buffer.from(document.documentData).toString()
				});
			}
		});
	}
	//#endregion

	/**
	 * Get the static HTML used for in our editor's webviews.
	 */
	private getHtmlForWebview(webview: vscode.Webview): string {
		// Local path to script and css for the webview
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'media', 'fitsFile.js'));

		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'media', 'reset.css'));

		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'media', 'vscode.css'));

		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'media', 'fitsFile.css'));

		const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'media', 'logo.png'));

		const logoLargeUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'media', 'logo-large.png'));

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce();

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetUri}" rel="stylesheet" />
				<link href="${styleVSCodeUri}" rel="stylesheet" />
				<link href="${styleMainUri}" rel="stylesheet" />

				<title>Fits File</title>
			</head>
			<body>
				<div class="fits-container"></div>

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}


	private _requestId = 1;
	private readonly _callbacks = new Map<number, (response: any) => void>();

	private postMessageWithResponse<R = unknown>(panel: vscode.WebviewPanel, type: string, body: any): Promise<R> {
		const requestId = this._requestId++;
		const p = new Promise<R>(resolve => this._callbacks.set(requestId, resolve));
		panel.webview.postMessage({ type, requestId, body });
		return p;
	}

	private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
		panel.webview.postMessage({ type, body });
	}

	private onMessage(document: FitsDocument, message: any) {
		switch (message.type) {

			case 'response':
				{
					const callback = this._callbacks.get(message.requestId);
					callback?.(message.body);
					return;
				}
		}
	}
}



/**
 * Tracks all webviews.
 */
class WebviewCollection {

	private readonly _webviews = new Set<{
		readonly resource: string;
		readonly webviewPanel: vscode.WebviewPanel;
	}>();

	/**
	 * Get all known webviews for a given uri.
	 */
	public *get(uri: vscode.Uri): Iterable<vscode.WebviewPanel> {
		const key = uri.toString();
		for (const entry of this._webviews) {
			if (entry.resource === key) {
				yield entry.webviewPanel;
			}
		}
	}

	/**
	 * Add a new webview to the collection.
	 */
	public add(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel) {
		const entry = { resource: uri.toString(), webviewPanel };
		this._webviews.add(entry);

		webviewPanel.onDidDispose(() => {
			this._webviews.delete(entry);
		});
	}
}
