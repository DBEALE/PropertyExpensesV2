/**
 * Identity colours for properties and categories.
 *
 * Eight fixed slots, assigned in order and never cycled or generated. Each
 * slot carries a light and a dark step — the dark column is the same hue
 * re-stepped for a dark surface, not an automatic inversion. Records store the
 * slot *key*, so the right step is chosen per theme at render time.
 *
 * The order is the colourblind-safety mechanism, not decoration: this sequence
 * clears the adjacent-pair CVD and normal-vision floors in both modes against
 * this app's own surfaces (#ffffff light, #1c2026 dark). Do not reorder or
 * substitute hexes without re-running the palette validator.
 *
 * In light mode aqua, yellow and magenta sit below 3:1 against the surface, so
 * every use pairs the colour with its name — a swatch never carries meaning on
 * its own — and every chart ships a table view.
 */

export const SLOTS = [
  { key: 'blue', label: 'Blue' },
  { key: 'orange', label: 'Orange' },
  { key: 'aqua', label: 'Aqua' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'magenta', label: 'Magenta' },
  { key: 'green', label: 'Green' },
  { key: 'violet', label: 'Violet' },
  { key: 'red', label: 'Red' },
];

export const SLOT_KEYS = SLOTS.map((s) => s.key);

/** Colour used for anything with no slot of its own, e.g. "Not a property". */
export const NEUTRAL_SLOT = 'neutral';

/** Stable fallback for records saved before colours existed. */
export function slotFromId(id) {
  const text = String(id ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return SLOT_KEYS[hash % SLOT_KEYS.length];
}

/** The slot a record renders with: its own, or a stable one derived from its id. */
export function slotOf(record) {
  if (record && typeof record.colour === 'string' && SLOT_KEYS.includes(record.colour)) {
    return record.colour;
  }
  return slotFromId(record?.id);
}

/**
 * Picks the next slot for a new record: the first unused one, so a small set of
 * properties gets the leading, best-separated colours. Once all eight are in
 * use it continues in order, which is when names and the table view carry the
 * distinction rather than hue.
 */
export function nextSlot(existing) {
  const used = new Set(existing.map((r) => r.colour).filter(Boolean));
  const free = SLOT_KEYS.find((key) => !used.has(key));
  return free ?? SLOT_KEYS[existing.length % SLOT_KEYS.length];
}

/** CSS class carrying the slot's custom property. */
export function slotClass(record) {
  return `slot-${slotOf(record)}`;
}
