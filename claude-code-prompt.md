Build a static web app that categorizes bank transactions for my buy-to-let properties, ready to host on GitHub Pages.

## Hard constraints

- Pure client-side: HTML/CSS/TypeScript (or JS), no backend server, no API keys, no third-party AI service. Everything must run in the browser.
- All data stays local: store properties, categories, rules, and transactions in the browser's IndexedDB. Nothing is ever sent over the network.
- Must deploy cleanly to GitHub Pages as a static site (a Vite build is fine, but the output must be plain static files with no server-side requirement, and routing must work correctly at a repo subpath like `username.github.io/repo-name/`).
- Single user, no login/auth system.
- Include a GitHub Actions workflow that builds and deploys to GitHub Pages on push to main.

## Input format

Bank statements are uploaded as CSV. Example (UK format, DD/MM/YYYY dates):

```
Date,Details,Transaction Type,In,Out,Balance
30/07/2026,DIRECT LINE FR BUS,Direct Debit,,30.16,16019.21
30/07/2026,NATWEST BANK,Direct Debit,,428.06,16049.37
24/07/2026,S Agyapong 3 PETERBOROUGH GAT,Inward Payment,1150.00,,16477.43
```

Notes on the format:
- `In` = money received (rent, refunds); `Out` = money spent (expenses). Exactly one of the two is populated per row, the other is blank.
- `Transaction Type` is free text from the bank (Direct Debit, Inward Payment, Card Payment, etc.) — useful as a hint but not authoritative for categorization.
- `Balance` is a running balance; store it for reference but it's not required for categorization logic.
- `Details` is the field to match rules against (e.g. a rule matching "PETERBOROUGH" could auto-assign both a property and a category, since tenant payments often include the property name/address).
- Parsing must tolerate commas inside the `Details` field is not expected here since the file is comma-delimited, but handle standard CSV quoting defensively in case a bank export does include commas/quotes in descriptions.

## Data model

- **Property**: id, name (e.g. "3 Peterborough Gate")
- **Category**: fixed enum, not user-editable — `Rent`, `Ins`, `Repairs`, `Interest`, `Management`
- **Rule**: id, `matchText` (string, matched case-insensitively as "contains" by default; support "exact" and "regex" as alternate match types), `amountEquals` (optional number — when set, the rule only matches transactions with this exact amount, used to disambiguate a payee shared across multiple properties, e.g. the same insurer or lender billing several properties), `propertyId`, `category` (one of the fixed enum values)
- **Transaction**: id, date, details (raw), transaction type, amount (signed: positive for In, negative for Out), balance, assigned property id, assigned category (one of the fixed enum), source filename, imported-at timestamp

### Rule matching order

When categorizing a transaction on import, evaluate rules in this order and stop at the first match:
1. Rules where `matchText` matches AND `amountEquals` matches the transaction's amount exactly.
2. Rules where `matchText` matches and `amountEquals` is not set.

This lets an amount-pinned rule (e.g. "NATWEST BANK" + £428.06 → Property A, Interest) take precedence over a looser text-only rule for the same payee used elsewhere. If nothing matches, leave the transaction unassigned for manual review.

When a user manually assigns Property/Category to an unmatched transaction, prompt to save it as a new rule, and default to pinning the amount if that `matchText` already exists under a different property (this is the signal that the payee is shared and needs disambiguation).

## Features (build in this order)

1. **CSV upload and parsing** — file picker, parse into Transaction records, validate the expected columns exist, show a clear error if the format doesn't match.
2. **Review table** — list parsed transactions with editable dropdowns for Property and Category per row. Show running match status (auto-categorized by rule vs. needs manual review).
3. **Rule engine** — on import, for each transaction, check existing rules against `Details` (case-insensitive contains match as the default rule type) and auto-fill Property/Category when matched. When a user manually categorizes an uncategorized row, offer to save it as a new rule for future imports.
4. **Rule management UI** — list, add, edit, delete rules; show how many transactions each rule currently matches; make clear in the UI when a rule is amount-pinned vs. text-only.
5. **Property management UI** — add/edit/delete properties. Categories are the fixed five (Rent, Ins, Repairs, Interest, Management) and are not user-editable.
6. **IndexedDB persistence** — all of the above persists across browser sessions automatically.
7. **Backup export/import** — a button to download all data (properties, categories, rules, transactions) as a single JSON file, and a way to restore from that file. This is the safety net against browser storage being cleared.
8. **Summary view** — totals by property and by category, filterable by date range / tax year, so it's usable for UK Self Assessment property income reporting.
9. **Export** — export categorized transactions (with property/category columns added) to CSV, ready to open in Excel.

## Explicitly out of scope for this build

- No AI-based parsing or categorization (rules/keyword matching only).
- No backend, no database server, no authentication.
- No multi-user support.

## Acceptance check

Using the three example rows above as a test fixture: importing them should produce three transactions with correct signed amounts (two negative for "Out" rows, one positive for "In"), correctly parsed DD/MM/YYYY dates, and the UI should allow assigning the "S Agyapong" row to a property and the "Rent" category, then saving that as a text-only rule (matching "PETERBOROUGH") so a future statement with the same tenant/property text auto-categorizes.

Also verify the disambiguation case: create two properties, add a rule for "NATWEST BANK" + exact amount → Property A, Interest, and a second rule for "NATWEST BANK" + a different exact amount → Property B, Interest. Confirm each transaction matches the correct property based on its amount, and that a "NATWEST BANK" transaction with a third, unmatched amount is left unassigned rather than incorrectly matching either rule.

Set up the project structure, implement the above, and include a short README covering local dev (`npm install`, `npm run dev`) and how the GitHub Pages deploy workflow works.
