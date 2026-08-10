import { hasSplit } from './allocation.js';
import { DEFAULT_CATEGORIES, NON_PROPERTY_NAME, isNonProperty } from './categories.js';
import { DEFAULT_COMPLIANCE_TYPES, completionsForType } from './compliance.js';
import { withDefaults } from './tax.js';
import { slotClass } from './palette.js';
import { supersede } from './property-details.js';
import * as db from './db.js';
import { recategorise } from './importer.js';
import { validateBackup } from './backup.js';

/** In-memory mirror of IndexedDB, refreshed after every write. */
const state = {
  properties: [],
  categories: [],
  propertyDetails: [],
  complianceTypes: [],
  complianceCompletions: [],
  settings: [],
  rules: [],
  transactions: [],
};
const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

export async function load() {
  let [properties, categories, propertyDetails, complianceTypes, complianceCompletions, settings, rules, transactions] =
    await Promise.all([
      db.getAll('properties'),
      db.getAll('categories'),
      db.getAll('propertyDetails'),
      db.getAll('complianceTypes'),
      db.getAll('complianceCompletions'),
      db.getAll('settings'),
      db.getAll('rules'),
      db.getAll('transactions'),
    ]);
  // First run, or an install predating editable categories: seed the five
  // defaults. Their ids match the names older records stored, so existing
  // transactions and rules keep resolving.
  if (categories.length === 0) {
    categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    await db.putMany('categories', categories);
  }
  // Same shape as the category seeding above: fill in the defaults once, then
  // they are the user's to edit.
  if (complianceTypes.length === 0) {
    complianceTypes = DEFAULT_COMPLIANCE_TYPES.map((t) => ({ ...t }));
    await db.putMany('complianceTypes', complianceTypes);
  }
  state.properties = properties.sort((a, b) => a.name.localeCompare(b.name));
  state.categories = categories;
  state.propertyDetails = propertyDetails;
  state.complianceTypes = complianceTypes;
  state.complianceCompletions = complianceCompletions;
  state.settings = settings;
  state.rules = rules;
  state.transactions = transactions.sort((a, b) => b.date.localeCompare(a.date));
  notify();
}

/** @param {string|null} id */
export function propertyName(id) {
  if (!id) return '';
  if (isNonProperty(id)) return NON_PROPERTY_NAME;
  const property = state.properties.find((p) => p.id === id);
  return property ? property.name : '(deleted property)';
}

/** @param {string|null} id */
export function categoryName(id) {
  if (!id) return '';
  const category = state.categories.find((c) => c.id === id);
  return category ? category.name : '(deleted category)';
}

/** @param {string|null} id */
export function categoryDescription(id) {
  const category = state.categories.find((c) => c.id === id);
  return category?.description ?? '';
}

/** The record behind an id, for anything that needs its colour too. */
export function propertyRecord(id) {
  if (isNonProperty(id)) return { id, name: NON_PROPERTY_NAME, colour: 'neutral' };
  return state.properties.find((p) => p.id === id) ?? null;
}

export function categoryRecord(id) {
  return state.categories.find((c) => c.id === id) ?? null;
}

/** CSS slot class for a property id, falling back to neutral when unknown. */
export function propertySlot(id) {
  const record = propertyRecord(id);
  return record ? slotClass(record) : 'slot-neutral';
}

export function categorySlot(id) {
  const record = categoryRecord(id);
  return record ? slotClass(record) : 'slot-neutral';
}

// --- Categories ---------------------------------------------------------

export async function saveCategory(category) {
  await db.put('categories', category);
  await load();
}

/**
 * Deletes a category and detaches everything referencing it. Rules that named
 * it are deleted; transactions that used it are unassigned, including splits,
 * whose remaining shares would no longer total the transaction.
 */
export async function deleteCategory(id) {
  await db.remove('categories', id);
  for (const rule of state.rules.filter((r) => referencesCategory(r, id))) {
    await db.remove('rules', rule.id);
  }
  const touched = state.transactions.filter((t) => referencesCategory(t, id)).map(unassign);
  if (touched.length > 0) await db.putMany('transactions', touched);
  await load();
}

function referencesCategory(record, categoryId) {
  if (record.category === categoryId) return true;
  return hasSplit(record) && record.allocations.some((a) => a.category === categoryId);
}

/** How many rules and transactions would be affected by deleting a category. */
export function categoryUsage(id) {
  return {
    rules: state.rules.filter((r) => referencesCategory(r, id)).length,
    transactions: state.transactions.filter((t) => referencesCategory(t, id)).length,
  };
}

// --- Properties ---------------------------------------------------------

export async function saveProperty(property) {
  await db.put('properties', property);
  await load();
}

export async function deleteProperty(id) {
  await db.remove('properties', id);
  // Detach the property from anything referencing it, so no dangling ids
  // remain — including rules and transactions that only mention it in a split.
  for (const rule of state.rules.filter((r) => referencesProperty(r, id))) {
    await db.remove('rules', rule.id);
  }
  for (const detail of state.propertyDetails.filter((d) => d.propertyId === id)) {
    await db.remove('propertyDetails', detail.id);
  }
  for (const completion of state.complianceCompletions.filter((c) => c.propertyId === id)) {
    await db.remove('complianceCompletions', completion.id);
  }
  const touched = state.transactions.filter((t) => referencesProperty(t, id)).map(unassign);
  if (touched.length > 0) await db.putMany('transactions', touched);
  await load();
}

function referencesProperty(record, propertyId) {
  if (record.propertyId === propertyId) return true;
  return hasSplit(record) && record.allocations.some((a) => a.propertyId === propertyId);
}

/**
 * Clears an assignment entirely. A split loses every share, not just the one
 * naming the deleted property — dropping a single share would leave the rest
 * no longer summing to the transaction total.
 */
function unassign(transaction) {
  const { allocations, ...rest } = transaction;
  return { ...rest, propertyId: null, category: null, matchedRuleId: null };
}

// --- Property details ---------------------------------------------------

/**
 * Records a new version of one section. The record it replaces is kept and
 * stamped with the date this one takes effect, so the old arrangement stays
 * readable rather than being overwritten.
 */
export async function savePropertyDetail({ propertyId, section, data, effectiveFrom }) {
  const { record, superseded } = supersede({
    records: state.propertyDetails,
    propertyId,
    section,
    data,
    effectiveFrom,
    recordedAt: new Date().toISOString(),
    id: db.newId(),
  });
  const writes = superseded ? [superseded, record] : [record];
  await db.putMany('propertyDetails', writes);
  await load();
}

/** Deletes one historical record — for a mistake, not for tidying up. */
export async function deletePropertyDetail(id) {
  await db.remove('propertyDetails', id);
  await load();
}

export function detailsFor(propertyId) {
  return state.propertyDetails.filter((r) => r.propertyId === propertyId);
}

// --- Compliance ---------------------------------------------------------

export async function saveComplianceType(type) {
  await db.put('complianceTypes', type);
  await load();
}

/**
 * Deletes a compliance type and the completions logged against it — the same
 * detach-everything-referencing-it approach as deleteCategory. Without the
 * cascade those rows would sit in the store pointing at nothing, and the
 * backup validator would reject the next export.
 */
export async function deleteComplianceType(id) {
  await db.remove('complianceTypes', id);
  for (const completion of completionsForType(state.complianceCompletions, id)) {
    await db.remove('complianceCompletions', completion.id);
  }
  await load();
}

/** How many logged completions a type would take with it if deleted. */
export function complianceTypeUsage(id) {
  return {
    completions: completionsForType(state.complianceCompletions, id).length,
  };
}

export async function saveComplianceCompletion({ propertyId, complianceTypeId, completedDate, reference, notes }) {
  await db.put('complianceCompletions', {
    id: db.newId(),
    propertyId,
    complianceTypeId,
    completedDate,
    reference: reference ?? '',
    notes: notes ?? '',
  });
  await load();
}

/** Deletes one logged completion — for correcting a mistaken entry. */
export async function deleteComplianceCompletion(id) {
  await db.remove('complianceCompletions', id);
  await load();
}

/**
 * The tax parameters behind the Summary estimate, with defaults filled in for
 * anything not yet set — including on a first run, when nothing is stored.
 */
export function taxSettings() {
  return withDefaults(state.settings.find((s) => s.id === 'tax'));
}

export async function saveTaxSettings(settings) {
  await db.put('settings', { ...settings, id: 'tax' });
  await load();
}

// --- Rules --------------------------------------------------------------

export async function saveRule(rule) {
  await db.put('rules', rule);
  await load();
}

export async function deleteRule(id) {
  await db.remove('rules', id);
  await load();
}

/**
 * Re-runs the rule engine over stored transactions.
 * @returns {Promise<number>} how many transactions changed.
 */
export async function reapplyRules() {
  const updated = recategorise(state.transactions, state.rules);
  if (updated.length > 0) {
    await db.putMany('transactions', updated);
    await load();
  }
  return updated.length;
}

// --- Transactions -------------------------------------------------------

export async function addTransactions(transactions) {
  await db.putMany('transactions', transactions);
  await load();
}

export async function updateTransaction(transaction) {
  await db.put('transactions', transaction);
  await load();
}

export async function deleteTransaction(id) {
  await db.remove('transactions', id);
  await load();
}

// --- Backup -------------------------------------------------------------

export async function restoreBackup(raw) {
  await db.replaceAll(validateBackup(raw));
  await load();
}


export async function clearEverything() {
  await db.clearAll();
  await load();
}
