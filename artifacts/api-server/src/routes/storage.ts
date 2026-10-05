import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { db, mediaObjectsTable } from "@workspace/db";
import { canonicalObjectPath, mediaEvidence, mayReadMedia, viewerId, verifiedCreatorIds } from "../lib/contentPrivacy";

function parseUploadUrlBody(body: unknown): { name: string; size: number; contentType: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || typeof b.contentType !== "string") return null;
  const size = typeof b.size === "number" ? b.size : parseInt(String(b.size), 10);
  if (isNaN(size)) return null;
  return { name: b.name, size, contentType: b.contentType };
}

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = parseUploadUrlBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    const ownerId = await viewerId(req);
    if (!ownerId || !canonicalObjectPath(objectPath)) { res.status(403).json({ error: "Invalid upload owner or path" }); return; }
    await db.insert(mediaObjectsTable).values({ objectPath, ownerId, visibility: "unbound" });
    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * App assets only. Physical private-directory overlap and private references
 * must never bypass content authorization through this route.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    if (!filePath || /[%\\?#]/.test(req.originalUrl.split("?")[0]) ||
        !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(filePath) ||
        filePath.split("/").some(p => p === "." || p === "..")) {
      res.status(400).json({ error: "Noncanonical asset path" }); return;
    }
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    // Configuration overlap must never expose private storage via this alias.
    const physicalPath = `/${file.bucket.name}/${file.name}`;
    const privateDir = objectStorageService.getPrivateObjectDir().replace(/\/+$/, "");
    if (physicalPath === privateDir || physicalPath.startsWith(`${privateDir}/`)) {
      res.status(403).json({ error: "Private objects require their protected route" }); return;
    }
    const evidence = await mediaEvidence();
    const keys = [`/api/storage/public-objects/${filePath}`, `/storage/public-objects/${filePath}`,
      `https://storage.googleapis.com${physicalPath}`];
    const viewer = await viewerId(req);
    const subscriptions = viewer === null ? new Set<number>() : await verifiedCreatorIds(viewer);
    for (const key of keys) {
      const e = evidence.get(key);
      if (e?.private && !mayReadMedia(e, viewer, subscriptions)) {
        res.status(403).json({ error: "Private asset access denied" }); return;
      }
    }
    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Cookie");

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * Provenance and verified subscription authorization run before file lookup
 * and before creating a download stream.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    if (!canonicalObjectPath(objectPath) || /[%\\]/.test(req.originalUrl.split("?")[0])) {
      res.status(400).json({ error: "Noncanonical object path" }); return;
    }
    const viewer = await viewerId(req);
    const subscribed = viewer === null ? new Set<number>() : await verifiedCreatorIds(viewer);
    if (!mayReadMedia((await mediaEvidence()).get(objectPath), viewer, subscribed)) {
      res.status(403).json({ error: "Object access denied" }); return;
    }
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Cookie");

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
