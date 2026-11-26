import { test } from "node:test";
import assert from "node:assert/strict";

test("PostgreSQL runtime driver is installed", async () => {
  const driverName = "pg";
  const driver = await import(driverName);
  assert.equal(typeof driver.Pool, "function");
});
