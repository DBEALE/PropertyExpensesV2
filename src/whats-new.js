/**
 * The changelog the app shows about itself.
 *
 * **Every new feature gets an entry here.** Newest first, dated, written for
 * the person using the app rather than the person who wrote it: what it now
 * does and why that is better, not which function moved. A release with
 * nothing worth telling a user about does not need an entry.
 *
 * Plain data, no DOM — `views/whats-new.js` renders it, and the tests read it.
 */

/**
 * @typedef {object} Release
 * @property {string} date ISO date the change landed
 * @property {string} title one line, what changed in the user's terms
 * @property {string[]} points the detail, one clause each
 */

/** @type {Release[]} */
export const RELEASES = [
  {
    date: '2026-08-15',
    title: 'The app has a face',
    points: [
      'A red house in the browser tab, drawn from the same icon bank the properties use. It takes ' +
        'the light or dark step of the palette’s red depending on your browser’s theme, the same ' +
        'way every other mark in the app does.',
    ],
  },
  {
    date: '2026-08-13',
    title: 'Category marks on column headings, and a quieter Summary',
    points: [
      'Category columns on the Summary tab and in a property’s Monthly breakdown carry that ' +
        'category’s icon in its own colour, so a column of figures is identifiable without reading ' +
        'the heading — and matches the chart legend directly above it.',
      'The Summary no longer shows a “Not a property” line by default. It was already excluded ' +
        'from every total, so it made the table longer without changing an answer. An **Include not ' +
        'a property** tick box brings it back, and when there is such money but the box is off, a ' +
        'line under the table says how much is being left out.',
    ],
  },
  {
    date: '2026-08-13',
    title: 'A tighter transactions table',
    points: [
      'Notes are written from an **Add note** link in the last column, which opens a field under the ' +
        'description. A row without a note no longer reserves height for one, so a four hundred row ' +
        'statement is a good deal shorter. Enter saves, Escape abandons.',
      'Every cell aligns to the top of its row, so the first line of each column sits on one ' +
        'baseline whatever else that row is carrying — a note, the shares of a split, an overdue ' +
        'caption.',
      'The filter bar stays on screen while the list scrolls under it. Working through a long ' +
        'statement means narrowing repeatedly, and scrolling back to the top to change one dropdown ' +
        'lost your place in the rows you were reading.',
      'The Config tab’s properties lost their **Details** link — the property name beside it was ' +
        'already a link to the same page.',
    ],
  },
  {
    date: '2026-08-13',
    title: 'Icons, links that land where you meant, and a log of what you have changed',
    points: [
      'Every property and category now carries an **icon** as well as a colour — four building ' +
        'types for properties, ten marks for categories — pickable on the Config tab and shown ' +
        'wherever that record appears. Change the colour and the icon follows it.',
      'Clicking a property in the Insurance or Tenancies table opens that property on its Overview ' +
        'panel with the section you asked about scrolled to and flashed. From the Compliance table ' +
        'you land on its Compliance panel, and from the main table on Overview.',
      'The “Needs attention” list goes straight to whatever is wrong: a late payment opens ' +
        'Recurring payments, a lapsed certificate opens Compliance.',
      'The Backup tab now lists **what** has changed since your last backup, not just that ' +
        'something has — grouped by day, one line per action. Downloading a backup clears it.',
    ],
  },
  {
    date: '2026-08-13',
    title: 'Your own notes, and a chart that shows the bottom line',
    points: [
      'Every transaction can carry a note of your own — why a repair cost what it did, which tenant ' +
        'a part-payment came from. Type it straight into the row on the Transactions tab; it then ' +
        'appears wherever that transaction is shown, and in the CSV export.',
      'A note never recategorises anything: writing “waiting on the invoice” against a split row ' +
        'leaves the split and the rule that made it exactly as they were.',
      'A property’s Transactions list now shows **that property’s share** of a split rather than the ' +
        'whole payment. A £900 roof divided three ways reads as £400 here, with the total noted ' +
        'underneath, so the column reconciles with the rest of the page.',
      'The cashflow chart draws the monthly **net as a line** across the columns, replacing the two ' +
        'floating figures that only ever annotated two of the months.',
      'That chart now stretches to the full width of the page.',
      'Overview is the first panel on a property — what this place is comes before what it cost.',
      'The five record sections no longer repeat their own first line beside the heading: the ' +
        'Mortgage tile said “Halifax · 3.89%” directly above Lender: Halifax, Interest rate: 3.89%.',
    ],
  },
  {
    date: '2026-08-12',
    title: 'Reminders that clear themselves, and a backup you can trust',
    points: [
      'Compliance falling due within 30 days now shows as a yellow warning on the property, ' +
        'separately from anything already overdue — 28 days to book a gas engineer is a different ' +
        'kind of fact from 80 days.',
      'A certificate that does not apply to a property can be ticked off as such. Gas safety on an ' +
        'all-electric flat stops being counted, chased or listed.',
      'The Mortgage section has an “owned outright” tick box. A property with no borrowing stops ' +
        'being asked for mortgage details, and its LTV reads 0% instead of an em dash.',
      'Needs attention now also lists the record sections you have not filled in yet, so a missing ' +
        'tenancy is visible without going looking for it.',
      'The Properties tab carries a count of everything wanting attention, the same way ' +
        'Transactions carries its review count.',
      'The Backup tab shows a dot when anything has changed since your last download.',
      'Summary, Monthly breakdown and a property’s Transactions list all open on the current tax ' +
        'year rather than on everything ever imported, and the property Transactions list gained ' +
        'the same date-range control as the rest of the app.',
      'A property’s Overview panel lays its five record sections out as tiles rather than a column ' +
        'five screens tall.',
      'This page.',
    ],
  },
  {
    date: '2026-08-12',
    title: 'A property page you can take in at a glance',
    points: [
      'One section of a property at a time, chosen from a strip of panels — Monthly breakdown, ' +
        'Recurring payments, Compliance, Transactions, Overview.',
      'Each panel says what is inside it: “18 of 19 months’ rent received · £7,790 Interest”, ' +
        '“3 certificates tracked · 1 overdue”. Most visits should end at the summary.',
      'The property switcher is the page title, and its first entry goes back to all properties. ' +
        'The name is no longer printed twice.',
      'Overdue badges are filled red with white text — an alarm rather than a label.',
      'The Cashflow chart moved inside Monthly breakdown and now follows the date range, instead ' +
        'of showing the full history beside a filtered table.',
      'Net figures are named for the period they cover: “Net income 2026/27” on Properties, and on ' +
        'Summary whatever range you actually picked.',
      'The tax estimate shows its working — every line quotes the arithmetic behind it in your own ' +
        'figures.',
    ],
  },
];

/** The most recent release, for anything that wants to point at "what's new". */
export function latestRelease() {
  return RELEASES[0] ?? null;
}
