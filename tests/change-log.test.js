/**
 * The log of what has been edited since the last backup.
 *
 * The thing it must not become is an archive: it answers one question — "is
 * the last hour's work worth backing up" — and a list you have to scroll is a
 * list you stop reading. So the tests here are about the shape that keeps it
 * short: newest first, grouped by day, and capped.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_ENTRIES, byDay, newestFirst, overflowIds, plural } from '../src/change-log.js';

const entry = (id, at, summary = 'something') => ({ id, at, kind: 'transaction', summary });

describe('newestFirst', () => {
  it('puts the most recent change at the top', () => {
    const entries = [
      entry('a', '2026-08-10T09:00:00.000Z'),
      entry('c', '2026-08-13T17:30:00.000Z'),
      entry('b', '2026-08-11T12:00:00.000Z'),
    ];
    assert.deepEqual(
      newestFirst(entries).map((e) => e.id),
      ['c', 'b', 'a'],
    );
  });

  it('does not disturb the array it was given', () => {
    const entries = [entry('a', '2026-08-10T09:00:00.000Z'), entry('b', '2026-08-13T09:00:00.000Z')];
    newestFirst(entries);
    assert.equal(entries[0].id, 'a');
  });
});

describe('overflowIds', () => {
  it('keeps everything while the log is within the cap', () => {
    const entries = Array.from({ length: 5 }, (_, i) => entry(`e${i}`, `2026-08-0${i + 1}T09:00:00.000Z`));
    assert.deepEqual(overflowIds(entries, 10), []);
  });

  it('drops the oldest, never the newest', () => {
    const entries = Array.from({ length: 6 }, (_, i) => entry(`e${i}`, `2026-08-0${i + 1}T09:00:00.000Z`));
    // e0 is the oldest, e5 the newest; a cap of 4 sheds the two oldest.
    assert.deepEqual(overflowIds(entries, 4).sort(), ['e0', 'e1']);
  });

  it('has a cap, so an un-backed-up year cannot grow without bound', () => {
    assert.ok(Number.isInteger(MAX_ENTRIES) && MAX_ENTRIES > 0);
    const entries = Array.from({ length: MAX_ENTRIES + 3 }, (_, i) =>
      entry(`e${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()),
    );
    assert.equal(overflowIds(entries).length, 3);
  });
});

describe('byDay', () => {
  it('groups entries under the day they happened, newest day first', () => {
    const entries = [
      entry('a', '2026-08-11T09:00:00.000Z'),
      entry('b', '2026-08-13T08:00:00.000Z'),
      entry('c', '2026-08-13T17:30:00.000Z'),
    ];
    const days = byDay(entries);
    assert.deepEqual(
      days.map((d) => d.day),
      ['2026-08-13', '2026-08-11'],
    );
    assert.deepEqual(days[0].entries.map((e) => e.id), ['c', 'b'], 'newest first inside a day too');
    assert.deepEqual(days[1].entries.map((e) => e.id), ['a']);
  });

  it('is empty for an empty log rather than a day with nothing in it', () => {
    assert.deepEqual(byDay([]), []);
  });
});

describe('plural', () => {
  it('reads properly either way, because the log is prose', () => {
    assert.equal(plural(1, 'transaction'), '1 transaction');
    assert.equal(plural(3, 'transaction'), '3 transactions');
    assert.equal(plural(0, 'transaction'), '0 transactions');
  });

  it('takes an irregular plural when one is needed', () => {
    assert.equal(plural(2, 'property', 'properties'), '2 properties');
    assert.equal(plural(1, 'property', 'properties'), '1 property');
  });
});
