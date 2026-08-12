/**
 * The line of text under each panel title on a property page.
 *
 * These exist so that most visits to a property end at the strip without
 * opening anything, which only works if the summary states the fact rather
 * than the row count. The assertions below are mostly about *what is claimed*:
 * a panel that says "all 12 months' rent received" when one is missing is
 * worse than one that says nothing at all.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PANELS, panelSummaries } from '../src/views/property.js';
import { SECTIONS } from '../src/property-details.js';

const CATEGORIES = [
  { id: 'Rent', name: 'Rent' },
  { id: 'Repairs', name: 'Repairs' },
  { id: 'Interest', name: 'Interest' },
];

const PROPERTY = { id: 'p1', name: 'Ash Close' };

/** A share, in the shape sharesFor produces. */
function share(date, amount, category) {
  return { propertyId: 'p1', category, amount, transaction: { id: date + amount, date } };
}

/** Rent in and a repair out, for `months` consecutive months from Jan 2026. */
function months(count, { skipRentIn = [] } = {}) {
  const rows = [];
  for (let m = 0; m < count; m++) {
    const iso = `2026-${String(m + 1).padStart(2, '0')}`;
    if (!skipRentIn.includes(m)) rows.push(share(`${iso}-05`, 1000, 'Rent'));
    rows.push(share(`${iso}-20`, -250, 'Repairs'));
    rows.push(share(`${iso}-20`, -400, 'Interest'));
  }
  return rows;
}

function summarise(overrides = {}) {
  return panelSummaries({
    shares: [],
    categories: CATEGORIES,
    streams: [],
    lateStreams: [],
    statuses: [],
    transactions: [],
    property: PROPERTY,
    propertyDetails: [],
    today: '2026-08-12',
    streamOptions: {},
    ...overrides,
  });
}

describe('panelSummaries', () => {
  it('gives every panel a line, so none of them is a bare label', () => {
    const summaries = summarise();
    for (const panel of PANELS) {
      assert.ok(summaries[panel.key], `${panel.key} has no summary`);
    }
  });
});

describe('the Monthly breakdown summary', () => {
  it('says "all" only when every month\'s rent actually arrived', () => {
    const { breakdown } = summarise({ shares: months(6) });
    assert.match(breakdown, /All 6 months’ rent received/);
  });

  it('counts the months that fell short rather than rounding up to "all"', () => {
    // Two months with a repair but no rent — the whole reason empty months are
    // shown in the table below is that a missing rent is otherwise invisible.
    const { breakdown } = summarise({ shares: months(6, { skipRentIn: [2, 4] }) });
    assert.match(breakdown, /4 of 6 months’ rent received/);
    assert.ok(!breakdown.includes('All 6'), 'must not claim a clean sheet');
  });

  it('names the two biggest costs, largest first', () => {
    const { breakdown } = summarise({ shares: months(4) });
    // £1,600 interest beats £1,000 repairs, so it leads.
    assert.ok(
      breakdown.indexOf('Interest') < breakdown.indexOf('Repairs'),
      `expected Interest before Repairs in "${breakdown}"`,
    );
  });

  it('shows costs unsigned — the category name already says money went out', () => {
    const { breakdown } = summarise({ shares: months(4) });
    assert.match(breakdown, /£1,600 Interest/);
    assert.ok(!breakdown.includes('-£1,600'), `a minus in "${breakdown}" reads as a correction`);
  });

  it('keeps the sign on net, where it is the whole point', () => {
    // Rent 1,000 against 650 of costs each month: a real profit.
    assert.match(summarise({ shares: months(4) }).breakdown, /net £1,400/);
    // No rent at all: the net has to read as a loss.
    const loss = summarise({ shares: months(4, { skipRentIn: [0, 1, 2, 3] }) }).breakdown;
    assert.match(loss, /net -£2,600/);
  });

  it('says so plainly when there is nothing to summarise', () => {
    assert.match(summarise().breakdown, /Nothing categorised/);
  });
});

describe('the Recurring payments summary', () => {
  const stream = (label, nextExpected) => ({
    label,
    nextExpected,
    lastDate: '2026-07-24',
    recurring: true,
    typicalAmount: 1000,
    typicalDay: 24,
    direction: 'in',
    dates: ['2026-06-24', '2026-07-24'],
  });

  it('leads with how many are overdue, not with when the next one is due', () => {
    const late = stream('Rent', '2026-08-24');
    const { recurring } = summarise({ streams: [late, stream('Insurance', '2026-08-30')], lateStreams: [late] });
    assert.match(recurring, /1 overdue/);
    assert.ok(!recurring.includes('next expected'), 'a late payment outranks a forthcoming one');
  });

  it('falls back to the next expected date when nothing is late', () => {
    const { recurring } = summarise({
      streams: [stream('Rent', '2026-08-24'), stream('Insurance', '2026-08-30')],
      lateStreams: [],
    });
    assert.match(recurring, /next expected 24\/08\/2026/, 'the soonest, not just the first');
  });

  it('does not report an empty list as zero payments', () => {
    assert.match(summarise().recurring, /None spotted yet/);
  });
});

describe('the Compliance summary', () => {
  const status = (name, { overdue = false, neverRecorded = false, nextDue = null } = {}) => ({
    type: { id: name, name, frequencyMonths: 12 },
    overdue,
    neverRecorded,
    nextDue,
    history: [],
  });

  it('reports overdue certificates ahead of the next one due', () => {
    const { compliance } = summarise({
      statuses: [status('Gas', { overdue: true, nextDue: '2026-06-14' }), status('EICR', { nextDue: '2028-03-02' })],
    });
    assert.match(compliance, /2 certificates tracked/);
    assert.match(compliance, /1 overdue/);
    assert.ok(!compliance.includes('next due'), 'something lapsed outranks something approaching');
  });

  it('counts never-logged items separately from overdue ones', () => {
    // Never recorded is not the same as late: there is no date to be late by.
    const { compliance } = summarise({ statuses: [status('EPC', { neverRecorded: true })] });
    assert.match(compliance, /1 never logged/);
    assert.ok(!compliance.includes('overdue'));
  });

  it('shows the next due date when the schedule is clean', () => {
    const { compliance } = summarise({
      statuses: [status('Gas', { nextDue: '2027-06-14' }), status('EICR', { nextDue: '2028-03-02' })],
    });
    assert.match(compliance, /next due 14\/06\/2027/);
  });
});

describe('the Transactions summary', () => {
  it('gives the count and the most recent date', () => {
    const { transactions } = summarise({
      transactions: [{ date: '2026-01-05' }, { date: '2026-07-30' }, { date: '2026-03-11' }],
    });
    assert.match(transactions, /3 transactions/);
    assert.match(transactions, /latest 30\/07\/2026/);
  });

  it('reads as singular for one', () => {
    assert.match(summarise({ transactions: [{ date: '2026-01-05' }] }).transactions, /1 transaction ·/);
  });
});

describe('the Overview summary', () => {
  const record = (section) => ({
    id: section,
    propertyId: 'p1',
    section,
    effectiveFrom: '2025-01-01',
    data: { note: 'x' },
  });

  it('names what is missing rather than only counting it', () => {
    const { details } = summarise({ propertyDetails: [record('mortgage'), record('valuation')] });
    assert.match(details, /Mortgage and Valuation recorded/);
    assert.match(details, /Address, Insurance and Tenancy not recorded/);
  });

  it('says nothing is missing when every section is filled in', () => {
    const { details } = summarise({ propertyDetails: SECTIONS.map((s) => record(s.key)) });
    assert.ok(!details.includes('not recorded'), `"${details}" should have no gaps to report`);
  });

  it('prompts rather than listing five absences on an untouched property', () => {
    assert.match(summarise().details, /Nothing recorded yet/);
  });
});
