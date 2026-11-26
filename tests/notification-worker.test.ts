import { test } from "node:test";
import assert from "node:assert/strict";
import { startReviewReminderWorker } from "../server/runtime.ts";

test("review reminder worker runs at startup and on its configured interval", async () => {
  let calls = 0;
  let intervalCallback: (() => void) | undefined;
  let intervalMs = 0;
  let cancelled = false;
  const schedule = ((callback: () => void, delay: number) => {
    intervalCallback = callback;
    intervalMs = delay;
    return {} as NodeJS.Timeout;
  }) as typeof setInterval;
  const cancel = (() => { cancelled = true; }) as typeof clearInterval;
  const stop = startReviewReminderWorker(async () => { calls++; }, 30_000, schedule, cancel);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(intervalMs, 30_000);
  intervalCallback!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  await stop();
  assert.equal(cancelled, true);
  intervalCallback!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
});

test("review reminder worker shutdown waits for an active sweep", async () => {
  let intervalCallback: (() => void) | undefined;
  let releaseSweep: (() => void) | undefined;
  let cancelled = false;
  const schedule = ((callback: () => void) => {
    intervalCallback = callback;
    return {} as NodeJS.Timeout;
  }) as typeof setInterval;
  const cancel = (() => { cancelled = true; }) as typeof clearInterval;
  const stop = startReviewReminderWorker(() => new Promise<void>(resolve => { releaseSweep = resolve; }), 30_000, schedule, cancel);

  await new Promise(resolve => setImmediate(resolve));
  let stopped = false;
  const stopping = stop().then(() => { stopped = true; });
  intervalCallback!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.equal(stopped, false);
  releaseSweep!();
  await stopping;
  assert.equal(stopped, true);
});
