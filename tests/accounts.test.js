/**
 * Per-property account analysis and the identity palette.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  accountSummary,
  hasEnded,
  isOverdue,
  monthLabel,
  monthRange,
  monthlyTotals,
  paymentStreams,
  runningTotals,
  sharesFor,
  streamState,
} from '../src/accounts.js';
import { NON_PROPERTY_ID } from '../src/categories.js';
import { SLOT_KEYS, nextSlot, slotFromId, slotOf } from '../src/palette.js';

/** A year of rent, mortgage and one repair on a single property. */
function transaction(date, details, amount, extra = {}) {
  return {
    id: `${date}-${details}`,
    date,
    details,
    transactionType: amount > 0 ? 'Inward Payment' : 'Direct Debit',
    amount,
    balance: null,
    propertyId: 'p1',
    category: amount > 0 ? 'Rent' : 'Interest',
    matchedRuleId: null,
    sourceFilename: 'statements.csv',
    importedAt: '2026-08-01T00:00:00.000Z',
    ...extra,
  };
}

const HISTORY = [
  transaction('2026-05-24', 'S Agyapong PETERBOROUGH', 1150, { matchedRuleId: 'rent' }),
  transaction('2026-06-24', 'S Agyapong PETERBOROUGH', 1150, { matchedRuleId: 'rent' }),
  transaction('2026-07-24', 'S Agyapong PETERBOROUGH', 1150, { matchedRuleId: 'rent' }),
  transaction('2026-05-30', 'NATWEST BANK', -428.06, { matchedRuleId: 'mortgage' }),
  transaction('2026-06-30', 'NATWEST BANK', -428.06, { matchedRuleId: 'mortgage' }),
  transaction('2026-07-30', 'NATWEST BANK', -428.06, { matchedRuleId: 'mortgage' }),
  transaction('2026-06-11', 'BOILER FIX LTD', -240, { category: 'Repairs' }),
];

describe('sharesFor', () => {
  it('returns every share of one property', () => {
    assert.equal(sharesFor(HISTORY, 'p1').length, 7);
    assert.equal(sharesFor(HISTORY, 'p2').length, 0);
  });

  it('returns everything when no property is named', () => {
    assert.equal(sharesFor(HISTORY, null).length, 7);
  });

  it('counts each side of a split against its own property', () => {
    const split = [
      {
        ...transaction('2026-07-30', 'DIRECT LINE', -30.16),
        propertyId: null,
        category: null,
        allocations: [
          { propertyId: 'p1', category: 'Ins', amount: -20 },
          { propertyId: 'p2', category: 'Ins', amount: -10.16 },
        ],
      },
    ];
    assert.equal(sharesFor(split, 'p1')[0].amount, -20);
    assert.equal(sharesFor(split, 'p2')[0].amount, -10.16);
    assert.equal(sharesFor(split, null).length, 2);
  });

  it('ignores uncategorised transactions, which belong to no property', () => {
    const loose = [{ ...transaction('2026-07-01', 'MYSTERY', -5), propertyId: null, category: null }];
    assert.equal(sharesFor(loose, null).length, 0);
  });
});

describe('monthly totals', () => {
  const shares = sharesFor(HISTORY, 'p1');

  it('covers every month between the first and last entry, including empty ones', () => {
    assert.deepEqual(monthRange(shares), ['2026-05', '2026-06', '2026-07']);
    const sparse = sharesFor([transaction('2026-01-05', 'A', 10), transaction('2026-04-05', 'B', 10)], 'p1');
    assert.equal(monthRange(sparse).length, 4);
  });

  it('separates money in from money out', () => {
    const [may, june] = monthlyTotals(shares);
    assert.equal(may.income, 1150);
    assert.equal(may.expenses, -428.06);
    assert.equal(may.net, 721.94);
    // June carries the extra repair.
    assert.equal(june.expenses, -668.06);
  });

  it('breaks each month down by category', () => {
    const june = monthlyTotals(shares)[1];
    assert.equal(june.byCategory.get('Rent'), 1150);
    assert.equal(june.byCategory.get('Interest'), -428.06);
    assert.equal(june.byCategory.get('Repairs'), -240);
  });

  it('formats a month label for an axis', () => {
    assert.equal(monthLabel('2026-07'), 'Jul 26');
  });

  it("each month's categories add up to its net, which the pivot table relies on", () => {
    // The property page shows categories as columns and months as rows; the
    // Net column and the footer only reconcile if this holds.
    for (const month of monthlyTotals(shares)) {
      const fromCategories = [...month.byCategory.values()].reduce(
        (sum, v) => Math.round(sum * 100 + v * 100) / 100,
        0,
      );
      assert.equal(fromCategories, month.net, `${month.label} categories should total its net`);
    }
  });

  it('accumulates a running balance', () => {
    const running = runningTotals(monthlyTotals(shares));
    assert.equal(running[0].balance, 721.94);
    // June nets 1150 - 428.06 - 240, so the balance climbs by 481.94.
    assert.equal(running[1].balance, 1203.88);
    assert.equal(running[2].balance, 1925.82);
  });
});

describe('paymentStreams', () => {
  const streams = paymentStreams(sharesFor(HISTORY, 'p1'), '2026-08-05');

  it('groups repeat payments by the rule that categorised them', () => {
    const rent = streams.find((s) => s.key === 'rule:rent');
    assert.equal(rent.count, 3);
    assert.equal(rent.direction, 'in');
    assert.equal(rent.typicalAmount, 1150);
  });

  it('works out the day of the month a payment lands on', () => {
    assert.equal(streams.find((s) => s.key === 'rule:rent').typicalDay, 24);
    assert.equal(streams.find((s) => s.key === 'rule:mortgage').typicalDay, 30);
  });

  it('forecasts the next occurrence a month after the last one', () => {
    assert.equal(streams.find((s) => s.key === 'rule:rent').nextExpected, '2026-08-24');
    assert.equal(streams.find((s) => s.key === 'rule:mortgage').nextExpected, '2026-08-30');
  });

  it('does not forecast a one-off', () => {
    const repair = streams.find((s) => s.label === 'BOILER FIX LTD');
    assert.equal(repair.recurring, false);
    assert.equal(repair.nextExpected, null);
  });

  it('orders streams by how much money they move', () => {
    assert.equal(streams[0].key, 'rule:rent');
  });

  it('groups uncategorised-by-rule payments by payee text instead', () => {
    const manual = [
      transaction('2026-06-01', 'THAMES WATER', -30),
      transaction('2026-07-01', 'THAMES WATER', -30),
    ];
    const [stream] = paymentStreams(sharesFor(manual, 'p1'), '2026-07-15');
    assert.equal(stream.count, 2);
    assert.equal(stream.recurring, true);
  });

  it('does not treat two payments six months apart as monthly', () => {
    const sporadic = [transaction('2026-01-01', 'ODD JOB', -50), transaction('2026-07-01', 'ODD JOB', -50)];
    assert.equal(paymentStreams(sharesFor(sporadic, 'p1'), '2026-08-01')[0].recurring, false);
  });

  it('rolls the forecast forward past months with no payment', () => {
    const stale = [
      transaction('2026-01-10', 'OLD RENT', 500),
      transaction('2026-02-10', 'OLD RENT', 500),
    ];
    // Nothing since February, asked in June: the next date is still in the future.
    const [stream] = paymentStreams(sharesFor(stale, 'p1'), '2026-06-15');
    assert.ok(stream.nextExpected > '2026-06-15');
  });
});

describe('streamState', () => {
  /** Rent paid monthly, last arriving on the given date. */
  const rentUntil = (lastDate) => {
    const months = ['2026-01-10', '2026-02-10', '2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10'];
    const upTo = months.slice(0, months.indexOf(lastDate) + 1);
    return paymentStreams(
      sharesFor(upTo.map((d) => transaction(d, 'RENT', 500)), 'p1'),
      '2026-06-15',
    )[0];
  };

  it('is current while the next payment is not yet due', () => {
    assert.equal(streamState(rentUntil('2026-06-10'), '2026-06-15'), 'current');
    assert.equal(isOverdue(rentUntil('2026-06-10'), '2026-06-15'), false);
  });

  it('is overdue when a payment or two has been missed', () => {
    // Last paid 10 April, asked in mid-June: two missed, worth chasing.
    assert.equal(streamState(rentUntil('2026-04-10'), '2026-06-15'), 'overdue');
    assert.equal(isOverdue(rentUntil('2026-04-10'), '2026-06-15'), true);
  });

  it('is ended once it has been gone long enough to be finished, not late', () => {
    // Nothing since February. A tenant who left is not five months in arrears,
    // and reporting it as overdue for ever was the bug this replaced.
    const stream = rentUntil('2026-02-10');
    assert.equal(streamState(stream, '2026-06-15'), 'ended');
    assert.equal(isOverdue(stream, '2026-06-15'), false);
    assert.equal(hasEnded(stream, '2026-06-15'), true);
  });

  it('takes the staleness window from the caller', () => {
    const stream = rentUntil('2026-02-10');
    // A longer window keeps it in the "chase it" state for longer.
    assert.equal(streamState(stream, '2026-06-15', { staleAfterMonths: 12 }), 'overdue');
    assert.equal(streamState(stream, '2026-06-15', { staleAfterMonths: 1 }), 'ended');
  });

  it('retires income that stopped before the current tenancy began', () => {
    // The former tenant's rent, with a new tenancy starting in April: they are
    // not in arrears, they moved out.
    const stream = rentUntil('2026-03-10');
    assert.equal(streamState(stream, '2026-06-15'), 'overdue', 'without the tenancy it just looks late');
    assert.equal(streamState(stream, '2026-06-15', { tenancyFrom: '2026-04-01' }), 'ended');
  });

  it('keeps income that has continued into the current tenancy', () => {
    const stream = rentUntil('2026-06-10');
    assert.equal(streamState(stream, '2026-06-15', { tenancyFrom: '2026-04-01' }), 'current');
  });

  it('does not let a new tenancy retire an outgoing payment', () => {
    // A tenancy starting in April says nothing about the mortgage.
    const mortgage = paymentStreams(
      sharesFor(
        [transaction('2026-05-30', 'NATWEST', -428.06), transaction('2026-06-30', 'NATWEST', -428.06)],
        'p1',
      ),
      '2026-07-05',
    )[0];
    assert.equal(streamState(mortgage, '2026-07-05', { tenancyFrom: '2026-04-01' }), 'current');
  });

  it('never flags a one-off', () => {
    const streams = paymentStreams(sharesFor(HISTORY, 'p1'), '2027-01-01');
    const oneOff = streams.find((s) => s.label === 'BOILER FIX LTD');
    assert.equal(isOverdue(oneOff, '2027-01-01'), false);
    assert.equal(hasEnded(oneOff, '2027-01-01'), false);
  });
});

describe('acceptance: two months of rent, then a month with nothing', () => {
  const rent = [
    transaction('2026-05-24', 'S Agyapong PETERBOROUGH', 1150, { matchedRuleId: 'rent' }),
    transaction('2026-06-24', 'S Agyapong PETERBOROUGH', 1150, { matchedRuleId: 'rent' }),
  ];

  it('flags the rent as overdue once the third month passes with no payment', () => {
    // Asked on 28 July: July's rent was expected on the 24th and never arrived.
    const [stream] = paymentStreams(sharesFor(rent, 'p1'), '2026-07-28');
    assert.equal(stream.recurring, true);
    assert.equal(isOverdue(stream, '2026-07-28'), true);
  });

  it('does not flag it before the third payment is due', () => {
    const [stream] = paymentStreams(sharesFor(rent, 'p1'), '2026-07-20');
    assert.equal(isOverdue(stream, '2026-07-20'), false);
  });

  it('clears as soon as the third month lands', () => {
    const paid = [...rent, transaction('2026-07-24', 'S Agyapong PETERBOROUGH', 1150, { matchedRuleId: 'rent' })];
    const [stream] = paymentStreams(sharesFor(paid, 'p1'), '2026-07-28');
    assert.equal(isOverdue(stream, '2026-07-28'), false);
  });
});

describe('accountSummary', () => {
  it('totals income, expenses and net', () => {
    const totals = accountSummary(sharesFor(HISTORY, 'p1'));
    assert.equal(totals.income, 3450);
    assert.equal(totals.expenses, -1524.18);
    assert.equal(totals.net, 1925.82);
    assert.equal(totals.count, 7);
  });

  it('handles a property with nothing against it', () => {
    assert.deepEqual(accountSummary([]), { income: 0, expenses: 0, net: 0, count: 0 });
  });
});

describe('identity palette', () => {
  it('hands out the leading slots first, in order', () => {
    const records = [];
    for (let i = 0; i < 3; i++) records.push({ id: `p${i}`, colour: nextSlot(records) });
    assert.deepEqual(
      records.map((r) => r.colour),
      ['blue', 'orange', 'aqua'],
    );
  });

  it('reuses the first free slot when one is released', () => {
    const records = [{ id: 'a', colour: 'blue' }, { id: 'c', colour: 'aqua' }];
    assert.equal(nextSlot(records), 'orange');
  });

  it('keeps going once all eight are taken', () => {
    const records = SLOT_KEYS.map((colour, i) => ({ id: `p${i}`, colour }));
    assert.ok(SLOT_KEYS.includes(nextSlot(records)));
  });

  it('gives records saved before colours a stable slot from their id', () => {
    const record = { id: 'legacy-property' };
    assert.equal(slotOf(record), slotFromId('legacy-property'));
    // Stable across calls, so a colour never changes under the user.
    assert.equal(slotOf(record), slotOf({ id: 'legacy-property' }));
    assert.ok(SLOT_KEYS.includes(slotOf(record)));
  });

  it('ignores a colour that is not one of the eight slots', () => {
    assert.equal(slotOf({ id: 'x', colour: '#ff0000' }), slotFromId('x'));
  });

  it('gives the non-property line its own neutral, not a series colour', () => {
    assert.equal(slotOf({ id: NON_PROPERTY_ID, colour: 'neutral' }), slotFromId(NON_PROPERTY_ID));
  });
});
