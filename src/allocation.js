/**
 * Splitting a transaction across properties.
 *
 * A transaction is assigned in one of two ways:
 *   - simple: `propertyId` + `category`, the whole amount to one property;
 *   - split:  `allocations` — a list of { propertyId, category, amount } whose
 *     amounts sum to exactly the transaction amount.
 *
 * The invariant that matters everywhere downstream is that the allocation
 * total equals the transaction total, so no money is invented or lost in the
 * summary. `allocationsOf` gives both shapes a single representation, so
 * reporting code never has to branch.
 */

/** Money is compared and summed in whole pence to keep float drift out. */
export function toPence(amount) {
  return Math.round(Number(amount) * 100);
}

export function fromPence(pence) {
  return pence / 100;
}

export function hasSplit(record) {
  return Array.isArray(record?.allocations) && record.allocations.length > 0;
}

/** Sum of an allocation list, in pounds, rounded to the penny. */
export function sumAllocations(allocations) {
  return fromPence((allocations ?? []).reduce((total, a) => total + toPence(a.amount), 0));
}

/**
 * Every (property, category, amount) an assignment contributes, whether it is
 * simple or split. An unassigned transaction contributes nothing.
 *
 * @param {import('./types.js').Transaction} transaction
 * @returns {{propertyId: string, category: import('./types.js').Category, amount: number}[]}
 */
export function allocationsOf(transaction) {
  if (hasSplit(transaction)) return transaction.allocations;
  if (transaction.propertyId && transaction.category) {
    return [
      { propertyId: transaction.propertyId, category: transaction.category, amount: transaction.amount },
    ];
  }
  return [];
}

/** True when a transaction is fully categorised, either way. */
export function isAssigned(transaction) {
  return allocationsOf(transaction).length > 0;
}

/** True when a transaction is split across more than one property. */
export function isSplit(transaction) {
  return hasSplit(transaction) && new Set(transaction.allocations.map((a) => a.propertyId)).size > 1;
}

/**
 * Checks an allocation list against the amount it must reconcile to.
 *
 * @param {{propertyId: string, category: string, amount: number|string}[]} allocations
 * @param {number} total the transaction amount the split must sum to
 * @returns {string|null} an error message, or null when valid
 */
export function validateAllocations(allocations, total) {
  const list = allocations ?? [];
  if (list.length < 2) return 'A split needs at least two rows.';

  for (const [i, allocation] of list.entries()) {
    const row = `Row ${i + 1}`;
    if (!allocation.propertyId) return `${row}: choose a property.`;
    if (!allocation.category) return `${row}: choose a category.`;
    if (String(allocation.amount).trim() === '' || !Number.isFinite(Number(allocation.amount))) {
      return `${row}: enter an amount.`;
    }
    if (toPence(allocation.amount) === 0) return `${row}: the amount cannot be zero.`;
    // A split of an expense into an income line (or vice versa) is almost
    // always a typo — a stray minus sign — and would silently skew the totals.
    if (Math.sign(toPence(allocation.amount)) !== Math.sign(toPence(total))) {
      return `${row}: the amount must have the same sign as the transaction.`;
    }
  }

  if (toPence(sumAllocations(list)) !== toPence(total)) return differenceMessage(list, total);
  return null;
}

/**
 * Wording for an unreconciled split, phrased as what the user must do.
 * Compared by magnitude: for an expense every figure is negative, so a larger
 * signed difference means less allocated, not more.
 */
function differenceMessage(allocations, total) {
  const shortfall = Math.abs(toPence(total)) - Math.abs(toPence(sumAllocations(allocations)));
  const amount = Math.abs(fromPence(shortfall)).toFixed(2);
  const totalText = Math.abs(total).toFixed(2);
  return shortfall > 0
    ? `£${amount} still to allocate — the rows must total £${totalText}.`
    : `£${amount} over-allocated — the rows must total £${totalText}.`;
}

/** Normalises user-entered rows into stored allocations. */
export function normaliseAllocations(allocations) {
  return (allocations ?? []).map((a) => ({
    propertyId: a.propertyId,
    category: a.category,
    amount: fromPence(toPence(a.amount)),
  }));
}

/**
 * Splits a total as evenly as possible, giving any odd penny to the earliest
 * rows so the parts always sum back to the total. Used to seed a new split.
 */
export function splitEvenly(total, parts) {
  const totalPence = toPence(total);
  const base = Math.trunc(totalPence / parts);
  const remainder = Math.abs(totalPence - base * parts);
  const step = Math.sign(totalPence);
  return Array.from({ length: parts }, (_, i) => fromPence(base + (i < remainder ? step : 0)));
}
