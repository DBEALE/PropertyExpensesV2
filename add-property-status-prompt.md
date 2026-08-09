Turn the property page into the one screen that shows whether a property needs anything from me: recurring payments that look like they've stopped (rent, insurance, mortgage), and compliance items coming due (gas safety, electrical, etc.).

Read the existing code first — this builds on what's already there rather than replacing it. In particular: `accounts.js` (`paymentStreams`, `isOverdue`, `sharesFor`), `property-details.js` (`upcomingDates`, the `SECTIONS` dated-record pattern), `categories.js` (seeded-defaults-but-editable pattern), `store.js` (the CRUD + `load()` conventions), `db.js` (the object-store/version pattern), and `backup.js` (the validate-and-reject-malformed pattern). Match these conventions exactly rather than introducing a new style.

## Part 1 — embed recurring payment status on the property page

`views/property.js` already imports `accountSummary, sharesFor` from `accounts.js` but doesn't use `paymentStreams`/`isOverdue`. Add a section to the property page, after the headline tiles, listing that property's recurring payment streams (`paymentStreams(sharesFor(transactions, propertyId), today)`, filtered to `stream.recurring`): label, typical day of month, last received date, next expected date. Flag any stream where `isOverdue(stream, today)` is true — distinctly, not just another row (the point of this section is "rent hasn't come in this month" being impossible to miss).

This is a straight reuse of existing logic already driving the Accounts tab's recurring section — don't duplicate the detection, just render it here too, scoped to this property.

## Part 2 — compliance tracking (new)

Gas safety certificates, EICRs, PAT testing and similar don't show up reliably in bank statement text, don't recur monthly, and their frequency varies by type — so unlike rent or insurance, these can't be inferred from transactions. They need an explicit, manually-logged record.

**Data model — two new stores**, following the `categories`/`propertyDetails` pattern already in `db.js` and `store.js`:

- `complianceTypes` — `{ id, name, frequencyMonths, description }`. Shared across all properties, like categories: seeded with defaults on first load if empty, then user-editable (rename, change frequency, add, delete), mirroring `categories.js` exactly (`DEFAULT_COMPLIANCE_TYPES`, `id === slug-of-name` so old references survive a rename, same `categoryIdFor`-style id helper).

  Seed with:
  - Gas Safety Certificate — 12 months
  - EICR (Electrical Installation Condition Report) — 60 months
  - PAT Testing — 12 months
  - Legionella Risk Assessment — 24 months

- `complianceCompletions` — `{ id, propertyId, complianceTypeId, completedDate, reference, notes }`. One row per time an inspection/certificate was actually done. Deliberately **no cost field and no link to a transaction** — the payment for it still gets categorised normally in Transactions (typically as Repairs); this store is a schedule, not a ledger. Keep those concerns separate.

Bump `DB_VERSION` in `db.js`, add both stores to `STORES`, comment the version bump the same way the existing `v2`/`v3` comments do.

**New pure module `compliance.js`** (DOM-free, tested with Node's test runner like `accounts.js`):
- `nextDue(lastCompletedDate, frequencyMonths)` — reuse the month-arithmetic already written as `addMonths` in `accounts.js`. Extract it into `dates.js` (which already holds the other shared date helpers) and have both `accounts.js` and `compliance.js` import it from there rather than duplicating it.
- `complianceStatus(types, completions, propertyId, today)` — for each type, find the most recent completion for that property, compute `nextDue`, and flag overdue (`nextDue < today`). A type with no completions yet has no next-due date — flag it as "never recorded" rather than computing a bogus date from nothing.
- `upcomingCompliance(types, completions, propertyId, today, withinDays = 90)` — same shape and window as `upcomingDates` in `property-details.js`, so the two can be merged into one sorted list.

**store.js**: add `complianceTypes: []` and `complianceCompletions: []` to `state`, load both in `load()`, seed `complianceTypes` from `DEFAULT_COMPLIANCE_TYPES` when empty (same block shape as the existing category-seeding code). Add `saveComplianceType`, `deleteComplianceType` (also delete completions referencing it — mirror how `deleteCategory` detaches rules/transactions), `saveComplianceCompletion`, `deleteComplianceCompletion` (for correcting a mistaken entry, same spirit as `deletePropertyDetail`).

**backup.js**: include `complianceTypes` and `complianceCompletions` in `buildBackup`, and validate both in `validateBackup` with the same reject-rather-than-repair approach as the rest of the file (well-formed check, then a length comparison against the raw array, throwing `BackupFormatError` on mismatch). Bump the backup `version` number.

## Part 3 — one combined "Coming up" banner

`property-details.js`'s `upcomingDates()` currently only watches four hardcoded fields (fixed-rate end, mortgage term end, insurance renewal, tenancy end). In `views/property.js`, merge that list with `upcomingCompliance(...)` for this property and any overdue recurring-payment streams from Part 1, into one sorted-by-date list. Overdue payments and overdue compliance items should read differently from merely-upcoming dates (e.g. "Gas Safety Certificate — overdue since 12 Jul" vs "Insurance renewal — 3 Sep") — the existing banner already distinguishes nothing, so this is a small but real change to how it's styled, not just what feeds it.

## Part 4 — compliance types management UI

Add compliance type management (add, rename, change frequency, delete) to the existing Properties & categories tab, next to category editing — it's shared reference data in the same sense categories are, and that tab is already the natural home for it. Follow the existing category-editing UI pattern in that view.

On the property page itself, each compliance type gets a "Log completion" action (date, optional reference, optional notes) that calls `saveComplianceCompletion`.

## Explicitly out of scope for this change

- No portfolio-wide "everything due across all properties" view yet — this is property-page only. (Worth flagging as a natural follow-up once this is in, but don't build it now.)
- No linking a compliance completion to a transaction/cost.
- No change to how `paymentStreams`/`isOverdue` detect recurring payments — Part 1 is display-only reuse.

## Tests

Add `tests/compliance.test.js`, DOM-free, in the style of the existing test files:
- `nextDue` handles month-end clamping the same way `addMonths` already does (verify against whatever test already covers `addMonths`'s Feb clamping, if one exists, so behaviour doesn't regress).
- A type with one completion and a 12-month frequency: `nextDue` a year later; overdue is true once `today` passes that date, false the day before.
- A type with no completions: `complianceStatus` reports it as never recorded, not overdue with a fabricated date.
- Deleting a compliance type removes its completions and doesn't throw if none exist.
- Backup round-trip: build a backup with compliance data, validate it, confirm both stores survive; confirm a backup with a completion referencing an unknown `complianceTypeId` is rejected the same way an unknown category reference already is.

## Acceptance check

Seed a property with a Gas Safety Certificate completion dated a year and two weeks ago (12-month frequency): the property page should show it overdue by roughly two weeks, and it should appear in the "Coming up" banner marked as overdue rather than upcoming. Log a new completion dated today: the overdue flag clears and next due becomes a year from today. Separately, import a statement with two months of rent for a property, then a third month with no matching transaction: the property page's recurring-payments section should flag rent as overdue, using the existing `isOverdue` logic unchanged.
