/**
 * What a property wants from you, and how loudly.
 *
 * The point of collecting this in one module was that four places used to
 * count it separately and could disagree — the tab badge saying two while the
 * page listed three. So these tests are mostly about the *grades* being kept
 * apart: overdue is not due-soon, due-soon is not merely upcoming, and a
 * missing record is not a deadline at all.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attentionFor, attentionTotal } from '../src/attention.js';
import { complianceStatus, isExempt } from '../src/compliance.js';
import { DUE_SOON_DAYS } from '../src/dates.js';
import { SECTIONS, isOwnedOutright, missingSections } from '../src/property-details.js';

const TODAY = '2026-08-12';

const TYPES = [
  { id: 'gas', name: 'Gas Safety', frequencyMonths: 12 },
  { id: 'eicr', name: 'EICR', frequencyMonths: 60 },
];

const PROPERTIES = [{ id: 'p1', name: 'Ash Close' }];

/** A detail record, so a section counts as filled in. */
function detail(section, data = { note: 'x' }) {
  return { id: `d-${section}`, propertyId: 'p1', section, effectiveFrom: '2025-01-01', data };
}

/**
 * A property with nothing wrong with it: every section recorded, and every
 * field that `recordGaps` looks at filled in. Tests then override the one
 * record they are about, so a fixture that happened to be short of a deposit
 * cannot quietly add to the count a test is asserting.
 */
const COMPLETE = {
  address: { line1: '1 Test Street', postcode: 'TE5 7ST' },
  // Far enough out to be neither a warning nor even "coming up".
  insurance: { provider: 'Direct Line', renewalDate: '2027-06-01' },
  mortgage: { lender: 'NatWest', amount: '120000' },
  valuation: { value: '200000', valuedOn: '2026-01-15' },
  tenancy: {
    tenantName: 'S Agyapong',
    startDate: '2025-01-01',
    rentAmount: '1000',
    depositAmount: '1200',
    depositScheme: 'DPS',
  },
};

const ALL_SECTIONS = SECTIONS.map((s) => detail(s.key, COMPLETE[s.key]));

/** The complete property with one section replaced. */
const withSection = (section, data) => [
  ...ALL_SECTIONS.filter((d) => d.section !== section),
  detail(section, data),
];

function state(overrides = {}) {
  return {
    properties: PROPERTIES,
    transactions: [],
    propertyDetails: ALL_SECTIONS,
    complianceTypes: TYPES,
    complianceCompletions: [],
    complianceExemptions: [],
    ...overrides,
  };
}

describe('attentionFor: the three grades', () => {
  it('calls a lapsed certificate overdue and counts it', () => {
    // Done 2025-06-14, due 2026-06-14, so two months late by TODAY.
    const a = attentionFor(
      state({
        complianceCompletions: [
          { id: 'c1', propertyId: 'p1', complianceTypeId: 'gas', completedDate: '2025-06-14' },
        ],
      }),
      'p1',
      TODAY,
    );
    assert.equal(a.overdueCompliance.length, 1);
    assert.equal(a.soonCount, 0);
    assert.equal(a.count, 1);
  });

  it('warns on one falling due inside the 30-day window without calling it overdue', () => {
    // Due 2026-09-01: twenty days off.
    const a = attentionFor(
      state({
        complianceCompletions: [
          { id: 'c1', propertyId: 'p1', complianceTypeId: 'gas', completedDate: '2025-09-01' },
        ],
      }),
      'p1',
      TODAY,
    );
    assert.equal(a.overdueCompliance.length, 0, 'nothing has lapsed');
    assert.equal(a.soonCount, 1);
    assert.equal(a.count, 1, 'a warning still counts towards the badge');
  });

  it('leaves one due beyond the window as information, not a warning', () => {
    // Due 2026-10-15: 64 days off — inside the 90-day horizon, well outside 30.
    const a = attentionFor(
      state({
        complianceCompletions: [
          { id: 'c1', propertyId: 'p1', complianceTypeId: 'gas', completedDate: '2025-10-15' },
        ],
      }),
      'p1',
      TODAY,
    );
    assert.equal(a.soonCount, 0);
    assert.equal(a.count, 0, 'three months off is not something to act on today');
    assert.equal(a.upcoming.length, 1, 'but it is still listed under Coming up');
  });

  it('puts the boundary where DUE_SOON_DAYS says it is, on both sides', () => {
    // A certificate due exactly DUE_SOON_DAYS away is a warning; one day
    // further out is not. The constant is the only thing that decides.
    const dueOn = (date) =>
      attentionFor(
        state({
          complianceTypes: [{ id: 'x', name: 'X', frequencyMonths: 12 }],
          complianceCompletions: [
            { id: 'c1', propertyId: 'p1', complianceTypeId: 'x', completedDate: date },
          ],
        }),
        'p1',
        TODAY,
      );
    assert.equal(DUE_SOON_DAYS, 30, 'these dates are chosen against a 30-day window');
    // Completed 2025-09-11 → due 2026-09-11, which is 30 days after TODAY.
    assert.equal(dueOn('2025-09-11').soonCount, 1, 'exactly 30 days away is inside the window');
    assert.equal(dueOn('2025-09-12').soonCount, 0, '31 days away is not');
  });
});

describe('insurance cover', () => {
  const withRenewal = (renewalDate) =>
    attentionFor(
      state({ propertyDetails: withSection('insurance', { provider: 'Direct Line', renewalDate }) }),
      'p1',
      TODAY,
    );

  it('is overdue once the renewal date has gone by', () => {
    const a = withRenewal('2026-07-01');
    assert.equal(a.overdueDates.length, 1);
    assert.equal(a.overdue[0].label, 'Insurance cover lapsed');
    assert.equal(a.overdue[0].kind, 'insurance');
    assert.equal(a.count, 1);
  });

  it('stays on the list however long ago it lapsed', () => {
    // An uninsured house does not stop being uninsured because the renewal
    // date fell outside a 90-day window.
    const a = withRenewal('2024-01-01');
    assert.equal(a.overdueDates.length, 1);
    assert.equal(a.count, 1);
  });

  it('warns inside the 30-day window without calling it overdue', () => {
    const a = withRenewal('2026-09-05');
    assert.equal(a.overdueDates.length, 0);
    assert.equal(a.soonDates.length, 1);
    assert.equal(a.soon[0].label, 'Insurance cover expires');
    assert.equal(a.count, 1);
  });

  it('puts the boundary exactly where DUE_SOON_DAYS says', () => {
    assert.equal(withRenewal('2026-09-11').soonCount, 1, '30 days away is inside the window');
    assert.equal(withRenewal('2026-09-12').soonCount, 0, '31 days away is not');
  });

  it('is only information further out, and not counted', () => {
    const a = withRenewal('2026-10-20');
    assert.equal(a.count, 0);
    assert.equal(a.upcoming.some((u) => u.section === 'insurance'), true);
  });

  it('says nothing when no renewal date has been recorded', () => {
    const a = attentionFor(state(), 'p1', TODAY);
    assert.equal(a.overdueDates.length, 0);
    assert.equal(a.soonDates.length, 0);
  });
});

describe('dates that are events rather than exposure', () => {
  const withTenancyEnd = (endDate, today) =>
    attentionFor(
      state({
        propertyDetails: withSection('tenancy', { ...COMPLETE.tenancy, endDate }),
      }),
      'p1',
      today,
    );

  it('does not chase a tenancy end date that has passed', () => {
    // The tenancy ending is a thing that happened; the property is no worse
    // off for it, so it drops off rather than sitting there in red forever.
    const a = withTenancyEnd('2026-06-01', TODAY);
    assert.equal(a.overdueDates.length, 0);
    assert.equal(a.count, 0);
  });

  it('still lists one that is coming up', () => {
    const a = withTenancyEnd('2026-09-30', TODAY);
    assert.equal(a.count, 0, 'approaching, but not a fault to act on');
    assert.equal(a.upcoming.some((u) => u.section === 'tenancy'), true);
  });
});

describe('records that do not say enough', () => {
  it('counts a stale valuation, and says how old it is', () => {
    const a = attentionFor(
      state({ propertyDetails: withSection('valuation', { value: '200000', valuedOn: '2024-06-01' }) }),
      'p1',
      TODAY,
    );
    assert.equal(a.gapCount, 1);
    assert.equal(a.count, 1, 'it is cleared by revaluing, so it earns a place on the badge');
    assert.match(a.gaps[0].label, /months old/);
    assert.equal(a.gaps[0].section, 'valuation');
  });

  it('counts a tenancy with no deposit', () => {
    const { depositAmount, depositScheme, ...noDeposit } = COMPLETE.tenancy;
    const a = attentionFor(state({ propertyDetails: withSection('tenancy', noDeposit) }), 'p1', TODAY);
    assert.deepEqual(
      a.gaps.map((g) => g.id),
      ['tenancy-deposit'],
    );
    assert.equal(a.count, 1);
  });

  it('keeps gaps apart from dates, so a warning is never mistaken for a lapse', () => {
    const a = attentionFor(
      state({ propertyDetails: withSection('valuation', { value: '1', valuedOn: '2020-01-01' }) }),
      'p1',
      TODAY,
    );
    assert.equal(a.overdue.length, 0, 'nothing has actually gone wrong');
    assert.equal(a.soon.length, 0);
    assert.equal(a.gapCount, 1);
  });

  it('says nothing about a property whose records are complete', () => {
    assert.equal(attentionFor(state(), 'p1', TODAY).gapCount, 0);
  });

  it('says nothing about a section that has never been recorded', () => {
    // That absence is the "Still to add" prompt's, and counting it here as
    // well would report one missing tenancy as two things to do.
    const a = attentionFor(
      state({ propertyDetails: ALL_SECTIONS.filter((d) => d.section !== 'tenancy') }),
      'p1',
      TODAY,
    );
    assert.equal(a.gapCount, 0);
    assert.ok(a.missing.some((m) => m.label === 'Tenancy'));
    assert.equal(a.count, 0, 'a whole missing section is still a prompt, not a count');
  });
});

describe('attentionFor: missing records', () => {
  it('reports sections with nothing recorded', () => {
    const a = attentionFor(state({ propertyDetails: [detail('address')] }), 'p1', TODAY);
    const labels = a.missing.map((m) => m.label);
    assert.deepEqual(labels, ['Insurance', 'Mortgage', 'Valuation', 'Tenancy']);
  });

  it('keeps them out of the badge count', () => {
    // A badge that can never reach zero is a badge people stop reading, so a
    // prompt with no deadline is listed but not counted.
    const a = attentionFor(state({ propertyDetails: [] }), 'p1', TODAY);
    assert.ok(a.missing.length > 0);
    assert.equal(a.count, 0);
  });
});

describe('compliance marked not applicable', () => {
  const exemptions = [{ id: 'p1::gas', propertyId: 'p1', complianceTypeId: 'gas' }];
  const lapsed = [{ id: 'c1', propertyId: 'p1', complianceTypeId: 'gas', completedDate: '2020-01-01' }];

  it('stops a long-lapsed certificate being overdue', () => {
    const before = attentionFor(state({ complianceCompletions: lapsed }), 'p1', TODAY);
    assert.equal(before.count, 1, 'without the tick it is years overdue');

    const after = attentionFor(
      state({ complianceCompletions: lapsed, complianceExemptions: exemptions }),
      'p1',
      TODAY,
    );
    assert.equal(after.count, 0);
    assert.equal(after.overdueCompliance.length, 0);
  });

  it('marks the status so the table can show why it is quiet', () => {
    const [gas, eicr] = complianceStatus(TYPES, lapsed, 'p1', TODAY, exemptions);
    assert.equal(gas.exempt, true);
    assert.equal(gas.overdue, false, 'exempt outranks a date in the past');
    assert.equal(gas.dueSoon, false);
    assert.equal(eicr.exempt, false, 'the exemption is per type, not per property');
  });

  it('is per property, not global', () => {
    assert.equal(isExempt(exemptions, 'p1', 'gas'), true);
    assert.equal(isExempt(exemptions, 'p2', 'gas'), false);
    assert.equal(isExempt(exemptions, 'p1', 'eicr'), false);
  });
});

describe('owned outright', () => {
  const outright = [detail('mortgage', { ownedOutright: 'yes' })];

  it('stops the property being prompted for mortgage details', () => {
    const missing = missingSections(outright, 'p1').map((m) => m.label);
    assert.ok(!missing.includes('Mortgage'), `still prompting: ${missing.join(', ')}`);
    assert.equal(isOwnedOutright(outright, 'p1'), true);
  });

  it('still prompts a property that simply has no mortgage record', () => {
    assert.ok(missingSections([], 'p1').some((m) => m.label === 'Mortgage'));
    assert.equal(isOwnedOutright([], 'p1'), false);
  });
});

describe('attentionTotal', () => {
  it('adds up every property, so the tab badge matches the pages behind it', () => {
    const two = {
      ...state({
        properties: [
          { id: 'p1', name: 'Ash Close' },
          { id: 'p2', name: 'Elm Road' },
        ],
        propertyDetails: [
          ...ALL_SECTIONS,
          // The second property is complete too, so the only thing either has
          // outstanding is the lapsed certificate below.
          ...SECTIONS.map((s) => ({
            ...detail(s.key, COMPLETE[s.key]),
            id: `p2-${s.key}`,
            propertyId: 'p2',
          })),
        ],
        complianceCompletions: [
          { id: 'c1', propertyId: 'p1', complianceTypeId: 'gas', completedDate: '2020-01-01' },
          { id: 'c2', propertyId: 'p2', complianceTypeId: 'gas', completedDate: '2020-01-01' },
        ],
      }),
    };
    assert.equal(attentionTotal(two, TODAY), 2);
    assert.equal(
      attentionTotal(two, TODAY),
      attentionFor(two, 'p1', TODAY).count + attentionFor(two, 'p2', TODAY).count,
    );
  });

  it('is zero for a portfolio with nothing outstanding', () => {
    assert.equal(attentionTotal(state(), TODAY), 0);
  });
});
