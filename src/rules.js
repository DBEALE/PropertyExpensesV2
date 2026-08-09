/**
 * A rule carries up to three independent conditions — text against `Details`,
 * an exact Transaction Type, and an exact signed amount. Any combination is
 * allowed; a transaction must satisfy *every* condition the rule sets. A rule
 * with no conditions at all would match everything, so it never matches.
 */

/** True when a rule constrains the given field. */
export function hasText(rule) {
  return typeof rule.matchText === 'string' && rule.matchText.trim() !== '';
}

export function hasType(rule) {
  return typeof rule.transactionTypeEquals === 'string' && rule.transactionTypeEquals.trim() !== '';
}

/**
 * The rule's amount condition as an inclusive signed range, or null when it
 * sets none. Accepts the legacy `amountEquals` shape so rules and backups
 * written before ranges existed keep matching exactly as they did.
 *
 * @returns {{min: number, max: number}|null}
 */
export function amountRange(rule) {
  const isNumber = (n) => typeof n === 'number' && Number.isFinite(n);
  if (isNumber(rule.amountMin) || isNumber(rule.amountMax)) {
    // A half-open range is treated as unbounded on the missing side.
    const min = isNumber(rule.amountMin) ? rule.amountMin : -Infinity;
    const max = isNumber(rule.amountMax) ? rule.amountMax : Infinity;
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }
  if (isNumber(rule.amountEquals)) return { min: rule.amountEquals, max: rule.amountEquals };
  return null;
}

export function hasAmount(rule) {
  return amountRange(rule) !== null;
}

/** True when the amount condition pins a single value rather than a range. */
export function isExactAmount(rule) {
  const range = amountRange(rule);
  return range !== null && Math.round(range.min * 100) === Math.round(range.max * 100);
}

/** Width of the amount range in pence; 0 for an exact pin, Infinity if unset. */
export function amountWidth(rule) {
  const range = amountRange(rule);
  if (range === null) return Infinity;
  return Math.round(range.max * 100) - Math.round(range.min * 100);
}

/** How many conditions a rule sets, and how tightly. Higher wins ties. */
export function specificity(rule) {
  // Amount is weighted above the others so an amount-pinned rule always beats
  // a looser rule for the same payee, which is the disambiguation contract.
  return (hasAmount(rule) ? 4 : 0) + (hasType(rule) ? 2 : 0) + (hasText(rule) ? 1 : 0);
}

/**
 * Tests a rule's text pattern against a transaction's Details field.
 * @param {import('./types.js').Rule} rule
 * @param {string} details
 */
export function matchesText(rule, details) {
  const target = details ?? '';
  switch (rule.matchType) {
    case 'exact':
      return target.trim().toLowerCase() === rule.matchText.trim().toLowerCase();
    case 'regex':
      try {
        return new RegExp(rule.matchText, 'i').test(target);
      } catch {
        // An invalid pattern never matches rather than breaking the whole import.
        return false;
      }
    case 'contains':
    default:
      return target.toLowerCase().includes(rule.matchText.toLowerCase());
  }
}

/** Transaction Type is free text from the bank, so compare it leniently. */
export function matchesType(rule, transactionType) {
  return (transactionType ?? '').trim().toLowerCase() === rule.transactionTypeEquals.trim().toLowerCase();
}

/**
 * Amounts are compared to the penny, so float drift can't miss a bound, and
 * the range is inclusive at both ends.
 */
export function matchesAmount(rule, amount) {
  const range = amountRange(rule);
  if (range === null) return true;
  const pence = Math.round(amount * 100);
  return pence >= Math.round(range.min * 100) && pence <= Math.round(range.max * 100);
}

/**
 * True when a transaction satisfies every condition the rule sets.
 * @param {import('./types.js').Rule} rule
 * @param {{details?: string, transactionType?: string, amount?: number}} transaction
 */
export function matchesRule(rule, transaction) {
  if (specificity(rule) === 0) return false;
  if (hasText(rule) && !matchesText(rule, transaction.details)) return false;
  if (hasType(rule) && !matchesType(rule, transaction.transactionType)) return false;
  if (hasAmount(rule) && !matchesAmount(rule, transaction.amount)) return false;
  return true;
}

/**
 * Finds the rule that categorizes a transaction, or null.
 *
 * Rules are tried most-specific first, so a rule pinned to an exact amount
 * (e.g. NATWEST BANK + £428.06 -> Property A) wins over a looser text-only
 * rule for the same payee, and a type-narrowed rule wins over one without.
 * Rules of equal specificity are tried in the order given, first match wins.
 *
 * @param {{details?: string, transactionType?: string, amount?: number}} transaction
 * @param {import('./types.js').Rule[]} rules
 * @returns {import('./types.js').Rule|null}
 */
export function findMatchingRule(transaction, rules) {
  const ordered = orderRules(rules);
  for (const rule of ordered) {
    if (matchesRule(rule, transaction)) return rule;
  }
  return null;
}

/**
 * Rules in evaluation order: most specific first, insertion order preserved
 * within a tier. The Rules page lists them this way so the table reads as the
 * order they actually fire in.
 */
export function orderRules(rules) {
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort(
      (a, b) =>
        specificity(b.rule) - specificity(a.rule) ||
        // A tighter amount window is more specific than a looser one, so an
        // exact pin still beats a ±10% range for the same payee.
        amountWidth(a.rule) - amountWidth(b.rule) ||
        a.index - b.index,
    )
    .map((entry) => entry.rule);
}

/**
 * Counts how many of the given transactions each rule would claim.
 * @param {import('./types.js').Rule[]} rules
 * @param {{details?: string, transactionType?: string, amount?: number}[]} transactions
 * @returns {Map<string, number>}
 */
export function countMatches(rules, transactions) {
  const counts = new Map(rules.map((r) => [r.id, 0]));
  for (const t of transactions) {
    const rule = findMatchingRule(t, rules);
    if (rule) counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);
  }
  return counts;
}

/**
 * True when an existing rule's text already claims this transaction on behalf
 * of a different property — the signal that this payee is shared and the new
 * rule needs another condition to stay distinct.
 *
 * Tested by matching rather than by comparing match text, so it also catches a
 * broad rule ("NATWEST") shadowing a specific description.
 *
 * @param {{details?: string, propertyId?: string|null}} transaction
 * @param {import('./types.js').Rule[]} rules
 */
export function collidesWithOtherProperty(transaction, rules) {
  return rules.some(
    (r) => hasText(r) && matchesText(r, transaction.details) && r.propertyId !== transaction.propertyId,
  );
}

/** Human-readable summary of a rule's conditions, e.g. for tooltips. */
export function describeRule(rule, formatAmount = (n) => String(n)) {
  const parts = [];
  if (hasText(rule)) parts.push(`Details ${rule.matchType} "${rule.matchText}"`);
  if (hasType(rule)) parts.push(`Type is "${rule.transactionTypeEquals}"`);
  if (hasAmount(rule)) parts.push(`Amount is ${describeAmount(rule, formatAmount)}`);
  return parts.length > 0 ? parts.join(' and ') : 'No conditions set';
}

/** "-428.06" for an exact pin, "-470.87 to -385.25" for a range. */
export function describeAmount(rule, formatAmount = (n) => String(n)) {
  const range = amountRange(rule);
  if (range === null) return 'any';
  if (isExactAmount(rule)) return formatAmount(range.min);
  if (range.min === -Infinity) return `up to ${formatAmount(range.max)}`;
  if (range.max === Infinity) return `${formatAmount(range.min)} or more`;
  return `${formatAmount(range.min)} to ${formatAmount(range.max)}`;
}
