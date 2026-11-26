import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { pageLinks, pages } from "./schema.ts";
import { json } from "./http.ts";
import { visibleRoles } from "./permissions.ts";
import { pageAccess, uuidPattern, type Db, type RouteContext } from "./access.ts";

// Internal page links are ordinary BlockNote links whose href is "/p/<pageId>" or "/p/<slug>" (optionally with ?query or #hash).
// They are extracted on the server after every save, restore and page creation into page_links(source, target).
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const internalHref = /^\/p\/([^/?#]{1,128})(?:[?#].*)?$/;

// Raw link targets (page ids or slugs) in document order, without duplicates.
export function linkTargets(content: unknown): string[] {
  const found = new Set<string>();
  const inline = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!isObject(item) || item.type !== "link" || typeof item.href !== "string") continue;
      const match = item.href.trim().match(internalHref);
      if (!match) continue;
      try { found.add(decodeURIComponent(match[1])); } catch { /* malformed escapes are not links */ }
    }
  };
  const walk = (list: unknown, depth: number) => {
    if (!Array.isArray(list) || depth > 16) return;
    for (const block of list) {
      if (!isObject(block)) continue;
      const content = block.content;
      if (isObject(content) && Array.isArray(content.rows)) {
        for (const row of content.rows) for (const cell of isObject(row) && Array.isArray(row.cells) ? row.cells : []) inline(isObject(cell) ? cell.content : cell);
      } else inline(content);
      walk(block.children, depth + 1);
    }
  };
  walk(content, 1);
  return [...found];
}

// Replaces the outgoing links of one page. Targets must be pages of the same company; unknown targets and self links are ignored.
export async function syncLinks(db: Db, companyId: string, sourceId: string, content: unknown) {
  await db.delete(pageLinks).where(and(eq(pageLinks.companyId, companyId), eq(pageLinks.sourceId, sourceId)));
  const targets = linkTargets(content).slice(0, 500);
  if (!targets.length) return;
  const ids = targets.filter(target => uuidPattern.test(target)), slugs = targets.filter(target => !uuidPattern.test(target));
  const matches = [ids.length ? inArray(pages.id, ids) : undefined, slugs.length ? inArray(pages.slug, slugs) : undefined].filter(Boolean);
  const rows = await db.select({ id: pages.id }).from(pages).where(and(eq(pages.companyId, companyId), or(...matches)));
  const values = [...new Set(rows.map(row => row.id))].filter(id => id !== sourceId).map(targetId => ({ companyId, sourceId, targetId }));
  if (values.length) await db.insert(pageLinks).values(values).onConflictDoNothing();
}

// GET pages/:id/backlinks — viewer or above. Only linking pages the caller can view are returned; others are not counted.
export async function backlinksRoute({ db, companyId, userId }: RouteContext, pageId: string) {
  await pageAccess(db, companyId, userId, pageId, "viewer");
  const roles = await visibleRoles(db, companyId, userId);
  const rows = await db.select({ id: pages.id, title: pages.title, slug: pages.slug, spaceId: pages.spaceId }).from(pageLinks)
    .innerJoin(pages, and(eq(pages.companyId, pageLinks.companyId), eq(pages.id, pageLinks.sourceId)))
    .where(and(eq(pageLinks.companyId, companyId), eq(pageLinks.targetId, pageId), isNull(pages.archivedAt))).orderBy(asc(pages.title));
  return json({ pages: rows.filter(row => roles.has(row.id)) });
}
