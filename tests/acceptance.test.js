/**
 * The two acceptance checks from the spec, run against the same pure modules
 * the UI uses: buildTransactions is exactly what the Import view calls.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BackupFormatError, buildBackup, validateBackup } from '../src/backup.js';
import { buildTransactions, isDuplicate, recategorise } from '../src/importer.js';
import { taxYearRange, filterByDate } from '../src/dates.js';
import { FIXTURE, idFactory, rule } from './fixtures.js';

const IMPORTED_AT = '2026-08-01T00:00:00.000Z';

function importStatement(text, rules = [], filename = 'july.csv') {
  return buildTransactions(text, { rules, filename, importedAt: IMPORTED_AT, newId: idFactory() });
}

describe('acceptance: importing the three example rows', () => {
  const transactions = importStatement(FIXTURE);

  it('produces three transactions with correct signed amounts', () => {
    assert.equal(transactions.length, 3);
    assert.equal(transactions.filter((t) => t.amount < 0).length, 2);
    assert.equal(transactions.filter((t) => t.amount > 0).length, 1);
    assert.equal(transactions.find((t) => t.details.includes('Agyapong')).amount, 1150);
    assert.equal(transactions.find((t) => t.details === 'NATWEST BANK').amount, -428.06);
    assert.equal(transactions.find((t) => t.details.includes('DIRECT LINE')).amount, -30.16);
  });

  it('parses the DD/MM/YYYY dates', () => {
    assert.deepEqual(
      transactions.map((t) => t.date),
      ['2026-07-30', '2026-07-30', '2026-07-24'],
    );
  });

  it('leaves everything for manual review when no rules exist', () => {
    assert.ok(transactions.every((t) => t.propertyId === null && t.category === null));
    assert.ok(transactions.every((t) => t.matchedRuleId === null));
    assert.ok(transactions.every((t) => t.sourceFilename === 'july.csv'));
  });
});

describe('acceptance: assigning a row and saving it as a text-only rule', () => {
  it('auto-categorises the same tenant on a later statement', () => {
    const propertyId = 'prop-peterborough';
    const transactions = importStatement(FIXTURE);

    // The user assigns the "S Agyapong" row to the property and Rent...
    const rent = transactions.find((t) => t.details.includes('Agyapong'));
    const assigned = { ...rent, propertyId, category: 'Rent', matchedRuleId: null };
    assert.equal(assigned.category, 'Rent');

    // ...and saves it as a text-only rule matching PETERBOROUGH.
    const rules = [rule({ id: 'r1', matchText: 'PETERBOROUGH', propertyId, category: 'Rent' })];

    const nextMonth = `Date,Details,Transaction Type,In,Out,Balance
24/08/2026,S Agyapong 3 PETERBOROUGH GAT,Inward Payment,1150.00,,17627.43`;
    const [imported] = importStatement(nextMonth, rules, 'august.csv');

    assert.equal(imported.propertyId, propertyId);
    assert.equal(imported.category, 'Rent');
    assert.equal(imported.matchedRuleId, 'r1');
  });
});

describe('acceptance: disambiguating a payee shared across two properties', () => {
  const rules = [
    rule({ id: 'ruleA', matchText: 'NATWEST BANK', propertyId: 'propA', amountEquals: -428.06 }),
    rule({ id: 'ruleB', matchText: 'NATWEST BANK', propertyId: 'propB', amountEquals: -512.4 }),
  ];
  const statement = `Date,Details,Transaction Type,In,Out,Balance
30/07/2026,NATWEST BANK,Direct Debit,,428.06,16049.37
30/07/2026,NATWEST BANK,Direct Debit,,512.40,15536.97
30/07/2026,NATWEST BANK,Direct Debit,,999.99,14536.98`;

  it('sends each payment to the property its amount is pinned to', () => {
    const byAmount = new Map(importStatement(statement, rules).map((t) => [t.amount, t]));
    assert.equal(byAmount.get(-428.06).propertyId, 'propA');
    assert.equal(byAmount.get(-428.06).category, 'Interest');
    assert.equal(byAmount.get(-512.4).propertyId, 'propB');
    assert.equal(byAmount.get(-512.4).category, 'Interest');
  });

  it('leaves a third, unmatched amount unassigned rather than picking either rule', () => {
    const odd = importStatement(statement, rules).find((t) => t.amount === -999.99);
    assert.equal(odd.propertyId, null);
    assert.equal(odd.category, null);
    assert.equal(odd.matchedRuleId, null);
  });
});

describe('recategorise', () => {
  const propertyId = 'propA';

  it('applies a newly added rule to existing transactions', () => {
    const transactions = importStatement(FIXTURE);
    const rules = [rule({ id: 'r1', matchText: 'PETERBOROUGH', propertyId, category: 'Rent' })];
    const updated = recategorise(transactions, rules);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].category, 'Rent');
    assert.equal(updated[0].matchedRuleId, 'r1');
  });

  it('leaves a manually assigned transaction untouched', () => {
    const transactions = importStatement(FIXTURE).map((t) =>
      t.details.includes('DIRECT LINE') ? { ...t, propertyId, category: 'Ins', matchedRuleId: null } : t,
    );
    // A rule that would otherwise claim the manually categorised row.
    const rules = [rule({ id: 'r2', matchText: 'DIRECT LINE', propertyId: 'propB', category: 'Repairs' })];
    assert.deepEqual(recategorise(transactions, rules), []);
  });

  it('clears an assignment when the rule that made it is deleted', () => {
    const transactions = importStatement(FIXTURE, [
      rule({ id: 'r1', matchText: 'PETERBOROUGH', propertyId, category: 'Rent' }),
    ]);
    const updated = recategorise(transactions, []);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].propertyId, null);
    assert.equal(updated[0].category, null);
  });
});

describe('isDuplicate', () => {
  it('spots rows already imported from an overlapping statement', () => {
    const existing = importStatement(FIXTURE);
    const again = importStatement(FIXTURE, [], 'july-reexport.csv');
    assert.ok(again.every((t) => isDuplicate(t, existing)));
    assert.equal(isDuplicate({ ...again[0], amount: -1 }, existing), false);
  });
});

describe('backup', () => {
  const state = {
    properties: [{ id: 'p1', name: '3 Peterborough Gate' }],
    rules: [rule({ id: 'r1', matchText: 'PETERBOROUGH', propertyId: 'p1', category: 'Rent' })],
    transactions: importStatement(FIXTURE),
  };

  it('round-trips through JSON without losing anything', () => {
    const restored = validateBackup(JSON.parse(JSON.stringify(buildBackup(state, IMPORTED_AT))));
    assert.deepEqual(restored.properties, state.properties);
    assert.deepEqual(restored.rules, state.rules);
    assert.equal(restored.transactions.length, 3);
  });

  it('rejects files that are not one of our backups', () => {
    assert.throws(() => validateBackup({ hello: 'world' }), BackupFormatError);
    assert.throws(() => validateBackup(null), BackupFormatError);
    assert.throws(
      () => validateBackup({ format: 'property-expenses-backup', properties: [], rules: [] }),
      /missing/i,
    );
  });

  it('rejects a backup containing malformed records rather than importing half of it', () => {
    const broken = buildBackup(state, IMPORTED_AT);
    assert.throws(
      () => validateBackup({ ...broken, rules: [...broken.rules, { id: 'x', matchText: 'y', category: 'Nope' }] }),
      /malformed/i,
    );
  });
});

describe('date filtering', () => {
  it('selects a UK tax year, 6 April to 5 April', () => {
    assert.deepEqual(taxYearRange(2026), { from: '2026-04-06', to: '2027-04-05' });
  });

  it('filters inclusively at both ends, and treats a blank bound as open', () => {
    const transactions = importStatement(FIXTURE);
    assert.equal(filterByDate(transactions, '2026-07-24', '2026-07-24').length, 1);
    assert.equal(filterByDate(transactions, '2026-07-25', '').length, 2);
    assert.equal(filterByDate(transactions, '', '').length, 3);
    // The 24 July rent falls in the 2026/27 tax year, not 2025/26.
    const { from, to } = taxYearRange(2026);
    assert.equal(filterByDate(transactions, from, to).length, 3);
    assert.equal(filterByDate(transactions, ...Object.values(taxYearRange(2025))).length, 0);
  });
});
