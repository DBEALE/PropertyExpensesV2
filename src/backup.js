import { toPence } from './allocation.js';
import { DEFAULT_CATEGORIES, isNonProperty } from './categories.js';
import { amountRange } from './rules.js';

export class BackupFormatError extends Error {}

const FORMAT = 'property-expenses-backup';

/**
 * @param {{properties: object[], categories: object[], rules: object[], transactions: object[]}} state
 * @param {string} exportedAt ISO timestamp
 */
export function buildBackup(state, exportedAt) {
  return {
    format: FORMAT,
    version: 2,
    exportedAt,
    properties: state.properties,
    categories: state.categories,
    rules: state.rules,
    transactions: state.transactions,
  };
}

/**
 * The one amount a split rule reconciles against. A rule with an amount
 * *range* has no single total, so a split on one is rejected as malformed.
 */
function exactAmountOf(rule) {
  const range = amountRange(rule);
  if (range === null) return undefined;
  return toPence(range.min) === toPence(range.max) ? range.min : undefined;
}

/**
 * Absent allocations are fine; present ones must be well formed and must sum
 * to the total they split. A backup that fails this would silently skew every
 * summary, so it is rejected rather than repaired.
 */
function allocationsValid(allocations, total, knownCategory) {
  if (allocations === undefined || allocations === null) return true;
  if (!Array.isArray(allocations) || allocations.length === 0) return false;
  const wellFormed = allocations.every(
    (a) =>
      a &&
      typeof a.propertyId === 'string' &&
      knownCategory(a.category) &&
      typeof a.amount === 'number' &&
      Number.isFinite(a.amount),
  );
  if (!wellFormed) return false;
  if (typeof total !== 'number') return false;
  return allocations.reduce((sum, a) => sum + toPence(a.amount), 0) === toPence(total);
}

/**
 * Validates a parsed backup file, rejecting anything malformed rather than
 * silently importing half a dataset.
 *
 * @param {unknown} raw
 * @returns {{properties: object[], categories: object[], rules: object[], transactions: object[]}}
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

  // Backups written before categories were editable carry the old fixed list
  // of names (or nothing at all). Rebuild the defaults for those, whose ids
  // match the names those files stored.
  const rawCategories = Array.isArray(data.categories) ? data.categories : [];
  const categories =
    rawCategories.length > 0 && typeof rawCategories[0] === 'object'
      ? rawCategories.filter(
          (c) => c && typeof c.id === 'string' && c.id !== '' && typeof c.name === 'string',
        )
      : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  if (rawCategories.length > 0 && typeof rawCategories[0] === 'object' && categories.length !== rawCategories.length) {
    throw new BackupFormatError('Backup file contains malformed categories.');
  }

  const knownCategory = (id) => categories.some((c) => c.id === id);
  const knownProperty = (id) =>
    isNonProperty(id) || data.properties.some((p) => p && p.id === id);

  const properties = data.properties.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string');
  const rules = data.rules.filter(
    (r) =>
      r &&
      typeof r.id === 'string' &&
      typeof r.matchText === 'string' &&
      knownCategory(r.category) &&
      knownProperty(r.propertyId) &&
      allocationsValid(r.allocations, exactAmountOf(r), knownCategory),
  );
  const transactions = data.transactions.filter(
    (t) =>
      t &&
      typeof t.id === 'string' &&
      typeof t.date === 'string' &&
      typeof t.amount === 'number' &&
      // An unassigned transaction has neither, which is valid.
      (t.category === null || knownCategory(t.category)) &&
      (t.propertyId === null || knownProperty(t.propertyId)) &&
      allocationsValid(t.allocations, t.amount, knownCategory),
  );

  if (
    properties.length !== data.properties.length ||
    rules.length !== data.rules.length ||
    transactions.length !== data.transactions.length
  ) {
    throw new BackupFormatError('Backup file contains malformed records.');
  }
  return { properties, categories, rules, transactions };
}
