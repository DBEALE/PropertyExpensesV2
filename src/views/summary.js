import { allocationsOf, isAssigned, sumAllocations } from '../allocation.js';
import { currentTaxYear, filterByDate, taxYearRange } from '../dates.js';
import { download, el, money, toast } from '../dom.js';
import { getState } from '../store.js';
import { CATEGORIES } from '../types.js';

/** Range state lives outside render so it survives re-renders. */
const range = { from: '', to: '' };

export function renderSummary(root, rerender) {
  const { transactions, properties } = getState();
  const visible = filterByDate(transactions, range.from, range.to);
  const taxYears = [currentTaxYear(), currentTaxYear() - 1, currentTaxYear() - 2];

  const dateInput = (which) =>
    el('input', {
      type: 'date',
      value: range[which],
      onchange: (event) => {
        range[which] = event.target.value;
        rerender();
      },
    });

  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h2', {}, 'Summary'),
      el('label', { class: 'inline' }, 'From ', dateInput('from')),
      el('label', { class: 'inline' }, 'To ', dateInput('to')),
      ...taxYears.map((year) =>
        el(
          'button',
          {
            onclick: () => {
              const { from, to } = taxYearRange(year);
              range.from = from;
              range.to = to;
              rerender();
            },
          },
          `${year}/${String((year + 1) % 100).padStart(2, '0')}`,
        ),
      ),
      el(
        'button',
        {
          onclick: () => {
            range.from = '';
            range.to = '';
            rerender();
          },
        },
        'All dates',
      ),
    ),
    el(
      'p',
      { class: 'hint' },
      'UK tax years run 6 April to 5 April. Rent is income (positive); the other categories are expenses ' +
        '(negative). Net is income minus expenses.',
    ),
  );

  const unassigned = visible.filter((t) => !isAssigned(t));
  if (unassigned.length > 0) {
    root.append(
      el(
        'div',
        { class: 'notice' },
        `${unassigned.length} transaction(s) in this range are not categorised and are excluded from the ` +
          'totals below. ',
        el('a', { href: '#/transactions' }, 'Review them'),
      ),
    );
  }

  if (properties.length === 0) {
    root.append(el('div', { class: 'empty' }, 'No properties yet.'));
    return;
  }

  // Flatten to allocations once: a split transaction contributes one entry per
  // property, a simple one contributes a single entry for its whole amount.
  const shares = visible.flatMap((t) => allocationsOf(t));
  // Summed in pence: adding many shares as floats drifts (0.1 + 0.2), and a
  // tax return should not show £-30.160000000000004 in any export.
  const sum = (list) => sumAllocations(list);

  const cellTotal = (propertyId, category) =>
    sum(shares.filter((s) => s.propertyId === propertyId && s.category === category));

  const columnTotal = (category) => sum(shares.filter((s) => s.category === category));

  const rowTotal = (propertyId) => sum(shares.filter((s) => s.propertyId === propertyId));

  const grandTotal = sum(shares);

  root.append(
    el(
      'table',
      { class: 'data summary' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Property'),
          ...CATEGORIES.map((c) => el('th', { class: 'num' }, c)),
          el('th', { class: 'num' }, 'Net'),
        ),
      ),
      el(
        'tbody',
        {},
        ...properties.map((property) =>
          el(
            'tr',
            {},
            el('td', {}, property.name),
            ...CATEGORIES.map((c) => {
              const value = cellTotal(property.id, c);
              return el('td', { class: `num ${value < 0 ? 'out' : value > 0 ? 'in' : 'zero'}` }, money(value));
            }),
            el('td', { class: 'num strong' }, money(rowTotal(property.id))),
          ),
        ),
      ),
      el(
        'tfoot',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'All properties'),
          ...CATEGORIES.map((c) => el('th', { class: 'num' }, money(columnTotal(c)))),
          el('th', { class: 'num strong' }, money(grandTotal)),
        ),
      ),
    ),
    el(
      'div',
      { class: 'toolbar' },
      el(
        'button',
        {
          onclick: () => {
            const quote = (s) => `"${s.replace(/"/g, '""')}"`;
            const rows = [
              ['Property', ...CATEGORIES, 'Net'].join(','),
              ...properties.map((p) =>
                [
                  quote(p.name),
                  ...CATEGORIES.map((c) => cellTotal(p.id, c).toFixed(2)),
                  rowTotal(p.id).toFixed(2),
                ].join(','),
              ),
              ['All properties', ...CATEGORIES.map((c) => columnTotal(c).toFixed(2)), grandTotal.toFixed(2)].join(','),
            ];
            download('summary.csv', rows.join('\r\n'), 'text/csv;charset=utf-8');
            toast('Summary exported.');
          },
        },
        'Export summary CSV',
      ),
    ),
  );
}
