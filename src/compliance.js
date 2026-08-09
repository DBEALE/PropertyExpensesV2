/**
 * Compliance scheduling: gas safety certificates, EICRs, PAT testing and the
 * like.
 *
 * Unlike rent or insurance, these can't be inferred from the bank statement —
 * they don't show up reliably in payee text, they don't recur monthly, and the
 * gap between them varies by type. So they are logged explicitly: a list of
 * types with their frequencies, and a row for each time an inspection was
 * actually done.
 *
 * Deliberately no cost field and no link to a transaction. The payment for an
 * inspection is categorised in Transactions like any other expense; this is a
 * schedule, not a ledger, and keeping the two apart stops the same money being
 * counted twice.
 *
 * Pure functions; no DOM, no storage.
 */
import { addDays, addMonths } from './dates.js';

/**
 * Seeded on first load, then editable — the same pattern as categories. Ids
 * are the slug of the original name, so renaming a type never orphans the
 * completions already logged against it.
 */
export const DEFAULT_COMPLIANCE_TYPES = [
  {
    id: 'gas-safety-certificate',
    name: 'Gas Safety Certificate',
    frequencyMonths: 12,
    description: 'Annual CP12 check of gas appliances and flues by a Gas Safe engineer.',
  },
  {
    id: 'eicr',
    name: 'EICR (Electrical Installation Condition Report)',
    frequencyMonths: 60,
    description: 'Five-yearly inspection of the fixed electrical installation.',
  },
  {
    id: 'pat-testing',
    name: 'PAT Testing',
    frequencyMonths: 12,
    description: 'Portable appliance testing for anything electrical you supply.',
  },
  {
    id: 'legionella-risk-assessment',
    name: 'Legionella Risk Assessment',
    frequencyMonths: 24,
    description: 'Assessment of the water system for legionella risk.',
  },
];

/**
 * Suggests an id for a new type: the name, cleaned up, kept unique. Using the
 * name keeps exported backups readable rather than full of opaque ids.
 */
export function complianceTypeIdFor(name, existing) {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'compliance-type';
  if (!existing.some((t) => t.id === base)) return base;
  let n = 2;
  while (existing.some((t) => t.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * When the next inspection falls due.
 *
 * @param {string|null} lastCompletedDate ISO date, or null if never done
 * @param {number} frequencyMonths
 * @returns {string|null} ISO date, or null when there is nothing to count from
 */
export function nextDue(lastCompletedDate, frequencyMonths) {
  if (!lastCompletedDate) return null;
  const months = Number(frequencyMonths);
  if (!Number.isFinite(months) || months <= 0) return null;
  return addMonths(lastCompletedDate, months);
}

/** The most recent completion of one type for one property, or null. */
export function lastCompletion(completions, propertyId, complianceTypeId) {
  const matching = completions
    .filter((c) => c.propertyId === propertyId && c.complianceTypeId === complianceTypeId)
    .sort((a, b) => a.completedDate.localeCompare(b.completedDate));
  return matching[matching.length - 1] ?? null;
}

/**
 * Every completion logged against a type, across all properties — what
 * deleting that type would take with it.
 */
export function completionsForType(completions, complianceTypeId) {
  return completions.filter((c) => c.complianceTypeId === complianceTypeId);
}

/** Every completion of one type for one property, most recent first. */
export function completionHistory(completions, propertyId, complianceTypeId) {
  return completions
    .filter((c) => c.propertyId === propertyId && c.complianceTypeId === complianceTypeId)
    .sort((a, b) => b.completedDate.localeCompare(a.completedDate));
}

/**
 * Where a property stands on every compliance type.
 *
 * A type never logged for this property has no due date — it is reported as
 * "never recorded" rather than given a date computed from nothing, which would
 * be a fabricated deadline.
 *
 * @param {object[]} types
 * @param {object[]} completions
 * @param {string} propertyId
 * @param {string} today ISO date, so callers control "now" rather than the clock
 */
export function complianceStatus(types, completions, propertyId, today) {
  return types.map((type) => {
    const last = lastCompletion(completions, propertyId, type.id);
    const due = nextDue(last?.completedDate ?? null, type.frequencyMonths);
    return {
      type,
      lastCompletion: last,
      lastCompletedDate: last?.completedDate ?? null,
      nextDue: due,
      neverRecorded: last === null,
      overdue: due !== null && due < today,
      history: completionHistory(completions, propertyId, type.id),
    };
  });
}

/**
 * Compliance dates falling due soon, in the same shape as `upcomingDates` in
 * property-details.js so the two can be merged into one sorted list.
 *
 * Overdue items are included regardless of the window — something already late
 * is more urgent than anything merely approaching, so it must not drop out.
 *
 * @returns {{label: string, date: string, section: string, overdue: boolean}[]}
 */
export function upcomingCompliance(types, completions, propertyId, today, withinDays = 90) {
  const limit = addDays(today, withinDays);
  return complianceStatus(types, completions, propertyId, today)
    .filter((status) => status.nextDue !== null)
    .filter((status) => status.overdue || (status.nextDue >= today && status.nextDue <= limit))
    .map((status) => ({
      label: status.type.name,
      date: status.nextDue,
      section: 'compliance',
      overdue: status.overdue,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
