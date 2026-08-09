import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ariaSort, compareValues, sortIndicator, sortRows, toggleSort } from '../src/sort.js';

const ROWS = [
  { name: 'Elm Road', amount: -428.06, date: '2026-07-30', notes: '' },
  { name: 'peterborough gate', amount: 1150, date: '2026-07-24', notes: 'tenant' },
  { name: 'Ash Close', amount: -30.16, date: '2026-07-30', notes: null },
];

const accessors = {
  name: (r) => r.name,
  amount: (r) => r.amount,
  date: (r) => r.date,
  notes: (r) => r.notes,
};

describe('toggleSort', () => {
  it('sorts by a new column in the direction that column prefers', () => {
    assert.deepEqual(toggleSort({ key: null, dir: 'asc' }, 'name'), { key: 'name', dir: 'asc' });
    assert.deepEqual(toggleSort({ key: null, dir: 'asc' }, 'amount', 'desc'), { key: 'amount', dir: 'desc' });
  });

  it('reverses when the same column is clicked again', () => {
    const state = { key: 'name', dir: 'asc' };
    assert.equal(toggleSort(state, 'name').dir, 'desc');
    assert.equal(toggleSort(state, 'name').dir, 'asc');
  });

  it('starts fresh when a different column is clicked', () => {
    const state = { key: 'name', dir: 'desc' };
    assert.deepEqual(toggleSort(state, 'amount', 'desc'), { key: 'amount', dir: 'desc' });
  });
});

describe('compareValues', () => {
  it('compares numbers numerically, not as text', () => {
    assert.ok(compareValues(9, 100) < 0);
    assert.ok(compareValues(-428.06, -30.16) < 0);
  });

  it('compares text case-insensitively', () => {
    assert.ok(compareValues('apple', 'Banana') < 0);
    assert.equal(compareValues('Rent', 'rent'), 0);
  });

  it('orders text containing numbers the way a person would', () => {
    assert.ok(compareValues('Flat 2', 'Flat 10') < 0);
  });

  it('treats ISO dates as sortable text', () => {
    assert.ok(compareValues('2026-07-24', '2026-07-30') < 0);
  });
});

describe('sortRows', () => {
  it('leaves the order alone when no column is selected', () => {
    assert.deepEqual(sortRows(ROWS, { key: null, dir: 'asc' }, accessors), ROWS);
  });

  it('sorts ascending and descending by text', () => {
    assert.deepEqual(
      sortRows(ROWS, { key: 'name', dir: 'asc' }, accessors).map((r) => r.name),
      ['Ash Close', 'Elm Road', 'peterborough gate'],
    );
    assert.deepEqual(
      sortRows(ROWS, { key: 'name', dir: 'desc' }, accessors).map((r) => r.name),
      ['peterborough gate', 'Elm Road', 'Ash Close'],
    );
  });

  it('sorts by amount with negatives below zero', () => {
    assert.deepEqual(
      sortRows(ROWS, { key: 'amount', dir: 'asc' }, accessors).map((r) => r.amount),
      [-428.06, -30.16, 1150],
    );
  });

  it('does not mutate the array it was given', () => {
    const original = [...ROWS];
    sortRows(ROWS, { key: 'name', dir: 'desc' }, accessors);
    assert.deepEqual(ROWS, original);
  });

  it('keeps the original order for equal values, so sorting is stable', () => {
    const byDate = sortRows(ROWS, { key: 'date', dir: 'asc' }, accessors);
    // Two rows share 2026-07-30; Elm Road came first in the input.
    assert.deepEqual(byDate.map((r) => r.name), ['peterborough gate', 'Elm Road', 'Ash Close']);
  });

  it('sinks blanks to the bottom in BOTH directions', () => {
    const asc = sortRows(ROWS, { key: 'notes', dir: 'asc' }, accessors);
    const desc = sortRows(ROWS, { key: 'notes', dir: 'desc' }, accessors);
    assert.equal(asc[0].notes, 'tenant');
    assert.equal(desc[0].notes, 'tenant');
    // An empty cell is missing information, not the smallest value.
    assert.ok(asc.slice(1).every((r) => !r.notes));
    assert.ok(desc.slice(1).every((r) => !r.notes));
  });

  it('ignores a column with no accessor rather than emptying the table', () => {
    assert.deepEqual(sortRows(ROWS, { key: 'nonsense', dir: 'asc' }, accessors), ROWS);
  });
});

describe('heading state', () => {
  it('marks only the active column, with a direction arrow', () => {
    const state = { key: 'amount', dir: 'desc' };
    assert.equal(ariaSort(state, 'amount'), 'descending');
    assert.equal(ariaSort(state, 'name'), 'none');
    assert.equal(sortIndicator(state, 'amount'), ' ▼');
    assert.equal(sortIndicator({ key: 'amount', dir: 'asc' }, 'amount'), ' ▲');
    assert.equal(sortIndicator(state, 'name'), '');
  });
});
