import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CsvFormatError, parseCsv, parseStatement, parseUkDate, toCsv } from '../src/csv.js';
import { FIXTURE } from './fixtures.js';

describe('parseUkDate', () => {
  it('parses DD/MM/YYYY', () => {
    assert.equal(parseUkDate('30/07/2026'), '2026-07-30');
    assert.equal(parseUkDate('01/01/2025'), '2025-01-01');
  });

  it('does not read the day as the month', () => {
    assert.equal(parseUkDate('06/04/2026'), '2026-04-06');
  });

  it('rejects impossible dates and other formats', () => {
    assert.throws(() => parseUkDate('32/01/2026'), CsvFormatError);
    assert.throws(() => parseUkDate('30/02/2026'), CsvFormatError);
    assert.throws(() => parseUkDate('2026-07-30'), CsvFormatError);
  });
});

describe('parseCsv', () => {
  it('handles quoted fields containing commas and escaped quotes', () => {
    const rows = parseCsv('a,b\n"one, two","he said ""hi"""');
    assert.deepEqual(rows[1], ['one, two', 'he said "hi"']);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM', () => {
    assert.equal(parseCsv('﻿Date,Details')[0][0], 'Date');
  });
});

describe('parseStatement', () => {
  it('parses the example rows with correct signs and dates', () => {
    const rows = parseStatement(FIXTURE);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], {
      date: '2026-07-30',
      details: 'DIRECT LINE FR BUS',
      transactionType: 'Direct Debit',
      amount: -30.16,
      balance: 16019.21,
    });
    assert.equal(rows[1].amount, -428.06);
    assert.equal(rows[2].amount, 1150);
    // Two Out rows negative, one In row positive.
    assert.equal(rows.filter((r) => r.amount < 0).length, 2);
    assert.equal(rows.filter((r) => r.amount > 0).length, 1);
  });

  it('rejects a file whose columns do not match', () => {
    assert.throws(() => parseStatement('Foo,Bar\n1,2'), /Missing column/);
  });

  it('reports the offending line number', () => {
    assert.throws(() => parseStatement(FIXTURE.replace('24/07/2026', '2026-07-24')), /Line 4/);
  });

  it('rejects rows with both In and Out populated', () => {
    const bad = 'Date,Details,Transaction Type,In,Out,Balance\n01/01/2026,X,Y,5.00,5.00,1.00';
    assert.throws(() => parseStatement(bad), /Both In and Out/);
  });

  it('tolerates currency symbols and thousands separators', () => {
    const text = 'Date,Details,Transaction Type,In,Out,Balance\n01/01/2026,X,Y,"£1,150.00",,"16,477.43"';
    assert.equal(parseStatement(text)[0].amount, 1150);
    assert.equal(parseStatement(text)[0].balance, 16477.43);
  });

  it('reads Details containing a quoted comma without shifting columns', () => {
    const text =
      'Date,Details,Transaction Type,In,Out,Balance\n01/01/2026,"SMITH, J RENT",Inward Payment,500.00,,1000.00';
    const row = parseStatement(text)[0];
    assert.equal(row.details, 'SMITH, J RENT');
    assert.equal(row.amount, 500);
  });
});

describe('toCsv', () => {
  const transactions = [
    {
      id: '1',
      date: '2026-07-24',
      details: 'S Agyapong 3 PETERBOROUGH GAT',
      transactionType: 'Inward Payment',
      amount: 1150,
      balance: 16477.43,
      propertyId: 'p1',
      category: 'Rent',
      matchedRuleId: null,
      sourceFilename: 'july.csv',
      importedAt: '2026-08-01T00:00:00.000Z',
    },
    {
      id: '2',
      date: '2026-07-30',
      details: 'DIRECT LINE, FR BUS',
      transactionType: 'Direct Debit',
      amount: -30.16,
      balance: 16019.21,
      propertyId: 'p1',
      category: 'Ins',
      matchedRuleId: null,
      sourceFilename: 'july.csv',
      importedAt: '2026-08-01T00:00:00.000Z',
    },
  ];

  it('splits signed amounts back into In/Out and appends property, category and notes', () => {
    const lines = toCsv(transactions, () => '3 Peterborough Gate').split('\r\n');
    assert.equal(lines[0], 'Date,Details,Transaction Type,In,Out,Balance,Property,Category,Notes');
    assert.equal(
      lines[1],
      '24/07/2026,S Agyapong 3 PETERBOROUGH GAT,Inward Payment,1150.00,,16477.43,3 Peterborough Gate,Rent,',
    );
    // A comma inside Details must come back out quoted.
    assert.equal(
      lines[2],
      '30/07/2026,"DIRECT LINE, FR BUS",Direct Debit,,30.16,16019.21,3 Peterborough Gate,Ins,',
    );
  });

  it('exports a note, quoted when it needs to be', () => {
    const noted = [{ ...transactions[1], notes: 'Renewal, paid annually' }];
    const [, line] = toCsv(noted, () => '3 Peterborough Gate').split('\r\n');
    assert.ok(line.endsWith(',"Renewal, paid annually"'), line);
  });

  it('puts a split transaction’s note on its first line only', () => {
    // Repeating it against every share would read as several notes rather than
    // one note about one transaction.
    const split = [
      {
        ...transactions[0],
        propertyId: null,
        category: null,
        notes: 'Half each',
        allocations: [
          { propertyId: 'p1', category: 'Rent', amount: 575 },
          { propertyId: 'p2', category: 'Rent', amount: 575 },
        ],
      },
    ];
    const [, first, second] = toCsv(split, () => 'A property').split('\r\n');
    assert.ok(first.endsWith(',Half each'), first);
    assert.ok(second.endsWith(','), second);
  });

  it('round-trips through the parser back to the same amounts', () => {
    const exported = toCsv(transactions, () => '3 Peterborough Gate');
    const reparsed = parseStatement(exported);
    assert.deepEqual(
      reparsed.map((r) => r.amount),
      [1150, -30.16],
    );
    assert.equal(reparsed[1].details, 'DIRECT LINE, FR BUS');
  });
});
