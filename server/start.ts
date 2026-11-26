import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { createRuntime } from "./runtime.ts";
import { isRuntimeRequestPath } from "./request-routing.ts";

const runtime = await createRuntime();
const root = resolve("dist");
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (pathname === "/api/health" && (request.method === "GET" || request.method === "HEAD")) {
    try { await runtime.healthy(); response.writeHead(200, { "Content-Type": "application/json" }); response.end(request.method === "HEAD" ? undefined : '{"ok":true}'); }
    catch { response.writeHead(503, { "Content-Type": "application/json" }); response.end(request.method === "HEAD" ? undefined : '{"ok":false}'); }
    return;
  }
  if (isRuntimeRequestPath(pathname)) { await runtime.middleware(request, response); return; }
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
  let path: string;
  try { path = resolve(root, `.${decodeURIComponent(pathname)}`); }
  catch { response.writeHead(400); response.end(); return; }
  if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  try {
    let content: Buffer;
    try { content = await readFile(path); }
    catch { path = resolve(root, "index.html"); content = await readFile(path); }
    response.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch { response.writeHead(503); response.end("Build the frontend with pnpm run build first."); }
});
server.listen(Number(process.env.PORT || 5173), process.env.HOST || "127.0.0.1", () => console.info(`Pages listening on ${process.env.APP_URL || "http://127.0.0.1:5173"}`));
let shutdownPromise: Promise<void> | undefined;
const shutdown = () => {
  if (shutdownPromise) return;
  shutdownPromise = runtime.stop();
  server.close(() => { void shutdownPromise!.then(() => runtime.close()).then(() => process.exit(0)); });
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, shutdown);
