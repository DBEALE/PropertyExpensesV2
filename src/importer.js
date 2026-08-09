import { hasSplit, isAssigned } from './allocation.js';
import { parseStatement } from './csv.js';
import { findMatchingRule } from './rules.js';

/**
 * Applies a rule's outcome to a transaction. The single place assignment
 * happens, so a split rule and a simple rule can't drift apart.
 *
 * @param {import('./types.js').Transaction} transaction
 * @param {import('./types.js').Rule|null} rule
 * @returns {import('./types.js').Transaction}
 */
export function applyRule(transaction, rule) {
  const { allocations, ...rest } = transaction;
  if (!rule) return { ...rest, propertyId: null, category: null, matchedRuleId: null };
  if (hasSplit(rule)) {
    return {
      ...rest,
      propertyId: null,
      category: null,
      allocations: rule.allocations.map((a) => ({ ...a })),
      matchedRuleId: rule.id,
    };
  }
  return { ...rest, propertyId: rule.propertyId, category: rule.category, matchedRuleId: rule.id };
}

/** True when two assignments differ — used to avoid pointless writes. */
function assignmentChanged(a, b) {
  return (
    a.propertyId !== b.propertyId ||
    a.category !== b.category ||
    a.matchedRuleId !== b.matchedRuleId ||
    JSON.stringify(a.allocations ?? null) !== JSON.stringify(b.allocations ?? null)
  );
}

/**
 * Turns statement text into Transaction records with rules already applied.
 * Kept free of storage and DOM so the import path is directly testable.
 *
 * @param {string} text raw CSV
 * @param {object} options
 * @param {import('./types.js').Rule[]} options.rules
 * @param {string} options.filename
 * @param {string} options.importedAt ISO timestamp
 * @param {() => string} options.newId
 * @returns {import('./types.js').Transaction[]}
 */
export function buildTransactions(text, { rules, filename, importedAt, newId }) {
  return parseStatement(text).map((row) => {
    const transaction = {
      id: newId(),
      date: row.date,
      details: row.details,
      transactionType: row.transactionType,
      amount: row.amount,
      balance: row.balance,
      propertyId: null,
      category: null,
      matchedRuleId: null,
      sourceFilename: filename,
      importedAt,
    };
    return applyRule(transaction, findMatchingRule(row, rules));
  });
}

/**
 * Detects a transaction already imported from a previous file: same date,
 * details, amount and balance. Prevents double-counting when statement
 * exports overlap.
 *
 * @param {import('./types.js').Transaction} candidate
 * @param {import('./types.js').Transaction[]} existing
 */
export function isDuplicate(candidate, existing) {
  return existing.some(
    (t) =>
      t.date === candidate.date &&
      t.details === candidate.details &&
      t.amount === candidate.amount &&
      t.balance === candidate.balance,
  );
}

/**
 * Re-runs the rule engine over transactions, returning only those whose
 * assignment changes. Transactions assigned by hand (categorised but with no
 * matchedRuleId) are left untouched.
 *
 * @param {import('./types.js').Transaction[]} transactions
 * @param {import('./types.js').Rule[]} rules
 * @returns {import('./types.js').Transaction[]}
 */
export function recategorise(transactions, rules) {
  const updated = [];
  for (const t of transactions) {
    // Assigned by hand (categorised, but not by a rule) — leave it alone.
    if (isAssigned(t) && t.matchedRuleId === null) continue;
    const next = applyRule(t, findMatchingRule(t, rules));
    if (assignmentChanged(t, next)) updated.push(next);
  }
  return updated;
}
