/**
 * What a property wants from you, in one place.
 *
 * The same question is asked in four different spots — the badge on the
 * Properties tab, the banner at the top of a property page, the "Needs
 * attention" list on the portfolio overview, and the Attention column of its
 * table. When each worked it out for itself they drifted: the tab could say
 * two while the page listed three. So the counting happens once, here, and
 * everything else renders what this returns.
 *
 * Three grades, because they are three different kinds of fact:
 *
 *   - **overdue** — a date that has already passed: a payment that never
 *     arrived, a lapsed certificate, insurance cover that has run out. Red.
 *   - **soon** — a certificate or an insurance policy falling due inside 30
 *     days. Yellow: still time to book an engineer or ring a broker, but not
 *     much.
 *   - **missing** — a section with nothing recorded. A prompt, not a deadline,
 *     and deliberately *not* counted in the badge: a property whose insurance
 *     you have chosen not to record would otherwise carry a permanent number,
 *     which is how a badge teaches people to ignore it.
 *
 * Pure functions; no DOM, no storage.
 */
import { isOverdue, paymentStreams, sharesFor } from './accounts.js';
import { upcomingCompliance } from './compliance.js';
import { addMonths } from './dates.js';
import { currentRecord, missingSections, upcomingDates } from './property-details.js';

/**
 * When the current tenancy began — the tenant's own start date if recorded,
 * otherwise the date the record took effect. Used to retire a former tenant's
 * rent so they are never reported as owing money.
 *
 * @returns {string|null} ISO date
 */
export function tenancyStart(details, propertyId) {
  const tenancy = currentRecord(details, propertyId, 'tenancy');
  if (!tenancy) return null;
  return tenancy.data?.startDate || tenancy.effectiveFrom || null;
}

/**
 * Everything one property wants doing.
 *
 * @param {object} state the store's state, or anything with the same shape
 * @param {string} propertyId
 * @param {string} today ISO date, so callers control "now" rather than the clock
 * @param {number} [horizonDays] how far ahead "coming up" reaches
 */
export function attentionFor(state, propertyId, today, horizonDays = 90) {
  const {
    transactions = [],
    propertyDetails = [],
    complianceTypes = [],
    complianceCompletions = [],
    complianceExemptions = [],
  } = state;

  const streamOptions = { tenancyFrom: tenancyStart(propertyDetails, propertyId) };
  const lateStreams = paymentStreams(sharesFor(transactions, propertyId), today)
    .filter((s) => s.recurring)
    .filter((s) => isOverdue(s, today, streamOptions));

  const compliance = upcomingCompliance(
    complianceTypes,
    complianceCompletions,
    propertyId,
    today,
    horizonDays,
    complianceExemptions,
  );

  const dated = upcomingDates(propertyDetails, propertyId, today, horizonDays);
  const missing = missingSections(propertyDetails, propertyId);

  const overdueCompliance = compliance.filter((c) => c.overdue);
  const soonCompliance = compliance.filter((c) => c.dueSoon);
  const overdueDates = dated.filter((d) => d.overdue);
  const soonDates = dated.filter((d) => d.dueSoon);

  /**
   * Everything already past, merged and dated by when it went wrong. A stream
   * has no date of its own — it failed the month after it last arrived — so
   * that is what it is sorted and reported by.
   */
  const overdue = [
    ...lateStreams.map((stream) => ({
      kind: 'payment',
      label: `${stream.label} not received`,
      since: addMonths(stream.lastDate, 1),
    })),
    ...overdueCompliance.map((item) => ({ kind: 'compliance', label: item.label, since: item.date })),
    ...overdueDates.map((item) => ({ kind: item.section, label: item.label, since: item.date })),
  ].sort((a, b) => a.since.localeCompare(b.since));

  /** Not yet a fault, but close enough to act on today. */
  const soon = [
    ...soonCompliance.map((item) => ({ kind: 'compliance', label: item.label, date: item.date })),
    ...soonDates.map((item) => ({ kind: item.section, label: item.label, date: item.date })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return {
    lateStreams,
    overdueCompliance,
    soonCompliance,
    overdueDates,
    soonDates,
    overdue,
    soon,
    /** Approaching, but far enough off to be information rather than a warning. */
    upcoming: [
      ...compliance.filter((c) => !c.overdue && !c.dueSoon),
      ...dated.filter((d) => !d.overdue && !d.dueSoon),
    ],
    missing,
    overdueCount: overdue.length,
    soonCount: soon.length,
    /**
     * The number on the badge. Deadlines only — see the note at the top of
     * this file for why missing sections are left out of it.
     */
    get count() {
      return this.overdueCount + this.soonCount;
    },
  };
}

/** The same tally across every property, for the badge on the tab. */
export function attentionTotal(state, today) {
  return (state.properties ?? []).reduce(
    (sum, property) => sum + attentionFor(state, property.id, today).count,
    0,
  );
}
