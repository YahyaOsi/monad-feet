import { randomBytes } from "node:crypto";
import { db, inviteCodesTable, pool } from "@workspace/db";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(args[0]))) {
  throw new Error("Usage: pnpm --filter @workspace/scripts create-team-invites [count (1-100)]");
}

const count = args.length === 0 ? 1 : Number(args[0]);

try {
  const codes = await db.transaction(async (tx) => {
    const created: string[] = [];
    for (let i = 0; i < count; i++) {
      let inserted = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = randomBytes(16).toString("hex").toUpperCase();
        const [row] = await tx
          .insert(inviteCodesTable)
          .values({ code, ownerId: null })
          .onConflictDoNothing({ target: inviteCodesTable.code })
          .returning({ code: inviteCodesTable.code });
        if (row) {
          created.push(row.code);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        throw new Error("Could not generate a unique invite code after 10 attempts");
      }
    }
    return created;
  });

  for (const code of codes) {
    console.log(code);
  }
} finally {
  await pool.end();
}