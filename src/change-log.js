/**
 * What has been edited since the last backup.
 *
 * The Backup tab already knew *that* something had changed — a digest
 * comparison lights the dot on the tab. This is the other half: *what*
 * changed, so "back up before you clear your browser" becomes a decision you
 * can make on evidence rather than on a coloured dot.
 *
 * Two rules keep it readable rather than exhaustive:
 *
 *   - **One entry per action, not per record.** Importing a statement is one
 *     line saying how many rows arrived, not four hundred lines. A log you
 *     have to scroll is a log you do not read.
 *   - **Cleared when a backup is downloaded**, because the question it answers
 *     is only ever "since the last one". Nothing here is history; the data
 *     itself is the history.
 *
 * Pure functions over entries; the store owns the writing.
 */

/**
 * @typedef {object} ChangeEntry
 * @property {string} id
 * @property {string} at ISO timestamp
 * @property {string} kind what sort of record — 'transaction', 'property', …
 * @property {string} summary one line, in the user's terms
 */

/**
 * The most a log is allowed to grow to.
 *
 * A cap rather than unbounded growth: someone who imports for a year without
 * backing up should not carry a hundred thousand rows in IndexedDB to show a
 * list nobody will read to the end of. The oldest go first, and the screen
 * says so, which is more honest than silently keeping a partial list.
 */
export const MAX_ENTRIES = 400;

/** Newest first — the order the Backup screen shows them in. */
export function newestFirst(entries) {
  return [...entries].sort((a, b) => b.at.localeCompare(a.at));
}

/** The ids to drop to keep the log within MAX_ENTRIES. */
export function overflowIds(entries, limit = MAX_ENTRIES) {
  if (entries.length <= limit) return [];
  return newestFirst(entries)
    .slice(limit)
    .map((e) => e.id);
}

/**
 * Entries grouped by day, for a list that can be skimmed. A backup put off for
 * a fortnight otherwise reads as one undifferentiated column of timestamps.
 *
 * @returns {{day: string, entries: ChangeEntry[]}[]} newest day first
 */
export function byDay(entries) {
  const days = new Map();
  for (const entry of newestFirst(entries)) {
    const day = entry.at.slice(0, 10);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(entry);
  }
  return [...days].map(([day, dayEntries]) => ({ day, entries: dayEntries }));
}

/** "3 transactions" / "1 transaction" — the log is read, so it reads properly. */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
