/**
 * Making the data tables usable on a phone.
 *
 * Narrow screens are detected by *viewport and pointer*, never by sniffing the
 * user-agent string: the UA tells you which browser is running, not how much
 * room it has, and it gets tablets, split-screen windows and desktop-mode
 * phones wrong. A media query is always right by construction.
 *
 * Below the breakpoint each table row becomes a card. Two things have to
 * happen in JavaScript rather than CSS for that to work:
 *
 *   1. Each cell needs its column name beside it, since the header row is no
 *      longer above it. The name is copied from the table's own `<thead>`, so
 *      it can never disagree with the column it labels.
 *   2. Sorting has to stay reachable. The header buttons are hidden in card
 *      mode, so a "Sort by" control is generated from them and clicks the very
 *      same buttons — no duplicated sort logic.
 *
 * Both are applied generically to every `table.data`, so a new table gets the
 * behaviour without anything being wired up for it.
 */

const NARROW = '(max-width: 720px)';

export function isNarrow() {
  return typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;
}

/** Strips the sort arrow so a heading reads as a plain column name. */
export function headingText(text) {
  return String(text ?? '')
    .replace(/[▲▼]/g, '')
    .trim();
}

/**
 * Works out the label for each cell in a row, given the column headings and
 * how many columns each cell spans.
 *
 * A cell spanning more than one column gets no label — on a split row that
 * cell already names both the property and the category it holds, and
 * "Property / Category" above it would be noise. Cells past the last heading
 * (the unlabelled actions column) get none either.
 *
 * @param {string[]} headings
 * @param {number[]} colspans one per cell, in order
 * @returns {string[]} label per cell, '' where there is none
 */
export function labelsForRow(headings, colspans) {
  const labels = [];
  let column = 0;
  for (const span of colspans) {
    labels.push(span === 1 ? headings[column] ?? '' : '');
    column += span;
  }
  return labels;
}

/**
 * Copies each column's name onto the cells beneath it, for the card layout to
 * show via CSS.
 */
function labelCells(table) {
  const headings = [...table.querySelectorAll('thead th')].map((th) => headingText(th.textContent));
  if (headings.length === 0) return;

  for (const row of table.querySelectorAll('tbody tr, tfoot tr')) {
    const cells = [...row.children];
    const labels = labelsForRow(
      headings,
      cells.map((cell) => Number(cell.getAttribute('colspan') ?? 1)),
    );
    cells.forEach((cell, i) => {
      if (labels[i]) cell.setAttribute('data-label', labels[i]);
      else cell.removeAttribute('data-label');
    });
  }
}

/**
 * Builds a "Sort by" select from the table's own sortable headings. Choosing
 * the column already selected reverses it, exactly as clicking the heading
 * twice does, because it is the same button being clicked.
 */
function addSortControl(table) {
  const buttons = [...table.querySelectorAll('thead th.sortable .sort-button')];
  if (buttons.length === 0) return;

  const current = table.querySelector('thead th.sorted');
  const currentLabel = current ? headingText(current.textContent) : '';
  const descending = currentLabel !== '' && current.getAttribute('aria-sort') === 'descending';

  const select = document.createElement('select');
  select.className = 'mobile-sort-select';
  select.setAttribute('aria-label', 'Sort by');
  for (const button of buttons) {
    const label = headingText(button.textContent);
    const option = document.createElement('option');
    option.value = label;
    option.textContent = label;
    option.selected = label === currentLabel;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const match = buttons.find((b) => headingText(b.textContent) === select.value);
    if (match) match.click();
  });

  const reverse = document.createElement('button');
  reverse.type = 'button';
  reverse.className = 'mobile-sort-reverse';
  reverse.textContent = descending ? '▼ Descending' : '▲ Ascending';
  reverse.title = 'Reverse the order';
  reverse.addEventListener('click', () => {
    const match = buttons.find((b) => headingText(b.textContent) === select.value);
    if (match) match.click();
  });

  const bar = document.createElement('div');
  bar.className = 'mobile-sort';
  const caption = document.createElement('span');
  caption.className = 'hint';
  caption.textContent = 'Sort by';
  bar.append(caption, select, reverse);
  table.parentNode.insertBefore(bar, table);
}

/**
 * Applies the card-mode adjustments to everything currently on screen. Safe to
 * call after every render; it clears what it added last time first.
 */
export function applyResponsive(root = document) {
  for (const stale of root.querySelectorAll('.mobile-sort')) stale.remove();
  const tables = root.querySelectorAll('table.data');
  for (const table of tables) {
    labelCells(table);
    if (isNarrow()) addSortControl(table);
  }
}

/** Re-runs when the viewport crosses the breakpoint, e.g. on rotation. */
export function watchBreakpoint(onChange) {
  if (typeof window.matchMedia !== 'function') return;
  const query = window.matchMedia(NARROW);
  const handler = () => onChange();
  if (typeof query.addEventListener === 'function') query.addEventListener('change', handler);
  else if (typeof query.addListener === 'function') query.addListener(handler);
}
