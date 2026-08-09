import { allocationsOf, isAssigned, sumAllocations } from '../allocation.js';
import { NON_PROPERTY_ID, NON_PROPERTY_NAME, isNonProperty } from '../categories.js';
import { currentTaxYear, filterByDate, taxYearRange } from '../dates.js';
import { download, el, money, toast } from '../dom.js';
import { getState } from '../store.js';

/** Range state lives outside render so it survives re-renders. */
const range = { from: '', to: '' };

export function renderSummary(root, rerender) {
  const { transactions, properties, categories } = getState();
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

  // Flatten to allocations once: a split transaction contributes one entry per
  // property, a simple one contributes a single entry for its whole amount.
  const shares = visible.flatMap((t) => allocationsOf(t));
  // Summed in pence: adding many shares as floats drifts (0.1 + 0.2), and a
  // tax return should not show £-30.160000000000004 in any export.
  const sum = (list) => sumAllocations(list);

  // Rows are the real properties, plus a "Not a property" line whenever
  // anything has been classified that way — visible rather than quietly
  // excluded, but kept out of the property totals below.
  const propertyRows = [...properties];
  const hasNonProperty = shares.some((s) => isNonProperty(s.propertyId));
  if (hasNonProperty) propertyRows.push({ id: NON_PROPERTY_ID, name: NON_PROPERTY_NAME });

  if (propertyRows.length === 0) {
    root.append(el('div', { class: 'empty' }, 'No properties yet.'));
    return;
  }

  // Property totals deliberately exclude non-property money — that is the
  // figure a Self Assessment return needs.
  const propertyShares = shares.filter((s) => !isNonProperty(s.propertyId));

  const cellTotal = (propertyId, category) =>
    sum(shares.filter((s) => s.propertyId === propertyId && s.category === category));

  const columnTotal = (category) => sum(propertyShares.filter((s) => s.category === category));

  const rowTotal = (propertyId) => sum(shares.filter((s) => s.propertyId === propertyId));

  const grandTotal = sum(propertyShares);

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
          ...categories.map((c) => el('th', { class: 'num', title: c.description }, c.name)),
          el('th', { class: 'num' }, 'Net'),
        ),
      ),
      el(
        'tbody',
        {},
        ...propertyRows.map((property) =>
          el(
            'tr',
            { class: isNonProperty(property.id) ? 'row-non-property' : '' },
            el('td', {}, property.name),
            ...categories.map((c) => {
              const value = cellTotal(property.id, c.id);
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
          ...categories.map((c) => el('th', { class: 'num' }, money(columnTotal(c.id)))),
          el('th', { class: 'num strong' }, money(grandTotal)),
        ),
      ),
    ),
    hasNonProperty
      ? el(
          'p',
          { class: 'hint' },
          'The “Not a property” line is shown for completeness and is excluded from the ' +
            '“All properties” totals.',
        )
      : null,
    el(
      'div',
      { class: 'toolbar' },
      el(
        'button',
        {
          onclick: () => {
            const quote = (s) => `"${s.replace(/"/g, '""')}"`;
            const lines = [
              ['Property', ...categories.map((c) => c.name), 'Net'].join(','),
              ...propertyRows.map((p) =>
                [
                  quote(p.name),
                  ...categories.map((c) => cellTotal(p.id, c.id).toFixed(2)),
                  rowTotal(p.id).toFixed(2),
                ].join(','),
              ),
              [
                'All properties',
                ...categories.map((c) => columnTotal(c.id).toFixed(2)),
                grandTotal.toFixed(2),
              ].join(','),
            ];
            download('summary.csv', lines.join('\r\n'), 'text/csv;charset=utf-8');
            toast('Summary exported.');
          },
        },
        'Export summary CSV',
      ),
    ),
  );
}
