/**
 * Identity icons for properties and categories.
 *
 * A fixed internal bank, drawn here as SVG path data — no network, no image
 * files, nothing to 404 when the app is served from a repo subpath or opened
 * offline. Every icon is a *filled* shape on a 24×24 grid with no strokes, so
 * one CSS rule (`fill: var(--entity)`) tints the whole set from the record's
 * palette slot and a colour change is instantly reflected everywhere.
 *
 * Holes — windows, doors, the eye of a key — are extra subpaths cut with
 * `fill-rule: evenodd` rather than painted in the surface colour, which would
 * break the moment the surface changed (dark mode, a tinted row, a chart).
 *
 * The icon is a *second channel* alongside colour, never a replacement for the
 * name: three of the light-mode palette slots sit below 3:1 against the
 * surface, so the name always travels with the mark.
 */

/**
 * @typedef {object} Icon
 * @property {string} key stored on the record
 * @property {string} label shown in the picker
 * @property {string} d SVG path data on a 0 0 24 24 viewBox
 * @property {'evenodd'|'nonzero'} [rule] evenodd where the shape has holes
 */

/** Four building types, which is what a portfolio is actually made of. */
export const PROPERTY_ICONS = [
  {
    key: 'house',
    label: 'House',
    rule: 'evenodd',
    d:
      'M12 2.5 L22 11 H19.5 V21.5 H4.5 V11 H2 Z' +
      'M10.25 14.5 H13.75 V21.5 H10.25 Z' +
      'M6.5 12.8 H9 V15.3 H6.5 Z' +
      'M15 12.8 H17.5 V15.3 H15 Z',
  },
  {
    key: 'flat',
    label: 'Flat',
    rule: 'evenodd',
    d:
      'M4 1.5 H20 V22 H4 Z' +
      'M6.5 4 H10.5 V7 H6.5 Z M13.5 4 H17.5 V7 H13.5 Z' +
      'M6.5 9.5 H10.5 V12.5 H6.5 Z M13.5 9.5 H17.5 V12.5 H13.5 Z' +
      'M6.5 15 H10.5 V18 H6.5 Z M13.5 15 H17.5 V18 H13.5 Z' +
      'M10 19.5 H14 V22 H10 Z',
  },
  {
    key: 'bungalow',
    label: 'Bungalow',
    rule: 'evenodd',
    d:
      'M12 5.5 L23 12 H20.5 V21.5 H3.5 V12 H1 Z' +
      'M10.25 15 H13.75 V21.5 H10.25 Z' +
      'M5.5 14 H8.5 V17 H5.5 Z' +
      'M15.5 14 H18.5 V17 H15.5 Z',
  },
  {
    key: 'mansion',
    label: 'Mansion',
    rule: 'evenodd',
    d:
      'M12 1.5 L18.5 6 V8.5 H23 V21.5 H1 V8.5 H5.5 V6 Z' +
      'M10.5 15.5 H13.5 V21.5 H10.5 Z' +
      'M10.5 9.5 H13.5 V13 H10.5 Z' +
      'M3 11.5 H6 V14.5 H3 Z' +
      'M18 11.5 H21 V14.5 H18 Z',
  },
];

/**
 * Ten for categories: one apiece for the five seeded defaults, then the five
 * things landlords most often add — utilities, water, grounds, paperwork, and
 * a general-purpose tag for anything else.
 */
export const CATEGORY_ICONS = [
  {
    key: 'key',
    label: 'Key (rent)',
    rule: 'evenodd',
    d:
      'M7 8 A4 4 0 1 0 7 16 A4 4 0 1 0 7 8 Z' +
      'M7 10.6 A1.4 1.4 0 1 1 7 13.4 A1.4 1.4 0 1 1 7 10.6 Z' +
      'M10.6 10.8 H21 V13.2 H19.4 V16.2 H17.4 V13.2 H15.4 V15.6 H13.4 V13.2 H10.6 Z',
  },
  {
    key: 'shield',
    label: 'Shield (insurance)',
    d: 'M12 1.8 L20.5 5 V11.5 C20.5 16.8 17 20.7 12 22.4 C7 20.7 3.5 16.8 3.5 11.5 V5 Z',
  },
  {
    key: 'nut',
    label: 'Nut (repairs)',
    rule: 'evenodd',
    d: 'M12 2 L20.5 7 V17 L12 22 L3.5 17 V7 Z M12 7.6 L15.8 9.8 V14.2 L12 16.4 L8.2 14.2 V9.8 Z',
  },
  {
    key: 'percent',
    label: 'Percent (interest)',
    d:
      'M6.6 4 A2.6 2.6 0 1 0 6.6 9.2 A2.6 2.6 0 1 0 6.6 4 Z' +
      'M17.4 14.8 A2.6 2.6 0 1 0 17.4 20 A2.6 2.6 0 1 0 17.4 14.8 Z' +
      'M19.6 2.9 L21.1 4.4 L4.4 21.1 L2.9 19.6 Z',
  },
  {
    key: 'briefcase',
    label: 'Briefcase (management)',
    rule: 'evenodd',
    d:
      'M9.5 2.5 H14.5 A2 2 0 0 1 16.5 4.5 V6.5 H21 A1.5 1.5 0 0 1 22.5 8 V19.5 ' +
      'A1.5 1.5 0 0 1 21 21 H3 A1.5 1.5 0 0 1 1.5 19.5 V8 A1.5 1.5 0 0 1 3 6.5 H7.5 V4.5 ' +
      'A2 2 0 0 1 9.5 2.5 Z' +
      'M9.5 4.5 V6.5 H14.5 V4.5 Z',
  },
  {
    key: 'bolt',
    label: 'Bolt (utilities)',
    d: 'M13.5 1.5 L5 13.5 H11 L9.5 22.5 L19 10 H12.5 Z',
  },
  {
    key: 'droplet',
    label: 'Droplet (water)',
    d: 'M12 2 C12 2 4.5 10.5 4.5 15 A7.5 7.5 0 0 0 19.5 15 C19.5 10.5 12 2 12 2 Z',
  },
  {
    // Canopy and trunk overlap deliberately: with the default nonzero fill rule
    // they merge into one silhouette. A thinner trunk read as a lollipop.
    key: 'tree',
    label: 'Tree (grounds)',
    d: 'M12 2 A6 6 0 1 0 12 14 A6 6 0 1 0 12 2 Z M10.3 11 H13.7 V22.5 H10.3 Z',
  },
  {
    key: 'document',
    label: 'Document (fees)',
    rule: 'evenodd',
    d:
      'M5 1.5 H14.5 L19.5 6.5 V22.5 H5 Z' +
      'M14.5 1.5 V6.5 H19.5 Z' +
      'M7.5 10.5 H17 V12 H7.5 Z' +
      'M7.5 14 H17 V15.5 H7.5 Z' +
      'M7.5 17.5 H13.5 V19 H7.5 Z',
  },
  {
    key: 'tag',
    label: 'Tag (other)',
    rule: 'evenodd',
    d:
      'M2.6 13.4 L10.6 21.4 A2 2 0 0 0 13.4 21.4 L21.4 13.4 A2 2 0 0 0 22 12 V4 ' +
      'A2 2 0 0 0 20 2 H12 A2 2 0 0 0 10.6 2.6 L2.6 10.6 A2 2 0 0 0 2.6 13.4 Z' +
      'M17.5 5.5 A2 2 0 1 1 17.5 9.5 A2 2 0 1 1 17.5 5.5 Z',
  },
];

/** @param {'property'|'category'} kind */
export function iconsFor(kind) {
  return kind === 'property' ? PROPERTY_ICONS : CATEGORY_ICONS;
}

export function iconByKey(kind, key) {
  return iconsFor(kind).find((i) => i.key === key) ?? null;
}

/**
 * The icon the five seeded categories start with, so the feature is visible
 * before anyone has picked anything. Keyed on the seeded ids, which are the
 * category names — a renamed category keeps its id and therefore its icon.
 */
const SEEDED_CATEGORY_ICONS = {
  Rent: 'key',
  Ins: 'shield',
  Repairs: 'nut',
  Interest: 'percent',
  Management: 'briefcase',
};

/**
 * Which icon a record renders with: its own choice, the sensible default for a
 * seeded record, or the first in the bank.
 *
 * Always returns one. An icon is a second channel beside the colour rather than
 * an optional decoration, and a portfolio where three properties have a mark
 * and two have a plain square reads as a mistake rather than a choice.
 *
 * @param {{id?: string, icon?: string}} record
 * @param {'property'|'category'} kind
 */
export function iconOf(record, kind) {
  const chosen = record?.icon;
  if (chosen && iconByKey(kind, chosen)) return chosen;
  if (kind === 'category') return SEEDED_CATEGORY_ICONS[record?.id] ?? 'tag';
  return 'house';
}

/** The icon definition a record renders with, ready to hand to entityTag. */
export function propertyMark(record) {
  return iconByKey('property', iconOf(record, 'property'));
}

export function categoryMark(record) {
  return iconByKey('category', iconOf(record, 'category'));
}
