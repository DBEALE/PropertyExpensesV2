import { parseStatement } from './csv.js';
import { findMatchingRule } from './rules.js';

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
    const rule = findMatchingRule(row, rules);
    return {
      id: newId(),
      date: row.date,
      details: row.details,
      transactionType: row.transactionType,
      amount: row.amount,
      balance: row.balance,
      propertyId: rule ? rule.propertyId : null,
      category: rule ? rule.category : null,
      matchedRuleId: rule ? rule.id : null,
      sourceFilename: filename,
      importedAt,
    };
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
    if (t.propertyId !== null && t.matchedRuleId === null) continue;
    const rule = findMatchingRule(t, rules);
    const next = rule
      ? { ...t, propertyId: rule.propertyId, category: rule.category, matchedRuleId: rule.id }
      : { ...t, propertyId: null, category: null, matchedRuleId: null };
    if (
      next.propertyId !== t.propertyId ||
      next.category !== t.category ||
      next.matchedRuleId !== t.matchedRuleId
    ) {
      updated.push(next);
    }
  }
  return updated;
}
