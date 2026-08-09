import { toCsv } from '../csv.js';
import { newId } from '../db.js';
import { download, el, money, toast, ukDate } from '../dom.js';
import { filterByDate } from '../dates.js';
import { shouldSuggestAmountPin } from '../rules.js';
import { deleteTransaction, getState, propertyName, saveRule, updateTransaction } from '../store.js';
import { CATEGORIES, isCategory } from '../types.js';

/** Filter state lives outside render so it survives re-renders. */
const filters = { text: '', status: 'all', from: '', to: '' };

export function renderTransactions(root, rerender) {
  const { transactions, properties, rules } = getState();

  if (properties.length === 0) {
    root.append(
      el(
        'div',
        { class: 'notice' },
        'Add a property first — then you can assign transactions to it. ',
        el('a', { href: '#/properties' }, 'Go to Properties'),
      ),
    );
  }

  let visible = filterByDate(transactions, filters.from, filters.to);
  if (filters.text) {
    const needle = filters.text.toLowerCase();
    visible = visible.filter((t) => t.details.toLowerCase().includes(needle));
  }
  if (filters.status === 'review') visible = visible.filter((t) => t.propertyId === null || t.category === null);
  if (filters.status === 'auto') visible = visible.filter((t) => t.matchedRuleId !== null);

  const needsReview = transactions.filter((t) => t.propertyId === null || t.category === null).length;

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
    const assigned = transaction.propertyId !== null && transaction.category !== null;

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
          void assign(transaction, { category: isCategory(value) ? value : null });
        },
      },
      el('option', { value: '' }, '— unassigned —'),
      ...CATEGORIES.map((c) => el('option', { value: c, selected: c === transaction.category }, c)),
    );

    return el(
      'tr',
      {},
      el('td', {}, ukDate(transaction.date)),
      el('td', { class: 'details', title: transaction.sourceFilename }, transaction.details),
      el('td', {}, transaction.transactionType),
      el('td', { class: `num ${transaction.amount < 0 ? 'out' : 'in'}` }, money(transaction.amount)),
      el('td', {}, propertySelect),
      el('td', {}, categorySelect),
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
        {},
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

  function ruleLabel(ruleId) {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return 'Rule no longer exists';
    return rule.amountEquals === undefined
      ? `Matched "${rule.matchText}"`
      : `Matched "${rule.matchText}" at ${money(rule.amountEquals)}`;
  }

  /** @param {Partial<import('../types.js').Transaction>} change */
  async function assign(transaction, change) {
    // A hand-edited row is no longer owned by whatever rule first claimed it.
    const next = { ...transaction, ...change, matchedRuleId: null };
    await updateTransaction(next);
    if (next.propertyId !== null && next.category !== null) await offerRule(next);
    rerender();
  }
}

/**
 * After a manual assignment, offers to remember it as a rule. Defaults to
 * pinning the amount when the same matchText is already used by another
 * property, since that is the signal the payee is shared.
 */
async function offerRule(transaction) {
  const { rules } = getState();
  const matchText = prompt(
    'Save this as a rule for future imports?\n\nText to match in Details (blank to skip):',
    suggestMatchText(transaction.details),
  );
  if (matchText === null || matchText.trim() === '') return;

  const pinByDefault = shouldSuggestAmountPin(matchText, transaction.propertyId, rules);
  const pin = confirm(
    pinByDefault
      ? `"${matchText}" is already used by another property.\n\nPin this rule to the exact amount ` +
          `${money(transaction.amount)} so the two don't collide?\n\nOK = pin the amount, Cancel = text-only rule.`
      : `Pin this rule to the exact amount ${money(transaction.amount)}?\n\n` +
          'OK = pin the amount, Cancel = text-only rule (recommended).',
  );

  await saveRule({
    id: newId(),
    matchText: matchText.trim(),
    matchType: 'contains',
    propertyId: transaction.propertyId,
    category: transaction.category,
    ...(pin ? { amountEquals: transaction.amount } : {}),
  });
  toast(`Rule saved: "${matchText.trim()}"${pin ? ` at ${money(transaction.amount)}` : ''}.`);
}

/**
 * Picks a sensible default match text: the longest word of 4+ characters,
 * which for "S Agyapong 3 PETERBOROUGH GAT" gives "PETERBOROUGH".
 * @param {string} details
 */
export function suggestMatchText(details) {
  const words = details.split(/\s+/).filter((w) => /[a-z]/i.test(w) && w.length >= 4);
  if (words.length === 0) return details.trim();
  return words.reduce((best, w) => (w.length > best.length ? w : best));
}
