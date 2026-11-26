import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { pageTags, pages, spaces } from "./schema.ts";
import { bodyOf, fail, json } from "./http.ts";
import { visibleRoles } from "./permissions.ts";
import { blockTexts } from "./anchors.ts";
import { memberNames, notFound, pageAccess, type Db, type RouteContext } from "./access.ts";

// Search and tags. Permission filtering happens inside the SQL query (only ids the caller can view are allowed),
// so titles, snippets and totals are computed from accessible pages only. Archived pages never match.
export const searchTextOf = (content: unknown) => blockTexts(content).map(block => block.text).filter(Boolean).join("\n");
const escapeLike = (value: string) => value.replace(/[\\%_]/g, match => `\\${match}`);

export function normalizeTag(value: unknown) {
  if (typeof value !== "string") return fail(400, "Tags must be text.");
  const tag = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (tag.length < 1 || tag.length > 40) return fail(400, "Tags must be 1–40 characters.");
  return tag;
}

export async function pageTagsOf(db: Db, companyId: string, pageId: string) {
  return (await db.select({ tag: pageTags.tag }).from(pageTags).where(and(eq(pageTags.companyId, companyId), eq(pageTags.pageId, pageId))).orderBy(asc(pageTags.tag))).map(row => row.tag);
}

// GET pages/:id/tags (viewer+), PUT pages/:id/tags { tags: string[] } (editor) replaces the page's tags.
export async function pageTagsRoute({ db, request, method, companyId, userId }: RouteContext, pageId: string) {
  if (method === "GET") {
    await pageAccess(db, companyId, userId, pageId, "viewer");
    return json({ tags: await pageTagsOf(db, companyId, pageId) });
  }
  if (method !== "PUT") return notFound();
  const body = await bodyOf(request);
  if (!Array.isArray(body.tags) || body.tags.length > 20) fail(400, "tags must be a list of up to 20 tags.");
  const tags = [...new Set((body.tags as unknown[]).map(normalizeTag))];
  await db.transaction(async tx => {
    await pageAccess(tx, companyId, userId, pageId, "editor");
    await tx.delete(pageTags).where(and(eq(pageTags.companyId, companyId), eq(pageTags.pageId, pageId)));
    if (tags.length) await tx.insert(pageTags).values(tags.map(tag => ({ companyId, pageId, tag })));
  });
  return json({ tags: tags.sort() });
}

// GET tags — tags used on pages the caller can view, with how many of those pages use each.
export async function tagListRoute({ db, companyId, userId }: RouteContext) {
  const ids = [...(await visibleRoles(db, companyId, userId)).keys()];
  if (!ids.length) return json({ tags: [] });
  const rows = await db.select({ tag: pageTags.tag, count: sql<number>`count(*)::int` }).from(pageTags)
    .where(and(eq(pageTags.companyId, companyId), inArray(pageTags.pageId, ids))).groupBy(pageTags.tag).orderBy(asc(pageTags.tag));
  return json({ tags: rows });
}

// Pages saved before migration 0004 have no search text yet; compute it once, on first search.
async function fillSearchText(db: Db, companyId: string) {
  const missing = await db.select({ id: pages.id, content: pages.content }).from(pages).where(and(eq(pages.companyId, companyId), isNull(pages.searchText)));
  for (const row of missing) await db.update(pages).set({ searchText: searchTextOf(row.content) }).where(and(eq(pages.companyId, companyId), eq(pages.id, row.id)));
}

function snippetOf(text: string, query: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!query) return clean.slice(0, 160);
  const at = clean.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return clean.slice(0, 160);
  const start = Math.max(0, at - 60), end = Math.min(clean.length, at + query.length + 100);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

function dateParam(value: string | null, key: string) {
  if (value === null || value === "") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fail(400, `${key} must be a date.`) : date;
}

// GET search?q=&ownerId=&spaceId=(id|company)&tag=&updatedAfter=&updatedBefore=&limit=&offset=
// Case-insensitive match on title or body text. Title matches come first, then the most recently updated.
export async function searchRoute({ db, request, companyId, userId }: RouteContext) {
  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").replace(/\s+/g, " ").trim();
  if (q.length > 200) fail(400, "q must be up to 200 characters.");
  const limit = params.get("limit") === null ? 20 : Number(params.get("limit"));
  const offset = params.get("offset") === null ? 0 : Number(params.get("offset"));
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(400, "limit must be 1–50.");
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) fail(400, "offset must be 0–10000.");
  const after = dateParam(params.get("updatedAfter"), "updatedAfter"), before = dateParam(params.get("updatedBefore"), "updatedBefore");
  const ids = [...(await visibleRoles(db, companyId, userId)).keys()];
  if (!ids.length) return json({ results: [], total: 0, limit, offset });
  await fillSearchText(db, companyId);
  const pattern = `%${escapeLike(q)}%`;
  const filters: (SQL | undefined)[] = [eq(pages.companyId, companyId), isNull(pages.archivedAt), inArray(pages.id, ids)];
  if (q) filters.push(or(ilike(pages.title, pattern), ilike(pages.searchText, pattern)));
  const ownerId = params.get("ownerId"), spaceId = params.get("spaceId"), tagParam = params.get("tag");
  if (ownerId) filters.push(eq(pages.ownerId, ownerId.slice(0, 64)));
  if (spaceId) filters.push(spaceId === "company" ? isNull(pages.spaceId) : eq(pages.spaceId, spaceId.slice(0, 64)));
  if (tagParam) filters.push(sql`exists (select 1 from ${pageTags} where ${pageTags.companyId} = ${pages.companyId} and ${pageTags.pageId} = ${pages.id} and ${pageTags.tag} = ${normalizeTag(tagParam)})`);
  if (after) filters.push(gte(pages.updatedAt, after));
  if (before) filters.push(lte(pages.updatedAt, before));
  const where = and(...filters);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(pages).where(where);
  const rows = await db.select({ id: pages.id, title: pages.title, slug: pages.slug, spaceId: pages.spaceId, spaceName: spaces.name, ownerId: pages.ownerId,
    updatedAt: pages.updatedAt, searchText: pages.searchText }).from(pages)
    .leftJoin(spaces, and(eq(spaces.companyId, pages.companyId), eq(spaces.id, pages.spaceId))).where(where)
    .orderBy(...(q ? [desc(ilike(pages.title, pattern))] : []), desc(pages.updatedAt), asc(pages.id)).limit(limit).offset(offset);
  const names = await memberNames(db, companyId);
  const tagRows = rows.length ? await db.select({ pageId: pageTags.pageId, tag: pageTags.tag }).from(pageTags)
    .where(and(eq(pageTags.companyId, companyId), inArray(pageTags.pageId, rows.map(row => row.id)))).orderBy(asc(pageTags.tag)) : [];
  return json({
    results: rows.map(row => ({ id: row.id, title: row.title, slug: row.slug, spaceId: row.spaceId, spaceName: row.spaceId ? row.spaceName : null,
      ownerId: row.ownerId, ownerName: names.get(row.ownerId) ?? "Former member", updatedAt: row.updatedAt,
      tags: tagRows.filter(tag => tag.pageId === row.id).map(tag => tag.tag), snippet: snippetOf(row.searchText ?? "", q) })),
    total, limit, offset,
  });
}
