/**
 * The tax estimate. The rules being encoded:
 *
 *   - mortgage interest is not an allowable expense; it earns a 20% credit,
 *     capped at the lowest of the interest, the profit, and income above the
 *     personal allowance;
 *   - property profit stacks on top of other income, so it is taxed at the
 *     band it lands in, not at some average;
 *   - the personal allowance tapers away above £100,000.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_TAX_SETTINGS,
  allowanceFor,
  estimateTax,
  incomeTaxOn,
  marginalRateFor,
  summariseForTax,
  withDefaults,
} from '../src/tax.js';

const S = DEFAULT_TAX_SETTINGS;

describe('allowanceFor', () => {
  it('is the full allowance on ordinary incomes', () => {
    assert.equal(allowanceFor(0, S), 12570);
    assert.equal(allowanceFor(100000, S), 12570);
  });

  it('tapers by £1 for every £2 above £100,000', () => {
    assert.equal(allowanceFor(110000, S), 7570);
    assert.equal(allowanceFor(120000, S), 2570);
  });

  it('is gone entirely by £125,140', () => {
    assert.equal(allowanceFor(125140, S), 0);
    assert.equal(allowanceFor(200000, S), 0);
  });
});

describe('incomeTaxOn', () => {
  it('is nothing at or below the allowance', () => {
    assert.equal(incomeTaxOn(0, S), 0);
    assert.equal(incomeTaxOn(12570, S), 0);
  });

  it('charges basic rate on the band above the allowance', () => {
    // £20,000: £7,430 taxable at 20%.
    assert.equal(incomeTaxOn(20000, S), 1486);
    // Top of the basic band, £50,270: £37,700 at 20%.
    assert.equal(incomeTaxOn(50270, S), 7540);
  });

  it('charges higher rate above the basic band', () => {
    // £60,000: £37,700 at 20% plus £9,730 at 40%.
    assert.equal(incomeTaxOn(60000, S), 7540 + 3892);
  });

  it('charges additional rate above £125,140, with no allowance left', () => {
    // £150,000: 37,700 at 20%, 87,440 at 40%, 24,860 at 45%.
    const expected = 37700 * 0.2 + 87440 * 0.4 + 24860 * 0.45;
    assert.equal(incomeTaxOn(150000, S), Math.round(expected * 100) / 100);
  });
});

describe('marginalRateFor', () => {
  it('names the band the last pound falls in', () => {
    assert.equal(marginalRateFor(10000, S), 0);
    assert.equal(marginalRateFor(30000, S), 20);
    assert.equal(marginalRateFor(60000, S), 40);
    assert.equal(marginalRateFor(150000, S), 45);
  });
});

describe('summariseForTax', () => {
  const shares = [
    { category: 'Rent', amount: 12000 },
    { category: 'Ins', amount: -400 },
    { category: 'Repairs', amount: -1600 },
    { category: 'Interest', amount: -5000 },
  ];

  it('separates income, allowable expenses and finance costs', () => {
    assert.deepEqual(summariseForTax(shares, S), { income: 12000, expenses: 2000, financeCosts: 5000 });
  });

  it('keeps interest out of the expenses, whichever category holds it', () => {
    const renamed = [
      { category: 'Rent', amount: 12000 },
      { category: 'mortgage-interest', amount: -5000 },
    ];
    const settings = { ...S, financeCostCategoryId: 'mortgage-interest' };
    const summary = summariseForTax(renamed, settings);
    assert.equal(summary.expenses, 0);
    assert.equal(summary.financeCosts, 5000);
  });

  it('applies your share of a jointly owned portfolio', () => {
    const half = summariseForTax(shares, { ...S, ownershipShare: 50 });
    assert.deepEqual(half, { income: 6000, expenses: 1000, financeCosts: 2500 });
  });

  it('treats a refund in an expense category as income, by its sign', () => {
    const refund = summariseForTax([{ category: 'Repairs', amount: 250 }], S);
    assert.equal(refund.income, 250);
    assert.equal(refund.expenses, 0);
  });
});

describe('estimateTax', () => {
  it('taxes the profit at the band it lands in, on top of other income', () => {
    // £12,000 rent less £2,000 expenses = £10,000 profit, on top of a £40,000
    // salary: all still within the basic band.
    const basic = estimateTax({ income: 12000, expenses: 2000, financeCosts: 0 }, { ...S, otherIncome: 40000 });
    assert.equal(basic.profit, 10000);
    assert.equal(basic.taxBeforeCredit, 2000);
    assert.equal(basic.marginalRate, 20);

    // The same profit on a £60,000 salary is taxed at 40% throughout.
    const higher = estimateTax({ income: 12000, expenses: 2000, financeCosts: 0 }, { ...S, otherIncome: 60000 });
    assert.equal(higher.taxBeforeCredit, 4000);
    assert.equal(higher.marginalRate, 40);
  });

  it('splits a profit that straddles two bands', () => {
    // Salary £45,000 leaves £5,270 of basic band; a £10,000 profit uses it and
    // spills £4,730 into higher rate.
    const straddle = estimateTax({ income: 10000, expenses: 0, financeCosts: 0 }, { ...S, otherIncome: 45000 });
    assert.equal(straddle.taxBeforeCredit, Math.round((5270 * 0.2 + 4730 * 0.4) * 100) / 100);
  });

  it('gives interest a 20% credit rather than deducting it', () => {
    // £12,000 rent, £2,000 expenses, £5,000 interest, £40,000 salary.
    const e = estimateTax({ income: 12000, expenses: 2000, financeCosts: 5000 }, { ...S, otherIncome: 40000 });
    // Interest does NOT reduce the profit...
    assert.equal(e.profit, 10000);
    // ...it reduces the tax by 20% of itself.
    assert.equal(e.financeCredit, 1000);
    assert.equal(e.taxDue, 1000);
    // Deducting it instead would have given £8,000 profit and £1,600 tax, so
    // the difference is real money, not a rounding detail.
    assert.notEqual(e.taxDue, 1600);
  });

  it('caps the credit at the profit when interest exceeds it', () => {
    // £6,000 interest against a £4,000 profit: the credit is on £4,000.
    const e = estimateTax({ income: 10000, expenses: 6000, financeCosts: 6000 }, { ...S, otherIncome: 40000 });
    assert.equal(e.profit, 4000);
    assert.equal(e.creditBase, 4000);
    assert.equal(e.financeCredit, 800);
    assert.equal(e.unusedFinanceCosts, 2000);
  });

  it('caps the credit at income above the personal allowance', () => {
    // No other income and a small profit: the allowance covers everything, so
    // there is no tax to credit against.
    const e = estimateTax({ income: 8000, expenses: 1000, financeCosts: 5000 }, { ...S, otherIncome: 0 });
    assert.equal(e.taxBeforeCredit, 0);
    assert.equal(e.taxDue, 0);
    assert.equal(e.creditBase, 0, 'nothing above the allowance to credit');
  });

  it('never returns a negative tax bill', () => {
    const e = estimateTax({ income: 12000, expenses: 2000, financeCosts: 50000 }, { ...S, otherIncome: 40000 });
    assert.equal(e.taxDue, 0);
    assert.ok(e.unusedFinanceCosts > 0);
  });

  it('reports a loss rather than a negative profit', () => {
    const e = estimateTax({ income: 5000, expenses: 8000, financeCosts: 0 }, { ...S, otherIncome: 40000 });
    assert.equal(e.profit, 0);
    assert.equal(e.loss, 3000);
    assert.equal(e.taxDue, 0);
  });

  it('uses the property allowance instead of expenses when told to', () => {
    const settings = { ...S, otherIncome: 40000, usePropertyAllowance: true };
    // £900 of expenses is less than the £1,000 allowance, so the allowance wins.
    const e = estimateTax({ income: 5000, expenses: 900, financeCosts: 0 }, settings);
    assert.equal(e.deduction, 1000);
    assert.equal(e.profit, 4000);
  });

  it('never lets the property allowance exceed the income', () => {
    const settings = { ...S, otherIncome: 40000, usePropertyAllowance: true };
    const e = estimateTax({ income: 600, expenses: 0, financeCosts: 0 }, settings);
    assert.equal(e.deduction, 600);
    assert.equal(e.profit, 0);
  });

  it('reports the effective rate on the profit', () => {
    const e = estimateTax({ income: 12000, expenses: 2000, financeCosts: 5000 }, { ...S, otherIncome: 40000 });
    // £1,000 tax on £10,000 profit.
    assert.equal(e.effectiveRate, 10);
  });

  it('handles the taper: a profit that eats into the personal allowance', () => {
    // £105,000 salary already halves the allowance; a £10,000 profit costs
    // more than 40% of itself because it removes £5,000 more allowance.
    const e = estimateTax({ income: 10000, expenses: 0, financeCosts: 0 }, { ...S, otherIncome: 105000 });
    assert.ok(e.taxBeforeCredit > 4000, 'the effective rate exceeds the headline 40%');
    assert.equal(e.taxBeforeCredit, incomeTaxOn(115000, S) - incomeTaxOn(105000, S));
  });
});

describe('withDefaults', () => {
  it('fills in anything a saved record is missing', () => {
    const saved = { otherIncome: 50000 };
    const settings = withDefaults(saved);
    assert.equal(settings.otherIncome, 50000);
    assert.equal(settings.personalAllowance, 12570);
    assert.equal(settings.financeCreditRate, 20);
  });

  it('copes with nothing saved at all', () => {
    assert.deepEqual(withDefaults(undefined), DEFAULT_TAX_SETTINGS);
    assert.deepEqual(withDefaults(null), DEFAULT_TAX_SETTINGS);
  });
});
