import type { Request, RequestHandler } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, mediaObjectsTable, postsTable, privatePostsTable, usersTable, subscriptionsTable, subscriptionPaymentsTable } from "@workspace/db";

export async function viewerId(req: Request): Promise<number | null> {
  const wallet = req.headers["x-wallet-address"];
  if (typeof wallet !== "string") return null; // populated by protectApi only
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.walletAddress, wallet));
  return user?.id ?? null;
}

export async function verifiedCreatorIds(userId: number): Promise<Set<number>> {
  const rows = await db.select({ creatorId: subscriptionsTable.creatorId }).from(subscriptionsTable)
    .innerJoin(subscriptionPaymentsTable, and(
      sql`lower(${subscriptionsTable.txHash}) = ${subscriptionPaymentsTable.txHash}`,
      eq(subscriptionPaymentsTable.subscriberId, subscriptionsTable.subscriberId),
      eq(subscriptionPaymentsTable.creatorId, subscriptionsTable.creatorId)))
    .where(and(eq(subscriptionsTable.subscriberId, userId), gt(subscriptionsTable.expiresAt, new Date()),
      sql`${subscriptionsTable.pricePerMonth} > 0`));
  return new Set(rows.map(row => row.creatorId));
}

export async function canReadCreator(userId: number | null, creatorId: number): Promise<boolean> {
  return userId !== null && (userId === creatorId || (await verifiedCreatorIds(userId)).has(creatorId));
}

// Reject noncanonical paths rather than letting URL/GCS normalization select a
// different object. Remote URLs are not accepted as managed storage aliases.
export function canonicalObjectPath(value: string): string | null {
  const path = value.startsWith("/api/storage/") ? value.slice("/api/storage".length) : value;
  return /^\/objects\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) &&
    !path.split("/").some(segment => segment === "." || segment === "..") ? path : null;
}

export function mediaKey(value: string): string {
  const direct = canonicalObjectPath(value);
  if (direct) return direct;
  try {
    const url = new URL(value, "https://local.invalid");
    const pathname = decodeURIComponent(url.pathname);
    const managed = canonicalObjectPath(pathname);
    if (managed) return managed;
    const privateDir = process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/, "");
    if (url.hostname === "storage.googleapis.com" && privateDir && pathname.startsWith(`${privateDir}/`)) {
      const path = canonicalObjectPath(`/objects/${pathname.slice(privateDir.length + 1)}`);
      if (path) return path;
    }
    if (pathname.startsWith("/api/storage/public-objects/")) return pathname;
    // Query/hash variations of a private external URL are not public aliases.
    if (/^https?:/.test(url.protocol) && !value.startsWith("/")) return `${url.origin}${pathname}`;
  } catch { /* Invalid legacy values remain untrusted exact references. */ }
  return value;
}

type Evidence = { owners: Set<number>; private: boolean; public: boolean; trustedOwner?: number; binding?: string };
export async function mediaEvidence(): Promise<Map<string, Evidence>> {
  const map = new Map<string, Evidence>();
  function add(url: string | null, owner: number, privateRef: boolean, publicRef: boolean) {
    if (!url) return;
    const key = mediaKey(url);
    const entry = map.get(key) ?? { owners: new Set<number>(), private: false, public: false };
    entry.owners.add(owner);
    entry.private ||= privateRef;
    entry.public ||= publicRef;
    map.set(key, entry);
  }
  const [posts, privatePosts, profiles, objects] = await Promise.all([
    db.select({ url: postsTable.imageUrl, owner: postsTable.authorId, paid: postsTable.isPaid }).from(postsTable),
    db.select({ url: privatePostsTable.imageUrl, owner: privatePostsTable.creatorId }).from(privatePostsTable),
    db.select({ url: usersTable.avatarUrl, owner: usersTable.id }).from(usersTable),
    db.select().from(mediaObjectsTable),
  ]);
  for (const p of posts) add(p.url, p.owner, p.paid, !p.paid);
  for (const p of privatePosts) add(p.url, p.owner, true, false);
  for (const p of profiles) add(p.url, p.owner, false, true);
  for (const o of objects) {
    add(o.objectPath, o.ownerId, o.visibility === "private", o.visibility === "public");
    const e = map.get(mediaKey(o.objectPath))!;
    e.trustedOwner = o.ownerId;
    e.binding = o.visibility;
  }
  return map;
}

export function mayReadMedia(e: Evidence | undefined, viewer: number | null, subscribed: Set<number>): boolean {
  if (!e || e.owners.size !== 1) return false;
  const owner = [...e.owners][0];
  if (viewer === owner) return true;
  if (e.private) return subscribed.has(owner);
  // Unbound uploads are never downloadable by other users.
  return e.binding !== "unbound" && e.public;
}

// A single conditional UPDATE arbitrates concurrent conflicting bindings.
// Provenance cannot be claimed from user metadata or a legacy URL.
export async function bindNewImage(url: string, ownerId: number, visibility: "public" | "private"): Promise<void> {
  const path = canonicalObjectPath(url);
  if (!path) {
    // Public remote images remain supported, but cannot alias private references.
    const key = mediaKey(url);
    if (visibility === "public" && /^https:\/\//.test(url) && !url.includes("storage.googleapis.com") &&
        !key.startsWith("/objects/") && !key.startsWith("/api/storage/") &&
        !(await mediaEvidence()).get(key)?.private) return;
    throw new Error("Use a newly uploaded managed image for this content");
  }
  const evidence = (await mediaEvidence()).get(path);
  if (!evidence || evidence.owners.size !== 1 || evidence.trustedOwner !== ownerId ||
      (visibility === "public" ? evidence.private : evidence.public)) {
    throw new Error("Image ownership or visibility conflicts with this use");
  }
  const rows = await db.update(mediaObjectsTable).set({ visibility })
    .where(and(eq(mediaObjectsTable.objectPath, path), eq(mediaObjectsTable.ownerId, ownerId),
      sql`${mediaObjectsTable.visibility} in ('unbound', ${visibility})`)).returning();
  if (!rows.length) throw new Error("Image binding conflict");
}

export async function preservePrivateBinding(url: string, ownerId: number): Promise<void> {
  // Retain a private tombstone even for remote legacy images, so deleting the
  // private post cannot turn an old public/avatar alias into a public image.
  const path = mediaKey(url);
  await db.insert(mediaObjectsTable).values({ objectPath: path, ownerId, visibility: "private" })
    .onConflictDoUpdate({ target: mediaObjectsTable.objectPath, set: { visibility: "private" } });
}

// Last-mile JSON protection also covers avatars, analytics, search results and
// historical notification snippets. Never trust a caller's subscription flag.
export const privateResponses: RequestHandler = (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.vary("Cookie");
  const send = res.json.bind(res);
  res.json = ((body: unknown) => {
    void (async () => {
      const viewer = await viewerId(req);
      const subscribed = viewer === null ? new Set<number>() : await verifiedCreatorIds(viewer);
      const evidence = await mediaEvidence();
      const posts = await db.select({ id: postsTable.id, author: postsTable.authorId, isPaid: postsTable.isPaid }).from(postsTable);
      const liveIds = new Set(posts.map(p => p.id));
      const paidAuthors = new Map(posts.filter(p => p.isPaid).map(p => [p.id, p.author]));
      const allowed = (owner: number) => viewer === owner || subscribed.has(owner);
      function clean(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(clean);
        if (!value || typeof value !== "object" || value instanceof Date) return value;
        const row = { ...(value as Record<string, unknown>) };
        const owner = typeof row.authorId === "number" && typeof row.id === "number" && !("postId" in row)
          ? paidAuthors.get(row.id) : undefined;
        if (owner !== undefined) {
          row.isPaid = true;
          row.isSubscribedToAuthor = allowed(owner);
        }
        if (owner !== undefined && !allowed(owner)) {
          row.content = ""; row.imageUrl = null; row.isSubscribedToAuthor = false;
        }
        if (row.resourceType === "post" && typeof row.resourceId === "number") {
          const author = paidAuthors.get(row.resourceId);
          if (!liveIds.has(row.resourceId) || (author !== undefined && !allowed(author))) {
            row.body = "Activity on an unavailable or exclusive post"; row.title = "Post activity";
          }
        }
        for (const [key, val] of Object.entries(row)) {
          if (/url$/i.test(key) && typeof val === "string") {
            const imageKey = mediaKey(val);
            const path = canonicalObjectPath(imageKey);
            const e = evidence.get(imageKey);
            if ((path || e?.private) && !mayReadMedia(e, viewer, subscribed)) row[key] = null;
          } else row[key] = clean(val);
        }
        return row;
      }
      send(clean(body));
    })().catch(err => { req.log.error({ err }, "Privacy response failed"); res.status(503); send({ error: "Content authorization unavailable" }); });
    return res;
  }) as typeof res.json;
  next();
};