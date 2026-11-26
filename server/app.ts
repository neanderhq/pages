import { randomBytes, randomUUID, createHash } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { APIError } from "better-auth";
import { createAuth } from "./auth.ts";
import { createMailProvider, MailDeliveryError, type MailProvider } from "./mail.ts";
import type { Database, Transaction } from "./database.ts";
import { companies, memberships, user, session, verification, invitations, groups, groupMembers, spaces, pages, auditEvents, publicPageSnapshots } from "./schema.ts";
import { HttpError, fail, json, field, bodyOf } from "./http.ts";
import { createPageRoutes, isRawUpload, publicPageDocument } from "./pages.ts";
import { decryptInvitationToken, encryptInvitationToken, isWorkspaceRole } from "./invitations.ts";
import { uuidPattern } from "./access.ts";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
function emailField(body: Record<string, unknown>) {
  const email = field(body, "email", 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Enter a valid email address.");
  return email;
}
async function audit(tx: Transaction, companyId: string, actor: string, action: string, target: string) {
  await tx.insert(auditEvents).values({ id: randomUUID(), companyId, actor, action, target });
}
type AuditTargetReference =
  | { kind: "page" | "member" | "group" | "space" | "invitation" | "unknown"; id: string }
  | { kind: "group-member"; id: string; groupId: string; memberId: string };
function auditTargetReference(action: string, target: string): AuditTargetReference {
  if (action.startsWith("page.")) return { kind: "page", id: target.split(/->|:/, 1)[0] };
  if (action === "attachment.uploaded") return { kind: "page", id: target.split(":", 1)[0] };
  if (action.startsWith("membership.")) return { kind: "member", id: target.split(":", 1)[0] };
  if (action === "company.created" || action === "invitation.accepted") return { kind: "member", id: target.split(":", 1)[0] };
  if (action.startsWith("group.member_")) {
    const [groupId, memberId] = target.split(":");
    if (!groupId || !memberId) return { kind: "unknown", id: target };
    return { kind: "group-member", id: `${groupId}:${memberId}`, groupId, memberId };
  }
  if (action === "group.created") return { kind: "group", id: target };
  if (action.startsWith("space.")) return { kind: "space", id: target };
  if (action === "invitation.created") return { kind: "invitation", id: target };
  return { kind: "unknown", id: target };
}
async function auditTargetLabels(db: Database, companyId: string, events: { action: string; target: string }[]) {
  const references = events.map(event => auditTargetReference(event.action, event.target));
  const idsByKind = (kind: string) => [...new Set(references.filter(reference => reference.kind === kind).map(reference => reference.id))];
  const groupMemberReferences = references.filter(reference => reference.kind === "group-member");
  const pageIds = idsByKind("page").filter(id => uuidPattern.test(id));
  const memberIds = idsByKind("member").concat(groupMemberReferences.map(reference => reference.memberId));
  const groupIds = idsByKind("group").concat(groupMemberReferences.map(reference => reference.groupId));
  const [pageRows, memberRows, groupRows, spaceRows, invitationRows] = await Promise.all([
    pageIds.length ? db.select({ id: pages.id, title: pages.title }).from(pages).where(and(eq(pages.companyId, companyId), inArray(pages.id, pageIds))) : [],
    memberIds.length ? db.select({ id: user.id, name: user.name, email: user.email }).from(memberships).innerJoin(user, eq(user.id, memberships.userId)).where(and(eq(memberships.companyId, companyId), inArray(memberships.userId, memberIds))) : [],
    groupIds.length ? db.select({ id: groups.id, name: groups.name }).from(groups).where(and(eq(groups.companyId, companyId), inArray(groups.id, groupIds))) : [],
    idsByKind("space").length ? db.select({ id: spaces.id, name: spaces.name }).from(spaces).where(and(eq(spaces.companyId, companyId), inArray(spaces.id, idsByKind("space")))) : [],
    idsByKind("invitation").length ? db.select({ id: invitations.id, email: invitations.email }).from(invitations).where(and(eq(invitations.companyId, companyId), inArray(invitations.id, idsByKind("invitation")))) : [],
  ]);
  const pagesById = new Map(pageRows.map(row => [row.id, row.title || "Untitled page"]));
  const membersById = new Map(memberRows.map(row => [row.id, row.name || row.email]));
  const groupsById = new Map(groupRows.map(row => [row.id, row.name]));
  const spacesById = new Map(spaceRows.map(row => [row.id, row.name]));
  const invitationsById = new Map(invitationRows.map(row => [row.id, row.email]));
  return events.map(event => {
    const reference = auditTargetReference(event.action, event.target);
    const targetLabel = reference.kind === "page" ? pagesById.get(reference.id)
      : reference.kind === "member" ? membersById.get(reference.id)
      : reference.kind === "group" ? groupsById.get(reference.id)
      : reference.kind === "space" ? spacesById.get(reference.id)
      : reference.kind === "invitation" ? invitationsById.get(reference.id)
      : reference.kind === "group-member" ? [groupsById.get(reference.groupId), membersById.get(reference.memberId)].filter(Boolean).join(" · ") || undefined
      : undefined;
    return { ...event, targetLabel: targetLabel ?? null };
  });
}
async function validInvitation(tx: Transaction, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return fail(400, "This invitation is invalid, expired or already used.");
  const tokenHash = hash(token);
  const [invite] = await tx.select().from(invitations).where(or(eq(invitations.tokenHash, tokenHash), eq(invitations.shareTokenHash, tokenHash))).for("update");
  if (!invite || invite.usedAt || invite.expiresAt <= new Date()) return fail(400, "This invitation is invalid, expired or already used.");
  return invite;
}
async function lockCompany(tx: Transaction, companyId: string) {
  const [company] = await tx.select().from(companies).where(eq(companies.companyId, companyId)).for("update");
  return company ?? fail(403, "You do not have access to this workspace.");
}
async function activeMembership(db: Database | Transaction, companyId: string, userId: string, admin = false) {
  const [membership] = await db.select().from(memberships).where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId), eq(memberships.status, "active")));
  if (!membership || (admin && membership.role !== "admin")) return fail(403, admin ? "Only workspace administrators can do this." : "You do not have access to this workspace.");
  return membership;
}

export function createApp(options: { db: Database; origin: string; secret: string; environment?: string; mailProvider?: MailProvider; uploadDir?: string; attachmentStorage?: "database" | "filesystem" }) {
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  const origin = new URL(options.origin).origin;
  if (environment === "production" && (!origin.startsWith("https://") || options.secret.length < 32)) throw new Error("Production requires HTTPS APP_URL and a strong BETTER_AUTH_SECRET (32+ characters).");
  const mail = createMailProvider(environment, options.mailProvider);
  const authOptions = { origin, secret: options.secret, mail, production: environment === "production" };
  const db = options.db;
  const auth = createAuth(db, authOptions);
  const limits = new Map<string, { count: number; until: number }>();
  let pending: Promise<unknown> = Promise.resolve();
  const pageRoutes = createPageRoutes(db, options.uploadDir ?? process.env.UPLOAD_DIR ?? ".data/uploads", mail, origin, options.attachmentStorage === "database" || (options.attachmentStorage !== "filesystem" && environment === "production"));
  async function auditDeniedMutation(request: Request) {
    if (request.headers.get("origin") !== origin) return;
    const match = new URL(request.url).pathname.match(/^\/api\/companies\/([^/]+)\/(pages|spaces|members)\/([^/]+)(?:\/(grants|public-snapshot|archive|restore))?$/);
    if (!match) return;
    const [, companyId, resource, target, operation] = match;
    if (resource === "pages" && !uuidPattern.test(target)) return;
    const action = operation === "grants" && request.method === "PUT" ? `${resource === "pages" ? "page" : "space"}.grants_changed`
      : resource === "pages" && operation === "public-snapshot" && ["POST", "DELETE"].includes(request.method) ? `page.public_snapshot_${request.method === "POST" ? "published" : "revoked"}`
      : resource === "pages" && (operation === "archive" || operation === "restore") && request.method === "POST" ? `page.${operation === "archive" ? "archived" : "restored"}`
      : resource === "members" && !operation && request.method === "PATCH" ? "membership.changed" : null;
    if (!action) return;
    const current = await auth.api.getSession({ headers: request.headers });
    if (!current) return;
    const [member] = await db.select({ userId: memberships.userId }).from(memberships)
      .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, current.user.id), eq(memberships.status, "active")));
    if (member) await db.transaction(tx => audit(tx, companyId, current.user.id, `${action}.denied`, target));
  }

  async function identity(request: Request) {
    const value = await auth.api.getSession({ headers: request.headers });
    if (!value) return fail(401, "Please sign in to continue.");
    const [active] = await db.select().from(memberships).where(and(eq(memberships.userId, value.user.id), eq(memberships.status, "active"))).limit(1);
    if (!active) return fail(403, "Your workspace access has been deactivated. Contact an administrator.");
    return value.user;
  }

  async function route(request: Request, clientIp: string): Promise<Response> {
    const path = new URL(request.url).pathname;
    const method = request.method;
    if (method !== "GET") {
      if (request.headers.get("origin") !== origin) fail(403, "Request origin is not allowed.");
      if (!isRawUpload(method, path) && !request.headers.get("content-type")?.startsWith("application/json")) fail(415, "Expected application/json.");
    }
    if (method === "POST" && (path === "/api/register" || path.startsWith("/api/auth/") || path === "/api/invitations/preview")) {
      const now = Date.now();
      for (const [key, limit] of limits) if (limit.until < now) limits.delete(key);
      const key = `${clientIp}:${path}`;
      const limit = limits.get(key) ?? { count: 0, until: now + 60_000 };
      limit.count += 1; limits.set(key, limit);
      if (limit.count > (path === "/api/register" ? 10 : 30)) fail(429, "Too many attempts. Please wait a minute and try again.");
    }
    if (path.startsWith("/api/auth/")) {
      const allowed = ["/api/auth/sign-in/email", "/api/auth/sign-out", "/api/auth/request-password-reset", "/api/auth/reset-password"];
      if (method !== "POST" || !allowed.includes(path)) fail(404, "Not found.");
      if (path === "/api/auth/request-password-reset" && mail.kind === "unavailable") fail(503, "Email delivery is unavailable. Configure EMAIL_PROVIDER=resend, RESEND_API_KEY, and EMAIL_FROM.");
      if (path === "/api/auth/request-password-reset" && environment === "production" && mail.kind !== "delivery") fail(503, "Email delivery is unavailable in production.");
      const response = await db.transaction(async tx => {
        if (path === "/api/auth/sign-in/email" || path === "/api/auth/reset-password") {
          const body = await bodyOf(request.clone());
          if (path === "/api/auth/sign-in/email" && typeof body.email === "string") {
            await tx.select({ id: user.id }).from(user).where(eq(user.email, body.email.trim().toLowerCase())).for("update");
          } else if (path === "/api/auth/reset-password" && typeof body.token === "string") {
            const [reset] = await tx.select().from(verification).where(eq(verification.identifier, `reset-password:${body.token}`)).for("update");
            if (reset) await tx.select({ id: user.id }).from(user).where(eq(user.id, reset.value)).for("update");
          }
          if (path === "/api/auth/reset-password" && typeof body.token !== "string") fail(400, "A reset token is required in the form body.");
        }
        const txAuth = createAuth(tx, authOptions);
        const result = await txAuth.handler(request);
        if (!result.ok) {
          const error = await result.json() as { message?: string };
          if (path === "/api/auth/request-password-reset" && result.status >= 500) fail(502, "Password reset email could not be delivered. Please retry.");
          fail(result.status, error.message || "Authentication failed.");
        }
        return result;
      });
      if (path === "/api/auth/sign-in/email" && response.ok) {
        const data = await response.json() as { user: unknown };
        return new Response(JSON.stringify({ user: data.user }), { status: response.status, headers: response.headers });
      }
      return response;
    }
    if (path.startsWith("/api/public/pages/")) {
      const match = path.match(/^\/api\/public\/pages\/([a-f0-9]{64})$/);
      if (method !== "GET" || !match) return fail(404, "Page not found.");
      const [snapshot] = await db.select({ title: publicPageSnapshots.title, slug: publicPageSnapshots.slug,
        content: publicPageSnapshots.content, revision: publicPageSnapshots.revision }).from(publicPageSnapshots)
        .where(eq(publicPageSnapshots.tokenHash, hash(match[1]))).limit(1);
      if (!snapshot) return fail(404, "Page not found.");
      return json({ page: snapshot });
    }
    const publicPage = path.match(/^\/public\/([a-f0-9]{64})$/);
    if (publicPage) {
      if (method !== "GET") return fail(404, "Page not found.");
      const [snapshot] = await db.select({ title: publicPageSnapshots.title, content: publicPageSnapshots.content }).from(publicPageSnapshots)
        .where(eq(publicPageSnapshots.tokenHash, hash(publicPage[1]))).limit(1);
      if (!snapshot) return fail(404, "Page not found.");
      return new Response(publicPageDocument(snapshot.title, snapshot.content), { headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: http:; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts",
      } });
    }
    if (path === "/api/invitations/preview" && method === "POST") {
      const body = await bodyOf(request);
      const result = await db.transaction(async tx => {
        const invite = await validInvitation(tx, field(body, "token", 64, 64));
        const company = await lockCompany(tx, invite.companyId);
        return { email: invite.email, companyName: company.name };
      });
      return json(result);
    }
    if (path === "/api/register" && method === "POST") {
      const body = await bodyOf(request);
      const email = emailField(body);
      const name = field(body, "name", 2, 80);
      const password = body.password;
      if (typeof password !== "string" || password.length < 12 || password.length > 128) fail(400, "Password must be 12–128 characters.");
      const inviteToken = body.inviteToken === undefined ? undefined : field(body, "inviteToken", 64, 64);
      const companyName = inviteToken ? undefined : field(body, "companyName", 2, 80);
      await db.transaction(async tx => {
        const invite = inviteToken ? await validInvitation(tx, inviteToken) : undefined;
        if (invite && invite.email !== email) fail(403, "Use the exact email address this invitation was sent to.");
        if (invite) await lockCompany(tx, invite.companyId);
        const [existingUser] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
        if (existingUser) fail(409, "An account with this email already exists. Sign in instead.");
        const txAuth = createAuth(tx, authOptions);
        const result = await txAuth.api.signUpEmail({ body: { email, name, password: password as string } });
        const userId = result.user.id;
        const companyId = invite?.companyId ?? randomUUID();
        if (!invite) await tx.insert(companies).values({ companyId, name: companyName! });
        const role = invite?.role ?? "admin";
        await tx.insert(memberships).values({ companyId, userId, role, status: "active" });
        if (invite) {
          await tx.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
          await tx.update(invitations).set({ usedAt: new Date() }).where(eq(invitations.id, invite.id));
        }
        await audit(tx, companyId, userId, invite ? "invitation.accepted" : "company.created", userId);
        await audit(tx, companyId, userId, "membership.created", `${userId}:${role}`);
      });
      const response = await db.transaction(async tx => {
        await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).for("update");
        return createAuth(tx, authOptions).api.signInEmail({ body: { email, password: password as string }, headers: request.headers, asResponse: true });
      });
      return new Response(JSON.stringify({ ok: response.ok }), { status: response.status, headers: response.headers });
    }
    if (path === "/api/me" && method === "GET") {
      const current = await identity(request);
      const available = await db.select({ companyId: companies.companyId, name: companies.name, role: memberships.role }).from(memberships)
        .innerJoin(companies, eq(companies.companyId, memberships.companyId)).where(and(eq(memberships.userId, current.id), eq(memberships.status, "active")));
      return json({ user: { id: current.id, name: current.name, email: current.email }, companies: available });
    }
    if (path === "/api/invitations/accept" && method === "POST") {
      const current = await identity(request);
      const body = await bodyOf(request);
      const result = await db.transaction(async tx => {
        const invite = await validInvitation(tx, field(body, "token", 64, 64));
        if (current.email.toLowerCase() !== invite.email) fail(403, "Sign in with the exact email address this invitation was sent to.");
        await lockCompany(tx, invite.companyId);
        const [existing] = await tx.select().from(memberships).where(and(eq(memberships.companyId, invite.companyId), eq(memberships.userId, current.id)));
        if (existing) fail(409, existing.status === "deactivated" ? "This membership was deactivated. Contact an administrator." : "You already belong to this workspace.");
        await tx.insert(memberships).values({ companyId: invite.companyId, userId: current.id, role: invite.role, status: "active" });
        await tx.update(user).set({ emailVerified: true }).where(eq(user.id, current.id));
        await tx.update(invitations).set({ usedAt: new Date() }).where(eq(invitations.id, invite.id));
        await audit(tx, invite.companyId, current.id, "invitation.accepted", current.id);
        await audit(tx, invite.companyId, current.id, "membership.created", `${current.id}:${invite.role}`);
        return { companyId: invite.companyId };
      });
      return json(result);
    }
    const match = path.match(/^\/api\/companies\/([^/]+)(?:\/(.*))?$/);
    if (!match) return fail(404, "Not found.");
    const current = await identity(request);
    const companyId = match[1];
    const resource = match[2] ?? "";
    if (resource === "audit-log") {
      await activeMembership(db, companyId, current.id, true);
      if (method !== "GET") return fail(404, "Not found.");
      const params = new URL(request.url).searchParams;
      const parsePageParam = (key: string, fallback: number, min: number, max: number) => {
        const value = params.get(key);
        if (value === null) return fallback;
        if (!/^\d+$/.test(value)) return fail(400, `Invalid ${key}.`);
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fail(400, `Invalid ${key}.`);
        return parsed;
      };
      const limit = parsePageParam("limit", 25, 1, 100);
      const offset = parsePageParam("offset", 0, 0, 100_000);
      const [events, total] = await Promise.all([
        db.select({ id: auditEvents.id, actorId: auditEvents.actor, actorName: user.name, action: auditEvents.action, target: auditEvents.target, timestamp: auditEvents.timestamp })
          .from(auditEvents).innerJoin(user, eq(user.id, auditEvents.actor)).where(eq(auditEvents.companyId, companyId))
          .orderBy(desc(auditEvents.timestamp), desc(auditEvents.id)).limit(limit).offset(offset),
        db.$count(auditEvents, eq(auditEvents.companyId, companyId)),
      ]);
      return json({ events: await auditTargetLabels(db, companyId, events), total, limit, offset });
    }
    const pageResponse = await pageRoutes(request, method, companyId, resource, current.id);
    if (pageResponse) return pageResponse;
    if (!resource && method === "GET") {
      const membership = await activeMembership(db, companyId, current.id);
      const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId));
      const members = await db.select({ userId: user.id, name: user.name, email: user.email, role: memberships.role, status: memberships.status }).from(memberships)
        .innerJoin(user, eq(user.id, memberships.userId)).where(eq(memberships.companyId, companyId));
      const groupList = await db.select().from(groups).where(eq(groups.companyId, companyId));
      const groupMemberList = await db.select().from(groupMembers).where(eq(groupMembers.companyId, companyId));
      const spaceList = await db.select().from(spaces).where(eq(spaces.companyId, companyId));
      const invitationList = membership.role === "admin" ? await db.select({ id: invitations.id, email: invitations.email, expiresAt: invitations.expiresAt, usedAt: invitations.usedAt, role: invitations.role }).from(invitations).where(eq(invitations.companyId, companyId)) : [];
      return json({ company, membership, members, groups: groupList, groupMembers: groupMemberList, spaces: spaceList, invitations: invitationList });
    }
    if (!["POST", "PATCH", "DELETE"].includes(method)) return fail(404, "Not found.");
    const body = await bodyOf(request);
    const result = await db.transaction(async tx => {
      const company = await lockCompany(tx, companyId);
      await activeMembership(tx, companyId, current.id, true);
      const shareLinkMatch = resource.match(/^invitations\/([^/]+)\/link$/);
      if (shareLinkMatch && method === "POST") {
        const [invite] = await tx.select().from(invitations).where(and(eq(invitations.companyId, companyId), eq(invitations.id, shareLinkMatch[1]))).for("update");
        if (!invite || invite.usedAt || invite.expiresAt <= new Date()) fail(404, "Pending invitation not found.");
        let token: string;
        try {
          if (!invite.shareTokenHash || !invite.shareTokenCiphertext) throw new Error("Invitation link is unavailable.");
          token = decryptInvitationToken(invite.shareTokenCiphertext, options.secret);
        } catch {
          token = randomBytes(32).toString("hex");
          await tx.update(invitations).set({ shareTokenHash: hash(token), shareTokenCiphertext: encryptInvitationToken(token, options.secret) }).where(eq(invitations.id, invite.id));
        }
        return { url: `${origin}/invite#token=${token}` };
      }
      if (resource === "invitations" && method === "POST") {
        const email = emailField(body);
        const role = body.role === undefined ? "editor" : isWorkspaceRole(body.role) ? body.role : fail(400, "Choose Admin, Editor or Viewer.");
        const [existing] = await tx.select().from(memberships).innerJoin(user, eq(memberships.userId, user.id)).where(and(eq(memberships.companyId, companyId), eq(user.email, email)));
        if (existing) fail(409, "This person already has a membership, including any deactivated membership.");
        const token = randomBytes(32).toString("hex");
        const id = randomUUID();
        await tx.insert(invitations).values({ id, companyId, email, tokenHash: hash(token), role, invitedBy: current.id, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) });
        await mail.send({ to: email, kind: "invitation", company: company.name, url: `${origin}/invite#token=${token}` });
        await audit(tx, companyId, current.id, "invitation.created", id);
        return { ok: true };
      }
      const memberMatch = resource.match(/^members\/([^/]+)$/);
      if (memberMatch && method === "PATCH") {
        const userId = memberMatch[1];
        const [target] = await tx.select().from(memberships).where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId))).for("update");
        if (!target) return fail(404, "Member not found in this workspace.");
        if (target.status !== "active") fail(409, "This membership is already deactivated.");
        if (body.role !== undefined && body.status !== undefined) fail(400, "Change role or status separately.");
        if (body.role !== undefined && !isWorkspaceRole(body.role)) fail(400, "Choose Admin, Editor or Viewer.");
        if (body.status !== undefined && body.status !== "deactivated") fail(400, "Only deactivation is supported.");
        if (body.role === undefined && body.status === undefined) fail(400, "Choose a role change or deactivation.");
        if (target.role === "admin" && (body.role !== undefined && body.role !== "admin" || body.status === "deactivated")) {
          const admins = await tx.select().from(memberships).where(and(eq(memberships.companyId, companyId), eq(memberships.role, "admin"), eq(memberships.status, "active")));
          if (admins.length <= 1) fail(409, "Keep at least one active administrator. Promote another member first.");
        }
        if (body.status === "deactivated") {
          await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
          await tx.update(memberships).set({ status: "deactivated" }).where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId)));
          await tx.delete(session).where(eq(session.userId, userId));
          await tx.delete(groupMembers).where(and(eq(groupMembers.companyId, companyId), eq(groupMembers.userId, userId)));
          await audit(tx, companyId, current.id, "membership.deactivated", userId);
        } else if (body.role !== target.role) {
          await tx.update(memberships).set({ role: body.role as "admin" | "editor" | "viewer" }).where(and(eq(memberships.companyId, companyId), eq(memberships.userId, userId)));
          await audit(tx, companyId, current.id, "membership.role_changed", `${userId}:${target.role}->${body.role}`);
        }
        return { ok: true };
      }
      if ((resource === "groups" || resource === "spaces") && method === "POST") {
        const id = randomUUID();
        const name = field(body, "name", 2, 80);
        if (resource === "groups") await tx.insert(groups).values({ id, companyId, name });
        else await tx.insert(spaces).values({ id, companyId, name, createdBy: current.id });
        await audit(tx, companyId, current.id, resource === "groups" ? "group.created" : "space.created", id);
        return { id };
      }
      const groupMatch = resource.match(/^groups\/([^/]+)\/members\/([^/]+)$/);
      if (groupMatch && (method === "POST" || method === "DELETE")) {
        const groupId = groupMatch[1], userId = groupMatch[2];
        const [group] = await tx.select().from(groups).where(and(eq(groups.companyId, companyId), eq(groups.id, groupId)));
        if (!group) fail(404, "Group not found in this workspace.");
        await activeMembership(tx, companyId, userId);
        if (method === "POST") await tx.insert(groupMembers).values({ companyId, groupId, userId }).onConflictDoNothing();
        else await tx.delete(groupMembers).where(and(eq(groupMembers.companyId, companyId), eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
        await audit(tx, companyId, current.id, method === "POST" ? "group.member_added" : "group.member_removed", `${groupId}:${userId}`);
        return { ok: true };
      }
      return fail(404, "Not found.");
    });
    return json(result);
  }

  async function handle(request: Request, clientIp = "local"): Promise<Response> {
    const run = pending.then(async () => {
      let response: Response;
      try { response = await route(request, clientIp); }
      catch (error) {
        if (error instanceof HttpError) response = json({ message: error.message }, error.status);
        else if (error instanceof MailDeliveryError) response = json({ message: error.message }, error.status);
        else if (error instanceof APIError) response = json({ message: error.body?.message ?? "Authentication failed." }, error.statusCode);
        else {
          const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
          if (code === "23505") response = json({ message: "This name or account already exists." }, 409);
          else { console.error("Request failed. No request data or credentials were logged."); response = json({ message: "Something went wrong. Please try again." }, 500); }
        }
      }
      if ([403, 404, 409].includes(response.status)) await auditDeniedMutation(request);
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store"); headers.set("Referrer-Policy", "no-referrer"); headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, { status: response.status, headers });
    });
    pending = run.catch(() => undefined);
    return run;
  }
  return { handle };
}
