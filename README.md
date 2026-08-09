# Property Expenses

**Live app: https://dbeale.github.io/PropertyExpensesV2/**

A single-user, browser-only tool for categorising buy-to-let bank transactions, ready for UK Self
Assessment property income reporting.

Everything runs client-side. Statements are parsed in the browser, all data is stored in IndexedDB on
your own machine, and nothing is ever sent over the network. There is no backend, no account, and no
third-party service.

## Features

- **Import** — upload (or drag in) a bank statement CSV, with a preview before anything is saved.
  Rows already imported from an overlapping statement are flagged and skipped by default.
- **Review table** — editable Property and Category per row, filterable by text, date and status
  (auto-categorised by rule vs. needs manual review).
- **Rule engine** — rules match on any combination of Details text, Transaction Type and exact
  amount, and auto-fill Property and Category on import.
- **One-click rules from a transaction** — click **Rule** on any row to open an editor pre-filled
  from it, with a live count of how many transactions the rule would claim.
- **Split across properties** — a rule can divide one transaction between several properties (and
  categories) by exact amounts, with the shares required to total the transaction to the penny.
- **Rule management** — add, edit and delete rules; see the conditions each one sets, how many
  transactions it currently claims, and the order they are evaluated in.
- **Properties & categories** — add, rename and delete properties. Categories are editable too:
  rename them, describe what belongs in each, add your own, delete ones you don't use.
- **Non-property classification** — mark personal spending and transfers as **Not a property**, so
  they're classified rather than sitting in the review queue, and stay out of the property totals.
- **Backup** — download everything as one JSON file and restore from it. This is the safety net
  against browser storage being cleared.
- **Summary** — totals per property and category, filterable by date range or UK tax year
  (6 April – 5 April), exportable to CSV.
- **Export** — categorised transactions to CSV, with Property and Category columns appended, ready
  for Excel.

## Statement format

The expected header row is:

```
Date,Details,Transaction Type,In,Out,Balance
30/07/2026,DIRECT LINE FR BUS,Direct Debit,,30.16,16019.21
30/07/2026,NATWEST BANK,Direct Debit,,428.06,16049.37
24/07/2026,S Agyapong 3 PETERBOROUGH GAT,Inward Payment,1150.00,,16477.43
```

- Dates are DD/MM/YYYY.
- Exactly one of `In` (money received) or `Out` (money spent) is populated per row. Internally
  amounts are stored signed: **In is positive, Out is negative.**
- `Balance` is kept for reference but isn't used for categorisation.
- `Transaction Type` is free text from the bank. Rules match on `Details` by default, but can also
  require an exact Transaction Type.
- Quoted fields, embedded commas, CRLF endings and a UTF-8 BOM are all handled. An unexpected header
  or an unparseable row is reported with the offending line number, and nothing is imported.

## Categories

Categories start as five defaults — **Rent, Ins, Repairs, Interest, Management** — but they are your
data, not a fixed list. On the **Properties & categories** tab you can rename any of them, give each
a description of what belongs in it, add your own, and delete ones you don't use. A category's
description appears as a tooltip everywhere the category is offered, and on the Summary column
headings.

Renaming is safe: each category has an id that never changes, so transactions and rules already
pointing at it follow the rename. The five defaults are seeded with ids equal to their original names
(`Rent`, `Ins`, …), which is why data recorded before categories became editable keeps working with
no migration step.

Deleting a category deletes the rules that use it and unassigns the transactions that reference it —
the transactions themselves are kept. The table shows both counts before you confirm. The last
remaining category can't be deleted.

## Money that isn't property income

Not every line on a landlord's statement belongs to a property: personal spending, transfers between
your own accounts, a one-off that has nothing to do with the portfolio. Assign those to
**Not a property**, offered in the Property dropdown alongside your real properties, in the rule
editor, and as a share of a split.

Doing so *classifies* the transaction — it leaves the "needs review" count and stops nagging — while
keeping it out of the property figures:

- the Summary shows **Not a property** on its own line, below the properties, for completeness;
- it is **excluded from the "All properties" totals**, which is the figure a Self Assessment return
  needs;
- a split can send part of a transaction to a property and the rest to Not a property.

## How rules match

A rule sets up to three conditions, in **any combination**, and assigns a property and a category:

| Condition | Matches on                                       | Notes                                       |
| --------- | ------------------------------------------------ | ------------------------------------------- |
| Details   | the `Details` text                               | `contains` (default), `exact` or `regex`    |
| Type      | the `Transaction Type` column                    | exact, case-insensitive                     |
| Amount    | a signed **min–max range**, inclusive            | to the penny; expenses are negative         |

A transaction must satisfy **every** condition the rule sets; unticked conditions are ignored. At
least one condition is required — a rule with none would match everything, and is rejected.

### Amount ranges and jitter

The Amount condition is a range with both bounds inclusive. Building a rule from a transaction sets
**both bounds to that transaction's amount** — an exact pin, matching only that figure. Three buttons
widen it around the original amount:

| Button | For a −£30.16 direct debit | Use when                                      |
| ------ | -------------------------- | --------------------------------------------- |
| exact  | −30.16 to −30.16           | the amount never varies (a fixed mortgage)     |
| ±5%    | −31.67 to −28.65           | small drift — a rounding or index change       |
| ±10%   | −33.18 to −27.14           | an annual premium that moves a little          |

Bounds widen by magnitude, so an expense stays negative rather than flipping sign, and both ends land
on whole pence. You can also type either bound directly; entering them the wrong way round is
corrected on save. A range that crosses zero is rejected, since it would match income and expenses
alike.

A **tighter range is more specific**, so an exact pin still beats a ±10% range for the same payee,
and a narrow range beats a wide one. That keeps the disambiguation behaviour below intact even when
some rules are jittery.

### Creating a rule from a transaction

The fastest route. On the **Transactions** tab, click **Rule** on any row. The editor opens
pre-filled from that transaction — the **full `Details` text**, its Transaction Type, its exact
amount, and its current property and category. Tick whichever conditions you want and save. A live
counter shows how many of your stored transactions the rule would claim before you commit, and the
rule is applied to existing transactions immediately.

Match text defaults to the whole description so nothing from the row is lost. Under the box,
**Narrow to:** offers each informative word as a one-click shortcut (skipping banking noise like
`BANK`, `DIRECT`, `DEBIT`), plus a way back to the full description. For
`S Agyapong 3 PETERBOROUGH GAT` that means one click to `PETERBOROUGH` — useful when the tenant
reference varies between statements but the property name doesn't.

Assigning both Property and Category by hand on an uncategorised row opens the same editor
automatically, so the common case is one click.

### Evaluation order

Rules are tried **most specific first**, stopping at the first match. Specificity counts the
conditions set, weighting Amount highest, then Type, then Details. Rules of equal specificity are
tried in the order they were created. The Rules page lists them in exactly this order, numbered.

That ordering lets a narrow rule win over a looser one for the same payee. For example, with a lender
billing several properties under one name:

| Details        | Type | Amount                | Property   | Category |
| -------------- | ---- | --------------------- | ---------- | -------- |
| `NATWEST BANK` | any  | `-428.06` to `-428.06` | Property A | Interest |
| `NATWEST BANK` | any  | `-512.40` to `-512.40` | Property B | Interest |

A `NATWEST BANK` payment of £428.06 goes to Property A, £512.40 goes to Property B, and any other
amount is left **unassigned for manual review** rather than being guessed at.

When you build a rule from a transaction that an existing rule *for a different property* already
claims, the Amount condition is ticked for you and the editor says why — that collision is the signal
the payee is shared and needs pinning.

### Splitting one transaction across properties

Some payments cover more than one property — a single insurance direct debit, a shared service
charge. Tick **Split across properties** in the rule editor and enter the exact share each property
takes. Each row has its own property, category and amount, so a split can spread across categories
too, not just properties.

The editor will not let you save until the shares total the transaction exactly. A running
**Allocated £x of £y** line shows where you are; **Split evenly** divides the total and gives any odd
penny to the first row so the parts always reconcile.

**A split rule must be pinned to an exact amount** — not a range. Shares are fixed pounds and pence,
so the rule needs one known total to divide. Ticking Split turns Amount on and collapses the range to
a single value (the max box follows the min). If the same payee bills you a *different* amount next
month, that transaction won't match, and lands in Needs review where you can build a second rule for
it.

Split transactions are shown in the Transactions table with a **Split** badge and one line per share
(filter the status dropdown to **Split** to see them all). Editing one means editing the rule that
split it — the **Rule** button on a split row opens that rule directly. Assigning a Property or
Category by hand on a split row replaces the split with a single simple assignment.

Downstream, a split behaves as its parts:

- the **Summary** credits each property only its own share, and column totals are summed in whole
  pence so nothing drifts;
- the **CSV export** writes one row per share, each with its own In/Out amount, with `Balance` on the
  first row only — a running balance belongs to the transaction, not to a share of it;
- **backups** carry the allocations, and a restore is rejected if any split fails to sum to its
  transaction, rather than being silently repaired.

Deleting a property removes rules that reference it *and* unassigns transactions that mention it in a
split — the whole split, not just that share, since the remainder would no longer add up.

"Re-apply to all transactions" on the Rules page re-runs the engine over stored transactions.
Rows you assigned by hand are left alone; rows a rule assigned are updated, or cleared if no rule
claims them any more.

## Local development

There is no build step and no dependencies. The app is plain HTML, CSS and ES modules.

Serve the folder over HTTP — ES modules don't load from `file://`:

```bash
npx serve .          # or: python -m http.server 8000
```

Then open the URL it prints. Any static file server works.
`examples/statement-example.csv` holds the three sample rows if you want something to import.

### Tests

The parsing, rule-matching, import, backup and date logic live in DOM-free modules under `src/`,
tested with Node's built-in test runner. No install required:

```bash
node --test
```

These cover both acceptance cases: importing the three example rows with correct signs and dates,
saving a manual assignment as a text-only `PETERBOROUGH` rule that auto-categorises a later
statement, and the shared-payee disambiguation including the unmatched-amount case.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` runs on every push to `main`. It:

1. checks out the repo,
2. runs the tests on Node 20 (a failure stops the deploy),
3. copies `index.html`, `src/` and `.nojekyll` into `_site/`, leaving tests and docs out,
4. uploads that as a Pages artifact and deploys it.

The published site is **https://dbeale.github.io/PropertyExpensesV2/**.

One-time setup: in the repository settings, under **Pages → Build and deployment**, set **Source** to
**GitHub Actions**. Until that is set, `configure-pages` fails with `Get Pages site failed … Not
Found`. The first push to `main` afterwards publishes the site.

All asset paths are relative and navigation uses the URL hash (`#/transactions`), so the app works
unchanged at a repo subpath like `https://username.github.io/repo-name/` with no rewrite rules.

## Data and privacy

Data lives in this browser's IndexedDB under the origin the app is served from. It is not
synchronised anywhere.

- Clearing site data, "reset browser" tools, and some private-browsing modes will wipe it. **Download
  a backup from the Backup page regularly.**
- The same site served from a different origin (e.g. `localhost` vs. GitHub Pages) has separate
  storage. Move data between them with a backup file.

## Project layout

```
index.html            page shell
src/
  main.js             hash router and layout
  csv.js              CSV parsing/export, UK date and amount handling
  rules.js            rule conditions, matching and specificity ordering
  rule-draft.js       pre-fill and validation for the rule editor
  allocation.js       splitting a transaction across properties, in whole pence
  categories.js       default categories and the non-property sentinel
  importer.js         statement text -> transactions, duplicates, re-categorising
  store.js            in-memory state over IndexedDB
  db.js               IndexedDB wrapper
  backup.js           backup build and validation
  dates.js            tax year and date range helpers
  types.js            fixed categories and JSDoc typedefs
  dom.js              element builder and formatting helpers
  styles.css
  views/              one module per tab
tests/                Node test-runner suites
```
