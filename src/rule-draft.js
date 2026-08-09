import { shouldSuggestAmountPin } from './rules.js';

/**
 * Words that carry no identifying information, so they make poor match text.
 * Bank descriptions are littered with them.
 */
const NOISE = new Set(['bank', 'payment', 'card', 'direct', 'debit', 'credit', 'from', 'ref', 'plc', 'ltd']);

/**
 * Picks a sensible default match text: the longest informative word, which for
 * "S Agyapong 3 PETERBOROUGH GAT" gives "PETERBOROUGH". Falls back to the
 * whole description when nothing stands out.
 *
 * @param {string} details
 */
export function suggestMatchText(details) {
  const words = (details ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => /\p{L}/u.test(w) && w.length >= 4);
  const useful = words.filter((w) => !NOISE.has(w.toLowerCase()));
  const pool = useful.length > 0 ? useful : words;
  if (pool.length === 0) return (details ?? '').trim();
  return pool.reduce((best, w) => (w.length > best.length ? w : best));
}

/**
 * Builds the pre-filled state for the "create rule from transaction" form.
 *
 * Text is on by default because it generalises; Type and Amount are off unless
 * there's a reason. Amount defaults on when the suggested text is already used
 * by a different property — that collision is the signal the payee is shared
 * and the new rule needs pinning to stay distinct.
 *
 * @param {import('./types.js').Transaction} transaction
 * @param {import('./types.js').Rule[]} rules existing rules
 */
export function draftRuleFromTransaction(transaction, rules = []) {
  const matchText = suggestMatchText(transaction.details);
  const collides = shouldSuggestAmountPin(matchText, transaction.propertyId, rules);
  return {
    useText: true,
    matchText,
    matchType: 'contains',
    useType: false,
    transactionTypeEquals: transaction.transactionType ?? '',
    useAmount: collides,
    amountEquals: transaction.amount,
    propertyId: transaction.propertyId,
    category: transaction.category,
    /** Why the amount box starts ticked, shown as a hint in the form. */
    collides,
  };
}

/**
 * Turns form state into a Rule, dropping unticked conditions.
 * @returns {import('./types.js').Rule}
 */
export function draftToRule(draft, id) {
  return {
    id,
    matchText: draft.useText ? draft.matchText.trim() : '',
    matchType: draft.matchType,
    propertyId: draft.propertyId,
    category: draft.category,
    ...(draft.useType ? { transactionTypeEquals: draft.transactionTypeEquals.trim() } : {}),
    ...(draft.useAmount ? { amountEquals: Math.round(Number(draft.amountEquals) * 100) / 100 } : {}),
  };
}

/**
 * Validates form state, returning an error message or null.
 * @returns {string|null}
 */
export function validateDraft(draft) {
  if (!draft.useText && !draft.useType && !draft.useAmount) {
    return 'Tick at least one condition — a rule with none would match every transaction.';
  }
  if (draft.useText && draft.matchText.trim() === '') return 'Enter the text to match, or untick Details.';
  if (draft.useText && draft.matchType === 'regex') {
    try {
      new RegExp(draft.matchText);
    } catch {
      return 'That is not a valid regular expression.';
    }
  }
  if (draft.useType && draft.transactionTypeEquals.trim() === '') {
    return 'Enter the transaction type to match, or untick Type.';
  }
  // Number('') is 0, so a blank box would otherwise pin the rule to £0.00.
  if (draft.useAmount && (String(draft.amountEquals).trim() === '' || !Number.isFinite(Number(draft.amountEquals)))) {
    return 'Enter the amount to match, or untick Amount.';
  }
  if (!draft.propertyId) return 'Choose a property.';
  if (!draft.category) return 'Choose a category.';
  return null;
}
