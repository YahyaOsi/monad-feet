export class CreatorError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function requireCondition(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new CreatorError(status, message);
}
