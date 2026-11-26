import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/database.ts";
import * as schema from "../server/schema.ts";

const origin = "http://127.0.0.1:5173";
const password = "A long unique test password 42!";
const secret = "test-secret-only-4b8c94b68da4933a43b0fd0ef33487de";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

test("pages-api: authorized pages, autosave conflicts, moves and attachments over the real request handler", async context => {
  const dir = await mkdtemp(join(tmpdir(), "wiki-pages-"));
  const uploadDir = join(dir, "uploads");
  const store = await openDatabase("memory://");
  const app = createApp({ db: store.db, origin, secret, environment: "test", mailProvider: { kind: "test", async send() {} }, uploadDir });
  function client(id: string) {
    const cookies = new Map<string, string>();
    async function send(path: string, method: string, body: BodyInit | undefined, headers: Record<string, string>) {
      const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await app.handle(new Request(origin + path, { method, headers: { origin, cookie, ...headers }, body }), id);
      for (const set of response.headers.getSetCookie()) {
        const pair = set.split(";")[0];
        cookies.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
      }
      const type = response.headers.get("content-type") ?? "";
      return { status: response.status, headers: response.headers, data: type.startsWith("application/json") ? await response.json() as any : await response.text() };
    }
    return {
      request: (path: string, method = "GET", data?: unknown) => send(path, method, method === "GET" ? undefined : JSON.stringify(data ?? {}), { "content-type": "application/json" }),
      upload: (path: string, name: string, bytes: Buffer, type = "application/octet-stream") => send(path, "POST", new Uint8Array(bytes), { "content-type": type, "x-file-name": encodeURIComponent(name) }),
      form: (path: string, form: FormData) => send(path, "POST", form, {}),
    };
  }
  async function register(c: ReturnType<typeof client>, name: string) {
    const email = `${name.toLowerCase()}@example.test`;
    const registered = await c.request("/api/register", "POST", { name, email, password, companyName: `${name} Company` });
    assert.equal(registered.status, 200, JSON.stringify(registered.data));
    const me = await c.request("/api/me");
    return { userId: me.data.user.id as string, companyId: me.data.companies[0].companyId as string };
  }

  // Alice is admin of company A; Bob and Carol are plain members of A; Dave only belongs to company B.
  const alice = client("alice"), bob = client("bob"), carol = client("carol"), dave = client("dave"), viewer = client("viewer");
  const a = await register(alice, "Alice");
  const b = await register(bob, "Bob");
  const c = await register(carol, "Carol");
  const d = await register(dave, "Dave");
  const v = await register(viewer, "Viewer");
  await store.db.insert(schema.memberships).values([{ companyId: a.companyId, userId: b.userId, role: "editor" }, { companyId: a.companyId, userId: c.userId, role: "editor" }, { companyId: a.companyId, userId: v.userId, role: "viewer" }]);
  const api = `/api/companies/${a.companyId}`;
  async function create(who: ReturnType<typeof client>, title: string, parentId?: string) {
    const created = await who.request(`${api}/pages`, "POST", { title, parentId });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    return created.data.id as string;
  }
  async function restrictTo(pageId: string, grants: unknown[]) {
    const result = await alice.request(`${api}/pages/${pageId}/grants`, "PUT", { inherits: false, grants: [{ principalType: "user", principalId: a.userId, role: "editor" }, ...grants] });
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  const notFound = (result: { status: number; data: any }, message = "Page not found.") => {
    assert.equal(result.status, 404, JSON.stringify(result.data));
    assert.deepEqual(result.data, { message });
  };

  const handbook = await create(alice, "Handbook");
  const salaries = await create(alice, "Salaries 2026", handbook);
  const secretNotes = await create(alice, "Secret notes", salaries);
  await restrictTo(salaries, [{ principalType: "user", principalId: c.userId, role: "viewer" }]);

  try {
    let attachmentUrl = "";
    await context.test("workspace viewers can open visible pages but cannot edit, comment or create", async () => {
      const tree = await viewer.request(`${api}/pages`);
      assert.equal(tree.status, 200);
      const visiblePage = tree.data.pages.find((page: any) => page.id === handbook);
      assert.ok(visiblePage, "the workspace viewer can see the team page");
      assert.equal(typeof visiblePage.updatedAt, "string", "page tree includes update timestamps");

      const opened = await viewer.request(`${api}/pages/${handbook}`);
      assert.equal(opened.status, 200, JSON.stringify(opened.data));
      assert.equal(opened.data.page.role, "viewer");
      assert.equal((await viewer.request(`${api}/pages/${handbook}`, "PATCH", { title: "Changed by viewer" })).status, 403);
      assert.equal((await viewer.request(`${api}/pages/${handbook}/comments`, "POST", { body: "A viewer comment" })).status, 403);
      assert.equal((await viewer.request(`${api}/pages`, "POST", { title: "Viewer page" })).status, 404);
    });

    await context.test("restricted pages, their history and attachments are hidden from other members as 404", async () => {
      const tree = await bob.request(`${api}/pages`);
      assert.equal(tree.status, 200);
      assert.deepEqual(tree.data.pages.map((page: any) => page.title), ["Handbook"]);
      assert.equal(JSON.stringify(tree.data).includes("Salaries"), false);
      for (const path of [`/pages/${salaries}`, `/pages/${secretNotes}`, `/pages/${salaries}/revisions`, `/pages/${salaries}/revisions/1`, `/pages/${salaries}/grants`]) {
        notFound(await bob.request(api + path));
      }
      notFound(await bob.request(`${api}/pages/${salaries}`, "PATCH", { title: "Mine now" }));
      notFound(await bob.request(`${api}/pages/${salaries}/content`, "PUT", { content: [], baseRevision: 1 }));
      notFound(await bob.request(`${api}/favorites/${salaries}`, "PUT"));
      notFound(await bob.request(`${api}/pages/not-a-page-id`));

      const uploaded = await alice.upload(`${api}/pages/${salaries}/attachments`, "chart.png", png, "image/png");
      assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data));
      attachmentUrl = uploaded.data.url;
      assert.match(attachmentUrl, new RegExp(`^${api}/attachments/[0-9a-f-]{36}$`));
      notFound(await bob.request(attachmentUrl), "File not found.");
      const download = await carol.request(attachmentUrl);
      assert.equal(download.status, 200);
      assert.equal(download.headers.get("content-type"), "image/png");
      assert.equal(download.headers.get("x-content-type-options"), "nosniff");
      assert.match(download.headers.get("content-disposition")!, /^inline; filename="chart\.png"/);
      const stored = await readdir(uploadDir);
      assert.equal(stored.length, 1);
      assert.equal(stored[0].includes("chart"), false, "files are stored under random names");

      const carolView = await carol.request(`${api}/pages/${secretNotes}`);
      assert.equal(carolView.status, 200);
      assert.equal(carolView.data.page.role, "viewer");
      assert.deepEqual(carolView.data.breadcrumbs.map((crumb: any) => crumb.title), ["Handbook", "Salaries 2026"]);
      const viewerSave = await carol.request(`${api}/pages/${secretNotes}/content`, "PUT", { content: [], baseRevision: 1 });
      assert.equal(viewerSave.status, 403);
      const sharing = await carol.request(`${api}/pages/${salaries}/grants`);
      assert.equal(sharing.status, 200, "viewers receive a read-only summary without principal entries");
      assert.equal(sharing.data.canManage, false);
      assert.deepEqual(sharing.data.grants, []);
      const recent = await carol.request(`${api}/recent`);
      assert.deepEqual(recent.data.pages.map((page: any) => page.id), [secretNotes]);
    });

    await context.test("another company's member gets 404 for pages, history, attachments and lists", async () => {
      for (const path of [`/pages/${handbook}`, `/pages/${handbook}/revisions`, `/pages`, `/favorites`, `/recent`]) notFound(await dave.request(api + path));
      notFound(await dave.request(attachmentUrl), "File not found.");
      notFound(await dave.request(`${api}/pages/${handbook}/move`, "POST", { parentId: null }));
      notFound(await dave.request(`${api}/pages`, "POST", { title: "Intruder" }));
      const ownApi = `/api/companies/${d.companyId}`;
      notFound(await dave.request(`${ownApi}/pages/${handbook}`), "Page not found.");
      notFound(await dave.request(`${ownApi}/attachments/${attachmentUrl.split("/").pop()}`), "File not found.");
      const davePage = await dave.request(`${ownApi}/pages`, "POST", { title: "Company B plans" });
      assert.equal(davePage.status, 200);
      notFound(await alice.request(`${ownApi}/pages/${davePage.data.id}`));
      notFound(await alice.request(`${api}/pages/${davePage.data.id}`));
      const crossParent = await alice.request(`${api}/pages`, "POST", { title: "Nested elsewhere", parentId: davePage.data.id });
      notFound(crossParent);
      const crossGrant = await alice.request(`${api}/pages/${handbook}/grants`, "PUT", { inherits: false, grants: [{ principalType: "user", principalId: d.userId, role: "editor" }] });
      assert.equal(crossGrant.status, 400, "grants cannot name people outside the company");
      assert.equal((await alice.request(`${api}/pages/${handbook}`)).data.page.inherits, true);
    });

    await context.test("autosave with a stale revision returns 409 with both versions and never overwrites", async () => {
      const opened = await bob.request(`${api}/pages/${handbook}`);
      assert.equal(opened.data.page.revision, 1);
      const bobContent = [
        { id: "b1", type: "paragraph", props: { textColor: "red", onclick: "x" }, content: [
          { type: "text", text: "Hello", styles: { bold: true, fontFamily: "evil" } },
          { type: "link", href: "javascript:alert(1)", content: [{ type: "text", text: "bad link", styles: {} }] },
          { type: "link", href: "https://example.com", content: [{ type: "text", text: "good link", styles: {} }] },
        ], children: [], extra: "dropped" },
        { id: "b2", type: "script", props: {}, content: [], children: [] },
        { id: "b3", type: "image", props: { url: "javascript:alert(1)", caption: "x" }, children: [] },
      ];
      const saved = await bob.request(`${api}/pages/${handbook}/content`, "PUT", { content: bobContent, baseRevision: 1 });
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(saved.data.revision, 2);
      const clean = saved.data.content;
      assert.deepEqual(clean.map((block: any) => block.type), ["paragraph", "image"]);
      assert.deepEqual(clean[0].props, { textColor: "red" });
      assert.equal("extra" in clean[0], false);
      assert.deepEqual(clean[0].content[0].styles, { bold: true });
      assert.deepEqual(clean[0].content[1], { type: "text", text: "bad link", styles: {} }, "unsafe link keeps its text only");
      assert.equal(clean[0].content[2].href, "https://example.com");
      assert.equal(clean[1].props.url, "");

      const aliceContent = [{ id: "a1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Alice draft", styles: {} }], children: [] }];
      const conflict = await alice.request(`${api}/pages/${handbook}/content`, "PUT", { content: aliceContent, baseRevision: 1 });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.current.revision, 2);
      assert.deepEqual(conflict.data.current.content, clean);
      assert.equal(conflict.data.yours.baseRevision, 1);
      assert.equal(conflict.data.yours.content[0].content[0].text, "Alice draft");
      const after = await alice.request(`${api}/pages/${handbook}`);
      assert.equal(after.data.page.revision, 2);
      assert.deepEqual(after.data.page.content, clean, "the conflicting save did not overwrite");
      const history = await alice.request(`${api}/pages/${handbook}/revisions`);
      assert.deepEqual(history.data.revisions.map((row: any) => row.revision), [2, 1]);
      assert.equal(history.data.revisions[0].authorId, b.userId);
      assert.deepEqual((await bob.request(`${api}/pages/${handbook}/revisions/1`)).data.revision.content, []);
      notFound(await bob.request(`${api}/pages/${handbook}/revisions/9`), "Revision not found.");
      const resolved = await alice.request(`${api}/pages/${handbook}/content`, "PUT", { content: aliceContent, baseRevision: 2 });
      assert.equal(resolved.status, 200);
      assert.equal(resolved.data.revision, 3);
      assert.equal((await alice.request(`${api}/pages/${handbook}/content`, "PUT", { content: "<script>", baseRevision: 3 })).status, 400);
    });

    await context.test("moving a page under itself or a descendant is rejected", async () => {
      const top = await create(bob, "Top");
      const middle = await create(bob, "Middle", top);
      const bottom = await create(bob, "Bottom", middle);
      for (const parentId of [top, middle, bottom]) {
        const moved = await bob.request(`${api}/pages/${top}/move`, "POST", { parentId });
        assert.equal(moved.status, 409, JSON.stringify(moved.data));
      }
      const [row] = await store.db.select().from(schema.pages).where(and(eq(schema.pages.companyId, a.companyId), eq(schema.pages.id, top)));
      assert.equal(row.parentId, null);
      const valid = await bob.request(`${api}/pages/${bottom}/move`, "POST", { parentId: top, position: 0 });
      assert.equal(valid.status, 200);
      const tree = await bob.request(`${api}/pages`);
      const children = tree.data.pages.filter((page: any) => page.parentId === top).map((page: any) => page.title);
      assert.deepEqual(children, ["Bottom", "Middle"], "reorder puts the moved page first");
      assert.equal((await bob.request(`${api}/pages/${middle}/move`, "POST", { parentId: top, beforeId: bottom })).status, 200);
      const reordered = (await bob.request(`${api}/pages`)).data.pages.filter((page: any) => page.parentId === top).map((page: any) => page.title);
      assert.deepEqual(reordered, ["Middle", "Bottom"], "beforeId places the page in front of a visible sibling");
    });

    await context.test("tree-guards: archive, move and impact reject inaccessible descendants without mutation; admin allowed", async () => {
      const projects = await create(alice, "Onboarding Guide");
      const budget = await create(alice, "Budget plan", projects);
      const budgetDetail = await create(alice, "Budget detail", budget);
      const ownerOnly = await create(alice, "Owner-only notes", projects);
      await restrictTo(ownerOnly, []);
      await restrictTo(budget, [{ principalType: "user", principalId: c.userId, role: "editor" }]);
      const before = await store.db.select().from(schema.pages).where(eq(schema.pages.companyId, a.companyId));
      const auditBefore = await store.db.select().from(schema.auditEvents);
      const activityBefore = await store.db.select().from(schema.pageActivity);
      for (const action of ["move-impact", "move", "archive"]) {
        const rejected = await bob.request(`${api}/pages/${projects}/${action}`, "POST", { parentId: handbook });
        assert.equal(rejected.status, 403, JSON.stringify(rejected.data));
        assert.deepEqual(rejected.data, { message: "You do not have access to perform this action on the entire page tree." });
        assert.deepEqual(await store.db.select().from(schema.pages).where(eq(schema.pages.companyId, a.companyId)), before);
        assert.deepEqual((await store.db.select().from(schema.auditEvents)).filter(event => !event.action.endsWith(".denied")), auditBefore.filter(event => !event.action.endsWith(".denied")), "no successful mutation is recorded");
        assert.deepEqual(await store.db.select().from(schema.pageActivity), activityBefore);
      }
      const impact = await alice.request(`${api}/pages/${projects}/move-impact`, "POST", { parentId: handbook });
      assert.equal(impact.status, 200, JSON.stringify(impact.data));
      const moved = await alice.request(`${api}/pages/${projects}/move`, "POST", { parentId: handbook, accessAcknowledgement: impact.data.token });
      assert.equal(moved.status, 200, JSON.stringify(moved.data));
      const tree = await bob.request(`${api}/pages`);
      assert.equal(tree.data.pages.find((page: any) => page.id === projects).parentId, handbook);
      assert.equal(JSON.stringify(tree.data).includes("Budget"), false);
      notFound(await bob.request(`${api}/pages/${budget}`));
      notFound(await bob.request(`${api}/pages/${budgetDetail}`));
      assert.equal((await carol.request(`${api}/pages/${budgetDetail}`)).data.page.role, "editor");
      const grants = await alice.request(`${api}/pages/${budget}/grants`);
      assert.equal(grants.data.inherits, false, "moved descendants keep their own settings");
      assert.equal(grants.data.grants.length, 2);
      assert.equal((await bob.request(`${api}/pages/${handbook}/move`, "POST", { parentId: projects })).status, 403, "hidden descendants are rejected before returning move details");

      const copy = await bob.request(`${api}/pages/${projects}/duplicate`, "POST");
      assert.equal(copy.status, 200);
      assert.equal(copy.data.count, 1, "duplicate skips subpages the caller cannot view");
      assert.equal((await alice.request(`${api}/pages/${projects}/archive`, "POST")).status, 200);
      assert.equal((await alice.request(`${api}/pages/${projects}/restore`, "POST")).status, 200);
      assert.equal((await carol.request(`${api}/pages/${budgetDetail}`)).status, 200);
    });

    await context.test("readable-only children do not block an editor archiving or moving the parent", async () => {
      const parent = await create(alice, "Readable child boundary");
      const child = await create(alice, "Read-only child", parent);
      await restrictTo(child, [{ principalType: "user", principalId: b.userId, role: "viewer" }]);
      const before = (await alice.request(`${api}/pages/${child}`)).data.page;
      assert.equal((await bob.request(`${api}/pages/${child}`)).data.page.role, "viewer");
      assert.equal((await bob.request(`${api}/pages/${child}/archive`, "POST")).status, 403);
      const impact = await bob.request(`${api}/pages/${parent}/move-impact`, "POST", { parentId: handbook });
      assert.equal(impact.status, 200, JSON.stringify(impact.data));
      assert.equal((await bob.request(`${api}/pages/${parent}/move`, "POST", { parentId: handbook, accessAcknowledgement: impact.data.token })).status, 200);
      assert.equal((await bob.request(`${api}/pages/${parent}/archive`, "POST")).status, 200);
      assert.equal((await bob.request(`${api}/pages/${parent}/restore`, "POST")).status, 200);
      const after = (await alice.request(`${api}/pages/${child}`)).data.page;
      for (const key of ["id", "slug", "content", "revision", "parentId", "inherits"]) assert.deepEqual(after[key], before[key]);
      assert.equal((await bob.request(`${api}/pages/${child}`)).data.page.role, "viewer");
    });

    await context.test("uploads reject disallowed types, mismatched content, oversized files and non-editors", async () => {
      const upload = `${api}/pages/${handbook}/attachments`;
      assert.equal((await alice.upload(upload, "tool.exe", Buffer.from("MZ binary"))).status, 415);
      assert.equal((await alice.upload(upload, "photo.png", Buffer.from("not really a png"))).status, 415);
      assert.equal((await alice.upload(upload, "paper.pdf", Buffer.from("<html>"))).status, 415);
      assert.equal((await alice.upload(upload, "page.html", Buffer.from("<script>alert(1)</script>"))).status, 415);
      assert.equal((await alice.upload(upload, "empty.txt", Buffer.alloc(0))).status, 400);
      const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
      assert.equal((await alice.upload(upload, "huge.txt", huge)).status, 413);
      assert.equal((await carol.upload(`${api}/pages/${salaries}/attachments`, "notes.txt", Buffer.from("hi"))).status, 403);
      notFound(await bob.upload(`${api}/pages/${salaries}/attachments`, "notes.txt", Buffer.from("hi")));
      notFound(await dave.upload(upload, "notes.txt", Buffer.from("hi")));
      const form = new FormData();
      form.append("file", new Blob([Buffer.from("%PDF-1.7 test")], { type: "application/pdf" }), "report.pdf");
      const accepted = await alice.form(upload, form);
      assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
      assert.equal(accepted.data.mimeType, "application/pdf");
      const download = await bob.request(accepted.data.url);
      assert.equal(download.status, 200);
      assert.match(download.headers.get("content-disposition")!, /^attachment; filename="report\.pdf"/);
      assert.equal((await readdir(uploadDir)).length, 2, "rejected uploads leave no files behind");
    });

    await context.test("attachment type allowlist accepts supported formats and rejects signature mismatches", async () => {
      const pageId = await create(alice, "Attachment formats");
      const route = `${api}/pages/${pageId}/attachments`;
      const formats: [string, Buffer, string][] = [
        ["png", png, "image/png"],
        ["jpg", Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"],
        ["jpeg", Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"],
        ["gif", Buffer.from("GIF87a"), "image/gif"],
        ["gif", Buffer.from("GIF89a"), "image/gif"],
        ["webp", Buffer.from("RIFF1234WEBP"), "image/webp"],
        ["pdf", Buffer.from("%PDF-1.7"), "application/pdf"],
        ["doc", Buffer.from("legacy document"), "application/msword"],
        ["docx", Buffer.from("document"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        ["xls", Buffer.from("legacy sheet"), "application/vnd.ms-excel"],
        ["xlsx", Buffer.from("sheet"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
        ["ppt", Buffer.from("legacy slides"), "application/vnd.ms-powerpoint"],
        ["pptx", Buffer.from("slides"), "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
        ["txt", Buffer.from("text"), "text/plain"],
        ["csv", Buffer.from("column\nvalue"), "text/csv"],
        ["md", Buffer.from("# Markdown"), "text/markdown"],
      ];
      for (const [extension, bytes, mime] of formats) {
        const result = await alice.upload(route, `example.${extension.toUpperCase()}`, bytes);
        assert.equal(result.status, 200, extension);
        assert.equal(result.data.mimeType, mime);
        if (["png", "jpg", "jpeg", "gif", "webp", "pdf"].includes(extension)) {
          assert.equal((await alice.upload(route, `fake.${extension}`, Buffer.from("wrong signature"), mime)).status, 415, extension);
        }
      }
      for (const filename of ["image.svg", "program.exe", "document.pdf.exe", "page.html", "unknown"]) {
        assert.equal((await alice.upload(route, filename, png, "image/png")).status, 415, filename);
      }
    });

    await context.test("attachments accept the exact 10 MiB boundary and recheck revoked and archived access", async () => {
      const pageId = await create(alice, "Attachment boundaries");
      const route = `${api}/pages/${pageId}`;
      const bytes = Buffer.alloc(10 * 1024 * 1024, 0x41);
      const accepted = await alice.upload(`${route}/attachments`, "boundary.txt", bytes, "text/html");
      assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
      assert.equal(accepted.data.mimeType, "text/plain", "untrusted MIME headers cannot change the allowed extension type");
      const downloaded = await bob.request(accepted.data.url);
      assert.equal(downloaded.status, 200);
      assert.equal(Buffer.byteLength(downloaded.data), bytes.length);
      assert.equal((await alice.upload(`${route}/attachments`, "too-big.txt", Buffer.alloc(bytes.length + 1))).status, 413);
      const singleByte = await alice.upload(`${route}/attachments`, "minimal.txt", Buffer.from("a"));
      assert.equal(singleByte.status, 200);
      await restrictTo(pageId, []);
      notFound(await bob.request(accepted.data.url), "File not found.");
      assert.equal((await alice.request(accepted.data.url)).status, 200);
      assert.equal((await alice.request(`${route}/archive`, "POST")).status, 200);
      notFound(await alice.request(accepted.data.url), "File not found.");
      notFound(await bob.request(accepted.data.url), "File not found.");
      assert.equal((await alice.request(`${route}/restore`, "POST")).status, 200);
      assert.equal((await alice.request(accepted.data.url)).status, 200);
      notFound(await bob.request(accepted.data.url), "File not found.");
    });

    await context.test("archive hides a subtree until an editor restores it with the same ids and slugs", async () => {
      const before = await alice.request(`${api}/pages/${salaries}`);
      assert.equal((await alice.request(`${api}/pages/${salaries}/archive`, "POST")).status, 200);
      notFound(await alice.request(`${api}/pages/${secretNotes}`));
      notFound(await carol.request(`${api}/pages/${salaries}`));
      assert.equal((await carol.request(`${api}/pages/${salaries}/restore`, "POST")).status, 404, "viewers cannot restore");
      assert.deepEqual((await alice.request(`${api}/pages/archived`)).data.pages.map((page: any) => page.id), [salaries]);
      assert.equal((await alice.request(`${api}/pages/${secretNotes}/restore`, "POST")).status, 200);
      const after = await alice.request(`${api}/pages/${salaries}`);
      assert.equal(after.data.page.slug, before.data.page.slug);
      assert.equal(after.data.page.parentId, handbook);
      assert.equal((await alice.request(`${api}/pages/${secretNotes}`)).status, 200);
    });
    await context.test("permission and archive audits distinguish successful and denied operations", async () => {
      const route = `${api}/pages/${salaries}`;
      assert.equal((await carol.request(`${route}/grants`, "PUT", { inherits: false, grants: [] })).status, 403);
      assert.equal((await carol.request(`${route}/archive`, "POST")).status, 403);
      const logs = await store.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.companyId, a.companyId));
      for (const action of ["page.grants_changed", "page.archived", "page.restored"]) {
        const succeeded = logs.filter(event => event.action === action && event.target === salaries);
        assert.ok(succeeded.length > 0, action);
        assert.ok(succeeded.every(event => event.actor === a.userId));
        assert.ok(logs.some(event => event.action === `${action}.denied` && event.actor === c.userId && event.target === salaries), `${action}.denied`);
      }
    });
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
