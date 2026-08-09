import { hasSplit, isAssigned } from '../allocation.js';
import { toCsv } from '../csv.js';
import { download, el, entityTag, money, swatch, toast, ukDate } from '../dom.js';
import { filterByDate } from '../dates.js';
import { describeRule } from '../rules.js';
import {
  categoryName,
  categorySlot,
  deleteTransaction,
  getState,
  propertyName,
  propertySlot,
  reapplyRules,
  updateTransaction,
} from '../store.js';
import { isKnownCategory, selectableProperties } from '../categories.js';
import { openRuleEditor } from './rule-editor.js';

/** Filter state lives outside render so it survives re-renders. */
const filters = { text: '', status: 'all', from: '', to: '' };

export function renderTransactions(root, rerender) {
  const { transactions, categories, rules } = getState();
  // "Not a property" sits alongside the real ones, so personal spending can be
  // classified rather than left looking uncategorised.
  const properties = selectableProperties(getState().properties);

  if (getState().properties.length === 0) {
    root.append(
      el(
        'div',
        { class: 'notice' },
        'No properties yet — you can still classify rows as “Not a property”, but everything else ' +
          'needs one. ',
        el('a', { href: '#/properties' }, 'Add a property'),
      ),
    );
  }

  let visible = filterByDate(transactions, filters.from, filters.to);
  if (filters.text) {
    const needle = filters.text.toLowerCase();
    visible = visible.filter((t) => t.details.toLowerCase().includes(needle));
  }
  if (filters.status === 'review') visible = visible.filter((t) => !isAssigned(t));
  if (filters.status === 'auto') visible = visible.filter((t) => t.matchedRuleId !== null);
  if (filters.status === 'split') visible = visible.filter((t) => hasSplit(t));

  const needsReview = transactions.filter((t) => !isAssigned(t)).length;

  const search = el('input', {
    type: 'search',
    placeholder: 'Search details…',
    value: filters.text,
    oninput: (event) => {
      filters.text = event.target.value;
      rerender();
      // Re-focus the freshly rendered search box so typing isn't interrupted.
      const next = document.querySelector('input[type="search"]');
      if (next) {
        next.focus();
        next.setSelectionRange(next.value.length, next.value.length);
      }
    },
  });

  const statusSelect = el(
    'select',
    {
      'aria-label': 'Status filter',
      onchange: (event) => {
        filters.status = event.target.value;
        rerender();
      },
    },
    ...[
      ['all', 'All transactions'],
      ['review', 'Needs review'],
      ['auto', 'Auto-categorised'],
      ['split', 'Split'],
    ].map(([value, label]) => el('option', { value, selected: filters.status === value }, label)),
  );

  const dateInput = (which) =>
    el('input', {
      type: 'date',
      value: filters[which],
      onchange: (event) => {
        filters[which] = event.target.value;
        rerender();
      },
    });

  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h2', {}, 'Transactions'),
      el('span', { class: 'count' }, `${visible.length} shown · ${needsReview} need review`),
      search,
      statusSelect,
      el('label', { class: 'inline' }, 'From ', dateInput('from')),
      el('label', { class: 'inline' }, 'To ', dateInput('to')),
      el(
        'button',
        {
          onclick: () => {
            if (visible.length === 0) {
              toast('Nothing to export.', 'error');
              return;
            }
            download('transactions.csv', toCsv(visible, propertyName), 'text/csv;charset=utf-8');
          },
        },
        'Export CSV',
      ),
    ),
  );

  if (transactions.length === 0) {
    root.append(
      el('div', { class: 'empty' }, 'No transactions yet. ', el('a', { href: '#/import' }, 'Import a statement')),
    );
    return;
  }

  root.append(
    el(
      'table',
      { class: 'data' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Date'),
          el('th', {}, 'Details'),
          el('th', {}, 'Type'),
          el('th', { class: 'num' }, 'Amount'),
          el('th', {}, 'Property'),
          el('th', {}, 'Category'),
          el('th', {}, 'Status'),
          el('th', {}, ''),
        ),
      ),
      el('tbody', {}, ...visible.map((t) => row(t))),
    ),
  );

  function row(transaction) {
    const assigned = isAssigned(transaction);

    // A split transaction shows its shares instead of the two dropdowns —
    // editing it means editing the rule that split it.
    if (hasSplit(transaction)) return splitRow(transaction);

    const propertySelect = el(
      'select',
      {
        'aria-label': 'Property',
        onchange: (event) => void assign(transaction, { propertyId: event.target.value || null }),
      },
      el('option', { value: '' }, '— unassigned —'),
      ...properties.map((p) => el('option', { value: p.id, selected: p.id === transaction.propertyId }, p.name)),
    );

    const categorySelect = el(
      'select',
      {
        'aria-label': 'Category',
        onchange: (event) => {
          const value = event.target.value;
          void assign(transaction, { category: isKnownCategory(value, categories) ? value : null });
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
    );

    return el(
      'tr',
      {},
      el('td', {}, ukDate(transaction.date)),
      el('td', { class: 'details', title: transaction.sourceFilename }, transaction.details),
      el('td', {}, transaction.transactionType),
      el('td', { class: `num ${transaction.amount < 0 ? 'out' : 'in'}` }, money(transaction.amount)),
      el('td', { class: 'with-swatch' }, swatch(propertySlot(transaction.propertyId), propertyName(transaction.propertyId)), propertySelect),
      el('td', { class: 'with-swatch' }, swatch(categorySlot(transaction.category), categoryName(transaction.category)), categorySelect),
      el(
        'td',
        {},
        transaction.matchedRuleId
          ? el('span', { class: 'badge badge-ok', title: ruleLabel(transaction.matchedRuleId) }, 'By rule')
          : assigned
            ? el('span', { class: 'badge badge-manual' }, 'Manual')
            : el('span', { class: 'badge' }, 'Needs review'),
      ),
      el(
        'td',
        { class: 'actions' },
        el(
          'button',
          {
            class: 'link',
            title: 'Create a rule from this transaction',
            onclick: () => createRuleFrom(transaction),
          },
          'Rule',
        ),
        el(
          'button',
          {
            class: 'link danger',
            onclick: () => {
              if (!confirm('Delete this transaction?')) return;
              void deleteTransaction(transaction.id).then(rerender);
            },
          },
          'Delete',
        ),
      ),
    );
  }

  /** A transaction split across properties: one line per share. */
  function splitRow(transaction) {
    const shares = transaction.allocations;
    const cell = (render) =>
      el('td', {}, ...shares.map((share) => el('div', { class: 'share' }, render(share))));

    return el(
      'tr',
      { class: 'row-split' },
      el('td', {}, ukDate(transaction.date)),
      el('td', { class: 'details', title: transaction.sourceFilename }, transaction.details),
      el('td', {}, transaction.transactionType),
      el(
        'td',
        { class: `num ${transaction.amount < 0 ? 'out' : 'in'}` },
        money(transaction.amount),
        el('div', { class: 'share-amounts' }, ...shares.map((s) => el('div', { class: 'share' }, money(s.amount)))),
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
      el(
        'td',
        { class: 'actions' },
        el(
          'button',
          {
            class: 'link',
            title: 'Edit the rule that splits this transaction',
            onclick: () => {
              const rule = rules.find((r) => r.id === transaction.matchedRuleId);
              if (rule) {
                openRuleEditor({ rule, onSaved: () => void reapplyRules().then(rerender) });
              } else {
                createRuleFrom(transaction);
              }
            },
          },
          'Rule',
        ),
        el(
          'button',
          {
            class: 'link danger',
            onclick: () => {
              if (!confirm('Delete this transaction?')) return;
              void deleteTransaction(transaction.id).then(rerender);
            },
          },
          'Delete',
        ),
      ),
    );
  }

  function describeSplit(transaction) {
    return transaction.allocations
      .map((s) => `${propertyName(s.propertyId)} · ${s.category} · ${money(s.amount)}`)
      .join('\n');
  }

  function ruleLabel(ruleId) {
    const rule = rules.find((r) => r.id === ruleId);
    return rule ? describeRule(rule, money) : 'Rule no longer exists';
  }

  /**
   * Opens the editor pre-filled from this row. An uncategorised row has no
   * property or category to seed, so fall back to the first of each and let
   * the user pick in the dialog.
   */
  function createRuleFrom(transaction) {
    openRuleEditor({
      transaction,
      onSaved: () => void reapplyRules().then(rerender),
    });
  }

  /** @param {Partial<import('../types.js').Transaction>} change */
  async function assign(transaction, change) {
    // A hand-edited row is no longer owned by whatever rule first claimed it,
    // and a manual single assignment replaces any split it used to carry.
    const { allocations, ...rest } = transaction;
    const next = { ...rest, ...change, matchedRuleId: null };
    await updateTransaction(next);
    rerender();
    // Once both fields are set, offer to remember it — non-blocking, and the
    // dialog is pre-filled from this row so it's one click to accept.
    if (next.propertyId !== null && next.category !== null && change.category !== undefined) {
      createRuleFrom(next);
    }
  }
}
