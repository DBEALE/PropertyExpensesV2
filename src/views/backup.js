import { BackupFormatError, buildBackup } from '../backup.js';
import { download, el, toast } from '../dom.js';
import { clearEverything, getState, restoreBackup } from '../store.js';

export function renderBackup(root, rerender) {
  const { properties, rules, transactions } = getState();

  const fileInput = el('input', {
    type: 'file',
    accept: '.json,application/json',
    onchange: () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) void restore(file);
    },
  });

  root.append(
    el('h2', {}, 'Backup'),
    el(
      'p',
      { class: 'hint' },
      'Everything lives in this browser’s IndexedDB. Clearing site data wipes it, so download a backup ' +
        'regularly and keep it somewhere safe.',
    ),
    el(
      'div',
      { class: 'cards' },
      el('div', { class: 'card' }, el('strong', {}, String(properties.length)), el('span', {}, 'properties')),
      el('div', { class: 'card' }, el('strong', {}, String(rules.length)), el('span', {}, 'rules')),
      el('div', { class: 'card' }, el('strong', {}, String(transactions.length)), el('span', {}, 'transactions')),
    ),
    el(
      'div',
      { class: 'toolbar' },
      el(
        'button',
        {
          class: 'primary',
          onclick: () => {
            const now = new Date().toISOString();
            download(
              `property-expenses-backup-${now.slice(0, 10)}.json`,
              JSON.stringify(buildBackup(getState(), now), null, 2),
              'application/json',
            );
            toast('Backup downloaded.');
          },
        },
        'Download backup (JSON)',
      ),
    ),
    el('h3', {}, 'Restore'),
    el('p', { class: 'hint' }, 'Restoring replaces all current data with the contents of the backup file.'),
    fileInput,
    el('h3', {}, 'Danger zone'),
    el(
      'button',
      {
        class: 'danger-btn',
        onclick: () => {
          if (!confirm('Delete all properties, rules and transactions from this browser?')) return;
          if (!confirm('This cannot be undone. Are you sure?')) return;
          void clearEverything().then(() => {
            toast('All data deleted.');
            rerender();
          });
        },
      },
      'Delete all data',
    ),
  );

  async function restore(file) {
    if (!confirm(`Replace all current data with the contents of ${file.name}?`)) {
      fileInput.value = '';
      return;
    }
    try {
      await restoreBackup(JSON.parse(await file.text()));
      toast('Backup restored.');
      rerender();
    } catch (err) {
      toast(err instanceof BackupFormatError ? err.message : 'That file is not valid JSON.', 'error');
    } finally {
      fileInput.value = '';
    }
  }
}
