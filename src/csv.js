export class CsvFormatError extends Error {}

const REQUIRED_COLUMNS = ['Date', 'Details', 'Transaction Type', 'In', 'Out'];

/**
 * RFC4180-ish row splitter. Handles quoted fields containing commas, escaped
 * double quotes (""), and CRLF or LF line endings. Bank exports mostly don't
 * need this, but some do quote descriptions containing commas.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  // Strip a UTF-8 BOM, which Excel-produced exports often carry.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      // Consume CRLF as a single terminator; a lone CR also ends the row.
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  // Flush the trailing field/row unless the file ended on a line break.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/**
 * Parses DD/MM/YYYY (also tolerating D/M/YY) into an ISO YYYY-MM-DD string.
 * @param {string} value
 * @returns {string}
 */
export function parseUkDate(value) {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(value.trim());
  if (!m) throw new CsvFormatError(`Unrecognised date "${value}" (expected DD/MM/YYYY)`);
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (month < 1 || month > 12) throw new CsvFormatError(`Invalid month in date "${value}"`);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) throw new CsvFormatError(`Invalid day in date "${value}"`);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parses an amount cell, tolerating thousands separators and currency symbols.
 * @param {string} value
 * @returns {number|null} null when the cell is blank.
 */
function parseAmount(value) {
  const cleaned = value.replace(/[£$€,\s]/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new CsvFormatError(`Unrecognised amount "${value}"`);
  return n;
}

/** Rounds to whole pence, so float drift never reaches stored data. */
export function toPence(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Turns raw statement text into rows with signed amounts: In is positive
 * (money received), Out is negative (money spent).
 *
 * @param {string} text
 * @returns {{date: string, details: string, transactionType: string, amount: number, balance: number|null}[]}
 */
export function parseStatement(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) throw new CsvFormatError('The file is empty.');

  const index = new Map();
  header.forEach((name, i) => index.set(name.trim().toLowerCase(), i));

  const missing = REQUIRED_COLUMNS.filter((c) => !index.has(c.toLowerCase()));
  if (missing.length > 0) {
    throw new CsvFormatError(
      `This does not look like a bank statement export. Missing column(s): ${missing.join(', ')}. ` +
        `Expected a header row of: ${REQUIRED_COLUMNS.join(', ')}, Balance.`,
    );
  }

  const col = (name) => index.get(name.toLowerCase());
  const balanceCol = index.get('balance');

  return rows.slice(1).map((cells, i) => {
    const lineNo = i + 2;
    const cell = (c) => (cells[c] ?? '').trim();
    try {
      const inAmount = parseAmount(cell(col('In')));
      const outAmount = parseAmount(cell(col('Out')));
      if (inAmount === null && outAmount === null) {
        throw new CsvFormatError('Neither In nor Out is populated.');
      }
      if (inAmount !== null && outAmount !== null) {
        throw new CsvFormatError('Both In and Out are populated; exactly one is expected.');
      }
      const amount = inAmount !== null ? toPence(Math.abs(inAmount)) : -toPence(Math.abs(outAmount));
      return {
        date: parseUkDate(cell(col('Date'))),
        details: cell(col('Details')),
        transactionType: cell(col('Transaction Type')),
        amount,
        balance: balanceCol === undefined ? null : parseAmount(cell(balanceCol)),
      };
    } catch (err) {
      throw new CsvFormatError(`Line ${lineNo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

const CSV_EXPORT_COLUMNS = [
  'Date',
  'Details',
  'Transaction Type',
  'In',
  'Out',
  'Balance',
  'Property',
  'Category',
];

function escapeCsv(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** @param {string} iso */
function toUkDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Renders categorized transactions back to CSV, with Property/Category appended.
 * @param {import('./types.js').Transaction[]} transactions
 * @param {(id: string|null) => string} propertyName
 */
export function toCsv(transactions, propertyName) {
  const lines = [CSV_EXPORT_COLUMNS.join(',')];
  for (const t of transactions) {
    lines.push(
      [
        toUkDate(t.date),
        t.details,
        t.transactionType,
        t.amount > 0 ? t.amount.toFixed(2) : '',
        t.amount < 0 ? Math.abs(t.amount).toFixed(2) : '',
        t.balance === null ? '' : t.balance.toFixed(2),
        propertyName(t.propertyId),
        t.category ?? '',
      ]
        .map(escapeCsv)
        .join(','),
    );
  }
  return lines.join('\r\n');
}
