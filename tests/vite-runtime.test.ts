import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfigFromFile } from "vite";

test("foundation-build: Vite API wiring boots real persistence and retains the signing secret across reopen without opening a port", async () => {
  const projectRoot = process.cwd();
  const dir = await mkdtemp(join(resolve(tmpdir()), "wiki-runtime-"));
  const previous = { DATA_DIR: process.env.DATA_DIR, APP_URL: process.env.APP_URL, NODE_ENV: process.env.NODE_ENV, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET, DATABASE_URL: process.env.DATABASE_URL };
  const runtimeGlobal = globalThis as typeof globalThis & { wikiDatabase?: Promise<{ close: () => Promise<void> }> };
  const shutdownHandlers: Array<() => unknown> = [];
  async function shutdown() {
    const handler = shutdownHandlers.shift();
    assert.ok(handler);
    await handler();
  }
  try {
    process.env.DATA_DIR = join(dir, "db"); process.env.APP_URL = "http://127.0.0.1:5173"; process.env.NODE_ENV = "development";
    delete process.env.BETTER_AUTH_SECRET; delete process.env.DATABASE_URL;
    const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, resolve(projectRoot, "vite.config.ts"), projectRoot, "silent");
    assert.ok(loaded);
    type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
    type WikiPlugin = { name: string; configureServer: (server: {
      httpServer: { once: (event: "close", listener: () => unknown) => unknown };
      middlewares: { use: (middleware: Middleware) => void };
    }) => Promise<void> };
    const plugin = (loaded.config.plugins!.flat() as WikiPlugin[]).find(candidate => candidate.name === "wiki-server")!;
    assert.ok(plugin);
    process.chdir(dir);
    let middleware: Middleware;
    async function boot() {
      await plugin.configureServer({
        httpServer: { once(_event, listener) { shutdownHandlers.push(listener); return this; } },
        middlewares: { use(handler) { middleware = handler; } },
      });
    }
    async function request(path: string, method = "GET", body?: unknown, cookie = "") {
      return new Promise<{ status: number; headers: Record<string, string | string[]>; body: any }>((finish, reject) => {
        const timeout = setTimeout(() => reject(new Error("Runtime middleware did not respond.")), 10_000);
        const headers: Record<string, string | string[]> = {};
        let status = 200;
        const incoming = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), { url: path, method, headers: { origin: "http://127.0.0.1:5173", "content-type": "application/json", cookie }, socket: { remoteAddress: "127.0.0.1" } }) as unknown as IncomingMessage;
        const outgoing = {
          get statusCode() { return status; }, set statusCode(value) { status = value; },
          setHeader(name: string, value: string | string[]) { headers[name.toLowerCase()] = value; },
          writeHead(value: number, values: Record<string, string>) { status = value; Object.assign(headers, values); },
          end(value: Buffer | string) { clearTimeout(timeout); try { finish({ status, headers, body: JSON.parse(String(value)) }); } catch (error) { reject(error); } },
        } as unknown as ServerResponse;
        middleware(incoming, outgoing, () => reject(new Error("Runtime request reached frontend fallback.")));
      });
    }
    await boot();
    assert.equal((await request("/api/me")).status, 401);
    assert.equal((await request(`/public/${"a".repeat(64)}`)).status, 404);
    const signup = await request("/api/register", "POST", { name: "Runtime Admin", email: "runtime@example.test", password: "Runtime-only password 67890!", companyName: "Runtime Company" });
    assert.equal(signup.status, 200, JSON.stringify(signup.body));
    const cookies = signup.headers["set-cookie"] as string[];
    assert.ok(Array.isArray(cookies));
    const cookie = cookies.map(value => value.split(";")[0]).join("; ");
    assert.equal((await request("/api/me", "GET", undefined, cookie)).body.companies[0].name, "Runtime Company");
    const savedSecret = await readFile(join(dir, ".data/auth-secret"), "utf8");
    assert.ok(savedSecret.length >= 64);
    assert.equal((await stat(join(dir, ".data/auth-secret"))).mode & 0o777, 0o600);
    await shutdown();
    assert.equal(runtimeGlobal.wikiDatabase, undefined);
    await boot();
    assert.equal(await readFile(join(dir, ".data/auth-secret"), "utf8"), savedSecret);
    const reopened = await request("/api/me", "GET", undefined, cookie);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.user.email, "runtime@example.test");
    assert.equal((await request("/api/auth/sign-out", "POST", {}, cookie)).status, 200);
    assert.equal((await request("/api/me", "GET", undefined, cookie)).status, 401);
  } finally {
    while (shutdownHandlers.length) await shutdown();
    if (runtimeGlobal.wikiDatabase) { await (await runtimeGlobal.wikiDatabase).close(); delete runtimeGlobal.wikiDatabase; }
    process.chdir(projectRoot);
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(dir, { recursive: true, force: true });
  }
});
