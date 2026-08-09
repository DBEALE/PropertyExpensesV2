import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseStatement } from '../src/csv.js';
import {
  collidesWithOtherProperty,
  countMatches,
  describeRule,
  findMatchingRule,
  matchesText,
} from '../src/rules.js';
import { FIXTURE, rule } from './fixtures.js';

describe('matchesText', () => {
  it('matches case-insensitively on contains by default', () => {
    const r = rule({ id: 'r', matchText: 'peterborough', propertyId: 'a' });
    assert.equal(matchesText(r, 'S Agyapong 3 PETERBOROUGH GAT'), true);
    assert.equal(matchesText(r, 'SOMEWHERE ELSE'), false);
  });

  it('supports exact matching', () => {
    const r = rule({ id: 'r', matchText: 'NATWEST BANK', propertyId: 'a', matchType: 'exact' });
    assert.equal(matchesText(r, 'natwest bank'), true);
    assert.equal(matchesText(r, 'NATWEST BANK PLC'), false);
  });

  it('supports regex matching and ignores invalid patterns', () => {
    const good = rule({ id: 'r', matchText: '^NATWEST\\s', propertyId: 'a', matchType: 'regex' });
    const broken = rule({ id: 'r', matchText: '([', propertyId: 'a', matchType: 'regex' });
    assert.equal(matchesText(good, 'NATWEST BANK'), true);
    assert.equal(matchesText(broken, 'anything'), false);
  });
});

describe('findMatchingRule', () => {
  const rows = parseStatement(FIXTURE);
  const natwestA = rule({ id: 'a', matchText: 'NATWEST BANK', propertyId: 'propA', amountEquals: -428.06 });
  const natwestB = rule({ id: 'b', matchText: 'NATWEST BANK', propertyId: 'propB', amountEquals: -512.4 });

  it('leaves a transaction unmatched when no rule applies', () => {
    assert.equal(findMatchingRule(rows[0], [natwestA, natwestB]), null);
  });

  it('routes each amount-pinned payment to the right property', () => {
    assert.equal(findMatchingRule(rows[1], [natwestA, natwestB]).propertyId, 'propA');
    assert.equal(
      findMatchingRule({ details: 'NATWEST BANK', amount: -512.4 }, [natwestA, natwestB]).propertyId,
      'propB',
    );
  });

  it('leaves a third, unpinned amount unassigned rather than guessing', () => {
    assert.equal(findMatchingRule({ details: 'NATWEST BANK', amount: -99.99 }, [natwestA, natwestB]), null);
  });

  it('prefers an amount-pinned rule over a text-only rule for the same payee', () => {
    const textOnly = rule({ id: 'c', matchText: 'NATWEST', propertyId: 'propC' });
    // Order deliberately puts the loose rule first: the pinned pass still wins.
    assert.equal(findMatchingRule(rows[1], [textOnly, natwestA]).id, 'a');
    // An amount matching no pin falls through to the text-only rule.
    assert.equal(findMatchingRule({ details: 'NATWEST BANK', amount: -1 }, [textOnly, natwestA]).id, 'c');
  });

  it('matches a tenant payment on a text-only property keyword', () => {
    const rent = rule({ id: 'rent', matchText: 'PETERBOROUGH', propertyId: 'propA', category: 'Rent' });
    const matched = findMatchingRule(rows[2], [rent]);
    assert.equal(matched.category, 'Rent');
    assert.equal(matched.propertyId, 'propA');
  });

  it('compares pinned amounts to the penny despite float representation', () => {
    const pinned = rule({ id: 'p', matchText: 'X', propertyId: 'a', amountEquals: 0.3 });
    assert.notEqual(findMatchingRule({ details: 'X', amount: 0.1 + 0.2 }, [pinned]), null);
  });
});

describe('condition combinations', () => {
  const tx = { details: 'NATWEST BANK', transactionType: 'Direct Debit', amount: -428.06 };

  it('matches on transaction type alone', () => {
    const r = rule({ id: 'a', matchText: '', propertyId: 'propA', transactionTypeEquals: 'Direct Debit' });
    assert.equal(findMatchingRule(tx, [r]).id, 'a');
    assert.equal(findMatchingRule({ ...tx, transactionType: 'Card Payment' }, [r]), null);
  });

  it('compares transaction type case-insensitively, ignoring surrounding space', () => {
    const r = rule({ id: 'a', matchText: '', propertyId: 'propA', transactionTypeEquals: ' direct debit ' });
    assert.equal(findMatchingRule(tx, [r]).id, 'a');
  });

  it('matches on amount alone', () => {
    const r = rule({ id: 'a', matchText: '', propertyId: 'propA', amountEquals: -428.06 });
    assert.equal(findMatchingRule(tx, [r]).id, 'a');
    assert.equal(findMatchingRule({ ...tx, amount: -1 }, [r]), null);
  });

  it('requires every condition set to hold', () => {
    const all = rule({
      id: 'a',
      matchText: 'NATWEST',
      propertyId: 'propA',
      transactionTypeEquals: 'Direct Debit',
      amountEquals: -428.06,
    });
    assert.equal(findMatchingRule(tx, [all]).id, 'a');
    // Each field in turn made wrong must break the match.
    assert.equal(findMatchingRule({ ...tx, details: 'BARCLAYS' }, [all]), null);
    assert.equal(findMatchingRule({ ...tx, transactionType: 'Card Payment' }, [all]), null);
    assert.equal(findMatchingRule({ ...tx, amount: -1 }, [all]), null);
  });

  it('never matches a rule with no conditions at all', () => {
    assert.equal(findMatchingRule(tx, [rule({ id: 'a', matchText: '', propertyId: 'propA' })]), null);
  });

  it('tries more specific rules first regardless of insertion order', () => {
    const textOnly = rule({ id: 'text', matchText: 'NATWEST', propertyId: 'propA' });
    const withType = rule({
      id: 'type',
      matchText: 'NATWEST',
      propertyId: 'propB',
      transactionTypeEquals: 'Direct Debit',
    });
    const withAmount = rule({ id: 'amount', matchText: 'NATWEST', propertyId: 'propC', amountEquals: -428.06 });

    assert.equal(findMatchingRule(tx, [textOnly, withType, withAmount]).id, 'amount');
    assert.equal(findMatchingRule(tx, [textOnly, withType]).id, 'type');
    assert.equal(findMatchingRule(tx, [textOnly]).id, 'text');
    // A transaction the specific rules don't cover still falls back to the loose one.
    assert.equal(findMatchingRule({ ...tx, amount: -9, transactionType: 'Card Payment' }, [textOnly, withType, withAmount]).id, 'text');
  });

  it('orders equally specific rules by insertion order', () => {
    const first = rule({ id: 'first', matchText: 'NATWEST', propertyId: 'propA' });
    const second = rule({ id: 'second', matchText: 'BANK', propertyId: 'propB' });
    assert.equal(findMatchingRule(tx, [first, second]).id, 'first');
    assert.equal(findMatchingRule(tx, [second, first]).id, 'second');
  });
});

describe('describeRule', () => {
  it('spells out every condition a rule sets', () => {
    const r = rule({
      id: 'a',
      matchText: 'NATWEST',
      propertyId: 'propA',
      transactionTypeEquals: 'Direct Debit',
      amountEquals: -428.06,
    });
    assert.equal(
      describeRule(r, (n) => n.toFixed(2)),
      'Details contains "NATWEST" and Type is "Direct Debit" and Amount is -428.06',
    );
  });

  it('reports a rule that sets nothing', () => {
    assert.equal(describeRule(rule({ id: 'a', matchText: '', propertyId: 'propA' })), 'No conditions set');
  });
});

describe('countMatches', () => {
  it('attributes each transaction to the single rule that claims it', () => {
    const rows = parseStatement(FIXTURE);
    const rules = [
      rule({ id: 'a', matchText: 'NATWEST BANK', propertyId: 'propA', amountEquals: -428.06 }),
      rule({ id: 'b', matchText: 'NATWEST', propertyId: 'propB' }),
      rule({ id: 'c', matchText: 'DIRECT LINE', propertyId: 'propA', category: 'Ins' }),
    ];
    const counts = countMatches(rules, rows);
    // The pinned rule takes the NATWEST row, so the looser rule counts zero.
    assert.equal(counts.get('a'), 1);
    assert.equal(counts.get('b'), 0);
    assert.equal(counts.get('c'), 1);
  });
});

describe('collidesWithOtherProperty', () => {
  const existing = [rule({ id: 'a', matchText: 'NATWEST', propertyId: 'propA' })];

  it('flags a description another property already claims', () => {
    assert.equal(collidesWithOtherProperty({ details: 'NATWEST BANK', propertyId: 'propB' }, existing), true);
  });

  it('does not flag the same property, or a payee no rule covers', () => {
    assert.equal(collidesWithOtherProperty({ details: 'NATWEST BANK', propertyId: 'propA' }, existing), false);
    assert.equal(collidesWithOtherProperty({ details: 'PETERBOROUGH', propertyId: 'propB' }, existing), false);
  });

  it('ignores rules that set no text condition', () => {
    const amountOnly = [rule({ id: 'a', matchText: '', propertyId: 'propA', amountEquals: -1 })];
    assert.equal(collidesWithOtherProperty({ details: 'ANYTHING', propertyId: 'propB' }, amountOnly), false);
  });
});
