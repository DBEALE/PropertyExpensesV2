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

/** Amounts are compared to the penny, so float drift can't miss an exact pin. */
function amountMatches(rule, amount) {
  if (rule.amountEquals === undefined) return true;
  return Math.round(rule.amountEquals * 100) === Math.round(amount * 100);
}

/**
 * Finds the rule that categorizes a transaction, or null.
 *
 * Amount-pinned rules are evaluated first so that a rule pinned to an exact
 * amount (e.g. NATWEST BANK + £428.06 -> Property A) wins over a looser
 * text-only rule for the same payee. Within each pass, rules are tried in the
 * order given and the first match wins.
 *
 * @param {{details: string, amount: number}} transaction
 * @param {import('./types.js').Rule[]} rules
 * @returns {import('./types.js').Rule|null}
 */
export function findMatchingRule(transaction, rules) {
  const pinned = rules.filter((r) => r.amountEquals !== undefined);
  const unpinned = rules.filter((r) => r.amountEquals === undefined);

  for (const rule of pinned) {
    if (matchesText(rule, transaction.details) && amountMatches(rule, transaction.amount)) return rule;
  }
  for (const rule of unpinned) {
    if (matchesText(rule, transaction.details)) return rule;
  }
  return null;
}

/**
 * Counts how many of the given transactions each rule would claim.
 * @param {import('./types.js').Rule[]} rules
 * @param {{details: string, amount: number}[]} transactions
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
 * True when the same matchText is already used by a rule pointing at a
 * different property — the signal that this payee is shared and the new rule
 * should be pinned to an amount to disambiguate.
 *
 * @param {string} matchText
 * @param {string} propertyId
 * @param {import('./types.js').Rule[]} rules
 */
export function shouldSuggestAmountPin(matchText, propertyId, rules) {
  const needle = matchText.trim().toLowerCase();
  return rules.some((r) => r.matchText.trim().toLowerCase() === needle && r.propertyId !== propertyId);
}
