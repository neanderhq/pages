import { test } from "node:test";
import assert from "node:assert/strict";
import { isRuntimeRequestPath } from "../server/request-routing.ts";

test("runtime routes public snapshots and APIs before frontend fallback", () => {
  assert.equal(isRuntimeRequestPath("/public/" + "a".repeat(64)), true);
  assert.equal(isRuntimeRequestPath("/api/public/pages/" + "a".repeat(64)), true);
  assert.equal(isRuntimeRequestPath("/api/public/" + "a".repeat(64)), true);
  assert.equal(isRuntimeRequestPath("/"), false);
  assert.equal(isRuntimeRequestPath("/publicity/page"), false);
  assert.equal(isRuntimeRequestPath("/assets/app.js"), false);
});
