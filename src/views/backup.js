import { BackupFormatError, buildBackup } from '../backup.js';
import { MAX_ENTRIES, byDay } from '../change-log.js';
import { download, el, toast, ukDate } from '../dom.js';
import {
  backupPending,
  backupRecord,
  changesSinceBackup,
  clearEverything,
  getState,
  markBackedUp,
  restoreBackup,
} from '../store.js';
import {
  checkRemote,
  connect,
  createRemote,
  forgetSync,
  isConfigured,
  push,
  pull,
  reconcile,
  remoteState,
  saveSyncConfig,
  syncConfig,
} from '../sync.js';

/**
 * The passphrase, held for this page only.
 *
 * Never written anywhere. The whole point of encrypting before upload is that
 * the key exists in one place — your head — so persisting it here would undo
 * the feature while looking like a convenience.
 */
let passphrase = '';
/** The last status read, so the section can render without re-fetching. */
let remote = null;
/** The result of the last merge, shown once and then dismissed. */
let lastMerge = null;

export function renderBackup(root, rerender) {
  const { properties, rules, transactions } = getState();
  const last = backupRecord();
  const pending = backupPending();
  const changes = changesSinceBackup();

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
  );

  renderCloudSync(root, rerender);
  renderChangeLog(root, changes);

  root.append(
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

/**
 * Syncing to an encrypted gist.
 *
 * Off until set up, and every write is a button press — the app never talks to
 * the network on its own except to *ask* whether the gist has moved, which is
 * what lets it warn you before you edit on top of a stale copy.
 */
function renderCloudSync(root, rerender) {
  const config = syncConfig();
  root.append(el('div', { class: 'toolbar' }, el('h3', {}, 'Sync to a private gist')));

  if (!isConfigured()) {
    renderSetup(root, rerender, config);
    return;
  }

  remote = remoteState();
  if (!remote) {
    // First look at this tab since the last sync operation. Ask once, in the
    // background, and redraw when the answer lands — never block the page on
    // a network call the app is designed to work without.
    void checkRemote().then(rerender);
  }

  const pass = el('input', {
    type: 'password',
    class: 'wide',
    value: passphrase,
    placeholder: 'Passphrase',
    'aria-label': 'Vault passphrase',
    autocomplete: 'off',
    oninput: (event) => {
      passphrase = event.target.value;
    },
  });

  /** Wraps an action so a failure is reported rather than swallowed. */
  const act = (label, work) =>
    el(
      'button',
      {
        onclick: async (event) => {
          if (!passphrase) {
            toast('Enter your passphrase first.', 'error');
            pass.focus();
            return;
          }
          const button = event.target;
          button.disabled = true;
          try {
            await work();
          } catch (error) {
            toast(error.message, 'error');
          } finally {
            button.disabled = false;
            rerender();
          }
        },
      },
      label,
    );

  root.append(
    el(
      'p',
      { class: 'hint' },
      'Your data is compressed and encrypted on this device before it is uploaded, so the gist holds ' +
        'nothing readable. A secret gist is unlisted rather than private — anyone with the link can ' +
        'fetch it, which is exactly why it is encrypted. ',
      el('strong', {}, 'If you forget the passphrase the copy in the gist cannot be recovered'),
      ' — keep taking the JSON download above as well.',
    ),
  );

  // Appended separately rather than as a ternary argument: Node.append turns a
  // null into the literal text "null" on the page, where el() would filter it.
  if (remote?.moved) {
    root.append(
      el(
        'div',
        { class: 'notice attention attention-soon' },
        el(
          'div',
          { class: 'attention-group' },
          el('strong', {}, 'The gist has moved on'),
          el(
            'p',
            { class: 'hint' },
            remote.dirty
              ? 'Another device has pushed since this one last synced, and you have unpushed changes ' +
                'here. Merge combines both — nothing is discarded.'
              : 'Another device has pushed since this one last synced. There is nothing unsaved here, ' +
                'so pulling is safe.',
          ),
        ),
      ),
    );
  }

  root.append(
    el(
      'div',
      { class: 'filter-bar' },
      pass,
      act('Push', async () => {
        const result = await push(passphrase);
        if (result.pushed) {
          toast('Pushed to the gist.');
          return;
        }
        // Refused rather than clobbered. Offer the two honest ways forward.
        const merge = confirm(
          'The gist has changed since this device last synced.\n\n' +
            'OK — merge the two, keeping both sets of changes.\n' +
            'Cancel — leave it alone so you can look first.',
        );
        if (merge) {
          lastMerge = await reconcile(passphrase);
          toast('Merged. Review below, then push.');
        }
      }),
      act('Pull', async () => {
        if (backupPending() && !confirm(
          'This device has changes that have not been pushed.\n\n' +
            'Pulling replaces them with the gist\'s copy and they cannot be recovered.\n\n' +
            'Merge instead if you want to keep both.',
        )) {
          return;
        }
        await pull(passphrase);
        toast('Pulled from the gist.');
      }),
      act('Merge', async () => {
        lastMerge = await reconcile(passphrase);
        toast('Merged. Nothing was discarded.');
      }),
    ),
    el(
      'p',
      { class: 'hint' },
      config.url ? el('a', { href: config.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the gist') : null,
      config.url ? ' · ' : null,
      config.lastSyncedAt ? `Last synced ${ukDate(config.lastSyncedAt.slice(0, 10))}` : 'Not synced yet',
      remote?.offline ? ' · offline — could not reach GitHub' : '',
      ' · ',
      el(
        'button',
        {
          class: 'link danger',
          onclick: () => {
            if (!confirm('Forget the token and gist on this device? The gist itself is left alone.')) return;
            forgetSync();
            rerender();
          },
        },
        'Disconnect',
      ),
    ),
  );

  if (lastMerge) renderMergeReport(root, rerender);
}

/** Connecting for the first time, or joining a gist another device made. */
function renderSetup(root, rerender, config) {
  const token = el('input', {
    type: 'password',
    class: 'wide',
    placeholder: 'GitHub token',
    'aria-label': 'GitHub personal access token',
    autocomplete: 'off',
  });
  const gistId = el('input', {
    type: 'text',
    placeholder: 'Existing gist id (leave blank to create one)',
    'aria-label': 'Existing gist id',
  });
  const pass = el('input', {
    type: 'password',
    placeholder: 'Passphrase',
    'aria-label': 'Vault passphrase',
    autocomplete: 'off',
  });

  root.append(
    el(
      'p',
      { class: 'hint' },
      'Optional, and off until you set it up. Your data is encrypted on this device before it is ' +
        'uploaded, so the gist holds nothing readable — but a secret gist is unlisted rather than ' +
        'private, so the encryption is what keeps it safe. Create a ',
      el(
        'a',
        { href: 'https://github.com/settings/tokens', target: '_blank', rel: 'noopener noreferrer' },
        'personal access token',
      ),
      ' with the ',
      el('code', {}, 'gist'),
      ' scope. Use the same gist id and passphrase on every device you want in sync.',
    ),
    el(
      'div',
      { class: 'filter-bar' },
      token,
      gistId,
      pass,
      el(
        'button',
        {
          class: 'primary',
          onclick: async (event) => {
            if (!token.value.trim() || !pass.value) {
              toast('A token and a passphrase are both needed.', 'error');
              return;
            }
            const button = event.target;
            button.disabled = true;
            try {
              const login = await connect(token.value.trim());
              passphrase = pass.value;
              if (gistId.value.trim()) {
                // Joining an existing vault: pull rather than push, or this
                // device would overwrite the gist with whatever it happens to
                // hold — which for a fresh install is nothing.
                saveSyncConfig({ gistId: gistId.value.trim() });
                await pull(passphrase);
                toast(`Connected as ${login} and pulled.`);
              } else {
                const { url } = await createRemote(passphrase);
                toast(`Connected as ${login}. Gist created: ${url}`);
              }
            } catch (error) {
              // Half-connected is worse than not connected — it would leave a
              // gist id pointing at something this device cannot read.
              forgetSync();
              toast(error.message, 'error');
            } finally {
              button.disabled = false;
              rerender();
            }
          },
        },
        'Connect',
      ),
    ),
  );
}

/** What the last merge actually did, since it changed data without being asked twice. */
function renderMergeReport(root, rerender) {
  const { fromMine, fromTheirs, collisions, resurrected } = lastMerge;
  const notes = [...collisions, ...resurrected];

  root.append(
    el(
      'div',
      { class: `notice${notes.length > 0 ? ' attention attention-soon' : ''}` },
      el(
        'div',
        { class: 'attention-group' },
        el('strong', {}, 'Merged'),
        el(
          'p',
          { class: 'hint' },
          `${fromTheirs} record(s) came from the other device, ${fromMine} kept from this one. ` +
            'Nothing was discarded — push when you are ready.',
        ),
        notes.length > 0
          ? el(
              'ul',
              { class: 'change-list' },
              ...notes.map((note) =>
                el(
                  'li',
                  {},
                  el('span', { class: 'badge badge-gap' }, note.reason.startsWith('deleted') ? 'Kept' : 'Check'),
                  ` ${note.label} — ${note.reason}`,
                ),
              ),
            )
          : null,
        collisions.length > 0
          ? el(
              'p',
              { class: 'hint' },
              'Where both devices edited the same record this one won. The other version is still in ' +
                'the gist’s history if you need it.',
            )
          : null,
        el(
          'button',
          {
            class: 'link',
            onclick: () => {
              lastMerge = null;
              rerender();
            },
          },
          'Dismiss',
        ),
      ),
    ),
  );
}

/**
 * What has been edited since the last backup.
 *
 * The dot on the tab says *that* something changed; this says *what*, so
 * "should I back up before clearing my browser" becomes a decision made on
 * evidence rather than on a coloured dot. Grouped by day, because a backup put
 * off for a fortnight otherwise reads as one undifferentiated column of times.
 */
function renderChangeLog(root, changes) {
  root.append(
    el(
      'div',
      { class: 'toolbar' },
      el('h3', {}, 'Changes since your last backup'),
      changes.length > 0 ? el('span', { class: 'count' }, `${changes.length} logged`) : null,
    ),
  );

  if (changes.length === 0) {
    root.append(
      el('div', { class: 'empty' }, 'Nothing has been edited since your last backup.'),
    );
    return;
  }

  root.append(
    ...byDay(changes).map(({ day, entries }) =>
      el(
        'div',
        { class: 'change-day' },
        el('h4', {}, ukDate(day)),
        el(
          'ul',
          { class: 'change-list' },
          ...entries.map((entry) =>
            el(
              'li',
              {},
              el('span', { class: 'change-time' }, entry.at.slice(11, 16)),
              el('span', { class: `badge badge-${entry.kind}` }, entry.kind),
              ' ',
              entry.summary,
            ),
          ),
        ),
      ),
    ),
  );

  if (changes.length >= MAX_ENTRIES) {
    root.append(
      el(
        'p',
        { class: 'hint' },
        `Only the most recent ${MAX_ENTRIES} changes are kept — older ones have been dropped. ` +
          'Backing up more often keeps this list complete.',
      ),
    );
  }
}
