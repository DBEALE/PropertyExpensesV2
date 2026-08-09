/**
 * Matching an amount as a range rather than an exact pin, and the ±% buttons
 * that widen it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jitterBounds, draftRuleFromTransaction, draftToRule } from '../src/rule-draft.js';
import { amountRange, describeAmount, findMatchingRule, isExactAmount, matchesAmount } from '../src/rules.js';
import { rule } from './fixtures.js';

const INSURANCE = {
  id: 't1',
  date: '2026-07-30',
  details: 'DIRECT LINE FR BUS',
  transactionType: 'Direct Debit',
  amount: -30.16,
  balance: 16019.21,
  propertyId: 'propA',
  category: 'Ins',
  matchedRuleId: null,
  sourceFilename: 'july.csv',
  importedAt: '2026-08-01T00:00:00.000Z',
};

describe('jitterBounds', () => {
  it('widens an expense outwards without flipping its sign', () => {
    assert.deepEqual(jitterBounds(-100, 10), { min: -110, max: -90 });
  });

  it('widens income the same way', () => {
    assert.deepEqual(jitterBounds(1150, 10), { min: 1035, max: 1265 });
  });

  it('gives an exact pin at 0%', () => {
    assert.deepEqual(jitterBounds(-30.16, 0), { min: -30.16, max: -30.16 });
  });

  it('rounds the bounds to whole pence', () => {
    // -30.16 ± 5% is -31.668 to -28.652 before rounding.
    assert.deepEqual(jitterBounds(-30.16, 5), { min: -31.67, max: -28.65 });
  });
});

describe('amountRange', () => {
  it('reads a min/max pair', () => {
    assert.deepEqual(amountRange({ amountMin: -31.67, amountMax: -28.65 }), { min: -31.67, max: -28.65 });
  });

  it('still reads the legacy exact pin from older rules and backups', () => {
    assert.deepEqual(amountRange({ amountEquals: -428.06 }), { min: -428.06, max: -428.06 });
    assert.equal(isExactAmount({ amountEquals: -428.06 }), true);
  });

  it('orders an inverted pair', () => {
    assert.deepEqual(amountRange({ amountMin: 10, amountMax: -10 }), { min: -10, max: 10 });
  });

  it('is null when the rule sets no amount', () => {
    assert.equal(amountRange({ matchText: 'X' }), null);
  });
});

describe('matchesAmount', () => {
  const jittery = { amountMin: -31.67, amountMax: -28.65 };

  it('includes both ends of the range', () => {
    assert.equal(matchesAmount(jittery, -31.67), true);
    assert.equal(matchesAmount(jittery, -28.65), true);
  });

  it('accepts a transaction that drifted inside the range', () => {
    assert.equal(matchesAmount(jittery, -30.99), true);
  });

  it('rejects one that drifted outside it', () => {
    assert.equal(matchesAmount(jittery, -31.68), false);
    assert.equal(matchesAmount(jittery, -28.64), false);
  });

  it('compares in pence, so a float bound does not miss its own edge', () => {
    assert.equal(matchesAmount({ amountMin: 0.1, amountMax: 0.3 }, 0.1 + 0.2), true);
  });
});

describe('a jittery rule in practice', () => {
  it('catches next month\'s slightly different premium', () => {
    const draft = draftRuleFromTransaction(INSURANCE, []);
    const widened = { ...draft, useAmount: true, ...jitterBounds(INSURANCE.amount, 10) };
    const built = draftToRule({ ...widened, amountMin: widened.min, amountMax: widened.max }, 'r1');

    // Same payee, premium up 3% — an exact pin would have missed this.
    assert.equal(findMatchingRule({ ...INSURANCE, amount: -31.06 }, [built])?.id, 'r1');
    // But a wildly different amount is still left for review.
    assert.equal(findMatchingRule({ ...INSURANCE, amount: -60 }, [built]), null);
  });

  it('loses to an exact pin for the same payee', () => {
    const loose = rule({ id: 'loose', matchText: 'DIRECT LINE', propertyId: 'propA', amountMin: -33.18, amountMax: -27.14 });
    const exact = rule({ id: 'exact', matchText: 'DIRECT LINE', propertyId: 'propB', amountMin: -30.16, amountMax: -30.16 });
    // Both match, but the tighter window is the more specific rule.
    assert.equal(findMatchingRule(INSURANCE, [loose, exact]).id, 'exact');
    // A neighbouring amount only the loose rule covers still matches it.
    assert.equal(findMatchingRule({ ...INSURANCE, amount: -29 }, [loose, exact]).id, 'loose');
  });

  it('loses to a narrower range too', () => {
    const wide = rule({ id: 'wide', matchText: 'DIRECT LINE', propertyId: 'propA', amountMin: -40, amountMax: -20 });
    const narrow = rule({ id: 'narrow', matchText: 'DIRECT LINE', propertyId: 'propB', amountMin: -31, amountMax: -29 });
    assert.equal(findMatchingRule(INSURANCE, [wide, narrow]).id, 'narrow');
  });
});

describe('describeAmount', () => {
  const money = (n) => `£${n.toFixed(2)}`;

  it('shows a single value for an exact pin', () => {
    assert.equal(describeAmount({ amountMin: -30.16, amountMax: -30.16 }, money), '£-30.16');
  });

  it('shows both ends of a range', () => {
    assert.equal(describeAmount({ amountMin: -31.67, amountMax: -28.65 }, money), '£-31.67 to £-28.65');
  });

  it('says "any" when no amount is set', () => {
    assert.equal(describeAmount({ matchText: 'X' }, money), 'any');
  });
});
