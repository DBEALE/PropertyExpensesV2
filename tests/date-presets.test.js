import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL,
  CUSTOM,
  datePresetGroups,
  datePresets,
  matchPreset,
  presetByKey,
  taxYearLabel,
  taxYearOf,
} from '../src/date-presets.js';

const TODAY = '2026-08-09';

/** Statements spanning two calendar years and three tax years. */
const TRANSACTIONS = [
  { date: '2025-03-01' }, // 2024/25 tax year, 2025 calendar
  { date: '2025-06-01' }, // 2025/26 tax year
  { date: '2026-07-24' }, // 2026/27 tax year, 2026 calendar
];

const keys = (list) => list.map((p) => p.key);
const labels = (list) => list.map((p) => p.label);

describe('taxYearOf', () => {
  it('turns the year over on 6 April, not 1 January', () => {
    assert.equal(taxYearOf('2026-04-05'), 2025, '5 April still belongs to the old year');
    assert.equal(taxYearOf('2026-04-06'), 2026, '6 April starts the new one');
    assert.equal(taxYearOf('2026-01-31'), 2025);
    assert.equal(taxYearOf('2026-12-31'), 2026);
  });

  it('labels a tax year the way HMRC writes it', () => {
    assert.equal(taxYearLabel(2026), '2026/27');
    assert.equal(taxYearLabel(2099), '2099/00');
  });
});

describe('datePresetGroups', () => {
  const groups = datePresetGroups(TRANSACTIONS, TODAY);

  it('offers quick ranges, tax years and calendar years', () => {
    assert.deepEqual(labels(groups), ['Quick ranges', 'Tax years', 'Calendar years']);
  });

  it('always offers all dates and the rolling windows', () => {
    assert.deepEqual(keys(groups[0].options), [ALL, 'last-1m', 'last-3m', 'last-12m']);
    const all = groups[0].options[0];
    assert.deepEqual([all.from, all.to], ['', ''], 'all dates is an open range');
  });

  it('measures the rolling windows back from today', () => {
    const [, oneMonth, threeMonths, year] = groups[0].options;
    assert.deepEqual([oneMonth.from, oneMonth.to], ['2026-07-09', TODAY]);
    assert.deepEqual([threeMonths.from, threeMonths.to], ['2026-05-09', TODAY]);
    assert.deepEqual([year.from, year.to], ['2025-08-09', TODAY]);
  });

  it('lists only the tax years the data actually covers, newest first', () => {
    assert.deepEqual(labels(groups[1].options), [
      '2026/27 tax year',
      '2025/26 tax year',
      '2024/25 tax year',
    ]);
    assert.deepEqual(
      [groups[1].options[0].from, groups[1].options[0].to],
      ['2026-04-06', '2027-04-05'],
    );
  });

  it('lists only the calendar years the data covers, newest first', () => {
    assert.deepEqual(labels(groups[2].options), ['2026', '2025']);
    assert.deepEqual([groups[2].options[0].from, groups[2].options[0].to], ['2026-01-01', '2026-12-31']);
  });

  it('offers no year options at all before anything is imported', () => {
    const empty = datePresetGroups([], TODAY);
    assert.deepEqual(labels(empty), ['Quick ranges']);
  });

  it('does not repeat a year that has many transactions', () => {
    const busy = [{ date: '2026-01-01' }, { date: '2026-02-01' }, { date: '2026-03-01' }];
    const [, taxYears, calendarYears] = datePresetGroups(busy, TODAY);
    assert.equal(calendarYears.options.length, 1);
    // All three fall before 6 April, so they are one tax year, not three.
    assert.equal(taxYears.options.length, 1);
    assert.equal(taxYears.options[0].label, '2025/26 tax year');
  });
});

describe('presetByKey', () => {
  it('finds a preset by its key', () => {
    assert.equal(presetByKey(TRANSACTIONS, TODAY, 'cy-2025').from, '2025-01-01');
    assert.equal(presetByKey(TRANSACTIONS, TODAY, 'ty-2026').to, '2027-04-05');
  });

  it('returns nothing for a key that is not offered', () => {
    assert.equal(presetByKey(TRANSACTIONS, TODAY, 'cy-1999'), null);
    assert.equal(presetByKey(TRANSACTIONS, TODAY, CUSTOM), null);
  });
});

describe('matchPreset', () => {
  it('recognises a range that came from a preset', () => {
    assert.equal(matchPreset(TRANSACTIONS, TODAY, '2026-04-06', '2027-04-05'), 'ty-2026');
    assert.equal(matchPreset(TRANSACTIONS, TODAY, '2025-01-01', '2025-12-31'), 'cy-2025');
    assert.equal(matchPreset(TRANSACTIONS, TODAY, '', ''), ALL);
  });

  it('reports a hand-typed range as custom rather than claiming a preset', () => {
    assert.equal(matchPreset(TRANSACTIONS, TODAY, '2026-05-01', '2026-05-31'), CUSTOM);
    // One bound changed is no longer that preset.
    assert.equal(matchPreset(TRANSACTIONS, TODAY, '2026-04-06', '2027-04-04'), CUSTOM);
  });
});

describe('datePresets', () => {
  it('flattens every group for lookups', () => {
    const flat = datePresets(TRANSACTIONS, TODAY);
    assert.equal(flat.length, 4 + 3 + 2);
    assert.ok(flat.every((p) => typeof p.from === 'string' && typeof p.to === 'string'));
  });

  it('never produces a range whose start is after its end', () => {
    for (const preset of datePresets(TRANSACTIONS, TODAY)) {
      if (preset.from && preset.to) assert.ok(preset.from <= preset.to, `${preset.key} is inverted`);
    }
  });
});
