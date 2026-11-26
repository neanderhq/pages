import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { commentMessages, commentThreads, memberships, pages, user, type CommentAnchor } from "./schema.ts";
import { bodyOf, fail, json } from "./http.ts";
import { memberNames, notFound, pageAccess, plainText, uuidPattern, type Db, type RouteContext } from "./access.ts";
import { anchorPlacement, blockTexts, preserveNativeRanges, resolveAnchor } from "./anchors.ts";
import { recordActivity } from "./activity.ts";
import { notify } from "./notifications.ts";
import { visibleRoles } from "./permissions.ts";

// Page and inline comments under pages/:id/comments. Viewers read; commenters and editors write, reply, resolve and reopen.
// People edit and delete only their own messages; administrators may delete any message. Deleting keeps the thread.
const maxBody = 5_000;

function anchorOf(value: unknown): CommentAnchor {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const { blockId, quote, prefix = "", suffix = "" } = source;
  if (typeof blockId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(blockId)) fail(400, "anchor.blockId is invalid.");
  if (typeof quote !== "string" || !quote.trim() || quote.length > 500) fail(400, "anchor.quote must be 1–500 characters of selected text.");
  if (typeof prefix !== "string" || typeof suffix !== "string") fail(400, "anchor.prefix and anchor.suffix must be text.");
  const native = source.sourceText !== undefined;
  if (native && (typeof source.sourceText !== "string" || source.sourceText.length > 100_000 || !Number.isInteger(source.from) || !Number.isInteger(source.to) || (source.from as number) < 0 || (source.to as number) <= (source.from as number) || source.sourceText.slice(source.from as number, source.to as number) !== quote)) fail(400, "The selected comment range is invalid.");
  return { blockId: blockId as string, quote: quote as string, prefix: (prefix as string).slice(-64), suffix: (suffix as string).slice(0, 64), ...(native ? { from: source.from as number, to: source.to as number, sourceText: source.sourceText as string } : {}) };
}

// '@' tokens become user ids of active members: an exact email first, otherwise a unique match on the email name
// (before the @) or the display name without spaces. Ambiguous tokens are ignored.
async function resolveMentions(db: Db, companyId: string, body: string) {
  const tokens = [...body.matchAll(/(?:^|[^\w@.])@([\w.+-]+(?:@[\w-]+(?:\.[\w-]+)+)?)/g)].map(match => match[1].replace(/\.+$/, "").toLowerCase()).filter(Boolean);
  if (!tokens.length) return [];
  const members = await db.select({ id: user.id, name: user.name, email: user.email }).from(memberships).innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(memberships.companyId, companyId), eq(memberships.status, "active")));
  const ids = new Set<string>();
  for (const token of new Set(tokens)) {
    const exact = members.filter(member => member.email.toLowerCase() === token);
    const loose = members.filter(member => member.email.toLowerCase().split("@")[0] === token || member.name.replace(/\s+/g, "").toLowerCase() === token);
    const match = exact.length === 1 ? exact : loose.length === 1 ? loose : [];
    for (const member of match) ids.add(member.id);
  }
  return [...ids];
}

export async function refreshAnchors(db: Db, companyId: string, pageId: string, content: unknown) {
  const threads = await db.select({ id: commentThreads.id, anchor: commentThreads.anchor, anchorStatus: commentThreads.anchorStatus, anchorBlockId: commentThreads.anchorBlockId })
    .from(commentThreads).where(and(eq(commentThreads.companyId, companyId), eq(commentThreads.pageId, pageId), eq(commentThreads.kind, "inline")));
  for (const thread of threads) {
    if (!thread.anchor) continue;
    const result = resolveAnchor(content, thread.anchor, thread.id);
    if (result.status !== thread.anchorStatus || result.blockId !== thread.anchorBlockId) {
      await db.update(commentThreads).set({ anchorStatus: result.status, anchorBlockId: result.blockId }).where(and(eq(commentThreads.companyId, companyId), eq(commentThreads.id, thread.id)));
    }
  }
}

export async function preserveAnchors(db: Db, companyId: string, pageId: string, previous: unknown, content: Record<string, unknown>[]) {
  const threads = await db.select({ id: commentThreads.id, anchor: commentThreads.anchor }).from(commentThreads)
    .where(and(eq(commentThreads.companyId, companyId), eq(commentThreads.pageId, pageId), eq(commentThreads.kind, "inline")));
  return preserveNativeRanges(previous, content, threads);
}

async function threadFor(db: Db, companyId: string, pageId: string, threadId: string | undefined) {
  if (!threadId || !uuidPattern.test(threadId)) return notFound("Comment");
  const [thread] = await db.select().from(commentThreads).where(and(eq(commentThreads.companyId, companyId), eq(commentThreads.pageId, pageId), eq(commentThreads.id, threadId)));
  return thread ?? notFound("Comment");
}

// A new message notifies people it mentions (kind "mention"), then the page owner and earlier participants ("comment").
// notify() skips the author and anyone who cannot view the page.
async function notifyForMessage(db: Db, companyId: string, pageId: string, threadId: string, actorId: string, mentions: string[]) {
  const mentioned = await notify(db, companyId, { recipients: mentions, kind: "mention", pageId, actorId, threadId });
  const [page] = await db.select({ ownerId: pages.ownerId }).from(pages).where(and(eq(pages.companyId, companyId), eq(pages.id, pageId)));
  const [thread] = await db.select({ createdBy: commentThreads.createdBy }).from(commentThreads).where(and(eq(commentThreads.companyId, companyId), eq(commentThreads.id, threadId)));
  const authors = await db.select({ authorId: commentMessages.authorId }).from(commentMessages).where(and(eq(commentMessages.companyId, companyId), eq(commentMessages.threadId, threadId)));
  const participants = new Set([page.ownerId, thread.createdBy, ...authors.map(row => row.authorId)]);
  for (const id of mentioned) participants.delete(id);
  await notify(db, companyId, { recipients: participants, kind: "comment", pageId, actorId, threadId });
}

async function list(db: Db, companyId: string, pageId: string, content: unknown) {
  const threads = await db.select().from(commentThreads).where(and(eq(commentThreads.companyId, companyId), eq(commentThreads.pageId, pageId))).orderBy(asc(commentThreads.createdAt));
  const messages = threads.length ? await db.select().from(commentMessages)
    .where(and(eq(commentMessages.companyId, companyId), inArray(commentMessages.threadId, threads.map(thread => thread.id)))).orderBy(asc(commentMessages.createdAt)) : [];
  const names = await memberNames(db, companyId);
  const name = (id: string | null) => id ? names.get(id) ?? "Former member" : null;
  return threads.map(thread => ({
    id: thread.id, kind: thread.kind, anchor: thread.anchor, anchorStatus: thread.anchor ? resolveAnchor(content, thread.anchor, thread.id).status : null, anchorBlockId: thread.anchor ? resolveAnchor(content, thread.anchor, thread.id).blockId : null,
    placement: thread.anchor ? anchorPlacement(content, thread.anchor, thread.id) : null,
    createdBy: thread.createdBy, createdByName: name(thread.createdBy), createdAt: thread.createdAt,
    resolved: !!thread.resolvedAt, resolvedAt: thread.resolvedAt, resolvedBy: thread.resolvedBy, resolvedByName: name(thread.resolvedBy),
    messages: messages.filter(message => message.threadId === thread.id).map(message => ({
      id: message.id, authorId: message.authorId, authorName: name(message.authorId), createdAt: message.createdAt, editedAt: message.editedAt,
      deleted: !!message.deletedAt, body: message.deletedAt ? "" : message.body,
      mentions: message.deletedAt ? [] : message.mentions.map(id => ({ userId: id, name: name(id) })),
    })),
  }));
}

// GET/POST pages/:id/comments, POST pages/:id/comments/:threadId/(replies|resolve|reopen),
// PATCH/DELETE pages/:id/comments/:threadId/messages/:messageId
export async function commentRoute({ db, request, method, companyId, userId, admin, parts }: RouteContext, pageId: string) {
  const [, , , threadId, action, messageId] = parts;
  if (parts.length === 4 && threadId === "mentions" && method === "GET") {
    await pageAccess(db, companyId, userId, pageId, "viewer");
    const params = new URL(request.url).searchParams;
    const query = (params.get("q") ?? "").trim().toLowerCase();
    const requestedLimit = Number(params.get("limit") ?? 8);
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(8, requestedLimit)) : 8;
    const candidates = await db.select({ userId: memberships.userId, name: user.name, email: user.email })
      .from(memberships).innerJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(memberships.companyId, companyId), eq(memberships.status, "active")));
    const matches = candidates.filter(member => member.userId !== userId && (!query || member.name.toLowerCase().includes(query) || member.email.toLowerCase().includes(query)))
      .sort((left, right) => left.name.localeCompare(right.name) || left.email.localeCompare(right.email));
    const members = [];
    for (const member of matches) {
      if (!(await visibleRoles(db, companyId, member.userId)).has(pageId)) continue;
      members.push(member);
      if (members.length === limit) break;
    }
    return json({ members });
  }
  if (parts.length === 3 && method === "GET") {
    const { page } = await pageAccess(db, companyId, userId, pageId, "viewer");
    return json({ threads: await list(db, companyId, pageId, page.content) });
  }
  if (parts.length === 3 && method === "POST") {
    const body = await bodyOf(request);
    const text = plainText(body.body, "body", maxBody);
    const kind = body.kind ?? (body.anchor === undefined ? "page" : "inline");
    if (kind !== "page" && kind !== "inline") fail(400, "kind must be page or inline.");
    const anchor = kind === "inline" ? anchorOf(body.anchor) : null;
    const result = await db.transaction(async tx => {
      const { page } = await pageAccess(tx, companyId, userId, pageId, "commenter");
      if (anchor?.sourceText !== undefined && !blockTexts(page.content).some(block => block.id === anchor.blockId && block.text === anchor.sourceText)) fail(409, "Save or reload the page before commenting on this text.");
      const id = randomUUID();
      const placed = anchor ? resolveAnchor(page.content, anchor) : null;
      await tx.insert(commentThreads).values({ id, companyId, pageId, kind: kind as "page" | "inline", anchor, anchorStatus: placed?.status ?? null, anchorBlockId: placed?.blockId ?? null, createdBy: userId });
      const mentions = await resolveMentions(tx, companyId, text);
      await tx.insert(commentMessages).values({ id: randomUUID(), companyId, threadId: id, authorId: userId, body: text, mentions });
      await recordActivity(tx, companyId, pageId, userId, "commented");
      await notifyForMessage(tx, companyId, pageId, id, userId, mentions);
      return { id, anchorStatus: placed?.status ?? null };
    });
    return json(result);
  }
  if (parts.length === 5 && method === "POST" && (action === "replies" || action === "resolve" || action === "reopen")) {
    const body = await bodyOf(request);
    const text = action === "replies" ? plainText(body.body, "body", maxBody) : "";
    const result = await db.transaction(async tx => {
      await pageAccess(tx, companyId, userId, pageId, "commenter");
      const thread = await threadFor(tx, companyId, pageId, threadId);
      if (action === "replies") {
        const id = randomUUID();
        const mentions = await resolveMentions(tx, companyId, text);
        await tx.insert(commentMessages).values({ id, companyId, threadId: thread.id, authorId: userId, body: text, mentions });
        await tx.update(commentThreads).set({ updatedAt: new Date() }).where(and(eq(commentThreads.companyId, companyId), eq(commentThreads.id, thread.id)));
        await recordActivity(tx, companyId, pageId, userId, "commented");
        await notifyForMessage(tx, companyId, pageId, thread.id, userId, mentions);
        return { id };
      }
      const resolving = action === "resolve";
      if (resolving === !!thread.resolvedAt) return;
      await tx.update(commentThreads).set({ resolvedAt: resolving ? new Date() : null, resolvedBy: resolving ? userId : null, updatedAt: new Date() })
        .where(and(eq(commentThreads.companyId, companyId), eq(commentThreads.id, thread.id)));
      await recordActivity(tx, companyId, pageId, userId, resolving ? "resolved" : "reopened");
    });
    return json(result ?? { ok: true });
  }
  if (parts.length === 6 && action === "messages" && (method === "PATCH" || method === "DELETE")) {
    const body = method === "PATCH" ? await bodyOf(request) : {};
    const text = method === "PATCH" ? plainText(body.body, "body", maxBody) : "";
    await db.transaction(async tx => {
      await pageAccess(tx, companyId, userId, pageId, "commenter");
      const thread = await threadFor(tx, companyId, pageId, threadId);
      if (!messageId || !uuidPattern.test(messageId)) notFound("Comment");
      const [message] = await tx.select().from(commentMessages).where(and(eq(commentMessages.companyId, companyId), eq(commentMessages.threadId, thread.id), eq(commentMessages.id, messageId)));
      if (!message || message.deletedAt) return notFound("Comment");
      const where = and(eq(commentMessages.companyId, companyId), eq(commentMessages.id, message.id));
      if (method === "DELETE") {
        if (message.authorId !== userId && !admin) fail(403, "You can only delete your own comments.");
        await tx.update(commentMessages).set({ body: "", mentions: [], deletedAt: new Date() }).where(where);
        return;
      }
      if (message.authorId !== userId) fail(403, "You can only edit your own comments.");
      const mentions = await resolveMentions(tx, companyId, text);
      await tx.update(commentMessages).set({ body: text, mentions, editedAt: new Date() }).where(where);
      const added = mentions.filter(id => !message.mentions.includes(id));
      if (added.length) await notify(tx, companyId, { recipients: added, kind: "mention", pageId, actorId: userId, threadId: thread.id });
    });
    return json({ ok: true });
  }
  return notFound();
}
