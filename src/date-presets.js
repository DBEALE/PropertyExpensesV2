/**
 * The date-range shortcuts offered next to every from/to filter.
 *
 * The year options are derived from the transactions actually imported rather
 * than from a fixed span: offering "2019" to someone whose statements start in
 * 2025 gives them a menu of empty results, and offering only the current year
 * hides the history they came for.
 *
 * Pure functions over transactions; no DOM, no storage.
 */
import { addMonths, taxYearRange } from './dates.js';

export const ALL = 'all';
export const CUSTOM = 'custom';

/** The UK tax year a date falls in, named by its starting year. */
export function taxYearOf(isoDate) {
  const year = Number(isoDate.slice(0, 4));
  // The year turns on 6 April, so anything before that belongs to the previous.
  return isoDate.slice(5) >= '04-06' ? year : year - 1;
}

/** "2026/27" — how a UK tax year is written. */
export function taxYearLabel(startYear) {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * The tax year in progress, as a range — the opening filter for every screen
 * that shows money.
 *
 * Defaulting to "all dates" made every total a lifetime figure, which is
 * almost never the question being asked: a landlord looking at Summary or at a
 * property's costs wants this year unless they say otherwise. Widening to the
 * whole history is one click; noticing that a number quietly covered eleven
 * years is not.
 *
 * @param {string} [today] ISO date, so callers control "now" rather than the clock
 */
export function currentTaxYearRange(today) {
  return taxYearRange(taxYearOf(today ?? new Date().toISOString().slice(0, 10)));
}

function calendarYearRange(year) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** A rolling window ending today. */
function lastMonths(today, months) {
  // One day forward so "last month" spans a whole month inclusive rather than
  // a month and a day.
  return { from: addMonths(today, -months), to: today };
}

/**
 * Every option to offer, grouped for an optgroup-per-heading select.
 *
 * @param {{date: string}[]} transactions
 * @param {string} today ISO date, so callers control "now" rather than the clock
 * @returns {{label: string, options: {key: string, label: string, from: string, to: string}[]}[]}
 */
export function datePresetGroups(transactions, today) {
  const dates = transactions.map((t) => t.date).filter(Boolean);

  const quick = [
    { key: ALL, label: 'All dates', from: '', to: '' },
    { key: 'last-1m', label: 'Last month', ...lastMonths(today, 1) },
    { key: 'last-3m', label: 'Last 3 months', ...lastMonths(today, 3) },
    { key: 'last-12m', label: 'Last 12 months', ...lastMonths(today, 12) },
  ];

  const taxYears = [...new Set(dates.map(taxYearOf))]
    .sort((a, b) => b - a)
    .map((year) => ({
      key: `ty-${year}`,
      label: `${taxYearLabel(year)} tax year`,
      ...taxYearRange(year),
    }));

  const calendarYears = [...new Set(dates.map((d) => Number(d.slice(0, 4))))]
    .sort((a, b) => b - a)
    .map((year) => ({ key: `cy-${year}`, label: String(year), ...calendarYearRange(year) }));

  return [
    { label: 'Quick ranges', options: quick },
    ...(taxYears.length > 0 ? [{ label: 'Tax years', options: taxYears }] : []),
    ...(calendarYears.length > 0 ? [{ label: 'Calendar years', options: calendarYears }] : []),
  ];
}

/** The groups flattened, for looking a key up. */
export function datePresets(transactions, today) {
  return datePresetGroups(transactions, today).flatMap((group) => group.options);
}

export function presetByKey(transactions, today, key) {
  return datePresets(transactions, today).find((p) => p.key === key) ?? null;
}

/**
 * Which preset the current from/to corresponds to, or CUSTOM when the user has
 * typed a range of their own. Lets the dropdown reflect dates set elsewhere
 * instead of lying about what is selected.
 */
export function matchPreset(transactions, today, from, to) {
  const match = datePresets(transactions, today).find((p) => p.from === from && p.to === to);
  return match ? match.key : CUSTOM;
}
