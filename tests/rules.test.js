import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseStatement } from '../src/csv.js';
import { countMatches, findMatchingRule, matchesText, shouldSuggestAmountPin } from '../src/rules.js';
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

describe('shouldSuggestAmountPin', () => {
  const existing = [rule({ id: 'a', matchText: 'NATWEST BANK', propertyId: 'propA' })];

  it('suggests pinning when the same text already points at another property', () => {
    assert.equal(shouldSuggestAmountPin('natwest bank', 'propB', existing), true);
  });

  it('does not suggest pinning for the same property or a new payee', () => {
    assert.equal(shouldSuggestAmountPin('NATWEST BANK', 'propA', existing), false);
    assert.equal(shouldSuggestAmountPin('PETERBOROUGH', 'propB', existing), false);
  });
});
