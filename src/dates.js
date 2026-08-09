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
 * Filters by ISO date, inclusive at both ends. A blank bound is open-ended.
 * @param {import('./types.js').Transaction[]} transactions
 * @param {string} from
 * @param {string} to
 */
export function filterByDate(transactions, from, to) {
  return transactions.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
}
