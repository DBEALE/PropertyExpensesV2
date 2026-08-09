import { hasSplit } from './allocation.js';
import { DEFAULT_CATEGORIES, NON_PROPERTY_NAME, isNonProperty } from './categories.js';
import * as db from './db.js';
import { recategorise } from './importer.js';
import { validateBackup } from './backup.js';

/** In-memory mirror of IndexedDB, refreshed after every write. */
const state = { properties: [], categories: [], rules: [], transactions: [] };
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
  let [properties, categories, rules, transactions] = await Promise.all([
    db.getAll('properties'),
    db.getAll('categories'),
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
  state.properties = properties.sort((a, b) => a.name.localeCompare(b.name));
  state.categories = categories;
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
