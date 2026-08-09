import { isAssigned } from './allocation.js';
import { clear, el, toast } from './dom.js';
import { getState, load, subscribe } from './store.js';
import { renderBackup } from './views/backup.js';
import { renderImport } from './views/import.js';
import { renderProperties } from './views/properties.js';
import { renderRules } from './views/rules.js';
import { renderSummary } from './views/summary.js';
import { renderTransactions } from './views/transactions.js';

const ROUTES = [
  { id: 'import', label: 'Import', render: renderImport },
  { id: 'transactions', label: 'Transactions', render: renderTransactions },
  { id: 'rules', label: 'Rules', render: renderRules },
  { id: 'properties', label: 'Properties & categories', render: renderProperties },
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
  const id = window.location.hash.replace(/^#\/?/, '');
  return ROUTES.find((r) => r.id === id) ?? ROUTES[0];
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
  route.render(view, route.id === 'import' ? navigate : render);
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
