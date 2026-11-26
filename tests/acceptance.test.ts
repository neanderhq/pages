import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/database.ts";
import type { Mail, MailProvider } from "../server/mail.ts";
import { sweepReviewDueReminders } from "../server/notifications.ts";
import * as schema from "../server/schema.ts";

const origin = "http://127.0.0.1:5173";
const password = "A long unique test password 42!";
const day = 86_400_000;
const paragraph = (id: string, text: string) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
const link = (id: string, target: string) => ({ ...paragraph(id, ""), content: [{ type: "link", href: `/p/${target}`, content: [{ type: "text", text: "Open page", styles: {} }] }] });

test("acceptance: request-handler and database regression boundaries", async context => {
  const dir = await mkdtemp(join(tmpdir(), "wiki-acceptance-"));
  const store = await openDatabase("memory://");
  const delivered: Mail[] = [];
  let failReviewEmails = false;
  let reviewEmailAttempts = 0;
  const mailProvider: MailProvider = { kind: "test", async send(message: Mail) {
    if (message.kind === "review-reminder" && message.pageTitle === "Scheduled review reminder") {
      reviewEmailAttempts++;
      if (failReviewEmails) throw new Error("mail transport unavailable");
    }
    delivered.push(message);
  } };
  const app = createApp({ db: store.db, origin, secret: "acceptance-secret-only-4b8c94b68da4933a43b0fd0ef", environment: "test", uploadDir: join(dir, "uploads"),
    mailProvider });
  context.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });

  function client(id: string) {
    const cookies = new Map<string, string>();
    async function send(path: string, method: string, body?: BodyInit, headers: Record<string, string> = {}) {
      const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await app.handle(new Request(origin + path, { method, headers: { origin, cookie, ...headers }, body }), id);
      for (const set of response.headers.getSetCookie()) {
        const pair = set.split(";")[0];
        cookies.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
      }
      const type = response.headers.get("content-type") ?? "";
      return { status: response.status, data: type.startsWith("application/json") ? await response.json() as any : await response.text() };
    }
    return {
      request: (path: string, method = "GET", data?: unknown) => send(path, method, method === "GET" ? undefined : JSON.stringify(data ?? {}), { "content-type": "application/json" }),
      upload: (path: string) => send(path, "POST", "private attachment bytes", { "content-type": "text/plain", "x-file-name": "private.txt" }),
    };
  }
  async function register(who: ReturnType<typeof client>, name: string) {
    assert.equal((await who.request("/api/register", "POST", { name, email: `${name}@example.test`, password, companyName: `${name} Company` })).status, 200);
    const { data } = await who.request("/api/me");
    return { userId: data.user.id as string, companyId: data.companies[0].companyId as string };
  }
  const ok = (result: { status: number; data: any }) => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
  const admin = client("acceptance-admin"), member = client("acceptance-member"), foreign = client("acceptance-foreign"), anonymous = client("acceptance-anonymous");
  const owner = await register(admin, "acceptance-admin");
  const editor = await register(member, "acceptance-member");
  const outsider = await register(foreign, "acceptance-foreign");
  await store.db.insert(schema.memberships).values({ companyId: owner.companyId, userId: editor.userId, role: "editor" });
  const base = `/api/companies/${owner.companyId}`;
  async function create(title: string, parentId?: string, who = admin) {
    return ok(await who.request(`${base}/pages`, "POST", { title, parentId })).id as string;
  }
  async function restrict(pageId: string, includeMember = false) {
    ok(await admin.request(`${base}/pages/${pageId}/grants`, "PUT", { inherits: false, grants: [
      { principalType: "user", principalId: owner.userId, role: "editor" },
      ...(includeMember ? [{ principalType: "user", principalId: editor.userId, role: "editor" }] : []),
    ] }));
  }

  await context.test("simultaneous saves return a recoverable conflict preserving losing content and allow an explicit merged retry", async () => {
    const pageId = await create("Concurrent edits");
    const route = `${base}/pages/${pageId}`;
    const before = await Promise.all([admin.request(route), member.request(route)]);
    assert.deepEqual(before.map(result => ok(result).page.revision), [1, 1]);
    const drafts = [[paragraph("alice-draft", "Alice's concurrent contribution")], [paragraph("bob-draft", "Bob's concurrent contribution")]];
    const requests = [admin, member].map((who, index) => who.request(`${route}/content`, "PUT", { baseRevision: before[index].data.page.revision, content: drafts[index] }));
    const results = await Promise.all(requests);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results.findIndex(result => result.status === 200), loser = 1 - winner;
    assert.deepEqual(results[loser].data.current, { revision: 2, content: drafts[winner] });
    assert.deepEqual(results[loser].data.yours, { baseRevision: 1, content: drafts[loser] });
    assert.deepEqual(ok(await admin.request(route)).page.content, drafts[winner]);
    const revisions = () => store.db.select().from(schema.pageRevisions).where(eq(schema.pageRevisions.pageId, pageId)).orderBy(asc(schema.pageRevisions.revision));
    assert.deepEqual((await revisions()).map(row => [row.revision, row.content]), [[1, []], [2, drafts[winner]]]);
    const recovered = [...results[loser].data.current.content, ...results[loser].data.yours.content];
    assert.equal(ok(await [admin, member][loser].request(`${route}/content`, "PUT", { baseRevision: 2, content: recovered })).revision, 3);
    assert.deepEqual(ok(await member.request(route)).page.content, recovered);
    assert.deepEqual((await revisions()).map(row => [row.revision, row.content]), [[1, []], [2, drafts[winner]], [3, recovered]]);
  });

  await context.test("unauthorized and cross-company requests cannot read direct-page data, attachments, history, search or exports", async () => {
    const pageId = await create("Restricted acceptance payroll");
    const route = `${base}/pages/${pageId}`;
    ok(await admin.request(`${route}/content`, "PUT", { baseRevision: 1, content: [paragraph("payroll", "restricted-payroll-marker")] }));
    const attachment = ok(await admin.upload(`${route}/attachments`));
    assert.equal(ok(await admin.request(attachment.url)), "private attachment bytes");
    await restrict(pageId);
    const reads = [route, `${route}/revisions`, `${route}/revisions/2`, `${route}/export-markdown`, attachment.url, `${route}/comments`, `${route}/activity`, `${route}/backlinks`];
    for (const who of [member, foreign, anonymous]) {
      for (const path of reads) {
        const denied = await who.request(path);
        assert.equal(denied.status, who === anonymous ? 401 : 404, path);
        assert.doesNotMatch(JSON.stringify(denied.data), /payroll|private attachment bytes/i);
      }
      for (const [path, method, body] of [
        [`${route}/content`, "PUT", { baseRevision: 2, content: [] }],
        [`${route}/revisions/1/restore`, "POST", {}],
        [`${route}/public-snapshot`, "POST", {}],
      ] as const) assert.equal((await who.request(path, method, body)).status, who === anonymous ? 401 : 404, path);
      assert.equal((await who.upload(`${route}/attachments`)).status, who === anonymous ? 401 : 404);
    }
    for (const suffix of ["pages", "search?q=payroll"]) {
      const visible = ok(await member.request(`${base}/${suffix}`));
      assert.doesNotMatch(JSON.stringify(visible), /payroll|restricted-payroll-marker/i);
      const denied = await foreign.request(`${base}/${suffix}`);
      assert.equal(denied.status, 404);
    }
    assert.deepEqual(ok(await member.request(`${base}/search?q=restricted-payroll-marker`)), { results: [], total: 0, limit: 20, offset: 0 });
    const foreignBase = `/api/companies/${outsider.companyId}`;
    for (const path of [`${foreignBase}/pages/${pageId}`, `${foreignBase}/pages/${pageId}/revisions/2`, `${foreignBase}/pages/${pageId}/export-markdown`, attachment.url.replace(base, foreignBase)]) {
      assert.equal((await foreign.request(path)).status, 404, path);
    }
    const [stored] = await store.db.select().from(schema.pages).where(eq(schema.pages.id, pageId));
    assert.equal(stored.revision, 2);
    assert.equal(await store.db.$count(schema.attachments, eq(schema.attachments.pageId, pageId)), 1);
    assert.equal(await store.db.$count(schema.pageRevisions, eq(schema.pageRevisions.pageId, pageId)), 2);
  });

  await context.test("deep branched trees archive and restore every descendant with stable content, ids, slugs and overrides", async () => {
    const root = await create("Deep tree root");
    const ids = [root];
    for (let depth = 1; depth <= 40; depth++) ids.push(await create(`Depth ${depth}`, ids.at(-1)));
    const branch = await create("Restricted branch", ids[20]);
    const leaf = await create("Restricted branch leaf", branch);
    ids.push(branch, leaf);
    await restrict(branch);
    const deepest = ids[40];
    const content = Array.from({ length: 120 }, (_, index) => paragraph(`long-${index}`, `Section ${index} ${"long content ".repeat(100)}`));
    ok(await admin.request(`${base}/pages/${deepest}/content`, "PUT", { baseRevision: 1, content }));
    const attachment = ok(await admin.upload(`${base}/pages/${deepest}/attachments`));
    const before = await store.db.select().from(schema.pages).where(inArray(schema.pages.id, ids)).orderBy(asc(schema.pages.id));
    assert.equal(ok(await member.request(`${base}/pages/${deepest}`)).breadcrumbs.length, 40);
    assert.deepEqual(ok(await member.request(`${base}/pages/${deepest}`)).page.content, content);
    assert.equal((await member.request(`${base}/pages/${leaf}`)).status, 404);
    ok(await admin.request(`${base}/pages/${root}/archive`, "POST"));
    const archived = await store.db.select().from(schema.pages).where(inArray(schema.pages.id, ids));
    assert.equal(archived.length, 43);
    assert.ok(archived.every(row => row.archivedRootId === root && row.archivedAt));
    for (const pageId of ids) assert.equal((await admin.request(`${base}/pages/${pageId}`)).status, 404);
    assert.equal((await admin.request(attachment.url)).status, 404);
    assert.equal((await admin.request(`${base}/pages/${deepest}/export-markdown`)).status, 404);
    assert.equal(ok(await admin.request(`${base}/search?q=long%20content`)).total, 0);
    const trash = ok(await admin.request(`${base}/pages/archived`));
    assert.deepEqual(trash.pages.filter((page: any) => ids.includes(page.id)).map((page: any) => page.id), [root]);
    ok(await admin.request(`${base}/pages/${root}/restore`, "POST"));
    const restored = await store.db.select().from(schema.pages).where(inArray(schema.pages.id, ids)).orderBy(asc(schema.pages.id));
    assert.deepEqual(restored, before);
    assert.deepEqual(ok(await member.request(`${base}/pages/${deepest}`)).page.content, content);
    assert.equal((await member.request(`${base}/pages/${leaf}`)).status, 404, "explicit overrides survive whole-tree restoration");
    assert.equal(ok(await member.request(attachment.url)), "private attachment bytes");
  });

  await context.test("empty, long and nested documents and broken links are safe and rejected structural edits leave no revision", async () => {
    const pageId = await create("");
    const route = `${base}/pages/${pageId}`;
    const empty = ok(await admin.request(route)).page;
    assert.equal(empty.title, "");
    assert.deepEqual(empty.content, []);
    assert.match(empty.slug, /^untitled-/);
    assert.equal(ok(await admin.request(`${route}/export-markdown`)), "<!-- pages:page-title -->\n# Untitled");
    const absentId = randomUUID();
    const content = [link("broken-id", absentId), link("broken-slug", "does-not-exist"), link("broken-escape", "%E0%A4%A")];
    ok(await admin.request(`${route}/content`, "PUT", { baseRevision: 1, content }));
    assert.deepEqual(ok(await member.request(route)).page.content, content);
    assert.equal((await member.request(`${base}/pages/${absentId}`)).status, 404);
    assert.equal(await store.db.$count(schema.pageLinks, eq(schema.pageLinks.sourceId, pageId)), 0);
    function nested(depth: number): unknown[] {
      return depth === 1 ? [paragraph("nested-leaf", "Nested text")] : [{ ...paragraph(`nested-${depth}`, "Nested text"), children: nested(depth - 1) }];
    }
    const accepted = ok(await admin.request(`${route}/content`, "PUT", { baseRevision: 2, content: nested(8) }));
    assert.equal(accepted.revision, 3);
    assert.deepEqual(ok(await member.request(route)).page.content, accepted.content);
    for (const invalid of [nested(9), Array.from({ length: 5_001 }, (_, index) => paragraph(`overflow-${index}`, "Block"))]) {
      assert.equal((await admin.request(`${route}/content`, "PUT", { baseRevision: 3, content: invalid })).status, 400);
    }
    assert.equal((await admin.request(`${route}/content`, "PUT", { baseRevision: 3, content: [paragraph("oversized", "x".repeat(1_000_001))] })).status, 413);
    assert.deepEqual(ok(await admin.request(route)).page.content, accepted.content);
    assert.equal(ok(await admin.request(route)).page.revision, 3);
    assert.equal(await store.db.$count(schema.pageRevisions, eq(schema.pageRevisions.pageId, pageId)), 3);
  });

  await context.test("review-due reminders deduplicate concurrent fetches, renew only for a new due date and recheck access before email or retry", async () => {
    const pageId = await create("Review reminder acceptance", undefined, member);
    const route = `${base}/pages/${pageId}`;
    ok(await member.request(`${route}/review`, "PATCH", { reviewIntervalDays: 1 }));
    const firstReviewedAt = new Date(Date.now() - 5 * day);
    await store.db.update(schema.pages).set({ lastReviewedAt: firstReviewedAt }).where(eq(schema.pages.id, pageId));
    const reminders = () => store.db.select().from(schema.notifications).where(and(eq(schema.notifications.pageId, pageId), eq(schema.notifications.kind, "review_due"))).orderBy(asc(schema.notifications.createdAt));
    const sent = () => delivered.filter(message => message.kind === "review-reminder" && message.pageTitle === "Review reminder acceptance");
    const fetched = await Promise.all([member.request(`${base}/notifications`), member.request(`${base}/notifications/unread-count`), member.request(`${base}/notifications`)]);
    fetched.forEach(ok);
    let rows = await reminders();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].recipientId, editor.userId);
    assert.equal(rows[0].dedupeKey, `review_due:${pageId}:${new Date(firstReviewedAt.getTime() + day).toISOString()}`);
    assert.equal(sent().length, 1);
    ok(await member.request(`${route}/review`, "POST"));
    assert.ok((await reminders())[0].readAt);
    assert.deepEqual(ok(await member.request(`${base}/review-due?mine=1`)).pages, []);
    ok(await member.request(`${base}/notifications`));
    assert.equal((await reminders()).length, 1);
    await store.db.update(schema.pages).set({ lastReviewedAt: new Date(firstReviewedAt.getTime() + day) }).where(eq(schema.pages.id, pageId));
    ok(await member.request(`${base}/notifications`));
    rows = await reminders();
    assert.equal(rows.length, 2);
    assert.equal(sent().length, 2);
    const pending = rows[1];
    const failed = rows[0];
    await store.db.update(schema.notifications).set({ emailStatus: "failed" }).where(eq(schema.notifications.id, failed.id));
    await store.db.update(schema.notifications).set({ emailStatus: "pending" }).where(eq(schema.notifications.id, pending.id));
    await restrict(pageId);
    const hidden = ok(await member.request(`${base}/notifications`));
    assert.ok(hidden.notifications.every((row: any) => row.pageId !== pageId));
    assert.deepEqual(ok(await member.request(`${base}/review-due?mine=1`)).pages, []);
    assert.equal((await member.request(`${base}/notifications/${pending.id}/retry-email`, "POST")).status, 404);
    assert.equal((await member.request(`${base}/notifications/${failed.id}/retry-email`, "POST")).status, 404);
    assert.equal(sent().length, 2, "pending email and retries cannot disclose a newly restricted page");
    const [withheld] = await store.db.select().from(schema.notifications).where(eq(schema.notifications.id, pending.id));
    assert.equal(withheld.emailStatus, "not_applicable");
    await restrict(pageId, true);
    assert.equal(ok(await member.request(`${base}/notifications/${failed.id}/retry-email`, "POST")).emailStatus, "sent");
    assert.equal(sent().length, 3);
    assert.equal(sent()[0].idempotencyKey, sent()[2].idempotencyKey);
    assert.equal((await reminders()).length, 2, "retry uses the same stored notification");
    ok(await admin.request(`${route}/archive`, "POST"));
    assert.deepEqual(ok(await member.request(`${base}/review-due?mine=1`)).pages, []);
    assert.ok(ok(await member.request(`${base}/notifications`)).notifications.every((row: any) => row.pageId !== pageId));
    ok(await admin.request(`${route}/restore`, "POST"));
    ok(await member.request(`${base}/notifications`));
    assert.equal((await reminders()).length, 2, "archive/restore must not resend the same due date");
    assert.equal(sent().length, 3);
  });

  await context.test("scheduled review reminder sweep creates one notification per due period and exposes failed email for retry", async () => {
    const pageId = await create("Scheduled review reminder");
    const route = `${base}/pages/${pageId}`;
    ok(await admin.request(`${route}/review`, "PATCH", { reviewIntervalDays: 1 }));
    const lastReviewedAt = new Date("2024-01-01T12:00:00.000Z");
    const dueAt = new Date(lastReviewedAt.getTime() + day);
    await store.db.update(schema.pages).set({ lastReviewedAt }).where(eq(schema.pages.id, pageId));
    const reminders = () => store.db.select().from(schema.notifications).where(and(eq(schema.notifications.pageId, pageId), eq(schema.notifications.kind, "review_due")));
    const clock = () => new Date(dueAt.getTime() + 1);

    failReviewEmails = true;
    const created = await Promise.all([
      sweepReviewDueReminders(store.db, mailProvider, origin, clock),
      sweepReviewDueReminders(store.db, mailProvider, origin, clock),
    ]);
    assert.deepEqual(created.sort(), [0, 1]);
    let rows = await reminders();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].recipientId, owner.userId);
    assert.equal(rows[0].dedupeKey, `review_due:${pageId}:${dueAt.toISOString()}`);
    assert.equal(rows[0].emailStatus, "failed");
    assert.equal((await sweepReviewDueReminders(store.db, mailProvider, origin, clock)), 0);
    assert.equal(reviewEmailAttempts, 1, "repeated sweep must not retry failed mail automatically");

    const visible = ok(await admin.request(`${base}/notifications`)).notifications.find((row: any) => row.id === rows[0].id);
    assert.equal(visible.emailStatus, "failed");
    assert.equal(visible.emailError, "Email could not be delivered. Please retry.");
    failReviewEmails = false;
    assert.equal(ok(await admin.request(`${base}/notifications/${rows[0].id}/retry-email`, "POST")).emailStatus, "sent");
    rows = await reminders();
    assert.equal(rows.length, 1, "manual retry reuses the existing notification");
    assert.equal(rows[0].emailStatus, "sent");
  });

  await context.test("revoked members lose existing sessions and cannot recover page, attachment, history, search or export access by signing into another company", async () => {
    const pageId = await create("Revoked member acceptance", undefined, member);
    const route = `${base}/pages/${pageId}`;
    const attachment = ok(await member.upload(`${route}/attachments`));
    const paths = [route, `${route}/revisions`, `${route}/revisions/1`, `${route}/export-markdown`, attachment.url, `${base}/search?q=Revoked`, `${base}/pages`, `${base}/notifications`, `${base}/review-due`];
    for (const path of paths) ok(await member.request(path));
    ok(await admin.request(`${base}/members/${editor.userId}`, "PATCH", { status: "deactivated" }));
    assert.equal(await store.db.$count(schema.session, eq(schema.session.userId, editor.userId)), 0);
    for (const path of paths) assert.equal((await member.request(path)).status, 401, path);
    ok(await member.request("/api/auth/sign-in/email", "POST", { email: "acceptance-member@example.test", password }));
    assert.deepEqual(ok(await member.request("/api/me")).companies.map((company: any) => company.companyId), [editor.companyId]);
    for (const path of paths) {
      const denied = await member.request(path);
      assert.equal(denied.status, 404, path);
      assert.doesNotMatch(JSON.stringify(denied.data), /Revoked member acceptance|private attachment bytes/);
    }
    assert.equal((await member.request(`${route}/content`, "PUT", { baseRevision: 1, content: [] })).status, 404);
    assert.equal((await member.request(`${route}/revisions/1/restore`, "POST")).status, 404);
    assert.equal((await member.upload(`${route}/attachments`)).status, 404);
    assert.equal(ok(await admin.request(route)).page.revision, 1);
  });
});
