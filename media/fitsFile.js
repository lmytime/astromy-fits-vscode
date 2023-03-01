// @ts-check

// This script is run within the webview itself
(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();



	class FitsEditor {
		constructor( /** @type {HTMLElement} */ parent) {
			this.ready = false;
			this._initElements(parent);
		}

		_initElements(/** @type {HTMLElement} */ parent) {
			parent.innerHTML = `
			<div class="container">

			</div>
			`;
		}


		/**
		 * @param {string} data
		 */
		async init(data) {
			if (data) {
				// const img = await loadImageFromData(data);
				let container = document.querySelector('.container');
				if(container) {
					// add a div in the container
					// let div = document.createElement('table');
					// container.appendChild(div);
					console.log(JSON.stringify(data, null, 4));
					container.innerHTML = "<pre>" + JSON.stringify(data, null, 4).replace(/\"/g, "",) + "</pre>";
				}
				this.ready = true;
			}
		}

	}

	const can = document.querySelector('.fits-container');
	const editor = new FitsEditor(can);

	// Handle messages from the extension
	window.addEventListener('message', async e => {
		console.log(e.data)
		const { type, body, requestId } = e.data;
		switch (type) {
			case 'init':
				{
					console.log(type, body, requestId);
					await editor.init(body.value);

					return;
				}
		}
	});


	// Signal to VS Code that the webview is initialized.
	vscode.postMessage({ type: 'ready' });
}());
