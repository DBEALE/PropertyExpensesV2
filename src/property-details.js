import { DUE_SOON_DAYS, addDays } from './dates.js';

/**
 * Everything recorded about a property beyond its name — address, insurance,
 * mortgage, valuation, tenancy — kept as *dated records* rather than fields
 * that get overwritten.
 *
 * Saving a section never destroys what was there: the previous record is
 * stamped with the date the new one takes effect and moves to the history,
 * where it stays readable. That matters for a tax return, where the question
 * is usually "what was the arrangement in the 2025/26 year", not "what is it
 * now".
 *
 * Deliberately no password fields. IndexedDB is not encrypted and the backup
 * file is plain JSON, so a password stored here would sit in clear text on
 * disk and in every backup. Login *URL* and *username* are recorded so the
 * account is easy to find; the password belongs in a password manager.
 */

/** @typedef {'address'|'insurance'|'mortgage'|'valuation'|'tenancy'} SectionKey */

export const SECTIONS = [
  {
    key: 'address',
    label: 'Address',
    fields: [
      { key: 'line1', label: 'Address line 1', type: 'text' },
      { key: 'line2', label: 'Address line 2', type: 'text' },
      { key: 'town', label: 'Town or city', type: 'text' },
      { key: 'county', label: 'County', type: 'text' },
      { key: 'postcode', label: 'Postcode', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    key: 'insurance',
    label: 'Insurance',
    fields: [
      { key: 'provider', label: 'Provider', type: 'text' },
      { key: 'policyNumber', label: 'Policy number', type: 'text' },
      { key: 'coverLevel', label: 'Cover level', type: 'text' },
      { key: 'premium', label: 'Premium', type: 'money' },
      { key: 'premiumFrequency', label: 'Paid', type: 'select', options: ['Monthly', 'Annually', 'Other'] },
      { key: 'renewalDate', label: 'Renewal date', type: 'date' },
      { key: 'paymentDay', label: 'Payment day of month', type: 'day' },
      { key: 'loginUrl', label: 'Login page', type: 'url' },
      { key: 'loginUsername', label: 'Username', type: 'text' },
      { key: 'contact', label: 'Contact', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    key: 'mortgage',
    label: 'Mortgage',
    fields: [
      {
        key: 'ownedOutright',
        label: 'Owned outright — no mortgage',
        type: 'boolean',
        hint: 'Stops this property asking for mortgage details',
      },
      { key: 'lender', label: 'Lender', type: 'text' },
      { key: 'accountNumber', label: 'Account number', type: 'text' },
      { key: 'amount', label: 'Outstanding balance', type: 'money' },
      { key: 'rate', label: 'Interest rate', type: 'percent' },
      { key: 'rateType', label: 'Rate type', type: 'select', options: ['Fixed', 'Tracker', 'Variable', 'Discount'] },
      { key: 'fixEndDate', label: 'Fixed rate ends', type: 'date' },
      { key: 'monthlyPayment', label: 'Monthly payment', type: 'money' },
      { key: 'paymentDay', label: 'Payment day of month', type: 'day' },
      { key: 'termEnds', label: 'Term ends', type: 'date' },
      { key: 'loginUrl', label: 'Login page', type: 'url' },
      { key: 'loginUsername', label: 'Username', type: 'text' },
      { key: 'broker', label: 'Broker', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    key: 'valuation',
    label: 'Valuation',
    fields: [
      { key: 'value', label: 'Market value', type: 'money' },
      { key: 'valuedOn', label: 'Valued on', type: 'date' },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase price', type: 'money' },
      { key: 'purchasedOn', label: 'Purchased on', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    key: 'tenancy',
    label: 'Tenancy',
    fields: [
      { key: 'tenantName', label: 'Tenant', type: 'text' },
      { key: 'tenantPhone', label: 'Tenant phone', type: 'text' },
      { key: 'tenantEmail', label: 'Tenant email', type: 'text' },
      { key: 'startDate', label: 'Tenancy starts', type: 'date' },
      { key: 'endDate', label: 'Tenancy ends', type: 'date' },
      { key: 'rentAmount', label: 'Rent', type: 'money' },
      { key: 'rentDay', label: 'Rent due day of month', type: 'day' },
      { key: 'depositAmount', label: 'Deposit held', type: 'money' },
      { key: 'depositScheme', label: 'Deposit scheme', type: 'text' },
      { key: 'depositReference', label: 'Deposit reference', type: 'text' },
      { key: 'agent', label: 'Letting agent', type: 'text' },
      { key: 'agentContact', label: 'Agent contact', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
];

export function sectionByKey(key) {
  return SECTIONS.find((s) => s.key === key) ?? null;
}

/**
 * A stored boolean. Checkbox fields save 'yes' or '', but a record written by
 * an older version — or restored from a backup that predates the field — may
 * hold anything at all, so this reads leniently rather than trusting one form.
 */
export function isTrue(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'yes' || text === 'true' || text === 'on' || text === '1';
}

/** True when the mortgage record says the property is owned outright. */
export function isOwnedOutright(records, propertyId) {
  return isTrue(currentRecord(records, propertyId, 'mortgage')?.data?.ownedOutright);
}

/**
 * The sections with nothing recorded against them yet, as a prompt rather than
 * a fault.
 *
 * Ticking "owned outright" writes a mortgage record like any other answer, so
 * a property with no borrowing stops being prompted for one — the point being
 * that a reminder you cannot ever clear is a reminder you learn to scroll
 * past.
 *
 * @param {object[]} records all detail records
 * @param {string} propertyId
 * @returns {{key: string, label: string}[]} in SECTIONS order
 */
export function missingSections(records, propertyId) {
  return SECTIONS.filter((section) => !currentRecord(records, propertyId, section.key)).map((section) => ({
    key: section.key,
    label: section.label,
  }));
}

/**
 * The record in force for a section on a given date: the latest one that had
 * taken effect by then. Returns null when nothing has been recorded yet.
 *
 * @param {object[]} records all detail records
 * @param {string} propertyId
 * @param {string} section
 * @param {string} [asOf] ISO date; defaults to the latest record of any date
 */
export function currentRecord(records, propertyId, section, asOf) {
  const applicable = records
    .filter((r) => r.propertyId === propertyId && r.section === section)
    .filter((r) => !asOf || r.effectiveFrom <= asOf)
    .sort(byEffectiveThenRecorded);
  return applicable[applicable.length - 1] ?? null;
}

/** Superseded records for a section, most recent first. */
export function historyFor(records, propertyId, section) {
  const all = records
    .filter((r) => r.propertyId === propertyId && r.section === section)
    .sort(byEffectiveThenRecorded);
  return all.slice(0, -1).reverse();
}

/**
 * Two records can share an effective date — a same-day correction — so the
 * time it was recorded breaks the tie.
 */
function byEffectiveThenRecorded(a, b) {
  return a.effectiveFrom.localeCompare(b.effectiveFrom) || (a.recordedAt ?? '').localeCompare(b.recordedAt ?? '');
}

/**
 * Files a new record into a section's timeline.
 *
 * Records are not a stack where the newest wins — they are a *timeline*, and a
 * record can legitimately be filed anywhere in it. A valuation from last March
 * that you are only entering now belongs in March, behind the one that
 * replaced it. So this does not ask "what is current"; it rebuilds the run of
 * dates and works out afresh which record hands over to which.
 *
 * Each record is in force from its own `effectiveFrom` until the next one
 * begins, so `supersededOn` is simply the following record's start date, and
 * null for whichever ends up last. Getting there by recomputation rather than
 * by pairing the new record with the old current one is what makes backdating
 * safe: the old approach would stamp a record that is still in force as having
 * been superseded by one that predates it.
 *
 * @returns {{record: object, rewritten: object[], inForce: boolean}} the new
 *   record, any existing ones whose hand-over date moved, and whether the new
 *   one is the version now in force
 */
export function supersede({ records, propertyId, section, data, effectiveFrom, recordedAt, id }) {
  const record = {
    id,
    propertyId,
    section,
    effectiveFrom,
    recordedAt,
    supersededOn: null,
    data: { ...data },
  };

  const timeline = [
    ...records.filter((r) => r.propertyId === propertyId && r.section === section),
    record,
  ].sort(byEffectiveThenRecorded);

  const rewritten = [];
  timeline.forEach((entry, i) => {
    const handsOverOn = timeline[i + 1]?.effectiveFrom ?? null;
    if (entry === record) {
      record.supersededOn = handsOverOn;
    } else if (entry.supersededOn !== handsOverOn) {
      // Only the neighbours of the insertion point actually move, so a section
      // with years of history rewrites one row rather than all of them.
      rewritten.push({ ...entry, supersededOn: handsOverOn });
    }
  });

  return { record, rewritten, inForce: timeline.at(-1) === record };
}

/** True when a record has been replaced by a later one. */
export function isExpired(record) {
  return Boolean(record.supersededOn);
}

/**
 * Loan-to-value from the mortgage balance and the latest valuation, as a
 * percentage rounded to one decimal. Null when either figure is missing, so
 * the UI can say "add a valuation" rather than showing a made-up 0%.
 */
export function loanToValue(mortgage, valuation) {
  const value = toNumber(valuation?.data?.value);
  if (value === null || value <= 0) return null;
  // Owned outright is a known borrowing of nothing, not a missing figure: 0%
  // is the true answer, where an em dash would read as "not worked out yet".
  if (isTrue(mortgage?.data?.ownedOutright)) return 0;
  const debt = toNumber(mortgage?.data?.amount);
  if (debt === null) return null;
  return Math.round((debt / value) * 1000) / 10;
}

/** Equity: what the property is worth less what is owed on it. */
export function equity(mortgage, valuation) {
  const value = toNumber(valuation?.data?.value);
  if (value === null) return null;
  const debt = isTrue(mortgage?.data?.ownedOutright) ? 0 : toNumber(mortgage?.data?.amount);
  return Math.round((value - (debt ?? 0)) * 100) / 100;
}

function toNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export { toNumber as parseAmountField };

/**
 * The dated fields worth watching, and how each one reads once it passes.
 *
 * `lapses` marks the ones where the date passing leaves the property *exposed*
 * rather than merely marking an event. An insurance renewal that has gone by
 * means an uninsured house — that is a fault to be chased, and it stays on the
 * list however long ago it happened. A fixed rate ending or a tenancy reaching
 * its end date is a thing that has happened; the property is no worse off for
 * it, so those simply drop off the list once they are behind you.
 */
const WATCHED_DATES = [
  { section: 'mortgage', field: 'fixEndDate', label: 'Fixed rate ends' },
  { section: 'mortgage', field: 'termEnds', label: 'Mortgage term ends' },
  {
    section: 'insurance',
    field: 'renewalDate',
    label: 'Insurance renewal',
    lapses: true,
    lapsedLabel: 'Insurance cover lapsed',
    soonLabel: 'Insurance cover expires',
  },
  { section: 'tenancy', field: 'endDate', label: 'Tenancy ends' },
];

/**
 * Dates worth warning about: a fixed rate about to end, a tenancy ending, an
 * insurance renewal. Returned soonest first, graded the same way compliance is
 * so the two can be merged into one attention list.
 *
 * @param {object[]} records all detail records
 * @param {string} propertyId
 * @param {string} today ISO date
 * @param {number} [withinDays] how far ahead to look
 * @param {number} [soonDays] inside which an approaching date is a warning
 * @returns {{label: string, date: string, section: string, overdue: boolean, dueSoon: boolean}[]}
 */
export function upcomingDates(records, propertyId, today, withinDays = 90, soonDays = DUE_SOON_DAYS) {
  const limit = addDays(today, withinDays);
  const soonLimit = addDays(today, soonDays);

  return WATCHED_DATES.map(({ section, field, label, lapses, lapsedLabel, soonLabel }) => {
    const record = currentRecord(records, propertyId, section);
    const date = record?.data?.[field];
    if (!date) return null;

    const overdue = Boolean(lapses) && date < today;
    const dueSoon = Boolean(lapses) && date >= today && date <= soonLimit;
    return {
      // Named for the state it is in: "Insurance renewal — 12/09/2026" is a
      // diary entry, "Insurance cover lapsed" is the problem it becomes.
      label: (overdue && lapsedLabel) || (dueSoon && soonLabel) || label,
      date,
      section,
      overdue,
      dueSoon,
    };
  })
    .filter(Boolean)
    // Something lapsed stays visible however long ago, exactly as an overdue
    // certificate does; anything else drops out once it is behind you.
    .filter((item) => item.overdue || (item.date >= today && item.date <= limit))
    .sort((a, b) => a.date.localeCompare(b.date));
}

