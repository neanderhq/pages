import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import { addPageTag, pageHeadings } from "../src/pageToolsModel.ts";
import type { Block } from "../src/pagesApi.ts";
import { collabApi } from "../src/collabApi.ts";

const heading = (id: string, text: string, level: number, children: Block[] = []): Block => ({ id, type: "heading", props: { level }, content: [{ type: "text", text }], children });

test("table of contents walks nested headings in document order, preserving duplicate and empty headings by block ID", () => {
  const document = [heading("first", "Overview", 1, [{ id: "list", type: "bulletListItem", children: [heading("nested", "Overview", 3)] }]), heading("empty", " ", 2),
    { id: "link", type: "heading", props: { level: 2 }, content: [{ type: "link", content: [{ type: "text", text: "Linked heading" }] }] }];
  assert.deepEqual(pageHeadings(document), [
    { id: "first", text: "Overview", level: 1 }, { id: "nested", text: "Overview", level: 3 },
    { id: "empty", text: "Untitled heading", level: 2 }, { id: "link", text: "Linked heading", level: 2 },
  ]);
  assert.deepEqual(pageHeadings([]), []);
});

test("table of contents replaces removed headings after edits, restore or conflict replacement", () => {
  const original = [heading("old", "Original", 1)];
  const edited = [heading("new", "Renamed", 2)];
  assert.equal(pageHeadings(edited)[0].id, "new");
  assert.deepEqual(pageHeadings(original), [{ id: "old", text: "Original", level: 1 }]);
  assert.deepEqual(pageHeadings([{ id: "paragraph", type: "paragraph", content: [] }]), []);
});

test("tag drafts normalize, deduplicate and enforce server limits without dropping existing tags", () => {
  const initial = addPageTag([], "  Release   notes  ");
  assert.deepEqual(initial, ["release notes"]);
  assert.strictEqual(addPageTag(initial, "RELEASE NOTES"), initial);
  assert.deepEqual(addPageTag(initial, "\u0000Ready"), ["ready", "release notes"]);
  assert.deepEqual(addPageTag([], "Ops\twork"), ["opswork"]);
  assert.throws(() => addPageTag(initial, " "), /1–40/);
  assert.throws(() => addPageTag(initial, "x".repeat(41)), /1–40/);
  assert.equal(addPageTag([], "x".repeat(40))[0].length, 40);
  const full = Array.from({ length: 20 }, (_, index) => `tag-${index}`);
  assert.throws(() => addPageTag(full, "extra"), /20 tags/);
  assert.strictEqual(addPageTag(full, "tag-0"), full);
  const removed = full.filter(tag => tag !== "tag-0");
  assert.equal(addPageTag(removed, "replacement").length, 20);
});

test("rendered table of contents has accessible navigation, level indentation and exact block jump actions", async () => {
  const source = new URL("../src/PageOutline.tsx", import.meta.url);
  const compiled = await transformWithOxc(readFileSync(source, "utf8"), fileURLToPath(source), { jsx: { runtime: "automatic" } });
  const temporaryRoot = new URL("../.tmp/", import.meta.url);
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(new URL("page-tools-", temporaryRoot)));
  try {
    const destination = join(directory, "PageOutline.mjs");
    await writeFile(destination, compiled.code);
    const { PageOutline } = await import(pathToFileURL(destination).href) as typeof import("../src/PageOutline.tsx");
    const headings = pageHeadings([heading("first", "Same title", 1), heading("nested", "Same title", 3), heading("empty", "", 2)]);
    let selected = "";
    const onJump = (id: string) => { selected = id; };
    const markup = renderToStaticMarkup(createElement(PageOutline, { headings, onJump }));
    assert.match(markup, /aria-label="Table of contents"/);
    assert.match(markup, /padding-inline-start:24px/);
    assert.match(markup, /Untitled heading/);
    assert.equal((markup.match(/Same title/g) ?? []).length, 2);
    const outline = PageOutline({ headings, onJump });
    const list = outline.props.children[1];
    list.props.children[1].props.children.props.onClick();
    assert.equal(selected, "nested");
    const restored = renderToStaticMarkup(createElement(PageOutline, { headings: pageHeadings([heading("restored", "Restored section", 2)]), onJump }));
    assert.match(restored, /Restored section/);
    assert.doesNotMatch(restored, /Same title/);
    assert.match(renderToStaticMarkup(createElement(PageOutline, { headings: [], onJump })), /Add headings/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("page tool clients send template destinations, backlink navigation IDs and normalized tag replacements", async () => {
  const source = new URL("../src/pagesApi.ts", import.meta.url);
  const compiled = await transformWithOxc(readFileSync(source, "utf8"), fileURLToPath(source));
  const temporaryRoot = new URL("../.tmp/", import.meta.url);
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(new URL("page-tool-clients-", temporaryRoot)));
  const originalFetch = globalThis.fetch;
  const requests: { path: string; method: string; body: any; credentials: RequestCredentials | undefined }[] = [];
  const templates = [
    { id: "handbook", name: "Handbook", title: "Team handbook", description: "Team overview" },
    { id: "sop", name: "SOP", title: "Standard operating procedure", description: "Steps and checks" },
    { id: "meeting-notes", name: "Meeting notes", title: "Meeting notes", description: "Agenda and decisions" },
  ];
  globalThis.fetch = (async (path, options) => {
    const requestPath = String(path);
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    requests.push({ path: requestPath, method: options?.method ?? "GET", body, credentials: options?.credentials });
    const response = requestPath.endsWith("/templates") ? { templates }
      : requestPath.endsWith("/backlinks") ? { pages: [{ id: "source-page", title: "Source page", slug: "source", spaceId: null }] }
      : options?.method === "PUT" ? { tags: body.tags }
      : requestPath.endsWith("/tags") ? { tags: ["release notes"] }
      : { id: "created", slug: "created" };
    return Response.json(response);
  }) as typeof fetch;
  try {
    const destination = join(directory, "pagesApi.mjs");
    await writeFile(destination, compiled.code.replace('"./api"', JSON.stringify(new URL("../src/api.ts", import.meta.url).href)));
    const { pagesApi } = await import(pathToFileURL(destination).href) as typeof import("../src/pagesApi.ts");
    const client = pagesApi("company / one"), collab = collabApi("company / one");
    assert.deepEqual((await client.templates()).templates.map(template => template.name), ["Handbook", "SOP", "Meeting notes"]);
    for (const template of templates) {
      await client.create({ templateId: template.id, parentId: "editable-parent", spaceId: "destination-space" });
      assert.deepEqual(requests.at(-1)?.body, { templateId: template.id, parentId: "editable-parent", spaceId: "destination-space" });
    }
    await client.page("../auth/sign-out?role=admin#fragment");
    assert.match(requests.at(-1)!.path, /pages\/\.\.%2Fauth%2Fsign-out%3Frole%3Dadmin%23fragment$/);
    const beforeInvalidId = requests.length;
    assert.throws(() => client.page(".."), /Invalid resource identifier/);
    assert.throws(() => client.page("."), /Invalid resource identifier/);
    assert.throws(() => collabApi("..").comments("page"), /Invalid resource identifier/);
    assert.equal(requests.length, beforeInvalidId, "dot segments never become authenticated requests");
    const backlinks = await collab.backlinks("target / page");
    assert.equal(backlinks.pages[0].id, "source-page");
    assert.match(requests.at(-1)!.path, /pages\/target%20%2F%20page\/backlinks$/);
    assert.deepEqual((await collab.updateTags("created", addPageTag([], " Release   Notes "))).tags, ["release notes"]);
    assert.equal(requests.at(-1)?.method, "PUT");
    assert.deepEqual((await collab.pageTags("created")).tags, ["release notes"]);
    await collab.updateTags("created", []);
    assert.deepEqual(requests.at(-1)?.body, { tags: [] });
    await collab.tags();
    assert.match(requests.at(-1)!.path, /company%20%2F%20one\/tags$/);
    assert.ok(requests.every(request => request.credentials === "same-origin"));
  } finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); }
});
