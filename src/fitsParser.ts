import { open, stat } from 'fs/promises';
import * as path from 'path';

const BLOCK_SIZE = 2880;
const CARD_SIZE = 80;
const DEFAULT_MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB
const DEFAULT_MAX_TABLE_BYTES = 8 * 1024 * 1024; // 8 MB
const DEFAULT_MAX_TABLE_ROWS = 200;
const MAX_EMBEDDED_IMAGE_VALUES = 1_000_000;

export type HduType = 'PRIMARY' | 'IMAGE' | 'BINTABLE' | 'TABLE' | 'UNKNOWN';

export interface FitsParseOptions {
	includeData?: boolean;
	maxImageBytes?: number;
	maxTableBytes?: number;
	maxTableRows?: number;
}

export interface ImagePreview {
	width: number;
	height: number;
	bitpix: number;
	values?: number[];
	min: number;
	max: number;
	truncated: boolean;
}

export interface TablePreview {
	columns: TableColumn[];
	rows: string[][];
	totalRows: number;
	truncated: boolean;
	message?: string;
}

export interface TableColumn {
	index: number;
	name: string;
	unit?: string;
	format?: string;
	typeHint: string;
	byteWidth: number;
	repeat: number;
	typeCode: string;
}

export interface DataLocation {
	offset: number;
	length: number;
	kind: 'image' | 'table' | 'other';
	isAsciiTable?: boolean;
	rowLength?: number;
	rowCount?: number;
}

export interface FitsHdu {
	index: number;
	type: HduType;
	name?: string;
	header: Record<string, any>;
	rawCards: string[];
	dimensions: number[];
	bitpix?: number;
	hasData: boolean;
	dataLocation?: DataLocation;
	imagePreview?: ImagePreview;
	tablePreview?: TablePreview;
	dataSkippedReason?: string;
}

export interface FitsParseResult {
	filePath: string;
	fileName: string;
	fileSize: number;
	hdus: FitsHdu[];
}

interface HeaderBlock {
	header: Record<string, any>;
	rawCards: string[];
	byteLength: number;
}

export async function parseFitsFile(filePath: string, options?: FitsParseOptions): Promise<FitsParseResult> {
	const stats = await stat(filePath);
	const fileSize = stats.size;
	const fileHandle = await open(filePath, 'r');
	const maxImageBytes = options?.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
	const maxTableBytes = options?.maxTableBytes ?? DEFAULT_MAX_TABLE_BYTES;
	const maxTableRows = options?.maxTableRows ?? DEFAULT_MAX_TABLE_ROWS;
	const includeData = options?.includeData ?? true;

	const hdus: FitsHdu[] = [];
	let offset = 0;
	let index = 0;

	try {
		while (offset < fileSize) {
			const headerBlock = await readHeaderBlock(fileHandle, fileSize, offset);
			if (!headerBlock) {
				break;
			}

			const { header, rawCards, byteLength } = headerBlock;
			offset += byteLength;

			const type = determineHduType(header, index);
			const name = typeof header['EXTNAME'] === 'string' ? header['EXTNAME'].trim() : undefined;
			const dimensions = readDimensions(header);
			const bitpix = typeof header['BITPIX'] === 'number' ? header['BITPIX'] : undefined;
			const dataBytes = calculateDataBytes(header, type, dimensions, bitpix);
			const paddedDataBytes = padToBlock(dataBytes);
			const dataStart = offset;

			let imagePreview: ImagePreview | undefined;
			let tablePreview: TablePreview | undefined;
			let dataSkippedReason: string | undefined;
			const hasData = dataBytes > 0;
			const isImageHdu = isImageLike(type, index, dimensions);
			const isTableHdu = isTableLike(type);
			const tableRowLength = typeof header['NAXIS1'] === 'number' ? header['NAXIS1'] : 0;
			const tableRowCount = typeof header['NAXIS2'] === 'number' ? header['NAXIS2'] : 0;

				if (hasData && includeData) {
					if (isImageHdu && typeof bitpix === 'number' && bitpix !== 0) {
						if (dataBytes <= maxImageBytes) {
							imagePreview = await readImagePreview(fileHandle, dataStart, dimensions, bitpix, dataBytes);
							if (imagePreview && imagePreview.values && imagePreview.values.length > MAX_EMBEDDED_IMAGE_VALUES) {
								imagePreview.values = undefined;
								if (!dataSkippedReason) {
									dataSkippedReason = 'Image data is large; click Load image anyway.';
								}
							}
						} else {
							dataSkippedReason = `Image data (${humanFileSize(dataBytes)}) exceeds preview limit (${humanFileSize(maxImageBytes)}).`;
						}
					} else if (isTableHdu) {
					if (dataBytes <= maxTableBytes) {
						tablePreview = await readTablePreview(fileHandle, dataStart, header, maxTableRows, dataBytes, type === 'TABLE');
					} else {
						dataSkippedReason = `Table data (${humanFileSize(dataBytes)}) exceeds preview limit (${humanFileSize(maxTableBytes)}).`;
					}
				}
			} else if (hasData && !includeData) {
				dataSkippedReason = 'Data loading disabled.';
			}

			offset += paddedDataBytes;

			const dataKind: DataLocation['kind'] = isImageHdu ? 'image' : (isTableHdu ? 'table' : 'other');
			const dataLocation = hasData ? {
				offset: dataStart,
				length: dataBytes,
				kind: dataKind,
				isAsciiTable: isTableHdu ? type === 'TABLE' : undefined,
				rowLength: isTableHdu ? tableRowLength : undefined,
				rowCount: isTableHdu ? tableRowCount : undefined,
			} : undefined;

			hdus.push({
				index,
				type,
				name,
				header,
				rawCards,
				dimensions,
				bitpix,
				hasData,
				dataLocation,
				imagePreview,
				tablePreview,
				dataSkippedReason
			});

			index += 1;

			if (offset >= fileSize) {
				break;
			}
		}
	} finally {
		await fileHandle.close();
	}

	return {
		filePath,
		fileName: path.basename(filePath),
		fileSize,
		hdus
	};
}

export async function loadImagePreviewAtOffset(filePath: string, hdu: FitsHdu): Promise<ImagePreview | undefined> {
	if (!hdu.dataLocation || hdu.dataLocation.kind !== 'image' || typeof hdu.bitpix !== 'number' || hdu.bitpix === 0) {
		return undefined;
	}

	const fileHandle = await open(filePath, 'r');
	try {
		return await readImagePreview(fileHandle, hdu.dataLocation.offset, hdu.dimensions, hdu.bitpix, hdu.dataLocation.length);
	} finally {
		await fileHandle.close();
	}
}

async function readHeaderBlock(
	fileHandle: import('fs/promises').FileHandle,
	fileSize: number,
	startOffset: number
): Promise<HeaderBlock | undefined> {
	if (startOffset >= fileSize) {
		return undefined;
	}

	let offset = startOffset;
	const rawCards: string[] = [];
	const header: Record<string, any> = {};

	while (true) {
		const buffer = Buffer.alloc(BLOCK_SIZE);
		const { bytesRead } = await fileHandle.read(buffer, 0, BLOCK_SIZE, offset);
		if (bytesRead === 0) {
			break;
		}
		offset += bytesRead;

		for (let i = 0; i < bytesRead; i += CARD_SIZE) {
			const card = buffer.toString('ascii', i, i + CARD_SIZE);
			const trimmedCard = card.replace(/\s+$/, '');
			rawCards.push(trimmedCard);

			const keyword = card.substring(0, 8).trim();
			if (!keyword) {
				continue;
			}

			if (keyword === 'END') {
				const consumed = offset - startOffset;
				return { header, rawCards, byteLength: consumed };
			}

			if (keyword === 'COMMENT' || keyword === 'HISTORY') {
				const value = card.substring(8).trim();
				if (!header[keyword]) {
					header[keyword] = [];
				}
				if (Array.isArray(header[keyword])) {
					header[keyword].push(value);
				}
				continue;
			}

			const eqIndex = card.indexOf('=');
			if (eqIndex === -1) {
				continue;
			}
			const valuePortion = card.substring(eqIndex + 1);
			const slashIndex = valuePortion.indexOf('/');
			const rawValue = (slashIndex >= 0 ? valuePortion.substring(0, slashIndex) : valuePortion).trim();
			const parsedValue = parseFitsValue(rawValue);
			header[keyword] = parsedValue;
		}

		if (bytesRead < BLOCK_SIZE) {
			break;
		}
	}

	return undefined;
}

function parseFitsValue(rawValue: string): any {
	if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
		const unquoted = rawValue.slice(1, -1);
		return unquoted.replace(/''/g, "'");
	}

	if (rawValue === 'T' || rawValue === 'F') {
		return rawValue === 'T';
	}

	if (/^[+-]?\d+$/.test(rawValue)) {
		return Number.parseInt(rawValue, 10);
	}

	if (/^[+-]?\d*\.\d+([Ee][+-]?\d+)?$/.test(rawValue) || /^[+-]?\d+([Ee][+-]?\d+)$/.test(rawValue)) {
		return Number.parseFloat(rawValue);
	}

	return rawValue.trim();
}

function determineHduType(header: Record<string, any>, index: number): HduType {
	if (index === 0) {
		return 'PRIMARY';
	}

	const extension = typeof header['XTENSION'] === 'string'
		? header['XTENSION'].replace(/'/g, '').trim().toUpperCase()
		: undefined;

	switch (extension) {
		case 'IMAGE':
			return 'IMAGE';
		case 'BINTABLE':
			return 'BINTABLE';
		case 'TABLE':
			return 'TABLE';
		default:
			return 'UNKNOWN';
	}
}

function isImageLike(type: HduType, index: number, dimensions: number[]): boolean {
	if (index === 0 && dimensions.length > 0) {
		return true;
	}
	return type === 'IMAGE';
}

function isTableLike(type: HduType): boolean {
	return type === 'BINTABLE' || type === 'TABLE';
}

function readDimensions(header: Record<string, any>): number[] {
	const nAxis = typeof header['NAXIS'] === 'number' ? header['NAXIS'] : 0;
	const dims: number[] = [];
	for (let i = 1; i <= nAxis; i++) {
		const key = `NAXIS${i}`;
		const value = typeof header[key] === 'number' ? header[key] : 0;
		dims.push(value);
	}
	return dims;
}

function calculateDataBytes(header: Record<string, any>, type: HduType, dimensions: number[], bitpix?: number): number {
	if (type === 'BINTABLE' || type === 'TABLE') {
		const rowLength = typeof header['NAXIS1'] === 'number' ? header['NAXIS1'] : 0;
		const rows = typeof header['NAXIS2'] === 'number' ? header['NAXIS2'] : 0;
		const gcount = typeof header['GCOUNT'] === 'number' ? header['GCOUNT'] : 1;
		const pcount = typeof header['PCOUNT'] === 'number' ? header['PCOUNT'] : 0;
		return rowLength * rows * Math.max(1, gcount) + Math.max(0, pcount);
	}

	if (!bitpix || dimensions.length === 0) {
		return 0;
	}

	const bytesPerPixel = Math.abs(bitpix) / 8;
	const totalPixels = dimensions.reduce((acc, dim) => acc * Math.max(1, dim), 1);
	return totalPixels * bytesPerPixel;
}

function padToBlock(size: number): number {
	if (size === 0) {
		return 0;
	}
	const remainder = size % BLOCK_SIZE;
	return remainder === 0 ? size : size + (BLOCK_SIZE - remainder);
}

async function readImagePreview(
	fileHandle: import('fs/promises').FileHandle,
	dataStart: number,
	dimensions: number[],
	bitpix: number,
	dataBytes: number
): Promise<ImagePreview | undefined> {
	const width = dimensions[0] ?? 1;
	const height = dimensions[1] ?? 1;
	const planePixels = width * height;
	if (planePixels === 0) {
		return undefined;
	}

	const bytesPerPixel = Math.abs(bitpix) / 8;
	const planeBytes = planePixels * bytesPerPixel;
	if (planeBytes === 0) {
		return undefined;
	}

	const buffer = Buffer.alloc(Math.min(planeBytes, dataBytes));
	await fileHandle.read(buffer, 0, buffer.length, dataStart);

	const values = readNumericValues(buffer, bitpix);
	const { min, max } = getValueBounds(values);

	return {
		width,
		height,
		bitpix,
		values,
		min,
		max,
		truncated: dataBytes > buffer.length
	};
}

function readNumericValues(buffer: Buffer, bitpix: number): number[] {
	const values: number[] = [];
	const bytesPerValue = Math.abs(bitpix) / 8;
	for (let offset = 0; offset < buffer.length; offset += bytesPerValue) {
		switch (bitpix) {
			case 8:
				values.push(buffer.readUInt8(offset));
				break;
			case 16:
				values.push(buffer.readInt16BE(offset));
				break;
			case 32:
				values.push(buffer.readInt32BE(offset));
				break;
			case 64:
				values.push(Number(buffer.readBigInt64BE(offset)));
				break;
			case -32:
				values.push(buffer.readFloatBE(offset));
				break;
			case -64:
				values.push(buffer.readDoubleBE(offset));
				break;
			default:
				values.push(0);
				break;
		}
	}
	return values;
}

function getValueBounds(values: number[]): { min: number; max: number } {
	let min = Infinity;
	let max = -Infinity;
	for (const value of values) {
		if (value < min) {
			min = value;
		}
		if (value > max) {
			max = value;
		}
	}
	if (!Number.isFinite(min)) {
		min = 0;
	}
	if (!Number.isFinite(max)) {
		max = min;
	}
	if (min === max) {
		max = min + 1;
	}
	return { min, max };
}

async function readTablePreview(
	fileHandle: import('fs/promises').FileHandle,
	dataStart: number,
	header: Record<string, any>,
	maxRows: number,
	dataBytes: number,
	isAsciiTable: boolean
): Promise<TablePreview | undefined> {
	const rowLength = typeof header['NAXIS1'] === 'number' ? header['NAXIS1'] : 0;
	const rowCount = typeof header['NAXIS2'] === 'number' ? header['NAXIS2'] : 0;
	const tfFields = typeof header['TFIELDS'] === 'number' ? header['TFIELDS'] : 0;

	if (rowLength === 0 || rowCount === 0 || tfFields === 0) {
		return undefined;
	}

	const columns: TableColumn[] = [];
	for (let i = 1; i <= tfFields; i++) {
		const nameRaw = header[`TTYPE${i}`];
		const name = typeof nameRaw === 'string' ? nameRaw.replace(/'/g, '').trim() : `COL${i}`;
		const unitRaw = header[`TUNIT${i}`];
		const unit = typeof unitRaw === 'string' ? unitRaw.replace(/'/g, '').trim() : undefined;
		const formatRaw = header[`TFORM${i}`];
		const format = typeof formatRaw === 'string' ? formatRaw.replace(/'/g, '').trim() : undefined;
		const layout = resolveColumnLayout(format, isAsciiTable);

		columns.push({
			index: i,
			name,
			unit,
			format,
			typeHint: format ?? 'A',
			byteWidth: layout.byteWidth,
			repeat: layout.repeat,
			typeCode: layout.typeCode
		});
	}

	const rowsRequested = Math.max(1, Math.min(rowCount, maxRows));
	const maxRowsByBytes = rowLength === 0 ? 0 : Math.floor(dataBytes / rowLength);
	const rowsToRead = Math.min(rowsRequested, maxRowsByBytes);

	if (rowsToRead <= 0) {
		return {
			columns,
			rows: [],
			totalRows: rowCount,
			truncated: true,
			message: 'No complete table rows available for preview.'
		};
	}

	const previewBytes = rowsToRead * rowLength;
	const buffer = Buffer.alloc(previewBytes);
	await fileHandle.read(buffer, 0, previewBytes, dataStart);

	const rows: string[][] = [];
	for (let rowIndex = 0; rowIndex < rowsToRead; rowIndex++) {
		const rowStart = rowIndex * rowLength;
		if (rowStart >= buffer.length) {
			break;
		}
		const row = parseTableRow(buffer.slice(rowStart, rowStart + rowLength), columns, isAsciiTable);
		rows.push(row);
	}

	return {
		columns,
		rows,
		totalRows: rowCount,
		truncated: rowsToRead < rowCount,
		message: rowsToRead < rowCount ? `Showing first ${rowsToRead} of ${rowCount} rows.` : undefined
	};
}

function resolveColumnLayout(format: string | undefined, isAsciiTable: boolean): { byteWidth: number; repeat: number; typeCode: string } {
	if (!format) {
		return { byteWidth: 1, repeat: 1, typeCode: 'A' };
	}

	const cleaned = format.replace(/'/g, '').trim().toUpperCase();
	if (isAsciiTable) {
		const digits = cleaned.match(/\d+/);
		const width = digits ? Number.parseInt(digits[0], 10) : 1;
		const typeMatch = cleaned.match(/[A-Z]/);
		const typeCode = typeMatch ? typeMatch[0] : 'A';
		return {
			byteWidth: Math.max(1, width),
			repeat: 1,
			typeCode
		};
	}

	const match = cleaned.match(/^(\d+)?([A-Z])/);
	const repeat = match?.[1] ? Number.parseInt(match[1], 10) : 1;
	const typeCode = match?.[2] ?? 'A';
	const byteWidth = Math.max(1, repeat * elementByteSize(typeCode));
	return { byteWidth, repeat, typeCode };
}

function parseTableRow(buffer: Buffer, columns: TableColumn[], isAsciiTable: boolean): string[] {
	const values: string[] = [];
	let offset = 0;

	for (const column of columns) {
		const byteWidth = column.byteWidth || 1;
		const slice = buffer.slice(offset, offset + byteWidth);
		offset += byteWidth;

		if (slice.length === 0) {
			values.push('');
			continue;
		}

		if (isAsciiTable) {
			values.push(slice.toString('ascii').trim());
			continue;
		}

		if (column.typeCode === 'A') {
			values.push(slice.toString('ascii').trim());
			continue;
		}

		const parsed = parseBinaryValue(slice, column.typeCode, column.repeat || 1);
		values.push(parsed);
	}

	return values;
}

function elementByteSize(typeCode: string): number {
	switch (typeCode) {
		case 'L':
		case 'B':
			return 1;
		case 'I':
			return 2;
		case 'J':
		case 'E':
			return 4;
		case 'K':
		case 'D':
			return 8;
		default:
			return 1;
	}
}

function parseBinaryValue(slice: Buffer, typeCode: string, repeat: number): string {
	const results: string[] = [];
	for (let i = 0; i < repeat; i++) {
		const offset = i * elementByteSize(typeCode);
		switch (typeCode) {
			case 'L':
				results.push(slice[offset] === 84 ? 'T' : 'F');
				break;
			case 'B':
				results.push(slice.readUInt8(offset).toString());
				break;
			case 'I':
				results.push(slice.readInt16BE(offset).toString());
				break;
			case 'J':
				results.push(slice.readInt32BE(offset).toString());
				break;
			case 'K':
				results.push(Number(slice.readBigInt64BE(offset)).toString());
				break;
			case 'E':
				results.push(slice.readFloatBE(offset).toFixed(4));
				break;
			case 'D':
				results.push(slice.readDoubleBE(offset).toFixed(4));
				break;
			default:
				results.push('[unsupported]');
		}
	}

	return repeat === 1 ? results[0] : `[${results.join(', ')}]`;
}

function humanFileSize(bytes: number): string {
	if (bytes === 0) {
		return '0 B';
	}
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	const value = bytes / Math.pow(1024, exponent);
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
}
