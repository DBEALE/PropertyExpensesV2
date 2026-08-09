/** The three example rows from the spec, used across the test files. */
export const FIXTURE = `Date,Details,Transaction Type,In,Out,Balance
30/07/2026,DIRECT LINE FR BUS,Direct Debit,,30.16,16019.21
30/07/2026,NATWEST BANK,Direct Debit,,428.06,16049.37
24/07/2026,S Agyapong 3 PETERBOROUGH GAT,Inward Payment,1150.00,,16477.43`;

/** Deterministic ids, so assertions don't depend on crypto.randomUUID. */
export function idFactory(prefix = 't') {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** Builds a Rule with the boring fields filled in. */
export function rule(partial) {
  return { matchType: 'contains', category: 'Interest', ...partial };
}
