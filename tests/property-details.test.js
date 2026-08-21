/**
 * Dated property records: what is in force now, what it replaced, and the
 * figures computed from them.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildBackup, validateBackup } from '../src/backup.js';
import {
  SECTIONS,
  currentRecord,
  equity,
  historyFor,
  isExpired,
  loanToValue,
  sectionByKey,
  supersede,
  upcomingDates,
} from '../src/property-details.js';

function record(section, effectiveFrom, data, extra = {}) {
  return {
    id: `${section}-${effectiveFrom}`,
    propertyId: 'p1',
    section,
    effectiveFrom,
    recordedAt: `${effectiveFrom}T09:00:00.000Z`,
    supersededOn: null,
    data,
    ...extra,
  };
}

describe('sections', () => {
  it('covers everything a landlord needs against a property', () => {
    assert.deepEqual(
      SECTIONS.map((s) => s.key),
      ['address', 'insurance', 'mortgage', 'valuation', 'tenancy'],
    );
  });

  it('stores no password field anywhere — the backup file is plain text', () => {
    const fields = SECTIONS.flatMap((s) => s.fields.map((f) => f.key.toLowerCase()));
    assert.equal(
      fields.some((f) => f.includes('password') || f.includes('passcode') || f.includes('pin')),
      false,
    );
  });

  it('does record where to log in and as whom', () => {
    const mortgage = sectionByKey('mortgage').fields.map((f) => f.key);
    assert.ok(mortgage.includes('loginUrl'));
    assert.ok(mortgage.includes('loginUsername'));
  });
});

describe('currentRecord', () => {
  const records = [
    record('mortgage', '2024-01-01', { lender: 'Old Bank', rate: '2.1' }),
    record('mortgage', '2026-03-01', { lender: 'NatWest', rate: '4.8' }),
  ];

  it('returns the latest version in force', () => {
    assert.equal(currentRecord(records, 'p1', 'mortgage').data.lender, 'NatWest');
  });

  it('answers what was in force on an earlier date', () => {
    assert.equal(currentRecord(records, 'p1', 'mortgage', '2025-06-01').data.lender, 'Old Bank');
  });

  it('returns nothing for a date before anything was recorded', () => {
    assert.equal(currentRecord(records, 'p1', 'mortgage', '2023-01-01'), null);
  });

  it('does not leak records from another property or section', () => {
    assert.equal(currentRecord(records, 'p2', 'mortgage'), null);
    assert.equal(currentRecord(records, 'p1', 'tenancy'), null);
  });

  it('breaks a same-day tie by when it was recorded', () => {
    const sameDay = [
      record('insurance', '2026-01-01', { provider: 'First' }, { recordedAt: '2026-01-01T09:00:00Z' }),
      { ...record('insurance', '2026-01-01', { provider: 'Corrected' }), id: 'x', recordedAt: '2026-01-01T17:00:00Z' },
    ];
    assert.equal(currentRecord(sameDay, 'p1', 'insurance').data.provider, 'Corrected');
  });
});

describe('supersede', () => {
  const existing = [record('tenancy', '2025-06-01', { tenantName: 'S Agyapong', rentAmount: '1100' })];

  const file = (records, effectiveFrom, data, recordedAt = '2026-05-20T10:00:00.000Z') =>
    supersede({ records, propertyId: 'p1', section: 'tenancy', data, effectiveFrom, recordedAt, id: 'new-1' });

  it('keeps the old record and closes it off on the new effective date', () => {
    const { record: next, rewritten, inForce } = file(existing, '2026-06-01', { rentAmount: '1150' });

    assert.equal(rewritten.length, 1);
    assert.equal(rewritten[0].supersededOn, '2026-06-01');
    assert.equal(rewritten[0].data.rentAmount, '1100', 'the old figures are untouched');
    assert.equal(next.supersededOn, null);
    assert.equal(next.data.rentAmount, '1150');
    assert.equal(inForce, true);
  });

  it('has nothing to rewrite the first time a section is filled in', () => {
    const { rewritten, inForce } = supersede({
      records: [],
      propertyId: 'p1',
      section: 'address',
      data: { line1: '3 Peterborough Gate' },
      effectiveFrom: '2026-01-01',
      recordedAt: '2026-01-01T00:00:00.000Z',
      id: 'a1',
    });
    assert.deepEqual(rewritten, []);
    assert.equal(inForce, true);
  });

  it("copies the data rather than aliasing the caller's object", () => {
    const data = { lender: 'NatWest' };
    const { record: next } = supersede({
      records: [],
      propertyId: 'p1',
      section: 'mortgage',
      data,
      effectiveFrom: '2026-01-01',
      recordedAt: '2026-01-01T00:00:00.000Z',
      id: 'm1',
    });
    data.lender = 'Changed after the fact';
    assert.equal(next.data.lender, 'NatWest');
  });

  it('files a backdated record behind the one in force, without disturbing it', () => {
    // The case the old "cannot start before" restriction refused: entering a
    // record you only found out about after a later one was already saved.
    const { record: next, rewritten, inForce } = file(existing, '2024-01-01', { rentAmount: '900' });

    assert.equal(inForce, false, 'an older record does not become the current one');
    assert.equal(next.supersededOn, '2025-06-01', 'it hands over to the record that follows it');
    assert.deepEqual(rewritten, [], 'the record in force is left completely alone');
  });

  it('never marks the record in force as superseded by an older one', () => {
    // Exactly what the previous implementation did once backdating was allowed:
    // it paired the new record with whatever was current, whichever way round
    // the dates ran.
    const { rewritten } = file(existing, '2024-01-01', { rentAmount: '900' });
    for (const entry of rewritten) {
      assert.ok(
        entry.supersededOn === null || entry.supersededOn > entry.effectiveFrom,
        `${entry.id} would hand over on ${entry.supersededOn}, before it even began`,
      );
    }
  });

  it('rewires both neighbours when a record lands in the middle', () => {
    const timeline = [
      record('tenancy', '2024-01-01', { rentAmount: '900' }),
      record('tenancy', '2026-01-01', { rentAmount: '1200' }),
    ];
    const { record: next, rewritten } = file(timeline, '2025-01-01', { rentAmount: '1050' });

    assert.equal(next.supersededOn, '2026-01-01', 'hands over to the one after it');
    const earlier = rewritten.find((r) => r.effectiveFrom === '2024-01-01');
    assert.equal(earlier.supersededOn, '2025-01-01', 'the one before now hands over to it');
    assert.ok(!rewritten.some((r) => r.effectiveFrom === '2026-01-01'), 'the later one is untouched');
  });

  it('rewrites only the neighbours, not the whole timeline', () => {
    // A section with years of history should not rewrite every row to add one.
    // The fixture is already consistent — each record hands over to the next —
    // so only the record the new one displaces has anything to change.
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...record('tenancy', `202${i}-01-01`, { rentAmount: `${i}` }),
      supersededOn: i < 5 ? `202${i + 1}-01-01` : null,
    }));
    const { rewritten } = file(many, '2026-06-01', { rentAmount: 'new' });
    assert.equal(rewritten.length, 1, `rewrote ${rewritten.length} records to append one`);
    assert.equal(rewritten[0].effectiveFrom, '2025-01-01', 'only the record it follows');
  });

  it('repairs a timeline that was already inconsistent', () => {
    // Records written by the previous implementation could carry a hand-over
    // date that predates the record itself. Recomputing the whole run means
    // saving anything into that section quietly puts the dates back in order.
    const broken = [
      { ...record('tenancy', '2024-01-01', { rentAmount: 'a' }), supersededOn: null },
      { ...record('tenancy', '2025-01-01', { rentAmount: 'b' }), supersededOn: '2020-01-01' },
    ];
    const { rewritten } = file(broken, '2026-01-01', { rentAmount: 'c' });
    const byStart = Object.fromEntries(rewritten.map((r) => [r.effectiveFrom, r.supersededOn]));
    assert.equal(byStart['2024-01-01'], '2025-01-01');
    assert.equal(byStart['2025-01-01'], '2026-01-01', 'the nonsense date is corrected');
  });

  it('leaves a consistent timeline whatever order records are entered in', () => {
    // Enter three records back to front; every hand-over must still line up
    // with the next record's start, and only the last may be open-ended.
    let records = [];
    for (const [effectiveFrom, rent] of [['2026-01-01', 'c'], ['2024-01-01', 'a'], ['2025-01-01', 'b']]) {
      const result = supersede({
        records,
        propertyId: 'p1',
        section: 'tenancy',
        data: { rentAmount: rent },
        effectiveFrom,
        recordedAt: `2026-07-0${records.length + 1}T00:00:00.000Z`,
        id: rent,
      });
      const changed = new Map(result.rewritten.map((r) => [r.id, r]));
      records = [...records.map((r) => changed.get(r.id) ?? r), result.record];
    }

    const timeline = [...records].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    assert.deepEqual(timeline.map((r) => r.data.rentAmount), ['a', 'b', 'c']);
    assert.equal(timeline[0].supersededOn, '2025-01-01');
    assert.equal(timeline[1].supersededOn, '2026-01-01');
    assert.equal(timeline[2].supersededOn, null, 'only the last is still in force');
    assert.equal(currentRecord(records, 'p1', 'tenancy').data.rentAmount, 'c');
  });
});

describe('historyFor', () => {
  it('lists superseded versions newest first, excluding the current one', () => {
    const records = [
      record('mortgage', '2022-01-01', { lender: 'A' }),
      record('mortgage', '2024-01-01', { lender: 'B' }),
      record('mortgage', '2026-01-01', { lender: 'C' }),
    ];
    assert.deepEqual(
      historyFor(records, 'p1', 'mortgage').map((r) => r.data.lender),
      ['B', 'A'],
    );
  });

  it('is empty when only one version exists', () => {
    assert.deepEqual(historyFor([record('address', '2026-01-01', {})], 'p1', 'address'), []);
  });
});

describe('isExpired', () => {
  it('marks a record that has been replaced', () => {
    assert.equal(isExpired({ supersededOn: '2026-01-01' }), true);
    assert.equal(isExpired({ supersededOn: null }), false);
  });
});

describe('loanToValue and equity', () => {
  const mortgage = record('mortgage', '2026-01-01', { amount: '135000' });
  const valuation = record('valuation', '2026-01-01', { value: '250000' });

  it('computes LTV as a percentage to one decimal', () => {
    assert.equal(loanToValue(mortgage, valuation), 54);
    assert.equal(loanToValue(record('m', '2026-01-01', { amount: '100000' }), valuation), 40);
  });

  it('computes equity as value less debt', () => {
    assert.equal(equity(mortgage, valuation), 115000);
  });

  it('treats a property with no mortgage as fully owned', () => {
    assert.equal(equity(null, valuation), 250000);
  });

  it('returns null rather than inventing a figure when data is missing', () => {
    assert.equal(loanToValue(mortgage, null), null);
    assert.equal(loanToValue(null, valuation), null);
    assert.equal(loanToValue(mortgage, record('v', '2026-01-01', { value: '0' })), null);
    assert.equal(equity(mortgage, null), null);
  });

  it('copes with figures typed with a currency symbol or commas', () => {
    const typed = record('valuation', '2026-01-01', { value: '£250,000' });
    assert.equal(loanToValue(mortgage, typed), 54);
  });
});

describe('upcomingDates', () => {
  const records = [
    record('mortgage', '2026-01-01', { lender: 'NatWest', fixEndDate: '2026-09-30' }),
    record('insurance', '2026-01-01', { provider: 'Direct Line', renewalDate: '2026-08-15' }),
    record('tenancy', '2026-01-01', { tenantName: 'S Agyapong', endDate: '2027-06-01' }),
  ];

  it('reports what falls due soon, soonest first', () => {
    const due = upcomingDates(records, 'p1', '2026-08-01', 90);
    assert.deepEqual(
      due.map((d) => d.label),
      // Insurance is 14 days off, so it is named for the state it is in.
      ['Insurance cover expires', 'Fixed rate ends'],
    );
  });

  it('ignores dates beyond the window', () => {
    assert.deepEqual(upcomingDates(records, 'p1', '2026-08-01', 5), []);
  });

  it('grades an approaching insurance renewal as a warning', () => {
    const [insurance] = upcomingDates(records, 'p1', '2026-08-01', 90);
    assert.equal(insurance.dueSoon, true);
    assert.equal(insurance.overdue, false);
    // Two months out it is a diary entry again, under its plain name.
    const [ahead] = upcomingDates(records, 'p1', '2026-06-01', 90);
    assert.equal(ahead.label, 'Insurance renewal');
    assert.equal(ahead.dueSoon, false);
  });

  it('keeps lapsed insurance on the list however long ago it went', () => {
    // An uninsured house is a fault to chase, not an event that has passed, so
    // unlike the others it does not drop off once the date is behind you.
    const lapsed = upcomingDates(records, 'p1', '2027-02-01', 90);
    assert.deepEqual(
      lapsed.map((d) => d.label),
      ['Insurance cover lapsed'],
    );
    assert.equal(lapsed[0].overdue, true);
    assert.equal(lapsed[0].date, '2026-08-15');
  });

  it('drops the dates that are merely events once they are past', () => {
    // The fixed rate ended and the tenancy ends later; neither leaves the
    // property exposed, so from 2028 only nothing is left.
    const after = upcomingDates(records, 'p1', '2028-01-01', 90);
    assert.deepEqual(
      after.map((d) => d.label),
      ['Insurance cover lapsed'],
    );
  });

  it('reads the version in force, not a superseded one', () => {
    const replaced = [
      record('insurance', '2024-01-01', { renewalDate: '2026-08-15' }),
      record('insurance', '2026-02-01', { renewalDate: '2026-08-20' }),
    ];
    assert.equal(upcomingDates(replaced, 'p1', '2026-08-01', 90)[0].date, '2026-08-20');
  });
});

describe('backup of property details', () => {
  const state = {
    properties: [{ id: 'p1', name: '3 Peterborough Gate' }],
    categories: [{ id: 'Rent', name: 'Rent', description: '' }],
    propertyDetails: [
      record('mortgage', '2024-01-01', { lender: 'Old Bank' }, { supersededOn: '2026-03-01' }),
      record('mortgage', '2026-03-01', { lender: 'NatWest' }),
    ],
    rules: [],
    transactions: [],
  };

  it('round-trips the current record and its history', () => {
    const restored = validateBackup(JSON.parse(JSON.stringify(buildBackup(state, '2026-08-01T00:00:00Z'))));
    assert.equal(restored.propertyDetails.length, 2);
    assert.equal(currentRecord(restored.propertyDetails, 'p1', 'mortgage').data.lender, 'NatWest');
    assert.equal(historyFor(restored.propertyDetails, 'p1', 'mortgage')[0].data.lender, 'Old Bank');
  });

  it('accepts an older backup that has no property details at all', () => {
    const older = {
      format: 'property-expenses-backup',
      properties: [],
      rules: [],
      transactions: [],
    };
    assert.deepEqual(validateBackup(older).propertyDetails, []);
  });

  it('rejects a malformed detail record', () => {
    const backup = JSON.parse(JSON.stringify(buildBackup(state, '2026-08-01T00:00:00Z')));
    delete backup.propertyDetails[0].effectiveFrom;
    assert.throws(() => validateBackup(backup), /property details/i);
  });
});
