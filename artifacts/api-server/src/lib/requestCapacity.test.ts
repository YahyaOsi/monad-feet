import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { requestCapacity } from "./requestCapacity";

test("bounds concurrency and releases once on finish/close", () => {
  const gate = requestCapacity(1);
  function response() {
    return Object.assign(new EventEmitter(), {
      statusCode: 200, headers: {} as Record<string, string>, body: null as unknown,
      setHeader(k: string, v: string) { this.headers[k] = v; },
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { this.body = body; return this; },
    });
  }
  let admitted = 0;
  const enter = (res: ReturnType<typeof response>) => gate({} as never, res as never, () => { admitted++; });
  const first = response(); enter(first);
  const busy = response(); enter(busy);
  assert.equal(busy.statusCode, 503);
  assert.equal(busy.headers["Retry-After"], "3");
  first.emit("finish"); first.emit("close");
  const second = response(); enter(second);
  enter(response());
  assert.equal(admitted, 2);
  second.emit("close");
  enter(response());
  assert.equal(admitted, 3);
});
