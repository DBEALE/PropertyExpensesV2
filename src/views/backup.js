import { BackupFormatError, buildBackup } from '../backup.js';
import { download, el, toast, ukDate } from '../dom.js';
import {
  backupPending,
  backupRecord,
  clearEverything,
  getState,
  markBackedUp,
  restoreBackup,
} from '../store.js';

export function renderBackup(root, rerender) {
  const { properties, rules, transactions } = getState();
  const last = backupRecord();
  const pending = backupPending();

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
    // Says which of the two states you are in and what to do about it, rather
    // than leaving the dot on the tab as the only signal.
    el(
      'div',
      { class: `notice${pending ? ' attention attention-overdue' : ''}` },
      pending
        ? el(
            'span',
            {},
            el('span', { class: 'badge badge-overdue' }, 'Backup pending'),
            last
              ? ` Data has changed since your last backup on ${ukDate(last.at.slice(0, 10))}.`
              : ' Nothing has been backed up from this browser yet.',
          )
        : el(
            'span',
            {},
            el('span', { class: 'badge badge-ok' }, 'Up to date'),
            last ? ` Nothing has changed since your backup on ${ukDate(last.at.slice(0, 10))}.` : ' There is nothing to back up yet.',
          ),
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
            // Recorded against a digest of what was in the file, so editing
            // one transaction afterwards brings the pending mark straight
            // back — the mark tracks the data, not the calendar.
            void markBackedUp().then(() => {
              toast('Backup downloaded.');
              rerender();
            });
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
