/**
 * Per-property account analysis: what went in and out each month, and which
 * payments recur — so "when was the rent paid" and "when is the insurance due"
 * are answerable from the statement history alone.
 *
 * Pure functions over transactions; no DOM, no storage.
 */
import { allocationsOf, sumAllocations, toPence, fromPence } from './allocation.js';
import { isNonProperty } from './categories.js';

/** Every share belonging to one property, each carrying its transaction. */
export function sharesFor(transactions, propertyId) {
  const rows = [];
  for (const transaction of transactions) {
    for (const share of allocationsOf(transaction)) {
      if (propertyId === null || share.propertyId === propertyId) {
        rows.push({ ...share, transaction });
      }
    }
  }
  return rows;
}

/** "2026-07" from an ISO date. */
export function monthKey(isoDate) {
  return isoDate.slice(0, 7);
}

/** "Jul 26" — short enough for an axis tick. */
export function monthLabel(key) {
  const [year, month] = key.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(month) - 1]} ${year.slice(2)}`;
}

/** Every month from the first to the last share, including empty ones. */
export function monthRange(shares) {
  if (shares.length === 0) return [];
  const keys = shares.map((s) => monthKey(s.transaction.date)).sort();
  const [startYear, startMonth] = keys[0].split('-').map(Number);
  const [endYear, endMonth] = keys[keys.length - 1].split('-').map(Number);

  const months = [];
  let year = startYear;
  let month = startMonth;
  // Guard against a runaway loop if dates are ever out of order.
  while ((year < endYear || (year === endYear && month <= endMonth)) && months.length < 600) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/**
 * Money in and out per month, split by category, ready to stack.
 *
 * @returns {{month: string, label: string, income: number, expenses: number,
 *   net: number, byCategory: Map<string, number>}[]}
 */
export function monthlyTotals(shares) {
  const months = monthRange(shares);
  return months.map((month) => {
    const inMonth = shares.filter((s) => monthKey(s.transaction.date) === month);
    const byCategory = new Map();
    for (const share of inMonth) {
      byCategory.set(share.category, fromPence(toPence(byCategory.get(share.category) ?? 0) + toPence(share.amount)));
    }
    return {
      month,
      label: monthLabel(month),
      income: sumAllocations(inMonth.filter((s) => s.amount > 0)),
      expenses: sumAllocations(inMonth.filter((s) => s.amount < 0)),
      net: sumAllocations(inMonth),
      byCategory,
    };
  });
}

/** Running balance of the account after each month. */
export function runningTotals(months) {
  let balance = 0;
  return months.map((m) => {
    balance = fromPence(toPence(balance) + toPence(m.net));
    return { ...m, balance };
  });
}

/** Median of a numeric list — resistant to one odd payment date. */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function addMonths(isoDate, count) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + count, 1));
  // Clamp to the last day of the target month, so the 31st doesn't skip February.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

/**
 * Groups a property's shares into recurring payment streams — rent from one
 * tenant, one mortgage, one insurance policy — and works out when each is next
 * expected.
 *
 * Streams are keyed by the rule that categorised them where there is one, since
 * that is exactly the user's own statement of "these are the same payment".
 * Otherwise the payee text and category stand in.
 *
 * @param {ReturnType<typeof sharesFor>} shares
 * @param {string} today ISO date, so callers control "now" rather than the clock
 */
export function paymentStreams(shares, today) {
  const groups = new Map();

  for (const share of shares) {
    const key = share.transaction.matchedRuleId
      ? `rule:${share.transaction.matchedRuleId}`
      : `text:${share.transaction.details.toLowerCase()}|${share.category}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: share.transaction.details,
        category: share.category,
        propertyId: share.propertyId,
        direction: share.amount > 0 ? 'in' : 'out',
        occurrences: [],
      });
    }
    groups.get(key).occurrences.push({ date: share.transaction.date, amount: share.amount });
  }

  return [...groups.values()]
    .map((group) => {
      const dates = group.occurrences.map((o) => o.date).sort();
      const amounts = group.occurrences.map((o) => o.amount);
      const lastDate = dates[dates.length - 1];
      const typicalDay = median(dates.map((d) => Number(d.slice(8, 10))));
      const gaps = monthGaps(dates);
      // Two or more sightings roughly a month apart is a recurring payment;
      // anything else is a one-off and gets no forecast.
      const recurring = dates.length >= 2 && gaps.every((g) => g >= 1 && g <= 2);
      return {
        ...group,
        count: dates.length,
        firstDate: dates[0],
        lastDate,
        typicalDay,
        typicalAmount: median(amounts.map(toPence)) / 100,
        total: sumAllocations(group.occurrences),
        recurring,
        nextExpected: recurring ? nextAfter(lastDate, today) : null,
      };
    })
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

/** Whole-month gaps between consecutive dates. */
function monthGaps(dates) {
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    const [y1, m1] = dates[i - 1].split('-').map(Number);
    const [y2, m2] = dates[i].split('-').map(Number);
    gaps.push((y2 - y1) * 12 + (m2 - m1));
  }
  return gaps;
}

/** The next monthly occurrence strictly after today, based on the last one. */
function nextAfter(lastDate, today) {
  let next = addMonths(lastDate, 1);
  let guard = 0;
  while (next <= today && guard < 120) {
    next = addMonths(next, 1);
    guard++;
  }
  return next;
}

/**
 * Whether a recurring payment looks late: its next occurrence was expected
 * before today and nothing has arrived.
 */
export function isOverdue(stream, today) {
  if (!stream.recurring) return false;
  const expected = addMonths(stream.lastDate, 1);
  return expected < today;
}

/** Headline figures for one property, or for all of them together. */
export function accountSummary(shares) {
  const income = sumAllocations(shares.filter((s) => s.amount > 0));
  const expenses = sumAllocations(shares.filter((s) => s.amount < 0));
  return {
    income,
    expenses,
    net: sumAllocations(shares),
    count: shares.length,
  };
}

/** Property totals for the all-properties comparison, biggest net first. */
export function propertyTotals(transactions, properties) {
  return properties
    .map((property) => ({
      property,
      ...accountSummary(sharesFor(transactions, property.id)),
    }))
    .filter((row) => row.count > 0 || !isNonProperty(row.property.id));
}
