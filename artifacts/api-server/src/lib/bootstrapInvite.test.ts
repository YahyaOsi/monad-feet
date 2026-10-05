import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrapInvite } from "./bootstrapInvite";

test("fresh database gets one random invitation; existing data is never changed", async () => {
  for (const [has_users, has_invites] of [[false, false], [true, false], [false, true], [true, true]]) {
    const statements: string[] = [];
    let released = false;
    let code = "";
    const client = {
      async query(sql: string, params?: string[]) {
        statements.push(sql);
        if (sql.startsWith("INSERT")) code = params![0];
        return { rows: [{ has_users, has_invites }] };
      },
      release() { released = true; },
    };
    const created = await bootstrapInvite({ connect: async () => client } as never);
    assert.equal(created, !has_users && !has_invites);
    assert.equal(released, true);
    assert.ok(statements.includes("SELECT pg_advisory_xact_lock(143, 20260930)"));
    assert.equal(statements.at(-1), "COMMIT");
    if (created) assert.match(code, /^[A-F0-9]{40}$/);
    else assert.equal(code, "");
  }
});

test("failed initialization rolls back and releases the connection", async () => {
  const statements: string[] = [];
  let released = false;
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.startsWith("SELECT EXISTS")) throw new Error("missing schema");
      return { rows: [] };
    },
    release() { released = true; },
  };
  await assert.rejects(bootstrapInvite({ connect: async () => client } as never), /missing schema/);
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(released, true);
});