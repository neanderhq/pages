import { and, eq } from "drizzle-orm";
import { pageRevisions, pages } from "./schema.ts";
import { json } from "./http.ts";
import { sanitizeContent } from "./content.ts";
import { notFound, pageAccess, type RouteContext } from "./access.ts";
import { recordActivity } from "./activity.ts";
import { refreshAnchors } from "./comments.ts";
import { searchTextOf } from "./search.ts";
import { syncLinks } from "./links.ts";

// POST pages/:id/revisions/:n/restore — editors only. The old content goes through the same sanitizer as a save and
// becomes a NEW revision on top of the current one; no history row is ever changed or deleted.
// Inline comment anchors are recomputed, so comments detached by later edits re-attach when their text comes back.
export async function restoreRevision({ db, companyId, userId }: RouteContext, pageId: string, value: string | undefined) {
  return db.transaction(async tx => {
    await pageAccess(tx, companyId, userId, pageId, "editor");
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) return notFound("Revision");
    const [old] = await tx.select({ content: pageRevisions.content }).from(pageRevisions)
      .where(and(eq(pageRevisions.companyId, companyId), eq(pageRevisions.pageId, pageId), eq(pageRevisions.revision, number)));
    if (!old) return notFound("Revision");
    const content = sanitizeContent(old.content);
    const [current] = await tx.select({ revision: pages.revision }).from(pages).where(and(eq(pages.companyId, companyId), eq(pages.id, pageId))).for("update");
    const revision = current.revision + 1;
    await tx.update(pages).set({ content, revision, searchText: searchTextOf(content), updatedAt: new Date() }).where(and(eq(pages.companyId, companyId), eq(pages.id, pageId)));
    await tx.insert(pageRevisions).values({ companyId, pageId, revision, content, authorId: userId });
    await recordActivity(tx, companyId, pageId, userId, "restored_revision", `Restored revision ${number} as revision ${revision}`);
    await refreshAnchors(tx, companyId, pageId, content);
    await syncLinks(tx, companyId, pageId, content);
    return json({ revision, restoredFrom: number, content });
  });
}
