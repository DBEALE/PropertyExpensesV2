/**
 * Categories are stored records, not a fixed enum: they can be renamed, given
 * a description, added to and deleted.
 *
 * The five defaults are seeded with `id === name` ("Rent", "Ins", …) so that
 * transactions and rules written before categories became editable — which
 * stored the plain name — still resolve without a migration step. Renaming a
 * category changes its `name` and never its `id`, so references survive.
 */

export const DEFAULT_CATEGORIES = [
  { id: 'Rent', name: 'Rent', description: 'Rent received from tenants.' },
  { id: 'Ins', name: 'Ins', description: 'Buildings, contents and landlord insurance.' },
  { id: 'Repairs', name: 'Repairs', description: 'Repairs and maintenance.' },
  { id: 'Interest', name: 'Interest', description: 'Mortgage interest.' },
  { id: 'Management', name: 'Management', description: 'Letting agent and management fees.' },
];

/**
 * Stand-in property id for money that belongs to no property at all — personal
 * spending, transfers between your own accounts, anything that should stay out
 * of the property figures.
 *
 * It is a sentinel rather than `null` so that a non-property transaction is
 * still *classified*: everything keyed by property id keeps working, and the
 * summary can show it on its own line instead of it hiding among the
 * uncategorised.
 */
export const NON_PROPERTY_ID = '__non_property__';

export const NON_PROPERTY_NAME = 'Not a property';

export function isNonProperty(propertyId) {
  return propertyId === NON_PROPERTY_ID;
}

/** Properties as offered in a dropdown: the real ones, then the sentinel. */
export function selectableProperties(properties) {
  return [...properties, { id: NON_PROPERTY_ID, name: NON_PROPERTY_NAME }];
}

/** @returns {boolean} whether `id` names one of the given categories. */
export function isKnownCategory(id, categories) {
  return categories.some((c) => c.id === id);
}

/**
 * Suggests an id for a new category: the name, cleaned up, kept unique. Using
 * the name keeps exported backups readable rather than full of opaque ids.
 */
export function categoryIdFor(name, existing) {
  const base = name.trim().replace(/\s+/g, '-') || 'category';
  if (!existing.some((c) => c.id === base)) return base;
  let n = 2;
  while (existing.some((c) => c.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}
