import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";
import postcss from "postcss";
import { availablePrincipals, emptyGrantMessage, moveNeedsReview, sharingPrincipals } from "../src/sharingModel.ts";

test("sharing UI offers active users and groups without duplicating selected entries", () => {
  const principals = sharingPrincipals([
    { userId: "active", name: "Active user", email: "active@example.test", role: "viewer", status: "active" },
    { userId: "removed", name: "Removed user", email: "removed@example.test", role: "editor", status: "deactivated" },
  ], [{ id: "team", name: "Team group" }]);
  assert.deepEqual(principals.map(entry => entry.key), ["user:active", "group:team"]);
  assert.deepEqual(availablePrincipals(principals, [{ principalType: "user", principalId: "active", role: "viewer" }]).map(entry => entry.key), ["group:team"]);
  assert.equal(availablePrincipals(principals, []).length, 2, "removed grants can be added again");
});

test("move UI requires a fresh explicit acknowledgement only when effective access changes", () => {
  const impact = { changed: true, token: "current" };
  assert.equal(moveNeedsReview(impact, null, false), true);
  assert.equal(moveNeedsReview(impact, { token: "current" }, false), true);
  assert.equal(moveNeedsReview(impact, { token: "stale" }, true), true);
  assert.equal(moveNeedsReview(impact, { token: "current" }, true), false);
  assert.equal(moveNeedsReview({ ...impact, changed: false }, null, false), false);
});

test("sharing UI distinguishes empty explicit pages from open team spaces", () => {
  assert.match(emptyGrantMessage("page"), /except active workspace administrators/);
  assert.match(emptyGrantMessage("space"), /workspace access, not private access/);
});

test("sharing UI labels workspace admins separately from editable grant roles", () => {
  const principals = sharingPrincipals([{ userId: "admin", name: "Admin user", email: "admin@example.test", role: "admin", status: "active" }], []);
  assert.match(principals[0].name, /admin \(permanent edit access\)/);
  assert.equal(availablePrincipals(principals, [{ principalType: "user", principalId: "admin", role: "viewer" }]).length, 0);
});

test("permissions layout overrides workspace sizing and keeps actions outside its scrolling body", () => {
  const panel = readFileSync(new URL("../src/PermissionsPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /<DialogHeader>[\s\S]*?<div className="pw-permissions-body">/);
  assert.match(panel, /<\/div>\s*<DialogFooter>/);
  assert.match(panel, /pw-permission-select/);
  const styles = postcss.parse(readFileSync(new URL("../src/pages.css", import.meta.url), "utf8"));
  const declarations = (selector: string) => {
    const values: Record<string, string> = {};
    styles.walkRules(selector, rule => { rule.walkDecls(declaration => { values[declaration.prop] = declaration.value; }); });
    return values;
  };
  const dialog = declarations('.pw-permissions[data-slot="dialog-content"]');
  assert.equal(dialog.display, "flex");
  assert.equal(dialog["flex-direction"], "column");
  assert.equal(dialog["min-height"], "0");
  assert.equal(dialog["min-width"], "0");
  assert.equal(dialog.width, "calc(100vw - 2rem)");
  assert.equal(dialog["max-height"], "calc(100dvh - 2rem)");
  assert.equal(declarations(".pw-permissions-body")["overflow-y"], "auto");
  assert.equal(declarations(".pw-permissions-body")["min-height"], "0");
  assert.equal(declarations(".pw-permission-list li > span")["overflow-wrap"], "anywhere");
  assert.equal(declarations('.pw-permission-select[data-slot="select-content"]')["min-height"], "0");
  let mobileRules = 0;
  styles.walkAtRules("media", rule => {
    if (rule.params !== "(max-width: 480px)") return;
    mobileRules += 1;
    assert.match(rule.toString(), /grid-template-columns: minmax\(0, 1fr\)/);
    assert.match(rule.toString(), /flex-direction: column/);
  });
  assert.equal(mobileRules, 1);
});

async function loadPermissionDetails() {
  const source = new URL("../src/PermissionDetails.tsx", import.meta.url);
  const result = await transformWithOxc(readFileSync(source, "utf8"), fileURLToPath(source), { jsx: { runtime: "automatic" } });
  const temporaryRoot = new URL("../.tmp/", import.meta.url);
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(new URL("sharing-ui-", temporaryRoot)));
  try {
    const compiled = join(directory, "PermissionDetails.mjs");
    await writeFile(compiled, result.code);
    return (await import(pathToFileURL(compiled).href) as typeof import("../src/PermissionDetails.tsx")).PermissionDetails;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("rendered permission details distinguish inheritance, overrides and private space defaults", async () => {
  const Details = await loadPermissionDetails();
  assert.ok(Details);
  const summary = { inherits: true, role: "editor" as const, canManage: true, grants: [], inherited: { source: "Page: Team handbook", grants: [{ principalType: "group" as const, principalId: "team", role: "commenter" as const }], entriesVisible: true, workspaceAccess: false } };
  const html = renderToStaticMarkup(createElement(Details, { summary, kind: "page", inherits: true, label: () => "Team group" }));
  for (const kind of ["page", "space"] as const) {
    const admin = renderToStaticMarkup(createElement(Details, { summary: { ...summary, workspaceRole: "admin" }, kind, inherits: false, label: () => "Team group" }));
    assert.match(admin, /Your effective access: <strong>admin<\/strong>/);
    assert.match(admin, /page capability is editor/);
    assert.match(admin, /not a removable grant/);
  }
  assert.match(html, /aria-label="Inherited access"/); assert.match(html, /Page: Team handbook/); assert.match(html, /Team group/); assert.match(html, /commenter/);
  const explicit = renderToStaticMarkup(createElement(Details, { summary, kind: "page", inherits: false, label: () => "Team group" }));
  assert.match(explicit, /overrides the inherited entries/);
  const readOnly = renderToStaticMarkup(createElement(Details, { summary: { ...summary, canManage: false, role: "viewer" }, kind: "page", inherits: true, label: () => "Secret principal" }));
  assert.match(readOnly, /Read-only summary/); assert.doesNotMatch(readOnly, /Secret principal/);
  const space = renderToStaticMarkup(createElement(Details, { summary: { ...summary, workspaceAccess: true }, kind: "space", inherits: false, label: () => "Team group" }));
  assert.match(space, /Currently uses workspace access/); assert.match(space, /explicit override can also admit people excluded/); assert.match(space, /Space names remain visible/);
});
