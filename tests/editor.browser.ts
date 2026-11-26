import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/database.ts";
import { memberships } from "../server/schema.ts";

for (const replyInput of ["keyboard", "touch"]) test(`mobile tables and native comment mentions (${replyInput} reply)`, { timeout: 120_000 }, async () => {
  const { chromium, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
  const primaryViewport = process.env.PAGES_TEST_DEVICE === "android" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const store = await openDatabase("memory://");
  let app: ReturnType<typeof createApp>;
  let origin = "";
  const server = await createServer({
    configFile: false, plugins: [react(), { name: "editor-regression-api", configureServer(vite) {
      vite.middlewares.use((incoming, outgoing, next) => {
        if (!incoming.url?.startsWith("/api/")) return next();
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          const response = await app.handle(new Request(new URL(incoming.url!, origin), { method: incoming.method, headers, body: ["GET", "HEAD"].includes(incoming.method!) ? undefined : Buffer.concat(chunks) }), incoming.socket.remoteAddress ?? "browser");
          outgoing.statusCode = response.status;
          for (const [name, value] of response.headers) if (name !== "set-cookie") outgoing.setHeader(name, value);
          const cookies = response.headers.getSetCookie();
          if (cookies.length) outgoing.setHeader("set-cookie", cookies);
          outgoing.end(Buffer.from(await response.arrayBuffer()));
        })().catch(error => { outgoing.statusCode = 500; outgoing.end(JSON.stringify({ message: String(error) })); });
      });
    } }],
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  let browser: any;
  try {
    await server.listen();
    origin = server.resolvedUrls!.local[0].replace(/\/$/, "");
    app = createApp({ db: store.db, origin, secret: "browser-test-secret-only-4b8c94b68da4933a43b0fd0ef33487de", environment: "test", mailProvider: { kind: "test", async send() {} } });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
    const context = await browser.newContext({ ...(process.env.PAGES_TEST_DEVICE === "android" ? devices["Pixel 7"] : {}), viewport: primaryViewport, hasTouch: true });
    const request = async (path: string, method = "GET", data?: unknown) => {
      const response = await context.request.fetch(origin + path, { method, data, headers: { origin } });
      const result = await response.json();
      assert.ok(response.ok(), JSON.stringify(result));
      return result;
    };
    await request("/api/register", "POST", { name: "Comment author", email: "inline@example.test", password: "A long unique browser test password 42!", companyName: "Comment workspace" });
    const identity = await request("/api/me"), companyId = identity.companies[0].companyId, userId = identity.user.id;
    const base = `/api/companies/${companyId}/pages`;
    const { id: pageId } = await request(base, "POST", { title: "Onboarding Guide" });
    const teammate = await browser.newContext();
    const teammateRegistration = await teammate.request.post(`${origin}/api/register`, { headers: { origin }, data: { name: "QA Reviewer", email: "qa-reviewer@example.test", password: "A long unique browser test password 42!", companyName: "QA workspace" } });
    assert.ok(teammateRegistration.ok());
    const teammateIdentity = await (await teammate.request.get(`${origin}/api/me`)).json();
    await store.db.insert(memberships).values({ companyId, userId: teammateIdentity.user.id, role: "editor" });
    await request(`${base}/${pageId}/grants`, "PUT", { inherits: false, grants: [
      { principalType: "user", principalId: userId, role: "editor" },
      { principalType: "user", principalId: teammateIdentity.user.id, role: "commenter" },
    ] });
    const sourceText = "Read policy and read policy again.";
    const tableRows = [
      { cells: ["First column with long content", "Second column with long content", "Third column with long content"].map(text => ({ type: "tableCell", props: {}, content: [{ type: "text", text, styles: {} }] })) },
      { cells: ["First row value", "Second row value", "Third row value"].map(text => ({ type: "tableCell", props: {}, content: [{ type: "text", text, styles: {} }] })) },
    ];
    await request(`${base}/${pageId}/content`, "PUT", { baseRevision: 1, content: [
      { id: "selected", type: "paragraph", content: [{ type: "text", text: sourceText, styles: {} }] },
      { id: "wide-table", type: "table", props: {}, content: { type: "tableContent", rows: tableRows } },
    ] });
    const page = await context.newPage();
    const togglePanel = async () => {
      const desktop = page.getByRole("button", { name: "Discussion & history", exact: true });
      if (await desktop.isVisible()) await desktop.click();
      else {
        await page.getByRole("button", { name: "Page actions", exact: true }).click();
        await page.getByRole("menuitem", { name: "Discussion & history", exact: true }).click();
      }
    };
    const discardDialogs: string[] = [];
    page.on("dialog", (dialog: { message(): string; dismiss(): Promise<void> }) => { discardDialogs.push(dialog.message()); void dialog.dismiss(); });
    const failures: string[] = [];
    page.on("pageerror", (error: Error) => failures.push(error.message));
    const url = `${origin}/tests/fixtures/editor.html?company=${companyId}&page=${pageId}&user=${userId}&admin=1`;
    await page.goto(url);
    const editor = page.locator('[aria-label="Page content"] .tiptap').first();
    await editor.waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Page content"] .tiptap')?.getAttribute("contenteditable") === "true");
    const assertTableContained = async (target: any, selector: string) => {
      const metrics = await target.evaluate((tableSelector: string) => {
        const table = document.querySelector(tableSelector);
        const wrapper = table?.closest(".tableWrapper, .table-wrap") as HTMLElement | null;
        return { documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth, wrapperWidth: wrapper?.clientWidth ?? 0, tableWidth: table?.scrollWidth ?? 0 };
      }, selector);
      assert.equal(metrics.documentWidth, 390, `document width must match the mobile viewport: ${JSON.stringify(metrics)}`);
      assert.equal(metrics.viewportWidth, 390);
      assert.ok(metrics.tableWidth > metrics.wrapperWidth, `table must scroll inside its wrapper: ${JSON.stringify(metrics)}`);
    };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[aria-label="Page content"] .tableWrapper table').waitFor();
    await assertTableContained(page, '[aria-label="Page content"] .tableWrapper table');
    await page.setViewportSize(primaryViewport);
    const select = async (needle: string, occurrence = 0, target = page, editable = true) => {
      if (editable) await target.waitForFunction(() => document.querySelector('[aria-label="Page content"] .tiptap')?.getAttribute("contenteditable") === "true");
      await target.locator('[aria-label="Page content"] .tiptap').first().evaluate((element: HTMLElement, input: { needle: string; occurrence: number }) => {
        element.focus();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let textNode: Node | null, remaining = input.occurrence;
        while ((textNode = walker.nextNode())) {
          const text = textNode.textContent ?? "";
          for (let offset = text.indexOf(input.needle); offset >= 0; offset = text.indexOf(input.needle, offset + 1)) {
            if (remaining-- > 0) continue;
            const range = document.createRange(); range.setStart(textNode, offset); range.setEnd(textNode, offset + input.needle.length);
            const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
            document.dispatchEvent(new Event("selectionchange"));
            return;
          }
        }
        throw new Error("Selected text not found");
      }, { needle, occurrence });
      await target.waitForTimeout(100);
    };
    await page.setViewportSize({ width: 390, height: 844 });
    await select("policy");
    await page.getByRole("button", { name: "Add comment", exact: true }).click();
    const composer = page.locator(".bn-thread .tiptap, .bn-comment-editor .tiptap, .bn-floating-composer .tiptap").last();
    await composer.fill("@QA");
    const inlineSuggestion = page.getByRole("option", { name: /QA Reviewer qa-reviewer@example\.test/ });
    await inlineSuggestion.waitFor();
    const inlinePopup = await page.locator(".pw-inline-mention-options").boundingBox();
    assert.ok(inlinePopup && inlinePopup.x >= 0 && inlinePopup.x + inlinePopup.width <= 390);
    await composer.press("Enter");
    assert.match(await composer.innerText(), /@qa-reviewer@example\.test/);
    assert.equal((await request(`${base}/${pageId}/comments`)).threads.length, 0, "Enter selects the suggestion without submitting the comment");
    await composer.press("Enter");
    await page.locator(".pw-thread").filter({ hasText: "@qa-reviewer@example.test" }).waitFor();
    await page.locator(".bn-thread-mark").filter({ hasText: "policy" }).first().waitFor();
    const thread = (await request(`${base}/${pageId}/comments`)).threads.find((item: any) => item.kind === "inline");
    assert.ok(thread);
    assert.equal(thread.messages[0].body, "@qa-reviewer@example.test");
    assert.deepEqual(thread.messages[0].mentions.map((mention: any) => mention.userId), [teammateIdentity.user.id]);
    const teammateNotifications = async () => {
      const response = await teammate.request.get(`${origin}/api/companies/${companyId}/notifications`);
      assert.ok(response.ok());
      return (await response.json()).notifications;
    };
    assert.ok((await teammateNotifications()).some((item: any) => item.kind === "mention" && item.pageId === pageId && item.threadId === thread.id));

    await page.locator(".bn-thread-mark").filter({ hasText: "policy" }).first().click();
    const replyComposer = page.locator(".bn-thread-composer .bn-comment-editor .tiptap").last();
    await replyComposer.waitFor();
    await replyComposer.fill("Reply @QA");
    await page.getByRole("option", { name: /QA Reviewer qa-reviewer@example\.test/ }).waitFor();
    if (replyInput === "touch") await page.getByRole("option", { name: /QA Reviewer qa-reviewer@example\.test/ }).tap();
    else await replyComposer.press("Tab");
    assert.deepEqual(discardDialogs, [], "choosing a reply recipient preserves the draft");
    assert.match(await replyComposer.innerText(), /Reply @qa-reviewer@example\.test/);
    assert.equal((await request(`${base}/${pageId}/comments`)).threads.find((item: any) => item.id === thread.id).messages.length, 1, "Tab selects the reply suggestion without submitting");
    await replyComposer.press("Enter");
    await page.locator(".pw-thread").filter({ hasText: "Reply @qa-reviewer@example.test" }).waitFor();
    const repliedThread = (await request(`${base}/${pageId}/comments`)).threads.find((item: any) => item.id === thread.id);
    assert.equal(repliedThread.messages[1].body, "Reply @qa-reviewer@example.test");
    assert.deepEqual(repliedThread.messages[1].mentions.map((mention: any) => mention.userId), [teammateIdentity.user.id]);
    assert.ok((await teammateNotifications()).filter((item: any) => item.kind === "mention" && item.pageId === pageId && item.threadId === thread.id).length >= 2);

    await select("again");
    await page.getByRole("button", { name: "Add comment", exact: true }).click();
    const touchComposer = page.locator(".bn-thread .tiptap, .bn-comment-editor .tiptap, .bn-floating-composer .tiptap").last();
    await touchComposer.fill("Click @QA");
    const touchSuggestion = page.getByRole("option", { name: /QA Reviewer qa-reviewer@example\.test/ });
    await touchSuggestion.waitFor();
    await touchSuggestion.click();
    assert.deepEqual(discardDialogs, [], "clicking a suggestion must not trigger discard confirmation");
    assert.match(await touchComposer.innerText(), /Click @qa-reviewer@example\.test/);
    await touchComposer.type(" touch @QA");
    await page.getByRole("option", { name: /QA Reviewer qa-reviewer@example\.test/ }).waitFor();
    const suggestionBounds = await touchSuggestion.boundingBox();
    assert.ok(suggestionBounds);
    await touchSuggestion.tap();
    assert.deepEqual(discardDialogs, [], "tapping a suggestion must not trigger discard confirmation");
    assert.match(await touchComposer.innerText(), /Click @qa-reviewer@example\.test touch @qa-reviewer@example\.test/);
    await touchComposer.press("Enter");
    await page.locator(".pw-thread").filter({ hasText: "Click @qa-reviewer@example.test touch @qa-reviewer@example.test" }).waitFor();
    await page.setViewportSize(primaryViewport);
    const waitSaved = async (needle: string) => {
      await page.waitForFunction(async ({ path, needle }: { path: string; needle: string }) => {
        const value = await (await fetch(path)).json();
        return JSON.stringify(value.page.content).includes(needle);
      }, { path: `${base}/${pageId}`, needle });
      await page.getByText("Saved", { exact: true }).waitFor();
    };
    await waitSaved("commentRanges");
    await select("policy");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.insertText(" updated");
    await waitSaved("p updatedolicy");
    await page.reload();
    await page.locator(".bn-thread-mark").filter({ hasText: "p updatedolicy" }).waitFor();
    const edited = (await request(`${base}/${pageId}`)).page.revision;
    await select("p updatedolicy");
    await page.keyboard.press("Backspace");
    await waitSaved("Read  and read policy again.");
    await togglePanel();
    await page.getByText("Detached — text no longer appears on this page", { exact: true }).waitFor();
    assert.equal((await request(`${base}/${pageId}/comments`)).threads.find((item: any) => item.id === thread.id).anchorStatus, "detached");
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await page.locator(".pw-panel-list li").filter({ hasText: `Revision ${edited}` }).getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByRole("button", { name: "Restore this version", exact: true }).click();
    await page.locator('[aria-label="Page content"] .bn-thread-mark').filter({ hasText: "p updatedolicy" }).waitFor();
    await page.reload();
    await page.locator('[aria-label="Page content"] .bn-thread-mark').filter({ hasText: "p updatedolicy" }).waitFor();
    assert.equal((await request(`${base}/${pageId}/comments`)).threads.find((item: any) => item.id === thread.id).anchorStatus, "attached");
    assert.ok((await request(`${base}/${pageId}`)).page.revision > edited);
    await togglePanel();
    await page.setViewportSize({ width: 390, height: 844 });
    const panelComposer = page.getByRole("textbox", { name: "Add a comment" });
    await panelComposer.fill("Page-level @qa");
    const panelSuggestion = page.getByRole("option", { name: /QA Reviewer qa-reviewer@example\.test/ });
    await panelSuggestion.waitFor();
    const panelPopup = await page.locator(".pw-mention-options").boundingBox();
    assert.ok(panelPopup && panelPopup.x >= 0 && panelPopup.x + panelPopup.width <= 390);
    const initialPlacement = await page.evaluate(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[aria-label="Add a comment"]')!.getBoundingClientRect();
      const popup = document.querySelector<HTMLElement>(".pw-mention-options")!.getBoundingClientRect();
      const viewport = window.visualViewport;
      return { textareaTop: textarea.top, textareaBottom: textarea.bottom, popupTop: popup.top, popupBottom: popup.bottom, visibleTop: viewport?.offsetTop ?? 0, visibleBottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) };
    });
    assert.ok(initialPlacement.popupTop >= initialPlacement.visibleTop);
    assert.ok(initialPlacement.popupBottom <= initialPlacement.visibleBottom);
    assert.ok(initialPlacement.popupTop >= initialPlacement.textareaBottom || initialPlacement.popupBottom <= initialPlacement.textareaTop);
    await page.setViewportSize({ width: 390, height: 420 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => {
      const popup = document.querySelector<HTMLElement>(".pw-mention-options")?.getBoundingClientRect();
      const viewport = window.visualViewport;
      return Boolean(window.innerHeight === 420 && Math.abs((viewport?.height ?? 420)-420) < 1 && popup && popup.top >= (viewport?.offsetTop ?? 0) && popup.bottom <= (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight));
    });
    const keyboardPlacement = await page.evaluate(() => {
      const popup = document.querySelector<HTMLElement>(".pw-mention-options")!.getBoundingClientRect();
      const viewport = window.visualViewport;
      return { top: popup.top, bottom: popup.bottom, visibleTop: viewport?.offsetTop ?? 0, visibleBottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) };
    });
    assert.ok(keyboardPlacement.top >= keyboardPlacement.visibleTop);
    assert.ok(keyboardPlacement.bottom <= keyboardPlacement.visibleBottom);
    await panelComposer.press("Enter");
    assert.match(await panelComposer.inputValue(), /@qa-reviewer@example\.test/);
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await page.locator(".pw-thread").filter({ hasText: "Page-level @qa-reviewer@example.test" }).waitFor();
    await page.setViewportSize(primaryViewport);
    const commenter = await browser.newContext();
    const register = await commenter.request.post(`${origin}/api/register`, { headers: { origin }, data: { name: "Commenter", email: "commenter@example.test", password: "A long unique browser test password 42!", companyName: "Other workspace" } });
    assert.ok(register.ok());
    const commenterIdentity = await (await commenter.request.get(`${origin}/api/me`)).json();
    await store.db.insert(memberships).values({ companyId, userId: commenterIdentity.user.id, role: "editor" });
    await request(`${base}/${pageId}/grants`, "PUT", { inherits: false, grants: [{ principalType: "user", principalId: userId, role: "editor" }, { principalType: "user", principalId: commenterIdentity.user.id, role: "commenter" }] });
    const readonlyPage = await commenter.newPage();
    await readonlyPage.goto(`${origin}/tests/fixtures/editor.html?company=${companyId}&page=${pageId}&user=${commenterIdentity.user.id}`);
    await readonlyPage.waitForFunction(() => document.querySelector('[aria-label="Page content"] .tiptap')?.getAttribute("contenteditable") === "false");
    await readonlyPage.setViewportSize({ width: 390, height: 844 });
    await readonlyPage.locator('[aria-label="Page content"] .tableWrapper table').waitFor();
    await assertTableContained(readonlyPage, '[aria-label="Page content"] .tableWrapper table');
    await readonlyPage.setViewportSize({ width: 1440, height: 900 });
    assert.equal(await readonlyPage.locator('[aria-label="Page content"] .tiptap[contenteditable="true"]').count(), 0);
    const beforeComment = (await request(`${base}/${pageId}`)).page.revision;
    await select("policy", 0, readonlyPage, false);
    await readonlyPage.getByRole("button", { name: "Add comment", exact: true }).click();
    const readonlyComposer = readonlyPage.locator(".bn-thread .tiptap").last();
    await readonlyComposer.fill("Commenter can annotate without editing");
    await readonlyComposer.press("Enter");
    await readonlyPage.locator(".pw-thread").filter({ hasText: "Commenter can annotate without editing" }).waitFor();
    assert.equal((await request(`${base}/${pageId}`)).page.revision, beforeComment);
    await request(`${base}/${pageId}/grants`, "PUT", { inherits: false, grants: [{ principalType: "user", principalId: userId, role: "editor" }, { principalType: "user", principalId: commenterIdentity.user.id, role: "viewer" }] });
    await readonlyPage.reload();
    await readonlyPage.locator('[aria-label="Page content"] .bn-thread-mark').first().waitFor();
    await select("policy", 0, readonlyPage, false);
    assert.equal(await readonlyPage.getByRole("button", { name: "Add comment", exact: true }).count(), 0);
    const publication = await request(`${base}/${pageId}/public-snapshot`, "POST", {});
    const snapshotResponse = await app.handle(new Request(publication.url));
    assert.equal(snapshotResponse.status, 200);
    const publicPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await publicPage.setContent(await snapshotResponse.text());
    await publicPage.locator(".table-wrap table").waitFor();
    await assertTableContained(publicPage, ".table-wrap table");
    await page.goto(url);
    await page.locator('[aria-label="Page content"] .bn-thread-mark').first().click();
    const protectedReply = page.locator('.bn-thread-composer .bn-comment-editor [contenteditable="true"]').last();
    await protectedReply.fill("Keep this unsaved reply");
    await page.getByRole("textbox", { name: "Page title", exact: true }).click();
    assert.deepEqual(discardDialogs, ["Are you sure you want to discard this comment?"], "a real outside click still protects the draft");
    assert.equal(await protectedReply.innerText(), "Keep this unsaved reply");
    assert.deepEqual(failures, []);
  } finally {
    await browser?.close(); await server.close(); await store.close();
  }
});
