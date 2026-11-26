import { test } from "node:test";
import assert from "node:assert/strict";
import { createMailProviderFromEnvironment, createResendMailProvider, MailUnavailableError } from "../server/mail.ts";

test("Resend configuration stays server-side and sends a stable, idempotent text payload", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let request: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input); request = init; return new Response(null, { status: 202 });
  };
  try {
    const configured = createMailProviderFromEnvironment("production", { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "server-only-key", EMAIL_FROM: "Pages <pages@example.test>" });
    assert.equal(configured.kind, "delivery");
    await configured.send({ to: "person@example.test", kind: "mention", company: "Design", pageTitle: "Roadmap", url: "https://wiki.example.test/p/page", idempotencyKey: "notification-123" });
    assert.equal(requestUrl, "https://api.resend.com/emails");
    const headers = new Headers(request?.headers);
    assert.equal(headers.get("Authorization"), "Bearer server-only-key");
    assert.equal(headers.get("Idempotency-Key"), "notification-123");
    assert.deepEqual(JSON.parse(String(request?.body)), {
      from: "Pages <pages@example.test>", to: ["person@example.test"], subject: "You were mentioned on Roadmap",
      text: "You were mentioned on “Roadmap” in Design. View it here: https://wiki.example.test/p/page",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing or disabled Resend settings report unavailable instead of succeeding", async () => {
  const missing = createMailProviderFromEnvironment("production", { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "", EMAIL_FROM: "" });
  assert.equal(missing.kind, "unavailable");
  await assert.rejects(missing.send({ to: "person@example.test", kind: "review-reminder", url: "https://wiki.example.test" }), /Email delivery is unavailable/);
  const disabled = createMailProviderFromEnvironment("development", { EMAIL_PROVIDER: "disabled" });
  await assert.rejects(disabled.send({ to: "person@example.test", kind: "mention", url: "https://wiki.example.test" }), /Email delivery is disabled/);
  const none = createMailProviderFromEnvironment("production", { EMAIL_PROVIDER: "none" });
  await assert.rejects(none.send({ to: "person@example.test", kind: "mention", url: "https://wiki.example.test" }), /Email delivery is disabled/);
});

test("production missing-credential fallback sends nothing, logs safe metadata, and rejects delivery", async () => {
  const originalWarn = console.warn;
  const originalFetch = globalThis.fetch;
  const logs: string[] = [];
  let outboundRequests = 0;
  console.warn = (...values: unknown[]) => { logs.push(values.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ")); };
  globalThis.fetch = async () => { outboundRequests += 1; return new Response(null, { status: 202 }); };
  const sensitiveValues = [
    "private.person@example.test",
    "https://private.example.test/reset?token=secret-url-token",
    "secret-url-token",
    "private workspace name",
    "private page title",
    "private-idempotency-key",
    "server-resend-secret",
  ];
  try {
    const missingConfigurations: NodeJS.ProcessEnv[] = [
      {},
      { EMAIL_PROVIDER: "console" },
      { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "server-resend-secret" },
      { EMAIL_PROVIDER: "resend", EMAIL_FROM: "Pages <pages@example.test>" },
    ];
    const message = {
      to: sensitiveValues[0], kind: "password-reset" as const, url: sensitiveValues[1], company: sensitiveValues[3],
      pageTitle: sensitiveValues[4], idempotencyKey: sensitiveValues[5],
    };
    for (const settings of missingConfigurations) {
      const provider = createMailProviderFromEnvironment("production", settings);
      assert.equal(provider.kind, "unavailable");
      await assert.rejects(provider.send(message), error => {
        assert.ok(error instanceof MailUnavailableError);
        assert.equal(error.status, 503);
        assert.match(error.message, /Email delivery is unavailable/);
        return true;
      });
    }
    assert.equal(outboundRequests, 0);
    const warningOutput = logs.join("\n");
    assert.equal(logs.length, missingConfigurations.length);
    assert.match(warningOutput, /Email delivery unavailable; no message was sent/);
    assert.match(warningOutput, /password-reset/);
    assert.match(warningOutput, /"provider":"unset"/);
    assert.match(warningOutput, /"provider":"console"/);
    assert.match(warningOutput, /"provider":"resend"/);
    assert.match(warningOutput, /"kind":"password-reset"/);
    for (const value of sensitiveValues) assert.equal(warningOutput.includes(value), false);
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
});

test("development console email behavior remains available", async () => {
  const originalInfo = console.info;
  const logs: string[] = [];
  console.info = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
  try {
    const provider = createMailProviderFromEnvironment("development", {});
    assert.equal(provider.kind, "console");
    await provider.send({ to: "person@example.test", kind: "mention", url: "https://wiki.example.test/page" });
    assert.match(logs.join("\n"), /person@example\.test/);
    assert.match(logs.join("\n"), /https:\/\/wiki\.example\.test\/page/);
  } finally {
    console.info = originalInfo;
  }
});

test("Resend errors are surfaced without exposing provider response details", async () => {
  const provider = createResendMailProvider("server-only-key", "pages@example.test", async () => new Response("secret provider response", { status: 401 }));
  await assert.rejects(provider.send({ to: "person@example.test", kind: "password-reset", url: "https://wiki.example.test/reset" }), error => {
    assert.match((error as Error).message, /HTTP 401/);
    assert.equal((error as Error).message.includes("secret provider response"), false);
    assert.equal((error as Error).message.includes("server-only-key"), false);
    return true;
  });
});
