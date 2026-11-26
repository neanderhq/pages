import { and, eq, type SQL } from "drizzle-orm";
import type { Database, Transaction } from "./database.ts";
import { groupMembers, memberships, pageGrants, pages, spaces } from "./schema.ts";

// Server-side page authorization. Every query is scoped by companyId, so ids from the browser can never reach another company.
export type PageRole = "editor" | "commenter" | "viewer";
type Db = Database | Transaction;
type PageNode = { id: string; parentId: string | null; spaceId: string | null; inherits: boolean; archivedRootId: string | null };
const rank: Record<PageRole, number> = { viewer: 1, commenter: 2, editor: 3 };
const maxDepth = 256;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function capRole(role: PageRole | null, workspaceRole: string): PageRole | null {
  return role && workspaceRole === "viewer" ? "viewer" : role;
}

export async function activeMember(db: Db, companyId: string, userId: string) {
  const [membership] = await db.select({ role: memberships.role }).from(memberships)
    .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId), eq(memberships.status, "active")));
  return membership ?? null;
}

async function loadPage(db: Db, companyId: string, pageId: string): Promise<PageNode | null> {
  if (!uuidPattern.test(pageId)) return null;
  const [page] = await db.select({ id: pages.id, parentId: pages.parentId, spaceId: pages.spaceId, inherits: pages.inherits, archivedRootId: pages.archivedRootId })
    .from(pages).where(and(eq(pages.companyId, companyId), eq(pages.id, pageId)));
  return page ?? null;
}

// Grants on one target: user grants plus grants to the user's groups in this company; the highest role wins.
async function explicitRole(db: Db, companyId: string, userId: string, target: SQL) {
  const grants = await db.select({ principalType: pageGrants.principalType, principalId: pageGrants.principalId, role: pageGrants.role })
    .from(pageGrants).where(and(eq(pageGrants.companyId, companyId), target));
  if (!grants.length) return { hasGrants: false, role: null };
  const groupIds = new Set((await db.select({ groupId: groupMembers.groupId }).from(groupMembers)
    .where(and(eq(groupMembers.companyId, companyId), eq(groupMembers.userId, userId)))).map(row => row.groupId));
  let role: PageRole | null = null;
  for (const grant of grants) {
    const applies = grant.principalType === "user" ? grant.principalId === userId : groupIds.has(grant.principalId);
    if (applies && (!role || rank[grant.role] > rank[role])) role = grant.role;
  }
  return { hasGrants: true, role };
}

// The company space (spaceId null) and spaces without explicit grants give every active member editor access.
async function spaceRoleFor(db: Db, companyId: string, userId: string, spaceId: string | null): Promise<PageRole | null> {
  if (!spaceId) return "editor";
  const access = await explicitRole(db, companyId, userId, eq(pageGrants.spaceId, spaceId));
  return access.hasGrants ? access.role : "editor";
}

// Walks up to the nearest page with explicit settings, ignoring archive state. Broken or cyclic chains fail closed.
async function treeRole(db: Db, companyId: string, userId: string, pageId: string): Promise<PageRole | null> {
  const seen = new Set<string>();
  let current = await loadPage(db, companyId, pageId);
  while (current) {
    if (seen.has(current.id) || seen.size >= maxDepth) return null;
    seen.add(current.id);
    if (!current.inherits) return (await explicitRole(db, companyId, userId, eq(pageGrants.pageId, current.id))).role;
    if (!current.parentId) return spaceRoleFor(db, companyId, userId, current.spaceId);
    current = await loadPage(db, companyId, current.parentId);
  }
  return null;
}

// Archived pages give no access at all; use canRestore for the trash.
export async function effectiveRole(db: Db, companyId: string, userId: string, pageId: string): Promise<PageRole | null> {
  const membership = await activeMember(db, companyId, userId);
  if (!membership) return null;
  const page = await loadPage(db, companyId, pageId);
  if (!page || page.archivedRootId) return null;
  if (membership.role === "admin") return "editor";
  return capRole(await treeRole(db, companyId, userId, page.id), membership.role);
}

// Restoring an archived page needs editor access at the page that was archived (the root of the archived subtree).
export async function canRestore(db: Db, companyId: string, userId: string, pageId: string): Promise<boolean> {
  const membership = await activeMember(db, companyId, userId);
  if (!membership) return false;
  const page = await loadPage(db, companyId, pageId);
  if (!page?.archivedRootId) return false;
  if (membership.role === "admin") return true;
  return capRole(await treeRole(db, companyId, userId, page.archivedRootId), membership.role) === "editor";
}

// True when making newParentId the parent of pageId would put the page under itself or one of its descendants.
// Broken or overly deep chains also count as loops so callers fail closed.
export async function wouldCreateLoop(db: Db, companyId: string, pageId: string, newParentId: string | null): Promise<boolean> {
  const seen = new Set<string>();
  let ancestor = newParentId ? await loadPage(db, companyId, newParentId) : null;
  if (newParentId && !ancestor) return true;
  while (ancestor) {
    if (ancestor.id === pageId || seen.has(ancestor.id) || seen.size >= maxDepth) return true;
    seen.add(ancestor.id);
    if (!ancestor.parentId) return false;
    ancestor = await loadPage(db, companyId, ancestor.parentId);
    if (!ancestor) return true;
  }
  return false;
}

export async function spaceRole(db: Db, companyId: string, userId: string, spaceId: string | null): Promise<PageRole | null> {
  const membership = await activeMember(db, companyId, userId);
  if (!membership) return null;
  if (spaceId) {
    const [space] = await db.select({ id: spaces.id }).from(spaces).where(and(eq(spaces.companyId, companyId), eq(spaces.id, spaceId)));
    if (!space) return null;
  }
  return membership.role === "admin" ? "editor" : capRole(await spaceRoleFor(db, companyId, userId, spaceId), membership.role);
}

// Batch form of effectiveRole for lists (sidebar, favorites, recents, duplicate): same rules, evaluated in memory
// from one read of the company's pages and grants. Only active pages the user can at least view are returned.
export async function visibleRoles(db: Db, companyId: string, userId: string): Promise<Map<string, PageRole>> {
  const roles = new Map<string, PageRole>();
  const membership = await activeMember(db, companyId, userId);
  if (!membership) return roles;
  const nodes = await db.select({ id: pages.id, parentId: pages.parentId, spaceId: pages.spaceId, inherits: pages.inherits, archivedRootId: pages.archivedRootId })
    .from(pages).where(eq(pages.companyId, companyId));
  const grants = await db.select().from(pageGrants).where(eq(pageGrants.companyId, companyId));
  const groupIds = new Set((await db.select({ groupId: groupMembers.groupId }).from(groupMembers)
    .where(and(eq(groupMembers.companyId, companyId), eq(groupMembers.userId, userId)))).map(row => row.groupId));
  const explicit = (matches: (grant: typeof grants[number]) => boolean) => {
    let role: PageRole | null = null;
    for (const grant of grants.filter(matches)) {
      const applies = grant.principalType === "user" ? grant.principalId === userId : groupIds.has(grant.principalId);
      if (applies && (!role || rank[grant.role] > rank[role])) role = grant.role;
    }
    return role;
  };
  const spaceRoles = new Map<string | null, PageRole | null>();
  const forSpace = (spaceId: string | null) => {
    if (!spaceId) return "editor" as const;
    if (!spaceRoles.has(spaceId)) spaceRoles.set(spaceId, grants.some(grant => grant.spaceId === spaceId) ? explicit(grant => grant.spaceId === spaceId) : "editor");
    return spaceRoles.get(spaceId)!;
  };
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    if (node.archivedRootId) continue;
    if (membership.role === "admin") { roles.set(node.id, "editor"); continue; }
    const seen = new Set<string>();
    let current: PageNode | undefined = node, role: PageRole | null = null;
    while (current && !seen.has(current.id) && seen.size < maxDepth) {
      seen.add(current.id);
      const id = current.id;
      if (!current.inherits) { role = explicit(grant => grant.pageId === id); break; }
      if (!current.parentId) { role = forSpace(current.spaceId); break; }
      current = byId.get(current.parentId);
    }
    const capped = capRole(role, membership.role);
    if (capped) roles.set(node.id, capped);
  }
  return roles;
}

export type MoveCheck = { ok: true } | { ok: false; reason: string };

// Moving needs editor access to the page and to the destination, which must be in the same company and not inside the page itself.
// A move only changes parent/space: the page keeps its own explicit settings and restricted descendants stay restricted.
export async function canMove(db: Db, companyId: string, userId: string, pageId: string, target: { parentId: string | null; spaceId: string | null }): Promise<MoveCheck> {
  const page = await loadPage(db, companyId, pageId);
  if (!page || page.archivedRootId) return { ok: false, reason: "Page not found." };
  if (await effectiveRole(db, companyId, userId, pageId) !== "editor") return { ok: false, reason: "You need edit access to move this page." };
  if (!target.parentId) {
    return await spaceRole(db, companyId, userId, target.spaceId) === "editor" ? { ok: true } : { ok: false, reason: "You need edit access to the destination space." };
  }
  if (target.parentId === pageId) return { ok: false, reason: "A page cannot be moved into itself." };
  const parent = await loadPage(db, companyId, target.parentId);
  if (!parent || parent.archivedRootId) return { ok: false, reason: "Destination page not found." };
  if (parent.spaceId !== target.spaceId) return { ok: false, reason: "Destination page is in a different space." };
  if (await wouldCreateLoop(db, companyId, pageId, parent.id)) return { ok: false, reason: "A page cannot be moved into one of its own subpages." };
  if (await effectiveRole(db, companyId, userId, parent.id) !== "editor") return { ok: false, reason: "You need edit access to the destination page." };
  return { ok: true };
}
