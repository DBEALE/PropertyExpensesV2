/**
 * Filtering a transaction list, shared by the Transactions screen and the
 * read-only list on the Accounts screen so the two can't drift apart.
 *
 * Splits are the reason this isn't a one-line `filter`: a transaction split
 * across two properties belongs to *both*, so filtering by either one has to
 * keep it.
 */
import { allocationsOf, isAssigned } from './allocation.js';

/** Sentinel filter values that mean something other than a specific id. */
export const ANY = 'all';
export const UNASSIGNED = '__unassigned__';

/** @param {string} propertyId a property id, ANY, or UNASSIGNED */
export function matchesProperty(transaction, propertyId) {
  if (!propertyId || propertyId === ANY) return true;
  const shares = allocationsOf(transaction);
  if (propertyId === UNASSIGNED) return shares.length === 0;
  return shares.some((s) => s.propertyId === propertyId);
}

/** @param {string} category a category id, ANY, or UNASSIGNED */
export function matchesCategory(transaction, category) {
  if (!category || category === ANY) return true;
  const shares = allocationsOf(transaction);
  if (category === UNASSIGNED) return shares.length === 0 || shares.some((s) => !s.category);
  return shares.some((s) => s.category === category);
}

/**
 * @param {string} ruleId a rule id, ANY, or UNASSIGNED for "no rule applied"
 */
export function matchesRule(transaction, ruleId) {
  if (!ruleId || ruleId === ANY) return true;
  if (ruleId === UNASSIGNED) return transaction.matchedRuleId === null;
  return transaction.matchedRuleId === ruleId;
}

export function matchesStatus(transaction, status) {
  switch (status) {
    case 'review':
      return !isAssigned(transaction);
    case 'auto':
      return transaction.matchedRuleId !== null;
    case 'split':
      return Array.isArray(transaction.allocations) && transaction.allocations.length > 0;
    default:
      return true;
  }
}

export function matchesText(transaction, text) {
  if (!text) return true;
  return transaction.details.toLowerCase().includes(text.toLowerCase());
}

export function matchesDates(transaction, from, to) {
  return (!from || transaction.date >= from) && (!to || transaction.date <= to);
}

/**
 * Applies every filter at once.
 *
 * @param {object[]} transactions
 * @param {{text?: string, status?: string, from?: string, to?: string,
 *   propertyId?: string, category?: string, ruleId?: string}} filters
 */
export function filterTransactions(transactions, filters = {}) {
  return transactions.filter(
    (t) =>
      matchesDates(t, filters.from, filters.to) &&
      matchesText(t, filters.text) &&
      matchesStatus(t, filters.status) &&
      matchesProperty(t, filters.propertyId) &&
      matchesCategory(t, filters.category) &&
      matchesRule(t, filters.ruleId),
  );
}

/** True when any filter is narrowing the list — used to offer "clear". */
export function isFiltered(filters) {
  return Boolean(
    filters.text ||
      (filters.status && filters.status !== 'all') ||
      filters.from ||
      filters.to ||
      (filters.propertyId && filters.propertyId !== ANY) ||
      (filters.category && filters.category !== ANY) ||
      (filters.ruleId && filters.ruleId !== ANY),
  );
}
