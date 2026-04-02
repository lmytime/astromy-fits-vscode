import { open, stat } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import * as path from 'path';

const BLOCK_SIZE = 2880;
const CARD_SIZE = 80;

export type HduType = 'PRIMARY' | 'IMAGE' | 'BINTABLE' | 'TABLE' | 'UNKNOWN';
export type HduKind = 'image' | 'table' | 'other';

export interface HduManifest {
	index: number;
	type: HduType;
	kind: HduKind;
	extName?: string;
	dimensions: number[];
	bitpix?: number;
	hasData: boolean;
	headerOffset: number;
	headerByteLength: number;
	dataOffset: number;
	dataByteLength: number;
	dataByteLengthPadded: number;
	isAsciiTable: boolean;
	tableRowLength?: number;
	tableRowCount?: number;
}

export interface FitsManifest {
	filePath: string;
	fileName: string;
	fileSize: number;
	hduCount: number;
	hdus: HduManifest[];
}

export interface ImagePreviewData {
	width: number;
	height: number;
	pixels: Float32Array;
	scaleModes: Record<string, [number, number]>;
	defaultScaleMode: 'zscale';
	defaultStretch: 'linear';
	wcs: LinearCelestialWcs | null;
}

export interface LinearCelestialWcs {
	frame: 'ICRS';
	unit: 'deg';
	projection: 'TAN' | 'LINEAR';
	crpix: [number, number];
	crval: [number, number];
	cd: [[number, number], [number, number]];
}

export interface TableColumn {
	index: number;
	name: string;
	unit: string;
	format: string;
	dim: string;
	dtype: string;
	byteWidth: number;
	repeat: number;
	typeCode: string;
}

export interface TablePreviewData {
	columns: TableColumn[];
	rows: string[][];
	searchIndex: string[];
	totalRows: number;
}

interface HeaderBlock {
	header: Record<string, any>;
	rawCards: string[];
	byteLength: number;
}

export async function scanFitsManifest(filePath: string): Promise<FitsManifest> {
	const stats = await stat(filePath);
	const fileSize = stats.size;
	const fileHandle = await open(filePath, 'r');

	const hdus: HduManifest[] = [];
	let offset = 0;
	let index = 0;

	try {
		while (offset < fileSize) {
			const headerOffset = offset;
			const headerBlock = await readHeaderBlock(fileHandle, fileSize, headerOffset);
			if (!headerBlock) {
				break;
			}

			const { header, byteLength } = headerBlock;
			offset += byteLength;

			const type = determineHduType(header, index);
			const kind = determineHduKind(header, type, index);
			const extName = readExtName(header);
			const dimensions = readDimensions(header);
			const bitpix = typeof header.BITPIX === 'number' ? header.BITPIX : undefined;
			const dataByteLength = calculateDataBytes(header, type, dimensions, bitpix);
			const dataByteLengthPadded = padToBlock(dataByteLength);
			const dataOffset = offset;
			const hasData = dataByteLength > 0;
			const isAsciiTable = type === 'TABLE';
			const tableRowLength = typeof header.NAXIS1 === 'number' ? header.NAXIS1 : undefined;
			const tableRowCount = typeof header.NAXIS2 === 'number' ? header.NAXIS2 : undefined;

			hdus.push({
				index,
				type,
				kind,
				extName,
				dimensions,
				bitpix,
				hasData,
				headerOffset,
				headerByteLength: byteLength,
				dataOffset,
				dataByteLength,
				dataByteLengthPadded,
				isAsciiTable,
				tableRowLength,
				tableRowCount,
			});

			offset += dataByteLengthPadded;
			index += 1;
		}
	} finally {
		await fileHandle.close();
	}

	return {
		filePath,
		fileName: path.basename(filePath),
		fileSize,
		hduCount: hdus.length,
		hdus,
	};
}

export async function loadHeaderCards(filePath: string, hdu: HduManifest): Promise<string[]> {
	const fileStats = await stat(filePath);
	const fileHandle = await open(filePath, 'r');
	try {
		const headerBlock = await readHeaderBlock(fileHandle, fileStats.size, hdu.headerOffset);
		if (!headerBlock) {
			throw new Error(`Unable to read header for HDU ${hdu.index}.`);
		}
		return headerBlock.rawCards;
	} finally {
		await fileHandle.close();
	}
}

export async function loadImagePreview(filePath: string, hdu: HduManifest): Promise<ImagePreviewData> {
	if (hdu.kind !== 'image') {
		throw new Error(`HDU ${hdu.index} does not contain image data.`);
	}
	if (typeof hdu.bitpix !== 'number') {
		throw new Error(`HDU ${hdu.index} is missing BITPIX.`);
	}

	const width = Math.max(1, hdu.dimensions[0] ?? 0);
	const height = Math.max(1, hdu.dimensions[1] ?? 1);
	const planePixels = width * height;
	const bytesPerPixel = Math.abs(hdu.bitpix) / 8;
	const planeByteLength = planePixels * bytesPerPixel;

	const fileStats = await stat(filePath);
	const fileHandle = await open(filePath, 'r');
	try {
		const headerBlock = await readHeaderBlock(fileHandle, fileStats.size, hdu.headerOffset);
		if (!headerBlock) {
			throw new Error(`Unable to read header for HDU ${hdu.index}.`);
		}

		const planeBytes = await readBytes(fileHandle, hdu.dataOffset, planeByteLength);
		if (planeBytes.byteLength < planeByteLength) {
			throw new Error(`Unexpected end of file while reading HDU ${hdu.index} image data.`);
		}

			const pixels = decodeImagePixels(planeBytes, hdu.bitpix, headerBlock.header, planePixels);
			return {
				width,
				height,
				pixels,
				scaleModes: computeScaleModes(pixels),
				defaultScaleMode: 'zscale',
				defaultStretch: 'linear',
				wcs: extractCelestialWcs(headerBlock.header),
			};
		} finally {
			await fileHandle.close();
		}
	}

export async function loadTablePreview(filePath: string, hdu: HduManifest): Promise<TablePreviewData> {
	if (hdu.kind !== 'table') {
		throw new Error(`HDU ${hdu.index} does not contain table data.`);
	}

	const fileStats = await stat(filePath);
	const fileHandle = await open(filePath, 'r');
	try {
		const headerBlock = await readHeaderBlock(fileHandle, fileStats.size, hdu.headerOffset);
		if (!headerBlock) {
			throw new Error(`Unable to read header for HDU ${hdu.index}.`);
		}

		const header = headerBlock.header;
		const rowLength = typeof header.NAXIS1 === 'number' ? header.NAXIS1 : 0;
		const rowCount = typeof header.NAXIS2 === 'number' ? header.NAXIS2 : 0;
		const fieldCount = typeof header.TFIELDS === 'number' ? header.TFIELDS : 0;
		if (rowLength <= 0 || rowCount <= 0 || fieldCount <= 0) {
			return {
				columns: [],
				rows: [],
				searchIndex: [],
				totalRows: rowCount,
			};
		}

		const columns = buildTableColumns(header, hdu.isAsciiTable);
		const tableBytes = await readBytes(fileHandle, hdu.dataOffset, hdu.dataByteLength);
		if (tableBytes.byteLength < hdu.dataByteLength) {
			throw new Error(`Unexpected end of file while reading HDU ${hdu.index} table data.`);
		}

		const rows: string[][] = [];
		const searchIndex: string[] = [];
		for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
			const rowStart = rowIndex * rowLength;
			const row = parseTableRow(tableBytes.subarray(rowStart, rowStart + rowLength), columns, hdu.isAsciiTable);
			rows.push(row);
			searchIndex.push(row.join(' \u241f ').toLowerCase());
		}

		return {
			columns,
			rows,
			searchIndex,
			totalRows: rowCount,
		};
	} finally {
		await fileHandle.close();
	}
}

async function readHeaderBlock(
	fileHandle: FileHandle,
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
				return {
					header,
					rawCards,
					byteLength: offset - startOffset,
				};
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
			header[keyword] = parseFitsValue(rawValue);
		}

		if (bytesRead < BLOCK_SIZE) {
			break;
		}
	}

	return undefined;
}

async function readBytes(fileHandle: FileHandle, start: number, length: number): Promise<Buffer> {
	const buffer = Buffer.alloc(length);
	let bytesRemaining = length;
	let offset = start;
	let position = 0;

	while (bytesRemaining > 0) {
		const { bytesRead } = await fileHandle.read(buffer, position, bytesRemaining, offset);
		if (bytesRead === 0) {
			break;
		}
		bytesRemaining -= bytesRead;
		offset += bytesRead;
		position += bytesRead;
	}

	return bytesRemaining === 0 ? buffer : buffer.slice(0, position);
}

function parseFitsValue(rawValue: string): any {
	if (rawValue.startsWith('\'') && rawValue.endsWith('\'')) {
		return rawValue.slice(1, -1).replace(/''/g, '\'');
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

	const extension = typeof header.XTENSION === 'string'
		? header.XTENSION.replace(/'/g, '').trim().toUpperCase()
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

function determineHduKind(header: Record<string, any>, type: HduType, index: number): HduKind {
	const dimensions = readDimensions(header);
	if (index === 0 && dimensions.length > 0) {
		return 'image';
	}
	if (type === 'IMAGE') {
		return 'image';
	}
	if (type === 'BINTABLE' || type === 'TABLE') {
		return 'table';
	}
	return 'other';
}

function readExtName(header: Record<string, any>): string | undefined {
	return typeof header.EXTNAME === 'string'
		? header.EXTNAME.replace(/'/g, '').trim()
		: undefined;
}

function readDimensions(header: Record<string, any>): number[] {
	const nAxis = typeof header.NAXIS === 'number' ? header.NAXIS : 0;
	const dims: number[] = [];
	for (let i = 1; i <= nAxis; i++) {
		const value = typeof header[`NAXIS${i}`] === 'number' ? header[`NAXIS${i}`] : 0;
		dims.push(value);
	}
	return dims;
}

function calculateDataBytes(header: Record<string, any>, type: HduType, dimensions: number[], bitpix?: number): number {
	if (type === 'BINTABLE' || type === 'TABLE') {
		const rowLength = typeof header.NAXIS1 === 'number' ? header.NAXIS1 : 0;
		const rows = typeof header.NAXIS2 === 'number' ? header.NAXIS2 : 0;
		const gcount = typeof header.GCOUNT === 'number' ? header.GCOUNT : 1;
		const pcount = typeof header.PCOUNT === 'number' ? header.PCOUNT : 0;
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

function decodeImagePixels(
	bytes: Buffer,
	bitpix: number,
	header: Record<string, any>,
	pixelCount: number
): Float32Array {
	const pixels = new Float32Array(pixelCount);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const bscale = typeof header.BSCALE === 'number' ? header.BSCALE : 1;
	const bzero = typeof header.BZERO === 'number' ? header.BZERO : 0;
	const blank = typeof header.BLANK === 'number' ? header.BLANK : undefined;
	const applyScaling = bscale !== 1 || bzero !== 0;

	for (let index = 0; index < pixelCount; index += 1) {
		const offset = index * Math.abs(bitpix / 8);
		let value: number;
		switch (bitpix) {
			case 8:
				value = view.getUint8(offset);
				break;
			case 16:
				value = view.getInt16(offset, false);
				break;
			case 32:
				value = view.getInt32(offset, false);
				break;
			case 64:
				value = Number(view.getBigInt64(offset, false));
				break;
			case -32:
				value = view.getFloat32(offset, false);
				break;
			case -64:
				value = view.getFloat64(offset, false);
				break;
			default:
				throw new Error(`Unsupported BITPIX ${bitpix} for image preview.`);
		}

		if (typeof blank === 'number' && value === blank) {
			pixels[index] = Number.NaN;
			continue;
		}

		pixels[index] = applyScaling ? value * bscale + bzero : value;
	}

	return pixels;
}

function buildTableColumns(header: Record<string, any>, isAsciiTable: boolean): TableColumn[] {
	const fieldCount = typeof header.TFIELDS === 'number' ? header.TFIELDS : 0;
	const columns: TableColumn[] = [];
	for (let index = 1; index <= fieldCount; index += 1) {
		const nameRaw = header[`TTYPE${index}`];
		const unitRaw = header[`TUNIT${index}`];
		const formatRaw = header[`TFORM${index}`];
		const dimRaw = header[`TDIM${index}`];
		const format = typeof formatRaw === 'string' ? formatRaw.replace(/'/g, '').trim() : '';
		const layout = resolveColumnLayout(format, isAsciiTable);
		columns.push({
			index,
			name: typeof nameRaw === 'string' ? nameRaw.replace(/'/g, '').trim() : `COL${index}`,
			unit: typeof unitRaw === 'string' ? unitRaw.replace(/'/g, '').trim() : '',
			format,
			dim: typeof dimRaw === 'string' ? dimRaw.replace(/'/g, '').trim() : '',
			dtype: inferColumnDtype(layout.typeCode, layout.repeat),
			byteWidth: layout.byteWidth,
			repeat: layout.repeat,
			typeCode: layout.typeCode,
		});
	}
	return columns;
}

function resolveColumnLayout(format: string, isAsciiTable: boolean): { byteWidth: number; repeat: number; typeCode: string } {
	const cleaned = (format || 'A').toUpperCase();
	if (isAsciiTable) {
		const digits = cleaned.match(/\d+/);
		const width = digits ? Number.parseInt(digits[0], 10) : 1;
		const typeMatch = cleaned.match(/[A-Z]/);
		const typeCode = typeMatch ? typeMatch[0] : 'A';
		return {
			byteWidth: Math.max(1, width),
			repeat: 1,
			typeCode,
		};
	}

	const match = cleaned.match(/^(\d+)?([A-Z])/);
	const repeat = match?.[1] ? Number.parseInt(match[1], 10) : 1;
	const typeCode = match?.[2] ?? 'A';
	return {
		byteWidth: Math.max(1, repeat * elementByteSize(typeCode)),
		repeat,
		typeCode,
	};
}

function inferColumnDtype(typeCode: string, repeat: number): string {
	const baseType = (() => {
		switch (typeCode) {
			case 'L': return 'logical';
			case 'A': return 'string';
			case 'B': return 'uint8';
			case 'I': return 'int16';
			case 'J': return 'int32';
			case 'K': return 'int64';
			case 'E': return 'float32';
			case 'D': return 'float64';
			default: return 'unknown';
		}
	})();
	return repeat > 1 && typeCode !== 'A' ? `${baseType}[${repeat}]` : baseType;
}

function elementByteSize(typeCode: string): number {
	switch (typeCode) {
		case 'L':
		case 'A':
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

function parseTableRow(rowBuffer: Uint8Array, columns: TableColumn[], isAsciiTable: boolean): string[] {
	const buffer = Buffer.from(rowBuffer.buffer, rowBuffer.byteOffset, rowBuffer.byteLength);
	const values: string[] = [];
	let offset = 0;
	for (const column of columns) {
		const slice = buffer.subarray(offset, offset + column.byteWidth);
		offset += column.byteWidth;
		if (isAsciiTable || column.typeCode === 'A') {
			values.push(slice.toString('ascii').trim());
			continue;
		}
		values.push(parseBinaryValue(slice, column.typeCode, column.repeat));
	}
	return values;
}

function parseBinaryValue(slice: Buffer, typeCode: string, repeat: number): string {
	const results: string[] = [];
	for (let index = 0; index < repeat; index += 1) {
		const offset = index * elementByteSize(typeCode);
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
				results.push(formatFloat(slice.readFloatBE(offset)));
				break;
			case 'D':
				results.push(formatFloat(slice.readDoubleBE(offset)));
				break;
			default:
				results.push('[unsupported]');
		}
	}
	return repeat === 1 ? results[0] : `[${results.join(', ')}]`;
}

function formatFloat(value: number): string {
	if (!Number.isFinite(value)) {
		return String(value);
	}
	return Math.abs(value) >= 1000 || Math.abs(value) < 0.001
		? value.toExponential(4)
		: value.toFixed(6).replace(/\.?0+$/, '');
}

function computeScaleModes(pixels: Float32Array): Record<string, [number, number]> {
	const sample = collectFiniteSample(pixels);
	if (!sample.length) {
		return {
			zscale: [0, 1],
			pct90: [0, 1],
			pct95: [0, 1],
			pct99: [0, 1],
			pct995: [0, 1],
			pct999: [0, 1],
			pct9995: [0, 1],
			pct9999: [0, 1],
			minmax: [0, 1],
		};
	}

	sample.sort((left, right) => left - right);
	const minimum = sample[0];
	const maximum = sample[sample.length - 1];

	return {
		zscale: normalizeLimits(computeFastZScale(sample)),
		pct90: normalizeLimits([percentileSorted(sample, 0.10), percentileSorted(sample, 0.90)]),
		pct95: normalizeLimits([percentileSorted(sample, 0.05), percentileSorted(sample, 0.95)]),
		pct99: normalizeLimits([percentileSorted(sample, 0.01), percentileSorted(sample, 0.99)]),
		pct995: normalizeLimits([percentileSorted(sample, 0.005), percentileSorted(sample, 0.995)]),
		pct999: normalizeLimits([percentileSorted(sample, 0.001), percentileSorted(sample, 0.999)]),
		pct9995: normalizeLimits([percentileSorted(sample, 0.0005), percentileSorted(sample, 0.9995)]),
		pct9999: normalizeLimits([percentileSorted(sample, 0.0001), percentileSorted(sample, 0.9999)]),
		minmax: normalizeLimits([minimum, maximum]),
	};
}

function collectFiniteSample(pixels: Float32Array, maxSamples = 16384): number[] {
	const total = pixels.length;
	const step = Math.max(1, Math.floor(total / maxSamples));
	const sample: number[] = [];
	for (let index = 0; index < total; index += step) {
		const value = pixels[index];
		if (Number.isFinite(value)) {
			sample.push(value);
		}
	}
	return sample;
}

function percentileSorted(sortedValues: number[], fraction: number): number {
	if (!sortedValues.length) {
		return 0;
	}
	const clamped = Math.min(1, Math.max(0, fraction));
	const position = clamped * (sortedValues.length - 1);
	const lowerIndex = Math.floor(position);
	const upperIndex = Math.min(sortedValues.length - 1, Math.ceil(position));
	if (lowerIndex === upperIndex) {
		return sortedValues[lowerIndex];
	}
	const mix = position - lowerIndex;
	return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * mix;
}

function computeFastZScale(sortedValues: number[]): [number, number] {
	if (sortedValues.length < 8) {
		return [sortedValues[0], sortedValues[sortedValues.length - 1]];
	}

	const contrast = 0.25;
	const median = percentileSorted(sortedValues, 0.5);
	const lowAnchor = percentileSorted(sortedValues, 0.05);
	const highAnchor = percentileSorted(sortedValues, 0.95);
	const span = highAnchor - lowAnchor;
	if (!Number.isFinite(span) || span <= 0) {
		return [sortedValues[0], sortedValues[sortedValues.length - 1]];
	}

	const slope = span / Math.max(1, 0.90 * (sortedValues.length - 1));
	const midpoint = (sortedValues.length - 1) / 2;
	const lower = median - (midpoint * slope) / contrast;
	const upper = median + ((sortedValues.length - 1 - midpoint) * slope) / contrast;
	return [
		Math.max(sortedValues[0], lower),
		Math.min(sortedValues[sortedValues.length - 1], upper),
	];
}

function normalizeLimits(limits: [number, number]): [number, number] {
	const [rawLow, rawHigh] = limits;
	if (!Number.isFinite(rawLow) || !Number.isFinite(rawHigh)) {
		return [0, 1];
	}
	if (rawHigh > rawLow) {
		return [rawLow, rawHigh];
	}
	const span = Math.abs(rawLow) || 1;
	return [rawLow - span * 0.5, rawHigh + span * 0.5];
}

function extractCelestialWcs(header: Record<string, any>): LinearCelestialWcs | null {
	const ctype1 = typeof header.CTYPE1 === 'string' ? header.CTYPE1.toUpperCase() : '';
	const ctype2 = typeof header.CTYPE2 === 'string' ? header.CTYPE2.toUpperCase() : '';
	if (
		!ctype1.startsWith('RA') ||
		!ctype2.startsWith('DEC') ||
		typeof header.CRVAL1 !== 'number' ||
		typeof header.CRVAL2 !== 'number' ||
		typeof header.CRPIX1 !== 'number' ||
		typeof header.CRPIX2 !== 'number'
	) {
		return null;
	}

	const cd = computeCdMatrix(header);
	if (!cd) {
		return null;
	}

	const unitScale1 = angularUnitToDegrees(header.CUNIT1);
	const unitScale2 = angularUnitToDegrees(header.CUNIT2);
	const matrix: [[number, number], [number, number]] = [
		[cd[0][0] * unitScale1, cd[0][1] * unitScale1],
		[cd[1][0] * unitScale2, cd[1][1] * unitScale2],
	];
	const determinant = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
	if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-16) {
		return null;
	}

	const projection = ctype1.includes('TAN') && ctype2.includes('TAN') ? 'TAN' : 'LINEAR';
	return {
		frame: 'ICRS',
		unit: 'deg',
		projection,
		crpix: [header.CRPIX1, header.CRPIX2],
		crval: [header.CRVAL1 * unitScale1, header.CRVAL2 * unitScale2],
		cd: matrix,
	};
}

function computeCdMatrix(header: Record<string, any>): [[number, number], [number, number]] | null {
	const cd11 = asNumber(header.CD1_1);
	const cd12 = asNumber(header.CD1_2);
	const cd21 = asNumber(header.CD2_1);
	const cd22 = asNumber(header.CD2_2);
	if ([cd11, cd12, cd21, cd22].every(value => typeof value === 'number')) {
		return [[cd11!, cd12!], [cd21!, cd22!]];
	}

	const cdelt1 = asNumber(header.CDELT1);
	const cdelt2 = asNumber(header.CDELT2);
	if (typeof cdelt1 !== 'number' || typeof cdelt2 !== 'number') {
		return null;
	}

	const pc11 = asNumber(header.PC1_1) ?? 1;
	const pc12 = asNumber(header.PC1_2) ?? 0;
	const pc21 = asNumber(header.PC2_1) ?? 0;
	const pc22 = asNumber(header.PC2_2) ?? 1;
	if (
		typeof header.PC1_1 === 'number' ||
		typeof header.PC1_2 === 'number' ||
		typeof header.PC2_1 === 'number' ||
		typeof header.PC2_2 === 'number'
	) {
		return [
			[pc11 * cdelt1, pc12 * cdelt2],
			[pc21 * cdelt1, pc22 * cdelt2],
		];
	}

	const crota = asNumber(header.CROTA2) ?? asNumber(header.CROTA1) ?? 0;
	const angle = crota * (Math.PI / 180);
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return [
		[cdelt1 * cos, -cdelt2 * sin],
		[cdelt1 * sin, cdelt2 * cos],
	];
}

function angularUnitToDegrees(unitValue: unknown): number {
	const unit = typeof unitValue === 'string' ? unitValue.replace(/'/g, '').trim().toLowerCase() : '';
	if (unit === 'rad' || unit === 'radian' || unit === 'radians') {
		return 180 / Math.PI;
	}
	return 1;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
