export function uniqueMembers<T extends { userId: number }>(users: T[]): T[] {
  return Array.from(new Map(users.map(user => [user.userId, user])).values());
}