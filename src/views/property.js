/**
 * One property in full: its address, insurance, mortgage, valuation and
 * tenancy — each kept as a dated record, with everything it replaced still
 * readable underneath.
 */
import {
  accountSummary,
  isOverdue,
  monthlyTotals,
  paymentStreams,
  sharesFor,
  streamState,
} from '../accounts.js';
import { sumAllocations } from '../allocation.js';
import { capSeries, legend, stackedColumns } from '../charts.js';
import { complianceStatus, upcomingCompliance } from '../compliance.js';
import { addMonths, taxYearRange } from '../dates.js';
import { taxYearLabel, taxYearOf } from '../date-presets.js';
import { el, entityTag, money, sortableTh, toast, ukDate } from '../dom.js';
import { sortRows, toggleSort } from '../sort.js';
import { ANY, filterTransactions } from '../transaction-filter.js';
import { dateRangeControls } from './date-filter.js';
import { categoryFilter, transactionTable } from './transaction-table.js';
import { slotClass } from '../palette.js';
import {
  SECTIONS,
  currentRecord,
  equity,
  historyFor,
  loanToValue,
  upcomingDates,
} from '../property-details.js';
import {
  deleteComplianceCompletion,
  deletePropertyDetail,
  getState,
  saveComplianceCompletion,
  savePropertyDetail,
} from '../store.js';

/** Which section is open for editing, so a re-render doesn't close it. */
let editing = null;
/** Oldest month first, so a year of figures reads chronologically. */
const matrixSort = { key: 'month', dir: 'asc' };
/** State for the read-only transaction list at the foot of the page. */
const listSort = { key: 'date', dir: 'desc' };
const listFilter = { category: ANY };
/** Date range for the monthly breakdown table, kept across re-renders. */
const breakdownRange = { from: '', to: '' };
/** Sort state for the cross-property overview table. */
const overviewSort = { key: 'name', dir: 'asc' };
const insuranceSort = { key: 'name', dir: 'asc' };
const tenancySort = { key: 'name', dir: 'asc' };
const complianceOverviewSort = { key: 'name', dir: 'asc' };
/**
 * Where the tab was left: null means the cross-property overview, an id means
 * that property. The tab link is a bare "#/properties" with no id, so without
 * this, leaving the tab and coming back would always land on the overview even
 * when you were part-way through a property.
 */
let lastViewed = null;

/** The overview, rather than any one property. */
export const OVERVIEW = null;

/**
 * The value the switcher's first entry carries. A sentinel rather than '',
 * because an empty option value is indistinguishable from a property whose id
 * failed to load.
 */
const OVERVIEW_OPTION = '__overview__';

/**
 * The one open section of a property page.
 *
 * The page used to run all five down the screen, which meant the compliance
 * table was three scrolls below the thing that told you to look at it. One at
 * a time, with every panel stating what is inside it, means the choice of what
 * to read is made from summaries rather than by scrolling past them.
 *
 * `details` is labelled "Overview" on screen: it holds the five dated record
 * sections — address through tenancy — which are an overview *of the property*
 * rather than of the portfolio.
 */
export const PANELS = [
  { key: 'breakdown', label: 'Monthly breakdown' },
  { key: 'recurring', label: 'Recurring payments' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'details', label: 'Overview' },
];

/** Which panel is open, kept across re-renders and across properties. */
let openPanel = PANELS[0].key;
/** Set when the strip itself changed the selection, so focus follows it. */
let refocusPanel = false;

/**
 * Works out what the Properties tab should show.
 *
 * An id in the URL always wins — a bookmark, or a link from Config or the
 * overview, means that property specifically. With no id, return to whatever
 * was last open: the overview on a first visit, otherwise the property you
 * were reading. A remembered property that has since been deleted falls back
 * to the overview rather than leaving the page stuck.
 *
 * @param {{id: string}[]} properties
 * @param {string|null} requestedId from the URL
 * @param {string|null} rememberedId
 * @returns {{id: string}|null} null for the overview
 */
export function resolveSelectedProperty(properties, requestedId, rememberedId) {
  if (properties.length === 0) return OVERVIEW;
  if (requestedId) return properties.find((p) => p.id === requestedId) ?? OVERVIEW;
  return properties.find((p) => p.id === rememberedId) ?? OVERVIEW;
}

/**
 * When the current tenancy began — the tenant's own start date if recorded,
 * otherwise the date the record took effect. Used to retire a former tenant's
 * rent so they are never reported as owing money.
 *
 * @returns {string|null} ISO date
 */
function tenancyStart(details, propertyId) {
  const tenancy = currentRecord(details, propertyId, 'tenancy');
  if (!tenancy) return null;
  return tenancy.data?.startDate || tenancy.effectiveFrom || null;
}

export function renderProperty(root, rerender, propertyId) {
  const { properties, propertyDetails, complianceTypes, complianceCompletions, transactions } = getState();

  if (properties.length === 0) {
    root.append(
      el('h2', {}, 'Properties'),
      el(
        'div',
        { class: 'empty' },
        'No properties yet. ',
        el('a', { href: '#/config' }, 'Add one on the Config tab'),
      ),
    );
    return;
  }

  const property = resolveSelectedProperty(properties, propertyId, lastViewed);

  if (property === OVERVIEW) {
    lastViewed = null;
    // A stale id in the URL would otherwise keep pointing at a deleted property.
    if (propertyId) window.location.replace('#/properties');
    else renderOverview(root, rerender);
    return;
  }

  if (property.id !== propertyId) {
    // Put the id in the URL so the page stays bookmarkable and a refresh comes
    // back to the same property. This re-enters render via hashchange.
    window.location.replace(`#/properties/${encodeURIComponent(property.id)}`);
    return;
  }
  lastViewed = property.id;

  const today = new Date().toISOString().slice(0, 10);

  // The selector *is* the title: it already says which property you are on, so
  // a heading repeating the same name beside it was saying it twice. Going back
  // to all properties is the first entry in it rather than a separate link —
  // the switcher is already the thing you reach for to change what you are
  // looking at, and "everything" is one of the choices.
  const selector = el(
    'select',
    {
      'aria-label': 'Property',
      class: `property-selector ${slotClass(property)}`,
      onchange: (event) => {
        if (event.target.value === OVERVIEW_OPTION) {
          // A plain hash change to #/properties would bounce straight back
          // here, since this property is the remembered one — so forget it.
          lastViewed = null;
          window.location.hash = '#/properties';
          return;
        }
        window.location.hash = `#/properties/${encodeURIComponent(event.target.value)}`;
      },
    },
    el('option', { value: OVERVIEW_OPTION }, 'Overview — all properties'),
    ...properties.map((p) => el('option', { value: p.id, selected: p.id === property.id }, p.name)),
  );

  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h2', { class: 'property-title' }, selector),
      el('a', { class: 'link', href: '#/config' }, 'Edit properties'),
    ),
  );

  // The current tenancy retires the previous tenant's rent, so a former
  // tenant is never reported as owing money.
  const streamOptions = { tenancyFrom: tenancyStart(propertyDetails, propertyId) };
  const streams = paymentStreams(sharesFor(transactions, propertyId), today).filter((s) => s.recurring);
  const lateStreams = streams.filter((s) => isOverdue(s, today, streamOptions));

  renderComingUp(root, {
    dated: upcomingDates(propertyDetails, propertyId, today, 90),
    compliance: upcomingCompliance(complianceTypes, complianceCompletions, propertyId, today, 90),
    lateStreams,
    today,
  });

  const shares = sharesFor(transactions, propertyId);
  const { categories } = getState();
  const statuses = complianceStatus(complianceTypes, complianceCompletions, property.id, today);
  const ownTransactions = filterTransactions(transactions, { propertyId: property.id });

  const summaries = panelSummaries({
    shares,
    categories,
    streams,
    lateStreams,
    statuses,
    transactions: ownTransactions,
    property,
    propertyDetails,
    today,
    streamOptions,
  });

  const body = el('div', { class: 'panel-body', id: 'panel-body', role: 'tabpanel' });
  root.append(renderPanelChooser(summaries, rerender), body);

  if (openPanel === 'breakdown') renderMonthlyBreakdown(body, shares, categories, rerender);
  else if (openPanel === 'recurring') renderRecurring(body, streams, today, streamOptions);
  else if (openPanel === 'compliance') renderCompliance(body, property, statuses, today, rerender);
  else if (openPanel === 'transactions') renderTransactionList(body, rerender, transactions, property);
  else {
    for (const section of SECTIONS) {
      body.append(renderSection(section, property, propertyDetails, rerender));
    }
  }
}

/**
 * The row of panels, and the click that swaps which one is open.
 *
 * Each is a real button with `role="tab"`: arrow keys move between them and the
 * open one is the only one in the tab order, which is what a keyboard user
 * expects of a strip of choices where exactly one applies.
 */
function renderPanelChooser(summaries, rerender) {
  const open = (key) => {
    openPanel = key;
    // A re-render replaces these buttons, so the one that was clicked takes
    // the focus with it when it is removed. The flag carries the intent across
    // to the fresh strip; without it, arrowing along the panels would drop
    // focus to the document after the first press.
    refocusPanel = true;
    rerender();
  };

  const buttons = PANELS.map((panel) => {
    const selected = panel.key === openPanel;
    return el(
      'button',
      {
        class: `panel${selected ? ' selected' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': String(selected),
        'aria-controls': 'panel-body',
        tabindex: selected ? '0' : '-1',
        onclick: () => open(panel.key),
        onkeydown: (event) => {
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          if (step === 0) return;
          event.preventDefault();
          const at = PANELS.findIndex((p) => p.key === openPanel);
          // Wraps, so the strip has no dead end at either edge.
          open(PANELS[(at + step + PANELS.length) % PANELS.length].key);
        },
      },
      el('span', { class: 'panel-title' }, panel.label),
      el('span', { class: 'panel-summary' }, summaries[panel.key]),
    );
  });

  if (refocusPanel) {
    refocusPanel = false;
    // After the caller has appended this strip, not before.
    queueMicrotask(() => buttons.find((b) => b.classList.contains('selected'))?.focus());
  }

  return el('div', { class: 'panels', role: 'tablist', 'aria-label': 'Property sections' }, ...buttons);
}

/**
 * What each panel says about itself.
 *
 * A row of five bare labels would just be a menu of places to go and look; the
 * point of the summary is that most visits end here, because the line under
 * the title already answered the question. So each one leads with the figure
 * that would otherwise have to be counted by eye — how many months' rent
 * actually arrived, how many certificates have lapsed — rather than with how
 * many rows the table has.
 *
 * @returns {Record<string, string>} panel key to a single line of text
 */
export function panelSummaries(ctx) {
  return {
    breakdown: breakdownSummary(ctx),
    recurring: recurringSummary(ctx),
    compliance: complianceSummary(ctx),
    transactions: transactionsSummary(ctx),
    details: detailsSummary(ctx),
  };
}

/** Joins the clauses of a summary, dropping the ones that had nothing to say. */
function clauses(...parts) {
  return parts.filter(Boolean).join(' · ');
}

/**
 * Whole pounds. A summary line is read at a glance and compared with another
 * one beside it; pence in that position are noise, and the exact figure is one
 * click away in the table itself.
 */
function roughMoney(amount) {
  const sign = amount < 0 ? '-' : '';
  return `${sign}£${Math.round(Math.abs(amount)).toLocaleString('en-GB')}`;
}

/**
 * Months where rent came in, and the largest things it went out on.
 *
 * "Money in" is the app's definition of rent throughout — income is positive,
 * expenses negative — so a month with nothing positive in it is a month the
 * rent did not arrive, which is the single fact worth putting on the panel.
 *
 * Reads the same date range as the table inside, so opening the panel never
 * contradicts the line that persuaded you to open it.
 */
function breakdownSummary({ shares, categories }) {
  const months = monthlyTotals(sharesInBreakdownRange(shares));
  if (months.length === 0) return 'Nothing categorised against this property yet';

  const withRent = months.filter((m) => m.income > 0).length;
  const rent =
    withRent === months.length
      ? `All ${months.length} months’ rent received`
      : `${withRent} of ${months.length} months’ rent received`;

  // Biggest two costs by name, so "what is this property actually eating" is
  // answered without opening anything. Shown unsigned: the category name says
  // it is money out, and a minus in a summary line reads as a correction.
  // Names keep the case they were given — lowercasing turns "EPC" into "epc".
  const spend = categories
    .map((c) => ({
      name: c.name,
      total: months.reduce((sum, m) => sum + (m.byCategory.get(c.id) ?? 0), 0),
    }))
    .filter((c) => c.total < 0)
    .sort((a, b) => a.total - b.total)
    .slice(0, 2)
    .map((c) => `${roughMoney(Math.abs(c.total))} ${c.name}`);

  const net = months.reduce((sum, m) => sum + m.net, 0);
  return clauses(rent, ...spend, `net ${roughMoney(net)}`);
}

/** The shares the Monthly breakdown panel would show, given its current range. */
function sharesInBreakdownRange(shares) {
  return shares.filter(
    (s) =>
      (!breakdownRange.from || s.transaction.date >= breakdownRange.from) &&
      (!breakdownRange.to || s.transaction.date <= breakdownRange.to),
  );
}

function recurringSummary({ streams, lateStreams, today, streamOptions }) {
  if (streams.length === 0) return 'None spotted yet — import another month to see them';

  const live = streams.filter((s) => streamState(s, today, streamOptions) !== 'ended');
  const ended = streams.length - live.length;
  const next = live
    .filter((s) => !lateStreams.includes(s))
    .map((s) => s.nextExpected)
    .sort()[0];

  return clauses(
    `${live.length} repeating payment${live.length === 1 ? '' : 's'}`,
    lateStreams.length > 0
      ? `${lateStreams.length} overdue`
      : next
        ? `next expected ${ukDate(next)}`
        : null,
    ended > 0 ? `${ended} stopped` : null,
  );
}

function complianceSummary({ statuses }) {
  if (statuses.length === 0) return 'No compliance types set up yet';

  const overdue = statuses.filter((s) => s.overdue).length;
  const never = statuses.filter((s) => s.neverRecorded).length;
  const next = statuses
    .filter((s) => !s.overdue && s.nextDue !== null)
    .map((s) => s.nextDue)
    .sort()[0];

  return clauses(
    `${statuses.length} certificate${statuses.length === 1 ? '' : 's'} tracked`,
    overdue > 0 ? `${overdue} overdue` : null,
    never > 0 ? `${never} never logged` : null,
    overdue === 0 && next ? `next due ${ukDate(next)}` : null,
  );
}

function transactionsSummary({ transactions }) {
  if (transactions.length === 0) return 'Nothing assigned to this property yet';
  const latest = transactions.map((t) => t.date).sort().at(-1);
  return clauses(
    `${transactions.length} transaction${transactions.length === 1 ? '' : 's'}`,
    `latest ${ukDate(latest)}`,
  );
}

/**
 * How complete the property's own records are, and what is missing.
 *
 * Naming the gaps rather than counting them: "Insurance and Tenancy not
 * recorded" is a thing to go and do, where "3 of 5 recorded" only says that
 * something, somewhere, is absent.
 */
function detailsSummary({ property, propertyDetails }) {
  const recorded = SECTIONS.filter((s) => currentRecord(propertyDetails, property.id, s.key));
  if (recorded.length === 0) return 'Nothing recorded yet — address, mortgage, tenancy and more';

  const missing = SECTIONS.filter((s) => !recorded.includes(s)).map((s) => s.label);
  return clauses(
    `${listing(recorded.map((s) => s.label))} recorded`,
    missing.length > 0 ? `${listing(missing)} not recorded` : null,
  );
}

/** "A, B and C" — an English list, for text a person reads rather than scans. */
function listing(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * The whole portfolio on one screen: what each property is worth, what it owes,
 * what it has earned, and whether anything about it needs attention. Clicking a
 * name drills into that property.
 *
 * This is also the portfolio-wide "what's due everywhere" view that the
 * per-property compliance work deliberately left for later.
 */
function renderOverview(root, rerender) {
  const { properties, propertyDetails, complianceTypes, complianceCompletions, transactions } = getState();
  const today = new Date().toISOString().slice(0, 10);

  // Net is the *current tax year* rather than everything ever imported: on this
  // screen the question is how the portfolio is doing now, and a lifetime total
  // quietly answers a different one.
  const currentTaxYear = taxYearOf(today);
  const taxYear = taxYearRange(currentTaxYear);
  const netLabel = `Net income ${taxYearLabel(currentTaxYear)}`;
  const inTaxYear = (share) =>
    share.transaction.date >= taxYear.from && share.transaction.date <= taxYear.to;

  const rows = properties.map((property) => {
    const shares = sharesFor(transactions, property.id);
    const mortgage = currentRecord(propertyDetails, property.id, 'mortgage');
    const valuation = currentRecord(propertyDetails, property.id, 'valuation');
    const overdueStreams = paymentStreams(shares, today).filter(
      (s) => s.recurring && isOverdue(s, today, { tenancyFrom: tenancyStart(propertyDetails, property.id) }),
    );
    const compliance = upcomingCompliance(complianceTypes, complianceCompletions, property.id, today, 90);
    const dated = upcomingDates(propertyDetails, property.id, today, 90);
    // One list of everything approaching, so "next due" is the true next thing.
    const upcoming = [...compliance, ...dated.map((d) => ({ ...d, overdue: false }))].sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    return {
      property,
      value: valuation ? number(valuation.data.value) : null,
      debt: mortgage ? number(mortgage.data.amount) : null,
      ltv: loanToValue(mortgage, valuation),
      equity: equity(mortgage, valuation),
      net: accountSummary(shares.filter(inTaxYear)).net,
      attention: overdueStreams.length + compliance.filter((c) => c.overdue).length,
      overdueStreams,
      next: upcoming.find((u) => !u.overdue) ?? null,
    };
  });

  const total = (pick) =>
    rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0);
  const portfolioValue = total((r) => r.value);
  const portfolioDebt = total((r) => r.debt);
  const needingAttention = rows.filter((r) => r.attention > 0);

  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h2', {}, 'Properties'),
      el('span', { class: 'count' }, `${properties.length} propert${properties.length === 1 ? 'y' : 'ies'}`),
      el('a', { class: 'link', href: '#/config' }, 'Add or edit properties'),
    ),
  );

  if (needingAttention.length > 0) {
    root.append(
      el(
        'div',
        { class: 'notice attention attention-overdue' },
        el(
          'div',
          { class: 'attention-group' },
          el('strong', {}, 'Needs attention'),
          el(
            'ul',
            {},
            ...needingAttention.map((row) =>
              el(
                'li',
                {},
                el('span', { class: 'badge badge-overdue' }, String(row.attention)),
                ' ',
                el(
                  'button',
                  { class: 'link', onclick: () => openProperty(row.property.id) },
                  row.property.name,
                ),
                row.overdueStreams.length > 0
                  ? ` — ${row.overdueStreams.map((s) => s.label).join(', ')} not received`
                  : ' — compliance overdue',
              ),
            ),
          ),
        ),
      ),
    );
  }

  const accessors = {
    name: (r) => r.property.name,
    value: (r) => r.value,
    debt: (r) => r.debt,
    ltv: (r) => r.ltv,
    equity: (r) => r.equity,
    net: (r) => r.net,
    attention: (r) => r.attention,
    next: (r) => r.next?.date ?? null,
  };
  const sorted = sortRows(rows, overviewSort, accessors);
  const onSort = (key) => {
    toggleSort(overviewSort, key, key === 'name' ? 'asc' : 'desc');
    rerender();
  };
  const oTh = (label, key, options) => sortableTh(label, key, overviewSort, onSort, options);

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
          oTh('Property', 'name'),
          oTh('Value', 'value', { class: 'num' }),
          oTh('Mortgage', 'debt', { class: 'num' }),
          oTh('LTV', 'ltv', { class: 'num' }),
          oTh('Equity', 'equity', { class: 'num' }),
          oTh(netLabel, 'net', {
            class: 'num',
            title: `Net income from ${ukDate(taxYear.from)} to ${ukDate(taxYear.to)}`,
          }),
          oTh('Attention', 'attention', { class: 'num' }),
          oTh('Next due', 'next'),
        ),
      ),
      el(
        'tbody',
        {},
        ...sorted.map((row) =>
          el(
            'tr',
            {},
            el(
              'td',
              {},
              el(
                'button',
                {
                  class: 'link property-drill',
                  title: `Open ${row.property.name}`,
                  onclick: () => openProperty(row.property.id),
                },
                entityTag(row.property.name, slotClass(row.property)),
              ),
            ),
            el('td', { class: 'num' }, row.value === null ? '—' : money(row.value)),
            el('td', { class: 'num' }, row.debt === null ? '—' : money(row.debt)),
            el(
              'td',
              { class: `num ${row.ltv !== null && row.ltv > 75 ? 'out' : ''}` },
              row.ltv === null ? '—' : `${row.ltv}%`,
            ),
            el('td', { class: 'num' }, row.equity === null ? '—' : money(row.equity)),
            el('td', { class: `num strong ${row.net < 0 ? 'out' : 'in'}` }, money(row.net)),
            el(
              'td',
              { class: 'num' },
              row.attention === 0
                ? el('span', { class: 'unset' }, '—')
                : el('span', { class: 'badge badge-overdue' }, String(row.attention)),
            ),
            el(
              'td',
              {},
              row.next
                ? `${row.next.label} — ${ukDate(row.next.date)}`
                : el('span', { class: 'unset' }, 'nothing in 90 days'),
            ),
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
          el('th', { class: 'num' }, portfolioValue ? money(portfolioValue) : '—'),
          el('th', { class: 'num' }, portfolioDebt ? money(portfolioDebt) : '—'),
          // Portfolio LTV: total borrowing against total value, not an average
          // of the per-property percentages, which would weight a cheap
          // property the same as an expensive one.
          el(
            'th',
            { class: 'num' },
            portfolioValue ? `${Math.round((portfolioDebt / portfolioValue) * 1000) / 10}%` : '—',
          ),
          el(
            'th',
            { class: 'num' },
            portfolioValue ? money(Math.round((portfolioValue - portfolioDebt) * 100) / 100) : '—',
          ),
          el('th', { class: 'num strong' }, money(total((r) => r.net))),
          el('th', { class: 'num' }, String(total((r) => r.attention))),
          el('th', {}, ''),
        ),
      ),
    ),
    el(
      'p',
      { class: 'hint' },
      'Click a property to open it. Value, mortgage and the figures derived from them come from the ' +
        `records you have entered; ${netLabel} comes from the categorised statements dated ` +
        `${ukDate(taxYear.from)} to ${ukDate(taxYear.to)} — the UK tax year in progress.`,
    ),
  );

  renderInsuranceOverview(root, rerender, properties, propertyDetails, today);
  renderTenancyOverview(root, rerender, properties, propertyDetails, today);
  renderComplianceOverview(root, rerender, properties, complianceTypes, complianceCompletions, today);
}

/**
 * How a date reads: already gone, close enough to act on, or far enough away
 * to ignore. Used for renewal, tenancy-end and certificate dates alike so they
 * all mean the same thing at a glance.
 */
function dueClass(date, today) {
  if (!date) return '';
  if (date < today) return 'due-overdue';
  return date <= addMonths(today, 3) ? 'due-soon' : '';
}

/** A date cell that colours itself by how close it is, or an em dash. */
function dueCell(date, today, missing = '—') {
  if (!date) return el('td', {}, el('span', { class: 'unset' }, missing));
  const state = dueClass(date, today);
  return el(
    'td',
    { class: state },
    ukDate(date),
    state === 'due-overdue' ? el('span', { class: 'badge badge-overdue' }, 'Overdue') : null,
  );
}

/** A property name that drills into its page, for the secondary tables. */
function drillCell(property) {
  return el(
    'td',
    {},
    el(
      'button',
      { class: 'link property-drill', onclick: () => openProperty(property.id) },
      entityTag(property.name, slotClass(property)),
    ),
  );
}

/** Renewal dates and cover, across the portfolio. */
function renderInsuranceOverview(root, rerender, properties, details, today) {
  const rows = properties.map((property) => ({
    property,
    record: currentRecord(details, property.id, 'insurance'),
  }));
  const field = (row, key) => row.record?.data?.[key] ?? '';

  const sorted = sortRows(rows, insuranceSort, {
    name: (r) => r.property.name,
    provider: (r) => field(r, 'provider'),
    cover: (r) => field(r, 'coverLevel'),
    premium: (r) => Number(String(field(r, 'premium')).replace(/[£,\s]/g, '')) || null,
    renewal: (r) => field(r, 'renewalDate') || null,
  });
  const onSort = (key) => {
    toggleSort(insuranceSort, key, key === 'premium' ? 'desc' : 'asc');
    rerender();
  };
  const th = (label, key, options) => sortableTh(label, key, insuranceSort, onSort, options);
  const missing = rows.filter((r) => !r.record).length;

  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h3', {}, 'Insurance'),
      missing > 0
        ? el('span', { class: 'count' }, `${missing} propert${missing === 1 ? 'y has' : 'ies have'} none recorded`)
        : null,
    ),
    el(
      'table',
      { class: 'data' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          th('Property', 'name'),
          th('Provider', 'provider'),
          th('Cover', 'cover'),
          th('Premium', 'premium', { class: 'num' }),
          th('Renews', 'renewal'),
        ),
      ),
      el(
        'tbody',
        {},
        ...sorted.map((row) =>
          el(
            'tr',
            {},
            drillCell(row.property),
            el('td', {}, field(row, 'provider') || el('span', { class: 'unset' }, 'not recorded')),
            el('td', {}, field(row, 'coverLevel') || el('span', { class: 'unset' }, '—')),
            el(
              'td',
              { class: 'num' },
              field(row, 'premium') ? money(number(field(row, 'premium'))) : el('span', { class: 'unset' }, '—'),
            ),
            dueCell(field(row, 'renewalDate'), today),
          ),
        ),
      ),
    ),
  );
}

/** Who is in each property, on what terms. */
function renderTenancyOverview(root, rerender, properties, details, today) {
  const rows = properties.map((property) => ({
    property,
    record: currentRecord(details, property.id, 'tenancy'),
  }));
  const field = (row, key) => row.record?.data?.[key] ?? '';

  const sorted = sortRows(rows, tenancySort, {
    name: (r) => r.property.name,
    tenant: (r) => field(r, 'tenantName'),
    rent: (r) => Number(String(field(r, 'rentAmount')).replace(/[£,\s]/g, '')) || null,
    ends: (r) => field(r, 'endDate') || null,
    deposit: (r) => Number(String(field(r, 'depositAmount')).replace(/[£,\s]/g, '')) || null,
    agent: (r) => field(r, 'agent'),
  });
  const onSort = (key) => {
    toggleSort(tenancySort, key, key === 'rent' || key === 'deposit' ? 'desc' : 'asc');
    rerender();
  };
  const th = (label, key, options) => sortableTh(label, key, tenancySort, onSort, options);
  const vacant = rows.filter((r) => !r.record).length;

  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h3', {}, 'Tenancies'),
      vacant > 0
        ? el('span', { class: 'count' }, `${vacant} propert${vacant === 1 ? 'y has' : 'ies have'} none recorded`)
        : null,
    ),
    el(
      'table',
      { class: 'data' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          th('Property', 'name'),
          th('Tenant', 'tenant'),
          th('Rent', 'rent', { class: 'num' }),
          th('Deposit', 'deposit', { class: 'num' }),
          th('Ends', 'ends'),
          th('Agent', 'agent'),
        ),
      ),
      el(
        'tbody',
        {},
        ...sorted.map((row) =>
          el(
            'tr',
            {},
            drillCell(row.property),
            el('td', {}, field(row, 'tenantName') || el('span', { class: 'unset' }, 'none recorded')),
            el(
              'td',
              { class: 'num' },
              field(row, 'rentAmount')
                ? money(number(field(row, 'rentAmount')))
                : el('span', { class: 'unset' }, '—'),
            ),
            el(
              'td',
              { class: 'num' },
              field(row, 'depositAmount')
                ? money(number(field(row, 'depositAmount')))
                : el('span', { class: 'unset' }, '—'),
            ),
            dueCell(field(row, 'endDate'), today, 'no end date'),
            el('td', {}, field(row, 'agent') || el('span', { class: 'unset' }, '—')),
          ),
        ),
      ),
    ),
  );
}

/**
 * Certificates across the portfolio: properties down, compliance types across,
 * each cell the date that item is next due there. Reading a column answers
 * "which properties need a gas safety check", which is the question that
 * actually gets asked.
 */
function renderComplianceOverview(root, rerender, properties, types, completions, today) {
  root.append(el('div', { class: 'toolbar' }, el('h3', {}, 'Compliance')));

  if (types.length === 0) {
    root.append(
      el('div', { class: 'empty' }, 'No compliance types set up. ', el('a', { href: '#/config' }, 'Add some')),
    );
    return;
  }

  const rows = properties.map((property) => ({
    property,
    statuses: new Map(
      complianceStatus(types, completions, property.id, today).map((s) => [s.type.id, s]),
    ),
  }));

  const accessors = { name: (r) => r.property.name };
  for (const type of types) {
    // A never-recorded item sorts last, like any other blank.
    accessors[`type:${type.id}`] = (r) => r.statuses.get(type.id)?.nextDue ?? null;
  }
  const sorted = sortRows(rows, complianceOverviewSort, accessors);
  const onSort = (key) => {
    toggleSort(complianceOverviewSort, key, 'asc');
    rerender();
  };

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
          sortableTh('Property', 'name', complianceOverviewSort, onSort),
          ...types.map((type) =>
            sortableTh(type.name, `type:${type.id}`, complianceOverviewSort, onSort, {
              title: `${type.description || type.name} — every ${type.frequencyMonths} months`,
            }),
          ),
        ),
      ),
      el(
        'tbody',
        {},
        ...sorted.map((row) =>
          el(
            'tr',
            {},
            drillCell(row.property),
            ...types.map((type) => {
              const status = row.statuses.get(type.id);
              if (!status || status.neverRecorded) {
                return el('td', {}, el('span', { class: 'unset' }, 'never recorded'));
              }
              return dueCell(status.nextDue, today);
            }),
          ),
        ),
      ),
    ),
    el(
      'p',
      { class: 'hint' },
      'Each cell is when that certificate next falls due there, worked out from the last one logged ' +
        'plus its frequency. Log completions on the property’s own page.',
    ),
  );
}

/** Drills into one property, which becomes the tab's remembered place. */
function openProperty(propertyId) {
  lastViewed = propertyId;
  window.location.hash = `#/properties/${encodeURIComponent(propertyId)}`;
}

/**
 * Money in and out per month as stacked columns, by category. It sits inside
 * the monthly breakdown and reads the same date range as the table under it —
 * chart and figures answering the same question about the same months.
 *
 * @param {{month: string, label: string, byCategory: Map}[]} months already
 *   filtered to the chosen range, so the chart cannot disagree with the table
 */
function renderCashflow(root, months, categories) {
  if (months.length === 0) return;

  const buckets = months.map((m) => ({ key: m.month, label: m.label }));
  const groups = [
    ...categories.map((c) => ({ id: c.id, label: c.name, slot: slotClass(c) })),
    { id: null, label: 'Uncategorised', slot: 'slot-neutral' },
  ];

  const allSeries = groups
    .map((group) => ({
      key: group.id,
      label: group.label,
      slotClass: group.slot,
      values: months.map((month) => month.byCategory.get(group.id) ?? 0),
    }))
    .filter((s) => s.values.some((v) => v !== 0));

  // Past eight there is no ninth colourblind-safe hue, so the smallest fold
  // into one neutral "Other"; the breakdown table below still itemises them.
  const { series, folded } = capSeries(allSeries);

  root.append(
    el(
      'p',
      { class: 'hint' },
      'Money in stacks above the line, money out below it. Hover or focus a block for its figure.',
    ),
    legend(series),
    stackedColumns({ buckets, series }),
  );

  // Node.append stringifies null into a literal "null" on the page — el()
  // filters its children, but this is a direct append, so the branch has to
  // happen out here rather than as an argument to it.
  if (folded > 0) {
    root.append(
      el('p', { class: 'hint' }, `${folded} smaller categories are grouped as “Other” in the chart.`),
    );
  }
}

/**
 * This property's transactions, read-only. Editing happens on the Transactions
 * screen, which is one click away and already knows how to filter to this
 * property.
 */
function renderTransactionList(root, rerender, transactions, property) {
  const visible = filterTransactions(transactions, { propertyId: property.id, category: listFilter.category });

  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h3', {}, 'Transactions'),
      el('span', { class: 'count' }, `${visible.length} shown`),
      categoryFilter(listFilter.category, (value) => {
        listFilter.category = value;
        rerender();
      }),
      el('a', { class: 'link', href: '#/transactions' }, 'Edit on the Transactions tab'),
    ),
  );

  if (visible.length === 0) {
    root.append(el('div', { class: 'empty' }, 'No transactions match this selection.'));
    return;
  }

  root.append(
    transactionTable(visible, {
      readOnly: true,
      sort: listSort,
      onSort: (key) => {
        toggleSort(listSort, key, key === 'date' || key === 'amount' ? 'desc' : 'asc');
        rerender();
      },
    }),
  );
}

/**
 * One banner for everything wanting attention, sorted by date.
 *
 * Overdue items read differently from merely-upcoming ones and are listed
 * first regardless of date — "the gas certificate lapsed three weeks ago" is a
 * different kind of fact from "insurance renews in September", and the old
 * banner drew no distinction at all.
 */
function renderComingUp(root, { dated, compliance, lateStreams, today }) {
  const items = [
    ...lateStreams.map((stream) => ({
      label: `${stream.label} not received`,
      date: stream.nextExpected,
      overdue: true,
      since: addMonths(stream.lastDate, 1),
    })),
    ...compliance.map((item) => ({ ...item, since: item.date })),
    ...dated.map((item) => ({ ...item, overdue: false })),
  ];
  if (items.length === 0) return;

  const overdue = items.filter((i) => i.overdue).sort((a, b) => a.since.localeCompare(b.since));
  const soon = items.filter((i) => !i.overdue).sort((a, b) => a.date.localeCompare(b.date));

  root.append(
    el(
      'div',
      { class: `notice attention${overdue.length > 0 ? ' attention-overdue' : ''}` },
      overdue.length > 0
        ? el(
            'div',
            { class: 'attention-group' },
            el('strong', {}, 'Needs attention'),
            el(
              'ul',
              {},
              ...overdue.map((item) =>
                el(
                  'li',
                  {},
                  el('span', { class: 'badge badge-overdue' }, 'Overdue'),
                  ` ${item.label} — due ${ukDate(item.since)}, ${daysBetween(item.since, today)} days ago`,
                ),
              ),
            ),
          )
        : null,
      soon.length > 0
        ? el(
            'div',
            { class: 'attention-group' },
            el('strong', {}, 'Coming up'),
            el(
              'ul',
              {},
              ...soon.map((item) => el('li', {}, `${item.label} — ${ukDate(item.date)}`)),
            ),
          )
        : null,
    ),
  );
}

function daysBetween(from, to) {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86400000));
}

/**
 * The Summary tab's matrix, pivoted for one property: categories across the
 * top, one row per month. Answers "what did this property cost me in March,
 * and on what" without leaving the property page.
 *
 * Every month between the first and last transaction appears, including ones
 * with nothing in them — a gap in the rent is only visible if the empty month
 * is actually on screen.
 *
 * The Cashflow chart lives here too, above the table and reading the same date
 * range: it used to sit in its own section showing the full history, which
 * meant picking a tax year moved the figures and left the picture behind,
 * inviting you to compare two different periods side by side.
 */
function renderMonthlyBreakdown(root, shares, categories, rerender) {
  // The year shortcuts are derived from this property's own transactions, so
  // the list never offers a year this property has nothing in.
  const dated = shares.map((s) => ({ date: s.transaction.date }));
  const months = monthlyTotals(sharesInBreakdownRange(shares));

  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h3', {}, 'Monthly breakdown'),
      el('span', { class: 'count' }, `${months.length} month(s)`),
    ),
    el(
      'div',
      { class: 'filter-bar' },
      ...dateRangeControls({
        transactions: dated,
        from: breakdownRange.from,
        to: breakdownRange.to,
        onChange: ({ from, to }) => {
          breakdownRange.from = from;
          breakdownRange.to = to;
          rerender();
        },
      }),
    ),
    el('p', { class: 'hint' }, 'This range applies to both the chart and the table below.'),
  );

  // Chart first, then the figures behind it — the same months either way.
  renderCashflow(root, months, categories);

  if (months.length === 0) {
    root.append(
      el(
        'div',
        { class: 'empty' },
        shares.length === 0
          ? 'Nothing categorised against this property yet. '
          : 'No transactions for this property in that date range. ',
        el('a', { href: '#/transactions' }, 'Review transactions'),
      ),
    );
    return;
  }

  // Only show categories this property actually uses — a landlord with no
  // management fees doesn't need an empty column following them down the page.
  const used = categories.filter((c) => months.some((m) => (m.byCategory.get(c.id) ?? 0) !== 0));
  const columns = used.length > 0 ? used : categories;

  const cell = (month, categoryId) => month.byCategory.get(categoryId) ?? 0;
  const columnTotal = (categoryId) => sumAllocations(months.map((m) => ({ amount: cell(m, categoryId) })));
  const grandTotal = sumAllocations(months.map((m) => ({ amount: m.net })));

  const accessors = { month: (m) => m.month, net: (m) => m.net };
  for (const c of columns) accessors[`cat:${c.id}`] = (m) => cell(m, c.id);
  const rows = sortRows(months, matrixSort, accessors);

  const onSort = (key) => {
    toggleSort(matrixSort, key, key === 'month' ? 'asc' : 'desc');
    rerender();
  };
  const mTh = (label, key, options) => sortableTh(label, key, matrixSort, onSort, options);

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
          mTh('Month', 'month'),
          ...columns.map((c) =>
            sortableTh(c.name, `cat:${c.id}`, matrixSort, onSort, {
              class: 'num',
              title: c.description || `Sort by ${c.name}`,
            }),
          ),
          mTh('Net', 'net', { class: 'num' }),
        ),
      ),
      el(
        'tbody',
        {},
        ...rows.map((month) =>
          el(
            'tr',
            {},
            el('td', {}, month.label),
            ...columns.map((c) => {
              const value = cell(month, c.id);
              return el(
                'td',
                { class: `num ${value < 0 ? 'out' : value > 0 ? 'in' : 'zero'}` },
                value === 0 ? '—' : money(value),
              );
            }),
            el('td', { class: `num strong ${month.net < 0 ? 'out' : 'in'}` }, money(month.net)),
          ),
        ),
      ),
      el(
        'tfoot',
        {},
        el(
          'tr',
          {},
          el('th', {}, `${months.length} month(s)`),
          ...columns.map((c) => el('th', { class: 'num' }, money(columnTotal(c.id)))),
          el('th', { class: 'num strong' }, money(grandTotal)),
        ),
      ),
    ),
  );
}

/**
 * The recurring payments this property expects, straight from the same
 * detection the Accounts tab uses — scoped here to one property.
 */
function renderRecurring(root, streams, today, options = {}) {
  root.append(
    el('h3', {}, 'Recurring payments'),
    el(
      'p',
      { class: 'hint' },
      'Worked out from the statements you have imported. A payment is flagged when it is late; one ' +
        'that has been gone for months, or that predates the current tenancy, is shown as stopped ' +
        'rather than chased forever.',
    ),
  );

  if (streams.length === 0) {
    root.append(
      el('div', { class: 'empty' }, 'No repeating payments spotted yet — import another month to see them.'),
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
          el('th', {}, 'Payment'),
          el('th', { class: 'num' }, 'Typical'),
          el('th', {}, 'Usually'),
          el('th', {}, 'Last received'),
          el('th', {}, 'Next expected'),
        ),
      ),
      el(
        'tbody',
        {},
        ...streams.map((stream) => {
          const state = streamState(stream, today, options);
          const late = state === 'overdue';
          const ended = state === 'ended';
          return el(
            'tr',
            { class: late ? 'row-overdue' : ended ? 'row-ended' : '' },
            el(
              'td',
              { class: 'details' },
              stream.label,
              late
                ? el(
                    'div',
                    { class: 'overdue-note' },
                    el('span', { class: 'badge badge-overdue' }, 'Overdue'),
                    ` nothing since ${ukDate(stream.lastDate)}`,
                  )
                : null,
              ended
                ? el(
                    'div',
                    { class: 'overdue-note' },
                    el('span', { class: 'badge' }, 'Stopped'),
                    ` last paid ${ukDate(stream.lastDate)}`,
                  )
                : null,
            ),
            el(
              'td',
              { class: `num ${stream.typicalAmount < 0 ? 'out' : 'in'}` },
              money(stream.typicalAmount),
            ),
            el('td', {}, `${stream.direction === 'in' ? 'in' : 'out'} on the ${ordinal(stream.typicalDay)}`),
            el('td', {}, ukDate(stream.lastDate)),
            // A stopped payment has no next date — forecasting one for a tenant
            // who has moved out is exactly the error this replaced.
            el('td', {}, ended ? el('span', { class: 'unset' }, '—') : ukDate(stream.nextExpected)),
          );
        }),
      ),
    ),
  );
}

function ordinal(day) {
  const suffix =
    day % 10 === 1 && day !== 11
      ? 'st'
      : day % 10 === 2 && day !== 12
        ? 'nd'
        : day % 10 === 3 && day !== 13
          ? 'rd'
          : 'th';
  return `${day}${suffix}`;
}

/**
 * Certificates and inspections. Unlike the recurring payments, nothing here can
 * be inferred from the bank — each row is only as current as the last
 * completion logged against it.
 *
 * Takes the statuses rather than working them out: the panel above the table
 * already needed them for its summary, and two calculations of "is this
 * overdue" that could drift apart is exactly the bug worth not having.
 */
function renderCompliance(root, property, statuses, today, rerender) {
  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h3', {}, 'Compliance'),
      el('a', { class: 'link', href: '#/config' }, 'Edit types'),
    ),
    el(
      'p',
      { class: 'hint' },
      'These can’t be read from a bank statement, so log each one when it is done. The payment for ' +
        'it is categorised in Transactions as usual — this is the schedule, not the cost.',
    ),
  );

  if (statuses.length === 0) {
    root.append(
      el('div', { class: 'empty' }, 'No compliance types set up. ', el('a', { href: '#/config' }, 'Add some')),
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
          el('th', {}, 'Item'),
          el('th', { class: 'num' }, 'Every'),
          el('th', {}, 'Last done'),
          el('th', {}, 'Next due'),
          el('th', {}, ''),
        ),
      ),
      el(
        'tbody',
        {},
        ...statuses.map((status) =>
          el(
            'tr',
            { class: status.overdue ? 'row-overdue' : '' },
            el(
              'td',
              { class: 'details', title: status.type.description },
              status.type.name,
              status.history.length > 1
                ? el('div', { class: 'share' }, `${status.history.length} logged`)
                : null,
            ),
            el('td', { class: 'num' }, `${status.type.frequencyMonths} mo`),
            el(
              'td',
              {},
              status.lastCompletedDate
                ? ukDate(status.lastCompletedDate)
                : el('span', { class: 'unset' }, 'never recorded'),
            ),
            el(
              'td',
              {},
              status.nextDue === null
                ? el('span', { class: 'unset' }, '—')
                : status.overdue
                  ? el(
                      'span',
                      {},
                      el('span', { class: 'badge badge-overdue' }, 'Overdue'),
                      ` since ${ukDate(status.nextDue)}`,
                    )
                  : ukDate(status.nextDue),
            ),
            el(
              'td',
              { class: 'actions' },
              el(
                'button',
                {
                  class: 'link',
                  onclick: () => logCompletion(property, status.type, today, rerender),
                },
                'Log completion',
              ),
              status.lastCompletion
                ? el(
                    'button',
                    {
                      class: 'link danger',
                      title: 'Remove the most recent entry, if it was logged by mistake',
                      onclick: () => {
                        if (!confirm(`Remove the ${ukDate(status.lastCompletedDate)} entry for ${status.type.name}?`)) {
                          return;
                        }
                        void deleteComplianceCompletion(status.lastCompletion.id).then(rerender);
                      },
                    },
                    'Undo last',
                  )
                : null,
            ),
          ),
        ),
      ),
    ),
  );
}

/** Logs an inspection: when it was done, plus an optional certificate number. */
function logCompletion(property, type, today, rerender) {
  const completedDate = prompt(`When was the ${type.name} completed?\n\nDate (YYYY-MM-DD):`, today);
  if (completedDate === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(completedDate.trim())) {
    toast('Enter the date as YYYY-MM-DD.', 'error');
    return;
  }
  const reference = prompt('Certificate or reference number (optional):', '') ?? '';
  const notes = prompt('Notes (optional):', '') ?? '';

  void saveComplianceCompletion({
    propertyId: property.id,
    complianceTypeId: type.id,
    completedDate: completedDate.trim(),
    reference: reference.trim(),
    notes: notes.trim(),
  }).then(() => {
    toast(`${type.name} logged.`);
    rerender();
  });
}

function number(value) {
  const n = Number(String(value ?? '').replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function renderSection(section, property, records, rerender) {
  const current = currentRecord(records, property.id, section.key);
  const history = historyFor(records, property.id, section.key);
  const isEditing = editing === section.key;

  const body = el('div', { class: 'section-body' });

  if (isEditing) {
    body.append(sectionForm(section, property, current, rerender));
  } else if (current) {
    body.append(
      el(
        'dl',
        { class: 'detail-grid' },
        ...section.fields
          .filter((field) => String(current.data[field.key] ?? '').trim() !== '')
          .flatMap((field) => [
            el('dt', {}, field.label),
            el('dd', {}, formatValue(field, current.data[field.key])),
          ]),
      ),
      el(
        'p',
        { class: 'hint' },
        `In effect from ${ukDate(current.effectiveFrom)}.`,
      ),
    );
  } else {
    body.append(el('p', { class: 'hint' }, 'Nothing recorded yet.'));
  }

  if (history.length > 0) {
    body.append(
      el(
        'details',
        { class: 'chart-table' },
        el('summary', {}, `Previous versions (${history.length})`),
        ...history.map((record) =>
          el(
            'div',
            { class: 'past-record' },
            el(
              'div',
              { class: 'past-head' },
              el('span', { class: 'badge badge-warn' }, 'Expired'),
              ` ${ukDate(record.effectiveFrom)} – ${ukDate(record.supersededOn)}`,
              el(
                'button',
                {
                  class: 'link danger',
                  onclick: () => {
                    if (!confirm('Delete this historical record? It cannot be recovered.')) return;
                    void deletePropertyDetail(record.id).then(rerender);
                  },
                },
                'Delete',
              ),
            ),
            el(
              'dl',
              { class: 'detail-grid' },
              ...section.fields
                .filter((field) => String(record.data[field.key] ?? '').trim() !== '')
                .flatMap((field) => [
                  el('dt', {}, field.label),
                  el('dd', {}, formatValue(field, record.data[field.key])),
                ]),
            ),
          ),
        ),
      ),
    );
  }

  return el(
    'section',
    { class: 'detail-section' },
    el(
      'div',
      { class: 'section-head' },
      el('h3', {}, section.label),
      current && !isEditing ? el('span', { class: 'count' }, section.summary(current.data)) : null,
      el(
        'button',
        {
          class: 'link',
          onclick: () => {
            editing = isEditing ? null : section.key;
            rerender();
          },
        },
        isEditing ? 'Cancel' : current ? 'Change' : 'Add',
      ),
    ),
    body,
  );
}

/**
 * The edit form. Saving writes a *new* dated record rather than overwriting,
 * so the effective-from date is a required part of the form, not an option.
 */
function sectionForm(section, property, current, rerender) {
  const today = new Date().toISOString().slice(0, 10);
  const inputs = new Map();

  for (const field of section.fields) {
    const value = current?.data?.[field.key] ?? '';
    let input;
    if (field.type === 'textarea') {
      input = el('textarea', { rows: '2', class: 'wide' });
      input.value = value;
    } else if (field.type === 'select') {
      input = el(
        'select',
        {},
        el('option', { value: '' }, '—'),
        ...field.options.map((o) => el('option', { value: o, selected: o === value }, o)),
      );
    } else {
      input = el('input', {
        type: inputType(field.type),
        class: field.type === 'textarea' ? 'wide' : '',
        step: field.type === 'money' ? '0.01' : field.type === 'percent' ? '0.01' : undefined,
        min: field.type === 'day' ? '1' : undefined,
        max: field.type === 'day' ? '31' : undefined,
        placeholder: field.type === 'url' ? 'https://…' : '',
        value,
      });
    }
    inputs.set(field.key, input);
  }

  const effectiveFrom = el('input', { type: 'date', required: true, value: today });

  return el(
    'form',
    {
      class: 'detail-form',
      onsubmit: (event) => {
        event.preventDefault();
        if (!effectiveFrom.value) {
          toast('Choose the date this takes effect.', 'error');
          return;
        }
        if (current && effectiveFrom.value < current.effectiveFrom) {
          toast(
            `The current record starts ${ukDate(current.effectiveFrom)} — a replacement cannot start before it.`,
            'error',
          );
          return;
        }
        const data = {};
        for (const [key, input] of inputs) data[key] = input.value.trim();
        if (Object.values(data).every((v) => v === '')) {
          toast('Fill in at least one field.', 'error');
          return;
        }
        void savePropertyDetail({
          propertyId: property.id,
          section: section.key,
          data,
          effectiveFrom: effectiveFrom.value,
        }).then(() => {
          editing = null;
          toast(current ? `${section.label} updated — the old version is kept.` : `${section.label} saved.`);
          rerender();
        });
      },
    },
    el(
      'div',
      { class: 'detail-fields' },
      ...section.fields.map((field) =>
        el(
          'label',
          { class: field.type === 'textarea' ? 'grow' : '' },
          field.label,
          inputs.get(field.key),
        ),
      ),
    ),
    el(
      'div',
      { class: 'effective-row' },
      el('label', { class: 'inline' }, 'In effect from ', effectiveFrom),
      current
        ? el(
            'span',
            { class: 'hint' },
            `The version starting ${ukDate(current.effectiveFrom)} will be kept as history.`,
          )
        : null,
      el('button', { class: 'primary', type: 'submit' }, 'Save'),
    ),
  );
}

function inputType(type) {
  if (type === 'date') return 'date';
  if (type === 'money' || type === 'percent' || type === 'day') return 'number';
  if (type === 'url') return 'url';
  return 'text';
}

function formatValue(field, value) {
  if (field.type === 'money') return money(number(value));
  if (field.type === 'percent') return `${value}%`;
  if (field.type === 'date') return ukDate(value);
  if (field.type === 'day') return `day ${value} of the month`;
  if (field.type === 'url') {
    return el('a', { href: value, target: '_blank', rel: 'noopener noreferrer' }, value);
  }
  return String(value);
}
