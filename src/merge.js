/**
 * Reconciling two devices that have both moved on.
 *
 * The situation this exists for: both machines pull the same document, both
 * make edits, and now one of them wants to push. Detecting that is easy — the
 * gist's version has moved. The hard part is what to *do*, and the two obvious
 * answers are both wrong. "Overwrite" throws away whatever the other device
 * did. "Pull first" throws away whatever *this* device did, which is worse,
 * because those edits were never stored anywhere.
 *
 * So this does a proper three-way merge. It is possible because a gist is a git
 * repository: `history` gives us the **common ancestor** both devices started
 * from, which is the piece of information that turns "two documents disagree"
 * into "here is precisely who changed what". And it is *tractable* because of
 * how this app already stores things — every store is a flat set of records
 * keyed by `id`, with no ordering or relational structure to preserve beyond
 * referential ids.
 *
 * Almost every real conflict is disjoint: January's statement imported on the
 * laptop while a note is added on the phone. Those merge cleanly and silently.
 * A genuine collision needs the *same record* edited on both devices in the
 * same window, and for those there is no honest automatic answer — records
 * carry no universal "modified at", so "newest wins" cannot be determined. This
 * keeps the local copy and names what it overrode; the other version is still
 * in the gist's history.
 *
 * Pure functions; no DOM, no storage, no network.
 */

/**
 * The record arrays in a backup document, in the order `buildBackup` writes
 * them. `tests/merge.test.js` asserts this still matches what `buildBackup`
 * actually produces, so adding a tenth store cannot silently skip the merge.
 */
export const MERGED_STORES = [
  'properties',
  'categories',
  'propertyDetails',
  'complianceTypes',
  'complianceCompletions',
  'complianceExemptions',
  'settings',
  'rules',
  'transactions',
];

/**
 * Settings records that are device-local bookkeeping rather than data.
 *
 * The backup bookmark records *this machine's* last push — merging it would
 * hand one device the other's idea of what it had already saved.
 */
const LOCAL_ONLY_SETTINGS = new Set(['backup']);

/**
 * Which id fields point at which store, for repairing a merge that deleted a
 * parent on one side while the other added a child against it.
 */
const REFERENCES = [
  { store: 'propertyDetails', field: 'propertyId', parent: 'properties' },
  { store: 'complianceCompletions', field: 'propertyId', parent: 'properties' },
  { store: 'complianceCompletions', field: 'complianceTypeId', parent: 'complianceTypes' },
  { store: 'complianceExemptions', field: 'propertyId', parent: 'properties' },
  { store: 'complianceExemptions', field: 'complianceTypeId', parent: 'complianceTypes' },
  { store: 'rules', field: 'propertyId', parent: 'properties' },
  { store: 'rules', field: 'category', parent: 'categories' },
  { store: 'transactions', field: 'propertyId', parent: 'properties' },
  { store: 'transactions', field: 'category', parent: 'categories' },
];

/** Object keys sorted throughout, so key order never registers as an edit. */
function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalise(value[key])]),
    );
  }
  return value;
}

/**
 * Whether two records say the same thing.
 *
 * Arrays keep their order — the shares of a split are a sequence, not a set,
 * and reordering them really is a change.
 */
function same(a, b) {
  if (a === undefined || b === undefined) return a === b;
  return JSON.stringify(canonicalise(a)) === JSON.stringify(canonicalise(b));
}

function index(records) {
  const map = new Map();
  for (const record of records ?? []) {
    if (record && typeof record.id === 'string') map.set(record.id, record);
  }
  return map;
}

/** A record in words, for a report a person has to read. */
export function describeRecord(store, record) {
  if (!record) return '(deleted)';
  if (store === 'transactions') {
    return [record.date, record.details].filter(Boolean).join(' ') || record.id;
  }
  if (store === 'propertyDetails') return `${record.section ?? 'record'} for ${record.propertyId}`;
  if (store === 'rules') return record.matchText ? `rule matching “${record.matchText}”` : record.id;
  if (store === 'complianceCompletions') return `${record.complianceTypeId} on ${record.completedDate}`;
  return record.name ?? record.tenantName ?? record.id;
}

/**
 * Merges one store.
 *
 * The whole decision table lives here, one branch per row, in the order the
 * cases are easiest to reason about: additions, then deletions, then edits.
 */
function mergeStore(store, baseList, mineList, theirsList, report) {
  const base = index(baseList);
  const mine = index(mineList);
  const theirs = index(theirsList);

  // Local order first so a merge does not reshuffle the user's data, then
  // whatever the other device added. Deterministic, which keeps tests honest.
  const ids = [...mine.keys(), ...[...theirs.keys()].filter((id) => !mine.has(id))];
  const merged = [];

  const collide = (id, record, reason) =>
    report.collisions.push({ store, id, label: describeRecord(store, record), reason });
  const resurrect = (id, record, reason) =>
    report.resurrected.push({ store, id, label: describeRecord(store, record), reason });

  for (const id of ids) {
    const b = base.get(id);
    const m = mine.get(id);
    const t = theirs.get(id);

    // Device-local bookkeeping never crosses between machines.
    if (store === 'settings' && LOCAL_ONLY_SETTINGS.has(id)) {
      if (m) merged.push(m);
      continue;
    }

    if (!b) {
      // Neither of us started with it.
      if (m && !t) merged.push(m);
      else if (!m && t) {
        merged.push(t);
        report.fromTheirs += 1;
      } else if (m && t) {
        // Both invented the same id. Random UUIDs make this vanishingly
        // unlikely, but the seeded categories share fixed ids across devices.
        merged.push(m);
        if (!same(m, t)) collide(id, m, 'added on both devices with different contents');
      }
      continue;
    }

    if (!m && !t) continue; // Both deleted it. Nothing to do.

    if (m && !t) {
      if (same(m, b)) continue; // They deleted it and I never touched it.
      merged.push(m);
      resurrect(id, m, 'deleted on the other device, but edited here');
      continue;
    }

    if (!m && t) {
      if (same(t, b)) continue; // I deleted it and they never touched it.
      merged.push(t);
      report.fromTheirs += 1;
      resurrect(id, t, 'deleted here, but edited on the other device');
      continue;
    }

    // Present everywhere: whoever moved away from the ancestor wins.
    if (same(m, t)) merged.push(m);
    else if (same(m, b)) {
      merged.push(t);
      report.fromTheirs += 1;
    } else if (same(t, b)) {
      merged.push(m);
      report.fromMine += 1;
    } else {
      merged.push(m);
      report.fromMine += 1;
      collide(id, m, 'edited on both devices');
    }
  }

  return merged;
}

/**
 * Puts back any parent record a merge orphaned.
 *
 * The case: a property is deleted here while the other device adds a
 * transaction against it. Each side is internally consistent, but the merge of
 * the two is not — and `validateBackup` would reject the whole document rather
 * than import a transaction pointing at nothing. Restoring the parent is the
 * answer that loses nobody's work; the alternative is discarding the new
 * transactions, which is exactly what this module exists to avoid.
 */
function repairReferences(document, sources, report) {
  for (const { store, field, parent } of REFERENCES) {
    const present = new Set(document[parent].map((record) => record.id));
    const wanted = new Set();

    for (const record of document[store]) {
      for (const value of [record[field], ...(record.allocations ?? []).map((a) => a[field])]) {
        // Null is "unassigned", and the non-property sentinel belongs to no
        // store — neither is a dangling reference.
        if (typeof value === 'string' && value !== '' && !value.startsWith('__') && !present.has(value)) {
          wanted.add(value);
        }
      }
    }

    for (const id of wanted) {
      const found = sources.map((source) => index(source[parent]).get(id)).find(Boolean);
      if (!found) continue; // Already dangling before the merge; not ours to invent.
      document[parent].push(found);
      present.add(id);
      report.resurrected.push({
        store: parent,
        id,
        label: describeRecord(parent, found),
        reason: `deleted here, but still used by ${store} on the other device`,
      });
    }
  }
}

/**
 * @typedef {object} MergeReport
 * @property {object} document the merged backup document
 * @property {number} fromMine records where this device's version won
 * @property {number} fromTheirs records taken from the other device
 * @property {{store: string, id: string, label: string, reason: string}[]} collisions
 *   edited on both sides; this device's version was kept
 * @property {{store: string, id: string, label: string, reason: string}[]} resurrected
 *   records put back rather than being silently destroyed
 */

/**
 * Three-way merge of two backup documents against their common ancestor.
 *
 * @param {object} base the ancestor both devices started from
 * @param {object} mine this device
 * @param {object} theirs the remote head
 * @param {{at?: string}} [options] the timestamp to stamp the result with
 * @returns {MergeReport}
 */
export function mergeDocuments(base, mine, theirs, { at = new Date().toISOString() } = {}) {
  const report = { fromMine: 0, fromTheirs: 0, collisions: [], resurrected: [] };

  const document = {
    format: mine.format ?? theirs.format,
    // The newer writer's format wins: it understands at least as much as the
    // older one, and validateBackup tolerates a document missing a store.
    version: Math.max(Number(mine.version) || 0, Number(theirs.version) || 0),
    exportedAt: at,
  };

  for (const store of MERGED_STORES) {
    document[store] = mergeStore(store, base?.[store], mine?.[store], theirs?.[store], report);
  }

  repairReferences(document, [theirs, base].filter(Boolean), report);

  return { document, ...report };
}
