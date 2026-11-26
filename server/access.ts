import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "./database.ts";
import { memberships, pages, user } from "./schema.ts";
import { fail } from "./http.ts";
import { effectiveRole, type PageRole } from "./permissions.ts";

// Shared helpers for the Step 3 routes (comments, history, activity, notifications).
export type Db = Database | Transaction;
export type RouteContext = { db: Database; request: Request; method: string; companyId: string; userId: string; admin: boolean; parts: string[] };
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rank: Record<PageRole, number> = { viewer: 1, commenter: 2, editor: 3 };
export const notFound = (what = "Page"): never => fail(404, `${what} not found.`);

// Same rule as pageFor in pages.ts: a page the caller cannot view is indistinguishable from a missing one.
export async function pageAccess(db: Db, companyId: string, userId: string, pageId: string, need: PageRole) {
  if (!uuidPattern.test(pageId)) return notFound();
  const role = await effectiveRole(db, companyId, userId, pageId);
  if (!role) return notFound();
  if (rank[role] < rank[need]) fail(403, need === "editor" ? "You need edit access to this page." : need === "commenter" ? "You need comment access to this page." : "You do not have access to do this.");
  const [page] = await db.select().from(pages).where(and(eq(pages.companyId, companyId), eq(pages.id, pageId)));
  return { page: page ?? notFound(), role };
}

// Plain text from the browser: control characters (except tab and newline) removed, trimmed, length-checked.
export function plainText(value: unknown, key: string, max: number, min = 1) {
  if (typeof value !== "string") return fail(400, `${key} must be text.`);
  const clean = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (clean.length < min || clean.length > max) return fail(400, `${key} must be ${min}–${max} characters.`);
  return clean;
}

// Names of the company's members (active or not), for author and actor labels.
export async function memberNames(db: Db, companyId: string) {
  const rows = await db.select({ id: user.id, name: user.name }).from(memberships).innerJoin(user, eq(user.id, memberships.userId)).where(eq(memberships.companyId, companyId));
  return new Map(rows.map(row => [row.id, row.name]));
}
