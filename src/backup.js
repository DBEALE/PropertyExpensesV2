import { toPence } from './allocation.js';
import { amountRange } from './rules.js';
import { isCategory, CATEGORIES } from './types.js';

export class BackupFormatError extends Error {}

/**
 * Absent allocations are fine; present ones must be well formed and must sum
 * to the total they split. A backup that fails this would silently skew every
 * summary, so it is rejected rather than repaired.
 */
/**
 * The one amount a split rule reconciles against. A rule with an amount
 * *range* has no single total, so a split on one is rejected as malformed.
 */
function exactAmountOf(rule) {
  const range = amountRange(rule);
  if (range === null) return undefined;
  return toPence(range.min) === toPence(range.max) ? range.min : undefined;
}

function allocationsValid(allocations, total) {
  if (allocations === undefined || allocations === null) return true;
  if (!Array.isArray(allocations) || allocations.length === 0) return false;
  const wellFormed = allocations.every(
    (a) =>
      a &&
      typeof a.propertyId === 'string' &&
      isCategory(a.category) &&
      typeof a.amount === 'number' &&
      Number.isFinite(a.amount),
  );
  if (!wellFormed) return false;
  if (typeof total !== 'number') return false;
  return allocations.reduce((sum, a) => sum + toPence(a.amount), 0) === toPence(total);
}

const FORMAT = 'property-expenses-backup';

/**
 * @param {{properties: import('./types.js').Property[], rules: import('./types.js').Rule[], transactions: import('./types.js').Transaction[]}} state
 * @param {string} exportedAt ISO timestamp
 */
export function buildBackup(state, exportedAt) {
  return {
    format: FORMAT,
    version: 1,
    exportedAt,
    properties: state.properties,
    categories: CATEGORIES,
    rules: state.rules,
    transactions: state.transactions,
  };
}

/**
 * Validates a parsed backup file, rejecting anything malformed rather than
 * silently importing half a dataset.
 *
 * @param {unknown} raw
 * @returns {{properties: import('./types.js').Property[], rules: import('./types.js').Rule[], transactions: import('./types.js').Transaction[]}}
 */
export function validateBackup(raw) {
  if (typeof raw !== 'object' || raw === null) throw new BackupFormatError('Not a valid backup file.');
  const data = /** @type {any} */ (raw);
  if (data.format !== FORMAT) {
    throw new BackupFormatError('This file is not a Property Expenses backup.');
  }
  if (!Array.isArray(data.properties) || !Array.isArray(data.rules) || !Array.isArray(data.transactions)) {
    throw new BackupFormatError('Backup file is missing properties, rules or transactions.');
  }

  const properties = data.properties.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string');
  const rules = data.rules.filter(
    (r) =>
      r &&
      typeof r.id === 'string' &&
      typeof r.matchText === 'string' &&
      isCategory(r.category) &&
      allocationsValid(r.allocations, exactAmountOf(r)),
  );
  const transactions = data.transactions.filter(
    (t) =>
      t &&
      typeof t.id === 'string' &&
      typeof t.date === 'string' &&
      typeof t.amount === 'number' &&
      allocationsValid(t.allocations, t.amount),
  );

  if (
    properties.length !== data.properties.length ||
    rules.length !== data.rules.length ||
    transactions.length !== data.transactions.length
  ) {
    throw new BackupFormatError('Backup file contains malformed records.');
  }
  return { properties, rules, transactions };
}
