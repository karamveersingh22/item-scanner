import AdmZip from 'adm-zip';
import crypto from 'crypto';

export interface ParsedItem {
  i_code: string;
  item_name: string | null;
  describe: string | null;
  quantity: string | null;
  rate: string | null;
  disc_per: string | null;
  disc_b: string | null;
}

export interface ParseResult {
  items: ParsedItem[];
  item_count: number;
  data_version: string;
  duplicate_count: number;
}

export class ExcelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExcelValidationError';
  }
}

/**
 * Converts spreadsheet column letters (e.g., 'A', 'B', 'Z', 'AA') to a 0-based column index.
 */
function colLetterToIndex(letters: string): number {
  let result = 0;
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.charCodeAt(i) - 64);
  }
  return result - 1;
}

/**
 * Decodes standard XML entity escapes.
 */
function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Fast streaming extraction and parsing of OpenXML (.xlsx) files.
 * Mirroring the high-performance Dart isolate implementation from Flutter's excel_import_service.dart.
 */
export function parseExcelBuffer(buffer: Buffer): ParseResult {
  if (!buffer || buffer.length === 0) {
    throw new ExcelValidationError('Excel file is empty (0 bytes).');
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch (err: any) {
    throw new ExcelValidationError('Invalid or corrupt Excel archive. File is not a valid .xlsx spreadsheet.');
  }

  // 1. Verify it's an OpenXML spreadsheet
  const contentTypes = zip.getEntry('[Content_Types].xml');
  if (!contentTypes) {
    throw new ExcelValidationError('Invalid Excel archive structure. [Content_Types].xml is missing.');
  }

  // 2. Extract Shared Strings Table (if present)
  const sharedStrings: string[] = [];
  const ssEntry = zip.getEntry('xl/sharedStrings.xml');
  if (ssEntry) {
    const rawXml = ssEntry.getData().toString('utf8');
    const siRegex = /<si>([\s\S]*?)<\/si>/g;
    const tRegex = /<t(?: [^>]*)?>([\s\S]*?)<\/t>/g;

    let siMatch: RegExpExecArray | null;
    while ((siMatch = siRegex.exec(rawXml)) !== null) {
      const siContent = siMatch[1] || '';
      const tMatches = [...siContent.matchAll(tRegex)];
      if (tMatches.length === 0) {
        sharedStrings.push('');
      } else {
        const fullText = tMatches.map((m) => m[1] || '').join('');
        sharedStrings.push(decodeXmlEntities(fullText));
      }
    }
  }

  // 3. Locate worksheet (default to sheet1.xml or first available worksheet)
  let sheetEntry = zip.getEntry('xl/worksheets/sheet1.xml');
  if (!sheetEntry) {
    const entries = zip.getEntries();
    sheetEntry = entries.find(
      (e) => e.entryName.startsWith('xl/worksheets/') && e.entryName.endsWith('.xml')
    ) || null;
  }

  if (!sheetEntry) {
    throw new ExcelValidationError('No worksheet found in Excel file.');
  }

  const sheetXml = sheetEntry.getData().toString('utf8');

  // 4. Parse Rows and Cells using high-performance regex matching
  const rowRegex = /<row [^>]*>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c [^>]*r="([A-Z]+)(\d+)"([^>]*)>(?:<v>([^<]*)<\/v>|<is><t>([^<]*)<\/t><\/is>)?/g;
  const typeRegex = /t="([^"]+)"/;

  let iCodeCol: number | null = null;
  let itemNameCol: number | null = null;
  let describeCol: number | null = null;
  let quantityCol: number | null = null;
  let rateCol: number | null = null;
  let discPerCol: number | null = null;
  let discBCol: number | null = null;

  const items: ParsedItem[] = [];
  const seenICodes = new Set<string>();
  const duplicateICodes: string[] = [];
  let isFirstRow = true;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowBody = rowMatch[1] || '';
    const rowData: Record<number, string> = {};

    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowBody)) !== null) {
      const colLetters = cellMatch[1];
      const attributes = cellMatch[3] || '';
      const rawVal = cellMatch[4] !== undefined ? cellMatch[4] : cellMatch[5] || '';
      const colIdx = colLetterToIndex(colLetters);

      const tMatch = typeRegex.exec(attributes);
      const cellType = tMatch ? tMatch[1] : '';

      let cellValue = rawVal;
      if (cellType === 's') {
        const sIdx = parseInt(rawVal, 10);
        if (!isNaN(sIdx) && sIdx >= 0 && sIdx < sharedStrings.length) {
          cellValue = sharedStrings[sIdx];
        }
      } else if (cellType === 'inlineStr' || cellType === 'str') {
        cellValue = decodeXmlEntities(cellValue);
      }

      rowData[colIdx] = cellValue.trim();
    }

    // Process Header Row
    if (isFirstRow) {
      isFirstRow = false;
      for (const [colIdxStr, colName] of Object.entries(rowData)) {
        const idx = Number(colIdxStr);
        const name = colName.trim().toUpperCase();
        if (name === 'I_CODE') iCodeCol = idx;
        else if (name === 'ITEM_NAME') itemNameCol = idx;
        else if (name === 'DESCRIBE') describeCol = idx;
        else if (name === 'QUANTITY') quantityCol = idx;
        else if (name === 'RATE') rateCol = idx;
        else if (name === 'DISC_PER') discPerCol = idx;
        else if (name === 'DISC_B' || name === 'DISC B' || name === 'DISCB') discBCol = idx;
      }

      // Validate required columns
      const missingColumns: string[] = [];
      if (iCodeCol === null) missingColumns.push('I_CODE');
      if (itemNameCol === null) missingColumns.push('ITEM_NAME');
      if (describeCol === null) missingColumns.push('DESCRIBE');
      if (quantityCol === null) missingColumns.push('QUANTITY');
      if (rateCol === null) missingColumns.push('RATE');
      if (discPerCol === null) missingColumns.push('DISC_PER');
      if (discBCol === null) missingColumns.push('DISC_B');

      if (missingColumns.length > 0) {
        throw new ExcelValidationError(
          `Missing required columns: ${missingColumns.join(', ')}. Required columns: I_CODE, ITEM_NAME, DESCRIBE, QUANTITY, RATE, DISC_PER, DISC_B.`
        );
      }
      continue;
    }

    // Extract item row
    const rawICode = iCodeCol !== null ? rowData[iCodeCol] || '' : '';
    const trimmedICode = rawICode.trim();
    if (!trimmedICode) {
      // Skip empty row or row without item code
      continue;
    }

    // Duplicate I_CODE check: maintain strict catalog uniqueness
    if (seenICodes.has(trimmedICode)) {
      duplicateICodes.push(trimmedICode);
    } else {
      seenICodes.add(trimmedICode);
    }

    items.push({
      i_code: trimmedICode, // Preserves meaningful leading zeros, e.g. '001234'
      item_name: itemNameCol !== null && rowData[itemNameCol] ? rowData[itemNameCol] : null,
      describe: describeCol !== null && rowData[describeCol] ? rowData[describeCol] : null,
      quantity: quantityCol !== null && rowData[quantityCol] ? rowData[quantityCol] : null,
      rate: rateCol !== null && rowData[rateCol] ? rowData[rateCol] : null,
      disc_per: discPerCol !== null && rowData[discPerCol] ? rowData[discPerCol] : null,
      disc_b: discBCol !== null && rowData[discBCol] ? rowData[discBCol] : null,
    });
  }

  // 5. Fail synchronization if duplicate item codes exist
  if (duplicateICodes.length > 0) {
    const sample = duplicateICodes.slice(0, 3).join("', '");
    throw new ExcelValidationError(
      `Found ${duplicateICodes.length} duplicate I_CODE occurrence(s) in spreadsheet (sample duplicate: '${sample}'). Item codes must be unique.`
    );
  }

  if (items.length === 0) {
    throw new ExcelValidationError('The spreadsheet does not contain any valid item records.');
  }

  // 6. Generate deterministic MD5 data_version hash
  const hash = crypto.createHash('md5');
  hash.update(String(items.length));
  for (const item of items) {
    hash.update(`${item.i_code}|${item.rate || ''}|${item.quantity || ''}|${item.disc_per || ''}|${item.disc_b || ''};`);
  }
  const data_version = hash.digest('hex');

  return {
    items,
    item_count: items.length,
    data_version,
    duplicate_count: 0,
  };
}

/**
 * Creates a valid OpenXML spreadsheet (.xlsx) buffer for testing,
 * simulation, and performance benchmarking (supports 10,000+ and 50,000+ items).
 */
export function createMockXlsxBuffer(
  rows: Array<Record<string, any>>,
  customHeaders?: string[]
): Buffer {
  const zip = new AdmZip();

  const headers = customHeaders || [
    'I_CODE',
    'ITEM_NAME',
    'DESCRIBE',
    'QUANTITY',
    'RATE',
    'DISC_PER',
    'DISC_B',
  ];

  // Helper to convert 0-indexed column to Excel column letters
  function getColLetter(colIdx: number): string {
    let temp = colIdx + 1;
    let letter = '';
    while (temp > 0) {
      const mod = (temp - 1) % 26;
      letter = String.fromCharCode(65 + mod) + letter;
      temp = Math.floor((temp - mod) / 26);
    }
    return letter;
  }

  // Build sheet1.xml
  const sheetParts: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetData>',
  ];

  // Row 1: Headers
  sheetParts.push('<row r="1">');
  headers.forEach((h, idx) => {
    const colLetter = getColLetter(idx);
    sheetParts.push(
      `<c r="${colLetter}1" t="inlineStr"><is><t>${decodeXmlEntities(h)}</t></is></c>`
    );
  });
  sheetParts.push('</row>');

  // Data rows
  rows.forEach((row, rowIdx) => {
    const rNum = rowIdx + 2;
    sheetParts.push(`<row r="${rNum}">`);
    headers.forEach((h, colIdx) => {
      const colLetter = getColLetter(colIdx);
      const val = row[h] !== undefined && row[h] !== null ? String(row[h]) : '';
      if (val !== '') {
        sheetParts.push(
          `<c r="${colLetter}${rNum}" t="inlineStr"><is><t>${val
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')}</t></is></c>`
        );
      }
    });
    sheetParts.push('</row>');
  });

  sheetParts.push('</sheetData></worksheet>');

  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
      'utf8'
    )
  );

  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
      'utf8'
    )
  );

  zip.addFile(
    'xl/_rels/workbook.xml.rels',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
      'utf8'
    )
  );

  zip.addFile(
    'xl/workbook.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
        '</workbook>',
      'utf8'
    )
  );

  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheetParts.join(''), 'utf8'));

  return zip.toBuffer();
}
