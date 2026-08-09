import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allocationsOf,
  hasSplit,
  isAssigned,
  isSplit,
  normaliseAllocations,
  splitEvenly,
  sumAllocations,
  validateAllocations,
} from '../src/allocation.js';

const SIMPLE = { propertyId: 'p1', category: 'Rent', amount: 1150 };
const UNASSIGNED = { propertyId: null, category: null, amount: -30.16 };
const SPLIT = {
  propertyId: null,
  category: null,
  amount: -428.06,
  allocations: [
    { propertyId: 'p1', category: 'Interest', amount: -200 },
    { propertyId: 'p2', category: 'Interest', amount: -228.06 },
  ],
};

describe('allocationsOf', () => {
  it('gives a simple assignment as one share of the whole amount', () => {
    assert.deepEqual(allocationsOf(SIMPLE), [{ propertyId: 'p1', category: 'Rent', amount: 1150 }]);
  });

  it('gives a split its own shares', () => {
    assert.equal(allocationsOf(SPLIT).length, 2);
    assert.equal(sumAllocations(allocationsOf(SPLIT)), -428.06);
  });

  it('gives an unassigned transaction nothing, so it never reaches a total', () => {
    assert.deepEqual(allocationsOf(UNASSIGNED), []);
    assert.deepEqual(allocationsOf({ propertyId: 'p1', category: null, amount: 5 }), []);
  });
});

describe('isAssigned / isSplit', () => {
  it('recognises both ways of being assigned', () => {
    assert.equal(isAssigned(SIMPLE), true);
    assert.equal(isAssigned(SPLIT), true);
    assert.equal(isAssigned(UNASSIGNED), false);
  });

  it('treats a split across one property as split storage but not a real split', () => {
    const single = { ...SPLIT, allocations: [{ propertyId: 'p1', category: 'Interest', amount: -428.06 }] };
    assert.equal(hasSplit(single), true);
    assert.equal(isSplit(single), false);
    assert.equal(isSplit(SPLIT), true);
  });
});

describe('sumAllocations', () => {
  it('sums in pence so repeated thirds do not drift', () => {
    const thirds = [
      { amount: 33.33 },
      { amount: 33.33 },
      { amount: 33.34 },
    ];
    assert.equal(sumAllocations(thirds), 100);
  });

  it('sums an empty list to zero', () => {
    assert.equal(sumAllocations([]), 0);
    assert.equal(sumAllocations(undefined), 0);
  });
});

describe('validateAllocations', () => {
  const rows = [
    { propertyId: 'p1', category: 'Interest', amount: -200 },
    { propertyId: 'p2', category: 'Interest', amount: -228.06 },
  ];

  it('accepts shares that total the transaction exactly', () => {
    assert.equal(validateAllocations(rows, -428.06), null);
  });

  it('reports how much is still to allocate', () => {
    const short = [rows[0], { ...rows[1], amount: -100 }];
    assert.match(validateAllocations(short, -428.06), /128\.06 still to allocate/);
  });

  it('reports an over-allocation', () => {
    const over = [rows[0], { ...rows[1], amount: -300 }];
    assert.match(validateAllocations(over, -428.06), /71\.94 over-allocated/);
  });

  it('rejects a single-row split', () => {
    assert.match(validateAllocations([rows[0]], -200), /at least two rows/i);
  });

  it('rejects incomplete rows, naming which one', () => {
    assert.match(validateAllocations([{ ...rows[0], propertyId: '' }, rows[1]], -428.06), /Row 1: choose a property/);
    assert.match(validateAllocations([rows[0], { ...rows[1], category: '' }], -428.06), /Row 2: choose a category/);
    assert.match(validateAllocations([rows[0], { ...rows[1], amount: '' }], -428.06), /Row 2: enter an amount/);
  });

  it('rejects a zero share', () => {
    assert.match(validateAllocations([{ ...rows[0], amount: 0 }, rows[1]], -228.06), /cannot be zero/);
  });

  it('rejects a share whose sign disagrees with the transaction', () => {
    // A stray minus sign here would quietly turn an expense into income.
    const mixed = [{ ...rows[0], amount: 200 }, { ...rows[1], amount: -628.06 }];
    assert.match(validateAllocations(mixed, -428.06), /same sign/);
  });

  it('accepts shares that only reconcile in pence, not in floats', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point.
    assert.equal(validateAllocations([{ propertyId: 'p1', category: 'Rent', amount: 0.1 }, { propertyId: 'p2', category: 'Rent', amount: 0.2 }], 0.3), null);
  });
});

describe('splitEvenly', () => {
  it('splits a clean amount evenly', () => {
    assert.deepEqual(splitEvenly(-400, 2), [-200, -200]);
  });

  it('gives odd pennies to the earliest rows so the parts still total', () => {
    const parts = splitEvenly(100, 3);
    assert.deepEqual(parts, [33.34, 33.33, 33.33]);
    assert.equal(sumAllocations(parts.map((amount) => ({ amount }))), 100);
  });

  it('keeps the sign of a negative total', () => {
    const parts = splitEvenly(-428.06, 3);
    assert.ok(parts.every((p) => p < 0));
    assert.equal(sumAllocations(parts.map((amount) => ({ amount }))), -428.06);
  });
});

describe('normaliseAllocations', () => {
  it('rounds entered strings to the penny', () => {
    const rows = normaliseAllocations([{ propertyId: 'p1', category: 'Rent', amount: '10.005' }]);
    assert.deepEqual(rows, [{ propertyId: 'p1', category: 'Rent', amount: 10.01 }]);
  });
});
