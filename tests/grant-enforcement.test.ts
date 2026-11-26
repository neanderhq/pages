import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/database.ts";
import { effectiveRole, visibleRoles, spaceRole, canRestore } from "../server/permissions.ts";
import { deliverPendingNotificationEmails, notify } from "../server/notifications.ts";
import { MailDeliveryError, type Mail, type MailProvider } from "../server/mail.ts";
import * as schema from "../server/schema.ts";

const origin = "http://127.0.0.1:5173";

test("grant-enforcement: workspace roles cap grants across private routes and delivery", async context => {
  const dir = await mkdtemp(join(tmpdir(), "wiki-grants-"));
  const store = await openDatabase("memory://");
  context.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  const sent: Mail[] = [];
  const attempted: Mail[] = [];
  let failMail = false;
  const mail: MailProvider = { kind: "test", async send(message) {
    attempted.push(message);
    if (failMail) throw new MailDeliveryError("Test delivery failure");
    sent.push(message);
  } };
  const app = createApp({ db: store.db, origin, environment: "test", secret: "grant-test-secret-44d9c530e54143b884db43eca37cd021", uploadDir: dir, mailProvider: mail });
  function client(name: string) {
    const cookies = new Map<string, string>();
    async function request(path: string, method = "GET", data?: unknown, raw = false) {
      const response = await app.handle(new Request(origin + path, { method,
        headers: { origin, cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
          "content-type": raw ? "text/plain" : "application/json", ...(raw ? { "x-file-name": "secret.txt" } : {}) },
        body: method === "GET" ? undefined : raw ? "confidential attachment bytes" : JSON.stringify(data ?? {}) }), name);
      for (const set of response.headers.getSetCookie()) {
        const pair = set.split(";")[0];
        cookies.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
      }
      return { status: response.status, data: (response.headers.get("content-type") ?? "").startsWith("application/json") ? await response.json() as any : await response.text() };
    }
    return request;
  }
  type Client = ReturnType<typeof client>;
  const admin = client("grant-admin"), viewer = client("grant-viewer"), editor = client("grant-editor"), outsider = client("grant-outsider"), nonmember = client("grant-nonmember");
  async function register(request: Client, name: string) {
    assert.equal((await request("/api/register", "POST", { name, email: `${name}@example.test`, password: "A long unique test password 42!", companyName: name })).status, 200);
    const me = (await request("/api/me")).data;
    return { userId: me.user.id as string, companyId: me.companies[0].companyId as string };
  }
  const owner = await register(admin, "GrantAdmin");
  const reader = await register(viewer, "GrantViewer");
  const writer = await register(editor, "GrantEditor");
  const stranger = await register(outsider, "GrantOutsider");
  const external = await register(nonmember, "GrantNonmember");
  const companyId = owner.companyId;
  const api = `/api/companies/${companyId}`;
  await store.db.insert(schema.memberships).values([
    { companyId, userId: reader.userId, role: "viewer" },
    { companyId, userId: writer.userId, role: "editor" },
    { companyId, userId: stranger.userId, role: "editor" },
  ]);
  const groupId = randomUUID(), spaceId = randomUUID();
  await store.db.insert(schema.groups).values({ id: groupId, companyId, name: "Readers" });
  await store.db.insert(schema.groupMembers).values({ companyId, groupId, userId: reader.userId });
  await store.db.insert(schema.spaces).values({ id: spaceId, companyId, name: "Restricted space", createdBy: owner.userId });
  const userGrant = (principalId: string, role = "editor") => ({ principalType: "user", principalId, role });
  const groupGrant = { principalType: "group", principalId: groupId, role: "editor" };
  async function create(request: Client, title: string, parentId?: string) {
    const result = await request(`${api}/pages`, "POST", { title, parentId });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data.id as string;
  }
  async function grants(pageId: string, values: unknown[]) {
    const result = await admin(`${api}/pages/${pageId}/grants`, "PUT", { inherits: false, grants: values, confirmSelfLockout: true });
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  const target = await create(admin, "Open backlink target");
  const root = await create(admin, "Confidential grantneedle root");
  const child = await create(admin, "Inherited grantneedle child", root);
  const override = await create(admin, "Visible override", root);
  const excludedChild = await create(admin, "Excluded child", root);
  const content = [{ id: "secret", type: "paragraph", content: [
    { type: "text", text: "grantneedle confidential snippet", styles: {} },
    { type: "link", href: `/p/${target}`, content: [{ type: "text", text: "open link", styles: {} }] },
  ], children: [] }];
  assert.equal((await admin(`${api}/pages/${root}/content`, "PUT", { baseRevision: 1, content })).status, 200);
  const upload = await admin(`${api}/pages/${root}/attachments`, "POST", undefined, true);
  assert.equal(upload.status, 200, JSON.stringify(upload.data));
  const attachmentUrl = upload.data.url as string;
  assert.ok(attachmentUrl);
  const baseGrants = [userGrant(owner.userId), userGrant(writer.userId)];
  await grants(root, baseGrants);
  await grants(override, [groupGrant, userGrant(writer.userId)]);
  await grants(excludedChild, [userGrant(owner.userId)]);
  const paths = [`/pages/${root}`, `/pages/${child}`, `/pages/${root}/revisions`, `/pages/${root}/revisions/2`,
    `/pages/${root}/backlinks`, `/pages/${root}/export-markdown`, `/pages/${root}/comments`, `/pages/${root}/activity`, `/pages/${root}/review`];
  async function denied(request: Client, prefix = api) {
    for (const path of paths) assert.equal((await request(prefix + path)).status, 404, path);
    assert.equal((await request(attachmentUrl.replace(api, prefix))).status, 404, "attachment bytes");
  }
  async function parity() {
    for (const identity of [owner, reader, writer, stranger, external]) {
      const roles = await visibleRoles(store.db, companyId, identity.userId);
      for (const { id: pageId } of await store.db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.companyId, companyId))) {
        assert.equal(roles.get(pageId) ?? null, await effectiveRole(store.db, companyId, identity.userId, pageId), `${identity.userId}:${pageId}`);
      }
    }
  }

  await context.test("ungranted Viewer, Editor outsider, nonmember and cross-company requests cannot read private surfaces", async () => {
    for (const request of [viewer, outsider, nonmember]) await denied(request);
    await denied(admin, `/api/companies/${reader.companyId}`);
    await denied(nonmember, `/api/companies/${external.companyId}`);
    await denied(editor, `/api/companies/${writer.companyId}`);
    assert.equal((await editor(`/api/companies/${writer.companyId}/search?q=grantneedle`)).data.total, 0, "membership in both companies cannot cross the requested company boundary");
    for (const request of [viewer, outsider]) {
      const tree = (await request(`${api}/pages`)).data;
      assert.ok(!JSON.stringify(tree).includes("grantneedle"));
      const search = await request(`${api}/search?q=grantneedle`);
      assert.equal(search.status, 200);
      assert.deepEqual(search.data.results, []);
      assert.equal(search.data.total, 0);
      assert.deepEqual((await request(`${api}/pages/${target}/backlinks`)).data.pages, []);
    }
    assert.equal((await nonmember(`${api}/pages`)).status, 404);
    assert.equal((await nonmember(`${api}/search?q=grantneedle`)).status, 404);
    assert.equal((await admin(`/api/companies/${reader.companyId}/search?q=grantneedle`)).status, 404);
    const tree = (await viewer(`${api}/pages`)).data.pages;
    assert.equal(tree.find((page: any) => page.id === override).parentId, null);
    const opened = (await viewer(`${api}/pages/${override}`)).data;
    assert.equal(opened.page.parentId, null);
    assert.deepEqual(opened.breadcrumbs, []);
    assert.equal((await admin(`${api}/pages/${override}`)).status, 200, "active admins retain access to explicit children");
    await store.db.update(schema.memberships).set({ role: "admin" }).where(and(eq(schema.memberships.companyId, companyId), eq(schema.memberships.userId, stranger.userId)));
    assert.equal((await outsider(`${api}/pages/${root}`)).data.page.role, "editor");
    assert.ok((await outsider(`${api}/search?q=grantneedle`)).data.total > 0);
    await store.db.update(schema.memberships).set({ role: "editor" }).where(and(eq(schema.memberships.companyId, companyId), eq(schema.memberships.userId, stranger.userId)));
    await denied(outsider);
    assert.equal((await outsider(`${api}/search?q=grantneedle`)).data.total, 0);
    assert.deepEqual(await notify(store.db, companyId, { recipients: [stranger.userId], kind: "mention", pageId: root, actorId: owner.userId }), []);
    await parity();
  });

  await context.test("direct and group grants allow inherited reads but never give workspace Viewers write capabilities", async () => {
    for (const grant of [userGrant(reader.userId), groupGrant]) {
      await grants(root, [...baseGrants, grant]);
      for (const request of [viewer, editor]) {
        for (const path of paths) assert.equal((await request(api + path)).status, 200, path);
        const bytes = await request(attachmentUrl);
        assert.equal(bytes.status, 200);
        assert.equal(bytes.data, "confidential attachment bytes");
        const results = (await request(`${api}/search?q=grantneedle`)).data;
        assert.equal(results.total, 2);
        assert.match(results.results.find((row: any) => row.id === root).snippet, /confidential snippet/);
        assert.deepEqual((await request(`${api}/pages/${target}/backlinks`)).data.pages.map((page: any) => page.id), [root]);
        assert.equal((await request(`${api}/pages/${excludedChild}`)).status, 404, "child replacement excludes members who can read its parent");
      }
      assert.equal((await viewer(`${api}/pages/${child}`)).data.page.role, "viewer");
      assert.equal((await editor(`${api}/pages/${child}`)).data.page.role, "editor");
      for (const [path, method, body] of [
        [`/pages/${root}`, "PATCH", { title: "Denied" }],
        [`/pages/${root}/content`, "PUT", { baseRevision: 2, content: [] }],
        [`/pages/${root}/comments`, "POST", { body: "Denied" }],
        [`/pages/${root}/revisions/1/restore`, "POST", {}],
        ["/pages", "POST", { title: "Denied", parentId: root }],
      ] as const) assert.ok([403, 404].includes((await viewer(api + path, method, body)).status), path);
      await parity();
    }
    await store.db.delete(schema.groupMembers).where(and(eq(schema.groupMembers.companyId, companyId), eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, reader.userId)));
    await denied(viewer);
    assert.equal((await viewer(`${api}/pages/${override}`)).status, 404, "removing group membership revokes explicit child access too");
    await parity();
    await store.db.insert(schema.groupMembers).values({ companyId, groupId, userId: reader.userId });
    assert.equal((await editor(`${api}/pages/${child}`, "PATCH", { title: "Inherited grantneedle edited" })).status, 200);
    await store.db.insert(schema.pageGrants).values({ id: randomUUID(), companyId, spaceId, principalType: "user", principalId: writer.userId, role: "editor" });
    assert.equal(await spaceRole(store.db, companyId, owner.userId, spaceId), "editor");
    for (const identity of [reader, stranger]) assert.equal(await spaceRole(store.db, companyId, identity.userId, spaceId), null);
    const spacePage = randomUUID();
    await store.db.insert(schema.pages).values({ id: spacePage, companyId, spaceId, ownerId: writer.userId, title: "Space inheritance", slug: spacePage });
    assert.equal(await effectiveRole(store.db, companyId, reader.userId, spacePage), null);
    await parity();
    await store.db.insert(schema.pageGrants).values({ id: randomUUID(), companyId, spaceId, principalId: groupId, principalType: "group", role: "editor" });
    assert.equal(await spaceRole(store.db, companyId, reader.userId, spaceId), "viewer");
    assert.equal(await spaceRole(store.db, companyId, writer.userId, spaceId), "editor");
    assert.equal(await effectiveRole(store.db, companyId, reader.userId, spacePage), "viewer");
    await parity();
  });

  await context.test("notifications, counts, review reminders, pending delivery and retries recheck revoked access", async () => {
    assert.equal((await viewer(`${api}/notifications/read-all`, "POST")).status, 200);
    const recipients = [reader.userId, writer.userId, stranger.userId, external.userId];
    assert.deepEqual(await notify(store.db, companyId, { recipients, kind: "mention", pageId: root, actorId: owner.userId }), recipients.slice(0, 2));
    failMail = true;
    await store.db.update(schema.pages).set({ ownerId: reader.userId, reviewIntervalDays: 1, createdAt: new Date(Date.now() - 3 * 86400000) }).where(eq(schema.pages.id, root));
    const listed = (await viewer(`${api}/notifications`)).data;
    const mention = listed.notifications.find((row: any) => row.kind === "mention" && row.pageId === root);
    assert.equal(mention.emailStatus, "failed");
    assert.ok(listed.notifications.some((row: any) => row.kind === "review_due" && row.pageId === root));
    assert.equal((await viewer(`${api}/notifications/${mention.id}/retry-email`, "POST")).data.emailStatus, "failed");
    assert.equal((await viewer(`${api}/pages/${root}/review`, "PATCH", { reviewIntervalDays: 2 })).status, 403);
    assert.equal((await viewer(`${api}/pages/${root}/review`, "POST")).status, 403);
    const before = await store.db.select().from(schema.pages).where(eq(schema.pages.id, root));
    assert.equal(before[0].reviewIntervalDays, 1);
    assert.equal(before[0].lastReviewedAt, null);
    await notify(store.db, companyId, { recipients: [reader.userId], kind: "mention", pageId: root, actorId: owner.userId });
    const readerAttempts = () => attempted.filter(message => message.to.toLowerCase() === "grantviewer@example.test").length;
    const attempts = readerAttempts();
    await grants(root, baseGrants);
    assert.equal(readerAttempts(), attempts, "grant-route pending dispatch must not call the provider for a revoked recipient");
    await denied(viewer);
    await parity();
    assert.ok(!(await viewer(`${api}/pages`)).data.pages.some((page: any) => page.id === root || page.id === child));
    assert.deepEqual((await viewer(`${api}/pages/${override}`)).data.breadcrumbs, []);
    assert.equal((await viewer(`${api}/search?q=grantneedle`)).data.total, 0);
    assert.deepEqual((await viewer(`${api}/pages/${target}/backlinks`)).data.pages, []);
    assert.equal((await viewer(`${api}/review-due?mine=1`)).data.pages.length, 0);
    failMail = false;
    await deliverPendingNotificationEmails(store.db, mail, origin, companyId, reader.userId);
    assert.equal(readerAttempts(), attempts, "revoked pending mail must not reach provider");
    await store.db.update(schema.pages).set({ createdAt: new Date(Date.now() - 4 * 86400000) }).where(eq(schema.pages.id, root));
    const hidden = (await viewer(`${api}/notifications`)).data;
    assert.ok(hidden.notifications.every((row: any) => row.pageId !== root));
    assert.ok(!JSON.stringify(hidden).includes("grantneedle"));
    assert.equal(hidden.unread, 0);
    assert.equal((await viewer(`${api}/notifications/unread-count`)).data.unread, 0);
    assert.equal((await viewer(`${api}/notifications/${mention.id}/retry-email`, "POST")).status, 404);
    assert.equal((await viewer(`${api}/notifications/${mention.id}/read`, "POST")).status, 404);
    assert.equal((await viewer(`${api}/notifications/read-all`, "POST")).status, 200);
    assert.equal((await outsider(`${api}/notifications`)).data.unread, 0);
    assert.equal((await nonmember(`${api}/notifications`)).status, 404);
    assert.equal((await viewer(`/api/companies/${external.companyId}/notifications`)).status, 404);
    const stored = await store.db.select().from(schema.notifications).where(and(eq(schema.notifications.pageId, root), eq(schema.notifications.recipientId, reader.userId)));
    assert.equal(stored.filter(row => row.kind === "review_due").length, 1, "revoked owner must not get a new reminder for a changed due date");
    assert.ok(stored.some(row => row.kind === "mention" && row.emailStatus === "not_applicable"));
    assert.ok(stored.filter(row => row.kind !== "access").every(row => row.readAt === null));
    assert.equal(readerAttempts(), attempts, "hidden reminders and retries must not call the provider");
    assert.deepEqual(await notify(store.db, companyId, { recipients: [reader.userId, stranger.userId], kind: "mention", pageId: root, actorId: owner.userId }), []);
    await grants(root, [...baseGrants, userGrant(reader.userId)]);
    assert.equal((await viewer(`${api}/notifications/${mention.id}/retry-email`, "POST")).data.emailStatus, "sent");
    assert.equal(sent.at(-1)?.pageTitle, "Confidential grantneedle root");
    await parity();
  });

  await context.test("snapshot publication needs current editor access and owner/admin authority; public snapshots survive grant revocation", async () => {
    const pageId = await create(editor, "Snapshot grant policy");
    const path = `${api}/pages/${pageId}/public-snapshot`;
    const published = await editor(path, "POST");
    assert.equal(published.status, 200);
    const publicPath = new URL(published.data.url).pathname;
    await grants(pageId, [userGrant(owner.userId)]);
    assert.equal((await editor(path, "POST")).status, 404, "revoked owner cannot publish");
    assert.equal((await app.handle(new Request(origin + publicPath))).status, 200, "bearer snapshot is intentionally still public");
    assert.equal((await editor(path, "DELETE")).status, 200, "owner can still revoke public disclosure");
    assert.equal((await app.handle(new Request(origin + publicPath))).status, 404);
    await grants(pageId, [userGrant(owner.userId), userGrant(writer.userId, "viewer"), userGrant(reader.userId)]);
    assert.equal((await editor(path, "POST")).status, 403, "ownership alone does not confer editor access");
    await store.db.update(schema.pages).set({ ownerId: reader.userId }).where(eq(schema.pages.id, pageId));
    assert.equal((await viewer(path, "POST")).status, 403, "workspace Viewer owner cannot publish");
    await grants(pageId, [userGrant(writer.userId)]);
    assert.equal((await admin(path, "POST")).status, 200, "active admin retains publishing capability without a content grant");
    assert.equal((await editor(path, "POST")).status, 404, "a granted editor who is neither owner nor admin cannot publish");
    await store.db.update(schema.pages).set({ archivedAt: new Date(), archivedRootId: pageId }).where(eq(schema.pages.id, pageId));
    assert.equal(await canRestore(store.db, companyId, owner.userId, pageId), true);
    assert.equal(await canRestore(store.db, companyId, writer.userId, pageId), true);
    await parity();
  });
});
