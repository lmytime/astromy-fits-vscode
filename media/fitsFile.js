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
			parent.innerHTML += `<header class="header"></header>
			<div class="top-container">
				<div class="left-container"></div>
				<div class="divider-vertical" id="divider-vertical"></div>
				<div class="right-container"></div>
			</div>
			<div class="divider-horizontal" id="divider-horizontal"></div>
			<div class="bottom-container">
			<div>
			Data (Image / Table) -- under developing
			</div>
			</div>
			<footer>
			<div> MyFits @ AstroMy Project | Designed by <a href="https://lmytime.com">Mingyu Li</a></div>
			<div> Department of Astronomy | Tsinghua University, Beijing</div>
			</footer>`;
		}


		/**
		 * @param {string} data
		 */
		async init(data) {
			if (data) {
				const leftContainer = document.querySelector(".left-container");
				const rightContainer = document.querySelector(".right-container");
				const contentContainer = document.querySelector(".content-container");
				const headerContainer = document.querySelector(".header");

				// top header
				const Nhdu = data.Nhdus
				const fileSize = data.filesize
				const fileName = data.filename
				const rawheader = data.rawheader
				console.log(data);
				// image extension number
				let Nimg = 0;
				let Ntab = 0;
				if(data.headers["hdu0"]["NAXIS"] > 0){
					Nimg += 1
				}
				for (let i = 1; i < Nhdu; i++) {
					if (data.headers[`hdu${i}`]["XTENSION"] === "'IMAGE   '") {
						Nimg += 1
					} else if (data.headers[`hdu${i}`]["XTENSION"] === "'BINTABLE'") {
						Ntab += 1
					} else if (data.headers[`hdu${i}`]["XTENSION"] === "'TABLE   '") {
						Ntab += 1
					}
				}

				// show basic information in the head
				let title = document.createElement('div');
				title.className = "title";
				title.innerHTML = `${Nhdu} HDU${Nhdu > 1 ? 's' : ''}<span id='longtitle'>, ${Nimg} image${Nimg > 1 ? 's' : ''}, ${Ntab} table${Ntab > 1 ? 's' : ''} <span id='filesize'>${fileSize}</span></span>`;
				headerContainer.appendChild(title);


				// define a function to create a table
				function createTable(parentElement, name, tableRows, colnames) {
					// Create a table element
					const table = document.createElement('table');
					table.setAttribute("name", name);
					// Create the table headers
					const thead = document.createElement('thead');
					const header = document.createElement('tr');
					for (let i = 0; i < colnames.length; i++) {
						const th = document.createElement('th');
						th.textContent = colnames[i];
						header.appendChild(th);
					}
					thead.appendChild(header);
					table.appendChild(thead);

					// Create the table rows and columns
					const tbody = document.createElement('tbody')
					for (let i = 0; i < tableRows.length; i++) {
						// Create a table row
						const row = document.createElement('tr');
						const rowData = tableRows[i]
						// Create the table columns for this row
						for (let j = 0; j < rowData.length; j++) {
							const cell = document.createElement('td');
							cell.textContent = rowData[j];
							row.appendChild(cell);
						}
						// Append the row to the table
						tbody.appendChild(row);
					}
					table.appendChild(tbody)
					// Append the table to the specified parent element
					parentElement.appendChild(table);
				}

				function GetDimesion(header, i) {
					let dim = []
					for (let j = 1; j <= header[`hdu${i}`]["NAXIS"]; j++) {
						dim.push(header[`hdu${i}`][`NAXIS${j}`])
					}
					if (dim.length === 0) {
						dim = "NULL"
						return dim
					}
					return dim.join("×")
				}

				// make a table show extension list
				const tableHeaders = ["HDU", "Extension", "Type", "Dimensions"]
				let tableRows = []
				for (let i = 0; i < Nhdu; i++) {
					if (i === 0) {
						let extType = "NULL"
						if(data.headers[`hdu${i}`]["NAXIS"] > 0){
							extType = "image"
						}
						tableRows.push([i, "PRIMARY", extType, GetDimesion(data.headers, i)])
						continue
					}
					let extName = data.headers[`hdu${i}`]["EXTNAME"]
					if (extName) {
						extName = extName.replace(/'/g, "")
					}
					switch (data.headers[`hdu${i}`]["XTENSION"]) {
						case "'IMAGE   '":
							tableRows.push([i, extName, "image", GetDimesion(data.headers, i)])
							break;
						case "'BINTABLE'":
							tableRows.push([i, extName, "table", GetDimesion(data.headers, i)])
							break;
						case "'TABLE   '":
							tableRows.push([i, extName, "table", GetDimesion(data.headers, i)])
							break;
						default:
							tableRows.push([i, extName, "unknown", GetDimesion(data.headers, i)])
					}
				}
				createTable(leftContainer, "extTable", tableRows, tableHeaders);

				// add click for each row of extension table
				const extensionTable = document.getElementsByName("extTable")[0];
				const extRows = extensionTable.getElementsByTagName("tr");
				for (let i = 1; i < extRows.length; i++) {
					let currentRow = extensionTable.rows[i];
					let createClickHandler = function (row) {
						return function () {
							row.className = "selected";
							// cancel the selected status of other rows
							for (let j = 0; j < extRows.length; j++) {
								if (j !== i) {
									extRows[j].className = "";
								}
							}
							let cell = row.getElementsByTagName("td")[0];
							let id = cell.innerHTML;
							// show header of the selected HDU
							rightContainer.innerHTML = `<pre>${data.rawheaders[id].join("<br>")}</pre>`;
						};
					};
					currentRow.onclick = createClickHandler(currentRow);
				}
			}
		}

	}

	const can = document.querySelector('.fits-container');
	const editor = new FitsEditor(can);

	// Handle messages from the extension
	window.addEventListener('message', async e => {
		const { type, body, requestId } = e.data;
		console.log(e.data);
		switch (type) {
			case 'init':
				{
					await editor.init(body.value);
					return;
				}
		}
	});


	// Signal to VS Code that the webview is initialized.
	vscode.postMessage({ type: 'ready' });

	const dividerV = document.querySelector('.divider-vertical');
	const left = document.querySelector('.left-container');
	let isResizingW = false;

	// 监听鼠标按下事件
	dividerV.addEventListener('mousedown', (e) => {
		isResizingW = true;
		document.body.style.cursor = 'col-resize';
	});

	// 监听鼠标移动事件
	document.addEventListener('mousemove', (e) => {
		if (!isResizingW) return;

		// 获取新的左侧宽度
		const newLeftWidth = e.clientX;

		// 设置左侧宽度，右侧根据 flex 自动适应
		left.style.width = `${newLeftWidth-20}px`;
	});

	// 监听鼠标释放事件
	document.addEventListener('mouseup', () => {
		isResizingW = false;
		document.body.style.cursor = 'default';
	});

	const dividerH = document.querySelector('.divider-horizontal');
	const top = document.querySelector('.top-container');
	let isResizingH = false;
	// let isResizing = false;
	// 监听鼠标按下事件
	dividerH.addEventListener('mousedown', (e) => {
		isResizingH = true;
		document.body.style.cursor = 'row-resize';
	});

	// 监听鼠标移动事件
	document.addEventListener('mousemove', (e) => {
		if (!isResizingH) return;

		// 获取新的左侧宽度
		const newTopHeight = e.clientY;

		// 设置左侧宽度，右侧根据 flex 自动适应
		top.style.height = `${newTopHeight-50}px`;
	});

	// 监听鼠标释放事件
	document.addEventListener('mouseup', () => {
		isResizingH = false;
		document.body.style.cursor = 'default';
	});
}());
