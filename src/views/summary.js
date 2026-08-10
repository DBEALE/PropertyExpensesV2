import { allocationsOf, isAssigned, sumAllocations } from '../allocation.js';
import { NON_PROPERTY_ID, NON_PROPERTY_NAME, isNonProperty } from '../categories.js';
import { filterByDate } from '../dates.js';
import { download, el, entityTag, money, sortableTh, toast } from '../dom.js';
import { sortRows, toggleSort } from '../sort.js';
import { getState, saveTaxSettings, taxSettings } from '../store.js';
import { estimateTax, summariseForTax } from '../tax.js';
import { dateRangeControls } from './date-filter.js';
import { slotClass } from '../palette.js';

/** Range state lives outside render so it survives re-renders. */
const range = { from: '', to: '' };
const sort = { key: 'name', dir: 'asc' };

export function renderSummary(root, rerender) {
  const { transactions, properties, categories } = getState();
  const visible = filterByDate(transactions, range.from, range.to);

  root.append(
    el('div', { class: 'toolbar' }, el('h2', {}, 'Summary')),
    el(
      'div',
      { class: 'filter-bar' },
      ...dateRangeControls({
        transactions,
        from: range.from,
        to: range.to,
        onChange: ({ from, to }) => {
          range.from = from;
          range.to = to;
          rerender();
        },
      }),
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

  // Sorting by a category column ranks properties by what they earned or spent
  // under it. "Not a property" is pinned to the bottom either way, since it is
  // a footnote to the table rather than one of its rows.
  const accessors = { name: (p) => p.name, net: (p) => rowTotal(p.id) };
  for (const c of categories) accessors[`cat:${c.id}`] = (p) => cellTotal(p.id, c.id);
  const ranked = sortRows(
    propertyRows.filter((p) => !isNonProperty(p.id)),
    sort,
    accessors,
  );
  const sortedRows = hasNonProperty
    ? [...ranked, propertyRows.find((p) => isNonProperty(p.id))]
    : ranked;

  const onSort = (key) => {
    toggleSort(sort, key, key === 'name' ? 'asc' : 'desc');
    rerender();
  };
  const sTh = (label, key, options) => sortableTh(label, key, sort, onSort, options);

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
          sTh('Property', 'name'),
          ...categories.map((c) =>
            sortableTh(
              c.name,
              `cat:${c.id}`,
              sort,
              onSort,
              { class: 'num', title: c.description || `Sort by ${c.name}` },
            ),
          ),
          sTh('Net', 'net', { class: 'num' }),
        ),
      ),
      el(
        'tbody',
        {},
        ...sortedRows.map((property) =>
          el(
            'tr',
            { class: isNonProperty(property.id) ? 'row-non-property' : '' },
            el('td', {}, entityTag(property.name, isNonProperty(property.id) ? 'slot-neutral' : slotClass(property), property.name)),
            ...categories.map((c) => {
              // Non-property money needs no category, so per-category cells
              // would read as a row of £0.00 that contradicts its own Net.
              if (isNonProperty(property.id)) return el('td', { class: 'num zero' }, '—');
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
              ...sortedRows.map((p) =>
                [
                  quote(p.name),
                  ...categories.map((c) => (isNonProperty(p.id) ? '' : cellTotal(p.id, c.id).toFixed(2))),
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

  renderTaxEstimate(root, rerender, propertyShares, categories);
}

/**
 * What the property profit is likely to cost in income tax.
 *
 * The figure that surprises people is mortgage interest: since 2020/21 it is
 * not an allowable expense, so it does not reduce the profit. It earns a 20%
 * tax credit instead, capped at the lowest of the interest, the profit, and
 * income above the personal allowance — which is why a heavily mortgaged
 * portfolio can pay tax on a profit it never really made.
 */
function renderTaxEstimate(root, rerender, shares, categories) {
  const settings = taxSettings();
  const figures = summariseForTax(shares, settings);
  const estimate = estimateTax(figures, settings);

  root.append(
    el('h3', {}, 'Tax estimate'),
    el(
      'p',
      { class: 'hint' },
      'An estimate for the range selected above, to plan with — not a tax return. Bands are England, ' +
        'Wales and Northern Ireland; Scotland sets its own rates, which you can type in below.',
    ),
    taxSettingsForm(settings, categories, rerender),
  );

  if (figures.income === 0 && figures.expenses === 0 && figures.financeCosts === 0) {
    root.append(el('div', { class: 'empty' }, 'Nothing categorised in this range to estimate tax on.'));
    return;
  }

  const line = (label, value, options = {}) =>
    el(
      'tr',
      { class: options.strong ? 'tax-total' : '' },
      el('td', {}, label, options.note ? el('div', { class: 'share' }, options.note) : null),
      el('td', { class: `num ${options.tone ?? ''} ${options.strong ? 'strong' : ''}` }, value),
    );

  root.append(
    el(
      'table',
      { class: 'data tax-table' },
      el(
        'tbody',
        {},
        line('Rental income', money(figures.income), { tone: 'in' }),
        settings.usePropertyAllowance
          ? line('Property allowance', `−${money(estimate.deduction)}`, {
              note: 'Claimed instead of actual expenses.',
            })
          : line('Allowable expenses', `−${money(figures.expenses)}`, {
              note: 'Everything except the finance-cost category.',
            }),
        line('Taxable property profit', money(estimate.profit), { strong: true }),
        // "Tax at 40%" would misread when a profit straddles two bands: some of
        // it is taxed at 20%. The rate quoted is the top one it reaches.
        line('Tax on the profit', money(estimate.taxBeforeCredit), {
          note: `Stacked on top of your other income, reaching the ${estimate.marginalRate}% band.`,
        }),
        line(
          `Finance cost credit (${settings.financeCreditRate}%)`,
          `−${money(estimate.financeCredit)}`,
          {
            tone: 'in',
            note:
              `${money(figures.financeCosts)} of interest, credit given on ${money(estimate.creditBase)}` +
              (estimate.unusedFinanceCosts > 0
                ? ` — ${money(estimate.unusedFinanceCosts)} could not be used this year`
                : ''),
          },
        ),
        line('Estimated tax due', money(estimate.taxDue), { strong: true, tone: 'out' }),
        estimate.profit > 0
          ? line('Effective rate on profit', `${estimate.effectiveRate}%`, {
              note: 'Tax due as a share of the taxable profit.',
            })
          : null,
        estimate.loss > 0
          ? line('Loss carried forward', money(estimate.loss), {
              note: 'A loss cannot be set against other income; it carries forward.',
            })
          : null,
      ),
    ),
  );
}

/** The parameters the estimate needs, saved as you change them. */
function taxSettingsForm(settings, categories, rerender) {
  const update = (change) => {
    void saveTaxSettings({ ...settings, ...change }).then(rerender);
  };

  const numberField = (label, key, hint) => {
    const input = el('input', {
      type: 'number',
      step: '0.01',
      value: String(settings[key]),
      onchange: (event) => update({ [key]: Number(event.target.value) || 0 }),
    });
    return el('label', {}, label, input, hint ? el('small', {}, hint) : null);
  };

  const financeCategory = el(
    'select',
    { onchange: (event) => update({ financeCostCategoryId: event.target.value }) },
    ...categories.map((c) =>
      el('option', { value: c.id, selected: c.id === settings.financeCostCategoryId }, c.name),
    ),
  );

  const allowanceToggle = el('input', {
    type: 'checkbox',
    checked: settings.usePropertyAllowance,
    onchange: (event) => update({ usePropertyAllowance: event.target.checked }),
  });

  return el(
    'details',
    { class: 'tax-settings', open: true },
    el('summary', {}, 'Your figures'),
    el(
      'div',
      { class: 'detail-fields' },
      numberField('Other income', 'otherIncome', 'Salary, pension, etc. before tax — sets your band'),
      numberField('Your share %', 'ownershipShare', 'If the portfolio is jointly owned'),
      el('label', {}, 'Mortgage interest is', financeCategory, el('small', {}, 'Gets the credit, not deducted')),
      el(
        'label',
        { class: 'inline' },
        allowanceToggle,
        ' Use the £1,000 property allowance',
        el('small', {}, 'Instead of actual expenses'),
      ),
    ),
    el(
      'details',
      { class: 'tax-bands' },
      el('summary', {}, 'Allowances and bands'),
      el(
        'div',
        { class: 'detail-fields' },
        numberField('Personal allowance', 'personalAllowance'),
        numberField('Basic band width', 'basicBandWidth', 'Above the allowance'),
        numberField('Additional rate from', 'additionalRateFrom', 'Total income'),
        numberField('Basic rate %', 'basicRate'),
        numberField('Higher rate %', 'higherRate'),
        numberField('Additional rate %', 'additionalRate'),
        numberField('Finance credit %', 'financeCreditRate'),
        numberField('Property allowance', 'propertyAllowance'),
      ),
    ),
  );
}
