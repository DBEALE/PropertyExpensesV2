import { isCategory, CATEGORIES } from './types.js';

export class BackupFormatError extends Error {}

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
    (r) => r && typeof r.id === 'string' && typeof r.matchText === 'string' && isCategory(r.category),
  );
  const transactions = data.transactions.filter(
    (t) => t && typeof t.id === 'string' && typeof t.date === 'string' && typeof t.amount === 'number',
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
