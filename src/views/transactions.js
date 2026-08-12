import { isAssigned } from '../allocation.js';
import { isNonProperty } from '../categories.js';
import { toCsv } from '../csv.js';
import { download, el, toast } from '../dom.js';
import { highlight, setFocus, takeFocus } from '../focus.js';
import { toggleSort } from '../sort.js';
import { ANY, filterTransactions, isFiltered } from '../transaction-filter.js';
import {
  categoryName,
  deleteTransaction,
  getState,
  propertyName,
  reapplyRules,
  updateTransaction,
} from '../store.js';
import { dateRangeControls } from './date-filter.js';
import { openRuleEditor } from './rule-editor.js';
import { categoryFilter, propertyFilter, ruleFilter, transactionTable } from './transaction-table.js';

/** Filter and sort state live outside render so they survive re-renders. */
const filters = { text: '', status: 'all', from: '', to: '', propertyId: ANY, category: ANY, ruleId: ANY };
/** Newest first by default, matching how a statement reads. */
const sort = { key: 'date', dir: 'desc' };

/**
 * Called from the Rules screen: show the transactions a rule claimed, with the
 * rule filter already set. Clears the other filters, since arriving here to
 * see "the 12 rows this rule matched" and being shown four of them because a
 * date range was still on would be a lie.
 */
export function showTransactionsForRule(ruleId) {
  filters.text = '';
  filters.status = 'all';
  filters.from = '';
  filters.to = '';
  filters.propertyId = ANY;
  filters.category = ANY;
  filters.ruleId = ruleId;
  window.location.hash = '#/transactions';
}

export function renderTransactions(root, rerender) {
  const { transactions } = getState();

  if (getState().properties.length === 0) {
    root.append(
      el(
        'div',
        { class: 'notice' },
        'No properties yet — you can still classify rows as “Not a property”, but everything else ' +
          'needs one. ',
        el('a', { href: '#/config' }, 'Add a property'),
      ),
    );
  }

  const visible = filterTransactions(transactions, filters);
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

  root.append(
    // Heading and actions on their own line, so the filter bar below can hold
    // every filter on one row without the title competing for the space.
    el(
      'div',
      { class: 'toolbar' },
      el('h2', {}, 'Transactions'),
      el('span', { class: 'count' }, `${visible.length} shown · ${needsReview} need review`),
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
    el(
      'div',
      { class: 'filter-bar' },
      search,
      propertyFilter(filters.propertyId, (value) => {
        filters.propertyId = value;
        rerender();
      }),
      categoryFilter(filters.category, (value) => {
        filters.category = value;
        rerender();
      }),
      ruleFilter(filters.ruleId, (value) => {
        filters.ruleId = value;
        rerender();
      }),
      statusSelect,
      ...dateRangeControls({
        transactions,
        from: filters.from,
        to: filters.to,
        onChange: ({ from, to }) => {
          filters.from = from;
          filters.to = to;
          rerender();
        },
      }),
      isFiltered(filters)
        ? el('button', { class: 'clear-filters', onclick: () => clearFilters(rerender) }, 'Clear')
        : null,
    ),
  );

  if (transactions.length === 0) {
    root.append(
      el('div', { class: 'empty' }, 'No transactions yet. ', el('a', { href: '#/import' }, 'Import a statement')),
    );
    return;
  }

  if (visible.length === 0) {
    root.append(el('div', { class: 'empty' }, 'No transactions match these filters.'));
    return;
  }

  root.append(
    transactionTable(visible, {
      sort,
      onSort: (key) => {
        toggleSort(sort, key, key === 'date' || key === 'amount' ? 'desc' : 'asc');
        rerender();
      },
      onAssign: (transaction, change) => void assign(transaction, change, rerender),
      onNote: (transaction, notes) => void saveNote(transaction, notes, rerender),
      onCreateRule: (transaction) => createRuleFrom(transaction, rerender),
      onDelete: (transaction) => {
        if (!confirm('Delete this transaction?')) return;
        void deleteTransaction(transaction.id).then(rerender);
      },
    }),
  );

  // Arriving from another screen ("show me that transaction"): make sure the
  // row is in the current filter, then scroll to it and flash it.
  const target = takeFocus('transactions');
  if (target) {
    const found = visible.some((t) => t.id === target);
    if (!found && isFiltered(filters)) {
      toast('Filters cleared to show that transaction.');
      setFocus('transactions', target);
      clearFilters(rerender);
      return;
    }
    highlight(root.querySelector(`[data-transaction="${target}"]`));
  }
}

function clearFilters(rerender) {
  filters.text = '';
  filters.status = 'all';
  filters.from = '';
  filters.to = '';
  filters.propertyId = ANY;
  filters.category = ANY;
  filters.ruleId = ANY;
  rerender();
}

function createRuleFrom(transaction, rerender) {
  openRuleEditor({
    transaction,
    onSaved: () => void reapplyRules().then(rerender),
  });
}

/**
 * Saves a note.
 *
 * Pointedly *not* routed through `assign`: a note says nothing about which
 * property the money belongs to, so it must not clear the rule that claimed
 * the row or flatten a split the way a hand-made assignment does. Writing
 * "waiting on the invoice" against a row should not silently recategorise it.
 */
async function saveNote(transaction, notes, rerender) {
  if (String(transaction.notes ?? '') === notes) return;
  await updateTransaction({ ...transaction, notes });
  rerender();
}

/** @param {object} change partial property/category assignment */
async function assign(transaction, change, rerender) {
  // A hand-edited row is no longer owned by whatever rule first claimed it,
  // and a manual single assignment replaces any split it used to carry.
  const { allocations, ...rest } = transaction;
  const next = { ...rest, ...change, matchedRuleId: null };
  await updateTransaction(next);
  rerender();

  // Non-property is complete the moment the property is set — there is no
  // category to wait for.
  const justClassified = isNonProperty(next.propertyId) && change.propertyId !== undefined;
  const justCategorised =
    next.propertyId !== null && next.category !== null && change.category !== undefined;
  if (justClassified || justCategorised) {
    const wanted = confirm(
      `Assigned to ${propertyName(next.propertyId)}${next.category ? ` · ${categoryName(next.category)}` : ''}.\n\n` +
        'Create a rule so future imports categorise this automatically?',
    );
    if (wanted) createRuleFrom(next, rerender);
  }
}
