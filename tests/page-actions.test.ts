import { test } from "node:test";
import assert from "node:assert/strict";
import { canManageWorkspacePages, canReviewPage, visiblePageTreeActions } from "../src/pageActions.ts";

test("page action visibility keeps viewers read-only while preserving editor and admin actions", () => {
  assert.deepEqual(visiblePageTreeActions("viewer"), ["open", "share"]);
  assert.deepEqual(visiblePageTreeActions("commenter"), ["open", "share"]);
  assert.ok(visiblePageTreeActions("editor").includes("duplicate"));
  assert.ok(visiblePageTreeActions("editor").includes("archive"));
  assert.equal(canManageWorkspacePages("viewer"), false);
  assert.equal(canManageWorkspacePages("editor"), true);
  assert.equal(canManageWorkspacePages("admin"), true);
});

test("page review controls respect workspace Viewer limits even for owners", () => {
  assert.equal(canReviewPage("viewer", "viewer", true), false);
  assert.equal(canReviewPage("editor", "viewer", true), false);
  assert.equal(canReviewPage("viewer", undefined, true), false);
  assert.equal(canReviewPage("viewer", "editor", true), true);
  assert.equal(canReviewPage("commenter", "editor", true), true);
  assert.equal(canReviewPage("commenter", "editor", false), false);
  assert.equal(canReviewPage("viewer", "admin", false), false);
  assert.equal(canReviewPage("editor", "admin", false), true);
});
