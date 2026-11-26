import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/database.ts";
import { createMailProvider, type Mail } from "../server/mail.ts";
import * as schema from "../server/schema.ts";

const origin = "http://127.0.0.1:5173";
const password = "A long unique test password 42!";
const secret = "test-secret-only-4b8c94b68da4933a43b0fd0ef33487de";

test("foundation-security: real Better Auth + Drizzle + persistent PostgreSQL-compatible data", async context => {
  const dir = await mkdtemp(join(tmpdir(), "wiki-security-"));
  let store = await openDatabase(join(dir, "db"));
  const messages: Mail[] = [];
  const provider = { kind: "test" as const, async send(message: Mail) { messages.push(message); } };
  let app = createApp({ db: store.db, origin, secret, environment: "test", mailProvider: provider });
  function client(id: string) {
    const cookies = new Map<string, string>();
    return {
      async request(path: string, method = "GET", data?: unknown, extraHeaders?: Record<string, string>) {
        const response = await app.handle(new Request(origin + path, {
          method, headers: { origin, "content-type": "application/json", cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "), ...extraHeaders },
          body: method === "GET" ? undefined : JSON.stringify(data ?? {}),
        }), id);
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(";")[0];
          const separator = pair.indexOf("=");
          cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
        return { status: response.status, headers: response.headers, data: await response.json() as any };
      },
      cookies,
    };
  }
  const admin = client("admin"), member = client("member"), other = client("other"), anonymous = client("anonymous");
  let companyId: string, otherCompanyId: string, adminId: string, memberId: string, otherId: string, copiedInviteUrl = "";
  async function invitation(email: string, role = "editor") {
    const result = await admin.request(`/api/companies/${companyId}/invitations`, "POST", { email, role });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const message = messages.at(-1)!;
    assert.equal(message.to, email);
    const token = new URLSearchParams(new URL(message.url).hash.slice(1)).get("token")!;
    assert.match(token, /^[a-f0-9]{64}$/);
    return token;
  }
  try {
    await context.test("atomic initial signup, secure cookies, sessions and duplicate rollback", async () => {
      const registered = await admin.request("/api/register", "POST", { name: "First Admin", email: "admin@example.test", password, companyName: "Fieldwork", role: "member" });
      assert.equal(registered.status, 200, JSON.stringify(registered.data));
      assert.match(registered.headers.getSetCookie().join(";"), /HttpOnly/i);
      assert.match(registered.headers.getSetCookie().join(";"), /SameSite=Lax/i);
      const me = await admin.request("/api/me");
      assert.equal(me.status, 200);
      companyId = me.data.companies[0].companyId; adminId = me.data.user.id;
      assert.equal(me.data.companies[0].role, "admin");
      const [credential] = await store.db.select().from(schema.account).where(eq(schema.account.userId, adminId));
      assert.notEqual(credential.password, password);
      assert.ok(credential.password!.length > 60);
      const before = await store.db.select().from(schema.companies);
      const duplicate = await anonymous.request("/api/register", "POST", { name: "Duplicate", email: "admin@example.test", password, companyName: "Orphan" });
      assert.ok(duplicate.status >= 400);
      assert.equal((await store.db.select().from(schema.companies)).length, before.length);
      assert.equal((await anonymous.request("/api/me")).status, 401);
      assert.equal((await anonymous.request("/api/auth/sign-up/email", "POST", { name: "Bypass", email: "bypass@example.test", password })).status, 404);
    });
    await context.test("invitation hashes, recipient binding, safe invited signup and single use", async () => {
      const token = await invitation("member@example.test", "viewer");
      const [stored] = await store.db.select().from(schema.invitations).where(eq(schema.invitations.email, "member@example.test"));
      assert.notEqual(stored.tokenHash, token);
      assert.equal(stored.tokenHash, createHash("sha256").update(token).digest("hex"));
      assert.equal(JSON.stringify(stored).includes(token), false);
      const preview = await anonymous.request("/api/invitations/preview", "POST", { token });
      assert.equal(preview.data.companyName, "Fieldwork");
      const count = (await store.db.select().from(schema.companies)).length;
      const mismatch = await member.request("/api/register", "POST", { name: "Wrong Recipient", email: "wrong@example.test", password, inviteToken: token });
      assert.equal(mismatch.status, 403);
      assert.equal((await store.db.select().from(schema.user).where(eq(schema.user.email, "wrong@example.test"))).length, 0);
      const accepted = await member.request("/api/register", "POST", { name: "Team Member", email: "MEMBER@example.test", password, inviteToken: token, companyName: "Must not exist", role: "admin" });
      assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
      assert.equal((await store.db.select().from(schema.companies)).length, count);
      const me = await member.request("/api/me"); memberId = me.data.user.id;
      assert.equal(me.data.companies[0].role, "viewer");
      assert.equal(me.data.companies[0].companyId, companyId);
      assert.equal((await member.request("/api/invitations/accept", "POST", { token })).status, 400);
      assert.equal((await anonymous.request("/api/invitations/preview", "POST", { token })).status, 400);
      const summary = await admin.request(`/api/companies/${companyId}`);
      assert.equal(JSON.stringify(summary.data).includes(stored.tokenHash), false);
    });
    await context.test("legacy invitations survive the startup role migration and remain visible in company settings", async () => {
      const legacyInviteId = randomUUID();
      const legacyEmail = "legacy-invite@example.test";
      const legacyTokenHash = createHash("sha256").update(randomUUID()).digest("hex");
      await store.db.execute(sql`ALTER TABLE invitations DROP COLUMN role, DROP COLUMN share_token_hash, DROP COLUMN share_token_ciphertext`);
      await store.db.execute(sql`INSERT INTO invitations (id, company_id, email, token_hash, invited_by, expires_at, used_at, created_at)
        VALUES (${legacyInviteId}, ${companyId}, ${legacyEmail}, ${legacyTokenHash}, ${adminId}, ${new Date(Date.now() + 48 * 60 * 60 * 1000)}, NULL, ${new Date()})`);
      await store.close();
      store = await openDatabase(join(dir, "db"));
      app = createApp({ db: store.db, origin, secret, environment: "test", mailProvider: provider });

      const summary = await admin.request(`/api/companies/${companyId}`);
      assert.equal(summary.status, 200, JSON.stringify(summary.data));
      assert.ok(summary.data.invitations.some((invite: { id: string; email: string; role: string }) => invite.id === legacyInviteId && invite.email === legacyEmail && invite.role === "editor"));
    });
    await context.test("pending invitation links are admin-only, encrypted at rest and preserve the email link", async () => {
      const invalid = await admin.request(`/api/companies/${companyId}/invitations`, "POST", { email: "invalid-role@example.test", role: "owner" });
      assert.equal(invalid.status, 400);
      assert.equal((await store.db.select().from(schema.invitations).where(eq(schema.invitations.email, "invalid-role@example.test"))).length, 0);

      const emailToken = await invitation("copy-link@example.test", "editor");
      const [pendingInvite] = await store.db.select().from(schema.invitations).where(eq(schema.invitations.email, "copy-link@example.test"));
      const adminWorkspace = await admin.request(`/api/companies/${companyId}`);
      const listed = adminWorkspace.data.invitations.find((item: { id: string }) => item.id === pendingInvite.id);
      assert.equal(listed.role, "editor");
      assert.equal("tokenHash" in listed, false);
      assert.equal("shareTokenCiphertext" in listed, false);

      const viewerWorkspace = await member.request(`/api/companies/${companyId}`);
      assert.deepEqual(viewerWorkspace.data.invitations, []);
      const linkPath = `/api/companies/${companyId}/invitations/${pendingInvite.id}/link`;
      assert.equal((await member.request(linkPath, "POST", {})).status, 403);
      const copied = await admin.request(linkPath, "POST", {});
      assert.equal(copied.status, 200);
      copiedInviteUrl = copied.data.url;
      assert.equal(new URL(copied.data.url).origin, origin);
      assert.equal(new URL(copied.data.url).pathname, "/invite");
      const copiedToken = new URLSearchParams(new URL(copied.data.url).hash.slice(1)).get("token")!;
      assert.match(copiedToken, /^[a-f0-9]{64}$/);
      assert.notEqual(copiedToken, emailToken);
      assert.equal((await anonymous.request("/api/invitations/preview", "POST", { token: copiedToken })).status, 200);
      assert.equal((await anonymous.request("/api/invitations/preview", "POST", { token: emailToken })).status, 200);
      assert.equal((await admin.request(linkPath, "POST", {})).data.url, copied.data.url);

      const [storedInvite] = await store.db.select().from(schema.invitations).where(eq(schema.invitations.id, pendingInvite.id));
      assert.equal(storedInvite.shareTokenHash, createHash("sha256").update(copiedToken).digest("hex"));
      assert.equal(storedInvite.shareTokenCiphertext!.includes(copiedToken), false);
    });
    await context.test("a database failure rolls back auth user, credentials, company and first admin together", async () => {
      await store.db.execute(sql`ALTER TABLE companies ADD CONSTRAINT test_registration_rollback CHECK (name <> 'Rollback Workspace')`);
      try {
        const before = (await store.db.select().from(schema.companies)).length;
        const failed = await client("rollback").request("/api/register", "POST", { name: "Rollback", email: "rollback@example.test", password, companyName: "Rollback Workspace" });
        assert.equal(failed.status, 500);
        assert.equal((await store.db.select().from(schema.user).where(eq(schema.user.email, "rollback@example.test"))).length, 0);
        assert.equal((await store.db.select().from(schema.companies)).length, before);
      } finally { await store.db.execute(sql`ALTER TABLE companies DROP CONSTRAINT test_registration_rollback`); }
    });
    await context.test("concurrent invitation acceptance creates only one member and no extra company", async () => {
      const token = await invitation("race@example.test");
      const before = (await store.db.select().from(schema.companies)).length;
      const payload = { name: "Race Recipient", email: "race@example.test", password, inviteToken: token };
      const results = await Promise.all([client("race1").request("/api/register", "POST", payload), client("race2").request("/api/register", "POST", payload)]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
      assert.equal((await store.db.select().from(schema.user).where(eq(schema.user.email, "race@example.test"))).length, 1);
      assert.equal((await store.db.select().from(schema.companies)).length, before);
    });
    await context.test("expired and invalid invitations cannot create users or consume membership", async () => {
      const token = await invitation("expired@example.test");
      await store.db.update(schema.invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.invitations.email, "expired@example.test"));
      assert.equal((await anonymous.request("/api/invitations/preview", "POST", { token })).status, 400);
      assert.equal((await anonymous.request("/api/register", "POST", { name: "Expired", email: "expired@example.test", password, inviteToken: token })).status, 400);
      assert.equal((await store.db.select().from(schema.user).where(eq(schema.user.email, "expired@example.test"))).length, 0);
      assert.equal((await anonymous.request("/api/invitations/preview", "POST", { token: "f".repeat(64) })).status, 400);
    });
    await context.test("company isolation, server roles, forged identity and CSRF rejection", async () => {
      assert.equal((await other.request("/api/register", "POST", { name: "Other Admin", email: "other@example.test", password, companyName: "Other Company" })).status, 200);
      const me = await other.request("/api/me"); otherCompanyId = me.data.companies[0].companyId; otherId = me.data.user.id;
      assert.equal((await other.request(`/api/companies/${companyId}`)).status, 403);
      assert.equal((await admin.request(`/api/companies/${otherCompanyId}/groups`, "POST", { name: "Intruder", role: "admin" })).status, 403);
      assert.equal((await anonymous.request(`/api/companies/${companyId}`)).status, 401);
      for (const resource of ["groups", "spaces", "invitations"]) {
        assert.equal((await member.request(`/api/companies/${companyId}/${resource}`, "POST", { name: "Forged", email: "forged@example.test", userId: adminId, companyId, role: "admin" })).status, 403);
      }
      assert.equal((await member.request(`/api/companies/${companyId}/members/${adminId}`, "PATCH", { role: "editor" })).status, 403);
      assert.equal((await admin.request(`/api/companies/${companyId}/groups`, "POST", { name: "CSRF" }, { origin: "https://attacker.test" })).status, 403);
      assert.equal((await admin.request(`/api/companies/${companyId}/groups`, "POST", { name: "No origin" }, { origin: "" })).status, 403);
    });
    await context.test("existing-account invitation requires exact signed-in recipient and preserves other memberships", async () => {
      const token = await invitation("other@example.test");
      assert.equal((await member.request("/api/invitations/accept", "POST", { token, userId: otherId, email: "other@example.test" })).status, 403);
      assert.equal((await anonymous.request("/api/invitations/accept", "POST", { token })).status, 401);
      const result = await other.request("/api/invitations/accept", "POST", { token });
      assert.equal(result.status, 200);
      const otherIdentity = await other.request("/api/me");
      assert.equal(otherIdentity.data.companies.length, 2);
      assert.equal(otherIdentity.data.companies.find((company: { companyId: string }) => company.companyId === companyId).role, "editor");
      assert.equal((await other.request(`/api/companies/${companyId}/groups`, "POST", { name: "Still member" })).status, 403);
      assert.equal((await other.request("/api/invitations/accept", "POST", { token })).status, 400);
    });
    await context.test("last active admin is protected and role changes are persisted and audited", async () => {
      assert.equal((await member.request(`/api/companies/${companyId}/members/${adminId}`, "PATCH", { role: "viewer" })).status, 403);
      assert.equal((await admin.request(`/api/companies/${companyId}/members/${adminId}`, "PATCH", { role: "editor" })).status, 409);
      assert.equal((await admin.request(`/api/companies/${companyId}/members/${adminId}`, "PATCH", { status: "deactivated" })).status, 409);
      assert.equal((await admin.request(`/api/companies/${companyId}/members/${memberId}`, "PATCH", { role: "admin" })).status, 200);
      assert.equal((await member.request(`/api/companies/${companyId}`)).data.membership.role, "admin");
      const logs = await store.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.companyId, companyId));
      assert.ok(logs.some(event => event.action === "membership.role_changed" && event.actor === adminId && event.target.includes(memberId)));
      assert.ok(logs.some(event => event.action === "membership.changed.denied" && event.actor === memberId && event.target === adminId));
      assert.equal(logs.filter(event => event.action === "membership.changed.denied" && event.actor === adminId && event.target === adminId).length, 2, "last-admin protection denials are audited too");
      assert.ok(logs.some(event => event.action === "invitation.accepted" && event.actor === memberId));
      assert.ok(logs.every(event => event.companyId === companyId && event.timestamp instanceof Date));
    });
    await context.test("groups, member management and spaces enforce tenant-consistent relations in API and database", async () => {
      const group = await admin.request(`/api/companies/${companyId}/groups`, "POST", { name: "Operations" });
      assert.equal(group.status, 200);
      const foreignGroup = await other.request(`/api/companies/${otherCompanyId}/groups`, "POST", { name: "Private group" });
      assert.equal(foreignGroup.status, 200);
      const path = `/api/companies/${companyId}/groups/${group.data.id}/members/${memberId}`;
      assert.equal((await admin.request(path, "POST")).status, 200);
      assert.equal((await admin.request(path, "DELETE")).status, 200);
      assert.equal((await admin.request(path, "POST")).status, 200);
      assert.equal((await admin.request(`/api/companies/${companyId}/groups/${foreignGroup.data.id}/members/${memberId}`, "POST")).status, 404);
      const foreignUser = await client("foreign-user").request("/api/register", "POST", { name: "Foreign User", email: "foreign@example.test", password, companyName: "Third Company" });
      assert.equal(foreignUser.status, 200);
      const [outsider] = await store.db.select().from(schema.user).where(eq(schema.user.email, "foreign@example.test"));
      assert.equal((await admin.request(`/api/companies/${companyId}/groups/${group.data.id}/members/${outsider.id}`, "POST")).status, 403);
      await assert.rejects(store.db.insert(schema.groupMembers).values({ companyId, groupId: foreignGroup.data.id, userId: memberId }));
      await assert.rejects(store.db.insert(schema.groupMembers).values({ companyId, groupId: group.data.id, userId: outsider.id }));
      await assert.rejects(store.db.insert(schema.spaces).values({ id: randomUUID(), companyId, name: "Invalid author", createdBy: outsider.id }));
      await assert.rejects(store.db.insert(schema.auditEvents).values({ id: randomUUID(), companyId, actor: outsider.id, action: "invalid", target: "test" }));
      await assert.rejects(store.db.insert(schema.invitations).values({ id: randomUUID(), companyId, email: "invalid@example.test", tokenHash: randomUUID(), invitedBy: outsider.id, expiresAt: new Date(Date.now() + 1000) }));
      const space = await member.request(`/api/companies/${companyId}/spaces`, "POST", { name: "Team handbook", createdBy: outsider.id, companyId: otherCompanyId });
      assert.equal(space.status, 200);
      const [stored] = await store.db.select().from(schema.spaces).where(eq(schema.spaces.id, space.data.id));
      assert.equal(stored.companyId, companyId); assert.equal(stored.createdBy, memberId);
    });
    await context.test("concurrent admin demotions cannot remove the last admin; permission changes apply to existing sessions", async () => {
      const results = await Promise.all([
        admin.request(`/api/companies/${companyId}/members/${adminId}`, "PATCH", { role: "editor" }),
        member.request(`/api/companies/${companyId}/members/${memberId}`, "PATCH", { role: "editor" }),
      ]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
      assert.equal((await admin.request(`/api/companies/${companyId}/spaces`, "POST", { name: "Stale admin role" })).status, 403);
      assert.equal((await member.request(`/api/companies/${companyId}/members/${adminId}`, "PATCH", { role: "admin" })).status, 200);
    });
    await context.test("password reset email, token expiry/reuse, changed credentials and session revocation", async () => {
      const stale = client("stale");
      assert.equal((await stale.request("/api/auth/sign-in/email", "POST", { email: "member@example.test", password })).status, 200);
      const sent = await member.request("/api/auth/request-password-reset", "POST", { email: "member@example.test" });
      assert.equal(sent.status, 200);
      assert.equal(messages.at(-1)!.kind, "password-reset");
      const token = new URLSearchParams(new URL(messages.at(-1)!.url).hash.slice(1)).get("token")!;
      const [issued] = await store.db.select().from(schema.verification).where(eq(schema.verification.identifier, `reset-password:${token}`));
      assert.ok(issued.expiresAt.getTime() > Date.now() + 1_790_000);
      assert.ok(issued.expiresAt.getTime() <= Date.now() + 1_800_000, "reset links expire after 30 minutes");
      assert.equal((await anonymous.request("/api/auth/reset-password", "POST", { token: "invalid", newPassword: password + "new" })).status, 400);
      const resets = await Promise.all([
        anonymous.request("/api/auth/reset-password", "POST", { token, newPassword: password + "new" }),
        anonymous.request("/api/auth/reset-password", "POST", { token, newPassword: password + "new" }),
      ]);
      assert.deepEqual(resets.map(result => result.status).sort(), [200, 400]);
      assert.equal((await stale.request("/api/me")).status, 401);
      assert.equal((await member.request("/api/me")).status, 401);
      assert.equal((await anonymous.request("/api/me")).status, 401, "resetting a password does not create a signed-in session");
      assert.equal((await anonymous.request("/api/auth/reset-password", "POST", { token, newPassword: password + "again" })).status, 400);
      assert.equal((await member.request("/api/auth/sign-in/email", "POST", { email: "member@example.test", password })).status, 401);
      assert.equal((await member.request("/api/auth/sign-in/email", "POST", { email: "member@example.test", password: password + "new" })).status, 200);
      await anonymous.request("/api/auth/request-password-reset", "POST", { email: "member@example.test" });
      const expiredToken = new URLSearchParams(new URL(messages.at(-1)!.url).hash.slice(1)).get("token")!;
      await store.db.update(schema.verification).set({ expiresAt: new Date(0) });
      assert.equal((await anonymous.request("/api/auth/reset-password", "POST", { token: expiredToken, newPassword: password + "expired" })).status, 400);
      const messageCount = messages.length;
      assert.equal((await anonymous.request("/api/auth/request-password-reset", "POST", { email: "unknown@example.test" })).status, 200);
      assert.equal(messages.length, messageCount);
    });
    await context.test("deactivation blocks sessions/login, retains authorship and audit, removes group access", async () => {
      const base = `/api/companies/${companyId}`;
      const created = await member.request(`${base}/pages`, "POST", { title: "Retained member work" });
      assert.equal(created.status, 200);
      const route = `${base}/pages/${created.data.id}`;
      assert.equal((await member.request(`${route}/content`, "PUT", { baseRevision: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Preserved work", styles: {} }] }] })).status, 200);
      const thread = await member.request(`${route}/comments`, "POST", { body: "Retained comment" });
      assert.equal(thread.status, 200);
      const [identity] = await store.db.select().from(schema.user).where(eq(schema.user.id, memberId));
      const revisionsBefore = (await admin.request(`${route}/revisions`)).data;
      const commentsBefore = (await admin.request(`${route}/comments`)).data;
      const pageBefore = await store.db.select().from(schema.pages).where(eq(schema.pages.id, created.data.id));
      const revisionRowsBefore = await store.db.select().from(schema.pageRevisions).where(eq(schema.pageRevisions.pageId, created.data.id));
      const concurrent = await Promise.all([
        member.request("/api/auth/sign-in/email", "POST", { email: "member@example.test", password: password + "new" }),
        admin.request(`/api/companies/${companyId}/members/${memberId}`, "PATCH", { status: "deactivated" }),
      ]);
      assert.deepEqual(concurrent.map(result => result.status), [200, 200]);
      assert.equal((await member.request("/api/me")).status, 401);
      assert.equal((await member.request("/api/auth/sign-in/email", "POST", { email: "member@example.test", password: password + "new" })).status, 403);
      assert.equal((await store.db.select().from(schema.session).where(eq(schema.session.userId, memberId))).length, 0);
      assert.equal((await store.db.select().from(schema.user).where(eq(schema.user.id, memberId))).length, 1);
      assert.deepEqual(await store.db.select().from(schema.pages).where(eq(schema.pages.id, created.data.id)), pageBefore);
      assert.deepEqual(await store.db.select().from(schema.pageRevisions).where(eq(schema.pageRevisions.pageId, created.data.id)), revisionRowsBefore);
      assert.deepEqual((await admin.request(`${route}/revisions`)).data, revisionsBefore);
      assert.deepEqual((await admin.request(`${route}/comments`)).data, commentsBefore);
      assert.ok(revisionsBefore.revisions.every((revision: any) => revision.authorId === memberId && revision.authorName === identity.name));
      assert.equal(commentsBefore.threads[0].messages[0].authorId, memberId);
      assert.equal(commentsBefore.threads[0].messages[0].authorName, identity.name);
      assert.equal(commentsBefore.threads[0].id, thread.data.id);
      assert.equal((await member.request("/api/auth/request-password-reset", "POST", { email: "member@example.test" })).status, 200);
      const deactivatedReset = new URLSearchParams(new URL(messages.at(-1)!.url).hash.slice(1)).get("token")!;
      assert.equal((await anonymous.request("/api/auth/reset-password", "POST", { token: deactivatedReset, newPassword: password + "deactivated" })).status, 200);
      assert.equal((await anonymous.request("/api/me")).status, 401);
      assert.equal((await member.request("/api/auth/sign-in/email", "POST", { email: "member@example.test", password: password + "deactivated" })).status, 403, "password recovery cannot reactivate access");
      const [membership] = await store.db.select().from(schema.memberships).where(and(eq(schema.memberships.companyId, companyId), eq(schema.memberships.userId, memberId)));
      assert.equal(membership.status, "deactivated");
      assert.equal((await store.db.select().from(schema.spaces).where(eq(schema.spaces.createdBy, memberId))).length, 1);
      assert.equal((await store.db.select().from(schema.groupMembers).where(eq(schema.groupMembers.userId, memberId))).length, 0);
      const logs = await store.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.companyId, companyId));
      assert.ok(logs.some(event => event.action === "membership.deactivated" && event.actor === adminId && event.target === memberId));
      assert.equal((await admin.request(`/api/companies/${companyId}/invitations`, "POST", { email: "member@example.test" })).status, 409);
      assert.equal((await admin.request(`/api/companies/${companyId}/members/${otherId}`, "PATCH", { status: "deactivated" })).status, 200);
      assert.equal((await other.request("/api/me")).status, 401);
      assert.equal((await other.request("/api/auth/sign-in/email", "POST", { email: "other@example.test", password })).status, 200);
      assert.equal((await other.request("/api/me")).data.companies.length, 1);
      assert.equal((await other.request(`/api/companies/${companyId}`)).status, 403);
      assert.equal((await other.request(`/api/companies/${otherCompanyId}`)).status, 200);
    });
    await context.test("email delivery failure returns an error and rolls back invitation issuance", async () => {
      const failingApp = createApp({ db: store.db, origin, secret, environment: "test", mailProvider: { kind: "test", async send() { throw new Error("Simulated mail delivery failure"); } } });
      const cookie = [...admin.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await failingApp.handle(new Request(origin + `/api/companies/${companyId}/invitations`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify({ email: "delivery-failure@example.test" }) }));
      assert.equal(response.status, 500);
      assert.equal((await store.db.select().from(schema.invitations).where(eq(schema.invitations.email, "delivery-failure@example.test"))).length, 0);
    });
    await context.test("public registration limits use the server connection address, not forwarded browser claims", async () => {
      const limited = client("limited");
      for (let attempt = 0; attempt < 10; attempt += 1) {
        assert.equal((await limited.request("/api/register", "POST", {}, { "x-forwarded-for": `192.0.2.${attempt}` })).status, 400);
      }
      assert.equal((await limited.request("/api/register", "POST", {}, { "x-forwarded-for": "203.0.113.90" })).status, 429);
    });
    await context.test("persisted cookie session and company data survive database/app restart; logout invalidates server session", async () => {
      await store.close();
      store = await openDatabase(join(dir, "db"));
      app = createApp({ db: store.db, origin, secret, environment: "test", mailProvider: provider });
      assert.equal((await admin.request("/api/me")).status, 200);
      const summary = await admin.request(`/api/companies/${companyId}`);
      assert.equal(summary.data.spaces[0].name, "Team handbook");
      assert.equal(summary.data.members.find((entry: { userId: string }) => entry.userId === memberId).status, "deactivated");
      const [pendingInvite] = await store.db.select().from(schema.invitations).where(eq(schema.invitations.email, "copy-link@example.test"));
      const linkPath = `/api/companies/${companyId}/invitations/${pendingInvite.id}/link`;
      assert.equal((await admin.request(linkPath, "POST", {})).data.url, copiedInviteUrl);
      const token = await invitation("invited-admin@example.test", "admin");
      const invitedAdmin = client("invited-admin");
      assert.equal((await invitedAdmin.request("/api/register", "POST", { name: "Invited Admin", email: "invited-admin@example.test", password, inviteToken: token })).status, 200);
      assert.equal((await invitedAdmin.request("/api/me")).data.companies[0].role, "admin");
      const copiedCookie = [...admin.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      assert.equal((await admin.request("/api/auth/sign-out", "POST")).status, 200);
      assert.equal((await admin.request("/api/me")).status, 401);
      const replay = await app.handle(new Request(origin + "/api/me", { headers: { cookie: copiedCookie } }));
      assert.equal(replay.status, 401);
    });
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("production email is visibly unavailable without a delivery provider; development logs both link types only on server", async () => {
  await assert.rejects(createMailProvider("production").send({ to: "recipient@example.test", kind: "invitation", url: origin + "/invite#token=test-only" }), /Email delivery is unavailable/);
  await assert.rejects(createMailProvider("production", { kind: "console", async send() {} }).send({ to: "recipient@example.test", kind: "invitation", url: origin + "/invite#token=test-only" }), /Email delivery is unavailable/);
  await assert.rejects(createMailProvider("production", { kind: "test", async send() {} }).send({ to: "recipient@example.test", kind: "invitation", url: origin + "/invite#token=test-only" }), /Email delivery is unavailable/);
  const original = console.info;
  const logs: string[] = [];
  console.info = value => { logs.push(String(value)); };
  try {
    const provider = createMailProvider("development");
    await provider.send({ to: "recipient@example.test", kind: "invitation", url: origin + "/invite#token=test-only" });
    await provider.send({ to: "recipient@example.test", kind: "password-reset", url: origin + "/reset-password#token=test-only" });
    assert.equal(logs.length, 2);
    assert.match(logs[0], /invitation/); assert.match(logs[0], /recipient@example.test/);
    assert.match(logs[1], /password-reset/); assert.match(logs[1], /#token=/);
  } finally { console.info = original; }
});

test("actual server-generated development console links support invited signup and password reset end to end", async () => {
  const store = await openDatabase("memory://");
  const original = console.info;
  const logs: string[] = [];
  console.info = value => { logs.push(String(value)); };
  try {
    const app = createApp({ db: store.db, origin, secret, environment: "development" });
    async function request(path: string, body?: unknown, cookie = "") {
      return app.handle(new Request(origin + path, { method: body ? "POST" : "GET", headers: { origin, "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined }));
    }
    const registration = await request("/api/register", { name: "Console Admin", companyName: "Console Company", email: "console-admin@example.test", password });
    assert.equal(registration.status, 200);
    const cookie = registration.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const me = await (await request("/api/me", undefined, cookie)).json() as { companies: { companyId: string }[] };
    assert.equal((await request(`/api/companies/${me.companies[0].companyId}/invitations`, { email: "console-invite@example.test" }, cookie)).status, 200);
    const inviteToken = logs.at(-1)!.match(/\/invite#token=([a-f0-9]{64})/)?.[1];
    assert.ok(inviteToken);
    assert.match(logs.at(-1)!, /console-invite@example.test/);
    assert.equal((await request("/api/register", { name: "Console Teammate", email: "console-invite@example.test", password, inviteToken })).status, 200);
    assert.equal((await request("/api/auth/request-password-reset", { email: "console-invite@example.test" })).status, 200);
    const resetToken = logs.at(-1)!.match(/\/reset-password#token=([^\s]+)/)?.[1];
    assert.ok(resetToken);
    assert.equal((await request("/api/auth/reset-password", { token: decodeURIComponent(resetToken), newPassword: password + "console" })).status, 200);
    assert.equal((await request("/api/auth/sign-in/email", { email: "console-invite@example.test", password: password + "console" })).status, 200);
  } finally { console.info = original; await store.close(); }
});
