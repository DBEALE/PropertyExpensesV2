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
- **Review table** — editable Property and Category per row, filterable by text, property, category,
  date and status (auto-categorised by rule vs. needs manual review), sortable on every column.
- **Notes** — an optional note of your own on any transaction, shown wherever that transaction is
  and included in the CSV export.
- **Rule engine** — rules match on any combination of Details text, Transaction Type and exact
  amount, and auto-fill Property and Category on import.
- **One-click rules from a transaction** — click **Rule** on any row to open an editor pre-filled
  from it, with a live count of how many transactions the rule would claim.
- **Split across properties** — a rule can divide one transaction between several properties (and
  categories) by exact amounts, with the shares required to total the transaction to the penny.
- **Rule management** — add, edit and delete rules; see the conditions each one sets, how many
  transactions it currently claims, and the order they are evaluated in.
- **Config** — add, rename and delete properties; edit categories and compliance types. Everything
  shared across the app is set up here.
- **Properties** — a portfolio overview (value, LTV, equity, net, what needs attention) that drills
  into one page per property: cashflow chart, monthly breakdown, recurring payments, compliance,
  records and its transactions.
- **Non-property classification** — mark personal spending and transfers as **Not a property**, so
  they're classified rather than sitting in the review queue, and stay out of the property totals.
- **Backup** — download everything as one JSON file and restore from it. This is the safety net
  against browser storage being cleared. The tab carries a dot whenever anything has changed since
  your last download.
- **Property status** — each property's page flags what needs doing: recurring payments that have
  stopped arriving, compliance certificates (gas safety, EICR, PAT, legionella) overdue or due
  within 30 days, and records you have not filled in yet. The count sits on the Properties tab.
- **What's new** — a changelog of the app itself, at the far right of the tab row.
- **Colour and icon identity** — every property and category carries a colour and an icon, chosen on
  Config and used consistently on every screen.
- **Change log** — the Backup tab lists what you have edited since your last download, cleared when
  you take a new one.
- **Summary** — totals per property and category, filterable by date range or UK tax year
  (6 April – 5 April), exportable to CSV, with an income tax estimate that handles the 20% finance
  cost credit.
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

## Property records

The **Properties** tab opens on a **cross-property overview**: one row per property with its value,
mortgage, LTV, equity, **net income for the tax year in progress**, anything needing attention, and
the next thing falling due, with portfolio totals and an overall LTV in the footer. The net column
is named for the year it covers ("Net income 2026/27") and counts only statements dated inside it —
on this screen the question is how the portfolio is doing *now*, and a lifetime total quietly
answers a different one. Anything overdue anywhere
is called out in a banner at the top, so this doubles as the portfolio-wide "what's due everywhere"
view. Columns sort like every other table.

Below it, three more cross-property tables:

- **Insurance** — provider, cover level, premium and renewal date per property, with a count of any
  properties that have none recorded.
- **Tenancies** — tenant, rent, deposit, end date and letting agent.
- **Compliance** — properties down the side, compliance types across the top, each cell the date that
  certificate next falls due there. Reading a *column* answers "which properties need a gas safety
  check", which is the question that actually gets asked.

Dates in all three colour themselves the same way: red and labelled **Overdue** once past, badged
**Due soon** within 30 days, tinted amber within three months, plain otherwise. Anything not yet
recorded says so rather than showing a blank or a made-up date; a certificate marked not applicable
reads **N/A**. Every table sorts, and every property name drills in — to the panel that holds what
you clicked, as described under [Getting between screens](#getting-between-screens).

**Click a property name to drill into it.** The dropdown that titles the property page switches
between properties, and its first entry comes back here.

The tab returns you to wherever you left it: the overview on a first visit, or the property you were
reading. The id sits in the URL (`#/properties/<id>`), so a refresh or a bookmark comes back to the
same place. An id that no longer exists drops to the overview rather than silently showing a
different property's figures.

Alongside the figures, each property page holds everything you need about it beyond the bank
statements:

| Section | Records |
| --- | --- |
| Address | full address and notes |
| Insurance | provider, policy number, cover level, premium, renewal date, login page, username |
| Mortgage | lender, account, balance, rate and type, fixed-rate end, monthly payment and day, term end, login page, username, broker |
| Valuation | market value and date, source, purchase price and date |
| Tenancy | tenant and contact details, dates, rent and due day, deposit amount/scheme/reference, letting agent |

These five live together under the property page's **Overview** panel — the first one, because what
this place *is* comes before what it cost — each showing the current record with its history
underneath. Anything falling due within 90 days — a fixed rate ending, an insurance renewal, a
tenancy ending — is flagged at the top of the page regardless of which panel is open.

A section heading is just its name and a Change link. It used to carry a one-line summary beside it,
which restated the first row or two of the record printed directly below: "Halifax · 3.89%" above a
tile whose first lines are Lender: Halifax, Interest rate: 3.89%.

The property page leads with the **property switcher as its title**: it already names the property
you are reading, so a heading beside it only said the same thing twice. Its first entry is
**Overview — all properties**, which is how you get back to the portfolio table; there is no
separate back link, because the switcher is already the control you reach for to change what you are
looking at, and "everything" is one of the choices. **LTV** and **equity**, computed from the
mortgage balance and the latest valuation, are on the all-properties table rather than repeated in a
row of headline panels above every property page.

### Does this property need anything from me?

The top of the property page answers that in one place.

One banner, in **four grades**, because they are four different kinds of fact and mixing them is how
a warning gets ignored:

| Grade | What it means | How it reads |
| --- | --- | --- |
| **Needs attention** | a payment that never arrived, or a date that has passed and left the property exposed | red `Overdue` badge — "Gas Safety — due 14/06/2026, 59 days ago", "Insurance cover lapsed — due 01/07/2026, 45 days ago" |
| **Due within 30 days** | a certificate or a policy about to lapse | yellow `Due soon` badge — "Insurance cover expires — 26/08/2026, in 11 days" |
| **Coming up** | anything else falling due inside 90 days | plain text — "Tenancy ends — 30/09/2026" |
| **Still to add** | a record section with nothing in it | a prompt with a link to the Overview panel |

The 30-day grade is the one worth explaining: 28 days to book a gas engineer is a different kind of
fact from 80 days, and the old banner put both in the same list. The boundary is one constant
(`DUE_SOON_DAYS`, in `dates.js` since two domains now watch it) shared by the banner, the compliance
table, the portfolio overview and the tab badge, so "due soon" means one thing everywhere.

#### What counts as passing, and what counts as lapsing

Not every date going by is a problem, so `WATCHED_DATES` in `property-details.js` marks the ones
that leave the property **exposed** rather than merely marking an event:

- **Insurance renewal** lapses. Past that date the house is uninsured, which is a fault to chase, so
  it turns red, counts on the badge, and **stays on the list however long ago it went** — exactly as
  an overdue certificate does. A renewal inside 30 days is the yellow warning instead. Each state
  renames the item: "Insurance renewal" is a diary entry, "Insurance cover lapsed" is the problem it
  became.
- **A fixed rate ending** or **a tenancy reaching its end date** does not. The property is no worse
  off for it, so those simply drop off the list once they are behind you rather than sitting there
  in red forever.

**Still to add** is a prompt, not a deadline, and is deliberately **not counted** in the tab badge.
A property whose insurance you have chosen not to record would otherwise carry a number that can
never reach zero, which is how a badge teaches people to stop reading it.

Everything here is counted once, in `src/attention.js`, and rendered from that. Four places used to
work it out separately — the tab badge, the property banner, the overview's attention list and its
Attention column — and they could disagree.

#### Things that don't apply

Two escape hatches, both for the same reason: a reminder you cannot clear is a reminder you learn to
scroll past.

- **A certificate that doesn't apply** — tick the **N/A** box on the compliance table. Gas safety on
  an all-electric flat stops being counted, chased or listed, and the row stays visible (dimmed,
  reading "Not applicable") so the decision can be found and reversed. Per property, not global.
- **A property with no mortgage** — tick **Owned outright** in the Mortgage section. It stops
  prompting for mortgage details, and LTV reads `0%` rather than an em dash, because a known
  borrowing of nothing is a figure and not a missing one.

### One section at a time

Under the banner is a strip of five panels — **Monthly breakdown**, **Recurring payments**,
**Compliance**, **Transactions**, **Overview** — of which exactly one is open at a time, its content
filling the page below.

Each panel carries a line of **summary under its title**, and that is the point of them. The page
used to run all five sections down the screen, which meant the compliance table sat three scrolls
below the banner telling you to look at it. Now the strip is a set of *answers* rather than a set of
destinations, and most visits should end at the summary without opening anything:

| Panel | Reads like |
| --- | --- |
| Monthly breakdown | `18 of 19 months' rent received · £7,790 Interest · £1,100 Repairs · net £10,432` |
| Recurring payments | `1 repeating payment · 1 overdue` |
| Compliance | `3 certificates tracked · 1 due within 30 days · 2 never logged` |
| Transactions | `15 transactions · of 68 in total · latest 30/07/2026` |
| Overview | `Insurance, Mortgage, Valuation and Tenancy recorded · Address not recorded` |

Each leads with the figure that would otherwise have to be counted by eye — how many months' rent
actually arrived, which certificates have lapsed, which records are missing — rather than with how
many rows the table has. Costs are shown unsigned, because the category name already says the money
went out. Every summary describes what its own panel would show **including its filters**, so
opening one never contradicts the line that made you open it — which is why the Transactions
summary says "15 of 68" rather than quietly reporting the lifetime count.

The **Overview** panel holds the five dated record sections, address through tenancy, laid out as
**tiles** rather than a column five screens tall: an overview *of the property*, as distinct from
the portfolio overview at the top of the switcher. Whichever section you are editing takes the full
width, because a form squeezed into a third of a row is worse than a row that momentarily reflows.

They are real tabs: arrow keys move along the strip, only the open one is in the tab order, and
focus follows the selection.

**Monthly breakdown** — the Summary tab's matrix pivoted for this property: categories across the
top, one row per month, with a Net column and a totals row. Every month between the first and last
transaction is listed, **including empty ones** — a month where the rent never arrived is only
obvious if the blank row is actually on screen. Categories this property never uses are left out
rather than trailing an empty column down the page, and columns sort like everywhere else, so
clicking *Repairs* ranks the months by what they cost.

It carries the same date-range control as the Transactions tab — the shortcut dropdown plus the two
dates — as does the property's own **Transactions** panel. The year shortcuts on both list only the
years **this property** has transactions in, rather than every year in the file.

Both open on the **tax year in progress**, as does the Summary tab. Defaulting to all dates made
every figure a lifetime total, which is almost never the question: widening the range is one click,
whereas noticing that a number quietly covered eleven years is not.

**Cashflow** — money in and out per month as stacked columns by category, on a single axis, sitting
inside the monthly breakdown between the date control and the table and stretching the full width of
the page. Hover or keyboard-focus a block for its figure; past eight categories the smallest fold
into a neutral "Other", and the breakdown table below still itemises every one.

A dark line across the columns is the **net** of each month. The stack already showed income above
the line and costs below it, but the *difference* — the figure that actually matters — was left to
be eyeballed, or read off two floating labels that only ever annotated two of the months. The line
states it for every bucket and makes the trend legible, which two numbers never could. It is drawn
in ink rather than a palette colour: it is not one series among the others, it is what the others
add up to, and borrowing a categorical hue would imply a category.

The date range drives **both** the chart and the table. It used to drive only the table, with the
chart always showing the full history — which meant picking a tax year moved the figures and left
the picture behind, quietly inviting you to read two different periods as one.

**Recurring payments** — repeats are found by grouping transactions by the rule that categorised
them (or by payee where no rule applies), keeping anything seen twice or more about a month apart.
Each shows its typical amount, the day of the month it usually lands on, when it last arrived and
when the next is expected. Anything overdue is flagged on its own row as well as in the banner.

Expected dates are inferred from your imported statements, not fetched from the bank: they are an
estimate, and the page says so. One-off payments get no forecast rather than a bogus schedule.

A payment that has been missing for a while reads as **Stopped**, not overdue, and is left out of
the attention count. Two things retire one:

- **silence beyond three months** — a tenant who left is not five months in arrears, and the same
  applies to an insurer you switched or a lender you remortgaged away from;
- **a tenancy that began after its last payment** — money coming *in* that stopped before the
  current tenancy started belonged to the previous tenant, which your tenancy record already says.
  This applies to income only: a new tenancy tells you nothing about the mortgage.

Anything genuinely late — one or two payments missed — is still flagged as before.

**Transactions** — this property's rows, read-only, with a category filter. Columns sort as they do
everywhere, and the `By rule` badge still jumps to the rule. To change an assignment, use the
Transactions tab — the link is right there.

**Compliance** — gas safety certificates, EICRs and the like. These can't be inferred from a bank
statement: they don't appear reliably in payee text, don't recur monthly, and their frequency varies
by type. So each is logged explicitly with **Log completion** (date, optional certificate reference,
optional notes), and the next due date is computed from the last one plus the type's frequency.

A type never logged against a property reads **never recorded** rather than being given a due date
computed from nothing — a fabricated deadline is worse than an obvious gap.

There is deliberately **no cost field and no link to a transaction** on a completion. The invoice for
an inspection is categorised in Transactions like any other expense; this is a schedule, not a
ledger, and keeping them apart stops the same money being counted twice.

### Compliance types

Shared across every property and edited on the **Config** tab, alongside categories
— same pattern, same reasons. Seeded with Gas Safety Certificate (12 months), EICR (60), PAT Testing
(12) and Legionella Risk Assessment (24), then yours to rename, re-time, add to or delete. Ids are
the slug of the original name, so a rename never orphans the completions logged against it. Deleting
a type also removes its completions, and says how many before you confirm.

Overdue compliance across the whole portfolio is surfaced on the Properties overview, alongside
rent that has stopped arriving.

### Nothing is overwritten

Every section is a **dated record**, not a set of fields. When you change one you give the date the
new version takes effect; the previous version is stamped with that date and kept, marked **Expired**
under *Previous versions*. So the rent that was £1,100 until June 2026 and £1,150 after it is still
answerable next January, which is what a tax return actually asks.

Records are per-section, so changing the mortgage doesn't touch the tenancy history. A replacement
can't be dated before the version it replaces.

### No passwords

The login **page** and **username** are recorded for insurance and mortgage accounts; there is
deliberately **no password field anywhere**. IndexedDB is not encrypted and the backup file is plain
JSON, so a password stored here would sit in clear text on your disk and in every backup you make.
Keep passwords in a password manager. (A test asserts no such field exists, so this can't be
reintroduced by accident.)

## Categories

Categories start as five defaults — **Rent, Ins, Repairs, Interest, Management** — but they are your
data, not a fixed list. On the **Config** tab you can rename any of them, give each
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

## Colours and icons

Every property and category carries an **icon in one of eight fixed colours**, shown beside its name
everywhere it appears — the transactions table, rules, the import preview, the summary, and the
cashflow chart. Change either on the **Config** tab and it changes everywhere at once.

The palette is a fixed set of eight rather than a free colour picker, and that is deliberate:

- the eight hues and their **order** are what keep the set distinguishable under colourblindness, and
  are validated against this app's own light and dark surfaces (`node scripts/validate_palette.js`
  in the dataviz skill). An arbitrary hex would quietly break that;
- each slot carries a **separate step for dark mode**, chosen for a dark surface rather than
  algorithmically inverted;
- three of the light-mode slots sit below 3:1 against the surface, so **a swatch never appears
  without its name**, and every chart ships a table view. Colour is a fast second channel, never the
  only one.

New properties and categories take the next unused slot, so a small portfolio gets the
best-separated colours first. Records created before colours existed get a stable colour derived
from their id, so nothing is ever uncoloured and nothing shifts between sessions.

### The icon bank

**Four** for properties — House, Flat, Bungalow, Mansion — and **ten** for categories: Key (rent),
Shield (insurance), Nut (repairs), Percent (interest), Briefcase (management), Bolt (utilities),
Droplet (water), Tree (grounds), Document (fees), Tag (other). The first five match the seeded
categories, so the marks are right before anyone picks anything.

They are drawn in `src/icons.js` as SVG path data — no network, no image files, nothing to 404 when
the app is served from a repo subpath or opened offline. Every one is a *filled* shape with no
strokes, so a single CSS rule (`fill: var(--entity)`) tints the whole set from the record's palette
slot: change the colour and the icon follows without anything being regenerated.

Holes — windows, doorways, the eye of a key — are extra subpaths cut with `fill-rule: evenodd`
rather than painted in the surface colour, which would break the moment the surface changed: dark
mode, a highlighted row, a chart background.

The icon is a **second channel beside the colour, never a replacement for the name**. Three of the
light-mode slots sit below 3:1 against the surface, so the name always travels with the mark, and
`iconOf` always returns something — a portfolio where three properties have a mark and two have a
plain square reads as a bug rather than a choice. A stored icon that is no longer in the bank (an
old backup, a changed set) falls back rather than rendering nothing.

The **browser tab icon** is the same house, in the palette's red slot, at `favicon.svg`. It is a
static file rather than something generated at runtime, because a bookmark, a history entry and a
tab that has not finished loading all want an icon before any script runs — which does mean the path
data lives in two places, so `tests/favicon.test.js` asserts the two still agree. The SVG carries
its own `prefers-color-scheme` rule and switches between the red slot's light and dark steps:
browser chrome is a surface like any other.

**Category columns wear their mark in the heading** — on the Summary table and in a property's
Monthly breakdown — so a column of figures is identifiable without reading, and matches the chart
legend directly above the breakdown. The heading becomes an inline flex row rather than an inline
icon, so a long category name wrapping in a narrow numeric column takes its mark with it instead of
orphaning it on the line above.

## Tax estimate

The **Summary** tab estimates the income tax due on the property profit for whatever date range is
selected — so picking a tax year gives you that year's likely bill.

The rule worth encoding is **mortgage interest**. Since 2020/21 it is not an allowable expense: it
does not reduce the profit, and instead earns a **20% tax credit**, capped at the lowest of

- the finance costs themselves,
- the property profit, and
- your income above the personal allowance.

That cap is why a heavily mortgaged portfolio can be taxed on a profit it never really made, and why
any interest that can't be used is reported rather than quietly dropped.

Property profit is stacked **on top of your other income**, so it is taxed in the band it actually
lands in — a profit that straddles two bands is split across them, and the effective rate is shown
alongside so a headline band figure can't mislead.

### It shows its working

Every line of the estimate carries the sum behind it, in your own figures rather than in the
abstract — "£18,400 income − £5,120 expenses = £13,280", "tax on £58,280 is £11,142; tax on £45,000
alone is £6,486; £11,142 − £6,486 = £4,656". The finance-cost credit names all three figures it is
capped by and says which one won. The point is that you can check a number rather than trust it, and
that a surprising result explains itself instead of needing to be reverse-engineered.

### The figures it asks for

Under **Your figures**:

| Parameter | Why it's needed |
| --- | --- |
| Other income | Salary, pension and so on — decides which band the profit falls in |
| Your share % | For a jointly owned portfolio |
| Mortgage interest is… | Which category holds finance costs, since categories are editable |
| Use the £1,000 property allowance | Claimed *instead of* actual expenses, so it only helps when expenses are smaller |

Under **Allowances and bands**, every threshold and rate is editable: personal allowance, basic band
width, additional-rate threshold, the three rates, the credit rate and the property allowance. They
default to the 2025/26 figures. The allowance taper above £100,000 is applied automatically.

Everything is saved, so you only enter it once.

**Bands are England, Wales and Northern Ireland.** Scotland sets its own rates on non-savings income
— you can type those in, but the band *structure* here is the rUK one. This is an estimate to plan
with, not a tax return, and not advice.

## Money that isn't property income

Not every line on a landlord's statement belongs to a property: personal spending, transfers between
your own accounts, a one-off that has nothing to do with the portfolio. Assign those to
**Not a property**, offered in the Property dropdown alongside your real properties, in the rule
editor, and as a share of a split.

Doing so *classifies* the transaction — it **leaves the "needs review" count immediately**, with no
category needed, since money that never reaches the property accounts doesn't need categorising —
while staying out of the property figures:

- it is **excluded from the "All properties" totals**, which is the figure a Self Assessment return
  needs;
- the Summary hides it by default, behind an **Include not a property** tick box. It was never in
  the totals, so the row made the table longer without changing an answer. When there *is* such
  money and the box is off, a line under the table says how much is being left out — a total that
  quietly does not reconcile with your statement is worse than one extra row;
- ticked, it appears on its own line pinned below the properties, still outside the totals;
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

Finishing a manual assignment **asks** whether you want a rule rather than opening the editor
uninvited — most hand edits are one-offs. Answer yes and the pre-filled editor opens.

### Date ranges

Every screen with a date filter — Transactions, Summary, and the property Monthly breakdown — has
the same control: a shortcut
dropdown followed by the two dates it fills in. The dates stay visible and editable; the dropdown is
a shortcut, not a replacement, and typing a range by hand flips it to **Custom range** so it never
claims a range it isn't showing.

The shortcuts are:

- **Quick ranges** — All dates, Last month, Last 3 months, Last 12 months (measured back from today);
- **Tax years** — one per tax year your statements actually cover, written `2026/27`, running
  6 April to 5 April;
- **Calendar years** — one per calendar year your statements cover.

Both year lists come from the imported data rather than a fixed span: offering 2019 to someone whose
statements start in 2025 would just be a menu of empty results.

### Filtering

The Transactions screen filters on text, **property**, **category**, **rule**, status and a date
range, all on one line above the table. **Clear** appears as soon as anything is narrowed.

Every rule has a **number** — its position in evaluation order — shown on the Rules table, on the
`By rule #3` badge of any transaction it claimed, and in the rule filter, so the same rule reads the
same everywhere. Clicking a rule's **match count** on the Rules tab jumps here with that rule
selected and the other filters cleared, so the count and the rows you land on always agree.

A split transaction belongs to every property and category it was split across, so filtering by
either one keeps it — and filtering by a property *and* a category together shows only the rows
holding that exact pair. "Unassigned" finds rows with no assignment at all, while "Uncategorised"
also catches non-property rows, which are classified but carry no category.

### Notes

Every transaction can carry a **note of your own** — why a repair cost what it did, which tenant a
part-payment came from, that you are still waiting on the invoice. **Add note** in the last column
of the Transactions tab opens a field under the description; Enter saves it, Escape abandons it, and
the same link closes it again.

It sits under the bank's description rather than in a column of its own, because it is a gloss on
what the row already says: "the second half of April's rent" belongs next to the payee, not eight
columns away. It then appears **everywhere that transaction appears** — the property page's
transaction list included — and in the CSV export, on the first line of a split, alongside `Balance`
and for the same reason: the note belongs to the transaction, not to a share of it.

The field exists only while you are writing in it. A permanent input on every row — even an
invisible one — gave a four hundred row statement a second line of height apiece for something most
rows will never have. One row is editable at a time: two half-typed notes on screen are two chances
to lose one.

Saving a note is **not** an assignment. It goes through its own path, so writing "waiting on the
invoice" against a row leaves the split intact and does not detach the rule that categorised it —
which is what would happen if it were routed through the same code as picking a property by hand.

### On a phone

The layout adapts by **viewport and pointer**, not by sniffing the user-agent string — the UA tells
you which browser is running, not how much room it has, and it gets tablets, split-screen windows and
desktop-mode phones wrong.

- **Up to 1000px** the layout relaxes: toolbars stack and wrap, tables scroll sideways.
- **Below 720px** each table row becomes a **card**. Eight columns can't be read on a phone however
  much they scroll, so every cell is shown on its own line with its column name beside it — copied
  from the table's own header, so a label can never disagree with the column it names.
- Because the header row is hidden in card mode, a **Sort by** control appears above each table.
  It is generated from the real heading buttons and clicks them, so sorting behaves identically on
  both layouts rather than being re-implemented.
- The tab bar scrolls horizontally instead of wrapping; the rule editor becomes a full-screen sheet;
  charts stay scrollable with their table view underneath.
- Where the device has a **coarse pointer** (touch), every control is padded to the ~44px minimum tap
  target, independently of screen width — a touchscreen laptop gets this too.

Everything remains available on a phone; nothing is hidden behind "use a desktop".

### Working through a long list

The page heading and tabs stay pinned to the top as you scroll, and table headings stick directly
beneath them, so you never lose track of which column is which. Summary totals stay pinned to the
bottom of their table. (On narrow screens the table scrolls sideways in its own box, which would
anchor a sticky heading to the box rather than the page, so headings sit still there instead.)

On the **Transactions** tab the filter bar is pinned too, between the tabs and the column headings.
Working through a long statement means narrowing repeatedly, and scrolling back to the top to change
one dropdown loses your place in the rows you were reading. The headings below it are pushed down by
`--filter-h`, measured in `main.js` alongside the header height — neither is a constant, since the
tab row and the filter bar each wrap on a narrow window.

Cells align to the **top** of their row rather than the middle. Any cell can grow a second line — a
note, the shares of a split, an overdue caption — and centring the rest against it leaves the row
reading as a staircase.

**Click any column heading to sort by it; click it again to reverse.** The active column is marked
with an arrow and announced to screen readers. Blank cells always sort to the bottom whichever way
the column points — an empty cell is missing information, not the smallest value — and rows that tie
keep their existing order.

Sorting applies to the rows currently on screen, so it stacks with the filters rather than fighting
them. Two details worth knowing:

- On the **Rules** table the `#` column is the rule's position in *evaluation* order, worked out
  before any sorting — re-sorting the table never misstates which rule fires first.
- On the **Summary**, sorting by a category column ranks properties by what they earned or spent
  under it. The "Not a property" line, when shown, stays pinned to the bottom, since it is a
  footnote rather than one of the ranked rows.
- The Summary's net column is **named for the period it is actually summing**. Pick a tax year and
  it reads "Net income 2026/27"; pick anything else and it says the span it covers, or "(all
  dates)". A column headed with a tax year it doesn't contain is worse than an unlabelled one.

### Getting between screens

- The **By rule** badge on a transaction opens the Rules tab scrolled to the rule that categorised
  it, briefly highlighted.
- The **match count** on the Rules tab opens the Transactions tab filtered to that rule.
- A transaction jumped to from elsewhere is scrolled to and highlighted; if your current filters
  would hide it, they're cleared and you're told why.
- A property link opens that property **on the panel you asked about**, not on whichever one you
  happened to leave open last time:

  | Clicked in | Lands on |
  | --- | --- |
  | the main properties table | Overview |
  | the Insurance table | Overview, with the Insurance tile scrolled to and flashed |
  | the Tenancies table | Overview, with the Tenancy tile scrolled to and flashed |
  | the Compliance table | Compliance |
  | the Needs attention list | whatever is wrong — Recurring payments for a late payment, Compliance for a lapsed certificate, Overview with the Insurance tile flashed for cover that has run out |

  Clicking a property in the Tenancies table and arriving somewhere else is a small betrayal: you
  asked about that property's *tenancy*. The section flash uses the same one-shot hand-off as the
  transaction and rule links, so coming back to the page later does not repeat it.

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

On a **property's own page** the same row shows only that property's shares, and the Amount column
is its share rather than the whole payment: a £900 roof divided three ways reads as **£400**, with
`of £900.00` underneath and a `1 of 3` badge. The whole figure in that column would not reconcile
with anything else on the page. Sorting by Amount there sorts on the share, for the same reason —
ranking rows by a number that isn't on screen is worse than not sorting at all.

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
3. copies `index.html`, `favicon.svg`, `src/` and `.nojekyll` into `_site/`, leaving tests and docs out,
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

### Knowing when a backup is due

Downloading a backup records a **digest of what was in the file**. A dot appears next to the Backup
tab whenever the current data no longer matches that digest, and the Backup page says which state
you are in and when the last download was.

It tracks the data rather than the calendar, which is the useful distinction: edit one transaction
and the mark comes straight back; undo that edit and it clears again, because the file on disk is
once more an accurate copy. Restoring from a file also counts as backed up — what you have just
loaded demonstrably exists somewhere else.

The digest is FNV-1a over every backed-up store, computed once per load rather than per render, and
deliberately excludes `settings` — the backup bookmark lives there, so including it would make
recording a backup immediately invalidate it.

### What has changed since it

The dot says *that* something changed; the Backup page also lists **what**, so "should I back up
before clearing my browser" becomes a decision made on evidence:

```
13/08/2026
  23:54  transaction   Assigned 24/07/2026 LOCAL BUILDER LTD to 3 Peterborough Gardens · Repairs
  23:54  compliance    Gas Safety marked not applicable for Flat 4, Mill Court
  23:52  property      Property 3 Peterborough Gardens: colour changed to green
```

Two rules keep it readable rather than exhaustive:

- **One entry per action, not per record.** Importing a statement is one line saying how many rows
  arrived, not four hundred. Every mutation in `store.js` logs exactly once, and works out what to
  say by comparing the record with what was there before — "renamed from Ash Close" rather than
  "property saved", because five identical lines answer nothing.
- **Cleared when a backup is downloaded**, because the question it answers is only ever "since the
  last one". Nothing here is history; the data itself is the history.

The log is capped at 400 entries, oldest dropped first, and the page says so when it has trimmed —
someone who imports for a year without backing up should not carry a hundred thousand rows in
IndexedDB for a list nobody reads to the end of. It is not written into the backup file: it
describes the gap between backups, so a restore starts it empty.

Logging failures are swallowed. Losing a log line is a much smaller problem than a save that appears
to fail because its bookkeeping did.

## What's new

`src/whats-new.js` is a list of releases — date, title, and the points worth telling a user about —
rendered by the **What's new** tab at the far right of the row. It sits apart from the others
because it is about the app rather than about your data.

**Every user-visible feature gets an entry.** Write the points for the person using the app: what it
now does and why that is better, not which function moved. `tests/whats-new.test.js` checks the
dating, ordering and shape; it cannot tell whether an entry is missing.

## Project layout

```
index.html            page shell
favicon.svg           browser tab icon: the house from the icon bank, in red
src/
  main.js             hash router and layout
  csv.js              CSV parsing/export, UK date and amount handling
  rules.js            rule conditions, matching and specificity ordering
  rule-draft.js       pre-fill and validation for the rule editor
  allocation.js       splitting a transaction across properties, in whole pence
  categories.js       default categories and the non-property sentinel
  palette.js          the eight identity colour slots
  icons.js            the property and category icon banks
  accounts.js         monthly totals and recurring-payment detection
  property-details.js dated property records, LTV, watched dates, missing sections
  compliance.js       inspection schedule: next due, overdue, due soon, not applicable
  attention.js        one tally of what a property wants, shared by badge/banner/table
  whats-new.js        the changelog the app shows about itself
  change-log.js       what has been edited since the last backup
  focus.js            "take me to that row" hand-off between screens
  sort.js             click-to-sort column state and comparators
  responsive.js       card-mode cell labels and the mobile sort control
  tax.js              income tax estimate: bands, taper, finance cost credit
  date-presets.js     tax-year / calendar-year / rolling date shortcuts
  transaction-filter.js  the filter predicates both screens share
  views/transaction-table.js  the table itself, editable or read-only
  views/config.js     properties, categories and compliance types
  views/property.js   one property: figures, schedule, records, transactions
  charts.js           small SVG chart builders (columns, legend, table view)
  importer.js         statement text -> transactions, duplicates, re-categorising
  store.js            in-memory state over IndexedDB, plus the backup-pending digest
  db.js               IndexedDB wrapper
  backup.js           backup build and validation
  dates.js            tax year, date range helpers, and the due-soon window
  types.js            fixed categories and JSDoc typedefs
  dom.js              element builder and formatting helpers
  styles.css
  views/              one module per tab
tests/                Node test-runner suites
```
