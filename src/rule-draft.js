import { normaliseAllocations, validateAllocations } from './allocation.js';
import { collidesWithOtherProperty } from './rules.js';

/**
 * Words that carry no identifying information, so they make poor match text.
 * Bank descriptions are littered with them.
 */
const NOISE = new Set(['bank', 'payment', 'card', 'direct', 'debit', 'credit', 'from', 'ref', 'plc', 'ltd']);

/** Splits a description into candidate keywords, longest first. */
export function candidateWords(details) {
  const words = (details ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => /\p{L}/u.test(w) && w.length >= 4);
  const unique = [...new Set(words)];
  const useful = unique.filter((w) => !NOISE.has(w.toLowerCase()));
  return (useful.length > 0 ? useful : unique).sort((a, b) => b.length - a.length);
}

/**
 * The single most identifying word, which for "S Agyapong 3 PETERBOROUGH GAT"
 * gives "PETERBOROUGH". Offered as a one-click narrowing in the editor, not as
 * the default — the default is the full description.
 *
 * @param {string} details
 */
export function suggestMatchText(details) {
  return candidateWords(details)[0] ?? (details ?? '').trim();
}

/**
 * Builds the pre-filled state for the "create rule from transaction" form.
 *
 * Match text starts as the *full* description, so nothing from the row is lost
 * and narrowing is a deliberate edit. Type and Amount are pre-filled but off.
 * Amount defaults on when an existing rule for a different property already
 * claims this description — that collision is the signal the payee is shared
 * and the new rule needs pinning to stay distinct.
 *
 * @param {import('./types.js').Transaction} transaction
 * @param {import('./types.js').Rule[]} rules existing rules
 */
export function draftRuleFromTransaction(transaction, rules = []) {
  const details = (transaction.details ?? '').trim();
  const collides = collidesWithOtherProperty(transaction, rules);
  return {
    useText: true,
    matchText: details,
    matchType: 'contains',
    /** One-click narrowings offered under the text box. */
    suggestions: candidateWords(details),
    useType: false,
    transactionTypeEquals: transaction.transactionType ?? '',
    useAmount: collides,
    amountEquals: transaction.amount,
    propertyId: transaction.propertyId,
    category: transaction.category,
    /** Why the amount box starts ticked, shown as a hint in the form. */
    collides,
    split: false,
    allocations: [],
  };
}

/**
 * Turns form state into a Rule, dropping unticked conditions.
 * @returns {import('./types.js').Rule}
 */
export function draftToRule(draft, id) {
  const split = draft.split === true;
  const allocations = split ? normaliseAllocations(draft.allocations) : [];
  return {
    id,
    matchText: draft.useText ? draft.matchText.trim() : '',
    matchType: draft.matchType,
    // A split rule keeps its first allocation in the flat fields so anything
    // reading only propertyId/category still sees a sensible primary.
    propertyId: split ? allocations[0].propertyId : draft.propertyId,
    category: split ? allocations[0].category : draft.category,
    ...(draft.useType ? { transactionTypeEquals: draft.transactionTypeEquals.trim() } : {}),
    ...(draft.useAmount ? { amountEquals: Math.round(Number(draft.amountEquals) * 100) / 100 } : {}),
    ...(split ? { allocations } : {}),
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

  if (draft.split === true) {
    // Fixed allocations can only reconcile against a known total, so a split
    // rule has to be pinned to the amount it splits.
    if (!draft.useAmount) {
      return 'A split rule must be pinned to an exact amount, so the shares always add up.';
    }
    return validateAllocations(draft.allocations, Number(draft.amountEquals));
  }

  if (!draft.propertyId) return 'Choose a property.';
  if (!draft.category) return 'Choose a category.';
  return null;
}
