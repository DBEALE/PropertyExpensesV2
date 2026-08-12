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
    version: 6,
    exportedAt,
    properties: state.properties,
    categories: state.categories,
    propertyDetails: state.propertyDetails ?? [],
    complianceTypes: state.complianceTypes ?? [],
    complianceCompletions: state.complianceCompletions ?? [],
    complianceExemptions: state.complianceExemptions ?? [],
    settings: state.settings ?? [],
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
  // Detail records are optional: backups written before they existed have none.
  const rawDetails = Array.isArray(data.propertyDetails) ? data.propertyDetails : [];
  const propertyDetails = rawDetails.filter(
    (d) =>
      d &&
      typeof d.id === 'string' &&
      typeof d.propertyId === 'string' &&
      typeof d.section === 'string' &&
      typeof d.effectiveFrom === 'string' &&
      typeof d.data === 'object' &&
      d.data !== null,
  );
  if (propertyDetails.length !== rawDetails.length) {
    throw new BackupFormatError('Backup file contains malformed property details.');
  }
  // Compliance is optional too: backups written before it existed have none,
  // and those restore with the defaults seeded on the next load.
  const rawTypes = Array.isArray(data.complianceTypes) ? data.complianceTypes : [];
  const complianceTypes = rawTypes.filter(
    (t) =>
      t &&
      typeof t.id === 'string' &&
      t.id !== '' &&
      typeof t.name === 'string' &&
      Number.isFinite(Number(t.frequencyMonths)) &&
      Number(t.frequencyMonths) > 0,
  );
  if (complianceTypes.length !== rawTypes.length) {
    throw new BackupFormatError('Backup file contains malformed compliance types.');
  }

  const knownComplianceType = (id) => complianceTypes.some((t) => t.id === id);
  const rawCompletions = Array.isArray(data.complianceCompletions) ? data.complianceCompletions : [];
  const complianceCompletions = rawCompletions.filter(
    (c) =>
      c &&
      typeof c.id === 'string' &&
      typeof c.completedDate === 'string' &&
      knownProperty(c.propertyId) &&
      // A completion pointing at a type the file doesn't contain would show up
      // as a schedule with no rule behind it, so it is rejected outright.
      knownComplianceType(c.complianceTypeId),
  );
  if (complianceCompletions.length !== rawCompletions.length) {
    throw new BackupFormatError('Backup file contains malformed compliance completions.');
  }

  // Which certificates a property is exempt from. Optional, like the two
  // above: a backup written before the tick box existed simply has none, and
  // restores as "everything applies", which is what it meant at the time.
  const rawExemptions = Array.isArray(data.complianceExemptions) ? data.complianceExemptions : [];
  const complianceExemptions = rawExemptions.filter(
    (e) =>
      e &&
      typeof e.id === 'string' &&
      knownProperty(e.propertyId) &&
      knownComplianceType(e.complianceTypeId),
  );
  if (complianceExemptions.length !== rawExemptions.length) {
    throw new BackupFormatError('Backup file contains malformed compliance exemptions.');
  }

  // Settings are optional and self-describing; anything unrecognised is
  // dropped rather than rejected, since a missing parameter falls back to its
  // default rather than corrupting anything.
  const settings = (Array.isArray(data.settings) ? data.settings : []).filter(
    (s) => s && typeof s.id === 'string',
  );

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
  return {
    properties,
    categories,
    propertyDetails,
    complianceTypes,
    complianceCompletions,
    complianceExemptions,
    settings,
    rules,
    transactions,
  };
}
