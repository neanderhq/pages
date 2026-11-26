import { sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./app.ts";
import { openConfiguredDatabase } from "./database.ts";
import { createMailProviderFromEnvironment } from "./mail.ts";
import { sweepReviewDueReminders } from "./notifications.ts";
import { requestLimit } from "./pages.ts";

type Store = Awaited<ReturnType<typeof openConfiguredDatabase>>;
const runtimeGlobal = globalThis as typeof globalThis & { wikiDatabase?: Promise<Store> };

export function startReviewReminderWorker(sweep: () => Promise<unknown>, intervalMs: number, schedule = setInterval, cancel = clearInterval) {
  let running: Promise<void> | undefined;
  let stopped = false;
  const run = () => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = Promise.resolve().then(sweep).then(() => undefined).catch(error => {
      console.error("Review reminder sweep failed.", error);
    }).finally(() => { running = undefined; });
    return running;
  };
  void run();
  const timer = schedule(() => { void run(); }, intervalMs);
  timer.unref?.();
  return async () => {
    if (!stopped) {
      stopped = true;
      cancel(timer);
    }
    await running;
  };
}

export async function createRuntime() {
  const production = process.env.NODE_ENV === "production";
  const origin = process.env.APP_URL || "http://127.0.0.1:5173";
  let secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    if (production) throw new Error("Production requires BETTER_AUTH_SECRET.");
    await mkdir(".data", { recursive: true });
    try { secret = await readFile(".data/auth-secret", "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      secret = randomBytes(48).toString("hex");
      try { await writeFile(".data/auth-secret", secret, { mode: 0o600, flag: "wx" }); }
      catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
        secret = await readFile(".data/auth-secret", "utf8");
      }
    }
  }
  runtimeGlobal.wikiDatabase ??= openConfiguredDatabase();
  const databasePromise = runtimeGlobal.wikiDatabase;
  let store: Store;
  try { store = await databasePromise; }
  catch (error) {
    if (runtimeGlobal.wikiDatabase === databasePromise) delete runtimeGlobal.wikiDatabase;
    throw error;
  }
  const mailProvider = createMailProviderFromEnvironment(process.env.NODE_ENV ?? "development");
  const app = createApp({ db: store.db, origin, secret, mailProvider });
  const stopReminderWorker = startReviewReminderWorker(() => sweepReviewDueReminders(store.db, mailProvider, origin), 60_000);
  let stopPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  const stop = () => {
    stopPromise ??= stopReminderWorker();
    return stopPromise;
  };
  return {
    db: store.db,
    async healthy() { await store.db.execute(sql`SELECT 1`); },
    stop,
    close() {
      closePromise ??= (async () => {
        await stop();
        await store.close();
        if (runtimeGlobal.wikiDatabase === databasePromise) delete runtimeGlobal.wikiDatabase;
      })();
      return closePromise;
    },
    async middleware(incoming: IncomingMessage, outgoing: ServerResponse) {
      try {
        const chunks: Buffer[] = [];
        let bytes = 0;
        const limit = requestLimit(incoming.method || "GET", new URL(incoming.url || "/", origin).pathname);
        for await (const chunk of incoming) {
          bytes += chunk.length;
          if (bytes > limit) { outgoing.writeHead(413, { "Content-Type": "application/json" }); outgoing.end(JSON.stringify({ message: "Request is too large." })); return; }
          chunks.push(Buffer.from(chunk));
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
          else if (value !== undefined) headers.set(name, value);
        }
        const request = new Request(new URL(incoming.url || "/", origin), {
          method: incoming.method, headers,
          body: incoming.method !== "GET" && incoming.method !== "HEAD" ? Buffer.concat(chunks) : undefined,
        });
        const response = await app.handle(request, incoming.socket.remoteAddress || "local");
        outgoing.statusCode = response.status;
        for (const [name, value] of response.headers) if (name !== "set-cookie") outgoing.setHeader(name, value);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) outgoing.setHeader("Set-Cookie", cookies);
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        outgoing.writeHead(500, { "Content-Type": "application/json" });
        outgoing.end(JSON.stringify({ message: "The server could not complete this request." }));
      }
    },
  };
}
