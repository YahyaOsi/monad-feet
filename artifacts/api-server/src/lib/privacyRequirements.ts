/** Collect exactly the resources the existing response sanitizer inspects. */
export function privacyRequirements(body: unknown) {
  const postIds = new Set<number>();
  let media = false, privateHistory = false;
  function visit(value: unknown) {
    if (!value || typeof value !== "object" || value instanceof Date) return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const row = value as Record<string, unknown>;
    if (typeof row.authorId === "number" && typeof row.id === "number" && !("postId" in row)) postIds.add(row.id);
    if (row.resourceType === "post" && typeof row.resourceId === "number") postIds.add(row.resourceId);
    if (row.source === "private" && typeof row.creatorId === "number") privateHistory = true;
    for (const [key, val] of Object.entries(row)) {
      if (/url$/i.test(key) && typeof val === "string") media = true;
      else visit(val);
    }
  }
  visit(body);
  return { postIds: [...postIds], media, needed: media || privateHistory || postIds.size > 0 };
}
