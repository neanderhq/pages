import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/database.ts";
import * as schema from "../server/schema.ts";
import { resolveAnchor } from "../server/anchors.ts";
import type { Mail } from "../server/mail.ts";
import { BlockNoteEditor } from "@blocknote/core";
import { CommentsExtension } from "@blocknote/core/comments";
import { CommentAuth, commentSchema, ServerThreadStore } from "../src/commentStore.ts";
import { captureCommentSelection, documentWithAnchors, hydrateAnchors, selectedAnchor } from "../src/editorAnchors.ts";
import { insertMentionToken, isInsideMentionPickerOrComposer, mentionPopoverPlacement, mentionQueryAt, mentionSuggestionKeyDisposition, type CollabApi } from "../src/collabApi.ts";

const origin = "http://127.0.0.1:5173";
const password = "A long unique test password 42!";
const secret = "test-secret-only-4b8c94b68da4933a43b0fd0ef33487de";
const paragraph = (id: string, text: string) => ({ id, type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text, styles: {} }], children: [] });

test("anchors: attached in place, moved to another block, detached when the text is gone", () => {
  const anchor = { blockId: "b1", quote: "14 days", prefix: "within ", suffix: " of" };
  assert.deepEqual(resolveAnchor([paragraph("b1", "Refunds within 14 days of request.")], anchor), { status: "attached", blockId: "b1" });
  assert.deepEqual(resolveAnchor([paragraph("b1", "Intro"), paragraph("b2", "Paid within 14 days of request.")], anchor), { status: "attached", blockId: "b2" });
  // Two candidates: the one whose surrounding text matches the saved context wins.
  const both = [paragraph("x", "Delivery in 14 days, sometimes."), paragraph("y", "Refunds within 14 days of request.")];
  assert.deepEqual(resolveAnchor(both, anchor), { status: "attached", blockId: "y" });
  assert.deepEqual(resolveAnchor([paragraph("b1", "Refunds are quick.")], anchor), { status: "detached", blockId: "b1" });
});

test("inline-comments: native position mapping keeps a pending composer selection through edits and cursor movement", () => {
  const editor = BlockNoteEditor.create({ initialContent: [paragraph("pending", "Read policy and read policy again.")] });
  editor._tiptapEditor.commands.setTextSelection({ from: 24, to: 30 });
  assert.equal(selectedAnchor(editor).from, 21, "the second occurrence has its own exact range");
  editor._tiptapEditor.commands.setTextSelection({ from: 8, to: 14 });
  const selection = captureCommentSelection(editor);
  editor.transact(transaction => transaction.insertText("Please ", 3));
  editor._tiptapEditor.commands.setTextSelection(3);
  assert.equal(selection.anchor().quote, "policy");
  assert.equal(selection.anchor().from, 12);
  const range = selection.range();
  editor.transact(transaction => transaction.insertText(" updated", range.from + 1));
  assert.equal(selection.anchor().quote, "p updatedolicy");
  editor.transact(transaction => transaction.delete(selection.range().from, selection.range().to));
  assert.throws(() => selection.anchor(), /Select up to 500/);
});

test("mentions: autocomplete replaces the active query with the existing email token", () => {
  assert.deepEqual(mentionQueryAt("Hi @ali, welcome", 7), { start: 3, end: 7, query: "ali" });
  assert.deepEqual(insertMentionToken("Hi @ali, welcome", 7, "alice@example.test"), { value: "Hi @alice@example.test, welcome", caret: 22 });
  assert.equal(mentionQueryAt("word@ali", 8), null);
  assert.equal(mentionQueryAt("Hi @ali there", 8), null);
});

test("mentions: Enter and Tab select open suggestions without submitting, while closed Enter submits", () => {
  assert.equal(mentionSuggestionKeyDisposition("Enter", true), "select");
  assert.equal(mentionSuggestionKeyDisposition("Tab", true), "select");
  assert.equal(mentionSuggestionKeyDisposition("Enter", false), "submit");
  assert.equal(mentionSuggestionKeyDisposition("Tab", false), "ignore");
});

test("mentions: picker and composer descendants are inside for outside-click checks", () => {
  const picker = { children: [] as object[] };
  const option = {};
  picker.children.push(option);
  const composer = { children: [] as object[] };
  const editor = {};
  composer.children.push(editor);
  const outside = {};
  const contains = (surface: object, target: object) => "children" in surface && Array.isArray(surface.children) && surface.children.includes(target);

  assert.equal(isInsideMentionPickerOrComposer([option, picker], option, picker, composer, contains), true);
  assert.equal(isInsideMentionPickerOrComposer([editor], editor, picker, composer, contains), true);
  assert.equal(isInsideMentionPickerOrComposer([outside], outside, picker, composer, contains), false);
});

test("mentions: picker placement prefers below, flips above, and stays within a reduced visual viewport", () => {
  const viewport = { width: 390, height: 844, offsetLeft: 0, offsetTop: 0, layoutWidth: 390, layoutHeight: 844 };
  const below = mentionPopoverPlacement({ left: 40, right: 340, top: 200, bottom: 260 }, viewport);
  assert.deepEqual(below, { side: "below", left: 40, width: 300, maxHeight: 240, top: 264 });

  const above = mentionPopoverPlacement({ left: 40, right: 340, top: 600, bottom: 660 }, viewport);
  assert.equal(above.side, "above");
  assert.equal(above.maxHeight, 240);
  if (above.side !== "above") throw new Error("Expected the picker to flip above the textarea");
  assert.equal(viewport.layoutHeight - above.bottom, 596);

  const keyboardViewport = { ...viewport, height: 260, offsetTop: 360 };
  const keyboard = mentionPopoverPlacement({ left: 40, right: 340, top: 500, bottom: 540 }, keyboardViewport);
  assert.equal(keyboard.side, "above");
  assert.equal(keyboard.maxHeight, 128);
  if (keyboard.side !== "above") throw new Error("Expected the picker to fit above the textarea");
  const popupTop = viewport.layoutHeight - keyboard.bottom - keyboard.maxHeight;
  assert.equal(popupTop, keyboardViewport.offsetTop + 8);
  assert.ok(popupTop + keyboard.maxHeight <= keyboardViewport.offsetTop + keyboardViewport.height - 8);
  const resized = mentionPopoverPlacement({ left: 40, right: 340, top: 600, bottom: 660 }, { ...viewport, height: 420, layoutHeight: 420 });
  assert.equal(resized.side, "above");
  if (resized.side !== "above") throw new Error("Expected suggestions inside the resized viewport");
  assert.equal(resized.bottom, 8);
  assert.ok(420 - resized.bottom <= 420);
});

test("collab: comments, history, activity and notifications follow page permissions", async context => {
  const store = await openDatabase("memory://");
  const sentMail: Mail[] = [];
  let failNextMail = false;
  const app = createApp({ db: store.db, origin, secret, environment: "test", mailProvider: { kind: "test", async send(message) { sentMail.push(message); if (failNextMail) { failNextMail = false; throw new Error("Temporary email failure"); } } } });
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
  const notFound = (result: { status: number; data: any }) => {
    assert.equal(result.status, 404, JSON.stringify(result.data));
    assert.equal(JSON.stringify(result.data).includes("Refund"), false);
  };

  // Alice is admin of company A and owns the page. Bob may comment, Carol may view, Erin has no access. Dave is in company B.
  const alice = client("alice"), bob = client("bob"), carol = client("carol"), erin = client("erin"), dave = client("dave");
  const a = await register(alice, "Alice");
  const b = await register(bob, "Bob");
  const c = await register(carol, "Carol");
  const e = await register(erin, "Erin");
  const d = await register(dave, "Dave");
  await store.db.insert(schema.memberships).values([b, c, e].map(person => ({ companyId: a.companyId, userId: person.userId, role: "editor" as const })));
  const api = `/api/companies/${a.companyId}`;
  const policy = ok(await alice(`${api}/pages`, "POST", { title: "Refund policy" })).id as string;
  const comments = `${api}/pages/${policy}/comments`;
  ok(await alice(`${api}/pages/${policy}/grants`, "PUT", { inherits: false, grants: [
    { principalType: "user", principalId: a.userId, role: "editor" },
    { principalType: "user", principalId: b.userId, role: "commenter" }, { principalType: "user", principalId: c.userId, role: "viewer" }] }));
  async function save(content: unknown[]) {
    const page = ok(await alice(`${api}/pages/${policy}`)).page;
    return ok(await alice(`${api}/pages/${policy}/content`, "PUT", { baseRevision: page.revision, content })).revision as number;
  }

  try {
    await context.test("comments: outsiders and other companies get 404, viewers read only, commenters write, resolve and reopen", async () => {
      notFound(await erin(comments));
      notFound(await erin(comments, "POST", { body: "Let me in" }));
      notFound(await dave(comments));
      notFound(await dave(`/api/companies/${d.companyId}/pages/${policy}/comments`));
      notFound(await dave(`/api/companies/${d.companyId}/pages/${policy}/comments`, "POST", { body: "Hi" }));
      assert.deepEqual(ok(await carol(comments)).threads, []);
      assert.equal((await carol(comments, "POST", { body: "Viewer comment" })).status, 403);
      const thread = ok(await bob(comments, "POST", { body: "Is 14 days right?" })).id as string;
      assert.equal((await carol(`${comments}/${thread}/resolve`, "POST")).status, 403);
      assert.equal((await carol(`${comments}/${thread}/replies`, "POST", { body: "Me too" })).status, 403);
      ok(await bob(`${comments}/${thread}/resolve`, "POST"));
      assert.equal(ok(await carol(comments)).threads[0].resolved, true);
      ok(await bob(`${comments}/${thread}/reopen`, "POST"));
      const reply = ok(await bob(`${comments}/${thread}/replies`, "POST", { body: "Following up" }));
      const listed = ok(await carol(comments)).threads[0];
      assert.equal(listed.resolved, false);
      assert.deepEqual(listed.messages.map((message: any) => message.body), ["Is 14 days right?", "Following up"]);
      assert.equal(reply.id, listed.messages[1].id, "reply responses identify the persisted message, not the thread");
      notFound(await erin(`${comments}/${thread}/reopen`, "POST"));
      // Only the author edits; others (even viewers or commenters) cannot. Admins may delete.
      assert.equal((await alice(`${comments}/${thread}/messages/${listed.messages[0].id}`, "PATCH", { body: "Changed" })).status, 403);
      ok(await bob(`${comments}/${thread}/messages/${listed.messages[0].id}`, "PATCH", { body: "Is 14 days still right?" }));
      ok(await alice(`${comments}/${thread}/messages/${listed.messages[1].id}`, "DELETE"));
      const after = ok(await carol(comments)).threads[0].messages;
      assert.equal(after[0].body, "Is 14 days still right?");
      assert.deepEqual([after[1].deleted, after[1].body], [true, ""]);
    });

    await context.test("mention suggestions: enforce page access, active same-company membership, query matching and an eight-member limit", async () => {
      const visibleMembers = Array.from({ length: 9 }, (_, index) => ({ id: randomUUID(), name: `Accessible Member ${index + 1}`, email: `accessible-${index + 1}@example.test` }));
      const inactive = { id: randomUUID(), name: "Deactivated Visible", email: "deactivated-visible@example.test" };
      await store.db.insert(schema.user).values([...visibleMembers, inactive]);
      await store.db.insert(schema.memberships).values([
        ...visibleMembers.map(member => ({ companyId: a.companyId, userId: member.id, role: "editor" as const })),
        { companyId: a.companyId, userId: inactive.id, role: "editor" as const, status: "deactivated" as const },
      ]);
      ok(await alice(`${api}/pages/${policy}/grants`, "PUT", { inherits: false, grants: [
        { principalType: "user", principalId: a.userId, role: "editor" },
        { principalType: "user", principalId: b.userId, role: "commenter" },
        { principalType: "user", principalId: c.userId, role: "viewer" },
        ...visibleMembers.map(member => ({ principalType: "user", principalId: member.id, role: "viewer" })),
      ] }));
      await store.db.insert(schema.pageGrants).values({ id: randomUUID(), companyId: a.companyId, pageId: policy, spaceId: null, principalType: "user", principalId: inactive.id, role: "editor" });

      const byName = ok(await alice(`${comments}/mentions?q=Carol`)).members;
      assert.deepEqual(byName.map((member: any) => member.userId), [c.userId]);
      const byEmail = ok(await alice(`${comments}/mentions?q=BOB%40EXAMPLE.TEST`)).members;
      assert.deepEqual(byEmail.map((member: any) => member.userId), [b.userId]);
      assert.deepEqual(ok(await alice(`${comments}/mentions?q=Alice`)).members, []);
      assert.deepEqual(ok(await alice(`${comments}/mentions?q=alice%40example.test`)).members, []);
      const limited = ok(await alice(`${comments}/mentions?q=Accessible&limit=99`)).members;
      assert.equal(limited.length, 8);
      assert.ok(limited.every((member: any) => member.name.startsWith("Accessible Member")));
      assert.equal(ok(await alice(`${comments}/mentions?q=Accessible&limit=2`)).members.length, 2);
      assert.deepEqual(ok(await alice(`${comments}/mentions?q=accessible-9`)).members.map((member: any) => member.userId), [visibleMembers[8].id]);
      assert.deepEqual(ok(await alice(`${comments}/mentions?q=Deactivated`)).members, []);
      assert.deepEqual(ok(await alice(`${comments}/mentions?q=Erin`)).members, []);
      assert.deepEqual(ok(await alice(`${comments}/mentions?q=Dave`)).members, []);
      notFound(await erin(`${comments}/mentions?q=Alice`));
      notFound(await dave(`${api}/pages/${policy}/comments/mentions?q=Alice`));
    });

    await context.test("mentions notify only members who can view the page", async () => {
      const mailStart = sentMail.length;
      failNextMail = true;
      ok(await bob(comments, "POST", { body: "@carol and @erin and @dave please check" }));
      const carolList = ok(await carol(`${api}/notifications`)).notifications;
      const mention = carolList.find((item: any) => item.kind === "mention" && item.pageId === policy);
      assert.equal(carolList.filter((item: any) => item.kind === "mention" && item.pageId === policy).length, 1);
      assert.equal(mention.emailStatus, "failed");
      assert.match(mention.emailError, /Email could not be delivered/);
      const mailCount = await store.db.$count(schema.notifications, and(eq(schema.notifications.recipientId, c.userId), eq(schema.notifications.kind, "mention")));
      const retried = ok(await carol(`${api}/notifications/${mention.id}/retry-email`, "POST"));
      assert.equal(retried.emailStatus, "sent");
      assert.equal(await store.db.$count(schema.notifications, and(eq(schema.notifications.recipientId, c.userId), eq(schema.notifications.kind, "mention"))), mailCount);
      assert.equal(sentMail.length, mailStart + 2);
      assert.equal(sentMail[mailStart].idempotencyKey, sentMail[mailStart + 1].idempotencyKey);
      assert.deepEqual(ok(await erin(`${api}/notifications`)).notifications, []);
      assert.equal(ok(await erin(`${api}/notifications/unread-count`)).unread, 0);
      assert.equal(await store.db.$count(schema.notifications, eq(schema.notifications.recipientId, d.userId)), 0);
      // The owner hears about comments; the author never notifies themself.
      assert.ok(ok(await alice(`${api}/notifications`)).notifications.some((item: any) => item.kind === "comment"));
      assert.equal(ok(await bob(`${api}/notifications`)).notifications.some((item: any) => item.kind !== "access"), false);
    });

    await context.test("inline comment and reply preserve selected email tokens and notify the mentioned member", async () => {
      await save([paragraph("mention-anchor", "Please review the selected wording now.")]);
      const token = "@carol@example.test";
      const body = `Please review ${token}`;
      const anchor = { blockId: "mention-anchor", quote: "selected wording", prefix: "Please review the ", suffix: " now." };
      const thread = ok(await bob(comments, "POST", { kind: "inline", body, anchor }));
      const inlineThread = ok(await carol(comments)).threads.find((item: any) => item.id === thread.id);
      assert.equal(inlineThread.messages[0].body, body);
      const inlineNotifications = ok(await carol(`${api}/notifications`)).notifications.filter((item: any) => item.kind === "mention" && item.threadId === thread.id);
      assert.equal(inlineNotifications.length, 1);

      const replyBody = `Replying to ${token}`;
      const reply = ok(await bob(`${comments}/${thread.id}/replies`, "POST", { body: replyBody }));
      const updatedThread = ok(await carol(comments)).threads.find((item: any) => item.id === thread.id);
      assert.equal(updatedThread.messages.find((message: any) => message.id === reply.id).body, replyBody);
      const replyNotifications = ok(await carol(`${api}/notifications`)).notifications.filter((item: any) => item.kind === "mention" && item.threadId === thread.id);
      assert.equal(replyNotifications.length, 2);
    });

    await context.test("reply and edit mentions notify once and ignore ambiguous, inactive and inaccessible recipients", async () => {
      const duplicateId = randomUUID(), inactiveId = randomUUID();
      await store.db.insert(schema.user).values([
        { id: duplicateId, name: "Carol", email: "another-carol@example.test" },
        { id: inactiveId, name: "Inactive", email: "inactive@example.test" },
      ]);
      await store.db.insert(schema.memberships).values([
        { companyId: a.companyId, userId: duplicateId, role: "editor" },
        { companyId: a.companyId, userId: inactiveId, role: "editor", status: "deactivated" },
      ]);
      const threadId = ok(await bob(comments, "POST", { body: "Mention test" })).id;
      const count = (recipientId: string) => store.db.$count(schema.notifications, and(eq(schema.notifications.recipientId, recipientId), eq(schema.notifications.kind, "mention")));
      const before = await count(c.userId);
      const reply = ok(await bob(`${comments}/${threadId}/replies`, "POST", { body: "@carol @inactive @erin @dave" }));
      assert.equal(await count(c.userId), before, "an ambiguous display name is not guessed");
      const messageUrl = `${comments}/${threadId}/messages/${reply.id}`;
      const body = "@carol@example.test @carol@example.test @inactive @erin";
      ok(await bob(messageUrl, "PATCH", { body }));
      assert.equal(await count(c.userId), before + 1, "an exact email resolves ambiguity and duplicate mentions deduplicate");
      ok(await bob(messageUrl, "PATCH", { body: `${body} with more text` }));
      assert.equal(await count(c.userId), before + 1, "editing without adding a recipient does not notify again");
      ok(await bob(`${comments}/${threadId}/replies`, "POST", { body: "@carol@example.test reply notification" }));
      assert.equal(await count(c.userId), before + 2, "reply mentions notify");
      for (const recipientId of [duplicateId, inactiveId, e.userId, d.userId]) assert.equal(await count(recipientId), 0);
    });

    await context.test("history: viewers list and preview, only editors restore, outsiders get 404", async () => {
      await save([paragraph("b1", "Refunds within 14 days.")]);
      const revisions = ok(await carol(`${api}/pages/${policy}/revisions`)).revisions;
      assert.ok(revisions.length >= 2 && revisions[0].authorName === "Alice");
      assert.ok(ok(await carol(`${api}/pages/${policy}/revisions/1`)).revision);
      notFound(await erin(`${api}/pages/${policy}/revisions`));
      notFound(await erin(`${api}/pages/${policy}/revisions/2`));
      notFound(await erin(`${api}/pages/${policy}/revisions/1/restore`, "POST"));
      notFound(await dave(`/api/companies/${d.companyId}/pages/${policy}/revisions/1/restore`, "POST"));
      assert.equal((await carol(`${api}/pages/${policy}/revisions/1/restore`, "POST")).status, 403);
      assert.equal((await bob(`${api}/pages/${policy}/revisions/1/restore`, "POST")).status, 403);
      const historical = await store.db.select().from(schema.pageRevisions).where(eq(schema.pageRevisions.pageId, policy)).orderBy(schema.pageRevisions.revision);
      const before = revisions.length;
      const restored = ok(await alice(`${api}/pages/${policy}/revisions/1/restore`, "POST"));
      assert.equal(restored.revision, revisions[0].revision + 1);
      const after = ok(await carol(`${api}/pages/${policy}/revisions`)).revisions;
      assert.equal(after.length, before + 1);
      assert.deepEqual(after.slice(1).map((row: any) => row.revision), revisions.map((row: any) => row.revision));
      assert.deepEqual(ok(await carol(`${api}/pages/${policy}`)).page.content, []);
      const stored = await store.db.select().from(schema.pageRevisions).where(eq(schema.pageRevisions.pageId, policy)).orderBy(schema.pageRevisions.revision);
      assert.deepEqual(stored.slice(0, -1), historical, "restore never mutates any prior content, author or timestamp");
      assert.equal(stored.at(-1)?.revision, restored.revision);
      assert.equal(stored.at(-1)?.authorId, a.userId);
      assert.deepEqual(stored.at(-1)?.content, historical[0].content);
      assert.ok(ok(await carol(`${api}/pages/${policy}/activity`)).activity.some((row: any) => row.action === "restored_revision"));
    });

    await context.test("detached comments stay listed and re-attach when a restore brings the text back", async () => {
      const original = await save([paragraph("b1", "Refunds are processed within 14 days of request."), paragraph("b2", "Contact support.")]);
      const created = ok(await bob(comments, "POST", { body: "Too slow?", anchor: { blockId: "b1", quote: "within 14 days", prefix: "processed ", suffix: " of request" } }));
      assert.equal(created.anchorStatus, "attached");
      const find = async () => ok(await carol(comments)).threads.find((thread: any) => thread.id === created.id);
      await save([paragraph("b2", "Contact support. Refunds within 14 days of request.")]);
      assert.deepEqual([(await find()).anchorStatus, (await find()).anchorBlockId], ["attached", "b2"]);
      await save([paragraph("b1", "Refunds are processed quickly."), paragraph("b2", "Contact support.")]);
      const detached = await find();
      assert.equal(detached.anchorStatus, "detached");
      assert.equal(detached.messages[0].body, "Too slow?");
      assert.equal(detached.anchor.quote, "within 14 days");
      ok(await alice(`${api}/pages/${policy}/revisions/${original}/restore`, "POST"));
      const [stored] = await store.db.select().from(schema.commentThreads).where(eq(schema.commentThreads.id, created.id));
      assert.deepEqual([stored.anchorStatus, stored.anchorBlockId], ["attached", "b1"]);
      assert.equal((await find()).anchorStatus, "attached");
    });

    await context.test("inline-comments: mapped anchors survive quote edits and reload, detach despite duplicates, and restore edited ranges", async () => {
      const sourceText = "Read policy and read policy again.";
      const from = sourceText.indexOf("policy"), to = from + 6;
      const original = await save([paragraph("mapped", sourceText)]);
      const anchor = { blockId: "mapped", quote: "policy", prefix: sourceText.slice(0, from), suffix: sourceText.slice(to), from, to, sourceText };
      assert.equal((await bob(comments, "POST", { body: "Bad range", anchor: { ...anchor, to: to + 1 } })).status, 400);
      assert.equal((await bob(comments, "POST", { body: "Stale", anchor: { ...anchor, sourceText: `Old ${sourceText}`, from: from + 4, to: to + 4 } })).status, 409);
      const created = ok(await bob(comments, "POST", { body: "Check this policy", anchor }));
      const find = async () => ok(await carol(comments)).threads.find((thread: any) => thread.id === created.id);
      assert.deepEqual((await find()).placement, { blockId: "mapped", from, to });
      const editedText = "Read updated policy and read policy again.";
      const edited = await save([{ ...paragraph("mapped", editedText), commentRanges: [{ threadId: created.id, from, to: to + 8 }] }]);
      assert.equal((await find()).anchorStatus, "attached");
      assert.deepEqual((await find()).placement, { blockId: "mapped", from, to: to + 8 });
      const reloaded = ok(await carol(`${api}/pages/${policy}`)).page.content;
      assert.deepEqual(reloaded[0].commentRanges, [{ threadId: created.id, from, to: to + 8 }]);
      await save([paragraph("mapped", "Read  and read policy again.")]);
      assert.equal((await find()).anchorStatus, "detached", "an unrelated duplicate must not capture the thread");
      assert.equal((await find()).placement, null);
      ok(await alice(`${api}/pages/${policy}/revisions/${edited}/restore`, "POST"));
      assert.equal((await find()).anchorStatus, "attached");
      assert.deepEqual((await find()).placement, { blockId: "mapped", from, to: to + 8 });
      await save([paragraph("mapped", "Read  and read policy again.")]);
      ok(await alice(`${api}/pages/${policy}/revisions/${original}/restore`, "POST"));
      assert.deepEqual((await find()).placement, { blockId: "mapped", from, to }, "a version predating the mark restores the exact original selection");
      await save([paragraph("mapped", "Read p updatedolicy and read policy again.")]);
      assert.deepEqual((await find()).placement, { blockId: "mapped", from, to: to + 8 }, "a client opened before comment creation cannot accidentally drop the server anchor");
      await save([paragraph("mapped", "Intro. Read p updatedolicy and read policy again.")]);
      assert.deepEqual((await find()).placement, { blockId: "mapped", from: from + 7, to: to + 15 });
      await save([paragraph("mapped", "Intro. Read  and read policy again.")]);
      assert.equal((await find()).anchorStatus, "detached");
      const invalid = await save([{ ...paragraph("mapped", "Only text"), commentRanges: [{ threadId: created.id, from: 0, to: 900 }, { threadId: "bad", from: 0, to: 2 }] }]);
      assert.ok(invalid > edited);
      assert.equal(ok(await carol(`${api}/pages/${policy}`)).page.content[0].commentRanges, undefined);
      await save([paragraph("duplicate", "policy policy")]);
      const ambiguous = ok(await bob(comments, "POST", { body: "First occurrence only", anchor: { blockId: "duplicate", quote: "policy", prefix: "", suffix: " policy", from: 0, to: 6, sourceText: "policy policy" } }));
      await save([paragraph("duplicate", "policy")]);
      assert.equal(ok(await carol(comments)).threads.find((thread: any) => thread.id === ambiguous.id).anchorStatus, "detached", "ambiguous deletion must not transfer a thread to an identical neighbour");
    });

    await context.test("inline-comments: real BlockNote selection, ThreadStore, transaction mapping and reconstruction use persistent server comments", async () => {
      await save([paragraph("native", "Read policy and read policy again.")]);
      const apiAdapter = {
        comments: async () => ok(await bob(comments)),
        comment: async (_pageId: string, body: string, anchor: unknown) => ok(await bob(comments, "POST", { body, anchor })),
        reply: async (_pageId: string, threadId: string, body: string) => ok(await bob(`${comments}/${threadId}/replies`, "POST", { body })),
        resolve: async (_pageId: string, threadId: string, resolved: boolean) => ok(await bob(`${comments}/${threadId}/${resolved ? "resolve" : "reopen"}`, "POST")),
        editMessage: async (_pageId: string, threadId: string, messageId: string, body: string) => ok(await bob(`${comments}/${threadId}/messages/${messageId}`, "PATCH", { body })),
        deleteMessage: async (_pageId: string, threadId: string, messageId: string) => ok(await bob(`${comments}/${threadId}/messages/${messageId}`, "DELETE")),
      } as unknown as CollabApi;
      const threadStore = new ServerThreadStore(apiAdapter, policy, new CommentAuth(b.userId, true, false));
      const buildEditor = (content: unknown[]) => BlockNoteEditor.create({ initialContent: content as any, extensions: [CommentsExtension({ threadStore, schema: commentSchema, resolveUsers: async ids => ids.map(id => ({ id, username: "Test teammate", avatarUrl: "" })) })] });
      const editor = buildEditor(ok(await alice(`${api}/pages/${policy}`)).page.content);
      editor._tiptapEditor.commands.setTextSelection({ from: 8, to: 14 });
      const anchor = selectedAnchor(editor);
      assert.equal(anchor.quote, "policy");
      threadStore.getAnchor = async () => anchor;
      const extension = editor.getExtension(CommentsExtension)!;
      await extension.createThread({ initialComment: { body: [paragraph("body", "Native composer comment")] } });
      const thread = [...threadStore.getThreads().values()].find(thread => thread.comments.some(comment => !comment.deletedAt && JSON.stringify(comment.body).includes("Native composer comment")))!;
      assert.ok(thread);
      assert.deepEqual(documentWithAnchors(editor)[0].commentRanges, [{ threadId: thread.id, from: 5, to: 11 }]);
      editor.transact(transaction => transaction.insertText(" updated", 9));
      const mapped = documentWithAnchors(editor);
      assert.deepEqual(mapped[0].commentRanges, [{ threadId: thread.id, from: 5, to: 19 }]);
      const editedRevision = await save(mapped);
      await threadStore.reload();
      assert.equal(threadStore.rows.find(row => row.id === thread.id)!.anchorStatus, "attached");
      const reloadedContent = ok(await alice(`${api}/pages/${policy}`)).page.content;
      const reloaded = buildEditor(reloadedContent);
      hydrateAnchors(reloaded, threadStore.rows, reloadedContent);
      assert.deepEqual(documentWithAnchors(reloaded)[0].commentRanges, mapped[0].commentRanges);
      reloaded.transact(transaction => transaction.delete(8, 22));
      await save(documentWithAnchors(reloaded));
      await threadStore.reload();
      assert.equal(threadStore.rows.find(row => row.id === thread.id)!.anchorStatus, "detached");
      const addedComment = await threadStore.addComment({ threadId: thread.id, comment: { body: [paragraph("reply", "Still here after deletion")] } });
      assert.ok(addedComment?.id, "the editor receives the saved reply object");
      assert.equal(threadStore.rows.find(row => row.id === thread.id)!.messages[1].id, addedComment.id);
      const [persistedReply] = await store.db.select().from(schema.commentMessages).where(eq(schema.commentMessages.id, addedComment.id));
      assert.equal(persistedReply.threadId, thread.id);
      assert.equal(persistedReply.body, "Still here after deletion");
      assert.equal(threadStore.getThread(thread.id).comments.length, 2);
      await threadStore.updateComment({ threadId: thread.id, commentId: thread.comments[0].id, comment: { body: [paragraph("edit", "Edited comment")] } });
      assert.ok(JSON.stringify(threadStore.getThread(thread.id)).includes("Edited comment"));
      await threadStore.resolveThread({ threadId: thread.id });
      assert.equal(threadStore.getThread(thread.id).resolved, true);
      await threadStore.unresolveThread({ threadId: thread.id });
      assert.equal(threadStore.getThread(thread.id).resolved, false);
      const restored = ok(await alice(`${api}/pages/${policy}/revisions/${editedRevision}/restore`, "POST"));
      await threadStore.reload();
      const restoredEditor = buildEditor(restored.content);
      hydrateAnchors(restoredEditor, threadStore.rows, restored.content);
      assert.deepEqual(documentWithAnchors(restoredEditor)[0].commentRanges, mapped[0].commentRanges);
      assert.equal(threadStore.rows.find(row => row.id === thread.id)!.anchorStatus, "attached");
      assert.equal(threadStore.auth.canDeleteThread(thread), false);
      assert.equal(threadStore.auth.canAddReaction(thread.comments[0]), false);
      assert.equal(new CommentAuth(c.userId, false, false).canCreateThread(), false);
      assert.equal(new CommentAuth(a.userId, true, false).canDeleteComment(thread.comments[0]), false);
      assert.equal(new CommentAuth(a.userId, true, true).canDeleteComment(thread.comments[0]), true);
      await assert.rejects(threadStore.deleteThread(), /not supported/);
      await assert.rejects(threadStore.addReaction(), /not supported/);
      await threadStore.deleteComment({ threadId: thread.id, commentId: thread.comments[0].id });
      assert.ok(threadStore.getThread(thread.id).comments[0].deletedAt);
    });

    await context.test("notifications belong to their recipient and disappear when page access is revoked", async () => {
      const carolList = ok(await carol(`${api}/notifications`));
      assert.ok(carolList.notifications.some((item: any) => item.kind === "access" && item.pageId === policy));
      assert.ok(carolList.unread >= 2);
      const mention = carolList.notifications.find((item: any) => item.kind === "mention");
      assert.equal(mention.pageTitle, "Refund policy");
      notFound(await bob(`${api}/notifications/${mention.id}/read`, "POST"));
      notFound(await bob(`${api}/notifications/${mention.id}/retry-email`, "POST"));
      assert.equal(ok(await alice(`${api}/notifications`)).notifications.some((item: any) => item.id === mention.id), false);
      notFound(await dave(`${api}/notifications`));
      ok(await carol(`${api}/notifications/${mention.id}/read`, "POST"));
      assert.equal(ok(await carol(`${api}/notifications/unread-count`)).unread, carolList.unread - 1);
      ok(await alice(`${api}/pages/${policy}/grants`, "PUT", { inherits: false, grants: [{ principalType: "user", principalId: a.userId, role: "editor" }, { principalType: "user", principalId: b.userId, role: "commenter" }] }));
      const revoked = ok(await carol(`${api}/notifications`));
      assert.deepEqual(revoked.notifications, []);
      assert.equal(revoked.unread, 0);
      assert.equal(JSON.stringify(revoked).includes("Refund"), false);
      assert.equal(ok(await carol(`${api}/notifications/unread-count`)).unread, 0);
      notFound(await carol(comments));
      ok(await carol(`${api}/notifications/read-all`, "POST"));
      // Nothing was deleted: the rows stay hidden while access is missing.
      assert.ok(await store.db.$count(schema.notifications, eq(schema.notifications.recipientId, c.userId)) >= 2);
    });

    await context.test("notification totals and read-all cover more than 500 accessible rows without exposing inaccessible or other recipients' rows", async () => {
      const pageId = ok(await alice(`${api}/pages`, "POST", { title: "Accessible notification page" })).id as string;
      const accessible = Array.from({ length: 501 }, (_, index) => ({ id: randomUUID(), companyId: a.companyId, recipientId: c.userId, kind: "comment" as const, pageId, createdAt: new Date(1_700_000_000_000 + index) }));
      const hidden = Array.from({ length: 501 }, (_, index) => ({ id: randomUUID(), companyId: a.companyId, recipientId: c.userId, kind: "comment" as const, pageId: policy, createdAt: new Date(1_800_000_000_000 + index) }));
      const others = [
        { id: randomUUID(), companyId: a.companyId, recipientId: b.userId, kind: "comment" as const, pageId },
        { id: randomUUID(), companyId: c.companyId, recipientId: c.userId, kind: "comment" as const, pageId: null },
      ];
      await store.db.insert(schema.notifications).values([...accessible, ...hidden, ...others]);
      const inbox = ok(await carol(`${api}/notifications`));
      assert.equal(inbox.notifications.length, 100, "only the displayed inbox is limited");
      assert.equal(inbox.unread, 501, "newer inaccessible rows cannot truncate older accessible unread rows");
      assert.equal(ok(await carol(`${api}/notifications/unread-count`)).unread, 501);
      const accessibleIds = new Set<string>(accessible.map(row => row.id));
      assert.ok(inbox.notifications.every((row: any) => accessibleIds.has(row.id) && row.pageTitle === "Accessible notification page"));
      assert.ok(!JSON.stringify(inbox).includes("Refund policy"));
      for (const row of [...hidden.slice(0, 1), ...others]) {
        assert.ok(!JSON.stringify(inbox).includes(row.id));
        notFound(await carol(`${api}/notifications/${row.id}/read`, "POST"));
        notFound(await carol(`${api}/notifications/${row.id}/retry-email`, "POST"));
      }
      assert.deepEqual(ok(await carol(`${api}/notifications/read-all`, "POST")), { ok: true, unread: 0 });
      const seededIds = new Set<string>([...accessible, ...hidden, ...others].map(row => row.id));
      const seeded = (await store.db.select().from(schema.notifications)).filter(row => seededIds.has(row.id));
      assert.equal(seeded.filter(row => accessibleIds.has(row.id) && row.readAt !== null).length, 501, "read-all also marks accessible rows outside the displayed inbox");
      assert.ok(seeded.filter(row => !accessibleIds.has(row.id)).every(row => row.readAt === null), "inaccessible, other-recipient and other-company rows remain untouched");
      assert.equal(ok(await carol(`${api}/notifications/unread-count`)).unread, 0);
      assert.equal(ok(await carol(`${api}/notifications`)).unread, 0);
    });

    await context.test("activity coalesces one person's autosaves within 10 minutes", async () => {
      const edited = () => store.db.select().from(schema.pageActivity)
        .where(and(eq(schema.pageActivity.pageId, policy), eq(schema.pageActivity.actorId, a.userId), eq(schema.pageActivity.action, "edited")));
      await store.db.delete(schema.pageActivity).where(eq(schema.pageActivity.action, "edited"));
      await save([paragraph("b1", "One")]);
      await save([paragraph("b1", "Two")]);
      await save([paragraph("b1", "Three")]);
      let rows = await edited();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].count, 3);
      await store.db.update(schema.pageActivity).set({ updatedAt: new Date(Date.now() - 11 * 60 * 1000) }).where(eq(schema.pageActivity.id, rows[0].id));
      await save([paragraph("b1", "Four")]);
      rows = await edited();
      assert.equal(rows.length, 2);
      const activity = ok(await bob(`${api}/pages/${policy}/activity`)).activity;
      for (const action of ["created", "edited", "commented", "resolved", "reopened", "access_changed", "restored_revision"]) assert.ok(activity.some((row: any) => row.action === action), action);
      notFound(await erin(`${api}/pages/${policy}/activity`));
    });
  } finally {
    await store.close();
  }
});
