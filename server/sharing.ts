import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "./database.ts";
import { companies, groupMembers, memberships, pageGrants, pages } from "./schema.ts";
import type { PageRole } from "./permissions.ts";

type Db = Database | Transaction;
const rank = { viewer: 1, commenter: 2, editor: 3 };

export async function lockSharing(db: Db, companyId: string) {
  await db.select({ companyId: companies.companyId }).from(companies).where(eq(companies.companyId, companyId)).for("update");
}

export async function moveImpact(db: Db, companyId: string, pageId: string, target: { parentId: string | null; spaceId: string | null }) {
  const nodes = await db.select({ id: pages.id, parentId: pages.parentId, spaceId: pages.spaceId, inherits: pages.inherits, archivedRootId: pages.archivedRootId }).from(pages).where(eq(pages.companyId, companyId));
  const grants = await db.select().from(pageGrants).where(eq(pageGrants.companyId, companyId));
  const members = await db.select({ userId: memberships.userId, role: memberships.role }).from(memberships).where(and(eq(memberships.companyId, companyId), eq(memberships.status, "active")));
  const links = await db.select().from(groupMembers).where(eq(groupMembers.companyId, companyId));
  const affected = new Set([pageId]);
  for (let previous = 0; previous !== affected.size;) {
    previous = affected.size;
    for (const node of nodes) if (node.parentId && affected.has(node.parentId)) affected.add(node.id);
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const roleFor = (id: string, member: typeof members[number], moved: boolean): PageRole | null => {
    let current = byId.get(id);
    if (member.role === "admin" && current && !current.archivedRootId) return "editor";
    const seen = new Set<string>();
    while (current && !current.archivedRootId && !seen.has(current.id) && seen.size < 256) {
      seen.add(current.id);
      const parentId = moved && current.id === pageId ? target.parentId : current.parentId;
      const spaceId = moved && affected.has(current.id) ? target.spaceId : current.spaceId;
      if (!current.inherits || !parentId) {
        const entries = grants.filter(grant => !current!.inherits ? grant.pageId === current!.id : !!spaceId && grant.spaceId === spaceId);
        let role: PageRole | null = current.inherits && !entries.length ? "editor" : null;
        for (const grant of entries) {
          const applies = grant.principalType === "user" ? grant.principalId === member.userId : links.some(link => link.userId === member.userId && link.groupId === grant.principalId);
          if (applies && (!role || rank[grant.role] > rank[role])) role = grant.role;
        }
        return role && member.role === "viewer" ? "viewer" : role;
      }
      current = byId.get(parentId);
    }
    return null;
  };
  const audience = [...affected].sort().flatMap(id => members.slice().sort((left, right) => left.userId.localeCompare(right.userId)).map(member => [id, member.userId, roleFor(id, member, false), roleFor(id, member, true)]));
  const changed = audience.some(entry => entry[2] !== entry[3]);
  const token = createHash("sha256").update(JSON.stringify({ companyId, pageId, target, audience })).digest("hex");
  return { changed, token };
}
