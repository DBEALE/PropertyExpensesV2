/**
 * One property in full: its address, insurance, mortgage, valuation and
 * tenancy — each kept as a dated record, with everything it replaced still
 * readable underneath.
 */
import { accountSummary, monthlyTotals, paymentStreams, sharesFor, streamState } from '../accounts.js';
import { sumAllocations } from '../allocation.js';
import { attentionFor, tenancyStart } from '../attention.js';
import { capSeries, legend, stackedColumns } from '../charts.js';
import { complianceStatus } from '../compliance.js';
import { DUE_SOON_DAYS, addDays, addMonths, taxYearRange } from '../dates.js';
import { currentTaxYearRange, taxYearLabel, taxYearOf } from '../date-presets.js';
import { el, entityMark, entityTag, money, sortableTh, toast, ukDate } from '../dom.js';
import { highlight } from '../focus.js';
import { sortRows, toggleSort } from '../sort.js';
import { ANY, filterTransactions } from '../transaction-filter.js';
import { dateRangeControls } from './date-filter.js';
import { categoryFilter, transactionTable } from './transaction-table.js';
import { slotClass } from '../palette.js';
import { categoryMark, propertyMark } from '../icons.js';
import {
  SECTIONS,
  currentRecord,
  equity,
  historyFor,
  isTrue,
  loanToValue,
} from '../property-details.js';
import {
  deleteComplianceCompletion,
  deletePropertyDetail,
  getState,
  saveComplianceCompletion,
  savePropertyDetail,
  setComplianceExempt,
} from '../store.js';

/** Which section is open for editing, so a re-render doesn't close it. */
let editing = null;
/** Oldest month first, so a year of figures reads chronologically. */
const matrixSort = { key: 'month', dir: 'asc' };
/** State for the read-only transaction list panel. */
const listSort = { key: 'date', dir: 'desc' };
const listFilter = { category: ANY };
/**
 * Date ranges, kept across re-renders. Both open on the tax year in progress
 * rather than on everything ever imported — see `currentTaxYearRange`.
 */
const breakdownRange = { ...currentTaxYearRange() };
const listRange = { ...currentTaxYearRange() };
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
 * rather than of the portfolio. It leads, because "what is this place" comes
 * before "what did it cost".
 */
export const PANELS = [
  { key: 'details', label: 'Overview' },
  { key: 'breakdown', label: 'Monthly breakdown' },
  { key: 'recurring', label: 'Recurring payments' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'transactions', label: 'Transactions' },
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

export function renderProperty(root, rerender, propertyId) {
  const state = getState();
  const {
    properties,
    propertyDetails,
    complianceTypes,
    complianceCompletions,
    complianceExemptions,
    transactions,
  } = state;

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
  const attention = attentionFor(state, propertyId, today, 90);

  const openDetails = (section = null) => {
    openPanel = 'details';
    pendingSection = section;
    rerender();
  };
  renderComingUp(root, attention, today, () => openDetails(), openDetails);

  const shares = sharesFor(transactions, propertyId);
  const { categories } = getState();
  const statuses = complianceStatus(
    complianceTypes,
    complianceCompletions,
    property.id,
    today,
    complianceExemptions,
  );
  const ownTransactions = filterTransactions(transactions, { propertyId: property.id });

  const summaries = panelSummaries({
    shares,
    categories,
    // Each summary describes what its own panel would show, filters and all,
    // so opening one never contradicts the line that made you open it.
    range: breakdownRange,
    listRange,
    streams,
    lateStreams: attention.lateStreams,
    statuses,
    transactions: ownTransactions,
    property,
    propertyDetails,
    today,
    streamOptions,
  });

  const body = el('div', { class: 'panel-body', id: 'panel-body', role: 'tabpanel' });
  root.append(renderPanelChooser(summaries, panelAttention(attention), rerender), body);

  if (openPanel === 'breakdown') renderMonthlyBreakdown(body, shares, categories, rerender);
  else if (openPanel === 'recurring') renderRecurring(body, streams, today, streamOptions);
  else if (openPanel === 'compliance') renderCompliance(body, property, statuses, today, rerender);
  else if (openPanel === 'transactions') renderTransactionList(body, rerender, transactions, property);
  else renderDetailSections(body, property, propertyDetails, rerender);
}

/**
 * The five dated record sections, tiled rather than stacked.
 *
 * Run down the page one per row they were five screens of mostly-empty space;
 * side by side they fit on one, and "what do I know about this property" is
 * answerable without scrolling. A section being edited takes the full width,
 * because a form squeezed into a third of the row is worse than a row that
 * momentarily reflows.
 */
function renderDetailSections(root, property, propertyDetails, rerender) {
  const tiles = el(
    'div',
    { class: 'detail-tiles' },
    ...SECTIONS.map((section) => renderSection(section, property, propertyDetails, rerender)),
  );
  root.append(tiles);

  // Arrived here from the Insurance or Tenancy table: say which of the five
  // tiles the question was about, rather than leaving it to be spotted.
  if (pendingSection) {
    const wanted = pendingSection;
    pendingSection = null;
    highlight(tiles.querySelector(`[data-section="${wanted}"]`));
  }
}

/**
 * A panel's title, with a count of what is outstanding behind it.
 *
 * The badge sits at the far end rather than beside the words, so the counts
 * line up down the right of the strip and can be read as a column instead of
 * hunted for at five different x positions.
 */
function panelHead(panel, flag) {
  return el(
    'span',
    { class: 'panel-head' },
    el('span', { class: 'panel-title' }, panel.label),
    flag
      ? el(
          'span',
          {
            class: `badge badge-${flag.tone}`,
            // The names themselves on hover; the number alone says how many
            // but never which.
            title: flag.title,
            'aria-label': `${flag.count} needing attention`,
          },
          String(flag.count),
        )
      : null,
  );
}

/**
 * The row of panels, and the click that swaps which one is open.
 *
 * Each is a real button with `role="tab"`: arrow keys move between them and the
 * open one is the only one in the tab order, which is what a keyboard user
 * expects of a strip of choices where exactly one applies.
 */
function renderPanelChooser(summaries, flags, rerender) {
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
      panelHead(panel, flags[panel.key]),
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
 * Which panel each outstanding thing belongs to.
 *
 * The strip already says what is *inside* each panel; this says which of them
 * wants something doing, so a lapsed certificate is visible without opening
 * Compliance to find it. Every dated record — insurance, mortgage, tenancy —
 * lives behind Overview, which is why those land there rather than on a panel
 * of their own.
 *
 * Counted exactly as the tab badge counts, so the number on a panel, the
 * number on the tab and the list in the banner are one tally shown three
 * times. Missing sections are left out here for the same reason they are left
 * out there: a prompt with no deadline should not put a number on anything.
 *
 * @param {ReturnType<import('../attention.js').attentionFor>} attention
 * @returns {Record<string, {count: number, tone: string, title: string}>}
 */
function panelAttention(attention) {
  const bucket = (label, overdue, soon, gaps) => {
    const count = overdue.length + soon.length + gaps.length;
    if (count === 0) return null;
    return {
      count,
      // The colour of the worst thing in there, matching the banner below.
      tone: overdue.length > 0 ? 'overdue' : soon.length > 0 ? 'soon' : 'gap',
      title: [...overdue, ...soon, ...gaps].map((item) => item.label).join('\n'),
      label,
    };
  };

  return {
    details: bucket('Overview', attention.overdueDates, attention.soonDates, attention.gaps),
    recurring: bucket('Recurring payments', attention.lateStreams.map(streamItem), [], []),
    compliance: bucket('Compliance', attention.overdueCompliance, attention.soonCompliance, []),
  };
}

/** A late payment in the shape the tooltip above expects. */
function streamItem(stream) {
  return { label: `${stream.label} not received` };
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
function breakdownSummary({ shares, categories, range }) {
  const months = monthlyTotals(sharesInRange(shares, range));
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

/**
 * The shares inside a date range. Passed the range rather than reading the
 * module's own, so the summary and the table can be handed the same one and a
 * test can hand it a different one.
 */
function sharesInRange(shares, range = {}) {
  return shares.filter(
    (s) => (!range.from || s.transaction.date >= range.from) && (!range.to || s.transaction.date <= range.to),
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

  // An exempt certificate is not tracked, not late and not a gap — it has been
  // answered, so it drops out of every count except its own.
  const tracked = statuses.filter((s) => !s.exempt);
  const exempt = statuses.length - tracked.length;
  if (tracked.length === 0) return `None apply to this property · ${exempt} marked not applicable`;

  const overdue = tracked.filter((s) => s.overdue).length;
  const soon = tracked.filter((s) => s.dueSoon).length;
  const never = tracked.filter((s) => s.neverRecorded).length;
  const next = tracked
    .filter((s) => !s.overdue && !s.dueSoon && s.nextDue !== null)
    .map((s) => s.nextDue)
    .sort()[0];

  return clauses(
    `${tracked.length} certificate${tracked.length === 1 ? '' : 's'} tracked`,
    overdue > 0 ? `${overdue} overdue` : null,
    soon > 0 ? `${soon} due within ${DUE_SOON_DAYS} days` : null,
    never > 0 ? `${never} never logged` : null,
    overdue === 0 && soon === 0 && next ? `next due ${ukDate(next)}` : null,
    exempt > 0 ? `${exempt} not applicable` : null,
  );
}

/**
 * Counts what the panel would list, which is the range it is filtered to — and
 * says how much is being left out, so a tax-year default never looks like a
 * property with fewer transactions than it has.
 */
function transactionsSummary({ transactions, listRange }) {
  if (transactions.length === 0) return 'Nothing assigned to this property yet';

  const inRange = transactions.filter(
    (t) => (!listRange?.from || t.date >= listRange.from) && (!listRange?.to || t.date <= listRange.to),
  );
  if (inRange.length === 0) {
    return `None in the selected range · ${transactions.length} in total`;
  }

  const latest = inRange.map((t) => t.date).sort().at(-1);
  return clauses(
    `${inRange.length} transaction${inRange.length === 1 ? '' : 's'}`,
    inRange.length < transactions.length ? `of ${transactions.length} in total` : null,
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
  const state = getState();
  const { properties, propertyDetails, transactions } = state;
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
    // The same tally the tab badge and the property banner use, so the three
    // can never disagree about how much this property wants doing.
    const attention = attentionFor(state, property.id, today, 90);
    // One list of everything approaching, so "next due" is the true next thing.
    const upcoming = [...attention.soon, ...attention.upcoming].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const outright = isTrue(mortgage?.data?.ownedOutright);

    return {
      property,
      value: valuation ? number(valuation.data.value) : null,
      // Owned outright is a debt of zero, which is a figure; an em dash here
      // would read as "not entered" and quietly drop out of the portfolio total.
      debt: outright ? 0 : mortgage ? number(mortgage.data.amount) : null,
      ltv: loanToValue(mortgage, valuation),
      equity: equity(mortgage, valuation),
      net: accountSummary(shares.filter(inTaxYear)).net,
      attention: attention.count,
      overdueStreams: attention.lateStreams,
      overdue: attention.overdue,
      soon: attention.soon,
      gaps: attention.gaps,
      soonCount: attention.soonCount,
      next: upcoming[0] ?? null,
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
    const anyOverdue = needingAttention.some((r) => r.overdue.length > 0);
    root.append(
      el(
        'div',
        { class: `notice attention ${anyOverdue ? 'attention-overdue' : 'attention-soon'}` },
        el(
          'div',
          { class: 'attention-group' },
          el('strong', {}, 'Needs attention'),
          el(
            'ul',
            {},
            ...needingAttention.map((row) => {
              // The badge takes the colour of the worst thing on the row, and
              // the text names the things themselves. It used to say
              // "compliance overdue" for anything that was not a late payment,
              // which became a lie the moment insurance could lapse too.
              const reasons = [
                ...row.overdue.map((item) => item.label),
                ...row.soon.map((item) => `${item.label} within ${DUE_SOON_DAYS} days`),
                ...row.gaps.map((gap) => gap.label),
              ];
              const worst =
                row.overdue[0] ?? row.soon[0] ?? (row.gaps[0] && { kind: row.gaps[0].section });
              const tone = row.overdue.length > 0 ? 'overdue' : row.soon.length > 0 ? 'soon' : 'gap';

              return el(
                'li',
                {},
                el('span', { class: `badge badge-${tone}` }, String(row.attention)),
                ' ',
                el(
                  'button',
                  { class: 'link', onclick: () => openProperty(row.property.id, panelFor(worst)) },
                  row.property.name,
                ),
                ` — ${reasons.join(', ')}`,
              );
            }),
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
                  // The top table is about the property as a whole, so it lands
                  // on the Overview panel.
                  onclick: () => openProperty(row.property.id, { panel: 'details' }),
                },
                entityTag(row.property.name, slotClass(row.property), undefined, propertyMark(row.property)),
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
                : el(
                    'span',
                    {
                      // The colour of the worst thing on the row: red for
                      // something already past, amber for a warning, grey for
                      // records that merely want filling in.
                      class: `badge badge-${
                        row.overdue.length > 0 ? 'overdue' : row.soon.length > 0 ? 'soon' : 'gap'
                      }`,
                      title: [...row.overdue, ...row.soon, ...row.gaps].map((i) => i.label).join('\n'),
                    },
                    String(row.attention),
                  ),
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
  renderComplianceOverview(root, rerender, properties, state, today);
}

/**
 * How a date reads: already gone, close enough to act on, or far enough away
 * to ignore. Used for renewal, tenancy-end and certificate dates alike so they
 * all mean the same thing at a glance.
 *
 * The tint runs to three months, but only the DUE_SOON_DAYS window earns a
 * badge — the same boundary the attention banner and the tab badge use, so
 * "due soon" means one thing everywhere in the app.
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
  const badge =
    state === 'due-overdue'
      ? el('span', { class: 'badge badge-overdue' }, 'Overdue')
      : date <= addDays(today, DUE_SOON_DAYS)
        ? el('span', { class: 'badge badge-soon' }, 'Due soon')
        : null;
  return el('td', { class: state }, ukDate(date), badge);
}

/**
 * Where to land someone who clicked a property because something is wrong with
 * it: the panel that holds the thing itself.
 *
 * A late payment is a Recurring payments question and a lapsed certificate a
 * Compliance one; anything coming from a dated record — insurance cover run
 * out, a tenancy ending — lives in the Overview panel, so that is where it
 * goes, with the tile scrolled to.
 *
 * @param {{kind: string}|undefined} item the worst thing on that property
 */
function panelFor(item) {
  if (!item) return { panel: 'details' };
  if (item.kind === 'payment') return { panel: 'recurring' };
  if (item.kind === 'compliance') return { panel: 'compliance' };
  return { panel: 'details', section: item.kind };
}

/**
 * A property name that drills into its page, for the secondary tables.
 *
 * Each table passes the panel it is about, so clicking a row in the Tenancy
 * table lands on that property's tenancy rather than wherever you last were.
 *
 * @param {{panel?: string, section?: string}} [target]
 */
function drillCell(property, target = {}) {
  return el(
    'td',
    {},
    el(
      'button',
      {
        class: 'link property-drill',
        title: `Open ${property.name}`,
        onclick: () => openProperty(property.id, target),
      },
      entityTag(property.name, slotClass(property), undefined, propertyMark(property)),
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
            drillCell(row.property, { panel: 'details', section: 'insurance' }),
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
            drillCell(row.property, { panel: 'details', section: 'tenancy' }),
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
function renderComplianceOverview(root, rerender, properties, state, today) {
  const { complianceTypes: types, complianceCompletions: completions, complianceExemptions: exemptions } = state;
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
      complianceStatus(types, completions, property.id, today, exemptions).map((s) => [s.type.id, s]),
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
            drillCell(row.property, { panel: 'compliance' }),
            ...types.map((type) => {
              const status = row.statuses.get(type.id);
              // Not applicable outranks never recorded: the question has been
              // answered, so the column should not read as a gap here either.
              if (status?.exempt) return el('td', {}, el('span', { class: 'badge' }, 'N/A'));
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

/**
 * Drills into one property, landing on the panel that holds what you clicked.
 *
 * Clicking a property in the Tenancy table and arriving on whichever panel you
 * happened to leave open last time is a small betrayal: you asked about that
 * property's *tenancy*. So each table names the panel it is about, and the two
 * that live inside the Overview panel — insurance and tenancy — also name the
 * record section, which is then scrolled to and flashed.
 *
 * @param {string} propertyId
 * @param {{panel?: string, section?: string}} [target]
 */
function openProperty(propertyId, target = {}) {
  lastViewed = propertyId;
  if (target.panel && PANELS.some((p) => p.key === target.panel)) openPanel = target.panel;
  pendingSection = target.section ?? null;
  window.location.hash = `#/properties/${encodeURIComponent(propertyId)}`;
}

/**
 * A record section to scroll to and flash once the Overview panel has drawn.
 * One-shot, like the focus hand-off between screens: coming back to the page
 * later should not re-flash it.
 */
let pendingSection = null;

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
      'Money in stacks above the line, money out below it, and the dark line is what each month ' +
        'actually left you with. Hover or focus a block for its figure.',
    ),
    legend(series),
    stackedColumns({ buckets, series, netLabel: 'Net' }),
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
  // The year shortcuts come from this property's own transactions, so the list
  // never offers a year this property has nothing in.
  const own = filterTransactions(transactions, { propertyId: property.id });
  const visible = filterTransactions(own, {
    category: listFilter.category,
    from: listRange.from,
    to: listRange.to,
  });

  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h3', {}, 'Transactions'),
      el('span', { class: 'count' }, `${visible.length} of ${own.length} shown`),
      categoryFilter(listFilter.category, (value) => {
        listFilter.category = value;
        rerender();
      }),
      el('a', { class: 'link', href: '#/transactions' }, 'Edit on the Transactions tab'),
    ),
    el(
      'div',
      { class: 'filter-bar' },
      ...dateRangeControls({
        transactions: own,
        from: listRange.from,
        to: listRange.to,
        onChange: ({ from, to }) => {
          listRange.from = from;
          listRange.to = to;
          rerender();
        },
      }),
    ),
  );

  if (visible.length === 0) {
    root.append(el('div', { class: 'empty' }, 'No transactions match this selection.'));
    return;
  }

  root.append(
    transactionTable(visible, {
      readOnly: true,
      // This property's share of a split, not the whole transaction: a £900
      // roof divided three ways cost this property £300, and the Amount column
      // here should be a figure that reconciles with the rest of its page.
      shareOf: property.id,
      sort: listSort,
      onSort: (key) => {
        toggleSort(listSort, key, key === 'date' || key === 'amount' ? 'desc' : 'asc');
        rerender();
      },
    }),
  );
}

/**
 * One banner for everything wanting attention, in five grades.
 *
 * Each grade is a different kind of fact and they are never mixed: "the gas
 * certificate lapsed three weeks ago" is not the same as "it runs out in three
 * weeks", which is not the same as "insurance renews in September", which is
 * not the same as "your valuation is two years old", which is not the same as
 * "you have never told me who the tenant is". The banner used to draw only the
 * first two distinctions, so a certificate due in a fortnight sat in the same
 * list as one due in three months.
 *
 * @param {ReturnType<import('../attention.js').attentionFor>} attention
 * @param {() => void} openDetails takes the reader to the records to fill in
 * @param {(section: string) => void} openSection takes them to one of them
 */
function renderComingUp(root, attention, today, openDetails, openSection) {
  // Merged and sorted in attention.js, so this list and the badge on the tab
  // are the same list counted twice rather than two lists built twice.
  const { overdue, soon, gaps, missing } = attention;
  const upcoming = [...attention.upcoming].sort((a, b) => a.date.localeCompare(b.date));

  if (overdue.length + soon.length + gaps.length + upcoming.length + missing.length === 0) return;

  const group = (heading, ...children) =>
    el('div', { class: 'attention-group' }, el('strong', {}, heading), ...children);

  root.append(
    el(
      'div',
      {
        class:
          `notice attention${overdue.length > 0 ? ' attention-overdue' : ''}` +
          `${overdue.length === 0 && soon.length > 0 ? ' attention-soon' : ''}`,
      },
      overdue.length > 0
        ? group(
            'Needs attention',
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
        ? group(
            `Due within ${DUE_SOON_DAYS} days`,
            el(
              'ul',
              {},
              ...soon.map((item) =>
                el(
                  'li',
                  {},
                  el('span', { class: 'badge badge-soon' }, 'Due soon'),
                  ` ${item.label} — ${ukDate(item.date)}, in ${daysBetween(today, item.date)} days`,
                ),
              ),
            ),
          )
        : null,
      // Records you have kept that do not say enough. Counted like a warning,
      // because each one is cleared by entering a figure — and because a check
      // only ever fires on a record you chose to keep in the first place.
      gaps.length > 0
        ? group(
            'Records to check',
            el(
              'ul',
              {},
              ...gaps.map((gap) =>
                el(
                  'li',
                  {},
                  el('span', { class: 'badge badge-gap' }, 'Check'),
                  ' ',
                  el(
                    'button',
                    { class: 'link', onclick: () => openSection(gap.section) },
                    gap.label,
                  ),
                ),
              ),
            ),
          )
        : null,
      upcoming.length > 0
        ? group(
            'Coming up',
            el('ul', {}, ...upcoming.map((item) => el('li', {}, `${item.label} — ${ukDate(item.date)}`))),
          )
        : null,
      // A prompt rather than a warning, and last: nothing here has a deadline,
      // it is simply the app admitting what it has not been told.
      missing.length > 0
        ? group(
            'Still to add',
            el(
              'p',
              { class: 'hint' },
              `Nothing recorded for ${listing(missing.map((m) => m.label))}. `,
              el('button', { class: 'link', onclick: openDetails }, 'Add it on the Overview panel'),
              '.',
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
  const months = monthlyTotals(sharesInRange(shares, breakdownRange));

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
              // Same mark as the chart legend directly above it, so a column
              // and its band of colour are recognisably the same category.
              mark: entityMark(slotClass(c), categoryMark(c)),
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
          el('th', { title: 'Tick to say this certificate does not apply to this property' }, 'N/A'),
          el('th', {}, ''),
        ),
      ),
      el(
        'tbody',
        {},
        ...statuses.map((status) =>
          el(
            'tr',
            { class: status.exempt ? 'row-exempt' : status.overdue ? 'row-overdue' : '' },
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
            el('td', {}, nextDueCell(status)),
            el(
              'td',
              {},
              el(
                'label',
                { class: 'inline', title: `${status.type.name} does not apply to ${property.name}` },
                el('input', {
                  type: 'checkbox',
                  checked: status.exempt,
                  'aria-label': `${status.type.name} does not apply to ${property.name}`,
                  onchange: (event) => {
                    void setComplianceExempt(property.id, status.type.id, event.target.checked).then(rerender);
                  },
                }),
              ),
            ),
            el(
              'td',
              { class: 'actions' },
              // Nothing to log against a certificate this property does not
              // need; offering the button anyway would invite an entry that
              // then has to be undone.
              status.exempt
                ? el('span', { class: 'unset' }, 'not required')
                : el(
                    'button',
                    {
                      class: 'link',
                      onclick: () => logCompletion(property, status.type, today, rerender),
                    },
                    'Log completion',
                  ),
              status.lastCompletion && !status.exempt
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

/** The "Next due" cell: a date, a state, or nothing to say. */
function nextDueCell(status) {
  if (status.exempt) return el('span', { class: 'badge' }, 'Not applicable');
  if (status.nextDue === null) return el('span', { class: 'unset' }, '—');
  if (status.overdue) {
    return el(
      'span',
      {},
      el('span', { class: 'badge badge-overdue' }, 'Overdue'),
      ` since ${ukDate(status.nextDue)}`,
    );
  }
  if (status.dueSoon) {
    return el(
      'span',
      {},
      el('span', { class: 'badge badge-soon' }, 'Due soon'),
      ` ${ukDate(status.nextDue)}`,
    );
  }
  return ukDate(status.nextDue);
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
    // The key is on the element so a link from the Insurance or Tenancy table
    // can find its tile without depending on the order they are rendered in.
    { class: 'detail-section', 'data-section': section.key },
    el(
      'div',
      { class: 'section-head' },
      el('h3', {}, section.label),
      // No summary beside the heading. It restated the first line or two of the
      // record printed directly underneath it — "Halifax · 3.89%" above a tile
      // whose first rows are Lender: Halifax, Interest rate: 3.89% — which was
      // pure repetition once the sections became tiles rather than a long page
      // you might be reading the top of.
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
    if (field.type === 'boolean') {
      input = el('input', { type: 'checkbox', checked: isTrue(value) });
    } else if (field.type === 'textarea') {
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
        for (const [key, input] of inputs) {
          // A ticked box is an answer: "owned outright, no other details" has
          // to be savable, so it counts as a filled-in field.
          data[key] = input.type === 'checkbox' ? (input.checked ? 'yes' : '') : input.value.trim();
        }
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
        // A checkbox reads box-then-label; everything else reads label-then-box.
        field.type === 'boolean'
          ? el(
              'label',
              { class: 'inline grow' },
              inputs.get(field.key),
              ` ${field.label}`,
              field.hint ? el('small', {}, field.hint) : null,
            )
          : el(
              'label',
              { class: field.type === 'textarea' ? 'grow' : '' },
              field.label,
              inputs.get(field.key),
              field.hint ? el('small', {}, field.hint) : null,
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
  if (field.type === 'boolean') return isTrue(value) ? 'Yes' : 'No';
  if (field.type === 'money') return money(number(value));
  if (field.type === 'percent') return `${value}%`;
  if (field.type === 'date') return ukDate(value);
  if (field.type === 'day') return `day ${value} of the month`;
  if (field.type === 'url') {
    return el('a', { href: value, target: '_blank', rel: 'noopener noreferrer' }, value);
  }
  return String(value);
}
