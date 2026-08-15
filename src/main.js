import { isAssigned } from './allocation.js';
import { attentionTotal } from './attention.js';
import { clear, el, toast } from './dom.js';
import { applyResponsive, watchBreakpoint } from './responsive.js';
import { backupPending, getState, load, subscribe } from './store.js';
import { renderBackup } from './views/backup.js';
import { renderImport } from './views/import.js';
import { renderConfig } from './views/config.js';
import { renderProperty } from './views/property.js';
import { renderRules } from './views/rules.js';
import { renderSummary } from './views/summary.js';
import { renderTransactions } from './views/transactions.js';
import { renderWhatsNew } from './views/whats-new.js';

const ROUTES = [
  { id: 'import', label: 'Import', render: renderImport },
  { id: 'config', label: 'Config', render: renderConfig },
  { id: 'transactions', label: 'Transactions', render: renderTransactions },
  { id: 'rules', label: 'Rules', render: renderRules },
  { id: 'properties', label: 'Properties', render: renderProperty },
  { id: 'summary', label: 'Summary', render: renderSummary },
  { id: 'backup', label: 'Backup', render: renderBackup },
  // Pushed to the far end of the row: it is about the app rather than about
  // your data, so it does not belong in the sequence of places you work.
  { id: 'whats-new', label: 'What’s new', render: renderWhatsNew, trailing: true },
];

const view = document.getElementById('view');
const nav = document.getElementById('nav');

/**
 * Hash routing, so the app works unchanged from a file path or a GitHub Pages
 * repo subpath without any server-side rewrite rules.
 */
function currentRoute() {
  // "#/properties/<id>" carries a parameter; every other route is a bare id.
  const [id, param] = window.location.hash.replace(/^#\/?/, '').split('/');
  const route = ROUTES.find((r) => r.id === id) ?? ROUTES[0];
  return { ...route, param: param ? decodeURIComponent(param) : null };
}

function navigate(routeId) {
  window.location.hash = `#/${routeId}`;
}

/**
 * The badge on a tab: how much of that screen's work is outstanding.
 *
 * Counted here rather than by each view, so the number on the tab and the list
 * behind it are the same number. Zero means no badge at all — a badge showing
 * "0" is a badge you stop reading.
 */
function tabBadge(routeId) {
  const state = getState();
  if (routeId === 'transactions') {
    const needsReview = state.transactions.filter((t) => !isAssigned(t)).length;
    return needsReview > 0
      ? { text: String(needsReview), title: `${needsReview} transaction(s) not categorised`, class: 'pill' }
      : null;
  }
  if (routeId === 'properties') {
    const attention = attentionTotal(state, new Date().toISOString().slice(0, 10));
    return attention > 0
      ? {
          text: String(attention),
          title: `${attention} item(s) overdue, due within 30 days, or needing a record filled in`,
          class: 'pill',
        }
      : null;
  }
  if (routeId === 'backup') {
    // A dot, not a count: "something has changed" is one fact however many
    // things changed, and a number here would only invite you to work out
    // which ones.
    return backupPending()
      ? { text: '', title: 'Changes since your last backup', class: 'pill pill-dot', label: 'backup pending' }
      : null;
  }
  return null;
}

function renderNav(active) {
  clear(nav);
  for (const route of ROUTES) {
    const badge = tabBadge(route.id);
    nav.append(
      el(
        'a',
        {
          href: `#/${route.id}`,
          class: `tab${route.id === active.id ? ' active' : ''}${route.trailing ? ' tab-trailing' : ''}`,
          'aria-current': route.id === active.id ? 'page' : undefined,
        },
        route.label,
        badge
          ? el(
              'span',
              { class: badge.class, title: badge.title, 'aria-label': badge.label ?? badge.title },
              badge.text,
            )
          : null,
      ),
    );
  }
}

function render() {
  const route = currentRoute();
  renderNav(route);
  clear(view);
  route.render(view, route.id === 'import' ? navigate : render, route.param);
  measureHeader();
  // Tables become cards on a narrow screen; this labels their cells and adds
  // the sort control that replaces the hidden headings.
  applyResponsive(view);
}

/**
 * Table headings stick directly under the page heading — and under a sticky
 * filter bar where a screen has one — so they need both heights. Neither is a
 * constant: the tab row and the filter bar each wrap on a narrow window.
 */
function measureHeader() {
  const header = document.querySelector('.app-header');
  if (header) {
    document.documentElement.style.setProperty('--header-h', `${Math.round(header.offsetHeight)}px`);
  }
  const filters = document.querySelector('.filter-bar.sticky');
  document.documentElement.style.setProperty(
    '--filter-h',
    filters ? `${Math.round(filters.offsetHeight)}px` : '0px',
  );
}

if (typeof ResizeObserver === 'function') {
  const header = document.querySelector('.app-header');
  if (header) new ResizeObserver(measureHeader).observe(header);
  // The view too: the filter bar inside it wraps at widths that leave the tab
  // row alone, and the header observer would never fire for that.
  if (view) new ResizeObserver(measureHeader).observe(view);
} else {
  window.addEventListener('resize', measureHeader);
}

window.addEventListener('hashchange', render);
// Rotating the phone can cross the breakpoint, so re-lay-out when it does.
watchBreakpoint(render);
// Keep the tab badges honest after writes from any view.
subscribe(() => renderNav(currentRoute()));

load()
  .then(render)
  .catch((err) => {
    console.error(err);
    view.append(
      el(
        'div',
        { class: 'error' },
        'Could not open local storage (IndexedDB). Private browsing mode can block it — try a normal window.',
      ),
    );
    toast('Storage unavailable.', 'error');
  });
