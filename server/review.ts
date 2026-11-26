import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { auditEvents, memberships, notifications, pages } from "./schema.ts";
import { bodyOf, fail, json } from "./http.ts";
import { effectiveRole, visibleRoles } from "./permissions.ts";
import { recordActivity } from "./activity.ts";
import { memberNames, notFound, pageAccess, type Db, type RouteContext } from "./access.ts";

// Page ownership and review. State is always computed on the server:
// - unreviewed: never marked reviewed;
// - verified: reviewed, and either no interval is set or the next review is not due yet;
// - stale: reviewed, but the interval has passed since the last review.
// A page with an interval is due `interval` days after its last review (or after creation if never reviewed).
type ReviewFields = { createdAt: Date; reviewIntervalDays: number | null; lastReviewedAt: Date | null };
export type ReviewState = "verified" | "stale" | "unreviewed";
const day = 24 * 60 * 60 * 1000;

export function reviewState(page: ReviewFields, now = new Date()) {
  const dueAt = page.reviewIntervalDays ? new Date((page.lastReviewedAt ?? page.createdAt).getTime() + page.reviewIntervalDays * day) : null;
  const state: ReviewState = !page.lastReviewedAt ? "unreviewed" : dueAt && dueAt <= now ? "stale" : "verified";
  return { state, dueAt, due: !!dueAt && dueAt <= now };
}

type PageRow = typeof pages.$inferSelect;
export async function reviewInfo(db: Db, companyId: string, page: PageRow, names?: Map<string, string>) {
  const known = names ?? await memberNames(db, companyId);
  const { state, dueAt } = reviewState(page);
  return { ownerId: page.ownerId, ownerName: known.get(page.ownerId) ?? "Former member", reviewIntervalDays: page.reviewIntervalDays,
    lastReviewedAt: page.lastReviewedAt, lastReviewedBy: page.lastReviewedBy, lastReviewedByName: page.lastReviewedBy ? known.get(page.lastReviewedBy) ?? "Former member" : null,
    state, dueAt };
}

// Non-archived pages whose review date has passed (optionally only those owned by `ownerId`). Callers filter by access.
export async function duePages(db: Db, companyId: string, ownerId?: string, now = new Date()) {
  const rows = await db.select().from(pages).where(and(eq(pages.companyId, companyId), isNull(pages.archivedAt), isNotNull(pages.reviewIntervalDays),
    ownerId ? eq(pages.ownerId, ownerId) : undefined));
  return rows.map(page => ({ page, ...reviewState(page, now) })).filter(row => row.due).sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());
}

// One review_due notification per page and due date for the page owner.
export async function createReviewDueNotifications(db: Db, companyId: string, userId: string, now = new Date()) {
  const roles = await visibleRoles(db, companyId, userId);
  let created = 0;
  for (const { page, dueAt } of await duePages(db, companyId, userId, now)) {
    if (!roles.has(page.id)) continue;
    const inserted = await db.insert(notifications).values({ id: randomUUID(), companyId, recipientId: userId, kind: "review_due", pageId: page.id, actorId: null,
      dedupeKey: `review_due:${page.id}:${dueAt!.toISOString()}`, emailStatus: "pending" }).onConflictDoNothing().returning({ id: notifications.id });
    created += inserted.length;
  }
  return created;
}

function intervalOf(value: unknown) {
  if (value === null) return null;
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 3650 ? value as number : fail(400, "reviewIntervalDays must be 1–3650 days or null.");
}

async function reviewAccess(db: Db, companyId: string, userId: string, pageId: string) {
  const access = await pageAccess(db, companyId, userId, pageId, "viewer");
  const [member] = await db.select({ role: memberships.role }).from(memberships)
    .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId)));
  if (member?.role === "viewer") fail(403, "Workspace Viewers cannot change page reviews.");
  return access;
}

// PATCH pages/:id/review { ownerId?, reviewIntervalDays? } — owner changes need edit access;
// the new owner must be an active member who can view the page. Editors or the owner can change the interval.
// POST pages/:id/review — marks the page reviewed; editors or the owner. Workspace Viewers cannot mutate reviews.
export async function reviewRoute({ db, request, method, companyId, userId }: RouteContext, pageId: string) {
  if (method === "GET") {
    const { page } = await pageAccess(db, companyId, userId, pageId, "viewer");
    return json({ review: await reviewInfo(db, companyId, page) });
  }
  if (method === "PATCH") {
    const body = await bodyOf(request);
    const ownerId = body.ownerId === undefined ? undefined : typeof body.ownerId === "string" && body.ownerId.length <= 64 ? body.ownerId : fail(400, "ownerId is invalid.");
    const interval = body.reviewIntervalDays === undefined ? undefined : intervalOf(body.reviewIntervalDays);
    if (ownerId === undefined && interval === undefined) fail(400, "Nothing to change.");
    const page = await db.transaction(async tx => {
      const { page, role } = await reviewAccess(tx, companyId, userId, pageId);
      const editor = role === "editor";
      if (ownerId !== undefined && ownerId !== page.ownerId) {
        if (!editor) fail(403, "You need edit access to change the owner.");
        const [member] = await tx.select({ userId: memberships.userId }).from(memberships)
          .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, ownerId), eq(memberships.status, "active")));
        if (!member || !await effectiveRole(tx, companyId, ownerId, pageId)) fail(400, "The new owner must be an active member who can view this page.");
      }
      if (interval !== undefined && !editor && page.ownerId !== userId) fail(403, "Only editors or the page owner can change the review interval.");
      const [updated] = await tx.update(pages).set({ ...(ownerId === undefined ? {} : { ownerId }), ...(interval === undefined ? {} : { reviewIntervalDays: interval }) })
        .where(and(eq(pages.companyId, companyId), eq(pages.id, pageId))).returning();
      if (ownerId !== undefined && ownerId !== page.ownerId) await tx.insert(auditEvents).values({ id: randomUUID(), companyId, actor: userId, action: "page.owner_changed", target: `${pageId}->${ownerId}` });
      if (interval !== undefined) await tx.insert(auditEvents).values({ id: randomUUID(), companyId, actor: userId, action: "page.review_interval_changed", target: `${pageId}:${interval ?? "none"}` });
      return updated;
    });
    return json({ review: await reviewInfo(db, companyId, page) });
  }
  if (method === "POST") {
    const page = await db.transaction(async tx => {
      const { page, role } = await reviewAccess(tx, companyId, userId, pageId);
      if (role !== "editor" && page.ownerId !== userId) fail(403, "Only editors or the page owner can mark this page as reviewed.");
      const now = new Date();
      const [updated] = await tx.update(pages).set({ lastReviewedAt: now, lastReviewedBy: userId })
        .where(and(eq(pages.companyId, companyId), eq(pages.id, pageId))).returning();
      await recordActivity(tx, companyId, pageId, userId, "verified");
      // The reminder for this page has been dealt with.
      await tx.update(notifications).set({ readAt: now }).where(and(eq(notifications.companyId, companyId), eq(notifications.pageId, pageId),
        eq(notifications.kind, "review_due"), isNull(notifications.readAt)));
      return updated;
    });
    return json({ review: await reviewInfo(db, companyId, page) });
  }
  return notFound();
}

// GET review-due[?mine=1] — pages the caller can view whose review date has passed, oldest due first.
export async function reviewDueRoute({ db, request, companyId, userId }: RouteContext) {
  const mine = ["1", "true"].includes(new URL(request.url).searchParams.get("mine") ?? "");
  const roles = await visibleRoles(db, companyId, userId);
  const names = await memberNames(db, companyId);
  const rows = (await duePages(db, companyId, mine ? userId : undefined)).filter(row => roles.has(row.page.id)).slice(0, 200);
  return json({ pages: rows.map(({ page, state, dueAt }) => ({ id: page.id, title: page.title, slug: page.slug, spaceId: page.spaceId, ownerId: page.ownerId,
    ownerName: names.get(page.ownerId) ?? "Former member", reviewIntervalDays: page.reviewIntervalDays, lastReviewedAt: page.lastReviewedAt, state, dueAt })) });
}
