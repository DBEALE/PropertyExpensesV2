/**
 * Keeping this device and the gist in step.
 *
 * The rule the whole module is built around: **IndexedDB stays the source of
 * truth**. The gist is a copy that happens to be reachable from your phone.
 * Nothing here writes to the network without being asked, and the only thing
 * that ever writes to local data is a path that has first either fast-forwarded
 * (nothing local to lose) or merged (nothing lost at all).
 *
 * The decision functions at the top are pure and tested; the rest is plumbing
 * between `store.js`, `vault.js`, `merge.js` and `gist-store.js`.
 */
import { buildBackup } from './backup.js';
import { plural } from './change-log.js';
import { mergeDocuments } from './merge.js';
import { open, seal } from './vault.js';
import {
  createVault,
  readRevision,
  readVault,
  remoteVersion,
  whoami,
  writeVault,
} from './gist-store.js';
import { applyDocument, backupPending, getState, markBackedUp, recordChange } from './store.js';

/**
 * Device-local configuration, deliberately *not* in the settings store.
 *
 * `buildBackup` includes `settings`, so a token kept there would be uploaded
 * and then restored onto the other device — handing it credentials it never
 * asked for. This is configuration for this machine, not data about your
 * properties, and it belongs somewhere the sync never touches.
 */
const KEY = 'property-expenses:sync';

/**
 * The last answer from `checkRemote`, so a render can ask where this device
 * stands without going to the network. Cleared by anything that moves the
 * world on.
 */
let cached = null;

export function syncConfig() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveSyncConfig(changes) {
  const next = { ...syncConfig(), ...changes };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function forgetSync() {
  localStorage.removeItem(KEY);
  cached = null;
}

/** True once there is somewhere to sync to. */
export function isConfigured() {
  const { token, gistId } = syncConfig();
  return Boolean(token && gistId);
}

// --- the decisions, kept pure so they can be tested without a network -------

/**
 * What a push should do, given where the remote has got to.
 *
 * @param {string|null} lastVersion what this device last saw
 * @param {string|null} remote the gist's head now
 * @returns {'first-push'|'ok'|'behind'}
 */
export function pushDecision(lastVersion, remote) {
  if (!remote) return 'first-push';
  if (!lastVersion) return 'behind'; // Something is there that we have never seen.
  return lastVersion === remote ? 'ok' : 'behind';
}

/**
 * What to do when the app opens.
 *
 * The case that matters is the last one. Most conflicts are not two people
 * typing at once — they are one device starting from a stale copy and only
 * finding out at push time, by which point both sides have diverged. Catching
 * it on open is what makes multi-device use calm rather than fraught.
 *
 * @param {boolean} dirty are there local edits that have not been pushed
 * @param {boolean} moved has the gist advanced since we last saw it
 * @returns {'nothing'|'fast-forward'|'merge'}
 */
export function openDecision(dirty, moved) {
  if (!moved) return 'nothing'; // Includes "we have local edits" — the tab dot says so already.
  return dirty ? 'merge' : 'fast-forward';
}

// --- the plumbing -----------------------------------------------------------

/** The document representing this device right now. */
function localDocument() {
  return buildBackup(getState(), new Date().toISOString());
}

/**
 * Checks a token and remembers it, without touching any data.
 * @returns {Promise<string>} the GitHub login it belongs to
 */
export async function connect(token) {
  const login = await whoami(token);
  saveSyncConfig({ token, login });
  return login;
}

/** Creates the gist and seeds it with what is on this device. */
export async function createRemote(passphrase) {
  const { token } = syncConfig();
  const envelope = await seal(localDocument(), passphrase);
  const { gistId, version, url } = await createVault(token, envelope);
  saveSyncConfig({ gistId, url, lastVersion: version, lastSyncedAt: new Date().toISOString() });
  cached = null;
  await markBackedUp();
  return { gistId, url };
}

/**
 * Sends this device's state to the gist.
 *
 * Re-reads the head first and refuses if it moved, unless told to overwrite.
 * The window between that read and the write is the price of an API with no
 * conditional write — and it is survivable because the overwritten revision
 * stays in the gist's history.
 */
export async function push(passphrase, { force = false } = {}) {
  const { token, gistId, lastVersion } = syncConfig();
  const head = await remoteVersion(token, gistId);
  const decision = pushDecision(lastVersion, head);

  if (decision === 'behind' && !force) return { pushed: false, reason: 'behind', head };

  const { version, url } = await writeVault(token, gistId, await seal(localDocument(), passphrase));
  saveSyncConfig({ lastVersion: version, url, lastSyncedAt: new Date().toISOString() });
  cached = null;
  await markBackedUp();
  return { pushed: true, version };
}

/**
 * Replaces this device's data with the gist's.
 *
 * Only safe when there is nothing local to lose — the caller checks that, or
 * chooses it knowingly. `applyDocument` validates before it writes, so a
 * damaged vault cannot half-import.
 */
export async function pull(passphrase) {
  const { token, gistId } = syncConfig();
  const { envelope, version, url } = await readVault(token, gistId);
  const document = await open(envelope, passphrase);
  await applyDocument(document);
  saveSyncConfig({ lastVersion: version, url, lastSyncedAt: new Date().toISOString() });
  cached = null;
  await markBackedUp();
  return { version };
}

/**
 * Merges the gist into this device without losing either side.
 *
 * Fetches the ancestor both devices started from — the revision this machine
 * last saw — and three-way merges against it. The result is applied locally and
 * left *unpushed*: the merge is a local decision, and sending it is a separate,
 * deliberate act.
 */
export async function reconcile(passphrase) {
  const { token, gistId, lastVersion } = syncConfig();
  const { envelope, version, url } = await readVault(token, gistId);
  const theirs = await open(envelope, passphrase);

  // Without an ancestor every record looks like an addition on both sides,
  // which turns ordinary edits into collisions. An empty base is the honest
  // fallback when the revision is gone, not a reason to refuse.
  let base = null;
  if (lastVersion) {
    try {
      base = (await readRevision(token, gistId, lastVersion)).envelope;
      base = await open(base, passphrase);
    } catch {
      base = null;
    }
  }

  const result = mergeDocuments(base ?? emptyDocument(theirs), localDocument(), theirs);
  await applyDocument(result.document);
  // The remote version we merged *from*, so the next push knows it is current.
  saveSyncConfig({ lastVersion: version, url, lastSyncedAt: new Date().toISOString() });
  cached = null;

  // Applying the merge replaced every store, which took the change log with
  // it — so the tab would show unpushed work with nothing listed against it.
  // This is the line that explains why a push is outstanding.
  await recordChange(
    'sync',
    `Merged with the gist: ${plural(result.fromTheirs, 'record')} from the other device, ` +
      `${result.fromMine} kept from this one` +
      (result.collisions.length > 0 ? `, ${plural(result.collisions.length, 'collision')}` : ''),
  );

  return {
    fromMine: result.fromMine,
    fromTheirs: result.fromTheirs,
    collisions: result.collisions,
    resurrected: result.resurrected,
  };
}

/** A document with the right shape and nothing in it. */
function emptyDocument(like) {
  const empty = { format: like.format, version: like.version, exportedAt: like.exportedAt };
  for (const [key, value] of Object.entries(like)) {
    if (Array.isArray(value)) empty[key] = [];
  }
  return empty;
}

/** The last known standing, without a network call. Null until one has run. */
export function remoteState() {
  return cached;
}

/**
 * Where this device stands relative to the gist.
 *
 * Cheap — one call for the head revision, no payload — so both the on-open
 * check and the Backup tab can ask, and neither has to know about the other.
 */
export async function checkRemote() {
  const { token, gistId, lastVersion, lastSyncedAt, url, login } = syncConfig();
  if (!isConfigured()) return (cached = { configured: false });

  const dirty = backupPending();
  try {
    const head = await remoteVersion(token, gistId);
    const moved = Boolean(head) && head !== lastVersion;
    cached = { configured: true, login, url, lastSyncedAt, dirty, moved, action: openDecision(dirty, moved) };
  } catch (error) {
    // Offline is an ordinary state for a local-first app, not a failure worth
    // blocking the page on.
    cached = { configured: true, login, url, lastSyncedAt, dirty, offline: true, error: error.message };
  }
  return cached;
}
