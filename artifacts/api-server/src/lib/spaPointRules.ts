/** Purchase numbers are one based, independently counted for each UTC day. */
const rules: Record<number, { base: number; doubles: readonly number[] }> = {
  1: { base: 5, doubles: [2, 4, 7, 10] },
  2: { base: 7, doubles: [2, 3, 4, 6, 7, 9, 10] },
  3: { base: 15, doubles: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
};

export function spaRewardSchedule(actionType: number) {
  const rule = rules[actionType];
  if (!rule) throw new Error("Unknown spa treatment");
  return {
    doublingPurchases: [...rule.doubles],
    dailyRewards: Array.from({ length: 10 }, (_, i) =>
      rule.base * 2 ** rule.doubles.filter(n => n <= i + 1).length),
  };
}

/** Decode the original, verified contract award to determine purchase ordinal.
 * Never use claim submission order, which can differ from purchase order.
 */
export function spaAppPoints(actionType: number, verifiedChainPoints: number) {
  const rule = rules[actionType];
  if (!rule) throw new Error("Unknown spa treatment");
  const exponent = Math.log2(verifiedChainPoints / rule.base);
  if (!Number.isInteger(exponent) || exponent < 0 || exponent >= 10) throw new Error("Invalid confirmed spa reward");
  return spaRewardSchedule(actionType).dailyRewards[exponent];
}
