/**
 * Shared shapes, documented as JSDoc typedefs so editors still give
 * completion and type checking without a build step.
 *
 * @typedef {'Rent'|'Ins'|'Repairs'|'Interest'|'Management'} Category
 * @typedef {'contains'|'exact'|'regex'} MatchType
 *
 * @typedef {{ id: string, name: string }} Property
 *
 * @typedef {object} Allocation A share of one transaction.
 * @property {string} propertyId
 * @property {Category} category
 * @property {number} amount Signed, same sign as the transaction it splits.
 *
 * @typedef {object} Rule
 * @property {string} id
 * @property {string} matchText
 * @property {MatchType} matchType
 * @property {number} [amountMin] Lower bound of the amount condition, signed
 *   and inclusive. Equal to amountMax for an exact pin.
 * @property {number} [amountMax] Upper bound, signed and inclusive.
 * @property {number} [amountEquals] Legacy exact pin, still read from older
 *   rules and backups. Treated as amountMin === amountMax === this value.
 * @property {string} [transactionTypeEquals] Only matches transactions with
 *   this Transaction Type (case-insensitive). Narrows a payee that appears as
 *   both, say, a Direct Debit and a Card Payment.
 * @property {string} propertyId Ignored when `allocations` is set.
 * @property {Category} category Ignored when `allocations` is set.
 * @property {Allocation[]} [allocations] Splits the transaction across
 *   properties. Requires an exact amount (amountMin === amountMax), and must
 *   sum to it exactly.
 *
 * @typedef {object} Transaction
 * @property {string} id
 * @property {string} date ISO YYYY-MM-DD, parsed from the DD/MM/YYYY column.
 * @property {string} details
 * @property {string} transactionType
 * @property {number} amount Signed: positive for In, negative for Out.
 * @property {number|null} balance
 * @property {string|null} propertyId Null when split or unassigned.
 * @property {Category|null} category Null when split or unassigned.
 * @property {Allocation[]} [allocations] Set when split across properties;
 *   sums to `amount` exactly. Mutually exclusive with propertyId/category.
 * @property {string|null} matchedRuleId Rule that auto-assigned this, if any.
 * @property {string} sourceFilename
 * @property {string} importedAt
 */

/** The five fixed categories. Not user-editable. */
export const CATEGORIES = /** @type {const} */ (['Rent', 'Ins', 'Repairs', 'Interest', 'Management']);

/** @returns {value is Category} */
export function isCategory(value) {
  return typeof value === 'string' && CATEGORIES.includes(value);
}
