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
    summary: (d) => [d.line1, d.town, d.postcode].filter(Boolean).join(', '),
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
    summary: (d) => [d.provider, d.coverLevel].filter(Boolean).join(' · '),
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
    summary: (d) => [d.lender, d.rate !== undefined && d.rate !== '' ? `${d.rate}%` : null].filter(Boolean).join(' · '),
    fields: [
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
    summary: (d) => (d.value ? `Valued ${d.value}` : ''),
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
    summary: (d) => [d.tenantName, d.rentAmount ? `${d.rentAmount} pcm` : null].filter(Boolean).join(' · '),
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
 * Builds the new record for a section and returns it along with the previous
 * one, updated to close off on the day the new one takes effect.
 *
 * @returns {{record: object, superseded: object|null}}
 */
export function supersede({ records, propertyId, section, data, effectiveFrom, recordedAt, id }) {
  const previous = currentRecord(records, propertyId, section);
  const record = {
    id,
    propertyId,
    section,
    effectiveFrom,
    recordedAt,
    supersededOn: null,
    data: { ...data },
  };
  const superseded = previous ? { ...previous, supersededOn: effectiveFrom } : null;
  return { record, superseded };
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
  const debt = toNumber(mortgage?.data?.amount);
  const value = toNumber(valuation?.data?.value);
  if (debt === null || value === null || value <= 0) return null;
  return Math.round((debt / value) * 1000) / 10;
}

/** Equity: what the property is worth less what is owed on it. */
export function equity(mortgage, valuation) {
  const debt = toNumber(mortgage?.data?.amount);
  const value = toNumber(valuation?.data?.value);
  if (value === null) return null;
  return Math.round((value - (debt ?? 0)) * 100) / 100;
}

function toNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export { toNumber as parseAmountField };

/**
 * Dates worth warning about: a fixed rate about to end, a tenancy ending, an
 * insurance renewal. Returned soonest first.
 *
 * @param {object[]} records all detail records
 * @param {string} propertyId
 * @param {string} today ISO date
 * @param {number} [withinDays]
 */
export function upcomingDates(records, propertyId, today, withinDays = 90) {
  const watch = [
    { section: 'mortgage', field: 'fixEndDate', label: 'Fixed rate ends' },
    { section: 'mortgage', field: 'termEnds', label: 'Mortgage term ends' },
    { section: 'insurance', field: 'renewalDate', label: 'Insurance renewal' },
    { section: 'tenancy', field: 'endDate', label: 'Tenancy ends' },
  ];

  const limit = addDays(today, withinDays);
  return watch
    .map(({ section, field, label }) => {
      const record = currentRecord(records, propertyId, section);
      const date = record?.data?.[field];
      return date ? { label, date, section } : null;
    })
    .filter((item) => item && item.date >= today && item.date <= limit)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
