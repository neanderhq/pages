import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { printPage, waitForPageImages } from "../src/printPage.ts";

class ImageFixture extends EventTarget {
  complete = true;
  naturalWidth = 640;
  loading: HTMLImageElement["loading"] = "lazy";
  decodes = 0;
  listeners = new Set<EventListenerOrEventListenerObject>();
  decode = async () => { this.decodes++; };
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    if (listener) this.listeners.add(listener);
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    if (listener) this.listeners.delete(listener);
    super.removeEventListener(type, listener, options);
  }
}
const root = (...images: ImageFixture[]) => ({ querySelectorAll: (selector: "img") => { assert.equal(selector, "img"); return images; } });

test("printing waits for every loaded image to decode before opening browser print", async () => {
  const first = new ImageFixture(), second = new ImageFixture();
  let decoded!: () => void, printed = 0;
  second.decode = () => new Promise<void>(resolve => { decoded = resolve; });
  const printing = printPage(root(first, second), () => { printed++; });
  await Promise.resolve();
  assert.equal(first.decodes, 1);
  assert.equal(printed, 0);
  decoded(); await printing;
  assert.equal(printed, 1);
});

test("lazy images load eagerly using existing elements, then decode with listener cleanup", async () => {
  const image = new ImageFixture(); image.complete = false;
  let printed = false;
  const printing = printPage(root(image), () => { printed = true; });
  assert.equal(image.loading, "eager");
  assert.equal(printed, false);
  image.complete = true; image.dispatchEvent(new Event("load")); await printing;
  assert.equal(printed, true);
  assert.equal(image.decodes, 1);
  assert.equal(image.listeners.size, 0);
  assert.equal(image.loading, "lazy");
});

test("missing and undecodable images stop print with actionable errors", async () => {
  let printed = 0;
  const missing = new ImageFixture(); missing.naturalWidth = 0;
  await assert.rejects(printPage(root(missing), () => { printed++; }), /missing.*attachment access/);
  const corrupt = new ImageFixture(); corrupt.decode = async () => { throw new Error("Bad image"); };
  await assert.rejects(printPage(root(corrupt), () => { printed++; }), /could not be decoded/);
  assert.equal(printed, 0);
});

test("image network/access error stops print and cleans up other pending images", async () => {
  const denied = new ImageFixture(), pending = new ImageFixture();
  denied.complete = false; pending.complete = false;
  let printed = false;
  const printing = printPage(root(denied, pending), () => { printed = true; });
  denied.dispatchEvent(new Event("error"));
  await assert.rejects(printing, /could not be loaded.*attachment access/);
  assert.equal(printed, false);
  assert.equal(denied.listeners.size, 0);
  assert.equal(pending.listeners.size, 0);
  assert.equal(pending.loading, "lazy");
});

test("image load and decode deadlines fail deterministically without opening print", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for (const decoding of [false, true]) {
    const image = new ImageFixture();
    image.complete = decoding;
    image.decode = () => new Promise<void>(() => {});
    let printed = false;
    const printing = printPage(root(image), () => { printed = true; }, { timeoutMs: 500 });
    const rejected = assert.rejects(printing, /still loading.*try PDF again/);
    context.mock.timers.tick(500); await rejected;
    assert.equal(printed, false);
    assert.equal(image.listeners.size, 0);
  }
});

test("leaving a page cancels image preparation and never prints a different page", async () => {
  const image = new ImageFixture(); image.complete = false;
  const controller = new AbortController();
  let printed = false;
  const printing = printPage(root(image), () => { printed = true; }, { signal: controller.signal });
  controller.abort(); await assert.rejects(printing, /cancelled/);
  await assert.rejects(waitForPageImages(root(), { signal: controller.signal }), /cancelled/);
  assert.equal(printed, false);
  assert.equal(image.listeners.size, 0);
});

test("image-free pages print and browser print errors propagate for the UI to display", async () => {
  let printed = 0;
  await printPage(root(), () => { printed++; });
  assert.equal(printed, 1);
  await assert.rejects(printPage(root(), () => { throw new Error("Print unavailable"); }), /Print unavailable/);
});

test("print layout contains image bounds, wide-column wrapping and multipage table rules", () => {
  const css = readFileSync(new URL("../src/print.css", import.meta.url), "utf8");
  assert.match(css, /^@media print/);
  assert.match(css, /\.pw-editor img\s*\{[^}]*max-width: 100% !important;[^}]*max-height: 240mm !important;[^}]*height: auto !important;/);
  assert.match(css, /\.pw-editor \.bn-editor \[data-content-type="table"\] table\s*\{[^}]*width: 100% !important;[^}]*table-layout: fixed !important;[^}]*break-inside: auto !important;/);
  assert.match(css, /\.tableWrapper\s*\{[^}]*overflow: visible !important;/);
  assert.match(css, /\.pw-editor col\s*\{[^}]*width: auto !important;/);
  assert.match(css, /:is\(th, td\)\s*\{[^}]*white-space: normal !important;[^}]*overflow-wrap: anywhere !important;/);
  assert.match(css, /thead\s*\{ display: table-header-group;/);
  const view = readFileSync(new URL("../src/PageView.tsx", import.meta.url), "utf8");
  assert.match(view, /import "\.\/print.css"/);
  assert.match(view, /await printPage\(root, \(\) => window.print\(\), \{ signal: controller.signal \}\)/);
  assert.match(view, /PDF could not be prepared/);
});

test("A-20 print rules hide the whole Backlinks section and editor UI, not authored content", () => {
  const styles = postcss.parse(readFileSync(new URL("../src/print.css", import.meta.url), "utf8"));
  const hiddenSelectors: string[] = [];
  styles.walkRules(rule => {
    rule.walkDecls(declaration => {
      if (declaration.prop !== "display" || declaration.value !== "none") return;
      const media = rule.parent;
      assert.ok(media?.type === "atrule");
      assert.equal(media.name, "media");
      assert.equal(media.params, "print");
      assert.equal(declaration.important, true);
      hiddenSelectors.push(...rule.selectors);
    });
  });
  assert.deepEqual(hiddenSelectors.sort(), [
    ".pw-backlinks", ".pw-editor > .pw-page-tools", ".pw-editor > .wiki-notice", ".pw-editor-loading",
    '.pw-page button:not([role="checkbox"])', ".bn-toolbar", ".bn-side-menu", ".bn-suggestion-menu", ".bn-panel",
    ".bn-table-handle", ".bn-table-cell-handle", ".bn-extend-button", ".pw-editor .bn-resize-handle", ".pw-editor .bn-add-file-button",
  ].sort());
  const placeholder = styles.nodes.flatMap(node => node.type === "atrule" && node.name === "media" && node.params === "print" ? node.nodes ?? [] : [])
    .find(node => node.type === "rule" && node.selector === ".pw-editor .bn-block-content:has(.ProseMirror-trailingBreak:only-child)::after");
  assert.ok(placeholder?.type === "rule");
  assert.ok(placeholder.nodes.some(node => node.type === "decl" && node.prop === "content" && node.value === "none" && node.important));
  const tools = readFileSync(new URL("../src/PageTools.tsx", import.meta.url), "utf8");
  assert.match(tools, /<section className="pw-page-tools pw-backlinks" aria-label="Backlinks">[\s\S]*?Refresh backlinks[\s\S]*?<\/section>/);
});
