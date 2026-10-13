export function gameInviteEvery(actionType: number): number | null {
  return actionType === 2 ? 7 : actionType === 3 ? 3 : null;
}

export function gameInviteAward(actionType: number, purchaseCount: number): number {
  const every = gameInviteEvery(actionType);
  return every && purchaseCount > 0 && purchaseCount % every === 0 ? 1 : 0;
}

export function inferGameAction(points: number): number | null {
  for (const [action, base] of [[1, 5], [2, 7], [3, 15]]) {
    if (Array.from({ length: 10 }, (_, n) => base * 2 ** n).includes(points)) return action;
  }
  return null;
}
