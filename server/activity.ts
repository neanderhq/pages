import { randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { pageActivity, activityActions } from "./schema.ts";
import { json } from "./http.ts";
import { memberNames, pageAccess, type Db, type RouteContext } from "./access.ts";

// Per-page activity. Autosaves are coalesced: one person's edits to one page within 10 minutes of their last
// edit update a single "edited" row (count and updated_at) instead of adding a row per save.
export type ActivityAction = typeof activityActions[number];
const coalesceMs = 10 * 60 * 1000;

export async function recordActivity(db: Db, companyId: string, pageId: string, actorId: string, action: ActivityAction, detail?: string) {
  const now = new Date();
  if (action === "edited") {
    const [recent] = await db.select({ id: pageActivity.id, count: pageActivity.count }).from(pageActivity)
      .where(and(eq(pageActivity.companyId, companyId), eq(pageActivity.pageId, pageId), eq(pageActivity.actorId, actorId), eq(pageActivity.action, "edited"),
        gt(pageActivity.updatedAt, new Date(now.getTime() - coalesceMs))))
      .orderBy(desc(pageActivity.updatedAt)).limit(1);
    if (recent) {
      await db.update(pageActivity).set({ count: recent.count + 1, updatedAt: now }).where(and(eq(pageActivity.companyId, companyId), eq(pageActivity.id, recent.id)));
      return;
    }
  }
  await db.insert(pageActivity).values({ id: randomUUID(), companyId, pageId, actorId, action, detail: detail?.slice(0, 300) ?? null, createdAt: now, updatedAt: now });
}

// GET pages/:id/activity — viewer or above.
export async function activityRoute({ db, companyId, userId }: RouteContext, pageId: string) {
  await pageAccess(db, companyId, userId, pageId, "viewer");
  const rows = await db.select().from(pageActivity).where(and(eq(pageActivity.companyId, companyId), eq(pageActivity.pageId, pageId)))
    .orderBy(desc(pageActivity.updatedAt)).limit(200);
  const names = await memberNames(db, companyId);
  return json({ activity: rows.map(row => ({ id: row.id, action: row.action, detail: row.detail, count: row.count, actorId: row.actorId,
    actorName: names.get(row.actorId) ?? "Former member", createdAt: row.createdAt, updatedAt: row.updatedAt })) });
}
