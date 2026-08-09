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
  categorySlot,
  getState,
  propertyName,
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

/**
 * @param {object[]} transactions already filtered
 * @param {object} options
 * @param {import('../sort.js').SortState} options.sort
 * @param {(key: string) => void} options.onSort
 * @param {boolean} [options.readOnly] show values instead of dropdowns
 * @param {(transaction: object, change: object) => void} [options.onAssign]
 * @param {(transaction: object) => void} [options.onCreateRule]
 * @param {(transaction: object) => void} [options.onDelete]
 */
export function transactionTable(transactions, options) {
  const { sort, onSort, readOnly = false } = options;
  const { categories } = getState();
  const properties = selectableProperties(getState().properties);
  const rows = sortRows(transactions, sort, SORT_ACCESSORS);
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
            swatch(propertySlot(transaction.propertyId), propertyName(transaction.propertyId)),
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
            swatch(categorySlot(transaction.category), categoryName(transaction.category)),
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
      el('td', { class: 'details', title: transaction.sourceFilename }, transaction.details),
      el('td', {}, transaction.transactionType),
      el('td', { class: `num ${transaction.amount < 0 ? 'out' : 'in'}` }, money(transaction.amount)),
      propertyCell,
      categoryCell,
      el('td', {}, statusCell(transaction)),
      readOnly ? null : actionsCell(transaction),
    );
  }

  /** A transaction split across properties: one line per share. */
  function splitRow(transaction) {
    const shares = transaction.allocations;
    const cell = (render) =>
      el('td', {}, ...shares.map((share) => el('div', { class: 'share' }, render(share))));

    return el(
      'tr',
      { class: 'row-split', 'data-transaction': transaction.id },
      el('td', {}, ukDate(transaction.date)),
      el('td', { class: 'details', title: transaction.sourceFilename }, transaction.details),
      el('td', {}, transaction.transactionType),
      el(
        'td',
        { class: `num ${transaction.amount < 0 ? 'out' : 'in'}` },
        money(transaction.amount),
        el(
          'div',
          { class: 'share-amounts' },
          ...shares.map((s) => el('div', { class: 'share' }, money(s.amount))),
        ),
      ),
      cell((share) => entityTag(propertyName(share.propertyId), propertySlot(share.propertyId))),
      cell((share) => entityTag(categoryName(share.category), categorySlot(share.category))),
      el(
        'td',
        {},
        el(
          'span',
          { class: 'badge badge-split', title: describeSplit(transaction) },
          `Split ${shares.length}`,
        ),
      ),
      readOnly ? null : actionsCell(transaction),
    );
  }

  function tagFor(propertyId, category, which) {
    if (which === 'property') {
      if (!propertyId) return el('span', { class: 'unset' }, 'unassigned');
      return entityTag(propertyName(propertyId), propertySlot(propertyId));
    }
    if (!category) return el('span', { class: 'unset' }, 'none');
    return entityTag(categoryName(category), categorySlot(category));
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
    return el(
      'td',
      { class: 'actions' },
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
