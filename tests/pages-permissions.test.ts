import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { openDatabase, type Database } from "../server/database.ts";
import { canMove, canRestore, effectiveRole, spaceRole, visibleRoles, wouldCreateLoop, type PageRole } from "../server/permissions.ts";
import { moveImpact } from "../server/sharing.ts";
import * as schema from "../server/schema.ts";

// Company c1: admin, alice, bob, carol (deactivated), erin; group eng = bob + carol; team space s1.
// Company c2: dave, erin; group ops = erin.
async function seed() {
  const store = await openDatabase("memory://");
  const db = store.db;
  await db.insert(schema.companies).values([{ companyId: "c1", name: "One" }, { companyId: "c2", name: "Two" }]);
  const people = ["admin", "alice", "bob", "carol", "dave", "erin", "viewer"];
  await db.insert(schema.user).values(people.map(id => ({ id, name: id, email: `${id}@example.com` })));
  await db.insert(schema.memberships).values([
    { companyId: "c1", userId: "admin", role: "admin" }, { companyId: "c1", userId: "alice", role: "editor" },
    { companyId: "c1", userId: "bob", role: "editor" }, { companyId: "c1", userId: "carol", role: "editor", status: "deactivated" },
    { companyId: "c1", userId: "erin", role: "editor" }, { companyId: "c2", userId: "dave", role: "editor" },
    { companyId: "c2", userId: "erin", role: "editor" }, { companyId: "c1", userId: "viewer", role: "viewer" },
  ]);
  await db.insert(schema.groups).values([{ id: "eng", companyId: "c1", name: "Engineering" }, { id: "ops", companyId: "c2", name: "Ops" }]);
  await db.insert(schema.groupMembers).values([
    { companyId: "c1", groupId: "eng", userId: "bob" }, { companyId: "c1", groupId: "eng", userId: "carol" },
    { companyId: "c2", groupId: "ops", userId: "erin" },
  ]);
  await db.insert(schema.spaces).values({ id: "s1", companyId: "c1", name: "Team", createdBy: "admin" });
  return { db, close: store.close, page: (fields: Partial<typeof schema.pages.$inferInsert> = {}) => addPage(db, fields) };
}

async function addPage(db: Database, fields: Partial<typeof schema.pages.$inferInsert>) {
  const id = randomUUID();
  await db.insert(schema.pages).values({ id, companyId: "c1", ownerId: "admin", title: "Page", slug: id, ...fields });
  return id;
}

async function grant(db: Database, target: { pageId?: string; spaceId?: string }, principalType: "user" | "group", principalId: string, role: PageRole, companyId = "c1") {
  await db.insert(schema.pageGrants).values({ id: randomUUID(), companyId, ...target, principalType, principalId, role });
}

async function restrict(db: Database, pageId: string) {
  await db.update(schema.pages).set({ inherits: false }).where(and(eq(schema.pages.companyId, "c1"), eq(schema.pages.id, pageId)));
}

test("pages-permissions: nearest explicit settings win, page first, then parents, then space", async context => {
  const { db, close, page } = await seed();
  context.after(close);
  const root = await page();
  const child = await page({ parentId: root });
  const grandchild = await page({ parentId: child });
  assert.equal(await effectiveRole(db, "c1", "bob", grandchild), "editor", "company space without settings: every active member edits");

  await restrict(db, child);
  await grant(db, { pageId: child }, "user", "alice", "viewer");
  assert.equal(await effectiveRole(db, "c1", "alice", child), "viewer");
  assert.equal(await effectiveRole(db, "c1", "alice", grandchild), "viewer", "inherits from nearest restricted parent");
  assert.equal(await effectiveRole(db, "c1", "bob", grandchild), null);
  assert.equal(await effectiveRole(db, "c1", "bob", root), "editor", "parent above the override is unaffected");

  await restrict(db, grandchild);
  await grant(db, { pageId: grandchild }, "user", "bob", "commenter");
  assert.equal(await effectiveRole(db, "c1", "bob", grandchild), "commenter", "explicit page override beats parent");
  assert.equal(await effectiveRole(db, "c1", "alice", grandchild), null, "override replaces, not adds to, the parent grants");
  assert.equal(await effectiveRole(db, "c1", "admin", grandchild), "editor", "active workspace admins retain access");

  const spacePage = await page({ spaceId: "s1" });
  const spaceChild = await page({ spaceId: "s1", parentId: spacePage });
  await grant(db, { spaceId: "s1" }, "user", "alice", "commenter");
  assert.equal(await effectiveRole(db, "c1", "alice", spaceChild), "commenter", "falls back to space grants");
  assert.equal(await effectiveRole(db, "c1", "bob", spaceChild), null, "space with grants excludes everyone else");
  await restrict(db, spaceChild);
  await grant(db, { pageId: spaceChild }, "user", "bob", "editor");
  assert.equal(await effectiveRole(db, "c1", "bob", spaceChild), "editor");
  assert.equal(await effectiveRole(db, "c1", "alice", spaceChild), null);
});

test("pages-permissions: workspace viewers stay read-only despite explicit editor grants", async context => {
  const { db, close, page } = await seed();
  context.after(close);
  const root = await page();
  await restrict(db, root);
  await grant(db, { pageId: root }, "user", "viewer", "editor");
  assert.equal(await effectiveRole(db, "c1", "viewer", root), "viewer");
  assert.equal(await canMove(db, "c1", "viewer", root, { parentId: null, spaceId: null }).then(result => result.ok), false);
  const archived = await page({ archivedAt: new Date(), archivedRootId: root });
  assert.equal(await canRestore(db, "c1", "viewer", archived), false);
});

test("pages-permissions: active company admins retain editor capability through all overrides, moves and archive restoration", async context => {
  const { db, close, page } = await seed();
  context.after(close);
  const root = await page({ spaceId: "s1" });
  const child = await page({ spaceId: "s1", parentId: root });
  const destination = await page({ inherits: false });
  await restrict(db, root);
  await grant(db, { spaceId: "s1" }, "user", "alice", "viewer");
  await grant(db, { pageId: root }, "user", "alice", "commenter");
  await grant(db, { pageId: destination }, "user", "admin", "viewer");
  for (const pageId of [root, child, destination]) {
    assert.equal(await effectiveRole(db, "c1", "admin", pageId), "editor");
    assert.equal((await visibleRoles(db, "c1", "admin")).get(pageId), "editor");
  }
  assert.equal(await spaceRole(db, "c1", "admin", "s1"), "editor");
  assert.equal(await spaceRole(db, "c2", "admin", "s1"), null);
  assert.equal(await spaceRole(db, "c1", "admin", "missing"), null);
  assert.equal(await effectiveRole(db, "c2", "admin", root), null);
  assert.equal(await effectiveRole(db, "c1", "admin", randomUUID()), null);
  assert.equal((await canMove(db, "c1", "admin", child, { parentId: destination, spaceId: null })).ok, true);

  await db.update(schema.pages).set({ inherits: false }).where(eq(schema.pages.id, child));
  await grant(db, { pageId: child }, "user", "admin", "viewer");
  assert.equal(await effectiveRole(db, "c1", "admin", child), "editor", "a lower grant cannot cap an admin");
  await db.delete(schema.pageGrants).where(eq(schema.pageGrants.pageId, child));
  assert.equal(await effectiveRole(db, "c1", "admin", child), "editor", "removing every grant cannot remove admin access");
  await db.update(schema.memberships).set({ status: "deactivated" }).where(and(eq(schema.memberships.companyId, "c1"), eq(schema.memberships.userId, "alice")));
  assert.equal((await moveImpact(db, "c1", root, { parentId: destination, spaceId: null })).changed, false, "moving an admin-only tree does not warn that admins lose access");

  await db.update(schema.pages).set({ archivedRootId: root, archivedAt: new Date() }).where(eq(schema.pages.id, root));
  assert.equal(await effectiveRole(db, "c1", "admin", root), null);
  assert.equal((await visibleRoles(db, "c1", "admin")).has(root), false);
  assert.equal(await canRestore(db, "c1", "admin", root), true);
  await db.update(schema.memberships).set({ role: "editor" }).where(and(eq(schema.memberships.companyId, "c1"), eq(schema.memberships.userId, "admin")));
  assert.equal(await effectiveRole(db, "c1", "admin", child), null, "demotion removes the admin exception immediately");
  assert.equal(await spaceRole(db, "c1", "admin", "s1"), null);
  assert.equal(await canRestore(db, "c1", "admin", root), false);
  assert.equal((await visibleRoles(db, "c1", "admin")).has(child), false);
  await db.update(schema.memberships).set({ role: "admin", status: "deactivated" }).where(and(eq(schema.memberships.companyId, "c1"), eq(schema.memberships.userId, "admin")));
  assert.equal(await effectiveRole(db, "c1", "admin", child), null);
  assert.equal(await spaceRole(db, "c1", "admin", "s1"), null);
  assert.equal(await canRestore(db, "c1", "admin", root), false);
  assert.equal((await visibleRoles(db, "c1", "admin")).size, 0);
});

test("pages-permissions: group grants count for active members; the highest role wins", async context => {
  const { db, close, page } = await seed();
  context.after(close);
  const secret = await page();
  await restrict(db, secret);
  await grant(db, { pageId: secret }, "group", "eng", "viewer");
  assert.equal(await effectiveRole(db, "c1", "bob", secret), "viewer");
  assert.equal(await effectiveRole(db, "c1", "alice", secret), null);
  await grant(db, { pageId: secret }, "user", "bob", "editor");
  assert.equal(await effectiveRole(db, "c1", "bob", secret), "editor");
});

test("pages-permissions: deactivated members get nothing, even with user or group grants", async context => {
  const { db, close, page } = await seed();
  context.after(close);
  const open = await page();
  const secret = await page();
  await restrict(db, secret);
  await grant(db, { pageId: secret }, "group", "eng", "editor");
  await grant(db, { pageId: secret }, "user", "carol", "editor");
  assert.equal(await effectiveRole(db, "c1", "carol", open), null);
  assert.equal(await effectiveRole(db, "c1", "carol", secret), null);
  assert.equal(await effectiveRole(db, "c1", "bob", secret), "editor", "active member of the same group still has access");
  assert.deepEqual(await canMove(db, "c1", "carol", open, { parentId: null, spaceId: null }), { ok: false, reason: "You need edit access to move this page." });
});

test("pages-permissions: archived pages are closed except for restore by an editor", async context => {
  const { db, close, page } = await seed();
  context.after(close);
  const root = await page();
  await restrict(db, root);
  await grant(db, { pageId: root }, "user", "alice", "editor");
  await grant(db, { pageId: root }, "user", "bob", "viewer");
  const child = await page({ parentId: root });
  const archivedAt = new Date();
  await db.update(schema.pages).set({ archivedAt, archivedRootId: root }).where(eq(schema.pages.companyId, "c1"));
  for (const userId of ["admin", "alice", "bob"]) assert.equal(await effectiveRole(db, "c1", userId, child), null);
  assert.equal(await canRestore(db, "c1", "alice", root), true);
  assert.equal(await canRestore(db, "c1", "alice", child), true);
  assert.equal(await canRestore(db, "c1", "admin", root), true, "active admin can restore without a grant");
  await grant(db, { pageId: root }, "user", "admin", "editor");
  assert.equal(await canRestore(db, "c1", "admin", root), true);
  assert.equal(await canRestore(db, "c1", "bob", root), false, "viewers cannot restore");
  await db.update(schema.memberships).set({ status: "deactivated" }).where(and(eq(schema.memberships.companyId, "c1"), eq(schema.memberships.userId, "alice")));
  assert.equal(await canRestore(db, "c1", "alice", root), false);
});

test("pages-permissions: no access or links across companies", async context => {
  const { db, close, page } = await seed();
  context.after(close);
  const open = await page();
  assert.equal(await effectiveRole(db, "c1", "dave", open), null, "not a member of c1");
  assert.equal(await effectiveRole(db, "c2", "dave", open), null, "c1 page id is unknown inside c2");
  assert.equal(await effectiveRole(db, "c2", "erin", open), null, "member of both, but asking as c2");
  assert.equal(await effectiveRole(db, "c1", "erin", "not-a-uuid"), null);

  const secret = await page();
  await restrict(db, secret);
  await grant(db, { pageId: secret }, "group", "ops", "editor");
  assert.equal(await effectiveRole(db, "c1", "erin", secret), null, "a c2 group grant never counts in c1");

  const otherCompanyPage = await page({ companyId: "c2", ownerId: "dave" });
  await assert.rejects(page({ parentId: otherCompanyPage }), "parent must be in the same company");
  await assert.rejects(page({ spaceId: "s1", companyId: "c2", ownerId: "dave" }), "space must be in the same company");
  await assert.rejects(page({ ownerId: "dave" }), "owner must be a member of the company");
  await assert.rejects(grant(db, { pageId: secret }, "user", "dave", "editor", "c2"), "grant must be in the page's company");
  assert.deepEqual(await canMove(db, "c1", "admin", open, { parentId: otherCompanyPage, spaceId: null }), { ok: false, reason: "Destination page not found." });
});

test("pages-permissions: a moved page keeps its overrides and restricted children stay restricted", async context => {
  const { db, close, page } = await seed();
  context.after(close);
  const oldRoot = await page();
  const newRoot = await page();
  const moved = await page({ parentId: oldRoot });
  const restrictedChild = await page({ parentId: moved });
  const deep = await page({ parentId: restrictedChild });
  await restrict(db, restrictedChild);
  await grant(db, { pageId: restrictedChild }, "user", "alice", "viewer");
  const ownOverride = await page({ parentId: oldRoot });
  await restrict(db, ownOverride);
  await grant(db, { pageId: ownOverride }, "user", "bob", "commenter");
  await grant(db, { pageId: ownOverride }, "user", "admin", "editor");

  for (const pageId of [moved, ownOverride]) {
    assert.deepEqual(await canMove(db, "c1", "admin", pageId, { parentId: newRoot, spaceId: null }), { ok: true });
    await db.update(schema.pages).set({ parentId: newRoot }).where(and(eq(schema.pages.companyId, "c1"), eq(schema.pages.id, pageId)));
  }
  await restrict(db, newRoot);
  await grant(db, { pageId: newRoot }, "user", "erin", "editor");

  assert.equal(await effectiveRole(db, "c1", "erin", moved), "editor", "inheriting page now follows its new parent");
  assert.equal(await effectiveRole(db, "c1", "bob", moved), null);
  assert.equal(await effectiveRole(db, "c1", "alice", restrictedChild), "viewer");
  assert.equal(await effectiveRole(db, "c1", "alice", deep), "viewer");
  assert.equal(await effectiveRole(db, "c1", "erin", restrictedChild), null, "restricted child does not pick up new parent grants");
  assert.equal(await effectiveRole(db, "c1", "erin", deep), null);
  assert.equal(await effectiveRole(db, "c1", "bob", ownOverride), "commenter", "moved page keeps its own override");
  assert.equal(await effectiveRole(db, "c1", "erin", ownOverride), null);
  assert.deepEqual(await canMove(db, "c1", "alice", restrictedChild, { parentId: null, spaceId: null }), { ok: false, reason: "You need edit access to move this page." });
});

test("pages-permissions: a page cannot be moved under itself or a descendant", async context => {
  const { db, close, page } = await seed();
  context.after(close);
  const top = await page();
  const middle = await page({ parentId: top });
  const bottom = await page({ parentId: middle });
  const other = await page();
  assert.equal(await wouldCreateLoop(db, "c1", top, top), true);
  assert.equal(await wouldCreateLoop(db, "c1", top, middle), true);
  assert.equal(await wouldCreateLoop(db, "c1", top, bottom), true);
  assert.equal(await wouldCreateLoop(db, "c1", bottom, top), false);
  assert.equal(await wouldCreateLoop(db, "c1", top, other), false);
  assert.equal(await wouldCreateLoop(db, "c1", top, null), false);
  assert.equal(await wouldCreateLoop(db, "c1", top, randomUUID()), true, "unknown parent fails closed");
  assert.deepEqual(await canMove(db, "c1", "admin", top, { parentId: bottom, spaceId: null }), { ok: false, reason: "A page cannot be moved into one of its own subpages." });
  assert.deepEqual(await canMove(db, "c1", "admin", top, { parentId: top, spaceId: null }), { ok: false, reason: "A page cannot be moved into itself." });
  assert.deepEqual(await canMove(db, "c1", "admin", bottom, { parentId: other, spaceId: null }), { ok: true });
  await assert.rejects(db.update(schema.pages).set({ parentId: top }).where(eq(schema.pages.id, top)), "database blocks a page being its own parent");
});
