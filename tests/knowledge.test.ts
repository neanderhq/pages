import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/database.ts";
import * as schema from "../server/schema.ts";
import { linkTargets } from "../server/links.ts";

const origin = "http://127.0.0.1:5173";
const password = "A long unique test password 42!";
const secret = "test-secret-only-4b8c94b68da4933a43b0fd0ef33487de";
const day = 24 * 60 * 60 * 1000;
const paragraph = (text: string) => ({ type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
const linkTo = (href: string, label = "see also") => ({ type: "paragraph", props: {}, content: [{ type: "link", href, content: [{ type: "text", text: label, styles: {} }] }], children: [] });

test("links: internal /p/ links are found in text, tables and children; external links are ignored", () => {
  const table = { type: "table", content: { type: "tableContent", rows: [{ cells: [{ type: "tableCell", props: {}, content: [{ type: "link", href: "/p/in-table", content: [] }] }] }] } };
  const nested = { ...paragraph("x"), children: [linkTo("/p/child-slug#part")] };
  const content = [linkTo("/p/abc"), linkTo("https://example.com/p/abc"), linkTo("/p/abc?x=1"), table, nested];
  assert.deepEqual(linkTargets(content), ["abc", "in-table", "child-slug"]);
});

test("knowledge: search, tags, links, templates and review follow page permissions", async context => {
  const store = await openDatabase("memory://");
  const app = createApp({ db: store.db, origin, secret, environment: "test", mailProvider: { kind: "test", async send() {} } });
  function client(id: string) {
    const cookies = new Map<string, string>();
    return async (path: string, method = "GET", data?: unknown) => {
      const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await app.handle(new Request(origin + path, { method, headers: { origin, cookie, "content-type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(data ?? {}) }), id);
      for (const set of response.headers.getSetCookie()) {
        const pair = set.split(";")[0];
        cookies.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
      }
      return { status: response.status, data: await response.json() as any };
    };
  }
  async function register(request: ReturnType<typeof client>, name: string) {
    const registered = await request("/api/register", "POST", { name, email: `${name.toLowerCase()}@example.test`, password, companyName: `${name} Company` });
    assert.equal(registered.status, 200, JSON.stringify(registered.data));
    const me = await request("/api/me");
    return { userId: me.data.user.id as string, companyId: me.data.companies[0].companyId as string };
  }
  const ok = (result: { status: number; data: any }) => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
  // Nothing about the hidden pages may appear anywhere in a response: titles, snippets or tags.
  const leaks = (data: unknown) => /secret|confidential|archived plan|company b|hidden-tag/i.test(JSON.stringify(data));

  // Alice is admin of company A. Bob and Erin are members. Dave has his own company B.
  const alice = client("alice"), bob = client("bob"), erin = client("erin"), dave = client("dave");
  const a = await register(alice, "Alice");
  const b = await register(bob, "Bob");
  const e = await register(erin, "Erin");
  const d = await register(dave, "Dave");
  await store.db.insert(schema.memberships).values([b, e].map(person => ({ companyId: a.companyId, userId: person.userId, role: "editor" as const })));
  const api = `/api/companies/${a.companyId}`;
  async function createPage(request: ReturnType<typeof client>, base: string, title: string, body: string, extra: Record<string, unknown> = {}) {
    const id = ok(await request(`${base}/pages`, "POST", { title, ...extra })).id as string;
    ok(await request(`${base}/pages/${id}/content`, "PUT", { baseRevision: 1, content: [paragraph(body)] }));
    return id;
  }
  async function save(request: ReturnType<typeof client>, id: string, content: unknown[]) {
    const page = ok(await request(`${api}/pages/${id}`)).page;
    return ok(await request(`${api}/pages/${id}/content`, "PUT", { baseRevision: page.revision, content })).revision as number;
  }

  // Open pages: one by Alice in the company space, one by Bob, one in a team space.
  const guide = await createPage(alice, api, "Zebra guide", "How the zebra crossing procedure works for everyone.");
  const bobs = await createPage(bob, api, "Bob notes", "Zebra notes from Bob.");
  const spaceId = "space-ops";
  await store.db.insert(schema.spaces).values({ id: spaceId, companyId: a.companyId, name: "Operations", createdBy: a.userId });
  const opsPage = await createPage(alice, api, "Ops runbook", "Zebra steps for operations.", { spaceId });
  // Restricted page: Bob (viewer) and Alice (explicit editor). Matching title and body.
  const hidden = await createPage(alice, api, "Zebra secret plan", "Zebra confidential details.");
  ok(await alice(`${api}/pages/${hidden}/grants`, "PUT", { inherits: false, grants: [{ principalType: "user", principalId: a.userId, role: "editor" }, { principalType: "user", principalId: b.userId, role: "viewer" }] }));
  ok(await alice(`${api}/pages/${hidden}/tags`, "PUT", { tags: ["Hidden-Tag"] }));
  // Archived page with matching text, and another company's page with matching text.
  const archived = await createPage(alice, api, "Zebra archived plan", "Zebra archived details.");
  ok(await alice(`${api}/pages/${archived}/archive`, "POST"));
  await createPage(dave, `/api/companies/${d.companyId}`, "Zebra company B", "Zebra company B details.");

  try {
    await context.test("search never returns inaccessible titles, snippets or counts", async () => {
      const erinResult = ok(await erin(`${api}/search?q=zebra`));
      assert.deepEqual(erinResult.results.map((row: any) => row.id).sort(), [guide, bobs, opsPage].sort());
      assert.equal(erinResult.total, 3);
      assert.equal(leaks(erinResult), false);
      const body = ok(await erin(`${api}/search?q=confidential`));
      assert.deepEqual(body, { results: [], total: 0, limit: 20, offset: 0 });
      // Bob can view the restricted page, so he finds it (title match ranks first); still no archived or other-company page.
      const bobResult = ok(await bob(`${api}/search?q=zebra`));
      assert.equal(bobResult.total, 4);
      assert.equal(bobResult.results.some((row: any) => row.id === hidden), true);
      assert.equal(bobResult.results.some((row: any) => row.id === archived), false);
      assert.match(ok(await bob(`${api}/search?q=confidential`)).results[0].snippet, /confidential/i);
      // Even a granted admin never sees archived pages in search.
      assert.equal(ok(await alice(`${api}/search?q=archived`)).total, 0);
      // Another company's member cannot search company A, and their own search never sees company A pages.
      assert.equal((await dave(`${api}/search?q=zebra`)).status, 404);
      const daveResult = ok(await dave(`/api/companies/${d.companyId}/search?q=zebra`));
      assert.equal(daveResult.total, 1);
      assert.equal(JSON.stringify(daveResult).includes("guide"), false);
      // Result shape and validation.
      const row = erinResult.results.find((item: any) => item.id === guide);
      assert.equal(row.ownerName, "Alice");
      assert.equal(row.spaceId, null);
      assert.match(row.snippet, /zebra crossing/);
      assert.equal((await erin(`${api}/search?q=zebra&limit=51`)).status, 400);
      assert.equal(ok(await erin(`${api}/search?q=zebra&limit=1`)).results.length, 1);
      assert.equal(ok(await erin(`${api}/search?q=ZEBRA%25`)).total, 0);
    });

    await context.test("filters: owner, space, tag and updated date", async () => {
      assert.deepEqual(ok(await erin(`${api}/search?q=zebra&ownerId=${b.userId}`)).results.map((row: any) => row.id), [bobs]);
      assert.deepEqual(ok(await erin(`${api}/search?spaceId=${spaceId}`)).results.map((row: any) => row.id), [opsPage]);
      const company = ok(await erin(`${api}/search?q=zebra&spaceId=company`)).results.map((row: any) => row.id);
      assert.deepEqual(company.sort(), [guide, bobs].sort());
      assert.equal(ok(await erin(`${api}/search?spaceId=${spaceId}`)).results[0].spaceName, "Operations");
      // Tags: editors set them, they are normalized, and the tag list only counts accessible pages.
      assert.deepEqual(ok(await erin(`${api}/pages/${guide}/tags`, "PUT", { tags: ["Onboarding", " onboarding ", "Safety"] })).tags, ["onboarding", "safety"]);
      ok(await bob(`${api}/pages/${bobs}/tags`, "PUT", { tags: ["safety"] }));
      assert.equal((await erin(`${api}/pages/${guide}/tags`, "PUT", { tags: ["x".repeat(41)] })).status, 400);
      assert.equal((await erin(`${api}/pages/${hidden}/tags`)).status, 404);
      assert.equal((await bob(`${api}/pages/${hidden}/tags`, "PUT", { tags: ["mine"] })).status, 403);
      assert.deepEqual(ok(await erin(`${api}/pages/${guide}`)).page.tags, ["onboarding", "safety"]);
      const tagList = ok(await erin(`${api}/tags`));
      assert.deepEqual(tagList.tags, [{ tag: "onboarding", count: 1 }, { tag: "safety", count: 2 }]);
      assert.equal(ok(await bob(`${api}/tags`)).tags.some((row: any) => row.tag === "hidden-tag"), true);
      assert.deepEqual(ok(await erin(`${api}/search?tag=Safety&ownerId=${b.userId}`)).results.map((row: any) => row.id), [bobs]);
      assert.equal(ok(await erin(`${api}/search?tag=hidden-tag`)).total, 0);
      // Dates: move one page into the past.
      await store.db.update(schema.pages).set({ updatedAt: new Date("2020-06-01T00:00:00Z") }).where(eq(schema.pages.id, opsPage));
      assert.deepEqual(ok(await erin(`${api}/search?q=zebra&updatedBefore=2021-01-01`)).results.map((row: any) => row.id), [opsPage]);
      const recent = ok(await erin(`${api}/search?q=zebra&updatedAfter=2021-01-01`)).results.map((row: any) => row.id);
      assert.deepEqual(recent.sort(), [guide, bobs].sort());
      assert.equal((await erin(`${api}/search?updatedAfter=not-a-date`)).status, 400);
    });

    await context.test("backlinks hide inaccessible sources; links follow saves and restores", async () => {
      const slug = ok(await alice(`${api}/pages/${guide}`)).page.slug as string;
      await save(alice, hidden, [paragraph("Zebra confidential details."), linkTo(`/p/${guide}`)]);
      const linked = await save(bob, bobs, [paragraph("Zebra notes from Bob."), linkTo(`/p/${encodeURIComponent(slug)}`), linkTo(`/p/${bobs}`)]);
      const erinLinks = ok(await erin(`${api}/pages/${guide}/backlinks`));
      assert.deepEqual(erinLinks.pages.map((row: any) => row.id), [bobs]);
      assert.equal(leaks(erinLinks), false);
      assert.deepEqual(ok(await bob(`${api}/pages/${guide}/backlinks`)).pages.map((row: any) => row.id).sort(), [bobs, hidden].sort());
      assert.equal((await erin(`${api}/pages/${hidden}/backlinks`)).status, 404);
      assert.equal((await dave(`${api}/pages/${guide}/backlinks`)).status, 404);
      // Self links are not stored.
      assert.equal(await store.db.$count(schema.pageLinks, and(eq(schema.pageLinks.sourceId, bobs), eq(schema.pageLinks.targetId, bobs))), 0);
      // Removing the link removes the backlink; restoring the old revision brings it back.
      await save(bob, bobs, [paragraph("Zebra notes from Bob, no links.")]);
      assert.deepEqual(ok(await erin(`${api}/pages/${guide}/backlinks`)).pages, []);
      assert.equal(ok(await erin(`${api}/search?q=no links`)).total, 1);
      ok(await bob(`${api}/pages/${bobs}/revisions/${linked}/restore`, "POST"));
      assert.deepEqual(ok(await erin(`${api}/pages/${guide}/backlinks`)).pages.map((row: any) => row.id), [bobs]);
      assert.equal(ok(await erin(`${api}/search?q=no links`)).total, 0);
    });

    await context.test("templates create valid, searchable content", async () => {
      const list = ok(await erin(`${api}/templates`)).templates;
      assert.deepEqual(list.map((template: any) => template.id), ["handbook", "sop", "meeting-notes"]);
      const types = new Set<string>();
      for (const template of list) {
        const created = ok(await erin(`${api}/pages`, "POST", { templateId: template.id }));
        const page = ok(await erin(`${api}/pages/${created.id}`)).page;
        assert.equal(page.title, template.title);
        assert.ok(page.content.length > 5);
        for (const block of page.content) {
          assert.equal(typeof block.id, "string");
          types.add(block.type);
        }
        assert.equal(ok(await erin(`${api}/pages/${created.id}/revisions/1`)).revision.content.length, page.content.length);
      }
      for (const type of ["heading", "paragraph", "bulletListItem", "numberedListItem", "checkListItem", "table"]) assert.equal(types.has(type), true, type);
      const titled = ok(await erin(`${api}/pages`, "POST", { title: "Weekly sync", templateId: "meeting-notes" }));
      assert.equal(ok(await erin(`${api}/pages/${titled.id}`)).page.title, "Weekly sync");
      assert.equal(ok(await erin(`${api}/search?q=action items`)).total >= 1, true);
      assert.equal((await erin(`${api}/pages`, "POST", { templateId: "nope" })).status, 400);
    });

    await context.test("page tools: templates respect destinations, tags persist through removal, and revoked or archived backlinks disappear", async () => {
      for (const templateId of ["handbook", "sop", "meeting-notes"]) {
        assert.equal((await bob(`${api}/pages`, "POST", { parentId: hidden, templateId })).status, 403);
        assert.equal((await erin(`${api}/pages`, "POST", { parentId: hidden, templateId })).status, 404);
        assert.equal((await dave(`${api}/pages`, "POST", { templateId })).status, 404);
        const created = ok(await alice(`${api}/pages`, "POST", { parentId: opsPage, templateId }));
        const page = ok(await alice(`${api}/pages/${created.id}`)).page;
        assert.equal(page.parentId, opsPage);
        assert.equal(page.spaceId, spaceId);
        assert.equal(page.inherits, true);
      }
      const target = ok(await alice(`${api}/pages`, "POST", { templateId: "meeting-notes", title: "Tools workflow target" })).id;
      ok(await alice(`${api}/pages/${target}/grants`, "PUT", { inherits: false, grants: [
        { principalType: "user", principalId: b.userId, role: "commenter" },
        { principalType: "user", principalId: e.userId, role: "viewer" },
      ] }));
      assert.deepEqual(ok(await alice(`${api}/pages/${target}/tags`, "PUT", { tags: ["  Release   notes  ", "RELEASE NOTES", "Ops\twork", "\u0000Ready"] })).tags, ["opswork", "ready", "release notes"]);
      assert.deepEqual(ok(await bob(`${api}/pages/${target}/tags`)).tags, ["opswork", "ready", "release notes"]);
      assert.deepEqual(ok(await erin(`${api}/pages/${target}`)).page.tags, ["opswork", "ready", "release notes"]);
      for (const reader of [bob, erin]) {
        assert.equal((await reader(`${api}/pages/${target}/tags`, "PUT", { tags: ["forbidden"] })).status, 403);
        assert.equal((await reader(`${api}/pages`, "POST", { parentId: target, templateId: "sop" })).status, 403);
      }
      assert.equal((await alice(`${api}/pages/${target}/tags`, "PUT", { tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`) })).status, 400);
      for (const tag of ["", " ", "x".repeat(41)]) assert.equal((await alice(`${api}/pages/${target}/tags`, "PUT", { tags: [tag] })).status, 400);
      ok(await alice(`${api}/pages/${target}/tags`, "PUT", { tags: ["Release notes"] }));
      assert.deepEqual(ok(await erin(`${api}/pages/${target}`)).page.tags, ["release notes"]);
      assert.equal(ok(await erin(`${api}/tags`)).tags.some((row: any) => row.tag === "release notes"), true);
      assert.deepEqual(ok(await erin(`${api}/search?tag=Release%20notes`)).results.map((row: any) => row.id), [target]);
      ok(await alice(`${api}/pages/${target}/tags`, "PUT", { tags: [] }));
      assert.deepEqual(ok(await bob(`${api}/pages/${target}/tags`)).tags, []);
      assert.equal(ok(await erin(`${api}/tags`)).tags.some((row: any) => row.tag === "release notes"), false);
      assert.equal(ok(await erin(`${api}/search?tag=Release%20notes`)).total, 0);

      const source = await createPage(alice, api, "Restricted backlink source", "");
      await save(alice, source, [linkTo(`/p/${target}`)]);
      assert.deepEqual(ok(await bob(`${api}/pages/${target}/backlinks`)).pages.map((row: any) => row.id), [source]);
      ok(await alice(`${api}/pages/${source}/grants`, "PUT", { inherits: false, grants: [] }));
      const revoked = ok(await bob(`${api}/pages/${target}/backlinks`));
      assert.deepEqual(revoked.pages, []);
      assert.equal(JSON.stringify(revoked).includes("Restricted backlink source"), false);
      assert.equal(ok(await alice(`${api}/pages/${target}/backlinks`)).pages.length, 1);
      ok(await alice(`${api}/pages/${source}/archive`, "POST"));
      assert.deepEqual(ok(await alice(`${api}/pages/${target}/backlinks`)).pages, []);
    });

    await context.test("review: owner, interval, verified/stale/unreviewed and the review-due list", async () => {
      const reviewOf = async (request: ReturnType<typeof client>, id: string) => ok(await request(`${api}/pages/${id}`)).page.review;
      assert.equal((await reviewOf(erin, guide)).state, "unreviewed");
      assert.equal((await reviewOf(erin, guide)).ownerName, "Alice");
      // Owner changes: the new owner must be able to view the page.
      assert.equal((await alice(`${api}/pages/${hidden}/review`, "PATCH", { ownerId: e.userId })).status, 400);
      assert.equal((await alice(`${api}/pages/${hidden}/review`, "PATCH", { ownerId: d.userId })).status, 400);
      assert.equal((await bob(`${api}/pages/${hidden}/review`, "PATCH", { ownerId: b.userId })).status, 403);
      assert.equal((await erin(`${api}/pages/${hidden}/review`, "PATCH", { reviewIntervalDays: 5 })).status, 404);
      // A viewer who is not the owner cannot mark reviewed; once Bob owns it, he can.
      assert.equal((await bob(`${api}/pages/${hidden}/review`, "POST")).status, 403);
      assert.equal(ok(await alice(`${api}/pages/${hidden}/review`, "PATCH", { ownerId: b.userId, reviewIntervalDays: 30 })).review.ownerId, b.userId);
      assert.equal((await alice(`${api}/pages/${hidden}/review`, "PATCH", { reviewIntervalDays: 0 })).status, 400);
      const verified = ok(await bob(`${api}/pages/${hidden}/review`, "POST")).review;
      assert.equal(verified.state, "verified");
      assert.equal(verified.lastReviewedByName, "Bob");
      const activity = ok(await bob(`${api}/pages/${hidden}/activity`)).activity;
      assert.equal(activity.some((row: any) => row.action === "verified"), true);
      // 40 days later the 30-day review is overdue: stale.
      await store.db.update(schema.pages).set({ lastReviewedAt: new Date(Date.now() - 40 * day) }).where(eq(schema.pages.id, hidden));
      assert.equal((await reviewOf(bob, hidden)).state, "stale");
      // Without an interval a reviewed page stays verified.
      ok(await alice(`${api}/pages/${hidden}/review`, "PATCH", { reviewIntervalDays: null }));
      assert.equal((await reviewOf(bob, hidden)).state, "verified");
      ok(await alice(`${api}/pages/${hidden}/review`, "PATCH", { reviewIntervalDays: 30 }));
      // An open page with an interval that was never reviewed is due 30 days after creation.
      ok(await erin(`${api}/pages/${guide}/review`, "PATCH", { reviewIntervalDays: 30 }));
      await store.db.update(schema.pages).set({ createdAt: new Date(Date.now() - 40 * day) }).where(eq(schema.pages.id, guide));
      // Archived pages never appear, even when overdue.
      await store.db.update(schema.pages).set({ reviewIntervalDays: 1, lastReviewedAt: new Date(Date.now() - 40 * day) }).where(eq(schema.pages.id, archived));
      const erinDue = ok(await erin(`${api}/review-due`));
      assert.deepEqual(erinDue.pages.map((row: any) => row.id), [guide]);
      assert.equal(erinDue.pages[0].state, "unreviewed");
      assert.equal(leaks(erinDue), false);
      assert.deepEqual(ok(await bob(`${api}/review-due?mine=1`)).pages.map((row: any) => row.id), [hidden]);
      assert.deepEqual(ok(await alice(`${api}/review-due`)).pages.map((row: any) => row.id).sort(), [guide, hidden].sort());
      assert.equal(ok(await dave(`/api/companies/${d.companyId}/review-due`)).pages.length, 0);
    });

    await context.test("review_due notification is created once per due date, for the owner only", async () => {
      const dueFor = (userId: string) => store.db.$count(schema.notifications, and(eq(schema.notifications.recipientId, userId), eq(schema.notifications.kind, "review_due")));
      const first = ok(await bob(`${api}/notifications`)).notifications.filter((row: any) => row.kind === "review_due");
      assert.equal(first.length, 1);
      assert.equal(first[0].pageId, hidden);
      ok(await bob(`${api}/notifications/unread-count`));
      ok(await bob(`${api}/notifications`));
      assert.equal(await dueFor(b.userId), 1);
      assert.equal(await dueFor(e.userId), 0);
      // Erin can see nothing about the hidden page; Alice gets the reminder for the page she owns.
      assert.equal(leaks(ok(await erin(`${api}/notifications`))), false);
      assert.equal(ok(await alice(`${api}/notifications`)).notifications.filter((row: any) => row.kind === "review_due").length, 1);
      // Marking reviewed clears the reminder and makes the page verified again; no new reminder until the next due date.
      ok(await bob(`${api}/pages/${hidden}/review`, "POST"));
      const after = ok(await bob(`${api}/notifications`)).notifications.filter((row: any) => row.kind === "review_due");
      assert.equal(after.length, 1);
      assert.notEqual(after[0].readAt, null);
      assert.equal(await dueFor(b.userId), 1);
      assert.deepEqual(ok(await bob(`${api}/review-due?mine=1`)).pages, []);
    });
  } finally {
    await store.close();
  }
});
