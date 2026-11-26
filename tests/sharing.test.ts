import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/database.ts";
import * as schema from "../server/schema.ts";

test("sharing: page and space management, safe summaries and acknowledged audience changes", async context => {
  const dir = await mkdtemp(join(tmpdir(), "wiki-sharing-"));
  const store = await openDatabase("memory://");
  context.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  const origin = "http://127.0.0.1:5173";
  const app = createApp({ db: store.db, origin, environment: "test", secret: "sharing-test-44d9c530e54143b884db43eca37cd021", uploadDir: dir, mailProvider: { kind: "test", async send() {} } });
  async function member(name: string) {
    const cookies = new Map<string, string>();
    async function request(path: string, method = "GET", body?: unknown) {
      const response = await app.handle(new Request(origin + path, { method, headers: { origin, "content-type": "application/json", cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) }), name);
      for (const entry of response.headers.getSetCookie()) { const pair = entry.split(";")[0]; cookies.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)); }
      return { status: response.status, data: await response.json() as any };
    }
    assert.equal((await request("/api/register", "POST", { name, email: `${name}@example.test`, password: "A long unique test password 42!", companyName: name })).status, 200);
    const me = (await request("/api/me")).data;
    return { request, id: me.user.id as string, companyId: me.companies[0].companyId as string };
  }
  const admin = await member("ShareAdmin"), editor = await member("ShareEditor"), viewer = await member("ShareViewer"), external = await member("ShareExternal");
  const companyId = admin.companyId, base = `/api/companies/${companyId}`;
  await store.db.insert(schema.memberships).values([{ companyId, userId: editor.id, role: "editor" }, { companyId, userId: viewer.id, role: "viewer" }]);
  const groupId = randomUUID(), spaceId = randomUUID();
  await store.db.insert(schema.groups).values({ id: groupId, companyId, name: "Sharing team" });
  await store.db.insert(schema.groupMembers).values({ companyId, groupId, userId: editor.id });
  await store.db.insert(schema.spaces).values({ id: spaceId, companyId, name: "Sharing space", createdBy: admin.id });
  const userGrant = (principalId: string, role = "editor") => ({ principalType: "user", principalId, role });
  const groupGrant = (role = "editor") => ({ principalType: "group", principalId: groupId, role });
  async function create(title: string, parentId?: string, space?: string) {
    const result = await admin.request(`${base}/pages`, "POST", { title, parentId, spaceId: space });
    assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data.id as string;
  }
  async function setPage(id: string, grants: unknown[], extra = {}) {
    const result = await admin.request(`${base}/pages/${id}/grants`, "PUT", { inherits: false, grants, ...extra });
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  const root = await create("Sharing root"), child = await create("Inherited child", root), destination = await create("Destination");
  await context.test("users, groups, roles, inheritance and read-only summaries", async () => {
    await setPage(root, [userGrant(admin.id), groupGrant("commenter"), userGrant(viewer.id)]);
    const summary = await admin.request(`${base}/pages/${child}/grants`);
    assert.equal(summary.data.inherits, true); assert.equal(summary.data.inherited.source, "Page: Sharing root"); assert.equal(summary.data.inherited.grants.length, 3);
    const readOnly = await viewer.request(`${base}/pages/${child}/grants`);
    assert.equal(readOnly.status, 200); assert.equal(readOnly.data.role, "viewer"); assert.equal(readOnly.data.canManage, false); assert.deepEqual(readOnly.data.grants, []); assert.deepEqual(readOnly.data.inherited.grants, []);
    assert.equal((await editor.request(`${base}/pages/${child}/grants`, "PUT", { inherits: false, grants: [] })).status, 403);
    await setPage(child, [userGrant(admin.id), groupGrant(), userGrant(viewer.id, "commenter")]);
    assert.equal((await editor.request(`${base}/pages/${child}/grants`)).data.canManage, true);
    assert.equal((await viewer.request(`${base}/pages/${child}`)).data.page.role, "viewer");
    assert.equal((await editor.request(`${base}/pages/${child}/grants`, "PUT", { inherits: true })).status, 409);
    assert.equal((await editor.request(`${base}/pages/${child}/grants`)).data.inherits, false, "an unconfirmed inheritance change rolls back");
    assert.equal((await editor.request(`${base}/pages/${child}/grants`, "PUT", { inherits: true, confirmSelfLockout: true })).status, 200);
    assert.equal((await editor.request(`${base}/pages/${child}/grants`)).data.role, "commenter");
    assert.equal((await external.request(`${base}/pages/${child}/grants`)).status, 404);
    assert.equal((await admin.request(`${base}/pages/${child}/grants`, "PUT", { inherits: false, grants: [userGrant(external.id)] })).status, 400);
    assert.equal((await admin.request(`${base}/pages/${child}/grants`, "PUT", { inherits: false, grants: [{ principalType: "group", principalId: randomUUID(), role: "editor" }] })).status, 400);
  });
  await context.test("hidden ancestor summaries and non-removable admin access through empty and nonempty overrides", async () => {
    await setPage(child, [userGrant(admin.id), groupGrant()]);
    await setPage(root, [userGrant(admin.id)]);
    const hidden = (await editor.request(`${base}/pages/${child}/grants`)).data;
    assert.equal(hidden.inherited.source, "An inaccessible ancestor"); assert.deepEqual(hidden.inherited.grants, []);
    await setPage(root, [userGrant(admin.id), groupGrant("viewer")]);
    const readable = (await editor.request(`${base}/pages/${child}/grants`)).data;
    assert.equal(readable.canManage, true); assert.equal(readable.inherited.source, "Page: Sharing root");
    assert.equal(readable.inherited.entriesVisible, false); assert.deepEqual(readable.inherited.grants, [], "editing an override does not disclose a read-only ancestor's grants");
    const locked = await create("Lockout check");
    for (const grants of [[], [userGrant(editor.id, "viewer")]]) {
      await setPage(locked, grants);
      const summary = await admin.request(`${base}/pages/${locked}/grants`);
      assert.equal(summary.status, 200);
      assert.equal(summary.data.workspaceRole, "admin");
      assert.equal(summary.data.role, "editor");
      assert.equal(summary.data.canManage, true);
      assert.deepEqual(summary.data.grants.map((grant: any) => grant.principalId), grants.map(grant => grant.principalId));
      assert.equal((await admin.request(`${base}/pages/${locked}`)).status, 200);
    }
  });
  await context.test("space management preserves existing authorization and empty-list workspace defaults", async () => {
    const route = `${base}/spaces/${spaceId}/grants`;
    assert.equal((await admin.request(route)).data.workspaceRole, "admin");
    assert.equal((await admin.request(route, "PUT", { grants: [groupGrant()] })).status, 200);
    const restrictedAdmin = (await admin.request(route)).data;
    assert.equal(restrictedAdmin.workspaceRole, "admin");
    assert.equal(restrictedAdmin.role, "editor");
    assert.equal(restrictedAdmin.canManage, true);
    assert.equal((await admin.request(route, "PUT", { grants: [] })).status, 200);
    assert.equal((await editor.request(route)).data.canManage, false);
    assert.equal((await editor.request(route, "PUT", { grants: [groupGrant()] })).status, 403);
    assert.equal((await admin.request(route, "PUT", { grants: [userGrant(admin.id), groupGrant(), userGrant(viewer.id, "commenter")] })).status, 200);
    assert.equal((await editor.request(route)).data.canManage, true);
    assert.equal((await viewer.request(route)).data.role, "viewer");
    assert.equal((await viewer.request(route, "PUT", { grants: [] })).status, 403);
    assert.equal((await external.request(route)).status, 404);
    assert.equal((await admin.request(route, "PUT", { grants: [userGrant(external.id)] })).status, 400);
    const independentlyShared = await create("Separately shared space page", undefined, spaceId);
    await setPage(independentlyShared, [userGrant(admin.id), groupGrant()]);
    assert.equal((await admin.request(route, "PUT", { grants: [userGrant(admin.id), groupGrant("viewer")] })).status, 200);
    const readOnlySpace = (await editor.request(`${base}/pages/${independentlyShared}/grants`)).data;
    assert.equal(readOnlySpace.canManage, true); assert.equal(readOnlySpace.inherited.source, "Team space: Sharing space");
    assert.equal(readOnlySpace.inherited.entriesVisible, false); assert.deepEqual(readOnlySpace.inherited.grants, [], "editing a page does not disclose a read-only space's grants");
    assert.equal((await admin.request(route, "PUT", { grants: [userGrant(admin.id), groupGrant()] })).status, 200);
    assert.equal((await editor.request(route, "PUT", { grants: [userGrant(admin.id)] })).status, 409);
    assert.equal((await editor.request(route, "PUT", { grants: [userGrant(admin.id)], confirmSelfLockout: true })).status, 200);
    assert.equal((await editor.request(route)).status, 404);
    assert.equal((await editor.request(`${base}/pages/${independentlyShared}`)).status, 200, "explicit pages may admit members excluded from their space");
    const inherited = (await editor.request(`${base}/pages/${independentlyShared}/grants`)).data.inherited;
    assert.equal(inherited.entriesVisible, false); assert.deepEqual(inherited.grants, []);
    assert.equal((await admin.request(route, "PUT", { grants: [] })).status, 200);
    assert.equal((await viewer.request(route)).data.workspaceAccess, true);
    const spacePage = await create("Space inherited", undefined, spaceId);
    assert.equal((await admin.request(`${base}/pages/${spacePage}/grants`)).data.inherited.source, "Team space: Sharing space");
  });
  await context.test("moves compare every audience role, require acknowledgement and reject stale previews", async () => {
    await setPage(root, [userGrant(admin.id), groupGrant("viewer")]);
    await setPage(destination, [userGrant(admin.id), groupGrant("commenter")]);
    const equivalent = await create("Same audience, different entries");
    await setPage(equivalent, [userGrant(admin.id), userGrant(editor.id, "viewer")]);
    const moving = await create("Moving inherited", root), descendant = await create("Moving descendant", moving);
    const override = await create("Preserved override", moving);
    await setPage(override, [userGrant(admin.id), groupGrant()]);
    const route = `${base}/pages/${moving}`, target = { parentId: destination, spaceId: null };
    assert.equal((await admin.request(`${route}/move-impact`, "POST", { parentId: equivalent, spaceId: null })).data.changed, false, "different user/group entries with identical effective roles do not warn");
    const preview = await admin.request(`${route}/move-impact`, "POST", target);
    assert.equal(preview.status, 200); assert.equal(preview.data.changed, true, "mover remains editor but another member changes roles");
    assert.deepEqual(Object.keys(preview.data).sort(), ["changed", "token"]);
    assert.equal((await admin.request(`${route}/move`, "POST", target)).status, 409);
    await setPage(destination, [userGrant(admin.id), groupGrant()]);
    assert.equal((await admin.request(`${route}/move`, "POST", { ...target, accessAcknowledgement: preview.data.token })).status, 409);
    assert.equal((await admin.request(route)).data.page.parentId, root);
    const fresh = (await admin.request(`${route}/move-impact`, "POST", target)).data;
    assert.equal((await admin.request(`${route}/move`, "POST", { ...target, accessAcknowledgement: fresh.token })).status, 200);
    assert.equal((await editor.request(`${base}/pages/${descendant}`)).data.page.role, "editor");
    assert.equal((await editor.request(`${base}/pages/${override}`)).data.page.role, "editor");
    assert.equal((await admin.request(`${route}/move-impact`, "POST", target)).data.changed, false);
    assert.equal((await admin.request(`${route}/move`, "POST", target)).status, 200, "same-parent reorder needs no warning");
    const explicitPreview = (await admin.request(`${base}/pages/${override}/move-impact`, "POST", { parentId: root, spaceId: null })).data;
    assert.equal(explicitPreview.changed, false, "explicit override is unchanged by moving");
    const hidden = await create("Hidden destination");
    await setPage(hidden, [groupGrant()], { confirmSelfLockout: true });
    assert.equal((await admin.request(`${route}/move-impact`, "POST", { parentId: hidden, spaceId: null })).status, 200, "active admins retain destination access");
    assert.equal((await external.request(`${route}/move-impact`, "POST", target)).status, 404);
    assert.equal((await viewer.request(`${route}/move-impact`, "POST", target)).status, 404);
  });
  await context.test("cross-space moves update descendants, preserve overrides and recheck group membership", async () => {
    const moving = await create("Cross-space inherited"), descendant = await create("Cross-space descendant", moving), override = await create("Cross-space override", moving);
    await setPage(override, [userGrant(admin.id), groupGrant()]);
    const spaceRoute = `${base}/spaces/${spaceId}/grants`;
    assert.equal((await admin.request(spaceRoute, "PUT", { grants: [userGrant(admin.id), groupGrant("viewer")] })).status, 200);
    const route = `${base}/pages/${moving}`, target = { parentId: null, spaceId };
    const preview = (await admin.request(`${route}/move-impact`, "POST", target)).data;
    assert.equal(preview.changed, true);
    assert.equal((await admin.request(`${route}/move`, "POST", target)).status, 409);
    assert.equal((await admin.request(route)).data.page.spaceId, null, "unacknowledged moves leave the source unchanged");
    const membershipRoute = `${base}/groups/${groupId}/members/${editor.id}`;
    assert.equal((await admin.request(membershipRoute, "DELETE")).status, 200);
    assert.equal((await admin.request(`${route}/move`, "POST", { ...target, accessAcknowledgement: preview.token })).status, 409, "group membership changes invalidate the reviewed audience");
    assert.equal((await admin.request(membershipRoute, "POST")).status, 200);
    const fresh = (await admin.request(`${route}/move-impact`, "POST", target)).data;
    assert.equal((await admin.request(`${route}/move`, "POST", { ...target, accessAcknowledgement: fresh.token })).status, 200);
    for (const pageId of [moving, descendant, override]) assert.equal((await admin.request(`${base}/pages/${pageId}`)).data.page.spaceId, spaceId);
    assert.equal((await editor.request(`${base}/pages/${descendant}`)).data.page.role, "viewer");
    assert.equal((await editor.request(`${base}/pages/${override}`)).data.page.role, "editor", "explicit grants survive a cross-space move");
    assert.equal((await viewer.request(`${base}/pages/${moving}`)).status, 404, "members excluded from the destination lose inherited access");
  });
});
