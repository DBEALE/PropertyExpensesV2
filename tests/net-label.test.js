/**
 * The Summary tab's net column names the period it is actually summing.
 *
 * The failure being designed out: a column headed "Net income 2026/27" over a
 * range that is not that tax year. A wrong label is worse than a vague one,
 * because the figure under it gets copied onto a tax return.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { netColumnLabel } from '../src/views/summary.js';

describe('netColumnLabel', () => {
  it('names a UK tax year when the range is exactly one', () => {
    const { label } = netColumnLabel('2026-04-06', '2027-04-05');
    assert.equal(label, 'Net income 2026/27');
  });

  it('names the tax year the range starts in, not the calendar year', () => {
    // 6 April 2025 to 5 April 2026 is 2025/26, spanning two calendar years.
    const { label } = netColumnLabel('2025-04-06', '2026-04-05');
    assert.equal(label, 'Net income 2025/26');
  });

  it('says "all dates" when nothing is filtered', () => {
    assert.equal(netColumnLabel('', '').label, 'Net income (all dates)');
  });

  it('refuses to call a calendar year a tax year', () => {
    const { label } = netColumnLabel('2026-01-01', '2026-12-31');
    assert.equal(label, 'Net income 01/01/2026 to 31/12/2026');
  });

  it('does not claim a tax year for a range one day short of it', () => {
    const { label } = netColumnLabel('2026-04-06', '2027-04-04');
    assert.ok(!label.includes('2026/27'), `expected a plain span, got "${label}"`);
  });

  it('describes a half-open range by the bound it actually has', () => {
    assert.equal(netColumnLabel('2026-04-06', '').label, 'Net income 06/04/2026 to today');
    assert.equal(netColumnLabel('', '2027-04-05').label, 'Net income the start to 05/04/2027');
  });

  it('always supplies a title spelling the period out in full', () => {
    for (const [from, to] of [
      ['2026-04-06', '2027-04-05'],
      ['', ''],
      ['2026-01-01', '2026-12-31'],
    ]) {
      const { title } = netColumnLabel(from, to);
      assert.ok(title.length > 0, `no title for ${from}..${to}`);
    }
  });
});
