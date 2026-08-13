/**
 * The transactions table, used editable on the Transactions screen and
 * read-only on the Properties screen. One implementation so the two always
 * show the same columns, the same split handling and the same badges.
 */
import { hasSplit, isAssigned } from '../allocation.js';
import { el, entityTag, money, sortableTh, swatch, ukDate } from '../dom.js';
import { setFocus } from '../focus.js';
import { isKnownCategory, selectableProperties } from '../categories.js';
import { describeRule, orderRules, rulePositions, ruleLabel as ruleName } from '../rules.js';
import {
  categoryName,
  categoryIcon,
  categorySlot,
  getState,
  propertyName,
  propertyIcon,
  propertySlot,
} from '../store.js';
import { sortRows } from '../sort.js';

/** The word shown in the Status column — also what that column sorts on. */
export function statusLabel(transaction) {
  if (transaction.matchedRuleId) return 'By rule';
  return isAssigned(transaction) ? 'Manual' : 'Needs review';
}

/** Column value accessors, so both screens sort identically. */
export const SORT_ACCESSORS = {
  date: (t) => t.date,
  details: (t) => t.details,
  type: (t) => t.transactionType,
  amount: (t) => t.amount,
  property: (t) => (hasSplit(t) ? 'Split' : propertyName(t.propertyId)),
  category: (t) => (hasSplit(t) ? 'Split' : categoryName(t.category)),
  status: (t) => statusLabel(t),
};

/** The note on a transaction, as text. Absent and blank are the same thing. */
export function noteOf(transaction) {
  return String(transaction.notes ?? '').trim();
}

/**
 * @param {object[]} transactions already filtered
 * @param {object} options
 * @param {import('../sort.js').SortState} options.sort
 * @param {(key: string) => void} options.onSort
 * @param {boolean} [options.readOnly] show values instead of dropdowns
 * @param {(transaction: object, change: object) => void} [options.onAssign]
 * @param {(transaction: object, note: string) => void} [options.onNote]
 * @param {string|null} [options.editingNoteId] the row whose note field is open
 * @param {(transaction: object|null) => void} [options.onEditNote] open or close it
 * @param {(transaction: object) => void} [options.onCreateRule]
 * @param {(transaction: object) => void} [options.onDelete]
 * @param {string} [options.shareOf] property id: show that property's share of a
 *   split transaction as the amount, rather than the whole transaction
 */
export function transactionTable(transactions, options) {
  const { sort, onSort, readOnly = false, shareOf = null, editingNoteId = null } = options;
  const { categories } = getState();
  const properties = selectableProperties(getState().properties);
  // When only one property's share is shown, Amount has to sort on that share
  // — otherwise clicking the column would rank rows by a figure not on screen.
  const accessors = shareOf
    ? { ...SORT_ACCESSORS, amount: (t) => amountShown(t) }
    : SORT_ACCESSORS;
  const rows = sortRows(transactions, sort, accessors);
  // The badge shows the same number the Rules table does.
  const positions = rulePositions(getState().rules);

  const th = (label, key, thOptions) => sortableTh(label, key, sort, onSort, thOptions);

  return el(
    'table',
    { class: `data${readOnly ? ' read-only' : ''}` },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        th('Date', 'date', { class: 'col-date' }),
        th('Details', 'details', { class: 'col-details' }),
        th('Type', 'type', { class: 'col-type' }),
        th('Amount', 'amount', { class: 'num col-amount' }),
        th('Property', 'property', { class: 'col-property' }),
        th('Category', 'category', { class: 'col-category' }),
        th('Status', 'status', { class: 'col-status' }),
        readOnly ? null : el('th', { class: 'col-actions' }, ''),
      ),
    ),
    el('tbody', {}, ...rows.map((t) => (hasSplit(t) ? splitRow(t) : row(t)))),
  );

  function row(transaction) {
    // The swatch and the dropdown sit in a flex wrapper rather than the cell
    // itself: a `display: flex` on a <td> takes it out of the table layout and
    // the columns stop lining up.
    const propertyCell = readOnly
      ? el('td', {}, tagFor(transaction.propertyId, transaction.category, 'property'))
      : el(
          'td',
          {},
          el(
            'div',
            { class: 'swatch-row' },
            swatch(propertySlot(transaction.propertyId), propertyName(transaction.propertyId), propertyIcon(transaction.propertyId)),
            el(
              'select',
              {
                'aria-label': 'Property',
                onchange: (event) =>
                  options.onAssign(transaction, { propertyId: event.target.value || null }),
              },
              el('option', { value: '' }, '— unassigned —'),
              ...properties.map((p) =>
                el('option', { value: p.id, selected: p.id === transaction.propertyId }, p.name),
              ),
            ),
          ),
        );

    const categoryCell = readOnly
      ? el('td', {}, tagFor(transaction.propertyId, transaction.category, 'category'))
      : el(
          'td',
          {},
          el(
            'div',
            { class: 'swatch-row' },
            swatch(categorySlot(transaction.category), categoryName(transaction.category), categoryIcon(transaction.category)),
            el(
              'select',
              {
                'aria-label': 'Category',
                onchange: (event) => {
                  const value = event.target.value;
                  options.onAssign(transaction, {
                    category: isKnownCategory(value, categories) ? value : null,
                  });
                },
              },
              el('option', { value: '' }, '— unassigned —'),
              ...categories.map((c) =>
                el(
                  'option',
                  { value: c.id, selected: c.id === transaction.category, title: c.description },
                  c.name,
                ),
              ),
            ),
          ),
        );

    return el(
      'tr',
      { 'data-transaction': transaction.id },
      el('td', {}, ukDate(transaction.date)),
      detailsCell(transaction),
      el('td', {}, transaction.transactionType),
      el('td', { class: `num ${transaction.amount < 0 ? 'out' : 'in'}` }, money(transaction.amount)),
      propertyCell,
      categoryCell,
      el('td', {}, statusCell(transaction)),
      readOnly ? null : actionsCell(transaction),
    );
  }

  /**
   * The bank's description, with your own note under it.
   *
   * The note lives here rather than in a column of its own because it is a
   * gloss on what the row already says — "which tenant this part-payment was
   * from" belongs next to the payee, not eight columns away.
   *
   * A row with no note takes up no space for one. The field only exists while
   * you are editing, opened from the Add note link in the actions column: an
   * always-present input, even an invisible one, gave every row in a four
   * hundred row statement a second line of height for something most of them
   * will never have.
   */
  function detailsCell(transaction) {
    const note = noteOf(transaction);
    const editing = !readOnly && transaction.id === editingNoteId;

    if (editing) {
      const input = el('input', {
        class: 'note-input',
        type: 'text',
        value: note,
        placeholder: 'Why this cost what it did, who paid it…',
        'aria-label': `Note for ${transaction.details}`,
        // Enter saves, Escape abandons — the two keys anyone will try in a
        // single-line field opened by a link.
        onkeydown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            options.onNote?.(transaction, event.target.value.trim());
          } else if (event.key === 'Escape') {
            event.preventDefault();
            options.onEditNote?.(null);
          }
        },
      });
      // Focus it once it is on the page, so opening the field means typing in it.
      queueMicrotask(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });

      return el(
        'td',
        { class: 'details', title: transaction.sourceFilename },
        transaction.details,
        el(
          'div',
          { class: 'note-edit' },
          input,
          el(
            'button',
            { class: 'link', onclick: () => options.onNote?.(transaction, input.value.trim()) },
            'Save',
          ),
          el('button', { class: 'link', onclick: () => options.onEditNote?.(null) }, 'Cancel'),
        ),
      );
    }

    return el(
      'td',
      { class: 'details', title: transaction.sourceFilename },
      transaction.details,
      note ? el('div', { class: 'note' }, note) : null,
    );
  }

  /**
   * A transaction split across properties.
   *
   * Normally one line per share, showing the whole transaction and how it was
   * divided. But on a property's own page — where `shareOf` names that property
   * — only its own shares are shown, and the Amount column is that property's
   * cost rather than the total. A £900 roof split three ways cost this property
   * £300, and £900 in its column would not add up to anything it recognises.
   */
  function splitRow(transaction) {
    const all = transaction.allocations;
    const shares = sharesShown(transaction);
    const partial = shares.length < all.length;
    const shown = amountShown(transaction);

    const cell = (render) =>
      el('td', {}, ...shares.map((share) => el('div', { class: 'share' }, render(share))));

    return el(
      'tr',
      { class: 'row-split', 'data-transaction': transaction.id },
      el('td', {}, ukDate(transaction.date)),
      detailsCell(transaction),
      el('td', {}, transaction.transactionType),
      el(
        'td',
        { class: `num ${shown < 0 ? 'out' : 'in'}` },
        money(shown),
        // Only worth breaking down when there is more than one line to break
        // into; a single share already has its figure above.
        shares.length > 1
          ? el(
              'div',
              { class: 'share-amounts' },
              ...shares.map((s) => el('div', { class: 'share' }, money(s.amount))),
            )
          : null,
        partial
          ? el('div', { class: 'share' }, `of ${money(transaction.amount)}`)
          : null,
      ),
      cell((share) => entityTag(propertyName(share.propertyId), propertySlot(share.propertyId), undefined, propertyIcon(share.propertyId))),
      cell((share) => entityTag(categoryName(share.category), categorySlot(share.category), undefined, categoryIcon(share.category))),
      el(
        'td',
        {},
        el(
          'span',
          { class: 'badge badge-split', title: describeSplit(transaction) },
          partial ? `${shares.length} of ${all.length}` : `Split ${all.length}`,
        ),
      ),
      readOnly ? null : actionsCell(transaction),
    );
  }

  /** The shares of a split this table is showing — all of them, or one property's. */
  function sharesShown(transaction) {
    const all = transaction.allocations ?? [];
    return shareOf ? all.filter((s) => s.propertyId === shareOf) : all;
  }

  /** The figure in the Amount column: the whole transaction, or one share of it. */
  function amountShown(transaction) {
    if (!shareOf || !hasSplit(transaction)) return transaction.amount;
    return sharesShown(transaction).reduce((sum, s) => sum + s.amount, 0);
  }

  function tagFor(propertyId, category, which) {
    if (which === 'property') {
      if (!propertyId) return el('span', { class: 'unset' }, 'unassigned');
      return entityTag(propertyName(propertyId), propertySlot(propertyId), undefined, propertyIcon(propertyId));
    }
    if (!category) return el('span', { class: 'unset' }, 'none');
    return entityTag(categoryName(category), categorySlot(category), undefined, categoryIcon(category));
  }

  function statusCell(transaction) {
    if (transaction.matchedRuleId) {
      return el(
        'button',
        {
          class: 'badge badge-ok badge-link',
          title: `${ruleLabel(transaction.matchedRuleId)}\n\nClick to open this rule.`,
          onclick: () => {
            setFocus('rules', transaction.matchedRuleId);
            window.location.hash = '#/rules';
          },
        },
        `By rule #${positions.get(transaction.matchedRuleId) ?? '?'}`,
      );
    }
    return isAssigned(transaction)
      ? el('span', { class: 'badge badge-manual' }, 'Manual')
      : el('span', { class: 'badge' }, 'Needs review');
  }

  function actionsCell(transaction) {
    const note = noteOf(transaction);
    return el(
      'td',
      { class: 'actions' },
      // The note is opened from here rather than living permanently in the
      // Details cell, so a row without one costs no height.
      el(
        'button',
        {
          class: 'link',
          title: note ? `Note: ${note}` : 'Add a note to this transaction',
          onclick: () => options.onEditNote?.(transaction),
        },
        note ? 'Edit note' : 'Add note',
      ),
      el(
        'button',
        {
          class: 'link',
          title: 'Create a rule from this transaction',
          onclick: () => options.onCreateRule(transaction),
        },
        'Rule',
      ),
      el(
        'button',
        {
          class: 'link danger',
          onclick: () => options.onDelete(transaction),
        },
        'Delete',
      ),
    );
  }

  function describeSplit(transaction) {
    return transaction.allocations
      .map((s) => `${propertyName(s.propertyId)} · ${categoryName(s.category)} · ${money(s.amount)}`)
      .join('\n');
  }

  function ruleLabel(ruleId) {
    const rule = getState().rules.find((r) => r.id === ruleId);
    return rule ? describeRule(rule, money) : 'Rule no longer exists';
  }
}

/** Property and category dropdowns, shared by both screens' filter rows. */
export function propertyFilter(value, onChange, { includeUnassigned = true } = {}) {
  const properties = selectableProperties(getState().properties);
  return el(
    'select',
    {
      'aria-label': 'Property filter',
      onchange: (event) => onChange(event.target.value),
    },
    el('option', { value: 'all', selected: value === 'all' }, 'All properties'),
    ...properties.map((p) => el('option', { value: p.id, selected: p.id === value }, p.name)),
    includeUnassigned
      ? el('option', { value: '__unassigned__', selected: value === '__unassigned__' }, 'Unassigned')
      : null,
  );
}

/**
 * Rules as a filter, numbered exactly as the Rules table numbers them, so
 * "#3" on a badge and "#3" in this list are the same rule.
 */
export function ruleFilter(value, onChange) {
  const rules = getState().rules;
  const positions = rulePositions(rules);
  return el(
    'select',
    {
      'aria-label': 'Rule filter',
      onchange: (event) => onChange(event.target.value),
    },
    el('option', { value: 'all', selected: value === 'all' }, 'Any rule'),
    el('option', { value: '__unassigned__', selected: value === '__unassigned__' }, 'No rule applied'),
    ...orderRules(rules).map((rule) =>
      el(
        'option',
        { value: rule.id, selected: rule.id === value, title: describeRule(rule, money) },
        ruleName(rule, positions.get(rule.id)),
      ),
    ),
  );
}

export function categoryFilter(value, onChange) {
  const { categories } = getState();
  return el(
    'select',
    {
      'aria-label': 'Category filter',
      onchange: (event) => onChange(event.target.value),
    },
    el('option', { value: 'all', selected: value === 'all' }, 'All categories'),
    ...categories.map((c) =>
      el('option', { value: c.id, selected: c.id === value, title: c.description }, c.name),
    ),
    el('option', { value: '__unassigned__', selected: value === '__unassigned__' }, 'Uncategorised'),
  );
}
