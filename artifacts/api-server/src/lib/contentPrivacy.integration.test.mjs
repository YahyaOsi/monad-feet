// Run from workspace root: pnpm --filter @workspace/api-server run test:privacy
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import pg from "../../../../lib/db/node_modules/pg/lib/index.js";

test("production HTTP handlers: paid content, provenance, aliases, deletion and cache isolation", {
  skip: process.env.RUN_DATABASE_TESTS !== "1" || process.env.NODE_ENV === "production",
}, async t => {
  // No production access, chain RPC, real payments or real object downloads.
  // Clone table structure, never data; fixtures live in an isolated schema.
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `privacy_test_${randomBytes(8).toString("hex")}`;
  const originalURL = process.env.DATABASE_URL;
  let server, appPool;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const { rows: tables } = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    for (const { tablename: table } of tables) {
      assert.match(table, /^[a-z_][a-z0-9_]*$/);
      await admin.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    // Serial defaults must not advance sequences in the real development data.
    const { rows: serials } = await admin.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND column_default LIKE 'nextval%'", [schema]);
    for (const { table_name: table, column_name: col } of serials) {
      assert.match(col, /^[a-z_][a-z0-9_]*$/);
      const seq = `${table}_${col}_fixture_seq`;
      await admin.query(`CREATE SEQUENCE "${schema}"."${seq}"`);
      await admin.query(`ALTER SEQUENCE "${schema}"."${seq}" OWNED BY "${schema}"."${table}"."${col}"`);
      await admin.query(`ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${col}" SET DEFAULT nextval('"${schema}"."${seq}"')`);
    }
    const url = new URL(originalURL);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.LOG_LEVEL = "silent";
    process.env.PRIVATE_OBJECT_DIR = "/fixture-bucket/private";
    const { pool } = await import("@workspace/db");
    appPool = pool;
    // Prior security schema additions may not yet be deployed to development.
    // Create them only inside this isolated test schema.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS verified_registrations(user_id integer PRIMARY KEY REFERENCES users(id), tx_hash text NOT NULL UNIQUE, verified_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS wallet_sessions(token_hash text PRIMARY KEY, wallet_address text NOT NULL, expires_at timestamptz NOT NULL);
      CREATE TABLE IF NOT EXISTS subscription_payments(tx_hash text PRIMARY KEY, subscriber_id integer NOT NULL REFERENCES users(id), creator_id integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
    `);
    const { ObjectStorageService, ObjectNotFoundError } = await import("./objectStorage.ts");
    let downloads = 0, nextUpload = 0;
    const missing = new Set();
    ObjectStorageService.prototype.getObjectEntityUploadURL = async () =>
      `https://storage.googleapis.com/fixture-bucket/private/uploads/new-${++nextUpload}?signature=fixture`;
    ObjectStorageService.prototype.getObjectEntityFile = async path => {
      if (missing.has(path)) throw new ObjectNotFoundError();
      return { name: path };
    };
    ObjectStorageService.prototype.searchPublicObject = async path => ({
      name: path.startsWith("private/") ? path : `assets/${path}`, bucket: { name: "fixture-bucket" },
    });
    ObjectStorageService.prototype.downloadObject = async () => {
      downloads++;
      return new Response("PRIVATE_IMAGE_BYTES", { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } });
    };
    const { default: app } = await import("../app.ts");
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const people = [];
    for (let i = 0; i < 8; i++) {
      const wallet = `0x${randomBytes(20).toString("hex")}`, token = randomBytes(32).toString("hex");
      const tx = `0x${randomBytes(32).toString("hex")}`;
      const { rows: [u] } = await pool.query("INSERT INTO users(wallet_address,username,name,registration_tx_hash) VALUES($1,$2,$2,$3) RETURNING id", [wallet, `privacy_${i}`, tx]);
      await pool.query("INSERT INTO verified_registrations(user_id,tx_hash) VALUES($1,$2)", [u.id, tx]);
      await pool.query("INSERT INTO wallet_sessions(token_hash,wallet_address,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [createHash("sha256").update(token).digest("hex"), wallet]);
      people.push({ id: u.id, wallet, token });
    }
    const [owner, subscriber, outsider, expired, unpaid, wrongCreator, wrongHash, wrongSubscriber] = people;
    const ownerEmail = `owner-${randomBytes(4).toString("hex")}@example.invalid`;
    await pool.query("UPDATE users SET email=$1, subscription_price=2 WHERE id=$2", [ownerEmail, owner.id]);
    for (const person of [subscriber, expired, unpaid, wrongCreator, wrongHash, wrongSubscriber]) {
      const hash = `0x${randomBytes(32).toString("hex")}`;
      await pool.query("INSERT INTO subscriptions(subscriber_id,creator_id,price_per_month,tx_hash,expires_at) VALUES($1,$2,1,$3,$4)",
        [person.id, owner.id, hash, new Date(Date.now() + (person === expired ? -10000 : 600000))]);
      if (person !== unpaid) await pool.query("INSERT INTO subscription_payments(tx_hash,subscriber_id,creator_id) VALUES($1,$2,$3)",
        [person === wrongHash ? `0x${randomBytes(32).toString("hex")}` : hash, person === wrongSubscriber ? outsider.id : person.id, person === wrongCreator ? outsider.id : owner.id]);
    }
    const { rows: [paid] } = await pool.query("INSERT INTO posts(content,image_url,author_id,is_paid) VALUES('PAID_SECRET','/api/storage/objects/uploads/legacy', $1,true) RETURNING id", [owner.id]);
    const { rows: [publicPost] } = await pool.query("INSERT INTO posts(content,image_url,author_id,is_paid) VALUES('PUBLIC_TEXT','/api/storage/objects/uploads/public', $1,false) RETURNING id", [owner.id]);
    await pool.query("INSERT INTO posts(content,image_url,author_id,is_paid) VALUES('PUBLIC_ALIAS','/objects/uploads/legacy',$1,false), ('EXTERNAL_SECRET','https://external.invalid/private.png',$1,true), ('OTHER_AUTHOR_POST',NULL,$2,false)", [owner.id, outsider.id]);
    const { rows: [publicComment] } = await pool.query("INSERT INTO comments(post_id,author_id,content) VALUES($1,$2,'PUBLIC_COMMENT') RETURNING id", [publicPost.id, outsider.id]);
    // Synthetic published fixtures in this isolated schema only. Live records
    // must continue to obtain this evidence through receipt verification.
    await pool.query("UPDATE posts SET chain_verified_at=now()");
    await pool.query("INSERT INTO comments(post_id,author_id,content) VALUES($1,$2,'PAID_COMMENT_SECRET')", [paid.id, owner.id]);
    await pool.query("INSERT INTO private_posts(content,image_url,creator_id) VALUES('PRIVATE_POST_SECRET','/objects/uploads/private-post',$1)", [owner.id]);
    await pool.query("UPDATE users SET avatar_url='/api/storage/objects/uploads/legacy' WHERE id=$1", [owner.id]);
    await pool.query("INSERT INTO notifications(user_id,type,title,body,resource_id,resource_type) VALUES($1,'system','PAID_SECRET','PAID_SECRET',$2,'post')", [outsider.id, paid.id]);
    async function request(path, person = outsider, method = "GET", body) {
      const response = await fetch(`${base}/api${path}`, { method, headers: {
        ...(person ? { cookie: `mf_session=${person.token}` } : {}),
        origin: base, "content-type": "application/json",
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text();
      return { status: response.status, text, headers: response.headers, json: () => JSON.parse(text) };
    }
    await t.test("signed sessions and legacy registration hashes alone never authorize content", async () => {
      // Isolated fixture only: keep its legacy users.registration_tx_hash intact.
      const unverified = people[people.length - 1];
      const { rows: [evidence] } = await pool.query("SELECT tx_hash FROM verified_registrations WHERE user_id=$1", [unverified.id]);
      const { rows: [subscription] } = await pool.query(
        "SELECT tx_hash FROM subscriptions WHERE subscriber_id=$1 AND creator_id=$2", [unverified.id, owner.id]);
      const entitlementHash = `0x${randomBytes(32).toString("hex")}`;
      await pool.query("UPDATE subscriptions SET tx_hash=$1 WHERE subscriber_id=$2 AND creator_id=$3",
        [entitlementHash, unverified.id, owner.id]);
      await pool.query("INSERT INTO subscription_payments(tx_hash,subscriber_id,creator_id) VALUES($1,$2,$3)",
        [entitlementHash, unverified.id, owner.id]);
      try {
        await pool.query("DELETE FROM verified_registrations WHERE user_id=$1", [unverified.id]);
        const before = downloads;
        const post = await request(`/posts/${paid.id}`, unverified);
        assert.equal(post.status, 200, post.text);
        assert.equal(post.json().content, "");
        assert.equal(post.json().imageUrl, null);
        assert.equal(post.json().isSubscribedToAuthor, false);
        assert.equal((await request("/storage/objects/uploads/legacy", unverified)).status, 403);
        assert.equal(downloads, before);
      } finally {
        await pool.query("DELETE FROM subscription_payments WHERE tx_hash=$1", [entitlementHash]);
        await pool.query("UPDATE subscriptions SET tx_hash=$1 WHERE subscriber_id=$2 AND creator_id=$3",
          [subscription.tx_hash, unverified.id, owner.id]);
        // Restore this synthetic fixture for the independent entitlement matrix.
        await pool.query("INSERT INTO verified_registrations(user_id,tx_hash) VALUES($1,$2)", [unverified.id, evidence.tx_hash]);
      }
    });
    await t.test("owner and receipt-backed active subscriber read; all other access states fail closed", async () => {
      for (const person of people) {
        const allowed = person === owner || person === subscriber;
        const before = downloads;
        const file = await request("/storage/objects/uploads/legacy", person);
        assert.equal(file.status, allowed ? 200 : 403);
        assert.equal(downloads - before, allowed ? 1 : 0);
        assert.equal(file.headers.get("cache-control"), "private, no-store");
        assert.match(file.headers.get("vary"), /Cookie/);
        const post = await request(`/posts/${paid.id}`, person);
        assert.equal(post.status, 200);
        assert.equal(post.text.includes("PAID_SECRET"), allowed);
        assert.equal(post.json().imageUrl !== null, allowed);
        assert.equal(post.json().isSubscribedToAuthor, allowed);
        const privatePost = await request(`/private-posts?creatorId=${owner.id}`, person);
        assert.equal(privatePost.status, allowed ? 200 : 403);
        // Unsigned historical private posts remain visible only to their author.
        assert.equal(privatePost.text.includes("PRIVATE_POST_SECRET"), person === owner);
      }
      const before = downloads;
      assert.equal((await request("/storage/objects/uploads/legacy", null)).status, 403);
      assert.equal(downloads, before);
      const anon = await request("/storage/objects/uploads/legacy", null);
      assert.equal(anon.headers.get("cache-control"), "private, no-store");
      assert.match(anon.headers.get("vary"), /Cookie/);
    });
    await t.test("analytics are owner-only, including subscriber identities and financial aggregates", async () => {
      const own = await request(`/users/${owner.id}/analytics`, owner);
      assert.equal(own.status, 200, own.text);
      assert.ok(Array.isArray(own.json().recentSubscribers));
      assert.ok(own.json().recentSubscribers.length > 0);
      assert.ok("totalRevenueMon" in own.json());
      assert.ok(own.json().topPosts.some(post => post.id === paid.id && post.content === "PAID_SECRET"));
      for (const person of [subscriber, outsider]) {
        const denied = await request(`/users/${owner.id}/analytics`, person);
        assert.equal(denied.status, 403);
        assert.deepEqual(denied.json(), { error: "Analytics are available only to their owner" });
        for (const field of ["recentSubscribers", "subscriberName", "subscriberUsername", "subscriberId", "totalRevenueMon", "monthlyRevenueMon", "topPosts", "PAID_SECRET"]) {
          assert.ok(!denied.text.includes(field), field);
        }
      }
    });
    await t.test("list, trending, summary, search, avatars and notification snippets", async () => {
      for (const path of ["/posts", "/trending", "/feed/summary", "/notifications", "/leaderboard", "/search?q=SECRET"]) {
        const response = await request(path);
        assert.equal(response.status, 200, path + response.text);
        assert.ok(!response.text.includes("PAID_SECRET"), path);
        assert.ok(!response.text.includes("EXTERNAL_SECRET"), path);
        assert.ok(!response.text.includes("external.invalid/private.png"), path);
        assert.ok(!response.text.includes("/objects/uploads/legacy"), path);
      }
      assert.equal((await request("/search?q=PAID_SECRET")).json().posts.length, 0);
      assert.equal((await request("/search?q=PAID_SECRET", subscriber)).json().posts.length, 1);
      assert.equal((await request(`/posts/${paid.id}/comments`)).status, 403);
      assert.equal((await request(`/posts/${paid.id}/comments`, subscriber)).status, 200);
    });
    await t.test("anonymous share reads are narrow, filter posts by author, and redact profile email", async () => {
      assert.equal((await request("/posts", null)).status, 401);
      assert.equal((await request("/posts?authorId=invalid", null)).status, 401);
      assert.equal((await request("/posts?authorId=0", null)).status, 401);
      assert.equal((await request("/posts?authorId=2147483648", null)).status, 401);
      assert.equal((await request("/posts/2147483648", null)).status, 401);
      assert.equal((await request("/users/2147483648", null)).status, 401);
      assert.equal((await request("/posts?authorId=2147483648")).status, 400);
      const feed = await request(`/posts?authorId=${owner.id}`, null);
      assert.equal(feed.status, 200, feed.text);
      const feedBody = feed.json();
      assert.ok(feedBody.posts.length > 0);
      assert.ok(feedBody.posts.every(post => post.authorId === owner.id));
      const { rows: [{ count: expectedTotal }] } = await pool.query("SELECT count(*)::int AS count FROM posts WHERE author_id=$1", [owner.id]);
      assert.equal(feedBody.total, expectedTotal);
      const cursorPage = await request(`/posts?authorId=${owner.id}&cursor=${publicPost.id}`, null);
      assert.equal(cursorPage.status, 200, cursorPage.text);
      assert.ok(cursorPage.json().posts.every(post => post.authorId === owner.id && post.id < publicPost.id));
      assert.equal(cursorPage.json().total, expectedTotal);

      const publicDetail = await request(`/posts/${publicPost.id}`, null);
      assert.equal(publicDetail.status, 200, publicDetail.text);
      assert.equal(publicDetail.json().content, "PUBLIC_TEXT");
      const comments = await request(`/posts/${publicPost.id}/comments`, null);
      assert.equal(comments.status, 200, comments.text);
      assert.ok(comments.json().some(comment => comment.id === publicComment.id && comment.content === "PUBLIC_COMMENT"));

      const publicProfile = await request(`/users/${owner.id}`, null);
      assert.equal(publicProfile.status, 200, publicProfile.text);
      assert.equal(publicProfile.json().email, null);
      assert.equal(publicProfile.json().walletAddress, owner.wallet);
      assert.equal((await request(`/users/${owner.id}`, owner)).json().email, ownerEmail);
      assert.equal((await request(`/users/${owner.id}`, outsider)).json().email, null);

      const price = await request(`/subscriptions/price/${owner.id}`, null);
      assert.equal(price.status, 200, price.text);
      assert.deepEqual(price.json(), { creatorId: owner.id, pricePerMonth: 2 });
    });
    await t.test("paid JSON, comments and managed media remain protected for anonymous viewers", async () => {
      const post = await request(`/posts/${paid.id}`, null);
      assert.equal(post.status, 200, post.text);
      assert.equal(post.json().content, "");
      assert.equal(post.json().imageUrl, null);
      assert.equal(post.json().isSubscribedToAuthor, false);
      assert.equal(post.json().isPaid, true);

      const comments = await request(`/posts/${paid.id}/comments`, null);
      assert.equal(comments.status, 403);
      assert.ok(!comments.text.includes("PAID_COMMENT_SECRET"));
      const before = downloads;
      assert.equal((await request("/storage/objects/uploads/legacy", null)).status, 403);
      assert.equal(downloads, before);
      assert.equal((await request("/storage/objects/uploads/public", null)).status, 200);
      assert.equal((await request("/storage/public-objects/logo.png", null)).status, 200);
    });
    await t.test("unrelated private, account, search and write routes stay authenticated", async () => {
      const protectedReads = [
        "/private-posts?creatorId=" + owner.id,
        `/users/${owner.id}/analytics`,
        "/users/me",
        "/users/search?q=owner",
        "/search?q=PUBLIC_TEXT",
        "/feed/summary",
        "/wallet/balance",
        "/subscriptions",
        "/subscriptions/price",
        "/notifications",
        "/notifications/preferences",
        "/dm/muted",
        "/dm/conversations",
        `/dm/${owner.id}`,
      ];
      for (const path of protectedReads) {
        assert.equal((await request(path, null)).status, 401, path);
      }
      const protectedWrites = [
        ["POST", "/posts"],
        ["DELETE", `/posts/${publicPost.id}`],
        ["POST", `/posts/${publicPost.id}/like`],
        ["DELETE", `/posts/${publicPost.id}/like`],
        ["PATCH", `/posts/${publicPost.id}/anchor`],
        ["POST", `/posts/${publicPost.id}/comments`],
        ["DELETE", `/comments/${publicComment.id}`],
        ["POST", "/private-posts"],
        ["POST", "/storage/uploads/request-url"],
        ["POST", "/subscriptions"],
        ["POST", "/subscriptions/quote"],
        ["PUT", "/subscriptions/price"],
        ["PUT", "/users/me"],
        ["POST", "/notifications/read-all"],
        ["POST", "/notifications/1/read"],
        ["PUT", "/notifications/preferences"],
        ["POST", `/dm/mute/${owner.id}`],
        ["DELETE", `/dm/mute/${owner.id}`],
        ["PUT", "/dm/settings"],
        ["DELETE", `/dm/conversations/${owner.id}`],
        ["POST", `/dm/${owner.id}`],
      ];
      for (const [method, path] of protectedWrites) {
        assert.equal((await request(path, null, method, {})).status, 401, `${method} ${path}`);
      }
    });
    await t.test("legacy ambiguity, unknown paths, canonicalization and public route bypass", async () => {
      await pool.query("INSERT INTO posts(content,image_url,author_id) VALUES('ambiguous','/objects/uploads/ambiguous',$1),('ambiguous','/objects/uploads/ambiguous',$2)", [owner.id, outsider.id]);
      for (const path of ["/storage/objects/uploads/ambiguous", "/storage/objects/uploads/unknown", "/storage/objects/uploads/%6cegacy", "/storage/objects/uploads/%252e%252e/legacy", "/storage/objects/uploads/%2flegacy", "/storage/public-objects/private/uploads/legacy"]) {
        const before = downloads;
        const r = await request(path);
        assert.ok(r.status >= 400, path);
        assert.equal(downloads, before, path);
      }
      assert.equal((await request("/storage/objects/uploads/public")).status, 200);
      assert.equal((await request("/storage/public-objects/logo.png")).status, 200);
      missing.add("/objects/uploads/public");
      const before = downloads;
      assert.equal((await request("/storage/objects/uploads/public")).status, 404);
      assert.equal(downloads, before);
    });
    await t.test("trusted upload owner, unbound access, cross-owner forgery and immutable visibility", async () => {
      const upload = await request("/storage/uploads/request-url", owner, "POST", { name: "photo.png", size: 1, contentType: "image/png", ownerId: outsider.id, visibility: "public" });
      assert.equal(upload.status, 200, upload.text);
      const path = upload.json().objectPath;
      const { rows: [binding] } = await pool.query("SELECT * FROM media_objects WHERE object_path=$1", [path]);
      assert.equal(binding.owner_id, owner.id);
      assert.equal(binding.visibility, "unbound");
      assert.equal((await request(`/storage${path}`)).status, 403);
      assert.equal((await request(`/storage${path}`, owner)).status, 200);
      const create = (person, imageUrl, isPaid) => request("/posts/prepare", person, "POST", { content: "NEW_SECRET", imageUrl, isPaid });
      assert.equal((await request("/posts", owner, "POST", { authorWalletAddress: owner.wallet, content: "NEW_SECRET", imageUrl: path, isPaid: true })).status, 400);
      assert.equal((await create(outsider, path, false)).status, 400);
      assert.equal((await create(owner, "https://external.invalid/new.png", true)).status, 400);
      assert.equal((await create(owner, "data:image/png;base64,AA", true)).status, 400);
      assert.equal((await create(owner, path, true)).status, 200);
      const { bindNewImage } = await import("./contentPrivacy.ts");
      await bindNewImage(path, owner.id, "private");
      assert.equal((await create(owner, path, false)).status, 400);
      assert.equal((await request("/users/me", owner, "PUT", { walletAddress: owner.wallet, avatarUrl: path })).status, 400);
      assert.equal((await create(outsider, "/objects/uploads/legacy", false)).status, 400);
      assert.equal((await create(outsider, "https://another.invalid/api/storage/objects/uploads/legacy", false)).status, 400);
      assert.equal((await create(owner, "https://external.invalid/private.png?alias=1", false)).status, 400);
      assert.equal((await request("/private-posts", outsider, "POST", { creatorWalletAddress: outsider.wallet, content: "claim", imageUrl: path })).status, 405);
      const secondUpload = await request("/storage/uploads/request-url", owner, "POST", { name: "other.png", size: 1, contentType: "image/png" });
      const race = await Promise.allSettled([
        bindNewImage(secondUpload.json().objectPath, owner.id, "private"),
        bindNewImage(secondUpload.json().objectPath, owner.id, "public"),
      ]);
      assert.deepEqual(race.map(r => r.status).sort(), ["fulfilled", "rejected"]);
    });
    await t.test("private-post and GCS legacy references override public aliases without relabeling", async () => {
      await pool.query("INSERT INTO posts(content,image_url,author_id,is_paid) VALUES('alias','/objects/uploads/private-post',$1,false),('GCS_SECRET','https://storage.googleapis.com/fixture-bucket/private/uploads/gcs',$1,true)", [owner.id]);
      for (const path of ["/storage/objects/uploads/private-post", "/storage/objects/uploads/gcs"]) {
        const before = downloads;
        assert.equal((await request(path)).status, 403);
        assert.equal(downloads, before);
        assert.equal((await request(path, subscriber)).status, 200);
      }
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM media_objects WHERE object_path IN ('/objects/uploads/gcs','/objects/uploads/private-post')")).rows[0].n, 0);
    });
    await t.test("deletion never declassifies legacy private/public aliases", async () => {
      assert.equal((await request(`/posts/${paid.id}`, owner, "DELETE")).status, 405);
      assert.equal((await request(`/posts/${paid.id}`, owner)).status, 200);
      assert.ok(!(await request("/notifications")).text.includes("PAID_SECRET"));
      const before = downloads;
      assert.equal((await request("/storage/objects/uploads/legacy")).status, 403);
      assert.equal(downloads, before);
      assert.equal((await request("/storage/objects/uploads/legacy", subscriber)).status, 200);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (appPool) await appPool.end();
    process.env.DATABASE_URL = originalURL;
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});