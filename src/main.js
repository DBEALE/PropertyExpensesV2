import { isAssigned } from './allocation.js';
import { clear, el, toast } from './dom.js';
import { getState, load, subscribe } from './store.js';
import { renderAccounts } from './views/accounts.js';
import { renderBackup } from './views/backup.js';
import { renderImport } from './views/import.js';
import { renderProperties } from './views/properties.js';
import { renderProperty } from './views/property.js';
import { renderRules } from './views/rules.js';
import { renderSummary } from './views/summary.js';
import { renderTransactions } from './views/transactions.js';

const ROUTES = [
  { id: 'import', label: 'Import', render: renderImport },
  { id: 'transactions', label: 'Transactions', render: renderTransactions },
  { id: 'rules', label: 'Rules', render: renderRules },
  { id: 'properties', label: 'Properties & categories', render: renderProperties },
  { id: 'accounts', label: 'Accounts', render: renderAccounts },
  { id: 'summary', label: 'Summary', render: renderSummary },
  { id: 'backup', label: 'Backup', render: renderBackup },
  // Reached from the property list rather than the tab bar.
  { id: 'property', label: 'Property', render: renderProperty, hidden: true },
];

const view = document.getElementById('view');
const nav = document.getElementById('nav');

/**
 * Hash routing, so the app works unchanged from a file path or a GitHub Pages
 * repo subpath without any server-side rewrite rules.
 */
function currentRoute() {
  // "#/property/<id>" carries a parameter; every other route is a bare id.
  const [id, param] = window.location.hash.replace(/^#\/?/, '').split('/');
  const route = ROUTES.find((r) => r.id === id) ?? ROUTES[0];
  return { ...route, param: param ? decodeURIComponent(param) : null };
}

function navigate(routeId) {
  window.location.hash = `#/${routeId}`;
}

/** The Properties tab stays lit while a single property is open. */
function isActive(route, active) {
  if (route.id === active.id) return true;
  return route.id === 'properties' && active.id === 'property';
}

function renderNav(active) {
  clear(nav);
  const needsReview = getState().transactions.filter((t) => !isAssigned(t)).length;
  for (const route of ROUTES.filter((r) => !r.hidden)) {
    nav.append(
      el(
        'a',
        {
          href: `#/${route.id}`,
          class: isActive(route, active) ? 'tab active' : 'tab',
          'aria-current': isActive(route, active) ? 'page' : undefined,
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
}

window.addEventListener('hashchange', render);
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
