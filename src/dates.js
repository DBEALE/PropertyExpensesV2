/**
 * A UK tax year runs 6 April to 5 April. `startYear` 2026 means 2026/27.
 * @param {number} startYear
 */
export function taxYearRange(startYear) {
  return { from: `${startYear}-04-06`, to: `${startYear + 1}-04-05` };
}

/** The UK tax year containing a given date. */
export function currentTaxYear(today = new Date()) {
  const year = today.getUTCFullYear();
  return today.getTime() >= Date.UTC(year, 3, 6) ? year : year - 1;
}

/**
 * Adds whole months to an ISO date, clamping to the end of the target month so
 * the 31st doesn't skip February. Shared by the recurring-payment forecast and
 * the compliance schedule, which must agree on what "a month later" means.
 *
 * @param {string} isoDate YYYY-MM-DD
 * @param {number} count may be negative
 * @returns {string} YYYY-MM-DD
 */
export function addMonths(isoDate, count) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + count, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

/** Adds whole days to an ISO date. */
export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Filters by ISO date, inclusive at both ends. A blank bound is open-ended.
 * @param {import('./types.js').Transaction[]} transactions
 * @param {string} from
 * @param {string} to
 */
export function filterByDate(transactions, from, to) {
  return transactions.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
}
