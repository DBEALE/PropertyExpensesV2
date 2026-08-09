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
import { openRuleEditor } from './rule-editor.js';
import { categoryFilter, propertyFilter, transactionTable } from './transaction-table.js';

/** Filter and sort state live outside render so they survive re-renders. */
const filters = { text: '', status: 'all', from: '', to: '', propertyId: ANY, category: ANY };
/** Newest first by default, matching how a statement reads. */
const sort = { key: 'date', dir: 'desc' };

export function renderTransactions(root, rerender) {
  const { transactions } = getState();

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
      propertyFilter(filters.propertyId, (value) => {
        filters.propertyId = value;
        rerender();
      }),
      categoryFilter(filters.category, (value) => {
        filters.category = value;
        rerender();
      }),
      statusSelect,
      el('label', { class: 'inline' }, 'From ', dateInput('from')),
      el('label', { class: 'inline' }, 'To ', dateInput('to')),
      isFiltered(filters)
        ? el('button', { onclick: () => clearFilters(rerender) }, 'Clear filters')
        : null,
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
  rerender();
}

function createRuleFrom(transaction, rerender) {
  openRuleEditor({
    transaction,
    onSaved: () => void reapplyRules().then(rerender),
  });
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
