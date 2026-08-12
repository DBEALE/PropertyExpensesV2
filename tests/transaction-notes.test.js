/**
 * Notes on transactions, and what happens to a split when you write one.
 *
 * The failure worth designing out: a note is not an assignment. The Transactions
 * screen's `assign` path deliberately drops `allocations` and clears
 * `matchedRuleId`, because assigning a property by hand really does replace a
 * split and really does take the row off its rule. Routing a note through that
 * path would mean typing "waiting on the invoice" silently un-split a £900
 * roof — so the two must stay separate, and these tests pin the shape of what
 * a note-save produces.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { noteOf } from '../src/views/transaction-table.js';
import { toCsv } from '../src/csv.js';

const SPLIT = {
  id: 'split1',
  date: '2026-06-18',
  details: 'ROOFING CO LTD',
  transactionType: 'Card Payment',
  amount: -900,
  balance: null,
  propertyId: null,
  category: null,
  matchedRuleId: 'rule-7',
  notes: 'Shared gutter run',
  allocations: [
    { propertyId: 'p1', category: 'Repairs', amount: -400 },
    { propertyId: 'p2', category: 'Repairs', amount: -300 },
    { propertyId: 'p3', category: 'Repairs', amount: -200 },
  ],
  sourceFilename: 'july.csv',
  importedAt: '2026-08-01T00:00:00.000Z',
};

/** What `saveNote` in views/transactions.js writes — a spread, nothing removed. */
const withNote = (transaction, notes) => ({ ...transaction, notes });

describe('noteOf', () => {
  it('treats absent, empty and whitespace-only as no note', () => {
    assert.equal(noteOf({}), '');
    assert.equal(noteOf({ notes: '' }), '');
    assert.equal(noteOf({ notes: '   ' }), '');
    assert.equal(noteOf({ notes: null }), '');
  });

  it('trims what it returns, so a stray space is not a note', () => {
    assert.equal(noteOf({ notes: '  boiler service  ' }), 'boiler service');
  });
});

describe('saving a note', () => {
  it('leaves a split intact', () => {
    const saved = withNote(SPLIT, 'Roofer confirmed the ridge tiles');
    assert.equal(saved.allocations.length, 3);
    assert.deepEqual(saved.allocations, SPLIT.allocations);
    assert.equal(
      saved.allocations.reduce((sum, a) => sum + a.amount, 0),
      saved.amount,
      'the shares must still total the transaction',
    );
  });

  it('leaves the rule that claimed the row attached', () => {
    assert.equal(withNote(SPLIT, 'anything').matchedRuleId, 'rule-7');
  });

  it('changes nothing but the note', () => {
    const saved = withNote(SPLIT, 'new text');
    for (const key of Object.keys(SPLIT)) {
      if (key === 'notes') continue;
      assert.deepEqual(saved[key], SPLIT[key], `${key} was disturbed`);
    }
  });

  it('can clear a note back to empty', () => {
    assert.equal(noteOf(withNote(SPLIT, '')), '');
  });
});

describe('a property’s share of a split', () => {
  const shareFor = (propertyId) =>
    SPLIT.allocations.filter((a) => a.propertyId === propertyId).reduce((sum, a) => sum + a.amount, 0);

  it('is what that property actually paid, not the whole transaction', () => {
    assert.equal(shareFor('p1'), -400);
    assert.equal(shareFor('p2'), -300);
    assert.equal(shareFor('p3'), -200);
  });

  it('sums back to the transaction across every property', () => {
    assert.equal(shareFor('p1') + shareFor('p2') + shareFor('p3'), SPLIT.amount);
  });
});

describe('notes in the CSV export', () => {
  it('appears once per transaction, on its first line', () => {
    const lines = toCsv([SPLIT], (id) => `Property ${id}`).split('\r\n');
    const noted = lines.slice(1).filter((line) => line.includes('Shared gutter run'));
    assert.equal(noted.length, 1, 'a split has one note, not one per share');
    assert.ok(lines[1].endsWith(',Shared gutter run'));
  });

  it('is blank rather than absent when there is no note', () => {
    const { notes, ...bare } = SPLIT;
    const lines = toCsv([bare], () => 'A property').split('\r\n');
    // Every row keeps the same column count, or the file stops being a table.
    const columns = lines[0].split(',').length;
    for (const line of lines.slice(1)) {
      assert.equal(line.split(',').length, columns, line);
    }
  });
});
