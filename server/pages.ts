import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { Database, Transaction } from "./database.ts";
import { attachments, attachmentContents, auditEvents, groups, memberships, pageFavorites, pageGrants, pageRevisions, pages, pageVisits, publicPageSnapshots, spaces, user } from "./schema.ts";
import { bodyOf, fail, json } from "./http.ts";
import { activeMember, canMove, canRestore, effectiveRole, spaceRole, visibleRoles, type PageRole } from "./permissions.ts";
import { contentToMarkdown, markdownImportTitle, markdownToContent, maxContentBytes, safeLink, safeMediaUrl, sanitizeContent, tableCellContent } from "./content.ts";
import { activityRoute, recordActivity } from "./activity.ts";
import { commentRoute, preserveAnchors, refreshAnchors } from "./comments.ts";
import { restoreRevision } from "./history.ts";
import { affectedByGrantChange, notificationRoute, notify } from "./notifications.ts";
import { pageTagsOf, pageTagsRoute, searchRoute, searchTextOf, tagListRoute } from "./search.ts";
import { backlinksRoute, syncLinks } from "./links.ts";
import { templateById, templateContent, templatesRoute } from "./templates.ts";
import { reviewDueRoute, reviewInfo, reviewRoute } from "./review.ts";
import { deliverPendingNotificationEmails } from "./notifications.ts";
import type { MailProvider } from "./mail.ts";
import { lockSharing, moveImpact } from "./sharing.ts";

// Step 2 page, sharing, history and attachment routes under /api/companies/:companyId/.
// Identity comes from the server session; a page the caller cannot view always answers 404 with a generic message.
type Db = Database | Transaction;
const maxUpload = 10 * 1024 * 1024;
const maxMarkdownImportBytes = 20_000_000;
const uploadPath = /^\/api\/companies\/[^/]+\/pages\/[^/]+\/attachments$/;
const contentPath = /^\/api\/companies\/[^/]+\/pages\/[^/]+\/content$/;
const markdownImportPath = /^\/api\/companies\/[^/]+\/pages\/import-markdown$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rank: Record<PageRole, number> = { viewer: 1, commenter: 2, editor: 3 };
const roleNames = new Set<PageRole>(["editor", "commenter", "viewer"]);
const publicTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export const isRawUpload = (method: string, path: string) => method === "POST" && uploadPath.test(path);
// Request bodies stay at 16 KB except uploads (10 MB) and content saves (a full BlockNote document).
export function requestLimit(method: string, path: string) {
  if (isRawUpload(method, path)) return maxUpload + 64 * 1024;
  if (method === "PUT" && contentPath.test(path)) return maxContentBytes + 16_384;
  if (method === "POST" && markdownImportPath.test(path)) return maxMarkdownImportBytes;
  return 16_384;
}

const startsWith = (bytes: Buffer, signature: number[] | string, offset = 0) =>
  bytes.subarray(offset, offset + signature.length).equals(typeof signature === "string" ? Buffer.from(signature, "latin1") : Buffer.from(signature));
const fileTypes: Record<string, { mime: string; inline?: boolean; magic?: (bytes: Buffer) => boolean }> = {
  png: { mime: "image/png", inline: true, magic: bytes => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { mime: "image/jpeg", inline: true, magic: bytes => startsWith(bytes, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: "image/jpeg", inline: true, magic: bytes => startsWith(bytes, [0xff, 0xd8, 0xff]) },
  gif: { mime: "image/gif", inline: true, magic: bytes => startsWith(bytes, "GIF87a") || startsWith(bytes, "GIF89a") },
  webp: { mime: "image/webp", inline: true, magic: bytes => startsWith(bytes, "RIFF") && startsWith(bytes, "WEBP", 8) },
  pdf: { mime: "application/pdf", magic: bytes => startsWith(bytes, "%PDF-") },
  doc: { mime: "application/msword" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xls: { mime: "application/vnd.ms-excel" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ppt: { mime: "application/vnd.ms-powerpoint" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  txt: { mime: "text/plain" },
  csv: { mime: "text/csv" },
  md: { mime: "text/markdown" },
};

const notFound = (what = "Page"): never => fail(404, `${what} not found.`);
const newSlug = (title: string) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled"}-${randomBytes(4).toString("hex")}`;
function titleOf(value: unknown, fallback?: string) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || value.trim().length > 200) return fail(400, "title must be up to 200 characters.");
  return value.trim();
}
function optionalId(value: unknown, key: string) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && value.length <= 64 ? value : fail(400, `${key} is invalid.`);
}
function cleanFilename(value: string) {
  const base = value.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 200);
}
async function audit(tx: Transaction, companyId: string, actor: string, action: string, target: string) {
  await tx.insert(auditEvents).values({ id: randomUUID(), companyId, actor, action, target });
}
// Top-level pages share a parent of null within one space (null = the company space).
function siblingsOf(companyId: string, parentId: string | null, spaceId: string | null): SQL {
  const parent = parentId ? eq(pages.parentId, parentId) : and(isNull(pages.parentId), spaceId ? eq(pages.spaceId, spaceId) : isNull(pages.spaceId));
  return and(eq(pages.companyId, companyId), isNull(pages.archivedAt), parent)!;
}
async function nextPosition(db: Db, companyId: string, parentId: string | null, spaceId: string | null) {
  const [row] = await db.select({ max: sql<number | null>`max(${pages.position})` }).from(pages).where(siblingsOf(companyId, parentId, spaceId));
  return (row?.max ?? -1) + 1;
}
// Ids of rootId and every page below it, parents before children. `only` limits the walk to matching pages.
async function subtree(db: Db, companyId: string, rootId: string, only?: (row: { id: string; archivedRootId: string | null }) => boolean) {
  const rows = await db.select({ id: pages.id, parentId: pages.parentId, archivedRootId: pages.archivedRootId }).from(pages).where(eq(pages.companyId, companyId));
  const children = new Map<string, typeof rows>();
  for (const row of rows) if (row.parentId) children.set(row.parentId, [...children.get(row.parentId) ?? [], row]);
  const ids: string[] = [rootId];
  const seen = new Set(ids);
  for (let index = 0; index < ids.length; index++) {
    for (const child of children.get(ids[index]) ?? []) {
      if (seen.has(child.id) || (only && !only(child))) continue;
      seen.add(child.id); ids.push(child.id);
    }
  }
  return ids;
}

async function guardSubtree(db: Db, companyId: string, userId: string, pageId: string) {
  const member = await activeMember(db, companyId, userId);
  if (member?.role === "admin") return;
  const ids = await subtree(db, companyId, pageId);
  const roles = await visibleRoles(db, companyId, userId);
  if (ids.some(id => !roles.has(id))) fail(403, "You do not have access to perform this action on the entire page tree.");
}

// Loads a page the caller holds at least `need` on. Pages they cannot view are indistinguishable from missing ones.
async function pageFor(db: Db, companyId: string, userId: string, pageId: string, need: PageRole) {
  if (!uuidPattern.test(pageId)) return notFound();
  const role = await effectiveRole(db, companyId, userId, pageId);
  if (!role) return notFound();
  if (rank[role] < rank[need]) fail(403, need === "editor" ? "You need edit access to this page." : "You do not have access to do this.");
  const [page] = await db.select().from(pages).where(and(eq(pages.companyId, companyId), eq(pages.id, pageId)));
  return { page: page ?? notFound(), role };
}

type GrantInput = { principalType: "user" | "group"; principalId: string; role: PageRole };
// Grants may only name active members or groups of this company; duplicates collapse to the last entry.
async function grantList(db: Db, companyId: string, value: unknown): Promise<GrantInput[]> {
  if (!Array.isArray(value) || value.length > 200) return fail(400, "grants must be a list of up to 200 entries.");
  const byPrincipal = new Map<string, GrantInput>();
  for (const item of value) {
    const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const { principalType, principalId, role } = entry;
    if ((principalType !== "user" && principalType !== "group") || typeof principalId !== "string" || !roleNames.has(role as PageRole)) fail(400, "Each grant needs a user or group and the role editor, commenter or viewer.");
    byPrincipal.set(`${principalType}:${principalId}`, { principalType: principalType as GrantInput["principalType"], principalId: principalId as string, role: role as PageRole });
  }
  const grants = [...byPrincipal.values()];
  const userIds = grants.filter(grant => grant.principalType === "user").map(grant => grant.principalId);
  const groupIds = grants.filter(grant => grant.principalType === "group").map(grant => grant.principalId);
  const activeUsers = userIds.length ? await db.select({ id: memberships.userId }).from(memberships)
    .where(and(eq(memberships.companyId, companyId), eq(memberships.status, "active"), inArray(memberships.userId, userIds))) : [];
  const knownGroups = groupIds.length ? await db.select({ id: groups.id }).from(groups).where(and(eq(groups.companyId, companyId), inArray(groups.id, groupIds))) : [];
  if (activeUsers.length !== new Set(userIds).size || knownGroups.length !== new Set(groupIds).size) fail(400, "Grants can only name active members and groups of this workspace.");
  return grants;
}

async function describeGrants(db: Db, companyId: string, target: SQL) {
  const rows = await db.select({ principalType: pageGrants.principalType, principalId: pageGrants.principalId, role: pageGrants.role }).from(pageGrants)
    .where(and(eq(pageGrants.companyId, companyId), target)).orderBy(asc(pageGrants.createdAt));
  const users = new Map((await db.select({ id: user.id, name: user.name, email: user.email }).from(memberships).innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(memberships.companyId, companyId))).map(row => [row.id, `${row.name} (${row.email})`]));
  const groupNames = new Map((await db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.companyId, companyId))).map(row => [row.id, row.name]));
  return rows.map(row => ({ ...row, name: (row.principalType === "user" ? users : groupNames).get(row.principalId) ?? "Unknown" }));
}

async function inheritedAccess(db: Db, companyId: string, userId: string, page: { parentId: string | null; spaceId: string | null }, revealEntries: boolean) {
  let parentId = page.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId) && seen.size < 256) {
    seen.add(parentId);
    const [parent] = await db.select().from(pages).where(and(eq(pages.companyId, companyId), eq(pages.id, parentId)));
    if (!parent) break;
    if (!parent.inherits) {
      const role = await effectiveRole(db, companyId, userId, parent.id);
      const entriesVisible = role === "editor" && revealEntries;
      return { source: role ? `Page: ${parent.title || "Untitled"}` : "An inaccessible ancestor", grants: entriesVisible ? await describeGrants(db, companyId, eq(pageGrants.pageId, parent.id)) : [], entriesVisible, workspaceAccess: false };
    }
    parentId = parent.parentId;
  }
  if (parentId) return { source: "Unavailable inheritance source", grants: [], entriesVisible: false, workspaceAccess: false };
  const [space] = page.spaceId ? await db.select({ name: spaces.name }).from(spaces).where(and(eq(spaces.companyId, companyId), eq(spaces.id, page.spaceId))) : [];
  const entries = page.spaceId ? await describeGrants(db, companyId, eq(pageGrants.spaceId, page.spaceId)) : [];
  const entriesVisible = revealEntries && await spaceRole(db, companyId, userId, page.spaceId) === "editor";
  return { source: space ? `Team space: ${space.name}` : "Workspace", grants: entriesVisible ? entries : [], entriesVisible, workspaceAccess: entries.length === 0 };
}

type Context = { db: Database; uploadDir: string; databaseUploads: boolean; request: Request; method: string; companyId: string; userId: string; admin: boolean; parts: string[] };

export function createPageRoutes(db: Database, uploadDir: string, mail: MailProvider, origin: string, databaseUploads = false) {
  return async function route(request: Request, method: string, companyId: string, resource: string, userId: string): Promise<Response | null> {
    const parts = resource.split("/");
    const head = parts[0];
    const isSpaceGrants = head === "spaces" && parts.length === 3 && parts[2] === "grants";
    if (!["pages", "favorites", "recent", "attachments", "notifications", "search", "tags", "templates", "review-due"].includes(head) && !isSpaceGrants) return null;
    const [membership] = await db.select({ role: memberships.role }).from(memberships)
      .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId), eq(memberships.status, "active")));
    if (!membership) return notFound(head === "attachments" ? "File" : head === "spaces" ? "Space" : "Page");
    const context: Context = { db, uploadDir, databaseUploads, request, method, companyId, userId, admin: membership.role === "admin", parts };
    if (isSpaceGrants) return spaceGrants(context);
    if (head === "favorites") return favorites(context);
    if (head === "recent" && parts.length === 1 && method === "GET") return recent(context);
    if (head === "attachments" && parts.length === 2 && method === "GET") return download(context);
    if (head === "notifications") return notificationRoute(context, mail, origin);
    if (parts.length === 1 && method === "GET") {
      if (head === "search") return searchRoute(context);
      if (head === "tags") return tagListRoute(context);
      if (head === "templates") return templatesRoute();
      if (head === "review-due") return reviewDueRoute(context);
    }
    if (head === "pages") {
      const response = await pageRoute(context);
      await deliverPendingNotificationEmails(db, mail, origin, companyId);
      return response;
    }
    return notFound();
  };
}

async function pageRoute(context: Context): Promise<Response> {
  const { method, parts } = context;
  const [, pageId, action, extra] = parts;
  if (parts.length === 1 && method === "GET") return tree(context);
  if (parts.length === 1 && method === "POST") return create(context);
  if (pageId === "import-markdown" && parts.length === 2 && method === "POST") return importMarkdown(context);
  if (pageId === "archived" && parts.length === 2 && method === "GET") return trash(context);
  if (!pageId || !uuidPattern.test(pageId)) return notFound();
  if (parts.length === 2 && method === "GET") return view(context, pageId);
  if (parts.length === 2 && method === "PATCH") return rename(context, pageId);
  if (action === "export-markdown" && parts.length === 3 && method === "GET") return exportMarkdown(context, pageId);
  if (action === "public-snapshot" && parts.length === 3) return publicSnapshotRoute(context, pageId);
  if (action === "content" && parts.length === 3 && method === "PUT") return save(context, pageId);
  if (action === "revisions" && parts.length === 3 && method === "GET") return history(context, pageId);
  if (action === "revisions" && parts.length === 4 && method === "GET") return revision(context, pageId, extra);
  if (action === "revisions" && parts.length === 5 && parts[4] === "restore" && method === "POST") return restoreRevision(context, pageId, extra);
  if (action === "comments") return commentRoute(context, pageId);
  if (action === "activity" && parts.length === 3 && method === "GET") return activityRoute(context, pageId);
  if (action === "tags" && parts.length === 3) return pageTagsRoute(context, pageId);
  if (action === "backlinks" && parts.length === 3 && method === "GET") return backlinksRoute(context, pageId);
  if (action === "review" && parts.length === 3) return reviewRoute(context, pageId);
  if (action === "duplicate" && parts.length === 3 && method === "POST") return duplicate(context, pageId);
  if (action === "move" && parts.length === 3 && method === "POST") return move(context, pageId);
  if (action === "move-impact" && parts.length === 3 && method === "POST") return move(context, pageId, true);
  if (action === "archive" && parts.length === 3 && method === "POST") return archive(context, pageId);
  if (action === "restore" && parts.length === 3 && method === "POST") return restore(context, pageId);
  if (action === "grants" && parts.length === 3 && (method === "GET" || method === "PUT")) return pageGrantRoute(context, pageId);
  if (action === "attachments" && parts.length === 3 && method === "POST") return upload(context, pageId);
  return notFound();
}

async function snapshotPage(db: Db, context: Context, pageId: string, lock = false, allowArchived = false) {
  const query = db.select({ ownerId: pages.ownerId, archivedRootId: pages.archivedRootId, title: pages.title, slug: pages.slug, content: pages.content, revision: pages.revision })
    .from(pages).where(and(eq(pages.companyId, context.companyId), eq(pages.id, pageId)));
  const [page] = lock ? await query.for("update") : await query;
  if (!page || (page.archivedRootId && !allowArchived)) return notFound();
  if (!context.admin && page.ownerId !== context.userId) return notFound();
  return page;
}

async function publicSnapshotRoute(context: Context, pageId: string) {
  if (context.method === "GET") {
    await snapshotPage(context.db, context, pageId, false, true);
    const [snapshot] = await context.db.select({ tokenHash: publicPageSnapshots.tokenHash }).from(publicPageSnapshots)
      .where(and(eq(publicPageSnapshots.companyId, context.companyId), eq(publicPageSnapshots.pageId, pageId)));
    return json({ published: !!snapshot });
  }
  if (context.method === "POST") {
    return context.db.transaction(async tx => {
      const page = await snapshotPage(tx, context, pageId, true);
      await pageFor(tx, context.companyId, context.userId, pageId, "editor");
      const [existing] = await tx.select({ pageId: publicPageSnapshots.pageId }).from(publicPageSnapshots)
        .where(and(eq(publicPageSnapshots.companyId, context.companyId), eq(publicPageSnapshots.pageId, pageId)));
      if (existing) fail(409, "This page already has a public snapshot. Revoke it before publishing a new one.");
      const token = randomBytes(32).toString("hex");
      await tx.insert(publicPageSnapshots).values({ companyId: context.companyId, pageId, tokenHash: publicTokenHash(token),
        title: page.title, slug: page.slug, content: sanitizeContent(page.content), revision: page.revision });
      await audit(tx, context.companyId, context.userId, "page.public_snapshot_published", pageId);
      return json({ published: true, url: `${new URL(context.request.url).origin}/public/${token}` });
    });
  }
  if (context.method === "DELETE") {
    return context.db.transaction(async tx => {
      await snapshotPage(tx, context, pageId, true, true);
      const removed = await tx.delete(publicPageSnapshots).where(and(eq(publicPageSnapshots.companyId, context.companyId), eq(publicPageSnapshots.pageId, pageId))).returning({ pageId: publicPageSnapshots.pageId });
      if (removed.length) await audit(tx, context.companyId, context.userId, "page.public_snapshot_revoked", pageId);
      return json({ ok: true, published: false });
    });
  }
  return notFound();
}

// Sidebar tree: only pages the caller can view. A visible page under a hidden parent is shown at the top level,
// so restricted pages never appear, not even as titles or placeholders.
async function tree({ db, companyId, userId }: Context) {
  const roles = await visibleRoles(db, companyId, userId);
  const rows = await db.select({ id: pages.id, parentId: pages.parentId, spaceId: pages.spaceId, title: pages.title, slug: pages.slug, position: pages.position, inherits: pages.inherits, updatedAt: pages.updatedAt })
    .from(pages).where(and(eq(pages.companyId, companyId), isNull(pages.archivedAt))).orderBy(asc(pages.position), asc(pages.createdAt));
  const visible = rows.filter(row => roles.has(row.id))
    .map(row => ({ ...row, parentId: row.parentId && roles.has(row.parentId) ? row.parentId : null, role: roles.get(row.id)! }));
  return json({ pages: visible });
}

async function create({ db, request, companyId, userId }: Context) {
  const body = await bodyOf(request);
  // Optional built-in template: fills the content (sanitized like a save) and the title when none is given.
  const template = body.templateId === undefined || body.templateId === null ? undefined : templateById(body.templateId) ?? fail(400, "Unknown template.");
  const title = titleOf(body.title, "") || (template?.title ?? "");
  const content = template ? templateContent(template) : [];
  const parentId = optionalId(body.parentId, "parentId");
  let spaceId = optionalId(body.spaceId, "spaceId");
  const result = await db.transaction(async tx => {
    await lockSharing(tx, companyId);
    if (parentId) spaceId = (await pageFor(tx, companyId, userId, parentId, "editor")).page.spaceId;
    else if (await spaceRole(tx, companyId, userId, spaceId) !== "editor") notFound("Space");
    const id = randomUUID();
    const slug = newSlug(title);
    await tx.insert(pages).values({ id, companyId, spaceId, parentId, ownerId: userId, title, slug, position: await nextPosition(tx, companyId, parentId, spaceId), content, revision: 1, searchText: searchTextOf(content) });
    await tx.insert(pageRevisions).values({ companyId, pageId: id, revision: 1, content, authorId: userId });
    await syncLinks(tx, companyId, id, content);
    await audit(tx, companyId, userId, "page.created", id);
    await recordActivity(tx, companyId, id, userId, "created");
    return { id, slug };
  });
  return json(result);
}

function importPath(value: unknown) {
  if (typeof value !== "string") return fail(400, "Each Markdown file needs a safe relative path.");
  if (value.length < 1 || value.length > 1_000 || /[\u0000-\u001f\u007f]/.test(value)) fail(400, "Each Markdown file needs a safe relative path.");
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || parts.length > 64 || parts.some(part => !part || part === "." || part === ".." || part.length > 200)) fail(400, "Markdown paths must stay inside the selected import folder.");
  if (!/\.md$/i.test(parts.at(-1)!)) fail(400, "Only .md files can be imported.");
  return { normalized: parts.join("/"), parts };
}

async function importMarkdown({ db, request, companyId, userId }: Context) {
  const body = await bodyOf(request, maxMarkdownImportBytes);
  if (typeof body.spaceId !== "string" && body.spaceId !== null) fail(400, "spaceId must identify a space or be null.");
  const spaceId = optionalId(body.spaceId, "spaceId");
  if (await spaceRole(db, companyId, userId, spaceId) !== "editor") return notFound("Space");
  const inputFiles = body.files;
  if (!Array.isArray(inputFiles)) return fail(400, "Choose between 1 and 100 Markdown files.");
  if (inputFiles.length < 1 || inputFiles.length > 100) fail(400, "Choose between 1 and 100 Markdown files.");
  const fileValues: unknown[] = inputFiles;
  let totalBytes = 0;
  const paths = new Set<string>();
  const files = fileValues.map((value: unknown) => {
    const entry = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const path = importPath(entry.path);
    if (paths.has(path.normalized)) fail(400, "The import contains the same relative path more than once.");
    paths.add(path.normalized);
    const source = entry.content;
    if (typeof source !== "string") return fail(400, "Each Markdown file must contain text.");
    const bytes = Buffer.byteLength(source, "utf8");
    totalBytes += bytes;
    if (bytes > maxContentBytes || totalBytes > 8_000_000) fail(413, "Markdown files are too large to import.");
    return { ...path, source };
  });
  const directories = new Map<string, { path: string; parts: string[] }>();
  for (const file of files) {
    for (let index = 1; index < file.parts.length; index++) {
      const parts = file.parts.slice(0, index);
      const path = parts.join("/");
      directories.set(path, { path, parts });
    }
  }
  if (directories.size + files.length > 1_000) fail(400, "An import can create at most 1,000 pages.");
  const orderedDirectories = [...directories.values()].sort((left, right) => left.parts.length - right.parts.length || left.path.localeCompare(right.path));
  const created = await db.transaction(async tx => {
    const directoryIds = new Map<string, string>();
    const result: { id: string; title: string; path: string }[] = [];
    async function insertPage(path: string, title: string, parentId: string | null, content: unknown[]) {
      const safeContent = sanitizeContent(content);
      const id = randomUUID();
      const position = await nextPosition(tx, companyId, parentId, spaceId);
      await tx.insert(pages).values({ id, companyId, spaceId, parentId, ownerId: userId, title, slug: newSlug(title), position, content: safeContent, revision: 1, searchText: searchTextOf(safeContent) });
      await tx.insert(pageRevisions).values({ companyId, pageId: id, revision: 1, content: safeContent, authorId: userId });
      await syncLinks(tx, companyId, id, safeContent);
      await audit(tx, companyId, userId, "page.created", id);
      await recordActivity(tx, companyId, id, userId, "created");
      result.push({ id, title, path });
      return id;
    }
    for (const directory of orderedDirectories) {
      const parentPath = directory.parts.slice(0, -1).join("/");
      const parentId = parentPath ? directoryIds.get(parentPath)! : null;
      const title = directory.parts.at(-1)!.trim() || "Untitled";
      directoryIds.set(directory.path, await insertPage(directory.path, title, parentId, []));
    }
    for (const file of files) {
      const directoryParts = file.parts.slice(0, -1);
      const directoryPath = directoryParts.join("/");
      const parentId = directoryPath ? directoryIds.get(directoryPath)! : null;
      const filename = file.parts.at(-1)!;
      const fallbackTitle = filename.replace(/\.md$/i, "").trim() || "Untitled";
      const title = markdownImportTitle(file.source, fallbackTitle);
      await insertPage(file.normalized, title, parentId, markdownToContent(file.source));
    }
    return result;
  });
  return json({ imported: files.length, pages: created });
}

async function exportMarkdown(context: Context, pageId: string) {
  const { page } = await pageFor(context.db, context.companyId, context.userId, pageId, "viewer");
  const markdown = contentToMarkdown(page.title, sanitizeContent(page.content));
  const basename = page.slug.replace(/[^A-Za-z0-9._-]/g, "-") || "page";
  const filename = `${page.title || "Untitled"}.md`;
  return new Response(markdown, { headers: {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="${basename}.md"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}

const htmlEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => htmlEntities[character]);
const publicColors: Record<string, string> = { gray: "#71717a", brown: "#795548", red: "#c2413b", orange: "#c2410c", yellow: "#a16207", green: "#15803d", blue: "#2563eb", purple: "#7e22ce", pink: "#be185d" };

function publicInline(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "";
    const part = item as Record<string, unknown>;
    if (part.type === "link") {
      const href = safeLink(part.href);
      const text = publicInline(part.content);
      return href ? `<a href="${escapeHtml(href)}" rel="noreferrer noopener">${text}</a>` : text;
    }
    if (part.type !== "text") return "";
    const styles = part.styles && typeof part.styles === "object" ? part.styles as Record<string, unknown> : {};
    let text = escapeHtml(part.text);
    if (styles.code === true) text = `<code>${text}</code>`;
    if (styles.bold === true) text = `<strong>${text}</strong>`;
    if (styles.italic === true) text = `<em>${text}</em>`;
    if (styles.underline === true) text = `<u>${text}</u>`;
    if (styles.strike === true) text = `<s>${text}</s>`;
    const color = typeof styles.textColor === "string" ? publicColors[styles.textColor] : undefined;
    return color ? `<span style="color:${color}">${text}</span>` : text;
  }).join("");
}

function publicBlock(block: Record<string, unknown>): string {
  const props = block.props && typeof block.props === "object" ? block.props as Record<string, unknown> : {};
  const children = Array.isArray(block.children) ? publicBlocks(block.children) : "";
  const inline = publicInline(block.content);
  let output = "";
  if (block.type === "heading") {
    const level = Number(props.level);
    const tag = `h${Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1}`;
    output = `<${tag}>${inline}</${tag}>`;
  } else if (block.type === "paragraph") output = `<p>${inline || "&nbsp;"}</p>`;
  else if (block.type === "quote") output = `<blockquote><p>${inline}</p></blockquote>`;
  else if (block.type === "codeBlock") {
    const code = Array.isArray(block.content) ? block.content.map(part => part && typeof part === "object" ? String((part as Record<string, unknown>).text ?? "") : "").join("") : "";
    output = `<pre><code>${escapeHtml(code)}</code></pre>`;
  } else if (block.type === "table") {
    const tableContent = block.content && typeof block.content === "object" ? block.content as Record<string, unknown> : {};
    const rows = Array.isArray(tableContent.rows) ? tableContent.rows : [];
    const headerRows = Number(tableContent.headerRows) || 0;
    output = `<div class="table-wrap" style="width:100%;max-width:100%;overflow-x:auto"><table style="width:max-content;min-width:100%">${rows.map((row, index) => {
      const cells = row && typeof row === "object" && Array.isArray((row as Record<string, unknown>).cells) ? (row as Record<string, unknown>).cells as unknown[] : [];
      const tag = index < headerRows ? "th" : "td";
      return `<tr>${cells.map(cell => {
        const content = tableCellContent(cell);
        return `<${tag}>${publicInline(content)}</${tag}>`;
      }).join("")}</tr>`;
    }).join("")}</table></div>`;
  } else if (block.type === "image") {
    const url = safeMediaUrl(props.url);
    const caption = escapeHtml(props.caption || props.name || "Page image");
    output = url && !String(url).startsWith("/api/companies/") ? `<figure><img src="${escapeHtml(url)}" alt="${caption}">${props.caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>` : `<p class="attachment-note">${caption} (available in the workspace)</p>`;
  } else if (block.type === "file") {
    const url = safeMediaUrl(props.url);
    const name = escapeHtml(props.name || "Attached file");
    output = url && !String(url).startsWith("/api/companies/") ? `<p><a href="${escapeHtml(url)}" rel="noreferrer noopener">${name}</a></p>` : `<p class="attachment-note">${name} (available in the workspace)</p>`;
  }
  return output + children;
}

function publicBlocks(value: unknown): string {
  if (!Array.isArray(value)) return "";
  let output = "";
  for (let index = 0; index < value.length;) {
    const block = value[index];
    if (!block || typeof block !== "object" || Array.isArray(block)) { index++; continue; }
    const item = block as Record<string, unknown>;
    if (item.type === "bulletListItem" || item.type === "numberedListItem" || item.type === "checkListItem") {
      const listType = item.type;
      const tag = listType === "numberedListItem" ? "ol" : "ul";
      const rows: string[] = [];
      while (index < value.length) {
        const next = value[index];
        if (!next || typeof next !== "object" || Array.isArray(next) || (next as Record<string, unknown>).type !== listType) break;
        const row = next as Record<string, unknown>;
        const props = row.props && typeof row.props === "object" ? row.props as Record<string, unknown> : {};
        const checked = listType === "checkListItem" ? `<input type="checkbox" disabled${props.checked === true ? " checked" : ""} aria-label="${props.checked === true ? "Complete" : "Incomplete"}"> ` : "";
        const nested = Array.isArray(row.children) ? publicBlocks(row.children) : "";
        rows.push(`<li>${checked}${publicInline(row.content)}${nested}</li>`);
        index++;
      }
      output += `<${tag}>${rows.join("")}</${tag}>`;
      continue;
    }
    output += publicBlock(item);
    index++;
  }
  return output;
}

export function publicPageDocument(title: string, content: unknown): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title || "Untitled")} · Pages</title><style>
    :root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#27272a;background:#fff;font-size:16px;line-height:1.7}*{box-sizing:border-box}body{margin:0}.page{max-width:820px;margin:0 auto;padding:48px 28px 80px}header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:38px;color:#71717a;font-size:13px}.brand{font-weight:600;color:#52525b}.print{border:1px solid #d4d4d8;border-radius:7px;background:#fff;color:#27272a;padding:9px 13px;font:inherit;font-size:13px;cursor:pointer}.print:hover{background:#f4f4f5}h1{font-size:clamp(30px,5vw,42px);line-height:1.15;letter-spacing:-.04em;margin:0 0 36px}h2,h3,h4,h5,h6{line-height:1.3;margin:1.8em 0 .55em}p{margin:.7em 0}a{color:#2563eb}blockquote{margin:1.2em 0;border-left:3px solid #d4d4d8;padding:2px 0 2px 18px;color:#52525b}pre{overflow:auto;padding:16px;border-radius:8px;background:#f4f4f5;font-size:.9em}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f4f4f5;padding:.12em .3em;border-radius:4px}pre code{padding:0;background:none}figure{margin:1.4em 0}figure img{display:block;max-width:100%;height:auto;border-radius:7px}figcaption,.attachment-note{font-size:13px;color:#71717a}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;margin:1em 0}th,td{border:1px solid #e4e4e7;padding:8px 10px;text-align:left;vertical-align:top}th{background:#f4f4f5}li{padding-left:3px}input[type=checkbox]{accent-color:#2563eb}@media(max-width:600px){.page{padding:28px 20px 56px}header{margin-bottom:28px}}@media print{.page{max-width:none;padding:0 12mm}header{display:none}a{color:inherit;text-decoration:none}body{font-size:11pt}h1,h2,h3{break-after:avoid}img,table,blockquote,pre{break-inside:avoid}}
  </style></head><body><main class="page"><header><span class="brand">Pages · Public page</span><button class="print" type="button" onclick="window.print()">Save as PDF</button></header><article><h1>${escapeHtml(title || "Untitled")}</h1>${publicBlocks(sanitizeContent(content))}</article></main></body></html>`;
}

// Opening a page records it in the caller's recent pages. Breadcrumbs list only ancestors the caller can view.
async function view({ db, companyId, userId }: Context, pageId: string) {
  const { page, role } = await pageFor(db, companyId, userId, pageId, "viewer");
  const roles = await visibleRoles(db, companyId, userId);
  const breadcrumbs: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  let parentId = page.parentId;
  while (parentId && !seen.has(parentId) && seen.size < 256) {
    seen.add(parentId);
    const [parent] = await db.select({ id: pages.id, title: pages.title, parentId: pages.parentId }).from(pages).where(and(eq(pages.companyId, companyId), eq(pages.id, parentId)));
    if (!parent) break;
    if (roles.has(parent.id)) breadcrumbs.unshift({ id: parent.id, title: parent.title });
    parentId = parent.parentId;
  }
  await db.insert(pageVisits).values({ companyId, userId, pageId }).onConflictDoUpdate({ target: [pageVisits.companyId, pageVisits.userId, pageVisits.pageId], set: { visitedAt: new Date() } });
  const [favorite] = await db.select({ pageId: pageFavorites.pageId }).from(pageFavorites)
    .where(and(eq(pageFavorites.companyId, companyId), eq(pageFavorites.userId, userId), eq(pageFavorites.pageId, pageId)));
  return json({
    page: { id: page.id, title: page.title, slug: page.slug, spaceId: page.spaceId, parentId: page.parentId && roles.has(page.parentId) ? page.parentId : null,
      ownerId: page.ownerId, content: page.content, revision: page.revision, inherits: page.inherits, updatedAt: page.updatedAt, role, favorite: !!favorite,
      tags: await pageTagsOf(db, companyId, pageId), review: await reviewInfo(db, companyId, page) },
    breadcrumbs,
  });
}

async function rename({ db, request, companyId, userId }: Context, pageId: string) {
  const body = await bodyOf(request);
  const title = titleOf(body.title);
  await db.transaction(async tx => {
    await pageFor(tx, companyId, userId, pageId, "editor");
    await tx.update(pages).set({ title, updatedAt: new Date() }).where(and(eq(pages.companyId, companyId), eq(pages.id, pageId)));
    await audit(tx, companyId, userId, "page.renamed", pageId);
    await recordActivity(tx, companyId, pageId, userId, "renamed", title);
  });
  return json({ ok: true, title });
}

// Autosave. A stale baseRevision never overwrites: the caller gets 409 with the server's version and their own
// (cleaned) version so the editor can show both. Every accepted save becomes a new history revision.
async function save({ db, request, companyId, userId }: Context, pageId: string) {
  const body = await bodyOf(request, maxContentBytes + 16_384);
  const baseRevision = body.baseRevision;
  if (!Number.isInteger(baseRevision)) fail(400, "baseRevision is required.");
  const content = sanitizeContent(body.content);
  return db.transaction(async tx => {
    await pageFor(tx, companyId, userId, pageId, "editor");
    const [current] = await tx.select({ revision: pages.revision, content: pages.content }).from(pages)
      .where(and(eq(pages.companyId, companyId), eq(pages.id, pageId))).for("update");
    if (current.revision !== baseRevision) {
      return json({ message: "This page was changed by someone else. Compare both versions before saving again.",
        current: { revision: current.revision, content: current.content }, yours: { baseRevision, content } }, 409);
    }
    const revision = current.revision + 1;
    const anchoredContent = await preserveAnchors(tx, companyId, pageId, current.content, content);
    await tx.update(pages).set({ content: anchoredContent, revision, searchText: searchTextOf(anchoredContent), updatedAt: new Date() }).where(and(eq(pages.companyId, companyId), eq(pages.id, pageId)));
    await tx.insert(pageRevisions).values({ companyId, pageId, revision, content: anchoredContent, authorId: userId });
    await recordActivity(tx, companyId, pageId, userId, "edited");
    await refreshAnchors(tx, companyId, pageId, anchoredContent);
    await syncLinks(tx, companyId, pageId, anchoredContent);
    return json({ revision, content: anchoredContent });
  });
}

async function history({ db, companyId, userId }: Context, pageId: string) {
  await pageFor(db, companyId, userId, pageId, "viewer");
  const revisions = await db.select({ revision: pageRevisions.revision, authorId: pageRevisions.authorId, authorName: user.name, createdAt: pageRevisions.createdAt })
    .from(pageRevisions).innerJoin(user, eq(user.id, pageRevisions.authorId))
    .where(and(eq(pageRevisions.companyId, companyId), eq(pageRevisions.pageId, pageId))).orderBy(desc(pageRevisions.revision)).limit(200);
  return json({ revisions });
}

async function revision({ db, companyId, userId }: Context, pageId: string, value: string | undefined) {
  await pageFor(db, companyId, userId, pageId, "viewer");
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return notFound("Revision");
  const [row] = await db.select({ revision: pageRevisions.revision, content: pageRevisions.content, authorId: pageRevisions.authorId, createdAt: pageRevisions.createdAt })
    .from(pageRevisions).where(and(eq(pageRevisions.companyId, companyId), eq(pageRevisions.pageId, pageId), eq(pageRevisions.revision, number)));
  return json({ revision: row ?? notFound("Revision") });
}

// Copies the page and the descendants the caller can view (hidden subtrees are skipped) next to the original.
// The caller owns every copy. Restricted pages stay restricted: their grants are copied and the caller is added as editor.
async function duplicate({ db, companyId, userId }: Context, pageId: string) {
  const result = await db.transaction(async tx => {
    await lockSharing(tx, companyId);
    const { page } = await pageFor(tx, companyId, userId, pageId, "viewer");
    const destination = page.parentId ? await effectiveRole(tx, companyId, userId, page.parentId) : await spaceRole(tx, companyId, userId, page.spaceId);
    if (destination !== "editor") fail(403, "You need edit access where the copy would be placed.");
    const roles = await visibleRoles(tx, companyId, userId);
    const ids = await subtree(tx, companyId, pageId, row => !row.archivedRootId && roles.has(row.id));
    const originals = new Map((await tx.select().from(pages).where(and(eq(pages.companyId, companyId), inArray(pages.id, ids)))).map(row => [row.id, row]));
    const copies = new Map(ids.map(id => [id, randomUUID()]));
    for (const id of ids) {
      const original = originals.get(id)!;
      const copyId = copies.get(id)!;
      const isRoot = id === pageId;
      const title = isRoot ? `Copy of ${original.title || "Untitled"}`.slice(0, 200) : original.title;
      await tx.insert(pages).values({ id: copyId, companyId, spaceId: page.spaceId, parentId: isRoot ? page.parentId : copies.get(original.parentId!)!, ownerId: userId, title, slug: newSlug(title),
        position: isRoot ? await nextPosition(tx, companyId, page.parentId, page.spaceId) : original.position, inherits: original.inherits, content: original.content, revision: 1 });
      await tx.insert(pageRevisions).values({ companyId, pageId: copyId, revision: 1, content: original.content, authorId: userId });
      await syncLinks(tx, companyId, copyId, original.content);
      if (!original.inherits) {
        const grants = await tx.select().from(pageGrants).where(and(eq(pageGrants.companyId, companyId), eq(pageGrants.pageId, id)));
        const copied = grants.filter(grant => !(grant.principalType === "user" && grant.principalId === userId))
          .map(grant => ({ id: randomUUID(), companyId, pageId: copyId, principalType: grant.principalType, principalId: grant.principalId, role: grant.role }));
        copied.push({ id: randomUUID(), companyId, pageId: copyId, principalType: "user", principalId: userId, role: "editor" });
        await tx.insert(pageGrants).values(copied);
      }
    }
    await audit(tx, companyId, userId, "page.duplicated", `${pageId}->${copies.get(pageId)}`);
    return { id: copies.get(pageId)!, count: ids.length };
  });
  return json(result);
}

// Move, reorder or nest. Only parent, space and position change, so the page keeps its own sharing settings and
// restricted descendants stay restricted. Moving to another space carries the whole subtree into that space.
async function move({ db, request, companyId, userId }: Context, pageId: string, preview = false) {
  const body = await bodyOf(request);
  const parentId = optionalId(body.parentId, "parentId");
  if (body.position !== undefined && (!Number.isInteger(body.position) || (body.position as number) < 0)) fail(400, "position must be a whole number of 0 or more.");
  const result = await db.transaction(async tx => {
    await lockSharing(tx, companyId);
    const { page } = await pageFor(tx, companyId, userId, pageId, "viewer");
    await guardSubtree(tx, companyId, userId, pageId);
    let spaceId = body.spaceId === undefined ? page.spaceId : optionalId(body.spaceId, "spaceId");
    if (parentId && uuidPattern.test(parentId)) {
      if (!await effectiveRole(tx, companyId, userId, parentId)) return notFound();
      const [parent] = await tx.select({ spaceId: pages.spaceId }).from(pages).where(and(eq(pages.companyId, companyId), eq(pages.id, parentId)));
      if (parent) spaceId = parent.spaceId;
    }
    const check = await canMove(tx, companyId, userId, pageId, { parentId, spaceId });
    if (!check.ok) {
      if (check.reason.includes("not found")) fail(404, check.reason);
      fail(check.reason.startsWith("A page cannot") ? 409 : check.reason.includes("different space") ? 400 : 403, check.reason);
    }
    const impact = await moveImpact(tx, companyId, pageId, { parentId, spaceId });
    if (preview) return impact;
    if ((impact.changed && body.accessAcknowledgement !== impact.token) || (body.accessAcknowledgement !== undefined && body.accessAcknowledgement !== impact.token)) fail(409, "Access has changed. Review the move impact and explicitly confirm before moving.");
    await tx.update(pages).set({ parentId, spaceId, updatedAt: new Date() }).where(and(eq(pages.companyId, companyId), eq(pages.id, pageId)));
    if (spaceId !== page.spaceId) {
      const ids = await subtree(tx, companyId, pageId);
      await tx.update(pages).set({ spaceId }).where(and(eq(pages.companyId, companyId), inArray(pages.id, ids)));
    }
    const siblings = (await tx.select({ id: pages.id }).from(pages).where(and(siblingsOf(companyId, parentId, spaceId), ne(pages.id, pageId)))
      .orderBy(asc(pages.position), asc(pages.createdAt))).map(row => row.id);
    // `beforeId` places the page in front of a sibling the caller can see, so reordering works even when hidden siblings sit in between.
    const before = typeof body.beforeId === "string" ? siblings.indexOf(body.beforeId) : -1;
    const index = before >= 0 ? before : body.position === undefined ? siblings.length : body.position as number;
    siblings.splice(Math.min(index, siblings.length), 0, pageId);
    for (const [position, id] of siblings.entries()) await tx.update(pages).set({ position }).where(and(eq(pages.companyId, companyId), eq(pages.id, id)));
    await audit(tx, companyId, userId, "page.moved", `${pageId}->${parentId ?? spaceId ?? "company"}`);
    await recordActivity(tx, companyId, pageId, userId, "moved");
  });
  return json(preview ? result : { ok: true });
}

// Archiving keeps ids, slugs and content; descendants are marked with the archived page as their root.
async function archive({ db, companyId, userId }: Context, pageId: string) {
  await db.transaction(async tx => {
    await lockSharing(tx, companyId);
    await pageFor(tx, companyId, userId, pageId, "editor");
    await guardSubtree(tx, companyId, userId, pageId);
    const ids = await subtree(tx, companyId, pageId, row => !row.archivedRootId);
    await tx.update(pages).set({ archivedAt: new Date(), archivedRootId: pageId }).where(and(eq(pages.companyId, companyId), inArray(pages.id, ids)));
    await audit(tx, companyId, userId, "page.archived", pageId);
    await recordActivity(tx, companyId, pageId, userId, "archived");
  });
  return json({ ok: true });
}

// Restores the whole archived subtree. If its old parent is gone or still archived, it returns at the top of its space.
async function restore({ db, companyId, userId }: Context, pageId: string) {
  const result = await db.transaction(async tx => {
    await lockSharing(tx, companyId);
    if (!await canRestore(tx, companyId, userId, pageId)) {
      return await effectiveRole(tx, companyId, userId, pageId) ? fail(409, "This page is not archived.") : notFound();
    }
    const [page] = await tx.select({ rootId: pages.archivedRootId }).from(pages).where(and(eq(pages.companyId, companyId), eq(pages.id, pageId)));
    const rootId = page.rootId!;
    await tx.update(pages).set({ archivedAt: null, archivedRootId: null }).where(and(eq(pages.companyId, companyId), eq(pages.archivedRootId, rootId)));
    const [root] = await tx.select({ parentId: pages.parentId, spaceId: pages.spaceId }).from(pages).where(and(eq(pages.companyId, companyId), eq(pages.id, rootId)));
    const [parent] = root.parentId ? await tx.select({ archivedAt: pages.archivedAt }).from(pages).where(and(eq(pages.companyId, companyId), eq(pages.id, root.parentId))) : [];
    if (root.parentId && (!parent || parent.archivedAt)) {
      await tx.update(pages).set({ parentId: null, position: await nextPosition(tx, companyId, null, root.spaceId) }).where(and(eq(pages.companyId, companyId), eq(pages.id, rootId)));
    }
    await audit(tx, companyId, userId, "page.restored", rootId);
    await recordActivity(tx, companyId, rootId, userId, "restored");
    return { id: rootId };
  });
  return json(result);
}

// Trash: archived pages (subtree roots only) that the caller may restore.
async function trash({ db, companyId, userId }: Context) {
  const roots = await db.select({ id: pages.id, title: pages.title, spaceId: pages.spaceId, archivedAt: pages.archivedAt }).from(pages)
    .where(and(eq(pages.companyId, companyId), eq(pages.archivedRootId, pages.id))).orderBy(desc(pages.archivedAt));
  const allowed = [];
  for (const root of roots) if (await canRestore(db, companyId, userId, root.id)) allowed.push(root);
  return json({ pages: allowed });
}

// Page sharing: effective page editors only. `inherits: true` drops the page's own grants and follows its parent again.
async function pageGrantRoute({ db, request, method, companyId, userId }: Context, pageId: string) {
  if (method === "GET") {
    const { page, role } = await pageFor(db, companyId, userId, pageId, "viewer");
    const canManage = role === "editor";
    const membership = await activeMember(db, companyId, userId);
    return json({ inherits: page.inherits, role, workspaceRole: membership?.role, canManage, grants: canManage ? await describeGrants(db, companyId, eq(pageGrants.pageId, pageId)) : [], inherited: await inheritedAccess(db, companyId, userId, page, canManage) });
  }
  const body = await bodyOf(request);
  if (typeof body.inherits !== "boolean") fail(400, "inherits must be true or false.");
  await pageFor(db, companyId, userId, pageId, "editor");
  await db.transaction(async tx => {
    await lockSharing(tx, companyId);
    await pageFor(tx, companyId, userId, pageId, "editor");
    const grants = body.inherits ? [] : await grantList(tx, companyId, body.grants);
    const before = await tx.select({ principalType: pageGrants.principalType, principalId: pageGrants.principalId, role: pageGrants.role }).from(pageGrants)
      .where(and(eq(pageGrants.companyId, companyId), eq(pageGrants.pageId, pageId)));
    await tx.delete(pageGrants).where(and(eq(pageGrants.companyId, companyId), eq(pageGrants.pageId, pageId)));
    if (grants.length) await tx.insert(pageGrants).values(grants.map(grant => ({ id: randomUUID(), companyId, pageId, ...grant })));
    await tx.update(pages).set({ inherits: body.inherits as boolean }).where(and(eq(pages.companyId, companyId), eq(pages.id, pageId)));
    if (await effectiveRole(tx, companyId, userId, pageId) !== "editor" && body.confirmSelfLockout !== true) fail(409, "These settings remove your edit access. Confirm self-lockout to save; you may be unable to undo this change.");
    await audit(tx, companyId, userId, "page.grants_changed", pageId);
    await recordActivity(tx, companyId, pageId, userId, "access_changed");
    // People whose own or group grant changed hear about it, if they can still view the page.
    await notify(tx, companyId, { recipients: await affectedByGrantChange(tx, companyId, before, grants), kind: "access", pageId, actorId: userId });
  });
  return json({ ok: true });
}

// Space sharing: admins, or members who already hold an explicit editor grant on the space. An open space
// (no grants) gives every member editor access to its pages, but only admins can first restrict it.
// Saving an empty list reopens the space to all active members.
async function spaceGrants({ db, request, method, companyId, userId, admin, parts }: Context) {
  const spaceId = parts[1];
  const allowed = async (tx: Db) => {
    const [space] = await tx.select({ id: spaces.id }).from(spaces).where(and(eq(spaces.companyId, companyId), eq(spaces.id, spaceId)));
    if (!space) return notFound("Space");
    const [membership] = await tx.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId), eq(memberships.status, "active")));
    if (!membership) return notFound("Space");
    if (membership.role === "admin") return true;
    const [existing] = await tx.select({ id: pageGrants.id }).from(pageGrants).where(and(eq(pageGrants.companyId, companyId), eq(pageGrants.spaceId, spaceId))).limit(1);
    const role = await spaceRole(tx, companyId, userId, spaceId);
    if (!role) notFound("Space");
    if (!existing || role !== "editor") fail(403, "Only space editors or administrators can change space sharing.");
    return false;
  };
  if (method === "GET") {
    const [space] = await db.select({ id: spaces.id }).from(spaces).where(and(eq(spaces.companyId, companyId), eq(spaces.id, spaceId)));
    if (!space) return notFound("Space");
    const role = await spaceRole(db, companyId, userId, spaceId);
    if (!admin && !role) return notFound("Space");
    const grants = await describeGrants(db, companyId, eq(pageGrants.spaceId, spaceId));
    const canManage = admin || (grants.length > 0 && role === "editor");
    const membership = await activeMember(db, companyId, userId);
    return json({ inherits: false, role, workspaceRole: membership?.role, canManage, workspaceAccess: !grants.length, grants: canManage ? grants : [] });
  }
  if (method !== "PUT") return notFound("Space");
  await allowed(db);
  const body = await bodyOf(request);
  await db.transaction(async tx => {
    await lockSharing(tx, companyId);
    const managingAsAdmin = await allowed(tx);
    const grants = await grantList(tx, companyId, body.grants);
    await tx.delete(pageGrants).where(and(eq(pageGrants.companyId, companyId), eq(pageGrants.spaceId, spaceId)));
    if (grants.length) await tx.insert(pageGrants).values(grants.map(grant => ({ id: randomUUID(), companyId, spaceId, ...grant })));
    if (!managingAsAdmin && await spaceRole(tx, companyId, userId, spaceId) !== "editor" && body.confirmSelfLockout !== true) fail(409, "These settings remove your space edit access. Confirm self-lockout to save; you may be unable to undo this change.");
    await audit(tx, companyId, userId, "space.grants_changed", spaceId);
  });
  return json({ ok: true });
}

// Favorites and recents are per user; lists only ever include pages the caller can currently view.
async function favorites({ db, method, companyId, userId, parts }: Context) {
  if (parts.length === 1 && method === "GET") {
    const roles = await visibleRoles(db, companyId, userId);
    const rows = await db.select({ id: pages.id, title: pages.title, spaceId: pages.spaceId }).from(pageFavorites)
      .innerJoin(pages, and(eq(pages.companyId, pageFavorites.companyId), eq(pages.id, pageFavorites.pageId)))
      .where(and(eq(pageFavorites.companyId, companyId), eq(pageFavorites.userId, userId))).orderBy(desc(pageFavorites.createdAt));
    return json({ pages: rows.filter(row => roles.has(row.id)) });
  }
  const pageId = parts[1];
  if (parts.length !== 2 || !uuidPattern.test(pageId)) return notFound();
  if (method === "PUT") {
    await pageFor(db, companyId, userId, pageId, "viewer");
    await db.insert(pageFavorites).values({ companyId, userId, pageId }).onConflictDoNothing();
    return json({ ok: true });
  }
  if (method === "DELETE") {
    await db.delete(pageFavorites).where(and(eq(pageFavorites.companyId, companyId), eq(pageFavorites.userId, userId), eq(pageFavorites.pageId, pageId)));
    return json({ ok: true });
  }
  return notFound();
}

async function recent({ db, companyId, userId }: Context) {
  const roles = await visibleRoles(db, companyId, userId);
  const rows = await db.select({ id: pages.id, title: pages.title, spaceId: pages.spaceId, visitedAt: pageVisits.visitedAt }).from(pageVisits)
    .innerJoin(pages, and(eq(pages.companyId, pageVisits.companyId), eq(pages.id, pageVisits.pageId)))
    .where(and(eq(pageVisits.companyId, companyId), eq(pageVisits.userId, userId))).orderBy(desc(pageVisits.visitedAt)).limit(100);
  return json({ pages: rows.filter(row => roles.has(row.id)).slice(0, 20) });
}

// Upload: multipart field `file`, or the raw file as the body with its name in an `x-file-name` header (URL-encoded).
// The type comes from an allowlisted extension; images and PDFs must also start with the matching file signature.
async function upload({ db, uploadDir, databaseUploads, request, companyId, userId }: Context, pageId: string) {
  await pageFor(db, companyId, userId, pageId, "editor");
  const tooLarge = () => fail(413, "Files can be up to 10 MB.");
  if (Number(request.headers.get("content-length") || 0) > maxUpload + 64 * 1024) tooLarge();
  let name = "", data: Buffer;
  if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => fail(400, "Upload a file."));
    const file = form.get("file");
    if (!(file instanceof File)) return fail(400, "Upload a file.");
    if (file.size > maxUpload) tooLarge();
    name = file.name;
    data = Buffer.from(await file.arrayBuffer());
  } else {
    try { name = decodeURIComponent(request.headers.get("x-file-name") ?? ""); } catch { fail(400, "The file name is invalid."); }
    data = Buffer.from(await request.arrayBuffer());
  }
  if (data.length > maxUpload) tooLarge();
  if (!data.length) fail(400, "The file is empty.");
  const filename = cleanFilename(name);
  const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const type = fileTypes[extension] ?? fail(415, "This file type is not allowed. Use an image, PDF, Office document, text, CSV or Markdown file.");
  if (type.magic && !type.magic(data)) fail(415, "The file content does not match its type.");
  const id = randomUUID();
  const storageKey = randomBytes(24).toString("hex");
  const path = join(uploadDir, storageKey);
  if (!databaseUploads) {
    await mkdir(uploadDir, { recursive: true, mode: 0o700 });
    await writeFile(path, data, { mode: 0o600, flag: "wx" });
  }
  try {
    await db.transaction(async tx => {
      await pageFor(tx, companyId, userId, pageId, "editor");
      await tx.insert(attachments).values({ id, companyId, pageId, uploaderId: userId, filename, mimeType: type.mime, size: data.length, storageKey });
      if (databaseUploads) await tx.insert(attachmentContents).values({ attachmentId: id, bodyBase64: data.toString("base64") });
      await audit(tx, companyId, userId, "attachment.uploaded", `${pageId}:${id}`);
    });
  } catch (error) { if (!databaseUploads) await unlink(path).catch(() => undefined); throw error; }
  return json({ id, url: `/api/companies/${companyId}/attachments/${id}`, filename, mimeType: type.mime, size: data.length });
}

// Download only through this endpoint, and only while the caller can view the attachment's page.
async function download({ db, uploadDir, databaseUploads, companyId, userId, parts }: Context) {
  const id = parts[1];
  if (!uuidPattern.test(id)) return notFound("File");
  const [file] = await db.select().from(attachments).where(and(eq(attachments.companyId, companyId), eq(attachments.id, id)));
  if (!file || !/^[a-f0-9]{48}$/.test(file.storageKey) || !await effectiveRole(db, companyId, userId, file.pageId)) return notFound("File");
  let data: Buffer;
  if (databaseUploads) {
    const [content] = await db.select().from(attachmentContents).where(eq(attachmentContents.attachmentId, id));
    if (!content) return notFound("File");
    data = Buffer.from(content.bodyBase64, "base64");
    if (data.length !== file.size) return fail(500, "Stored file could not be read.");
  } else {
    data = await readFile(join(uploadDir, file.storageKey)).catch(() => notFound("File"));
  }
  const inline = Object.values(fileTypes).some(type => type.inline && type.mime === file.mimeType);
  const fallback = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_") || "download";
  return new Response(new Uint8Array(data), { headers: {
    "Content-Type": file.mimeType.startsWith("text/") ? `${file.mimeType}; charset=utf-8` : file.mimeType,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    "Content-Length": String(data.length), "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}
