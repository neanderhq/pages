import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.ts";
import { openConfiguredDatabase } from "../server/database.ts";

// Opt in only against a disposable, pre-migrated PostgreSQL database. The app
// role must have DML permission but no CREATE/ALTER/table ownership.
const url = process.env.PUBLISH_TEST_DATABASE_URL;
test("published PostgreSQL startup and uploads survive an instance replacement without filesystem storage", { skip: !url }, async () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = url!;
  const origin = "https://wiki.example.test";
  const secret = "isolated-publish-test-only-9e553d2b43d84e58b5c3dfe81b77338e";
  const password = "Isolated publish test password 42!";
  let store = await openConfiguredDatabase();
  const makeApp = () => createApp({ db: store.db, origin, secret, environment: "production", uploadDir: "/unwritable/not-used", mailProvider: { kind: "unavailable", async send() { throw Error("No real email in tests"); } } });
  let app = makeApp();
  function client() {
    const cookies = new Map<string, string>();
    return async (path: string, method = "GET", data?: unknown, extra: Record<string, string> = {}) => {
      const binary = data instanceof Uint8Array;
      const response = await app.handle(new Request(origin + path, { method, headers: { origin, cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join("; "), "content-type": binary ? "application/octet-stream" : "application/json", ...extra }, body: method === "GET" ? undefined : binary ? new Uint8Array(data as Uint8Array) : JSON.stringify(data ?? {}) }), "isolated-test");
      for (const set of response.headers.getSetCookie()) { const pair = set.split(";")[0]; cookies.set(pair.slice(0,pair.indexOf("=")),pair.slice(pair.indexOf("=")+1)); }
      return response;
    };
  }
  const owner = client(), outsider = client();
  try {
    let r = await owner("/api/register", "POST", { name: "Publish Owner", email: "publish-owner@example.test", password, companyName: "Publish test" });
    assert.equal(r.status, 200, await r.text());
    const me = await (await owner("/api/me")).json() as any;
    const company = me.companies[0].companyId;
    r = await owner(`/api/companies/${company}/pages`, "POST", { title: "Persisted upload" });
    assert.equal(r.status,200); const page = (await r.json() as any).id;
    const bytes = new TextEncoder().encode("Upload bytes must survive replacing the application container.\n");
    r = await owner(`/api/companies/${company}/pages/${page}/attachments`, "POST", bytes, { "x-file-name": "retained.txt" });
    assert.equal(r.status,200,await r.clone().text()); const file = await r.json() as any;
    assert.deepEqual(new Uint8Array(await (await owner(file.url)).arrayBuffer()),bytes);
    // A real database close/reopen and a fresh app, keeping only the cookie and
    // durable database. The deliberately unusable upload directory is never read.
    await store.close(); store = await openConfiguredDatabase(); app = makeApp();
    r = await owner(file.url); assert.equal(r.status,200); assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);
    r = await outsider(file.url); assert.ok([401,404].includes(r.status));
    r = await outsider("/api/register", "POST", { name: "Other Owner", email: "publish-other@example.test", password, companyName: "Other test" }); assert.equal(r.status,200);
    assert.equal((await outsider(file.url)).status,404);
    assert.equal((await owner(`/api/companies/${company}/pages/${page}/attachments`, "POST", bytes, { "x-file-name": "unsafe.exe" })).status,415);
    assert.equal((await owner(`/api/companies/${company}/pages/${page}/archive`, "POST")).status,200);
    assert.equal((await owner(file.url)).status,404);
    assert.equal((await owner(`/api/companies/${company}/pages/${page}/restore`, "POST")).status,200);
    r = await owner(file.url); assert.equal(r.status,200); assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);
  } finally { await store.close(); }
});
