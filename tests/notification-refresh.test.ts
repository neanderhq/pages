import { test } from "node:test";
import assert from "node:assert/strict";
import { createNotificationFeed } from "../src/notificationFeed.ts";
import type { Notification } from "../src/collabApi.ts";

const result = (unread: number) => ({ notifications: [{ id: `notification-${unread}`, readAt: null } as Notification], unread });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred<Value>() {
  let resolve!: (value: Value) => void, reject!: (error: Error) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
function environment() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  let tick = () => {}, cancelled = false, interval = 0;
  return { window, document, every(callback: () => void, milliseconds: number) { tick = callback; interval = milliseconds; return () => { cancelled = true; }; }, poll: () => { if (!cancelled) tick(); }, get interval() { return interval; }, get cancelled() { return cancelled; } };
}

test("notification feed shares fresh server counts across entry, focus, visible return, polling and explicit refresh", async () => {
  let calls = 0;
  const feed = createNotificationFeed({ notifications: async () => result(++calls) });
  const browser = environment();
  const observed: number[] = [];
  const unsubscribe = feed.subscribe(() => { observed.push(feed.getSnapshot().unread ?? 0); });
  const stop = feed.start(browser);
  await flush();
  assert.equal(feed.getSnapshot().unread, 1);
  assert.equal(browser.interval, 30_000);
  browser.window.dispatchEvent(new Event("focus")); await flush();
  assert.equal(feed.getSnapshot().unread, 2);
  browser.document.visibilityState = "hidden";
  browser.poll(); browser.window.dispatchEvent(new Event("focus"));
  browser.document.dispatchEvent(new Event("visibilitychange")); await flush();
  assert.equal(calls, 2);
  browser.document.visibilityState = "visible";
  browser.document.dispatchEvent(new Event("visibilitychange")); await flush();
  browser.poll(); await flush();
  await feed.refresh();
  assert.equal(feed.getSnapshot().unread, 5);
  assert.equal(feed.getSnapshot().notifications?.[0].id, "notification-5");
  assert.ok(observed.includes(5));
  unsubscribe(); stop();
  assert.equal(browser.cancelled, true);
  browser.poll(); browser.window.dispatchEvent(new Event("focus"));
  browser.document.dispatchEvent(new Event("visibilitychange")); await flush();
  assert.equal(calls, 5);
});

test("notification refresh failure is recoverable, retains existing rows and clears loading", async () => {
  let fail = true;
  const feed = createNotificationFeed({ notifications: async () => { if (fail) throw new Error("Offline"); return result(4); } });
  const stop = feed.start(environment()); await flush();
  assert.equal(feed.getSnapshot().error, "Offline");
  assert.equal(feed.getSnapshot().loading, false);
  assert.equal(feed.getSnapshot().notifications, null);
  fail = false; await feed.refresh();
  assert.equal(feed.getSnapshot().error, "");
  assert.equal(feed.getSnapshot().unread, 4);
  fail = true; await feed.refresh();
  assert.equal(feed.getSnapshot().notifications?.[0].id, "notification-4");
  assert.equal(feed.getSnapshot().error, "Offline");
  stop();
});

test("out-of-order notification responses cannot replace a newer refresh", async () => {
  const old = deferred<ReturnType<typeof result>>(), latest = deferred<ReturnType<typeof result>>();
  let calls = 0;
  const feed = createNotificationFeed({ notifications: () => ++calls === 1 ? old.promise : latest.promise });
  const stop = feed.start(environment());
  const refresh = feed.refresh();
  latest.resolve(result(2)); await refresh;
  old.resolve(result(99)); await flush();
  assert.equal(feed.getSnapshot().unread, 2);
  stop();
});

test("workspace cleanup ignores both late responses and late errors, including StrictMode restart", async () => {
  for (const reject of [false, true]) {
    const old = deferred<ReturnType<typeof result>>();
    let calls = 0;
    const previous = createNotificationFeed({ notifications: () => ++calls === 1 ? old.promise : Promise.resolve(result(3)) });
    const stop = previous.start(environment()); stop();
    const current = createNotificationFeed({ notifications: async () => result(7) });
    const stopCurrent = current.start(environment());
    const restart = previous.start(environment()); await flush();
    if (reject) old.reject(new Error("Old workspace failure")); else old.resolve(result(88));
    await flush();
    assert.equal(previous.getSnapshot().unread, 3);
    assert.equal(previous.getSnapshot().error, "");
    assert.equal(current.getSnapshot().unread, 7);
    restart(); stopCurrent();
  }
});

test("read and all-read mutations invalidate in-flight counts then reload authoritative totals", async () => {
  const old = deferred<ReturnType<typeof result>>();
  let calls = 0;
  const feed = createNotificationFeed({ notifications: () => ++calls === 1 ? old.promise : Promise.resolve(result(calls === 2 ? 12 : 0)) });
  const browser = environment(), stop = feed.start(browser);
  const write = deferred<void>();
  const mutation = feed.mutate(() => write.promise);
  browser.window.dispatchEvent(new Event("focus")); browser.poll();
  assert.equal(calls, 1);
  old.resolve(result(99)); await flush();
  assert.equal(feed.getSnapshot().unread, null);
  write.resolve(); assert.equal(await mutation, true);
  assert.equal(feed.getSnapshot().unread, 12);
  assert.equal(feed.getSnapshot().notifications?.length, 1);
  assert.equal(await feed.mutate(async () => {}), true);
  assert.equal(feed.getSnapshot().unread, 0);
  assert.equal(calls, 3);
  stop();
});

test("failed read is retryable and writes completing after workspace exit do not refresh or navigate", async () => {
  let calls = 0;
  const feed = createNotificationFeed({ notifications: async () => result(++calls) });
  const stop = feed.start(environment()); await flush();
  assert.equal(await feed.mutate(async () => { throw new Error("Read failed"); }), false);
  assert.equal(feed.getSnapshot().busy, false);
  assert.equal(feed.getSnapshot().error, "Read failed");
  await feed.refresh();
  assert.equal(feed.getSnapshot().error, "");
  const write = deferred<void>();
  const mutation = feed.mutate(() => write.promise);
  stop(); write.resolve();
  assert.equal(await mutation, false);
  assert.equal(calls, 2);
});
