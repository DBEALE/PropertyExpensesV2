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
