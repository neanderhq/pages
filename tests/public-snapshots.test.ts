import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createApp } from "../server/app.ts";
import { sanitizeContent } from "../server/content.ts";
import { openDatabase } from "../server/database.ts";
import * as schema from "../server/schema.ts";

const origin = "http://127.0.0.1:5173";
const password = "A long unique test password 42!";
const secret = "test-secret-only-4b8c94b68da4933a43b0fd0ef33487de";

test("public snapshots expose only the immutable published page and become unavailable after revoke", async context => {
  const store = await openDatabase("memory://");
  context.after(() => store.close());
  const app = createApp({ db: store.db, origin, secret, environment: "test", mailProvider: { kind: "test", async send() {} } });

  function client(id: string) {
    const cookies = new Map<string, string>();
    return {
      async request(path: string, method = "GET", body?: unknown) {
        const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
        const response = await app.handle(new Request(origin + path, { method, headers: { origin, cookie, "content-type": "application/json" },
          body: method === "GET" ? undefined : JSON.stringify(body ?? {}) }), id);
        for (const set of response.headers.getSetCookie()) {
          const pair = set.split(";")[0];
          cookies.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
        }
        return { status: response.status, data: await response.json() as any };
      },
    };
  }
  async function register(person: ReturnType<typeof client>, name: string) {
    const result = await person.request("/api/register", "POST", { name, email: `${name.toLowerCase()}@example.test`, password, companyName: `${name} Company` });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const me = await person.request("/api/me");
    return { userId: me.data.user.id as string, companyId: me.data.companies[0].companyId as string };
  }

  const admin = client("snapshot-admin"), member = client("snapshot-member");
  const adminIdentity = await register(admin, "SnapshotAdmin");
  const memberIdentity = await register(member, "SnapshotMember");
  await store.db.insert(schema.memberships).values({ companyId: adminIdentity.companyId, userId: memberIdentity.userId, role: "editor" });
  const base = `/api/companies/${adminIdentity.companyId}`;

  const created = await admin.request(`${base}/pages`, "POST", { title: "Published page" });
  const pageId = created.data.id as string;
  const child = await admin.request(`${base}/pages`, "POST", { title: "Private child title", parentId: pageId });
  assert.equal(child.status, 200);
  const restricted = await admin.request(`${base}/pages/${child.data.id}/grants`, "PUT", { inherits: false, grants: [{ principalType: "user", principalId: adminIdentity.userId, role: "editor" }] });
  assert.equal(restricted.status, 200);
  assert.equal((await member.request(`${base}/pages/${child.data.id}`)).status, 404, "the child is explicitly restricted, not merely unpublished");
  await admin.request(`${base}/pages/${child.data.id}/content`, "PUT", { baseRevision: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "child-only secret", styles: {} }], children: [] }] });
  const publishedContent = [
    { id: "approved-paragraph", type: "paragraph", props: {}, content: [{ type: "text", text: "approved snapshot text", styles: {} }], children: [] },
    { id: "approved-table", type: "table", props: {}, content: { rows: [{ cells: [
      { type: "tableCell", content: [{ type: "text", text: "Native snapshot cell", styles: {} }] },
      [{ type: "text", text: "Array snapshot cell ", styles: {} }, { type: "link", href: "https://example.test/snapshot", content: [{ type: "text", text: "link", styles: {} }] }],
    ] }] }, children: [] },
  ];
  await admin.request(`${base}/pages/${pageId}/content`, "PUT", { baseRevision: 1, content: publishedContent });

  const denied = await member.request(`${base}/pages/${pageId}/public-snapshot`, "POST");
  assert.equal(denied.status, 404, "a non-owner member cannot publish another page");
  await store.db.execute(sql`ALTER TABLE audit_events ADD CONSTRAINT test_publish_audit CHECK (action <> 'page.public_snapshot_published')`);
  try {
    assert.equal((await admin.request(`${base}/pages/${pageId}/public-snapshot`, "POST")).status, 500);
    assert.equal(await store.db.$count(schema.publicPageSnapshots), 0, "publication rolls back if its audit record cannot be saved");
  } finally {
    await store.db.execute(sql`ALTER TABLE audit_events DROP CONSTRAINT test_publish_audit`);
  }
  const publication = await admin.request(`${base}/pages/${pageId}/public-snapshot`, "POST");
  assert.equal(publication.status, 200, JSON.stringify(publication.data));
  const url = new URL(publication.data.url as string);
  const token = url.pathname.split("/").at(-1)!;
  assert.match(token, /^[a-f0-9]{64}$/);
  const originalSnapshot = await store.db.select().from(schema.publicPageSnapshots).where(eq(schema.publicPageSnapshots.pageId, pageId));
  const publicationAudits = () => store.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.action, "page.public_snapshot_published"));
  const originalAudits = await publicationAudits();
  assert.equal(originalAudits.length, 1);
  assert.equal((await admin.request(`${base}/pages/${pageId}/public-snapshot`, "POST")).status, 409, "duplicate publication is a conflict, not another success");
  assert.deepEqual(await store.db.select().from(schema.publicPageSnapshots).where(eq(schema.publicPageSnapshots.pageId, pageId)), originalSnapshot, "duplicate publication preserves the original snapshot and bearer link");
  assert.deepEqual(await publicationAudits(), originalAudits, "a duplicate request cannot add a successful publication audit");
  assert.equal((await app.handle(new Request(publication.data.url))).status, 200);
  assert.equal((await app.handle(new Request(`${origin}/api/public/pages/${token}`))).status, 200);
  assert.equal((await member.request(`${base}/pages/${token}/public-snapshot`, "POST")).status, 404, "a bearer token is not a valid page id and must not enter the audit trail");
  assert.equal((await member.request(`${base}/pages/${pageId}/public-snapshot`, "DELETE")).status, 404);
  await store.db.execute(sql`ALTER TABLE audit_events ADD CONSTRAINT test_revoke_audit CHECK (action <> 'page.public_snapshot_revoked')`);
  try {
    assert.equal((await admin.request(`${base}/pages/${pageId}/public-snapshot`, "DELETE")).status, 500);
    assert.equal(await store.db.$count(schema.publicPageSnapshots), 1, "revocation rolls back if its audit record cannot be saved");
    assert.equal((await app.handle(new Request(`${origin}/api/public/pages/${token}`))).status, 200);
  } finally {
    await store.db.execute(sql`ALTER TABLE audit_events DROP CONSTRAINT test_revoke_audit`);
  }

  const [stored] = await store.db.select().from(schema.publicPageSnapshots).where(eq(schema.publicPageSnapshots.pageId, pageId));
  assert.equal(stored.tokenHash, createHash("sha256").update(token).digest("hex"));
  assert.notEqual(stored.tokenHash, token, "only the token hash is persisted");
  assert.equal(url.pathname, `/public/${token}`, "published links open the human-readable page");
  const publicPage = await app.handle(new Request(publication.data.url));
  assert.equal(publicPage.status, 200);
  assert.match(publicPage.headers.get("content-type") ?? "", /^text\/html/);
  const html = await publicPage.text();
  assert.match(html, /<article><h1>Published page<\/h1>/);
  assert.match(html, /approved snapshot text/);
  await context.test("public snapshot HTML preserves native and array-form table cells", async () => {
    assert.match(html, /Native snapshot cell/);
    assert.match(html, /Array snapshot cell <a href="https:\/\/example\.test\/snapshot"[^>]*>link<\/a>/);
    assert.match(html, /class="table-wrap" style="width:100%;max-width:100%;overflow-x:auto"/);
  });
  assert.match(html, /Save as PDF/);
  assert.doesNotMatch(html, /"content"\s*:/, "the public link does not show raw page JSON");
  assert.ok(!html.includes("Private child title"));
  assert.ok(!html.includes("child-only secret"));
  assert.ok(!html.includes(adminIdentity.companyId));

  const anonymous = await app.handle(new Request(`${origin}/api/public/pages/${token}`));
  assert.equal(anonymous.status, 200);
  const response = await anonymous.json() as { page: Record<string, unknown> };
  assert.deepEqual(Object.keys(response.page).sort(), ["content", "revision", "slug", "title"]);
  assert.equal(response.page.title, "Published page");
  assert.equal(response.page.revision, 2);
  assert.deepEqual(response.page.content, sanitizeContent(publishedContent));
  assert.ok(!JSON.stringify(response).includes("Private child title"));
  assert.ok(!JSON.stringify(response).includes("child-only secret"));
  assert.ok(!JSON.stringify(response).includes(adminIdentity.companyId));
  assert.equal((await app.handle(new Request(`${origin}/api/public/${token}`))).status, 404, "public page data remains at the /pages/ API route");

  assert.equal((await admin.request(`${base}/pages/${pageId}/content`, "PUT", { baseRevision: 2, content: [{ type: "paragraph", content: [{ type: "text", text: "later private draft", styles: {} }], children: [] }] })).status, 200);
  assert.equal((await admin.request(`${base}/pages/${pageId}`, "PATCH", { title: "Later private title" })).status, 200);
  const unchanged = await app.handle(new Request(`${origin}/api/public/pages/${token}`));
  assert.equal(unchanged.status, 200);
  assert.deepEqual(await unchanged.json(), response, "the public snapshot does not follow later page edits");
  const unchangedHtml = await app.handle(new Request(`${origin}/public/${token}`));
  assert.equal(unchangedHtml.status, 200);
  assert.equal(await unchangedHtml.text(), html, "HTML also freezes the approved title/content and never includes restricted children or newer drafts");

  const memberPage = await member.request(`${base}/pages`, "POST", { title: "Member-owned page" });
  const ownerPublish = await member.request(`${base}/pages/${memberPage.data.id}/public-snapshot`, "POST");
  assert.equal(ownerPublish.status, 200, "a page owner can explicitly publish their page");
  const ownerStatus = await member.request(`${base}/pages/${memberPage.data.id}/public-snapshot`);
  assert.deepEqual(ownerStatus.data, { published: true });
  await member.request(`${base}/pages/${memberPage.data.id}/public-snapshot`, "DELETE");
  const adminPublish = await admin.request(`${base}/pages/${memberPage.data.id}/public-snapshot`, "POST");
  assert.equal(adminPublish.status, 200, "a workspace admin can publish another member's page");
  assert.equal((await admin.request(`${base}/pages/${memberPage.data.id}/public-snapshot`, "DELETE")).status, 200);

  const revoked = await admin.request(`${base}/pages/${pageId}/public-snapshot`, "DELETE");
  assert.equal(revoked.status, 200);
  const unavailable = await app.handle(new Request(`${origin}/public/${token}`));
  assert.equal(unavailable.status, 404);
  assert.deepEqual(await unavailable.json(), { message: "Page not found." });
  const unavailableJson = await app.handle(new Request(`${origin}/api/public/pages/${token}`));
  assert.equal(unavailableJson.status, 404);
  assert.deepEqual(await unavailableJson.json(), { message: "Page not found." });
  assert.equal(await store.db.$count(schema.publicPageSnapshots, eq(schema.publicPageSnapshots.pageId, pageId)), 0);
  const republished = await admin.request(`${base}/pages/${pageId}/public-snapshot`, "POST");
  assert.equal(republished.status, 200);
  assert.notEqual(republished.data.url, publication.data.url, "republishing never revives a revoked bearer link");
  for (const path of [`/public/${token}`, `/api/public/pages/${token}`]) assert.equal((await app.handle(new Request(origin + path))).status, 404);
  assert.equal((await admin.request(`${base}/pages/${pageId}/public-snapshot`, "DELETE")).status, 200);
  assert.equal((await admin.request(`${base}/pages/${pageId}/public-snapshot`)).data.published, false);
  const logs = await store.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.companyId, adminIdentity.companyId));
  const events = logs.filter(event => event.target === pageId && event.action.startsWith("page.public_snapshot_"));
  for (const action of ["published", "revoked"]) {
    assert.equal(events.filter(event => event.action === `page.public_snapshot_${action}` && event.actor === adminIdentity.userId).length, 2);
    assert.equal(events.filter(event => event.action === `page.public_snapshot_${action}.denied` && event.actor === memberIdentity.userId).length, 1);
  }
  for (const publicationUrl of [publication.data.url, ownerPublish.data.url, adminPublish.data.url, republished.data.url]) {
    const bearer = new URL(publicationUrl).pathname.split("/").at(-1)!;
    assert.ok(!JSON.stringify(logs).includes(bearer), "audit records contain page ids, never bearer links or tokens");
    assert.ok(!JSON.stringify(logs).includes(createHash("sha256").update(bearer).digest("hex")), "audit records do not need token hashes either");
  }
  assert.equal((await admin.request(`${base}/pages/${pageId}/public-snapshot`, "DELETE")).status, 200);
  assert.equal(await store.db.$count(schema.auditEvents, eq(schema.auditEvents.companyId, adminIdentity.companyId)), logs.length, "idempotent revocation does not invent a change event");
});
