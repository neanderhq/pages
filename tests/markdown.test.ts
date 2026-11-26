import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/database.ts";
import * as schema from "../server/schema.ts";

const origin = "http://127.0.0.1:5173";
const password = "A long unique test password 42!";

test("markdown: import creates a sanitized page tree transactionally and exports an authorized page", async context => {
  const dir = await mkdtemp(join(tmpdir(), "wiki-markdown-"));
  const store = await openDatabase("memory://");
  const app = createApp({ db: store.db, origin, secret: "test-secret-only-markdown-4b8c94b68da4933a43", environment: "test", mailProvider: { kind: "test", async send() {} }, uploadDir: join(dir, "uploads") });
  function client(id: string) {
    const cookies = new Map<string, string>();
    return {
      async request(path: string, method = "GET", body?: unknown) {
        const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
        const response = await app.handle(new Request(origin + path, { method, headers: { origin, cookie, ...(method === "GET" ? {} : { "content-type": "application/json" }) }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) }), id);
        for (const set of response.headers.getSetCookie()) {
          const pair = set.split(";")[0];
          cookies.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
        }
        const type = response.headers.get("content-type") ?? "";
        return { status: response.status, headers: response.headers, data: type.startsWith("application/json") ? await response.json() as any : await response.text() };
      },
    };
  }
  async function register(who: ReturnType<typeof client>, name: string) {
    const result = await who.request("/api/register", "POST", { name, email: `${name.toLowerCase()}@example.test`, password, companyName: `${name} Company` });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const identity = await who.request("/api/me");
    return { userId: identity.data.user.id as string, companyId: identity.data.companies[0].companyId as string };
  }
  try {
    const owner = client("markdown-owner"), reader = client("markdown-reader"), outsider = client("markdown-outsider");
    const ownerIdentity = await register(owner, "markdown-owner");
    const readerIdentity = await register(reader, "markdown-reader");
    await register(outsider, "markdown-outsider");
  await store.db.insert(schema.memberships).values({ companyId: ownerIdentity.companyId, userId: readerIdentity.userId, role: "editor" });
    const spaceId = randomUUID();
    await store.db.insert(schema.spaces).values({ id: spaceId, companyId: ownerIdentity.companyId, name: "Guides", createdBy: ownerIdentity.userId });
    const base = `/api/companies/${ownerIdentity.companyId}`;
    const initialCount = () => store.db.$count(schema.pages, and(eq(schema.pages.companyId, ownerIdentity.companyId), eq(schema.pages.spaceId, spaceId)));

    const rollback = await owner.request(`${base}/pages/import-markdown`, "POST", { spaceId, files: [
      { path: "First.md", content: "# Should roll back" },
      { path: "Nested/Too many blocks.md", content: Array.from({ length: 5_001 }, () => "Paragraph").join("\n\n") },
    ] });
    assert.equal(rollback.status, 400);
    assert.equal(await initialCount(), 0, "all pages from a failed batch must roll back");

    const imported = await owner.request(`${base}/pages/import-markdown`, "POST", { spaceId, files: [
      { path: "Guides/Start Here.md", content: "# Welcome\n\nA **safe** [link](https://example.test) and [bad](javascript:alert).\n\n| Topic | Owner |\n| --- | --- |\n| Safety | Team |" },
      { path: "Guides/Deep/Checklist.md", content: "- [x] First\n- [ ] Second\n\n> Read carefully" },
      { path: "Overview.md", content: "## Summary\n\nText." },
    ] });
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    assert.equal(imported.data.imported, 3);
    assert.equal(imported.data.pages.length, 5, "two directory pages and three Markdown pages are created");
    assert.equal(await initialCount(), 5);
    const byPath = new Map(imported.data.pages.map((page: { path: string; id: string }) => [page.path, page.id]));
    const rows = await store.db.select().from(schema.pages).where(and(eq(schema.pages.companyId, ownerIdentity.companyId), eq(schema.pages.spaceId, spaceId)));
    const start = rows.find(page => page.id === byPath.get("Guides/Start Here.md"))!;
    assert.equal(start.parentId, byPath.get("Guides"));
    assert.equal(rows.find(page => page.id === byPath.get("Guides/Deep"))?.parentId, byPath.get("Guides"));
    assert.equal(JSON.stringify(start.content).includes("javascript:"), false, "unsafe Markdown links are stripped by the server sanitizer");

    const grant = await owner.request(`${base}/pages/${start.id}/grants`, "PUT", { inherits: false, grants: [{ principalType: "user", principalId: readerIdentity.userId, role: "viewer" }], confirmSelfLockout: true });
    assert.equal(grant.status, 200);
    const denied = await outsider.request(`${base}/pages/${start.id}/export-markdown`);
    assert.equal(denied.status, 404);
    const exported = await reader.request(`${base}/pages/${start.id}/export-markdown`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-type") ?? "", /^text\/markdown/);
    assert.match(exported.data, /^<!-- pages:page-title -->\n# Welcome\n\n# Welcome/);
    assert.match(exported.data, /\*\*safe\*\*/);
    assert.match(exported.data, /\| Topic \| Owner \|/);
    assert.doesNotMatch(exported.data, /javascript:/);

    await context.test("Markdown export preserves native and array-form table cell text", async () => {
      const createdPage = await owner.request(`${base}/pages`, "POST", { title: "Table export" });
      const cells = [
        { type: "tableCell", content: [{ type: "text", text: "Native cell", styles: {} }] },
        [{ type: "text", text: "Array cell ", styles: {} }, { type: "link", href: "https://example.test/cell", content: [{ type: "text", text: "link", styles: {} }] }],
      ];
      assert.equal((await owner.request(`${base}/pages/${createdPage.data.id}/content`, "PUT", { baseRevision: 1, content: [{ type: "table", content: { rows: [{ cells }] } }] })).status, 200);
      const tableExport = await owner.request(`${base}/pages/${createdPage.data.id}/export-markdown`);
      assert.equal(tableExport.status, 200);
      assert.match(tableExport.data, /Native cell/);
      assert.match(tableExport.data, /Array cell \[link\]\(https:\/\/example\.test\/cell\)/);
    });

    const unsafePath = await owner.request(`${base}/pages/import-markdown`, "POST", { spaceId, files: [{ path: "../escape.md", content: "No" }] });
    assert.equal(unsafePath.status, 400);
    assert.equal(await initialCount(), 5);

    await context.test("Markdown import uses marked title, then first H1, then filename without changing body content", async () => {
      const importedTitles = await owner.request(`${base}/pages/import-markdown`, "POST", { spaceId: null, files: [
        { path: "Marked filename.md", content: "<!-- pages:page-title -->\n# Exported \\*title\\*\n\n## Body heading\n\nBody text." },
        { path: "Legacy export.md", content: "<!-- team-wiki:page-title -->\n# Previous export\n\nLegacy body text." },
        { path: "Heading fallback.md", content: "Intro text\n\n# First heading\n\n## Another heading" },
        { path: "Filename fallback.md", content: "## Only a second-level heading\n\nBody text." },
      ] });
      assert.equal(importedTitles.status, 200, JSON.stringify(importedTitles.data));
      const pagesByPath = new Map<string, { path: string; id: string; title: string }>(importedTitles.data.pages.map((page: { path: string; id: string; title: string }) => [page.path, page]));
      assert.equal(pagesByPath.get("Marked filename.md")?.title, "Exported *title*");
      assert.equal(pagesByPath.get("Legacy export.md")?.title, "Previous export");
      const legacyPage = await owner.request(`${base}/pages/${pagesByPath.get("Legacy export.md")?.id}`);
      assert.deepEqual(legacyPage.data.page.content.map((block: any) => block.type), ["paragraph"]);
      assert.equal(legacyPage.data.page.content[0].content[0].text, "Legacy body text.");
      assert.equal(pagesByPath.get("Heading fallback.md")?.title, "First heading");
      assert.equal(pagesByPath.get("Filename fallback.md")?.title, "Filename fallback");
      const markedPage = await owner.request(`${base}/pages/${pagesByPath.get("Marked filename.md")?.id}`);
      assert.deepEqual(markedPage.data.page.content.map((block: any) => block.type), ["heading", "paragraph"]);
      assert.equal(markedPage.data.page.content[0].content[0].text, "Body heading");
      const headingPage = await owner.request(`${base}/pages/${pagesByPath.get("Heading fallback.md")?.id}`);
      assert.deepEqual(headingPage.data.page.content.map((block: any) => block.type), ["paragraph", "heading", "heading"]);
      assert.equal(headingPage.data.page.content[1].content[0].text, "First heading", "an unmarked title heading remains in the body");
    });

    await context.test("normalized Markdown import/export/reimport preserves supported blocks, formatting and links", async () => {
      const source = [
        "## Getting started", "A **bold** and *italic* and ~~removed~~ word with `code`.",
        "An [external link](https://example.test/guide) and [internal link](/p/unknown-page).",
        "Literal \\\\ paths, \\*stars\\*, \\_underscores\\_, \\[brackets\\], and **bold \\*literal\\***.",
        "A [versioned link](https://example.test/guide_(v1\\)) and `C:\\Team`.",
        "- First item\n- Second item", "1. Numbered item\n2. Next item", "- [x] Done\n- [ ] Pending",
        "> Quoted text", "```ts\nconst answer = 42;\n```", "| Topic | Owner |\n| --- | --- |\n| Safety \\| Team | **People** |",
        "![Team \\[photo\\]!](https://example.test/team_(v1\\).png)",
      ].join("\n\n");
      async function importPage(content: string) {
        const imported = await owner.request(`${base}/pages/import-markdown`, "POST", { spaceId: null, files: [{ path: "Roundtrip.md", content }] });
        assert.equal(imported.status, 200, JSON.stringify(imported.data));
        return imported.data.pages[0].id as string;
      }
      function withoutIds(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(withoutIds);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "id").map(([key, child]) => [key, withoutIds(child)]));
        return value;
      }
      const firstId = await importPage(source);
      const first = await owner.request(`${base}/pages/${firstId}`);
      assert.equal(first.status, 200);
      assert.deepEqual(new Set(first.data.page.content.map((block: any) => block.type)), new Set(["heading", "paragraph", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock", "table", "image"]));
      assert.deepEqual(first.data.page.content[3].content, [
        { type: "text", text: "Literal \\ paths, *stars*, _underscores_, [brackets], and ", styles: {} },
        { type: "text", text: "bold *literal*", styles: { bold: true } },
        { type: "text", text: ".", styles: {} },
      ]);
      assert.ok(first.data.page.content[4].content.some((part: any) => part.href === "https://example.test/guide_(v1)"));
      assert.equal(first.data.page.content.find((block: any) => block.type === "image").props.caption, "Team [photo]!");
      const exported = await owner.request(`${base}/pages/${firstId}/export-markdown`);
      assert.equal(exported.status, 200);
      const secondId = await importPage(exported.data);
      const second = await owner.request(`${base}/pages/${secondId}`);
      assert.equal(second.status, 200);
      assert.equal(second.data.page.title, "Roundtrip", "the exported title marker sets the imported page title");
      assert.deepEqual(withoutIds(second.data.page.content), withoutIds(first.data.page.content), "the generated title wrapper is not imported as user content");
      const reexported = await owner.request(`${base}/pages/${secondId}/export-markdown`);
      assert.equal(reexported.status, 200);
      assert.equal(reexported.data, exported.data);
      let nextExport = reexported.data;
      for (let cycle = 0; cycle < 3; cycle++) {
        const nextId = await importPage(nextExport);
        assert.deepEqual(withoutIds((await owner.request(`${base}/pages/${nextId}`)).data.page.content), withoutIds(first.data.page.content));
        const next = await owner.request(`${base}/pages/${nextId}/export-markdown`);
        assert.equal(next.status, 200);
        assert.equal(next.data, exported.data);
        nextExport = next.data;
      }
      assert.equal((await owner.request(`${base}/pages/${firstId}`, "PATCH", { title: "First line\r\n# Second line\nThird line\rFourth line\u2028Fifth line\u2029Last line" })).status, 200);
      const multiline = await owner.request(`${base}/pages/${firstId}/export-markdown`);
      assert.equal(multiline.status, 200);
      assert.match(multiline.data, /^<!-- pages:page-title -->\n# First line \\# Second line Third line Fourth line Fifth line Last line\n\n/);
      nextExport = multiline.data;
      for (let cycle = 0; cycle < 3; cycle++) {
        const nextId = await importPage(nextExport);
        assert.deepEqual(withoutIds((await owner.request(`${base}/pages/${nextId}`)).data.page.content), withoutIds(first.data.page.content), "multiline title wrappers never become body content, including images and tables");
        const next = await owner.request(`${base}/pages/${nextId}/export-markdown`);
        assert.equal(next.status, 200);
        nextExport = next.data;
      }
      const intentional = await importPage("# Roundtrip\n\n# Roundtrip\n\n## User heading");
      const intentionalPage = (await owner.request(`${base}/pages/${intentional}`)).data.page;
      const intentionalCopy = await importPage((await owner.request(`${base}/pages/${intentional}/export-markdown`)).data);
      assert.deepEqual(withoutIds((await owner.request(`${base}/pages/${intentionalCopy}`)).data.page.content), withoutIds(intentionalPage.content), "unmarked user headings, even matching the page title, are retained");
    });
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
