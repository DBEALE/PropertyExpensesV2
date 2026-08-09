import { isAssigned } from './allocation.js';
import { clear, el, toast } from './dom.js';
import { applyResponsive, watchBreakpoint } from './responsive.js';
import { getState, load, subscribe } from './store.js';
import { renderBackup } from './views/backup.js';
import { renderImport } from './views/import.js';
import { renderConfig } from './views/config.js';
import { renderProperty } from './views/property.js';
import { renderRules } from './views/rules.js';
import { renderSummary } from './views/summary.js';
import { renderTransactions } from './views/transactions.js';

const ROUTES = [
  { id: 'import', label: 'Import', render: renderImport },
  { id: 'config', label: 'Config', render: renderConfig },
  { id: 'transactions', label: 'Transactions', render: renderTransactions },
  { id: 'rules', label: 'Rules', render: renderRules },
  { id: 'properties', label: 'Properties', render: renderProperty },
  { id: 'summary', label: 'Summary', render: renderSummary },
  { id: 'backup', label: 'Backup', render: renderBackup },
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

function renderNav(active) {
  clear(nav);
  const needsReview = getState().transactions.filter((t) => !isAssigned(t)).length;
  for (const route of ROUTES) {
    nav.append(
      el(
        'a',
        {
          href: `#/${route.id}`,
          class: route.id === active.id ? 'tab active' : 'tab',
          'aria-current': route.id === active.id ? 'page' : undefined,
        },
        route.label,
        route.id === 'transactions' && needsReview > 0 ? el('span', { class: 'pill' }, String(needsReview)) : null,
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
 * Table headings stick directly under the page heading, so they need its
 * height — which changes when the tab row wraps on a narrow window.
 */
function measureHeader() {
  const header = document.querySelector('.app-header');
  if (!header) return;
  document.documentElement.style.setProperty('--header-h', `${Math.round(header.offsetHeight)}px`);
}

if (typeof ResizeObserver === 'function') {
  const header = document.querySelector('.app-header');
  if (header) new ResizeObserver(measureHeader).observe(header);
} else {
  window.addEventListener('resize', measureHeader);
}

window.addEventListener('hashchange', render);
// Rotating the phone can cross the breakpoint, so re-lay-out when it does.
watchBreakpoint(render);
// Keep the "needs review" badge honest after writes from any view.
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
