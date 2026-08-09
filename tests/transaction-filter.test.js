import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NON_PROPERTY_ID } from '../src/categories.js';
import {
  ANY,
  UNASSIGNED,
  filterTransactions,
  isFiltered,
  matchesCategory,
  matchesProperty,
  matchesRule,
  matchesStatus,
} from '../src/transaction-filter.js';

function tx(id, propertyId, category, extra = {}) {
  return {
    id,
    date: '2026-07-24',
    details: `Payment ${id}`,
    transactionType: 'Card Payment',
    amount: -10,
    balance: null,
    propertyId,
    category,
    matchedRuleId: null,
    sourceFilename: 'july.csv',
    importedAt: '2026-08-01T00:00:00.000Z',
    ...extra,
  };
}

const ROWS = [
  tx('a', 'p1', 'Rent'),
  tx('b', 'p2', 'Ins'),
  tx('c', null, null),
  tx('personal', NON_PROPERTY_ID, null),
  tx('split', null, null, {
    allocations: [
      { propertyId: 'p1', category: 'Ins', amount: -4 },
      { propertyId: 'p2', category: 'Repairs', amount: -6 },
    ],
  }),
];

const ids = (rows) => rows.map((r) => r.id);

describe('matchesProperty', () => {
  it('keeps everything when set to any', () => {
    assert.ok(ROWS.every((t) => matchesProperty(t, ANY)));
    assert.ok(ROWS.every((t) => matchesProperty(t, undefined)));
  });

  it('keeps a split under either of its properties', () => {
    assert.equal(matchesProperty(ROWS[4], 'p1'), true);
    assert.equal(matchesProperty(ROWS[4], 'p2'), true);
    assert.equal(matchesProperty(ROWS[4], 'p3'), false);
  });

  it('matches the non-property classification', () => {
    assert.deepEqual(ids(filterTransactions(ROWS, { propertyId: NON_PROPERTY_ID })), ['personal']);
  });

  it('finds rows with no assignment at all', () => {
    // "personal" is classified, so it is not unassigned.
    assert.deepEqual(ids(filterTransactions(ROWS, { propertyId: UNASSIGNED })), ['c']);
  });
});

describe('matchesCategory', () => {
  it('keeps a split when any share carries the category', () => {
    assert.equal(matchesCategory(ROWS[4], 'Ins'), true);
    assert.equal(matchesCategory(ROWS[4], 'Repairs'), true);
    assert.equal(matchesCategory(ROWS[4], 'Rent'), false);
  });

  it('treats an uncategorised filter as "needs a category"', () => {
    // Both the untouched row and the non-property one, which has no category.
    assert.deepEqual(ids(filterTransactions(ROWS, { category: UNASSIGNED })), ['c', 'personal']);
  });

  it('selects one category across simple and split rows alike', () => {
    assert.deepEqual(ids(filterTransactions(ROWS, { category: 'Ins' })), ['b', 'split']);
  });
});

describe('combining filters', () => {
  it('narrows a split to the single property-and-category pair it holds', () => {
    assert.deepEqual(ids(filterTransactions(ROWS, { propertyId: 'p1', category: 'Ins' })), ['split']);
    // p1 has no Repairs share, so this pair matches nothing.
    assert.deepEqual(ids(filterTransactions(ROWS, { propertyId: 'p1', category: 'Rent' })), ['a']);
    assert.deepEqual(ids(filterTransactions(ROWS, { propertyId: 'p2', category: 'Rent' })), []);
  });

  it('applies text, dates and status alongside them', () => {
    const dated = [tx('old', 'p1', 'Rent', { date: '2025-01-01' }), ...ROWS];
    assert.deepEqual(ids(filterTransactions(dated, { from: '2026-01-01' })).includes('old'), false);
    assert.deepEqual(ids(filterTransactions(ROWS, { text: 'payment a' })), ['a']);
    assert.deepEqual(ids(filterTransactions(ROWS, { status: 'split' })), ['split']);
  });

  it('counts a non-property row as reviewed, not as needing review', () => {
    assert.equal(matchesStatus(ROWS[3], 'review'), false);
    assert.deepEqual(ids(filterTransactions(ROWS, { status: 'review' })), ['c']);
  });
});

describe('matchesRule', () => {
  const byRule = [
    tx('a', 'p1', 'Rent', { matchedRuleId: 'r1' }),
    tx('b', 'p1', 'Ins', { matchedRuleId: 'r2' }),
    tx('c', 'p1', 'Rent'), // assigned by hand: no rule
  ];

  it('keeps everything when set to any', () => {
    assert.equal(ids(filterTransactions(byRule, { ruleId: ANY })).length, 3);
    assert.equal(ids(filterTransactions(byRule, {})).length, 3);
  });

  it('selects the transactions one rule claimed', () => {
    assert.deepEqual(ids(filterTransactions(byRule, { ruleId: 'r1' })), ['a']);
    assert.deepEqual(ids(filterTransactions(byRule, { ruleId: 'r2' })), ['b']);
  });

  it('finds the ones no rule touched', () => {
    assert.deepEqual(ids(filterTransactions(byRule, { ruleId: UNASSIGNED })), ['c']);
  });

  it('returns nothing for a rule that has been deleted', () => {
    assert.deepEqual(ids(filterTransactions(byRule, { ruleId: 'gone' })), []);
  });

  it('combines with the other filters', () => {
    assert.deepEqual(ids(filterTransactions(byRule, { ruleId: 'r1', category: 'Ins' })), []);
    assert.deepEqual(ids(filterTransactions(byRule, { ruleId: 'r1', category: 'Rent' })), ['a']);
  });

  it('counts as a narrowed filter', () => {
    assert.equal(matchesRule(byRule[0], 'r1'), true);
    assert.equal(matchesRule(byRule[0], 'r2'), false);
  });
});

describe('isFiltered', () => {
  it('is false for an untouched filter set', () => {
    assert.equal(isFiltered({ text: '', status: 'all', from: '', to: '', propertyId: ANY, category: ANY }), false);
  });

  it('is true as soon as any one is narrowed', () => {
    assert.equal(isFiltered({ propertyId: 'p1' }), true);
    assert.equal(isFiltered({ category: 'Rent' }), true);
    assert.equal(isFiltered({ text: 'natwest' }), true);
    assert.equal(isFiltered({ status: 'review' }), true);
    assert.equal(isFiltered({ from: '2026-01-01' }), true);
    assert.equal(isFiltered({ ruleId: 'r1' }), true);
  });
});
