/**
 * An estimate of the income tax due on property profits.
 *
 * The rule that makes this worth computing rather than eyeballing: since
 * 2020/21 mortgage interest is **not** an allowable expense. It is left out of
 * the profit, and instead earns a **20% tax credit**, capped at the lowest of
 * the finance costs, the property profits, and income above the personal
 * allowance. That cap is why a landlord with a big mortgage and a small profit
 * cannot always use all of their interest.
 *
 * Bands are England, Wales and Northern Ireland. Scotland has its own rates on
 * non-savings income; the settings are editable, but the band *structure* here
 * is the rUK one.
 *
 * This is an estimate to plan with, not a tax return. Pure functions; no DOM,
 * no storage.
 */

/**
 * 2025/26 figures, frozen through to 2027/28 at the time of writing. All
 * editable, because a threshold change should not need a code change.
 */
export const DEFAULT_TAX_SETTINGS = {
  /** Income from everything else — employment, pension, dividends — before tax. */
  otherIncome: 0,
  personalAllowance: 12570,
  /** The allowance tapers away above this, by £1 for every £2 over. */
  allowanceTaperFrom: 100000,
  /** Width of the basic-rate band above the allowance. */
  basicBandWidth: 37700,
  /** Total income above which the additional rate applies. */
  additionalRateFrom: 125140,
  basicRate: 20,
  higherRate: 40,
  additionalRate: 45,
  /** Rate of the finance-cost tax credit. */
  financeCreditRate: 20,
  /** The category holding mortgage interest, since categories are editable. */
  financeCostCategoryId: 'Interest',
  /** Your share of the property income, for a jointly owned portfolio. */
  ownershipShare: 100,
  /** The £1,000 property allowance, claimed instead of actual expenses. */
  usePropertyAllowance: false,
  propertyAllowance: 1000,
};

const round = (n) => Math.round(n * 100) / 100;

/** The personal allowance actually available, after the taper. */
export function allowanceFor(income, settings) {
  const { personalAllowance, allowanceTaperFrom } = settings;
  const excess = Math.max(0, income - allowanceTaperFrom);
  return Math.max(0, personalAllowance - excess / 2);
}

/**
 * Income tax on a total income, using the band structure in `settings`.
 * @param {number} income
 * @param {object} settings
 */
export function incomeTaxOn(income, settings) {
  if (income <= 0) return 0;
  const allowance = allowanceFor(income, settings);
  const taxable = Math.max(0, income - allowance);
  if (taxable === 0) return 0;

  const basicBand = Math.max(0, settings.basicBandWidth);
  // The additional-rate threshold is a *total income* figure, so the higher
  // band runs from the end of the basic band up to it.
  const higherBand = Math.max(0, settings.additionalRateFrom - allowance - basicBand);

  const atBasic = Math.min(taxable, basicBand);
  const atHigher = Math.min(Math.max(0, taxable - basicBand), higherBand);
  const atAdditional = Math.max(0, taxable - basicBand - higherBand);

  return round(
    (atBasic * settings.basicRate) / 100 +
      (atHigher * settings.higherRate) / 100 +
      (atAdditional * settings.additionalRate) / 100,
  );
}

/**
 * Splits a property's shares into the three figures the calculation needs.
 *
 * @param {{category: string|null, amount: number}[]} shares
 * @param {object} settings
 */
export function summariseForTax(shares, settings) {
  const share = Math.min(Math.max(Number(settings.ownershipShare) || 0, 0), 100) / 100;
  let income = 0;
  let expenses = 0;
  let financeCosts = 0;

  for (const entry of shares) {
    const amount = entry.amount * share;
    if (entry.category === settings.financeCostCategoryId) {
      // Interest is neither income nor an allowable expense; it earns a credit.
      financeCosts += Math.abs(amount);
    } else if (amount > 0) {
      income += amount;
    } else {
      expenses += Math.abs(amount);
    }
  }

  return { income: round(income), expenses: round(expenses), financeCosts: round(financeCosts) };
}

/**
 * The estimate itself.
 *
 * @param {{income: number, expenses: number, financeCosts: number}} figures
 * @param {object} settings
 */
export function estimateTax(figures, settings) {
  const { income, financeCosts } = figures;

  // The £1,000 property allowance is claimed *instead of* expenses, so it only
  // helps when expenses are smaller than it.
  const deduction = settings.usePropertyAllowance
    ? Math.min(settings.propertyAllowance, income)
    : figures.expenses;
  const profit = round(Math.max(0, income - deduction));
  const loss = round(Math.max(0, deduction - income));

  const otherIncome = Math.max(0, Number(settings.otherIncome) || 0);
  const taxOnOther = incomeTaxOn(otherIncome, settings);
  const taxOnTotal = incomeTaxOn(otherIncome + profit, settings);
  // Property profit sits on top of other income, so its tax is the difference
  // the two make — that is what puts it in the right band.
  const taxBeforeCredit = round(Math.max(0, taxOnTotal - taxOnOther));

  // The credit is capped at the lowest of finance costs, property profits, and
  // income above the personal allowance.
  const totalIncome = otherIncome + profit;
  const aboveAllowance = Math.max(0, totalIncome - allowanceFor(totalIncome, settings));
  const creditBase = round(Math.min(financeCosts, profit, aboveAllowance));
  const financeCredit = round((creditBase * settings.financeCreditRate) / 100);
  const unusedFinanceCosts = round(Math.max(0, financeCosts - creditBase));

  const taxDue = round(Math.max(0, taxBeforeCredit - financeCredit));

  return {
    income,
    expenses: figures.expenses,
    deduction: round(deduction),
    financeCosts,
    profit,
    loss,
    taxBeforeCredit,
    creditBase,
    financeCredit,
    unusedFinanceCosts,
    taxDue,
    /** The band the last pound of profit fell in, for the explanation line. */
    marginalRate: marginalRateFor(otherIncome + profit, settings),
    effectiveRate: profit > 0 ? round((taxDue / profit) * 100) : 0,
  };
}

/** Which band a total income tops out in. */
export function marginalRateFor(income, settings) {
  const allowance = allowanceFor(income, settings);
  if (income <= allowance) return 0;
  if (income > settings.additionalRateFrom) return settings.additionalRate;
  if (income - allowance > settings.basicBandWidth) return settings.higherRate;
  return settings.basicRate;
}

/** Fills in anything missing, so an older saved settings record still works. */
export function withDefaults(settings) {
  return { ...DEFAULT_TAX_SETTINGS, ...(settings ?? {}) };
}
