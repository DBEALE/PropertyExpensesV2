/**
 * Reconciling two devices that have both moved on.
 *
 * This is the module where a bug costs someone real work — a wrong branch here
 * silently deletes a transaction or resurrects a property that was meant to go.
 * So there is a test per row of the decision table, both ways round, plus the
 * awkward cases: deletes racing edits, both sides inventing the same id, and a
 * merge that would leave a transaction pointing at a property that no longer
 * exists.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MERGED_STORES, mergeDocuments } from '../src/merge.js';
import { buildBackup, validateBackup } from '../src/backup.js';

const AT = '2026-08-15T12:00:00.000Z';

/** An empty document in the shape buildBackup produces. */
function doc(overrides = {}) {
  const empty = Object.fromEntries(MERGED_STORES.map((store) => [store, []]));
  return { format: 'property-expenses-backup', version: 6, exportedAt: AT, ...empty, ...overrides };
}

const merge = (base, mine, theirs) => mergeDocuments(base, mine, theirs, { at: AT });
const ids = (list) => list.map((record) => record.id).sort();
const byId = (list, id) => list.find((record) => record.id === id);

const tx = (id, extra = {}) => ({
  id,
  date: '2026-07-24',
  details: `PAYEE ${id}`,
  transactionType: 'Direct Debit',
  amount: -30.16,
  balance: null,
  propertyId: null,
  category: null,
  matchedRuleId: null,
  sourceFilename: 'july.csv',
  importedAt: '2026-08-01T00:00:00.000Z',
  ...extra,
});

describe('the store list', () => {
  it('matches every record array buildBackup actually writes', () => {
    // The guard against adding a tenth store and silently leaving it out of
    // the merge, where it would look like the other device deleted everything.
    const produced = buildBackup(
      Object.fromEntries(MERGED_STORES.map((store) => [store, []])),
      AT,
    );
    const arrays = Object.keys(produced).filter((key) => Array.isArray(produced[key]));
    assert.deepEqual(arrays.sort(), [...MERGED_STORES].sort());
  });
});

describe('additions', () => {
  it('keeps a record only this device added', () => {
    const result = merge(doc(), doc({ transactions: [tx('t1')] }), doc());
    assert.deepEqual(ids(result.document.transactions), ['t1']);
    assert.equal(result.collisions.length, 0);
  });

  it('takes a record only the other device added', () => {
    const result = merge(doc(), doc(), doc({ transactions: [tx('t1')] }));
    assert.deepEqual(ids(result.document.transactions), ['t1']);
    assert.equal(result.fromTheirs, 1);
  });

  it('combines disjoint additions — the case this whole module exists for', () => {
    // January's statement imported on the laptop, a note added on the phone.
    const result = merge(
      doc({ transactions: [tx('t0')] }),
      doc({ transactions: [tx('t0'), tx('mine')] }),
      doc({ transactions: [tx('t0'), tx('theirs')] }),
    );
    assert.deepEqual(ids(result.document.transactions), ['mine', 't0', 'theirs']);
    assert.equal(result.collisions.length, 0, 'disjoint work should merge silently');
  });

  it('flags the same id invented on both devices with different contents', () => {
    const result = merge(
      doc(),
      doc({ categories: [{ id: 'Rent', name: 'Rent' }] }),
      doc({ categories: [{ id: 'Rent', name: 'Rental income' }] }),
    );
    assert.equal(byId(result.document.categories, 'Rent').name, 'Rent', 'local wins');
    assert.equal(result.collisions.length, 1);
  });

  it('says nothing when both devices added the same id identically', () => {
    // The seeded categories have fixed ids, so two fresh installs produce this.
    const seeded = { id: 'Rent', name: 'Rent', description: 'Rent received from tenants.' };
    const result = merge(doc(), doc({ categories: [seeded] }), doc({ categories: [{ ...seeded }] }));
    assert.equal(result.collisions.length, 0);
    assert.deepEqual(ids(result.document.categories), ['Rent']);
  });
});

describe('deletions', () => {
  it('accepts a delete the other device made and this one did not touch', () => {
    const result = merge(doc({ transactions: [tx('t1')] }), doc({ transactions: [tx('t1')] }), doc());
    assert.deepEqual(result.document.transactions, []);
    assert.equal(result.resurrected.length, 0);
  });

  it('accepts a delete this device made and the other did not touch', () => {
    const result = merge(doc({ transactions: [tx('t1')] }), doc(), doc({ transactions: [tx('t1')] }));
    assert.deepEqual(result.document.transactions, []);
  });

  it('drops what both devices deleted', () => {
    const result = merge(doc({ transactions: [tx('t1')] }), doc(), doc());
    assert.deepEqual(result.document.transactions, []);
  });

  it('resurrects a record the other device deleted while this one edited it', () => {
    // Never silently destroy something somebody deliberately changed.
    const result = merge(
      doc({ transactions: [tx('t1')] }),
      doc({ transactions: [tx('t1', { notes: 'chased the agent' })] }),
      doc(),
    );
    assert.deepEqual(ids(result.document.transactions), ['t1']);
    assert.equal(byId(result.document.transactions, 't1').notes, 'chased the agent');
    assert.equal(result.resurrected.length, 1);
    assert.match(result.resurrected[0].reason, /deleted on the other device/);
  });

  it('resurrects a record this device deleted while the other edited it', () => {
    const result = merge(
      doc({ transactions: [tx('t1')] }),
      doc(),
      doc({ transactions: [tx('t1', { notes: 'theirs' })] }),
    );
    assert.deepEqual(ids(result.document.transactions), ['t1']);
    assert.equal(result.resurrected.length, 1);
    assert.match(result.resurrected[0].reason, /deleted here/);
  });
});

describe('edits', () => {
  it('takes the other device’s edit when this one did not touch the record', () => {
    const result = merge(
      doc({ transactions: [tx('t1')] }),
      doc({ transactions: [tx('t1')] }),
      doc({ transactions: [tx('t1', { category: 'Rent' })] }),
    );
    assert.equal(byId(result.document.transactions, 't1').category, 'Rent');
    assert.equal(result.fromTheirs, 1);
    assert.equal(result.collisions.length, 0);
  });

  it('keeps this device’s edit when the other did not touch the record', () => {
    const result = merge(
      doc({ transactions: [tx('t1')] }),
      doc({ transactions: [tx('t1', { category: 'Ins' })] }),
      doc({ transactions: [tx('t1')] }),
    );
    assert.equal(byId(result.document.transactions, 't1').category, 'Ins');
    assert.equal(result.fromMine, 1);
    assert.equal(result.collisions.length, 0);
  });

  it('reports a genuine collision and keeps the local copy', () => {
    // No record carries a universal "modified at", so "newest wins" cannot be
    // determined. Keep local, name it, and leave the other in gist history.
    const result = merge(
      doc({ transactions: [tx('t1')] }),
      doc({ transactions: [tx('t1', { category: 'Ins' })] }),
      doc({ transactions: [tx('t1', { category: 'Repairs' })] }),
    );
    assert.equal(byId(result.document.transactions, 't1').category, 'Ins');
    assert.equal(result.collisions.length, 1);
    assert.equal(result.collisions[0].store, 'transactions');
    assert.equal(result.collisions[0].id, 't1');
    assert.match(result.collisions[0].label, /PAYEE t1/, 'a collision must be nameable on screen');
  });

  it('counts an identical edit on both sides as no conflict at all', () => {
    const edited = tx('t1', { category: 'Rent' });
    const result = merge(
      doc({ transactions: [tx('t1')] }),
      doc({ transactions: [edited] }),
      doc({ transactions: [{ ...edited }] }),
    );
    assert.equal(result.collisions.length, 0);
    assert.equal(result.fromMine, 0);
    assert.equal(result.fromTheirs, 0);
  });

  it('does not treat a difference in key order as an edit', () => {
    const result = merge(
      doc({ properties: [{ id: 'p1', name: 'Ash Close', colour: 'blue' }] }),
      doc({ properties: [{ id: 'p1', name: 'Ash Close', colour: 'blue' }] }),
      doc({ properties: [{ colour: 'blue', name: 'Ash Close', id: 'p1' }] }),
    );
    assert.equal(result.collisions.length, 0);
    assert.equal(result.fromTheirs, 0);
  });

  it('does treat a reordered split as an edit, because order is meaning there', () => {
    const shares = [
      { propertyId: 'p1', category: 'Repairs', amount: -400 },
      { propertyId: 'p2', category: 'Repairs', amount: -500 },
    ];
    const result = merge(
      doc({ transactions: [tx('t1', { allocations: shares })] }),
      doc({ transactions: [tx('t1', { allocations: shares })] }),
      doc({ transactions: [tx('t1', { allocations: [...shares].reverse() })] }),
    );
    assert.equal(result.fromTheirs, 1);
  });
});

describe('the settings store', () => {
  it('never takes the other device’s backup bookmark', () => {
    // It records what *that* machine last pushed. Importing it would make this
    // one believe it had already saved work it has not.
    const result = merge(
      doc({ settings: [{ id: 'backup', at: 'base', signature: 'b' }] }),
      doc({ settings: [{ id: 'backup', at: 'mine', signature: 'm' }] }),
      doc({ settings: [{ id: 'backup', at: 'theirs', signature: 't' }] }),
    );
    assert.equal(byId(result.document.settings, 'backup').at, 'mine');
    assert.equal(result.collisions.length, 0, 'and it is not a conflict either');
  });

  it('merges the tax settings normally', () => {
    const result = merge(
      doc({ settings: [{ id: 'tax', otherIncome: 40000 }] }),
      doc({ settings: [{ id: 'tax', otherIncome: 40000 }] }),
      doc({ settings: [{ id: 'tax', otherIncome: 52000 }] }),
    );
    assert.equal(byId(result.document.settings, 'tax').otherIncome, 52000);
  });
});

describe('referential integrity', () => {
  const property = { id: 'p1', name: 'Ash Close' };
  const category = { id: 'Rent', name: 'Rent' };

  it('puts back a property this device deleted that the other still uses', () => {
    // Each side is internally consistent; the merge of the two would not be,
    // and validateBackup would reject the whole document.
    const result = merge(
      doc({ properties: [property], categories: [category] }),
      doc({ categories: [category] }),
      doc({
        properties: [property],
        categories: [category],
        transactions: [tx('t1', { propertyId: 'p1', category: 'Rent' })],
      }),
    );
    assert.deepEqual(ids(result.document.properties), ['p1']);
    assert.ok(result.resurrected.some((r) => r.store === 'properties'));
    assert.doesNotThrow(() => validateBackup(result.document));
  });

  it('puts back a parent referenced only from inside a split', () => {
    const other = { id: 'p2', name: 'Elm Road' };
    const result = merge(
      doc({ properties: [property, other], categories: [category] }),
      doc({ properties: [property], categories: [category] }),
      doc({
        properties: [property, other],
        categories: [category],
        transactions: [
          tx('t1', {
            amount: -900,
            allocations: [
              { propertyId: 'p1', category: 'Rent', amount: -400 },
              { propertyId: 'p2', category: 'Rent', amount: -500 },
            ],
          }),
        ],
      }),
    );
    assert.deepEqual(ids(result.document.properties), ['p1', 'p2']);
    assert.doesNotThrow(() => validateBackup(result.document));
  });

  it('leaves the non-property sentinel alone', () => {
    // It belongs to no store, so it is not a dangling reference to repair.
    const result = merge(
      doc({ categories: [category] }),
      doc({ categories: [category], transactions: [tx('t1', { propertyId: '__non_property__' })] }),
      doc({ categories: [category] }),
    );
    assert.deepEqual(result.document.properties, []);
    assert.equal(result.resurrected.length, 0);
  });

  it('produces a document validateBackup accepts for a realistic merge', () => {
    const result = merge(
      doc({ properties: [property], categories: [category] }),
      doc({
        properties: [property],
        categories: [category],
        transactions: [tx('mine', { propertyId: 'p1', category: 'Rent' })],
      }),
      doc({
        properties: [property, { id: 'p2', name: 'Elm Road' }],
        categories: [category],
        transactions: [tx('theirs', { propertyId: 'p2', category: 'Rent' })],
      }),
    );
    const validated = validateBackup(result.document);
    assert.deepEqual(ids(validated.transactions), ['mine', 'theirs']);
    assert.deepEqual(ids(validated.properties), ['p1', 'p2']);
  });
});

describe('awkward inputs', () => {
  it('copes with an empty ancestor — everything on both sides is an addition', () => {
    const result = merge(
      doc(),
      doc({ transactions: [tx('mine')] }),
      doc({ transactions: [tx('theirs')] }),
    );
    assert.deepEqual(ids(result.document.transactions), ['mine', 'theirs']);
    assert.equal(result.collisions.length, 0);
  });

  it('copes with a store missing from the ancestor entirely', () => {
    // An older backup, written before that store existed.
    const ancestor = doc();
    delete ancestor.complianceExemptions;
    const exemption = { id: 'p1::gas', propertyId: 'p1', complianceTypeId: 'gas' };
    const result = merge(ancestor, doc({ complianceExemptions: [exemption] }), doc());
    assert.deepEqual(ids(result.document.complianceExemptions), ['p1::gas']);
  });

  it('always returns every store, even when no input had one', () => {
    const result = merge(doc(), doc(), doc());
    for (const store of MERGED_STORES) {
      assert.ok(Array.isArray(result.document[store]), `${store} missing from the merged document`);
    }
  });

  it('stamps the result and keeps the newer format version', () => {
    const result = merge(doc(), doc({ version: 5 }), doc({ version: 6 }));
    assert.equal(result.document.version, 6);
    assert.equal(result.document.exportedAt, AT);
    assert.equal(result.document.format, 'property-expenses-backup');
  });

  it('is symmetric about who wins, so neither side is privileged by accident', () => {
    // Swapping mine and theirs must swap the outcome, not change how many
    // conflicts there are.
    const base = doc({ transactions: [tx('t1')] });
    const a = doc({ transactions: [tx('t1', { category: 'Ins' })] });
    const b = doc({ transactions: [tx('t1', { category: 'Repairs' })] });
    const forward = merge(base, a, b);
    const backward = merge(base, b, a);
    assert.equal(forward.collisions.length, backward.collisions.length);
    assert.equal(byId(forward.document.transactions, 't1').category, 'Ins');
    assert.equal(byId(backward.document.transactions, 't1').category, 'Repairs');
  });
});
