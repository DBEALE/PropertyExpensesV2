/**
 * Shared shapes, documented as JSDoc typedefs so editors still give
 * completion and type checking without a build step.
 *
 * @typedef {'Rent'|'Ins'|'Repairs'|'Interest'|'Management'} Category
 * @typedef {'contains'|'exact'|'regex'} MatchType
 *
 * @typedef {{ id: string, name: string }} Property
 *
 * @typedef {object} Rule
 * @property {string} id
 * @property {string} matchText
 * @property {MatchType} matchType
 * @property {number} [amountEquals] Only matches transactions with this exact
 *   signed amount. Used to disambiguate a payee shared across properties.
 * @property {string} propertyId
 * @property {Category} category
 *
 * @typedef {object} Transaction
 * @property {string} id
 * @property {string} date ISO YYYY-MM-DD, parsed from the DD/MM/YYYY column.
 * @property {string} details
 * @property {string} transactionType
 * @property {number} amount Signed: positive for In, negative for Out.
 * @property {number|null} balance
 * @property {string|null} propertyId
 * @property {Category|null} category
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
