import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { companies, groupMembers, notifications, pages, user } from "./schema.ts";
import { json } from "./http.ts";
import { effectiveRole, visibleRoles, type PageRole } from "./permissions.ts";
import { memberNames, notFound, uuidPattern, type Db, type RouteContext } from "./access.ts";
import { createReviewDueNotifications, duePages } from "./review.ts";
import { MailDeliveryError, MailUnavailableError, type MailProvider } from "./mail.ts";

// In-app notifications. A notification is only created for someone who can view the page at that moment, and the
// list only ever shows notifications whose page the recipient can still view. Others are hidden, titles included.
type Kind = "mention" | "comment" | "access" | "review_due";

// Notifies each recipient (never the actor) who is an active member and can at least view the page. Returns who was notified.
export async function notify(db: Db, companyId: string, input: { recipients: Iterable<string>; kind: Kind; pageId: string; actorId: string | null; threadId?: string }) {
  const notified: string[] = [];
  for (const recipientId of new Set(input.recipients)) {
    if (recipientId === input.actorId || !await effectiveRole(db, companyId, recipientId, input.pageId)) continue;
    await db.insert(notifications).values({ id: randomUUID(), companyId, recipientId, kind: input.kind, pageId: input.pageId, actorId: input.actorId, threadId: input.threadId ?? null,
      emailStatus: input.kind === "mention" ? "pending" : "not_applicable" });
    notified.push(recipientId);
  }
  return notified;
}

type Grant = { principalType: "user" | "group"; principalId: string; role: PageRole };
// Users whose grant on a page was added, removed or changed. Group grants expand to the group's current members.
export async function affectedByGrantChange(db: Db, companyId: string, before: Grant[], after: Grant[]) {
  const key = (grant: Grant) => `${grant.principalType}:${grant.principalId}`;
  const old = new Map(before.map(grant => [key(grant), grant])), next = new Map(after.map(grant => [key(grant), grant]));
  const changed = [...new Set([...old.keys(), ...next.keys()])].filter(id => old.get(id)?.role !== next.get(id)?.role).map(id => (old.get(id) ?? next.get(id))!);
  const users = new Set(changed.filter(grant => grant.principalType === "user").map(grant => grant.principalId));
  const groupIds = changed.filter(grant => grant.principalType === "group").map(grant => grant.principalId);
  if (groupIds.length) {
    const rows = await db.select({ userId: groupMembers.userId }).from(groupMembers).where(and(eq(groupMembers.companyId, companyId), inArray(groupMembers.groupId, groupIds)));
    for (const row of rows) users.add(row.userId);
  }
  return users;
}

// Review reminders, created lazily whenever the list or count is fetched (there is no scheduler): one review_due row
// per page and due date, deduplicated through dedupe_key, for pages the user owns and can view whose review date has passed.
export async function reviewDueNotifications(db: Db, companyId: string, userId: string, now = new Date()): Promise<number> {
  return createReviewDueNotifications(db, companyId, userId, now);
}

// The caller's notifications on pages they can still view. Anything else is left out without revealing it.
async function visibleNotifications(db: Db, companyId: string, userId: string) {
  await reviewDueNotifications(db, companyId, userId);
  const rows = await db.select().from(notifications).where(and(eq(notifications.companyId, companyId), eq(notifications.recipientId, userId)))
    .orderBy(desc(notifications.createdAt));
  const roles = await visibleRoles(db, companyId, userId);
  return rows.filter(row => !row.pageId || roles.has(row.pageId));
}

async function deliverNotificationEmail(db: Db, mail: MailProvider, origin: string, companyId: string, id: string, recipientId: string, now = new Date()) {
  const staleBefore = new Date(now.getTime() - 5 * 60_000);
  const [claimed] = await db.update(notifications).set({ emailStatus: "sending", emailError: null, emailAttempts: sql`${notifications.emailAttempts} + 1`, emailAttemptedAt: now })
    .where(and(eq(notifications.companyId, companyId), eq(notifications.id, id), eq(notifications.recipientId, recipientId),
      or(inArray(notifications.emailStatus, ["pending", "failed", "unavailable"]), and(eq(notifications.emailStatus, "sending"), lt(notifications.emailAttemptedAt, staleBefore)))))
    .returning({ id: notifications.id, kind: notifications.kind, pageId: notifications.pageId });
  if (!claimed) return db.select({ emailStatus: notifications.emailStatus, emailError: notifications.emailError }).from(notifications)
    .where(and(eq(notifications.companyId, companyId), eq(notifications.id, id), eq(notifications.recipientId, recipientId))).then(rows => rows[0] ?? notFound("Notification"));
  try {
    if (!await effectiveRole(db, companyId, recipientId, claimed.pageId!)) {
      await db.update(notifications).set({ emailStatus: "not_applicable", emailError: null }).where(and(eq(notifications.companyId, companyId), eq(notifications.id, id)));
      return { emailStatus: "not_applicable" as const, emailError: null };
    }
    const [details] = await db.select({ email: user.email, pageTitle: pages.title, companyName: companies.name }).from(notifications)
      .innerJoin(user, eq(user.id, notifications.recipientId)).leftJoin(pages, and(eq(pages.companyId, notifications.companyId), eq(pages.id, notifications.pageId)))
      .innerJoin(companies, eq(companies.companyId, notifications.companyId))
      .where(and(eq(notifications.companyId, companyId), eq(notifications.id, id), eq(notifications.recipientId, recipientId)));
    if (!details || !claimed.pageId) throw new Error("The notification page is no longer available.");
    await mail.send({ to: details.email, kind: claimed.kind === "mention" ? "mention" : "review-reminder", company: details.companyName,
      pageTitle: details.pageTitle ?? "Untitled", url: `${origin}/p/${claimed.pageId}?company=${encodeURIComponent(companyId)}`, idempotencyKey: `wiki-notification-${id}` });
    await db.update(notifications).set({ emailStatus: "sent", emailError: null }).where(and(eq(notifications.companyId, companyId), eq(notifications.id, id)));
    return { emailStatus: "sent" as const, emailError: null };
  } catch (error) {
    const unavailable = error instanceof MailUnavailableError;
    const emailStatus = unavailable ? "unavailable" : "failed";
    const emailError = error instanceof MailDeliveryError ? error.message.slice(0, 500) : "Email could not be delivered. Please retry.";
    await db.update(notifications).set({ emailStatus, emailError }).where(and(eq(notifications.companyId, companyId), eq(notifications.id, id)));
    return { emailStatus, emailError };
  }
}

export async function sweepReviewDueReminders(db: Db, mail: MailProvider, origin: string, clock: () => Date = () => new Date()) {
  const now = clock();
  const workspaces = await db.select({ companyId: companies.companyId }).from(companies);
  let created = 0;
  for (const { companyId } of workspaces) {
    const due = await duePages(db, companyId, undefined, now);
    const owners = new Map<string, string[]>();
    for (const { page } of due) owners.set(page.ownerId, [...(owners.get(page.ownerId) ?? []), page.id]);
    for (const [ownerId, pageIds] of owners) {
      created += await createReviewDueNotifications(db, companyId, ownerId, now);
      const pending = await db.select({ id: notifications.id, recipientId: notifications.recipientId }).from(notifications)
        .where(and(eq(notifications.companyId, companyId), eq(notifications.recipientId, ownerId), eq(notifications.kind, "review_due"),
          eq(notifications.emailStatus, "pending"), inArray(notifications.pageId, pageIds)));
      for (const notification of pending) await deliverNotificationEmail(db, mail, origin, companyId, notification.id, notification.recipientId, now);
    }
  }
  return created;
}

export async function deliverPendingNotificationEmails(db: Db, mail: MailProvider, origin: string, companyId: string, recipientId?: string) {
  const pending = await db.select({ id: notifications.id, recipientId: notifications.recipientId }).from(notifications)
    .where(and(eq(notifications.companyId, companyId), eq(notifications.emailStatus, "pending"), recipientId ? eq(notifications.recipientId, recipientId) : undefined))
    .orderBy(notifications.createdAt).limit(100);
  for (const notification of pending) await deliverNotificationEmail(db, mail, origin, companyId, notification.id, notification.recipientId);
}

// GET notifications, GET notifications/unread-count, POST notifications/read-all, POST notifications/:id/read
export async function notificationRoute({ db, method, companyId, userId, parts }: RouteContext, mail: MailProvider, origin: string) {
  if (parts.length === 1 && method === "GET") {
    await reviewDueNotifications(db, companyId, userId);
    await deliverPendingNotificationEmails(db, mail, origin, companyId, userId);
    const all = await visibleNotifications(db, companyId, userId);
    const rows = all.slice(0, 100);
    const pageIds = [...new Set(rows.map(row => row.pageId).filter((id): id is string => !!id))];
    const titles = new Map(pageIds.length ? (await db.select({ id: pages.id, title: pages.title }).from(pages)
      .where(and(eq(pages.companyId, companyId), inArray(pages.id, pageIds)))).map(row => [row.id, row.title]) : []);
    const names = await memberNames(db, companyId);
    return json({
      notifications: rows.map(row => ({ id: row.id, kind: row.kind, pageId: row.pageId, pageTitle: row.pageId ? titles.get(row.pageId) ?? "" : null, threadId: row.threadId,
        actorId: row.actorId, actorName: row.actorId ? names.get(row.actorId) ?? "Former member" : null, createdAt: row.createdAt, readAt: row.readAt,
        emailStatus: row.emailStatus, emailError: row.emailError })),
      unread: all.filter(row => !row.readAt).length,
    });
  }
  if (parts.length === 2 && parts[1] === "unread-count" && method === "GET") {
    await reviewDueNotifications(db, companyId, userId);
    await deliverPendingNotificationEmails(db, mail, origin, companyId, userId);
    return json({ unread: (await visibleNotifications(db, companyId, userId)).filter(row => !row.readAt).length });
  }
  if (parts.length === 3 && parts[2] === "retry-email" && method === "POST") {
    const id = parts[1];
    if (!uuidPattern.test(id)) return notFound("Notification");
    await visibleNotifications(db, companyId, userId).then(rows => rows.find(row => row.id === id) ?? notFound("Notification"));
    const result = await deliverNotificationEmail(db, mail, origin, companyId, id, userId);
    return json({ ok: result.emailStatus === "sent", emailStatus: result.emailStatus, emailError: result.emailError });
  }
  if (parts.length === 2 && parts[1] === "read-all" && method === "POST") {
    const ids = (await visibleNotifications(db, companyId, userId)).filter(row => !row.readAt).map(row => row.id);
    if (ids.length) await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.companyId, companyId), eq(notifications.recipientId, userId), inArray(notifications.id, ids)));
    return json({ ok: true, unread: 0 });
  }
  if (parts.length === 3 && parts[2] === "read" && method === "POST") {
    const id = parts[1];
    if (!uuidPattern.test(id)) return notFound("Notification");
    const visible = (await visibleNotifications(db, companyId, userId)).find(row => row.id === id) ?? notFound("Notification");
    if (!visible.readAt) await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.companyId, companyId), eq(notifications.recipientId, userId), eq(notifications.id, id), isNull(notifications.readAt)));
    return json({ ok: true });
  }
  return notFound("Notification");
}
