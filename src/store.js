import { hasSplit } from './allocation.js';
import { DEFAULT_CATEGORIES, NON_PROPERTY_NAME, isNonProperty } from './categories.js';
import { DEFAULT_COMPLIANCE_TYPES, completionsForType, exemptionId } from './compliance.js';
import { iconByKey, iconOf } from './icons.js';
import { withDefaults } from './tax.js';
import { slotClass } from './palette.js';
import { sectionByKey, supersede } from './property-details.js';
import { newestFirst, overflowIds, plural } from './change-log.js';
import * as db from './db.js';
import { recategorise } from './importer.js';
import { validateBackup } from './backup.js';

/** In-memory mirror of IndexedDB, refreshed after every write. */
const state = {
  properties: [],
  categories: [],
  propertyDetails: [],
  complianceTypes: [],
  complianceCompletions: [],
  complianceExemptions: [],
  settings: [],
  rules: [],
  transactions: [],
  changeLog: [],
};
const listeners = new Set();

/**
 * A digest of everything worth backing up, recomputed once per load rather
 * than per render — every write goes through load(), so this is exactly as
 * fresh as the state it describes.
 */
let signature = '';

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

export async function load() {
  let [
    properties,
    categories,
    propertyDetails,
    complianceTypes,
    complianceCompletions,
    complianceExemptions,
    settings,
    rules,
    transactions,
    changeLog,
  ] = await Promise.all([
    db.getAll('properties'),
    db.getAll('categories'),
    db.getAll('propertyDetails'),
    db.getAll('complianceTypes'),
    db.getAll('complianceCompletions'),
    db.getAll('complianceExemptions'),
    db.getAll('settings'),
    db.getAll('rules'),
    db.getAll('transactions'),
    db.getAll('changeLog'),
  ]);
  // First run, or an install predating editable categories: seed the five
  // defaults. Their ids match the names older records stored, so existing
  // transactions and rules keep resolving.
  if (categories.length === 0) {
    categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    await db.putMany('categories', categories);
  }
  // Same shape as the category seeding above: fill in the defaults once, then
  // they are the user's to edit.
  if (complianceTypes.length === 0) {
    complianceTypes = DEFAULT_COMPLIANCE_TYPES.map((t) => ({ ...t }));
    await db.putMany('complianceTypes', complianceTypes);
  }
  state.properties = properties.sort((a, b) => a.name.localeCompare(b.name));
  state.categories = categories;
  state.propertyDetails = propertyDetails;
  state.complianceTypes = complianceTypes;
  state.complianceCompletions = complianceCompletions;
  state.complianceExemptions = complianceExemptions;
  state.settings = settings;
  state.rules = rules;
  state.transactions = transactions.sort((a, b) => b.date.localeCompare(a.date));
  state.changeLog = changeLog;
  signature = signatureOf(state);
  notify();
}

/**
 * Records one edit.
 *
 * Every mutation below calls this once — per *action*, not per record — before
 * reloading, so the log and the data can never disagree about what happened.
 * Failures here are swallowed: losing a log line is a much smaller problem
 * than a save that appears to fail because its bookkeeping did.
 *
 * @param {string} kind what sort of record
 * @param {string} summary one line, in the user's terms
 */
async function log(kind, summary) {
  try {
    await db.put('changeLog', { id: db.newId(), at: new Date().toISOString(), kind, summary });
    const stale = overflowIds(await db.getAll('changeLog'));
    for (const id of stale) await db.remove('changeLog', id);
  } catch {
    // Nothing to do and nothing worth telling the user: the edit itself landed.
  }
}

/**
 * "Added X" / "Renamed X to Y" / "Changed the colour of X" — the log line for a
 * save, worked out by comparing the record with what was there before.
 *
 * Naming *what* changed rather than logging "Property saved": the whole point
 * of the log is deciding whether the last hour's work is worth backing up, and
 * five identical lines answer nothing.
 */
function describeSave(noun, before, after) {
  if (!before) return `Added ${noun.toLowerCase()} ${after.name}`;
  const changes = [];
  if (before.name !== after.name) changes.push(`renamed from ${before.name}`);
  if (before.colour !== after.colour) changes.push(`colour changed to ${after.colour}`);
  if (before.icon !== after.icon) changes.push(`icon changed to ${after.icon}`);
  if ((before.description ?? '') !== (after.description ?? '')) changes.push('description edited');
  if (String(before.frequencyMonths) !== String(after.frequencyMonths)) {
    changes.push(`frequency changed to ${after.frequencyMonths} months`);
  }
  return changes.length > 0
    ? `${noun} ${after.name}: ${changes.join(', ')}`
    : `${noun} ${after.name} saved`;
}

/** The log line for one transaction edit, naming which field moved. */
function describeTransactionEdit(before, after) {
  const what = `${after.date} ${after.details}`;
  if (!before) return `Added ${what}`;
  if (String(before.notes ?? '') !== String(after.notes ?? '')) {
    return `${after.notes ? 'Noted against' : 'Cleared the note on'} ${what}`;
  }
  if (before.propertyId !== after.propertyId || before.category !== after.category) {
    const to = [propertyName(after.propertyId), categoryName(after.category)].filter(Boolean).join(' · ');
    return to ? `Assigned ${what} to ${to}` : `Unassigned ${what}`;
  }
  if (hasSplit(before) !== hasSplit(after)) {
    return `${hasSplit(after) ? 'Split' : 'Un-split'} ${what}`;
  }
  return `Edited ${what}`;
}

/** A section key as the label the user sees on the property page. */
function sectionLabel(key) {
  return sectionByKey(key)?.label ?? key;
}

function complianceTypeName(id) {
  return state.complianceTypes.find((t) => t.id === id)?.name ?? id;
}

/** @param {string|null} id */
export function propertyName(id) {
  if (!id) return '';
  if (isNonProperty(id)) return NON_PROPERTY_NAME;
  const property = state.properties.find((p) => p.id === id);
  return property ? property.name : '(deleted property)';
}

/** @param {string|null} id */
export function categoryName(id) {
  if (!id) return '';
  const category = state.categories.find((c) => c.id === id);
  return category ? category.name : '(deleted category)';
}

/** @param {string|null} id */
export function categoryDescription(id) {
  const category = state.categories.find((c) => c.id === id);
  return category?.description ?? '';
}

/** The record behind an id, for anything that needs its colour too. */
export function propertyRecord(id) {
  if (isNonProperty(id)) return { id, name: NON_PROPERTY_NAME, colour: 'neutral' };
  return state.properties.find((p) => p.id === id) ?? null;
}

export function categoryRecord(id) {
  return state.categories.find((c) => c.id === id) ?? null;
}

/** CSS slot class for a property id, falling back to neutral when unknown. */
export function propertySlot(id) {
  const record = propertyRecord(id);
  return record ? slotClass(record) : 'slot-neutral';
}

export function categorySlot(id) {
  const record = categoryRecord(id);
  return record ? slotClass(record) : 'slot-neutral';
}

/**
 * The icon for an id, for the many call sites that hold an id rather than the
 * record. Unknown ids — a deleted property, "Not a property" — get no icon and
 * fall back to the plain swatch, which is the honest mark for a thing that is
 * not one of your records.
 */
export function propertyIcon(id) {
  const record = propertyRecord(id);
  return record && !isNonProperty(id) ? iconByKey('property', iconOf(record, 'property')) : null;
}

export function categoryIcon(id) {
  const record = categoryRecord(id);
  return record ? iconByKey('category', iconOf(record, 'category')) : null;
}

// --- Categories ---------------------------------------------------------

export async function saveCategory(category) {
  const before = state.categories.find((c) => c.id === category.id);
  await db.put('categories', category);
  await log('category', describeSave('Category', before, category));
  await load();
}

/**
 * Deletes a category and detaches everything referencing it. Rules that named
 * it are deleted; transactions that used it are unassigned, including splits,
 * whose remaining shares would no longer total the transaction.
 */
export async function deleteCategory(id) {
  const usage = categoryUsage(id);
  await log(
    'category',
    `Deleted category ${categoryName(id)}` +
      (usage.transactions > 0 ? `, unassigning ${plural(usage.transactions, 'transaction')}` : ''),
  );
  await db.remove('categories', id);
  for (const rule of state.rules.filter((r) => referencesCategory(r, id))) {
    await db.remove('rules', rule.id);
  }
  const touched = state.transactions.filter((t) => referencesCategory(t, id)).map(unassign);
  if (touched.length > 0) await db.putMany('transactions', touched);
  await load();
}

function referencesCategory(record, categoryId) {
  if (record.category === categoryId) return true;
  return hasSplit(record) && record.allocations.some((a) => a.category === categoryId);
}

/** How many rules and transactions would be affected by deleting a category. */
export function categoryUsage(id) {
  return {
    rules: state.rules.filter((r) => referencesCategory(r, id)).length,
    transactions: state.transactions.filter((t) => referencesCategory(t, id)).length,
  };
}

// --- Properties ---------------------------------------------------------

export async function saveProperty(property) {
  const before = state.properties.find((p) => p.id === property.id);
  await db.put('properties', property);
  await log('property', describeSave('Property', before, property));
  await load();
}

export async function deleteProperty(id) {
  // Logged before the delete, while the name is still resolvable.
  await log('property', `Deleted property ${propertyName(id)}`);
  await db.remove('properties', id);
  // Detach the property from anything referencing it, so no dangling ids
  // remain — including rules and transactions that only mention it in a split.
  for (const rule of state.rules.filter((r) => referencesProperty(r, id))) {
    await db.remove('rules', rule.id);
  }
  for (const detail of state.propertyDetails.filter((d) => d.propertyId === id)) {
    await db.remove('propertyDetails', detail.id);
  }
  for (const completion of state.complianceCompletions.filter((c) => c.propertyId === id)) {
    await db.remove('complianceCompletions', completion.id);
  }
  const touched = state.transactions.filter((t) => referencesProperty(t, id)).map(unassign);
  if (touched.length > 0) await db.putMany('transactions', touched);
  await load();
}

function referencesProperty(record, propertyId) {
  if (record.propertyId === propertyId) return true;
  return hasSplit(record) && record.allocations.some((a) => a.propertyId === propertyId);
}

/**
 * Clears an assignment entirely. A split loses every share, not just the one
 * naming the deleted property — dropping a single share would leave the rest
 * no longer summing to the transaction total.
 */
function unassign(transaction) {
  const { allocations, ...rest } = transaction;
  return { ...rest, propertyId: null, category: null, matchedRuleId: null };
}

// --- Property details ---------------------------------------------------

/**
 * Records a new version of one section. The record it replaces is kept and
 * stamped with the date this one takes effect, so the old arrangement stays
 * readable rather than being overwritten.
 */
export async function savePropertyDetail({ propertyId, section, data, effectiveFrom }) {
  const { record, rewritten, inForce } = supersede({
    records: state.propertyDetails,
    propertyId,
    section,
    data,
    effectiveFrom,
    recordedAt: new Date().toISOString(),
    id: db.newId(),
  });
  await db.putMany('propertyDetails', [...rewritten, record]);
  await log(
    'details',
    inForce
      ? `${rewritten.length > 0 ? 'Updated' : 'Recorded'} ${sectionLabel(section)} for ${propertyName(propertyId)}` +
          (rewritten.length > 0 ? ' — the previous version was kept' : '')
      : // Filed behind a later record: worth saying plainly, because the
        // section on screen will not change and that looks like a failed save.
        `Backdated ${sectionLabel(section)} for ${propertyName(propertyId)} to ${effectiveFrom} — the version in force is unchanged`,
  );
  await load();
  return { inForce };
}

/** Deletes one historical record — for a mistake, not for tidying up. */
export async function deletePropertyDetail(id) {
  const record = state.propertyDetails.find((d) => d.id === id);
  if (record) {
    await log(
      'details',
      `Deleted a historical ${sectionLabel(record.section)} record for ${propertyName(record.propertyId)}`,
    );
  }
  await db.remove('propertyDetails', id);
  await load();
}

export function detailsFor(propertyId) {
  return state.propertyDetails.filter((r) => r.propertyId === propertyId);
}

// --- Compliance ---------------------------------------------------------

export async function saveComplianceType(type) {
  const before = state.complianceTypes.find((t) => t.id === type.id);
  await db.put('complianceTypes', type);
  await log('compliance', describeSave('Compliance type', before, type));
  await load();
}

/**
 * Deletes a compliance type and the completions logged against it — the same
 * detach-everything-referencing-it approach as deleteCategory. Without the
 * cascade those rows would sit in the store pointing at nothing, and the
 * backup validator would reject the next export.
 */
export async function deleteComplianceType(id) {
  const type = state.complianceTypes.find((t) => t.id === id);
  const { completions } = complianceTypeUsage(id);
  await log(
    'compliance',
    `Deleted compliance type ${type?.name ?? id}` +
      (completions > 0 ? `, and ${plural(completions, 'logged completion')}` : ''),
  );
  await db.remove('complianceTypes', id);
  for (const completion of completionsForType(state.complianceCompletions, id)) {
    await db.remove('complianceCompletions', completion.id);
  }
  await load();
}

/** How many logged completions a type would take with it if deleted. */
export function complianceTypeUsage(id) {
  return {
    completions: completionsForType(state.complianceCompletions, id).length,
  };
}

export async function saveComplianceCompletion({ propertyId, complianceTypeId, completedDate, reference, notes }) {
  await db.put('complianceCompletions', {
    id: db.newId(),
    propertyId,
    complianceTypeId,
    completedDate,
    reference: reference ?? '',
    notes: notes ?? '',
  });
  await log(
    'compliance',
    `Logged ${complianceTypeName(complianceTypeId)} for ${propertyName(propertyId)}, completed ${completedDate}`,
  );
  await load();
}

/** Deletes one logged completion — for correcting a mistaken entry. */
export async function deleteComplianceCompletion(id) {
  const entry = state.complianceCompletions.find((c) => c.id === id);
  if (entry) {
    await log(
      'compliance',
      `Removed the ${entry.completedDate} ${complianceTypeName(entry.complianceTypeId)} entry for ` +
        propertyName(entry.propertyId),
    );
  }
  await db.remove('complianceCompletions', id);
  await load();
}

/**
 * Marks a certificate as applying to a property, or not.
 *
 * Keyed by property and type rather than given a random id, so ticking the box
 * twice cannot leave two rows saying the same thing.
 */
export async function setComplianceExempt(propertyId, complianceTypeId, exempt) {
  const id = exemptionId(propertyId, complianceTypeId);
  if (exempt) await db.put('complianceExemptions', { id, propertyId, complianceTypeId });
  else await db.remove('complianceExemptions', id);
  await log(
    'compliance',
    `${complianceTypeName(complianceTypeId)} marked ${exempt ? 'not applicable' : 'applicable again'} for ` +
      propertyName(propertyId),
  );
  await load();
}

/**
 * The tax parameters behind the Summary estimate, with defaults filled in for
 * anything not yet set — including on a first run, when nothing is stored.
 */
export function taxSettings() {
  return withDefaults(state.settings.find((s) => s.id === 'tax'));
}

export async function saveTaxSettings(settings) {
  const before = taxSettings();
  const changed = Object.keys(settings).filter((key) => String(before[key]) !== String(settings[key]));
  await db.put('settings', { ...settings, id: 'tax' });
  if (changed.length > 0) await log('settings', `Changed tax settings: ${changed.join(', ')}`);
  await load();
}

// --- Rules --------------------------------------------------------------

export async function saveRule(rule) {
  const before = state.rules.find((r) => r.id === rule.id);
  await db.put('rules', rule);
  await log('rule', `${before ? 'Edited' : 'Added'} the rule matching “${rule.matchText}”`);
  await load();
}

export async function deleteRule(id) {
  const rule = state.rules.find((r) => r.id === id);
  await log('rule', `Deleted the rule matching “${rule?.matchText ?? id}”`);
  await db.remove('rules', id);
  await load();
}

/**
 * Re-runs the rule engine over stored transactions.
 * @returns {Promise<number>} how many transactions changed.
 */
export async function reapplyRules() {
  const updated = recategorise(state.transactions, state.rules);
  if (updated.length > 0) {
    await db.putMany('transactions', updated);
    await log('transaction', `Rules re-applied, recategorising ${plural(updated.length, 'transaction')}`);
    await load();
  }
  return updated.length;
}

// --- Transactions -------------------------------------------------------

export async function addTransactions(transactions) {
  await db.putMany('transactions', transactions);
  // One line for the import, not one per row: four hundred entries saying
  // "added a transaction" is a log nobody reads to the end of.
  const from = transactions[0]?.sourceFilename;
  await log(
    'transaction',
    `Imported ${plural(transactions.length, 'transaction')}${from ? ` from ${from}` : ''}`,
  );
  await load();
}

export async function updateTransaction(transaction) {
  const before = state.transactions.find((t) => t.id === transaction.id);
  await db.put('transactions', transaction);
  await log('transaction', describeTransactionEdit(before, transaction));
  await load();
}

export async function deleteTransaction(id) {
  const transaction = state.transactions.find((t) => t.id === id);
  await log(
    'transaction',
    `Deleted ${transaction ? `${transaction.date} ${transaction.details}` : 'a transaction'}`,
  );
  await db.remove('transactions', id);
  await load();
}

// --- Backup -------------------------------------------------------------

/**
 * Replaces everything with a validated document.
 *
 * Validation happens before the write, so a damaged file cannot half-import —
 * and it is the same check the merge output goes through, which is why this is
 * shared rather than being a restore-only path.
 *
 * It deliberately does *not* mark the state as backed up. A restore from a file
 * and a fast-forward from the cloud both are, but a **merge is not**: the merged
 * state is ahead of every copy that exists anywhere, and telling the user
 * otherwise would leave the only version of their reconciled data on one
 * machine with nothing saying so. Callers say which case they are.
 */
export async function applyDocument(raw) {
  await db.replaceAll(validateBackup(raw));
  await load();
}

export async function restoreBackup(raw) {
  await applyDocument(raw);
  // What was just restored *is* on disk somewhere — the file it came from — so
  // the freshly loaded state is not unbacked-up work.
  await markBackedUp();
}

export async function clearEverything() {
  await db.clearAll();
  await load();
}

/**
 * A digest of everything a backup would contain.
 *
 * FNV-1a over a canonical serialisation: fast enough to run on every load with
 * thousands of transactions, and it changes when any field of any record does
 * — which counting rows would not. Settings are excluded because the tax
 * parameters and the backup bookmark itself both live there, and recording a
 * backup would otherwise immediately invalidate it.
 */
function signatureOf(current) {
  let hash = 0x811c9dc5;
  const feed = (text) => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const key of BACKED_UP_STORES) {
    feed(key);
    for (const record of current[key]) feed(JSON.stringify(record));
  }
  return hash.toString(16);
}

const BACKED_UP_STORES = [
  'properties',
  'categories',
  'propertyDetails',
  'complianceTypes',
  'complianceCompletions',
  'complianceExemptions',
  'rules',
  'transactions',
];

/** When the last backup was taken, and of what. */
export function backupRecord() {
  return state.settings.find((s) => s.id === 'backup') ?? null;
}

/**
 * True when something has changed since the last backup was downloaded.
 *
 * A store that has never been backed up counts as pending only once there is
 * something in it — a brand new install with no data is not "unsaved work".
 */
export function backupPending() {
  const record = backupRecord();
  if (!record) return BACKED_UP_STORES.some((key) => state[key].length > 0);
  return record.signature !== signature;
}

/**
 * Records that the current state has been written to a file, and wipes the
 * change log.
 *
 * The log only ever answers "what has changed since the last backup", so once
 * there *is* a backup its contents are answered. Keeping them would turn a
 * short actionable list into an archive nobody reads, and the data itself is
 * already the history.
 */
export async function markBackedUp() {
  await db.put('settings', { id: 'backup', at: new Date().toISOString(), signature });
  for (const entry of state.changeLog) await db.remove('changeLog', entry.id);
  await load();
}

/** What has been edited since the last backup, newest first. */
export function changesSinceBackup() {
  return newestFirst(state.changeLog);
}

/**
 * Records an edit that did not come from one of the mutations above.
 *
 * Applying a merge replaces every store, which clears the change log with
 * them — leaving the tab dot saying there is unpushed work while the list
 * underneath says nothing has been edited. Sync uses this to put back the one
 * line that explains the state the app is actually in.
 */
export async function recordChange(kind, summary) {
  await log(kind, summary);
  await load();
}
