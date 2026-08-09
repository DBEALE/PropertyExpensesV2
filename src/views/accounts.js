/**
 * Per-property account view: what each property earns and spends, when the
 * recurring payments land, and when the next one is due.
 */
import {
  accountSummary,
  isOverdue,
  monthlyTotals,
  paymentStreams,
  sharesFor,
} from '../accounts.js';
import { NON_PROPERTY_ID, NON_PROPERTY_NAME } from '../categories.js';
import { capSeries, chartTable, legend, stackedColumns } from '../charts.js';
import { currentTaxYear, filterByDate, taxYearRange } from '../dates.js';
import { el, entityTag, money, ukDate } from '../dom.js';
import { setFocus } from '../focus.js';
import { slotClass } from '../palette.js';
import { categoryName, getState } from '../store.js';

/** Selection survives re-renders. */
const view = { propertyId: 'all', from: '', to: '' };

export function renderAccounts(root, rerender) {
  const { transactions, properties, categories } = getState();

  if (properties.length === 0 && transactions.length === 0) {
    root.append(
      el('h2', {}, 'Accounts'),
      el(
        'div',
        { class: 'empty' },
        'Nothing to show yet. ',
        el('a', { href: '#/import' }, 'Import a statement'),
        ' to get started.',
      ),
    );
    return;
  }

  const options = [
    { id: 'all', name: 'All properties' },
    ...properties,
    { id: NON_PROPERTY_ID, name: NON_PROPERTY_NAME },
  ];

  const selector = el(
    'select',
    {
      'aria-label': 'Property',
      onchange: (event) => {
        view.propertyId = event.target.value;
        rerender();
      },
    },
    ...options.map((o) => el('option', { value: o.id, selected: o.id === view.propertyId }, o.name)),
  );

  const dateInput = (which) =>
    el('input', {
      type: 'date',
      value: view[which],
      onchange: (event) => {
        view[which] = event.target.value;
        rerender();
      },
    });

  const taxYear = currentTaxYear();

  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h2', {}, 'Accounts'),
      selector,
      el('label', { class: 'inline' }, 'From ', dateInput('from')),
      el('label', { class: 'inline' }, 'To ', dateInput('to')),
      el(
        'button',
        {
          onclick: () => {
            const range = taxYearRange(taxYear);
            view.from = range.from;
            view.to = range.to;
            rerender();
          },
        },
        `${taxYear}/${String((taxYear + 1) % 100).padStart(2, '0')}`,
      ),
      el(
        'button',
        {
          onclick: () => {
            view.from = '';
            view.to = '';
            rerender();
          },
        },
        'All dates',
      ),
    ),
  );

  const inRange = filterByDate(transactions, view.from, view.to);
  const selected = view.propertyId === 'all' ? null : view.propertyId;
  const shares = sharesFor(inRange, selected);

  if (shares.length === 0) {
    root.append(
      el(
        'div',
        { class: 'empty' },
        'No categorised transactions for this selection. ',
        el('a', { href: '#/transactions' }, 'Review transactions'),
      ),
    );
    return;
  }

  renderTiles(root, shares);
  renderCashflow(root, shares, selected, properties, categories);
  renderSchedule(root, shares);
}

/** Headline figures. Income, expenses, and the net they produce. */
function renderTiles(root, shares) {
  const totals = accountSummary(shares);
  const tile = (label, value, tone) =>
    el(
      'div',
      { class: 'tile' },
      el('span', { class: 'tile-label' }, label),
      el('strong', { class: `tile-value ${tone}` }, money(value)),
    );

  root.append(
    el(
      'div',
      { class: 'tiles' },
      tile('Money in', totals.income, 'in'),
      tile('Money out', totals.expenses, 'out'),
      tile('Net', totals.net, totals.net < 0 ? 'out' : 'in'),
      el(
        'div',
        { class: 'tile' },
        el('span', { class: 'tile-label' }, 'Entries'),
        el('strong', { class: 'tile-value' }, String(totals.count)),
      ),
    ),
  );
}

/**
 * Money in and out per month. For one property the stack is by category; for
 * all properties it is by property, so the question the selector asks is the
 * one the colours answer.
 */
function renderCashflow(root, shares, selected, properties, categories) {
  const months = monthlyTotals(shares);
  const buckets = months.map((m) => ({ key: m.month, label: m.label }));

  const groups =
    selected === null
      ? [
          ...properties.map((p) => ({ id: p.id, label: p.name, slot: slotClass(p) })),
          { id: NON_PROPERTY_ID, label: NON_PROPERTY_NAME, slot: 'slot-neutral' },
        ]
      : [
          ...categories.map((c) => ({ id: c.id, label: c.name, slot: slotClass(c) })),
          // Non-property money carries no category, so it needs a bucket of its
          // own or it would vanish from a chart whose tiles still count it.
          { id: null, label: 'Uncategorised', slot: 'slot-neutral' },
        ];

  const keyOf = selected === null ? (s) => s.propertyId : (s) => s.category ?? null;

  const allSeries = groups
    .map((group) => ({
      key: group.id,
      label: group.label,
      slotClass: group.slot,
      values: months.map((month) =>
        shares
          .filter((s) => s.transaction.date.slice(0, 7) === month.month && keyOf(s) === group.id)
          .reduce((sum, s) => sum + s.amount, 0),
      ),
    }))
    .filter((s) => s.values.some((v) => v !== 0));

  // Past eight there is no ninth safe colour, so the smallest fold into one
  // neutral "Other" — the table below still lists every line separately.
  const { series, folded } = capSeries(allSeries);

  root.append(
    el('h3', {}, selected === null ? 'Monthly totals by property' : 'Monthly totals by category'),
    el(
      'p',
      { class: 'hint' },
      'Money in stacks above the line, money out below it. Hover or focus a block for its figure.',
    ),
    legend(series),
    stackedColumns({ buckets, series }),
    folded > 0
      ? el('p', { class: 'hint' }, `${folded} smaller lines are grouped as “Other” in the chart, and listed separately in the table.`)
      : null,
    chartTable({ buckets, series: allSeries }),
  );
}

/**
 * The recurring payments behind those totals: when each last landed, roughly
 * which day of the month it lands on, and when the next one is due.
 */
function renderSchedule(root, shares) {
  const today = new Date().toISOString().slice(0, 10);
  const streams = paymentStreams(shares, today);
  const recurring = streams.filter((s) => s.recurring);
  const oneOffs = streams.filter((s) => !s.recurring);

  root.append(
    el('h3', {}, 'Recurring payments'),
    el(
      'p',
      { class: 'hint' },
      'Worked out from the statements you have imported: anything seen twice or more, about a month ' +
        'apart. Expected dates are an estimate, not a commitment from the bank.',
    ),
  );

  if (recurring.length === 0) {
    root.append(
      el('div', { class: 'empty' }, 'No repeating payments spotted yet — import another month to see them.'),
    );
  } else {
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
            el('th', {}, 'Payment'),
            el('th', {}, 'Category'),
            el('th', { class: 'num' }, 'Typical'),
            el('th', { class: 'num' }, 'Seen'),
            el('th', {}, 'Last'),
            el('th', {}, 'Next expected'),
          ),
        ),
        el(
          'tbody',
          {},
          ...recurring.map((stream) => {
            const overdue = isOverdue(stream, today);
            return el(
              'tr',
              {},
              el(
                'td',
                { class: 'details' },
                stream.label,
                el(
                  'div',
                  { class: 'share' },
                  `${stream.direction === 'in' ? 'Received' : 'Paid'} around the ${ordinal(stream.typicalDay)}`,
                ),
              ),
              el('td', {}, categoryTag(stream.category)),
              el(
                'td',
                { class: `num ${stream.typicalAmount < 0 ? 'out' : 'in'}` },
                money(stream.typicalAmount),
              ),
              el('td', { class: 'num' }, String(stream.count)),
              el('td', {}, ukDate(stream.lastDate)),
              el(
                'td',
                {},
                ukDate(stream.nextExpected),
                overdue
                  ? el('span', { class: 'badge badge-warn overdue' }, 'Nothing since expected')
                  : null,
              ),
            );
          }),
        ),
      ),
    );
  }

  if (oneOffs.length > 0) {
    root.append(
      el('h3', {}, 'One-offs'),
      el(
        'ul',
        { class: 'oneoffs' },
        ...oneOffs.slice(0, 12).map((stream) =>
          el(
            'li',
            {},
            el(
              'button',
              {
                class: 'link oneoff-link',
                title: 'Show this on the Transactions screen',
                onclick: () => {
                  setFocus('transactions', stream.transactionId);
                  window.location.hash = '#/transactions';
                },
              },
              el('span', { class: `num ${stream.total < 0 ? 'out' : 'in'}` }, money(stream.total)),
              ` · ${stream.label}`,
            ),
            ' · ',
            categoryTag(stream.category),
            ` · ${ukDate(stream.lastDate)}`,
          ),
        ),
        oneOffs.length > 12 ? el('li', { class: 'hint' }, `…and ${oneOffs.length - 12} more.`) : null,
      ),
    );
  }
}

function categoryTag(categoryId) {
  const category = getState().categories.find((c) => c.id === categoryId);
  if (!category) return el('span', { class: 'unset' }, categoryName(categoryId));
  return entityTag(category.name, slotClass(category), category.description);
}

function ordinal(day) {
  const suffix =
    day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${day}${suffix}`;
}
