import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  candidateWords,
  draftRuleFromTransaction,
  draftToRule,
  suggestMatchText,
  validateDraft,
} from '../src/rule-draft.js';
import { findMatchingRule } from '../src/rules.js';
import { rule } from './fixtures.js';

const TENANT = {
  id: 't1',
  date: '2026-07-24',
  details: 'S Agyapong 3 PETERBOROUGH GAT',
  transactionType: 'Inward Payment',
  amount: 1150,
  balance: 16477.43,
  propertyId: 'propA',
  category: 'Rent',
  matchedRuleId: null,
  sourceFilename: 'july.csv',
  importedAt: '2026-08-01T00:00:00.000Z',
};

describe('candidateWords', () => {
  it('offers the description\'s words, longest first, without duplicates', () => {
    assert.deepEqual(candidateWords('S Agyapong 3 PETERBOROUGH GAT'), ['PETERBOROUGH', 'Agyapong']);
  });

  it('strips surrounding punctuation', () => {
    assert.deepEqual(candidateWords('PAYMENT (PETERBOROUGH),'), ['PETERBOROUGH']);
  });

  it('is empty when there is nothing worth narrowing to', () => {
    assert.deepEqual(candidateWords('ABC 12'), []);
    assert.deepEqual(candidateWords(''), []);
  });
});

describe('suggestMatchText', () => {
  it('picks the longest identifying word', () => {
    assert.equal(suggestMatchText('S Agyapong 3 PETERBOROUGH GAT'), 'PETERBOROUGH');
  });

  it('skips generic banking noise', () => {
    assert.equal(suggestMatchText('NATWEST BANK'), 'NATWEST');
    assert.equal(suggestMatchText('DIRECT LINE FR BUS'), 'LINE');
  });

  it('falls back to the whole description when nothing stands out', () => {
    assert.equal(suggestMatchText('ABC 12'), 'ABC 12');
    assert.equal(suggestMatchText(''), '');
  });
});

describe('draftRuleFromTransaction', () => {
  it('pre-fills the match text with the full description', () => {
    const draft = draftRuleFromTransaction(TENANT, []);
    assert.equal(draft.matchText, 'S Agyapong 3 PETERBOROUGH GAT');
    // The keyword is offered as a one-click narrowing rather than imposed.
    assert.deepEqual(draft.suggestions, ['PETERBOROUGH', 'Agyapong']);
  });

  it('trims surrounding whitespace from the description', () => {
    assert.equal(draftRuleFromTransaction({ ...TENANT, details: '  SPACED OUT  ' }, []).matchText, 'SPACED OUT');
  });

  it('pre-fills every other field from the transaction, with text on and the rest off', () => {
    const draft = draftRuleFromTransaction(TENANT, []);
    assert.equal(draft.useText, true);
    assert.equal(draft.matchType, 'contains');
    // Type and amount are pre-filled but unticked, ready to be turned on.
    assert.equal(draft.useType, false);
    assert.equal(draft.transactionTypeEquals, 'Inward Payment');
    assert.equal(draft.useAmount, false);
    // Both bounds start at the transaction amount — an exact pin until widened.
    assert.equal(draft.amountMin, 1150);
    assert.equal(draft.amountMax, 1150);
    assert.equal(draft.propertyId, 'propA');
    assert.equal(draft.category, 'Rent');
  });

  it('ticks the amount when another property already claims this description', () => {
    const existing = [rule({ id: 'r1', matchText: 'PETERBOROUGH', propertyId: 'propB', category: 'Rent' })];
    const draft = draftRuleFromTransaction(TENANT, existing);
    assert.equal(draft.useAmount, true);
    assert.equal(draft.collides, true);
  });

  it('does not tick the amount when the same property already has that text', () => {
    const existing = [rule({ id: 'r1', matchText: 'PETERBOROUGH', propertyId: 'propA', category: 'Rent' })];
    assert.equal(draftRuleFromTransaction(TENANT, existing).useAmount, false);
  });

  it('detects a collision even when the existing rule is broader than the description', () => {
    // The full description no longer equals the other rule's text, so this only
    // works because collision is tested by matching, not string comparison.
    const existing = [rule({ id: 'r1', matchText: 'Agyapong', propertyId: 'propB', category: 'Rent' })];
    assert.equal(draftRuleFromTransaction(TENANT, existing).useAmount, true);
  });
});

describe('draftToRule', () => {
  it('drops unticked conditions rather than storing empty ones', () => {
    const draft = draftRuleFromTransaction(TENANT, []);
    const built = draftToRule(draft, 'r1');
    assert.equal(built.matchText, 'S Agyapong 3 PETERBOROUGH GAT');
    assert.equal('transactionTypeEquals' in built, false);
    assert.equal('amountEquals' in built, false);
  });

  it('keeps every ticked condition, rounding the bounds to the penny', () => {
    const built = draftToRule(
      {
        ...draftRuleFromTransaction(TENANT, []),
        useType: true,
        useAmount: true,
        amountMin: '1150.005',
        amountMax: '1150.005',
      },
      'r1',
    );
    assert.equal(built.transactionTypeEquals, 'Inward Payment');
    assert.equal(built.amountMin, 1150.01);
    assert.equal(built.amountMax, 1150.01);
  });

  it('puts inverted bounds the right way round', () => {
    const built = draftToRule(
      { ...draftRuleFromTransaction(TENANT, []), useAmount: true, amountMin: 1200, amountMax: 1100 },
      'r1',
    );
    assert.equal(built.amountMin, 1100);
    assert.equal(built.amountMax, 1200);
  });

  it('produces a rule that matches the transaction it came from', () => {
    const draft = { ...draftRuleFromTransaction(TENANT, []), useType: true, useAmount: true };
    assert.equal(findMatchingRule(TENANT, [draftToRule(draft, 'r1')]).id, 'r1');
  });

  it('supports a type-and-amount rule with no text at all', () => {
    const built = draftToRule(
      { ...draftRuleFromTransaction(TENANT, []), useText: false, useType: true, useAmount: true },
      'r1',
    );
    assert.equal(built.matchText, '');
    assert.equal(findMatchingRule(TENANT, [built]).id, 'r1');
    // Same type and amount but a different payee still matches — that is the
    // point of dropping the text condition.
    assert.equal(findMatchingRule({ ...TENANT, details: 'SOMEONE ELSE' }, [built]).id, 'r1');
  });
});

describe('validateDraft', () => {
  const base = draftRuleFromTransaction(TENANT, []);

  it('accepts a valid draft', () => {
    assert.equal(validateDraft(base), null);
  });

  it('refuses a rule with no conditions, which would match everything', () => {
    assert.match(validateDraft({ ...base, useText: false }), /at least one condition/i);
  });

  it('refuses ticked-but-empty conditions', () => {
    assert.match(validateDraft({ ...base, matchText: '   ' }), /untick Details/i);
    assert.match(validateDraft({ ...base, useType: true, transactionTypeEquals: '' }), /untick Type/i);
    assert.match(validateDraft({ ...base, useAmount: true, amountMin: '' }), /untick Amount/i);
    assert.match(validateDraft({ ...base, useAmount: true, amountMax: '' }), /untick Amount/i);
  });

  it('refuses an invalid regular expression', () => {
    assert.match(validateDraft({ ...base, matchType: 'regex', matchText: '([' }), /regular expression/i);
  });

  it('refuses a range that crosses zero, which would match income and expenses alike', () => {
    assert.match(
      validateDraft({ ...base, useAmount: true, amountMin: -50, amountMax: 50 }),
      /crosses zero/i,
    );
  });

  it('requires a property and a category', () => {
    assert.match(validateDraft({ ...base, propertyId: '' }), /property/i);
    assert.match(validateDraft({ ...base, category: null }), /category/i);
  });
});
