import test from "node:test";
import assert from "node:assert/strict";
import { privacyRequirements } from "./privacyRequirements";

test("plain counts, errors, and acknowledgements require no privacy database reads", () => {
  for (const body of [{ error: "Busy" }, { success: true }, { unreadCount: 12 }, { points: 40 }, [], null]) {
    assert.equal(privacyRequirements(body).needed, false);
  }
});
test("nested posts, notification references, private history and all URL fields remain protected", () => {
  const result = privacyRequirements({ rows: [
    { id: 4, authorId: 9 }, { id: 4, authorId: 9 },
    { resourceType: "post", resourceId: 8 },
    { nested: { avatarUrl: "/objects/uploads/private" } },
  ] });
  assert.deepEqual(result.postIds, [4, 8]);
  assert.equal(result.media, true);
  assert.equal(privacyRequirements({ source: "private", creatorId: 9 }).needed, true);
  assert.deepEqual(privacyRequirements({ postId: 4, id: 7, authorId: 9 }).postIds, []);
});
