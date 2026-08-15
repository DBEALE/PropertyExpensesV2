/**
 * Records that exist but do not say enough.
 *
 * The design constraint these tests defend is that the list stays short enough
 * to act on: a check fires only on a record you chose to keep, and only where
 * the blank actually costs you something. A nag you cannot avoid is a nag you
 * learn to scroll past, which would make the whole attention system worth less
 * than it was before.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STALE_VALUATION_MONTHS, monthsBetween, recordGaps } from '../src/record-gaps.js';

const TODAY = '2026-08-15';

/** One detail record for a property. */
const detail = (section, data, effectiveFrom = '2025-01-01') => ({
  id: `d-${section}`,
  propertyId: 'p1',
  section,
  effectiveFrom,
  data,
});

const ids = (records) => recordGaps(records, 'p1', TODAY).map((g) => g.id);

describe('monthsBetween', () => {
  it('counts whole months only', () => {
    assert.equal(monthsBetween('2026-01-15', '2026-08-15'), 7);
    assert.equal(monthsBetween('2026-01-16', '2026-08-15'), 6, 'a part month does not count');
    assert.equal(monthsBetween('2025-08-15', '2026-08-15'), 12);
  });

  it('never goes negative for a date in the future', () => {
    assert.equal(monthsBetween('2027-01-01', '2026-08-15'), 0);
  });
});

describe('a section that has never been recorded', () => {
  it('produces no gaps at all', () => {
    // That is the "Still to add" prompt's business. Saying it in both places
    // would count one absence twice.
    assert.deepEqual(recordGaps([], 'p1', TODAY), []);
  });
});

describe('valuation', () => {
  it('goes stale after the allowed months', () => {
    assert.equal(STALE_VALUATION_MONTHS, 12, 'these dates are chosen against a 12-month window');
    const fresh = detail('valuation', { value: '200000', valuedOn: '2025-09-01' });
    const stale = detail('valuation', { value: '200000', valuedOn: '2025-08-01' });
    assert.ok(!ids([fresh]).includes('valuation-stale'), 'eleven months is still current');
    assert.ok(ids([stale]).includes('valuation-stale'));
  });

  it('says how old it is, since "stale" alone is not actionable', () => {
    const [gap] = recordGaps([detail('valuation', { value: '1', valuedOn: '2025-02-15' })], 'p1', TODAY);
    assert.match(gap.label, /18 months old/);
  });

  it('falls back to the date the record took effect when none was given', () => {
    // The best evidence available of when the figure was true.
    const old = detail('valuation', { value: '200000' }, '2024-01-01');
    assert.ok(ids([old]).includes('valuation-stale'));
    const recent = detail('valuation', { value: '200000' }, '2026-05-01');
    assert.ok(!ids([recent]).includes('valuation-stale'));
  });

  it('flags a valuation with no figure in it', () => {
    assert.ok(ids([detail('valuation', { source: 'Estate agent' })]).includes('valuation-amount'));
  });
});

describe('mortgage', () => {
  it('flags a missing balance, which LTV and equity are computed from', () => {
    assert.ok(ids([detail('mortgage', { lender: 'NatWest' })]).includes('mortgage-balance'));
  });

  it('says nothing when the property is owned outright', () => {
    // Owned outright is an answer, not a gap: the balance is zero and every
    // figure works out fine without it.
    assert.deepEqual(ids([detail('mortgage', { ownedOutright: 'yes' })]), []);
  });
});

describe('insurance', () => {
  it('flags a policy with no renewal date, which is what expiry is tracked from', () => {
    assert.ok(ids([detail('insurance', { provider: 'Aviva' })]).includes('insurance-renewal'));
  });

  it('is quiet once there is one', () => {
    assert.deepEqual(ids([detail('insurance', { provider: 'Aviva', renewalDate: '2027-01-01' })]), []);
  });
});

describe('tenancy', () => {
  const tenancy = (data) => ids([detail('tenancy', data)]);

  it('flags a missing deposit', () => {
    assert.ok(tenancy({ tenantName: 'A', startDate: '2025-01-01', rentAmount: '900' }).includes('tenancy-deposit'));
  });

  it('flags a deposit that is not recorded as protected', () => {
    // A deposit taken and not protected within 30 days is a penalty of one to
    // three times the deposit — the costliest blank in the app.
    const gaps = tenancy({ tenantName: 'A', startDate: '2025-01-01', rentAmount: '900', depositAmount: '1200' });
    assert.ok(gaps.includes('tenancy-deposit-scheme'));
    assert.ok(!gaps.includes('tenancy-deposit'), 'the deposit itself is recorded');
  });

  it('does not ask about a scheme when there is no deposit to protect', () => {
    const gaps = tenancy({ tenantName: 'A', startDate: '2025-01-01', rentAmount: '900' });
    assert.ok(!gaps.includes('tenancy-deposit-scheme'));
  });

  it('flags a missing rent, which is what a missed payment is spotted against', () => {
    assert.ok(
      tenancy({ tenantName: 'A', startDate: '2025-01-01', depositAmount: '1', depositScheme: 'DPS' }).includes(
        'tenancy-rent',
      ),
    );
  });

  it('flags a missing start date, which retires a former tenant’s rent', () => {
    assert.ok(
      tenancy({ tenantName: 'A', rentAmount: '900', depositAmount: '1', depositScheme: 'DPS' }).includes(
        'tenancy-start',
      ),
    );
  });

  it('is quiet when the tenancy says everything it needs to', () => {
    assert.deepEqual(
      tenancy({
        tenantName: 'A',
        startDate: '2025-01-01',
        rentAmount: '900',
        depositAmount: '1200',
        depositScheme: 'DPS',
      }),
      [],
    );
  });
});

describe('what the list does not nag about', () => {
  it('ignores fields nobody needs filled in', () => {
    // A missing broker, county or policy number is nobody's problem, and every
    // one of them on the list would bury the deposit that is not protected.
    const records = [
      detail('address', { line1: '1 Test Street' }),
      detail('insurance', { provider: 'Aviva', renewalDate: '2027-01-01' }),
      detail('mortgage', { lender: 'NatWest', amount: '120000' }),
      detail('valuation', { value: '200000', valuedOn: '2026-05-01' }),
      detail('tenancy', {
        tenantName: 'A',
        startDate: '2025-01-01',
        rentAmount: '900',
        depositAmount: '1200',
        depositScheme: 'DPS',
      }),
    ];
    assert.deepEqual(recordGaps(records, 'p1', TODAY), []);
  });

  it('names the section each gap belongs to, so a link can land on it', () => {
    const gaps = recordGaps([detail('tenancy', { tenantName: 'A' })], 'p1', TODAY);
    assert.ok(gaps.length > 0);
    for (const gap of gaps) assert.equal(gap.section, 'tenancy');
  });

  it('reads the version in force, not a superseded one', () => {
    const records = [
      detail('valuation', { value: '150000', valuedOn: '2020-01-01' }, '2020-01-01'),
      { ...detail('valuation', { value: '200000', valuedOn: '2026-05-01' }, '2026-05-01'), id: 'newer' },
    ];
    assert.deepEqual(recordGaps(records, 'p1', TODAY), []);
  });
});
