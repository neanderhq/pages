import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/database.ts";
import * as schema from "../server/schema.ts";

const origin = "http://127.0.0.1:5173";
const password = "A long unique test password 42!";
const secret = "test-secret-only-4b8c94b68da4933a43b0fd0ef33487de";

test("audit log is admin-only, includes event details, and pages in stable bounded order", async () => {
  const store = await openDatabase("memory://");
  const app = createApp({ db: store.db, origin, secret, environment: "test", mailProvider: { kind: "test", async send() {} } });
  function client(id: string) {
    const cookies = new Map<string, string>();
    return {
      async request(path: string, method = "GET", data?: unknown) {
        const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
        const response = await app.handle(new Request(origin + path, { method, headers: { origin, cookie, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(data ?? {}) }) }), id);
        for (const setCookie of response.headers.getSetCookie()) {
          const pair = setCookie.split(";")[0];
          cookies.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
        }
        return { status: response.status, data: await response.json() as any };
      },
    };
  }
  async function register(who: ReturnType<typeof client>, name: string) {
    const result = await who.request("/api/register", "POST", { name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`, password, companyName: `${name} Company` });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const me = await who.request("/api/me");
    return { userId: me.data.user.id as string, companyId: me.data.companies[0].companyId as string };
  }

  try {
    const admin = client("audit-admin"), editor = client("audit-editor");
    const adminIdentity = await register(admin, "Audit Admin");
    const editorIdentity = await register(editor, "Audit Editor");
    await store.db.insert(schema.memberships).values({ companyId: adminIdentity.companyId, userId: editorIdentity.userId, role: "editor" });
    const base = `/api/companies/${adminIdentity.companyId}/audit-log`;
    const timestamp = new Date("2090-01-01T00:00:00.000Z");
    const fixtures = [
      { id: "audit-05-role", action: "membership.role_changed", target: `${editorIdentity.userId}:editor->admin` },
      { id: "audit-04-access", action: "page.grants_changed", target: "page-access" },
      { id: "audit-03-member", action: "membership.deactivated", target: editorIdentity.userId },
      { id: "audit-02-public", action: "page.public_snapshot_revoked", target: "page-public" },
      { id: "audit-01-archive", action: "page.archived", target: "page-archive" },
    ];
    await store.db.insert(schema.auditEvents).values(fixtures.map(event => ({ ...event, companyId: adminIdentity.companyId, actor: adminIdentity.userId, timestamp })));

    const first = await admin.request(`${base}?limit=2&offset=0`);
    assert.equal(first.status, 200);
    assert.equal(first.data.limit, 2);
    assert.equal(first.data.offset, 0);
    assert.ok(first.data.total >= fixtures.length);
    assert.deepEqual(first.data.events.map((event: any) => event.id), ["audit-05-role", "audit-04-access"]);
    assert.deepEqual(first.data.events[0], {
      id: "audit-05-role", actorId: adminIdentity.userId, actorName: "Audit Admin", action: "membership.role_changed",
      target: `${editorIdentity.userId}:editor->admin`, targetLabel: "Audit Editor", timestamp: timestamp.toISOString(),
    });

    const second = await admin.request(`${base}?limit=2&offset=2`);
    assert.equal(second.status, 200);
    assert.deepEqual(second.data.events.map((event: any) => event.id), ["audit-03-member", "audit-02-public"]);
    const third = await admin.request(`${base}?limit=1&offset=4`);
    assert.deepEqual(third.data.events.map((event: any) => event.id), ["audit-01-archive"]);
    assert.equal(new Set([...first.data.events, ...second.data.events, ...third.data.events].map((event: any) => event.id)).size, 5);

    assert.equal((await editor.request(base)).status, 403);
    assert.equal((await admin.request(`${base}?limit=101`)).status, 400);
    assert.equal((await admin.request(`${base}?offset=-1`)).status, 400);
  } finally {
    await store.close();
  }
});

test("audit target labels are company-scoped and preserve raw targets", async () => {
  const store = await openDatabase("memory://");
  const app = createApp({ db: store.db, origin, secret, environment: "test", mailProvider: { kind: "test", async send() {} } });
  function client(id: string) {
    const cookies = new Map<string, string>();
    return {
      async request(path: string, method = "GET", data?: unknown) {
        const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
        const response = await app.handle(new Request(origin + path, { method, headers: { origin, cookie, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(data ?? {}) }) }), id);
        for (const setCookie of response.headers.getSetCookie()) {
          const pair = setCookie.split(";")[0];
          cookies.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
        }
        return { status: response.status, data: await response.json() as any };
      },
    };
  }
  async function register(who: ReturnType<typeof client>, name: string) {
    const result = await who.request("/api/register", "POST", { name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`, password, companyName: `${name} Company` });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const me = await who.request("/api/me");
    return { userId: me.data.user.id as string, companyId: me.data.companies[0].companyId as string };
  }

  try {
    const admin = client("audit-label-admin"), namedMember = client("audit-label-member"), emailMember = client("audit-label-email-member");
    const adminIdentity = await register(admin, "Label Admin");
    const namedIdentity = await register(namedMember, "Named Member");
    const emailIdentity = await register(emailMember, "Email Member");
    await store.db.insert(schema.memberships).values([
      { companyId: adminIdentity.companyId, userId: namedIdentity.userId, role: "editor" },
      { companyId: adminIdentity.companyId, userId: emailIdentity.userId, role: "viewer" },
    ]);
    await store.db.update(schema.user).set({ name: "" }).where(eq(schema.user.id, emailIdentity.userId));
    const pageId = randomUUID();
    const foreignPageId = randomUUID();
    await store.db.insert(schema.pages).values([
      { id: pageId, companyId: adminIdentity.companyId, ownerId: adminIdentity.userId, title: "Quarterly Handbook", slug: "quarterly-handbook" },
      { id: foreignPageId, companyId: emailIdentity.companyId, ownerId: emailIdentity.userId, title: "Private Other-company Page", slug: "private-other-company-page" },
    ]);
    const timestamp = new Date("2090-01-01T00:00:00.000Z");
    const events = [
      { id: "audit-label-page", action: "page.renamed", target: pageId },
      { id: "audit-label-member", action: "membership.deactivated", target: namedIdentity.userId },
      { id: "audit-label-email", action: "membership.deactivated", target: emailIdentity.userId },
      { id: "audit-label-unknown", action: "page.renamed", target: randomUUID() },
      { id: "audit-label-cross-company", action: "page.renamed", target: foreignPageId },
    ];
    await store.db.insert(schema.auditEvents).values(events.map(event => ({ ...event, companyId: adminIdentity.companyId, actor: adminIdentity.userId, timestamp })));

    const result = await admin.request(`/api/companies/${adminIdentity.companyId}/audit-log?limit=10`);
    assert.equal(result.status, 200);
    const byId = new Map(result.data.events.map((event: any) => [event.id, event]));
    assert.equal((byId.get("audit-label-page") as any).targetLabel, "Quarterly Handbook");
    assert.equal((byId.get("audit-label-page") as any).target, pageId);
    assert.equal((byId.get("audit-label-member") as any).targetLabel, "Named Member");
    assert.equal((byId.get("audit-label-member") as any).target, namedIdentity.userId);
    assert.equal((byId.get("audit-label-email") as any).targetLabel, "email.member@example.test");
    assert.equal((byId.get("audit-label-email") as any).target, emailIdentity.userId);
    assert.equal((byId.get("audit-label-unknown") as any).targetLabel, null);
    assert.equal((byId.get("audit-label-cross-company") as any).targetLabel, null);
    assert.equal((byId.get("audit-label-cross-company") as any).target, foreignPageId);
  } finally {
    await store.close();
  }
});
