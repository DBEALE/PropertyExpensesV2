/**
 * Splitting one transaction across properties, end to end: a split rule
 * applied on import, the totals it produces, and what leaves via CSV/backup.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocationsOf, isAssigned, isSplit, sumAllocations } from '../src/allocation.js';
import { buildBackup, validateBackup } from '../src/backup.js';
import { toCsv } from '../src/csv.js';
import { applyRule, buildTransactions, recategorise } from '../src/importer.js';
import { draftRuleFromTransaction, draftToRule, validateDraft } from '../src/rule-draft.js';
import { findMatchingRule } from '../src/rules.js';
import { idFactory } from './fixtures.js';

const IMPORTED_AT = '2026-08-01T00:00:00.000Z';

/** An insurance direct debit covering two properties. */
const SHARED_STATEMENT = `Date,Details,Transaction Type,In,Out,Balance
30/07/2026,DIRECT LINE FR BUS,Direct Debit,,30.16,16019.21`;

const SPLIT_RULE = {
  id: 'split-1',
  matchText: 'DIRECT LINE',
  matchType: 'contains',
  amountEquals: -30.16,
  propertyId: 'propA',
  category: 'Ins',
  allocations: [
    { propertyId: 'propA', category: 'Ins', amount: -20.1 },
    { propertyId: 'propB', category: 'Ins', amount: -10.06 },
  ],
};

function importWith(rules, text = SHARED_STATEMENT) {
  return buildTransactions(text, { rules, filename: 'july.csv', importedAt: IMPORTED_AT, newId: idFactory() });
}

describe('a split rule applied on import', () => {
  const [transaction] = importWith([SPLIT_RULE]);

  it('splits the transaction across both properties', () => {
    assert.equal(isSplit(transaction), true);
    assert.equal(transaction.allocations.length, 2);
    assert.equal(transaction.matchedRuleId, 'split-1');
  });

  it('allocates exactly the transaction amount, no more and no less', () => {
    assert.equal(sumAllocations(transaction.allocations), transaction.amount);
  });

  it('leaves the flat property and category null, so nothing double-counts', () => {
    assert.equal(transaction.propertyId, null);
    assert.equal(transaction.category, null);
    assert.equal(isAssigned(transaction), true);
  });

  it('does not share allocation objects with the rule', () => {
    // Mutating the transaction must not reach back into the stored rule.
    transaction.allocations[0].amount = -999;
    assert.equal(SPLIT_RULE.allocations[0].amount, -20.1);
    transaction.allocations[0].amount = -20.1;
  });
});

describe('switching a rule between split and simple', () => {
  it('clears the split when the rule stops splitting', () => {
    const split = importWith([SPLIT_RULE]);
    const simple = { ...SPLIT_RULE, allocations: undefined };
    const [updated] = recategorise(split, [simple]);
    assert.equal(updated.allocations, undefined);
    assert.equal(updated.propertyId, 'propA');
  });

  it('clears the split when no rule matches any more', () => {
    const split = importWith([SPLIT_RULE]);
    const [updated] = recategorise(split, []);
    assert.equal(updated.allocations, undefined);
    assert.equal(isAssigned(updated), false);
  });

  it('leaves a hand-assigned transaction alone even when a split rule matches', () => {
    const manual = importWith([]).map((t) => ({ ...t, propertyId: 'propC', category: 'Repairs' }));
    assert.deepEqual(recategorise(manual, [SPLIT_RULE]), []);
  });

  it('applyRule drops a stale split rather than leaving it beside a new assignment', () => {
    const [split] = importWith([SPLIT_RULE]);
    const reassigned = applyRule(split, { id: 'r2', propertyId: 'propC', category: 'Repairs' });
    assert.equal(reassigned.allocations, undefined);
    assert.equal(reassigned.propertyId, 'propC');
  });
});

describe('summary totals over a split', () => {
  it('credits each property only its own share', () => {
    const transactions = importWith([SPLIT_RULE]);
    const shares = transactions.flatMap((t) => allocationsOf(t));
    const totalFor = (id) => sumAllocations(shares.filter((s) => s.propertyId === id));

    assert.equal(totalFor('propA'), -20.1);
    assert.equal(totalFor('propB'), -10.06);
    // And the two together are still exactly the transaction — summed in pence,
    // since -20.10 + -10.06 in floats gives -30.160000000000004.
    assert.equal(sumAllocations(shares), -30.16);
  });
});

describe('CSV export of a split', () => {
  const names = { propA: 'Property A', propB: 'Property B' };
  const lines = toCsv(importWith([SPLIT_RULE]), (id) => names[id] ?? '');

  it('writes one row per share, each with its own amount', () => {
    const rows = lines.split('\r\n');
    assert.equal(rows.length, 3); // header + two shares
    assert.ok(rows[1].includes('Property A'));
    assert.ok(rows[1].includes('20.10'));
    assert.ok(rows[2].includes('Property B'));
    assert.ok(rows[2].includes('10.06'));
  });

  it('writes the balance only once, on the first share', () => {
    const rows = lines.split('\r\n');
    assert.ok(rows[1].includes('16019.21'));
    assert.equal(rows[2].includes('16019.21'), false);
  });

  it('still exports an uncategorised transaction, with blank property', () => {
    const rows = toCsv(importWith([]), () => '').split('\r\n');
    assert.equal(rows.length, 2);
    assert.ok(rows[1].endsWith(',,'));
  });
});

describe('backup of a split', () => {
  const state = {
    properties: [
      { id: 'propA', name: 'Property A' },
      { id: 'propB', name: 'Property B' },
    ],
    rules: [SPLIT_RULE],
    transactions: importWith([SPLIT_RULE]),
  };

  it('round-trips the allocations intact', () => {
    const restored = validateBackup(JSON.parse(JSON.stringify(buildBackup(state, IMPORTED_AT))));
    assert.equal(restored.transactions[0].allocations.length, 2);
    assert.equal(sumAllocations(restored.rules[0].allocations), -30.16);
  });

  it('rejects a backup whose allocations do not sum to the transaction', () => {
    const backup = JSON.parse(JSON.stringify(buildBackup(state, IMPORTED_AT)));
    backup.transactions[0].allocations[0].amount = -1;
    assert.throws(() => validateBackup(backup), /malformed/i);
  });

  it('rejects a backup whose allocation names an unknown category', () => {
    const backup = JSON.parse(JSON.stringify(buildBackup(state, IMPORTED_AT)));
    backup.rules[0].allocations[0].category = 'Nope';
    assert.throws(() => validateBackup(backup), /malformed/i);
  });
});

describe('building a split rule in the editor', () => {
  const [transaction] = importWith([]);
  const base = draftRuleFromTransaction({ ...transaction, propertyId: 'propA', category: 'Ins' }, []);

  const splitDraft = {
    ...base,
    useAmount: true,
    split: true,
    allocations: [
      { propertyId: 'propA', category: 'Ins', amount: -20.1 },
      { propertyId: 'propB', category: 'Ins', amount: -10.06 },
    ],
  };

  it('accepts shares that reconcile against the pinned amount', () => {
    assert.equal(validateDraft(splitDraft), null);
  });

  it('refuses a split that is not pinned to an amount', () => {
    assert.match(validateDraft({ ...splitDraft, useAmount: false }), /pinned to an exact amount/i);
  });

  it('refuses shares that do not add up', () => {
    const wrong = { ...splitDraft, allocations: [splitDraft.allocations[0], { ...splitDraft.allocations[1], amount: -5 }] };
    assert.match(validateDraft(wrong), /still to allocate/);
  });

  it('produces a rule that splits the transaction it came from', () => {
    const built = draftToRule(splitDraft, 'r1');
    assert.equal(built.allocations.length, 2);
    assert.equal(findMatchingRule(transaction, [built]).id, 'r1');
    assert.equal(sumAllocations(applyRule(transaction, built).allocations), transaction.amount);
  });

  it('keeps the first share in the flat fields as the rule primary', () => {
    const built = draftToRule(splitDraft, 'r1');
    assert.equal(built.propertyId, 'propA');
    assert.equal(built.category, 'Ins');
  });

  it('drops allocations entirely when the split box is unticked', () => {
    const built = draftToRule({ ...splitDraft, split: false }, 'r1');
    assert.equal('allocations' in built, false);
  });
});
