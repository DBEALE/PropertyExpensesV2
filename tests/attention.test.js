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
import { DUE_SOON_DAYS, complianceStatus, isExempt } from '../src/compliance.js';
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

/** Every section recorded, so `missing` is empty unless a test says otherwise. */
const ALL_SECTIONS = SECTIONS.map((s) => detail(s.key));

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
          ...SECTIONS.map((s) => ({ ...detail(s.key), id: `p2-${s.key}`, propertyId: 'p2' })),
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
