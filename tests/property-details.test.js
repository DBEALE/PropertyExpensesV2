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

  it('keeps the old record and closes it off on the new effective date', () => {
    const { record: next, superseded } = supersede({
      records: existing,
      propertyId: 'p1',
      section: 'tenancy',
      data: { tenantName: 'S Agyapong', rentAmount: '1150' },
      effectiveFrom: '2026-06-01',
      recordedAt: '2026-05-20T10:00:00.000Z',
      id: 'new-1',
    });

    assert.equal(superseded.supersededOn, '2026-06-01');
    assert.equal(superseded.data.rentAmount, '1100', 'the old figures are untouched');
    assert.equal(next.supersededOn, null);
    assert.equal(next.data.rentAmount, '1150');
  });

  it('has nothing to supersede the first time a section is filled in', () => {
    const { superseded } = supersede({
      records: [],
      propertyId: 'p1',
      section: 'address',
      data: { line1: '3 Peterborough Gate' },
      effectiveFrom: '2026-01-01',
      recordedAt: '2026-01-01T00:00:00.000Z',
      id: 'a1',
    });
    assert.equal(superseded, null);
  });

  it('copies the data rather than aliasing the caller\'s object', () => {
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
      ['Insurance renewal', 'Fixed rate ends'],
    );
  });

  it('ignores dates beyond the window and dates already past', () => {
    assert.deepEqual(upcomingDates(records, 'p1', '2026-08-01', 5), []);
    assert.deepEqual(upcomingDates(records, 'p1', '2026-10-01', 90), []);
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
