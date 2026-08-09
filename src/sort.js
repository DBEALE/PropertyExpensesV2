/**
 * Click-to-sort table columns.
 *
 * One comparator for every table, so a date column sorts chronologically, an
 * amount column numerically, and a text column alphabetically without each
 * view re-inventing it. Blank values always sink to the bottom whichever way
 * the column is pointing — an empty cell is not "smallest", it is missing.
 */

/** @typedef {{key: string|null, dir: 'asc'|'desc'}} SortState */

/**
 * Applies a click on a column heading.
 *
 * First click on a column sorts by it; clicking the same column again reverses
 * the order.
 *
 * @param {SortState} state mutated in place, so it survives a re-render
 * @param {string} key
 * @param {'asc'|'desc'} [initial] direction the first click gives
 */
export function toggleSort(state, key, initial = 'asc') {
  if (state.key === key) {
    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.key = key;
    state.dir = initial;
  }
  return state;
}

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

/** Compares two cell values, coping with numbers, dates, and text. */
export function compareValues(a, b) {
  if (isBlank(a) && isBlank(b)) return 0;
  // Blanks sort last in both directions, so the caller must not flip them.
  if (isBlank(a)) return 1;
  if (isBlank(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'en-GB', { numeric: true, sensitivity: 'base' });
}

/**
 * Returns a sorted copy. The original order is preserved for equal rows and
 * used untouched when no column is selected.
 *
 * @param {T[]} rows
 * @param {SortState} state
 * @param {Record<string, (row: T) => unknown>} accessors value per column key
 * @template T
 */
export function sortRows(rows, state, accessors) {
  if (!state.key || !accessors[state.key]) return rows;
  const accessor = accessors[state.key];
  const direction = state.dir === 'desc' ? -1 : 1;
  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = accessor(a.row);
      const right = accessor(b.row);
      // Blanks stay at the bottom regardless of direction, so flip only when
      // both sides have a value.
      if (isBlank(left) || isBlank(right)) return compareValues(left, right) || a.index - b.index;
      return compareValues(left, right) * direction || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** The arrow shown on the active column. */
export function sortIndicator(state, key) {
  if (state.key !== key) return '';
  return state.dir === 'asc' ? ' ▲' : ' ▼';
}

/** Value for the th's aria-sort attribute. */
export function ariaSort(state, key) {
  if (state.key !== key) return 'none';
  return state.dir === 'asc' ? 'ascending' : 'descending';
}
