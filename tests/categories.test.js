/**
 * Editable categories and the non-property classification.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocationsOf, isAssigned, sumAllocations } from '../src/allocation.js';
import { buildBackup, validateBackup } from '../src/backup.js';
import {
  DEFAULT_CATEGORIES,
  NON_PROPERTY_ID,
  categoryIdFor,
  isKnownCategory,
  isNonProperty,
  selectableProperties,
} from '../src/categories.js';
import { applyRule } from '../src/importer.js';
import { findMatchingRule } from '../src/rules.js';
import { rule } from './fixtures.js';

const PROPERTIES = [
  { id: 'p1', name: '3 Peterborough Gate' },
  { id: 'p2', name: '7 Elm Road' },
];

describe('default categories', () => {
  it('seeds ids equal to the names older records stored, so nothing needs migrating', () => {
    assert.deepEqual(
      DEFAULT_CATEGORIES.map((c) => c.id),
      ['Rent', 'Ins', 'Repairs', 'Interest', 'Management'],
    );
    assert.ok(DEFAULT_CATEGORIES.every((c) => c.id === c.name));
  });

  it('gives every default a description', () => {
    assert.ok(DEFAULT_CATEGORIES.every((c) => c.description.length > 0));
  });
});

describe('categoryIdFor', () => {
  it('derives a readable id from the name', () => {
    assert.equal(categoryIdFor('Ground rent', []), 'Ground-rent');
  });

  it('keeps ids unique when a name is reused', () => {
    const existing = [{ id: 'Ground-rent' }, { id: 'Ground-rent-2' }];
    assert.equal(categoryIdFor('Ground rent', existing), 'Ground-rent-3');
  });

  it('falls back when the name has nothing usable', () => {
    assert.equal(categoryIdFor('   ', []), 'category');
  });
});

describe('renaming a category', () => {
  it('keeps every reference intact, because the id never changes', () => {
    const categories = [{ id: 'Ins', name: 'Insurance premiums', description: 'Landlord cover.' }];
    const transaction = { propertyId: 'p1', category: 'Ins', amount: -30.16 };

    assert.equal(isKnownCategory(transaction.category, categories), true);
    assert.equal(categories.find((c) => c.id === transaction.category).name, 'Insurance premiums');
  });

  it('leaves a reference to a deleted category unknown', () => {
    assert.equal(isKnownCategory('Ins', [{ id: 'Rent', name: 'Rent', description: '' }]), false);
  });
});

describe('the non-property classification', () => {
  it('is offered after the real properties', () => {
    const options = selectableProperties(PROPERTIES);
    assert.equal(options.length, 3);
    assert.equal(options[2].id, NON_PROPERTY_ID);
    assert.equal(isNonProperty(options[2].id), true);
    assert.equal(isNonProperty('p1'), false);
  });

  it('is still available when no property has been added yet', () => {
    assert.equal(selectableProperties([]).length, 1);
  });

  it('counts as assigned, so it leaves the needs-review queue', () => {
    const personal = { propertyId: NON_PROPERTY_ID, category: 'Repairs', amount: -80 };
    assert.equal(isAssigned(personal), true);
    assert.equal(allocationsOf(personal).length, 1);
  });

  it('can be assigned by a rule like any other property', () => {
    const personal = rule({
      id: 'r1',
      matchText: 'TESCO',
      propertyId: NON_PROPERTY_ID,
      category: 'Repairs',
    });
    const transaction = { id: 't1', details: 'TESCO STORES', amount: -42.5, transactionType: 'Card Payment' };
    assert.equal(findMatchingRule(transaction, [personal]).id, 'r1');
    assert.equal(applyRule(transaction, personal).propertyId, NON_PROPERTY_ID);
  });

  it('can take one share of a split, leaving the rest with a property', () => {
    const shares = [
      { propertyId: 'p1', category: 'Ins', amount: -20 },
      { propertyId: NON_PROPERTY_ID, category: 'Ins', amount: -10.16 },
    ];
    assert.equal(sumAllocations(shares), -30.16);
    const propertyOnly = shares.filter((s) => !isNonProperty(s.propertyId));
    // The property figure excludes the personal share, which is the point.
    assert.equal(sumAllocations(propertyOnly), -20);
  });
});

describe('backup with editable categories', () => {
  const state = {
    properties: PROPERTIES,
    categories: [
      { id: 'Rent', name: 'Rental income', description: 'Rent received.' },
      { id: 'Personal', name: 'Personal', description: 'Nothing to do with the properties.' },
    ],
    rules: [
      rule({ id: 'r1', matchText: 'TESCO', propertyId: NON_PROPERTY_ID, category: 'Personal' }),
    ],
    transactions: [
      {
        id: 't1',
        date: '2026-07-24',
        details: 'TESCO STORES',
        transactionType: 'Card Payment',
        amount: -42.5,
        balance: 100,
        propertyId: NON_PROPERTY_ID,
        category: 'Personal',
        matchedRuleId: 'r1',
        sourceFilename: 'july.csv',
        importedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  };

  it('round-trips renamed and custom categories', () => {
    const restored = validateBackup(JSON.parse(JSON.stringify(buildBackup(state, '2026-08-01T00:00:00.000Z'))));
    assert.equal(restored.categories.length, 2);
    assert.equal(restored.categories[0].name, 'Rental income');
    assert.equal(restored.transactions[0].propertyId, NON_PROPERTY_ID);
  });

  it('accepts the non-property sentinel as a valid property reference', () => {
    const backup = JSON.parse(JSON.stringify(buildBackup(state, '2026-08-01T00:00:00.000Z')));
    assert.doesNotThrow(() => validateBackup(backup));
  });

  it('rejects a transaction naming a category the backup does not contain', () => {
    const backup = JSON.parse(JSON.stringify(buildBackup(state, '2026-08-01T00:00:00.000Z')));
    backup.transactions[0].category = 'Vanished';
    assert.throws(() => validateBackup(backup), /malformed/i);
  });

  it('rejects a rule pointing at a property the backup does not contain', () => {
    const backup = JSON.parse(JSON.stringify(buildBackup(state, '2026-08-01T00:00:00.000Z')));
    backup.rules[0].propertyId = 'ghost';
    assert.throws(() => validateBackup(backup), /malformed/i);
  });

  it('rebuilds the defaults for an older backup that stored plain category names', () => {
    // Version 1 files carried `categories: ["Rent", "Ins", ...]`.
    const legacy = {
      format: 'property-expenses-backup',
      version: 1,
      categories: ['Rent', 'Ins', 'Repairs', 'Interest', 'Management'],
      properties: PROPERTIES,
      rules: [rule({ id: 'r1', matchText: 'X', propertyId: 'p1', category: 'Interest' })],
      transactions: [],
    };
    const restored = validateBackup(legacy);
    assert.equal(restored.categories.length, 5);
    assert.equal(restored.categories[0].id, 'Rent');
    assert.equal(restored.rules.length, 1);
  });

  it('rebuilds the defaults for a backup with no categories at all', () => {
    const restored = validateBackup({
      format: 'property-expenses-backup',
      properties: [],
      rules: [],
      transactions: [],
    });
    assert.equal(restored.categories.length, 5);
  });
});
