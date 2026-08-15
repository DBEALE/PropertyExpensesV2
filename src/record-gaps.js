/**
 * Records that exist but do not say enough.
 *
 * Distinct from `missingSections`, which asks whether a section has been
 * filled in at all. This asks the harder question: given that you *have*
 * recorded a valuation, is it still worth anything? Given that you have
 * recorded a tenancy, does it say what the deposit was?
 *
 * Two rules keep the list short enough to act on:
 *
 *   - **A check only fires on a record you have chosen to keep.** No valuation
 *     recorded means no stale-valuation warning; that gap is already the
 *     "Still to add" prompt's business. So nothing here is unavoidable noise —
 *     every item is on a record you decided you cared about.
 *   - **Every check names something that stops the app doing its job, or that
 *     carries real-world risk.** A missing "Broker" or "County" is nobody's
 *     problem. A missing outstanding balance means LTV and equity cannot be
 *     worked out; an unprotected deposit is a statutory penalty of one to
 *     three times the deposit.
 *
 * Pure functions; no DOM, no storage.
 */
import { addMonths } from './dates.js';
import { currentRecord, isTrue } from './property-details.js';

/**
 * How old a valuation may get before it is worth revisiting.
 *
 * A year, because that is the cadence a landlord already works to — the tax
 * year, the insurance renewal, the gas certificate — not because a valuation
 * expires on a particular day.
 */
export const STALE_VALUATION_MONTHS = 12;

const blank = (value) => String(value ?? '').trim() === '';

/** Whole months between two ISO dates, not counting a part month. */
export function monthsBetween(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, months);
}

/**
 * @typedef {object} Check
 * @property {string} id stable, so a test can name one
 * @property {string} section which record it reads, and where a link should land
 * @property {(data: object, context: {today: string, effectiveFrom: string}) => string|null} check
 *   the sentence to show, or null when there is nothing to say
 */

/** @type {Check[]} */
const CHECKS = [
  {
    id: 'valuation-stale',
    section: 'valuation',
    check: (data, { today, effectiveFrom }) => {
      // The date it was valued on if you gave one, otherwise the date the
      // record took effect — which is the best evidence available of when the
      // figure was true.
      const valuedOn = data.valuedOn || effectiveFrom;
      if (!valuedOn || valuedOn > addMonths(today, -STALE_VALUATION_MONTHS)) return null;
      const age = monthsBetween(valuedOn, today);
      return `Valuation is ${age} months old — every figure derived from it is that old too`;
    },
  },
  {
    id: 'valuation-amount',
    section: 'valuation',
    check: (data) =>
      blank(data.value) ? 'Valuation has no market value, so LTV and equity cannot be worked out' : null,
  },
  {
    id: 'mortgage-balance',
    section: 'mortgage',
    check: (data) => {
      // Owned outright is an answer, not a gap: the balance is zero and the
      // figures work out fine without it.
      if (isTrue(data.ownedOutright)) return null;
      return blank(data.amount)
        ? 'Mortgage has no outstanding balance, so LTV and equity cannot be worked out'
        : null;
    },
  },
  {
    id: 'insurance-renewal',
    section: 'insurance',
    check: (data) =>
      blank(data.renewalDate) ? 'Insurance has no renewal date, so its expiry cannot be tracked' : null,
  },
  {
    id: 'tenancy-deposit',
    section: 'tenancy',
    check: (data) => (blank(data.depositAmount) ? 'No deposit recorded against the tenancy' : null),
  },
  {
    id: 'tenancy-deposit-scheme',
    section: 'tenancy',
    check: (data) => {
      // Only worth asking once a deposit is known to exist. A deposit taken
      // and not protected in an approved scheme within 30 days is a penalty of
      // one to three times the deposit, so this is the costliest blank here.
      if (blank(data.depositAmount) || !blank(data.depositScheme)) return null;
      return 'Deposit is not recorded as protected in a scheme';
    },
  },
  {
    id: 'tenancy-rent',
    section: 'tenancy',
    check: (data) =>
      blank(data.rentAmount) ? 'Tenancy has no rent, so a missing payment cannot be spotted' : null,
  },
  {
    id: 'tenancy-start',
    section: 'tenancy',
    check: (data) =>
      blank(data.startDate)
        ? 'Tenancy has no start date, so a former tenant’s rent cannot be retired'
        : null,
  },
];

/**
 * What the records you have kept for one property fail to say.
 *
 * @param {object[]} records all detail records
 * @param {string} propertyId
 * @param {string} today ISO date, so callers control "now" rather than the clock
 * @returns {{id: string, section: string, label: string}[]} in check order
 */
export function recordGaps(records, propertyId, today) {
  const gaps = [];
  for (const { id, section, check } of CHECKS) {
    const record = currentRecord(records, propertyId, section);
    // Nothing recorded at all is the "Still to add" prompt's business, not
    // this one — flagging it in both places would say the same thing twice.
    if (!record) continue;
    const label = check(record.data ?? {}, { today, effectiveFrom: record.effectiveFrom });
    if (label) gaps.push({ id, section, label });
  }
  return gaps;
}
