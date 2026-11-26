import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { createApp } from "../server/app.ts";
import { openDatabase } from "../server/database.ts";

function pngChunk(type: string, data: Buffer) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let checksum = 0xffffffff;
  for (const byte of payload) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE((checksum ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, crc]);
}

function testPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0);
  header.writeUInt32BE(24, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(24 * (1 + 32 * 3));
  for (let row = 0; row < 24; row++) {
    for (let column = 0; column < 32; column++) {
      const offset = row * 97 + 1 + column * 3;
      pixels[offset] = column < 16 ? 220 : 30;
      pixels[offset + 1] = 60;
      pixels[offset + 2] = column < 16 ? 30 : 220;
    }
  }
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]);
}

test("pdf: authenticated image and table survive real page print styles and headless PDF generation", { timeout: 120_000 }, async context => {
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright-core");
  const outputDir = resolve(".tmp");
  await mkdir(outputDir, { recursive: true });
  const temporary = await mkdtemp(join(outputDir, "wiki-pdf-"));
  const store = await openDatabase("memory://");
  let app: ReturnType<typeof createApp>;
  let origin = "";
  const server = await createServer({
    configFile: false, plugins: [react(), { name: "pdf-regression-api", configureServer(vite) {
      vite.middlewares.use((incoming, outgoing, next) => {
        if (!incoming.url?.startsWith("/api/")) return next();
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          const response = await app.handle(new Request(new URL(incoming.url!, origin), { method: incoming.method, headers, body: ["GET", "HEAD"].includes(incoming.method!) ? undefined : Buffer.concat(chunks) }), incoming.socket.remoteAddress ?? "browser");
          outgoing.statusCode = response.status;
          for (const [name, value] of response.headers) if (name !== "set-cookie") outgoing.setHeader(name, value);
          const cookies = response.headers.getSetCookie();
          if (cookies.length) outgoing.setHeader("set-cookie", cookies);
          outgoing.end(Buffer.from(await response.arrayBuffer()));
        })().catch(error => { outgoing.statusCode = 500; outgoing.end(JSON.stringify({ message: String(error) })); });
      });
    } }],
    resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  let browser: any;
  try {
    await server.listen();
    origin = server.resolvedUrls!.local[0].replace(/\/$/, "");
    app = createApp({ db: store.db, origin, secret: "pdf-test-secret-only-4b8c94b68da4933a43b0fd0ef33487de", environment: "test", uploadDir: join(temporary, "uploads"), mailProvider: { kind: "test", async send() {} } });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
    const session = await browser.newContext({ viewport: { width: 718, height: 1047 } });
    await session.addInitScript(() => {
      Object.defineProperty(window, "print", { configurable: false, writable: false, value: () => { throw new Error("System print dialogs are forbidden in this regression"); } });
    });
    const request = async (path: string, method = "GET", data?: unknown) => {
      const response = await session.request.fetch(origin + path, { method, data, headers: { origin } });
      const result = await response.json();
      assert.ok(response.ok(), JSON.stringify(result));
      return result;
    };
    await request("/api/register", "POST", { name: "PDF author", email: "pdf@example.test", password: "A long unique PDF test password 42!", companyName: "PDF workspace" });
    const identity = await request("/api/me"), companyId = identity.companies[0].companyId, userId = identity.user.id;
    const base = `/api/companies/${companyId}/pages`;
    const { id: pageId } = await request(base, "POST", { title: "Image and table PDF regression" });
    await request(`${base}/${pageId}/grants`, "PUT", { inherits: false, grants: [{ principalType: "user", principalId: userId, role: "editor" }] });
    const png = testPng();
    const upload = await session.request.post(`${origin}${base}/${pageId}/attachments`, { headers: { origin }, multipart: { file: { name: "private-chart.png", mimeType: "image/png", buffer: png } } });
    assert.ok(upload.ok(), await upload.text());
    const attachment = await upload.json();
    const anonymous = await browser.newContext();
    try {
      assert.ok(!(await anonymous.request.get(origin + attachment.url)).ok(), "the attachment must require authentication");
    } finally { await anonymous.close(); }
    const text = (value: string) => [{ type: "text", text: value, styles: {} }];
    const cells = ["PDF Topic", "PDF Owner", "Launch checklist", "Team Indigo"];
    await request(`${base}/${pageId}/content`, "PUT", { baseRevision: 1, content: [
      { id: "pdf-intro", type: "paragraph", content: text("Headless PDF image and table evidence") },
      { id: "pdf-image", type: "image", props: { url: attachment.url, name: "private-chart.png", caption: "Authenticated private chart", previewWidth: 320 } },
      { id: "pdf-table", type: "table", content: { type: "tableContent", headerRows: 1, rows: [{ cells: cells.slice(0, 2).map(text) }, { cells: cells.slice(2).map(text) }] } },
    ] });
    const page = await session.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error: Error) => failures.push(error.message));
    const imageResponse = page.waitForResponse((response: any) => response.url() === origin + attachment.url && response.request().resourceType() === "image");
    await page.goto(`${origin}/tests/fixtures/editor.html?company=${companyId}&page=${pageId}&user=${userId}&admin=1`);
    const editor = page.locator('[aria-label="Page content"] .bn-editor');
    await editor.waitFor();
    const image = editor.locator("img");
    await image.waitFor();
    const loaded = await imageResponse;
    assert.equal(loaded.status(), 200);
    assert.deepEqual(await loaded.body(), png, "the browser fetched the uploaded private PNG");
    await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>('[aria-label="Page content"] img')).some(image => image.complete && image.naturalWidth === 32 && image.naturalHeight === 24));
    await image.evaluate(async (element: HTMLImageElement) => { await element.decode(); });
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.emulateMedia({ media: "print" });
    assert.equal(await image.isVisible(), true);
    const table = editor.locator("table");
    await table.waitFor();
    assert.equal(await table.isVisible(), true);
    for (const cell of cells) assert.equal(await table.getByText(cell, { exact: true }).isVisible(), true);
    const layout = await table.evaluate((element: HTMLTableElement) => {
      const bounds = element.getBoundingClientRect();
      const root = element.closest('[aria-label="Page content"]')!.getBoundingClientRect();
      const visible = (target: Element) => {
        for (let ancestor: Element | null = target; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        }
        return target.getBoundingClientRect().width > 0 && target.getBoundingClientRect().height > 0;
      };
      return { fixed: getComputedStyle(element).tableLayout, visible: visible(element), fits: bounds.left >= root.left - 1 && bounds.right <= root.right + 1 && bounds.right <= innerWidth + 1, noOverflow: element.scrollWidth <= element.clientWidth + 1, cellsFit: Array.from(element.querySelectorAll("th,td")).every(cell => visible(cell) && cell.scrollWidth <= cell.clientWidth + 1), imageVisible: visible(document.querySelector('[aria-label="Page content"] img')!) };
    });
    assert.deepEqual(layout, { fixed: "fixed", visible: true, fits: true, noOverflow: true, cellsFit: true, imageVisible: true }, "production print CSS keeps the image and table visible without horizontal table overflow");
    const pdfPath = join(outputDir, "wiki-image-table.pdf");
    const pdf = await page.pdf({ path: pdfPath, format: "A4", margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" }, printBackground: true });
    assert.ok(pdf.length > 1_000, "PDF output must be nonempty");
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.deepEqual(await readFile(pdfPath), pdf);
    assert.match(pdf.toString("latin1"), /\/Subtype\s*\/Image\b/, "the PDF contains an embedded image object");
    const inspect = promisify(execFile);
    try {
      const { stdout } = await inspect("pdftotext", ["-layout", pdfPath, "-"]);
      for (const cell of cells) assert.ok(stdout.includes(cell), `PDF text contains ${cell}`);
      assert.ok(stdout.includes("Headless PDF image and table evidence"));
      context.diagnostic("PDF text extraction confirms all four recognizable table cells.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      context.diagnostic("pdftotext unavailable: PDF table text extraction was not checked; print DOM cells were checked.");
    }
    try {
      const { stdout } = await inspect("pdfimages", ["-list", pdfPath]);
      assert.match(stdout, /^\s*\d+\s+\d+\s+image\s+32\s+24\s/m, "the uploaded 32-by-24 PNG is embedded in the PDF");
      context.diagnostic("PDF image inventory confirms the uploaded PNG dimensions.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      context.diagnostic("pdfimages unavailable: embedded image dimensions were not inspected; PDF image object and decoded browser image were checked.");
    }
    assert.deepEqual(failures, []);
    context.diagnostic(`Saved ${pdf.length} bytes to ${pdfPath}; image embedding and print DOM checked, not rasterized visual appearance or multipage pagination.`);
  } finally {
    try { await browser?.close(); }
    finally {
      try { await server.close(); }
      finally { await store.close(); await rm(temporary, { recursive: true, force: true }); }
    }
  }
});
