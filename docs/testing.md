# Verification

`pnpm verify` runs TypeScript, the standard application tests, repository-policy
checks and the production frontend build. The standard suite covers real request
handlers, Better Auth and Drizzle with isolated PGlite; it includes an explicit
optional PostgreSQL test when `PUBLISH_TEST_DATABASE_URL` is supplied.

Public CI makes the PostgreSQL path mandatory in its runtime job: it migrates a
separate disposable database and runs that test with a DML-only application role.
It also builds and scans the actual runtime image, initializes the fictional
template database and runs the real browser/seed/persistence smoke suite.

## Native editor regression

Run `PLAYWRIGHT_MODULE=playwright pnpm test:editor-browser` after
`pnpm exec playwright install chromium`. `CHROME_BIN` can select another installed
Chromium executable. The test exercises the actual PageView/BlockNote UI,
including inline comments, reply mention selection and mobile tables. Keep its
assertions; a passing unit suite does not establish native browser behavior.

The suite runs keyboard and touch reply scenarios independently, preserves the
original new-comment and table assertions, and checks that a real outside click
still warns before discarding a draft. To repeat with Android mobile emulation:

```sh
PAGES_TEST_DEVICE=android PLAYWRIGHT_MODULE=playwright pnpm test:editor-browser
```

The Android run uses the app's mobile action menu. Emulation does not establish
physical-phone behavior or reference-product parity. Source intake's native
reply-touch problem was reproduced and fixed in this template; the standard
unit suite alone did not establish a passing browser result.

## Real production image

Use `.github/workflows/check.yml` as executable setup. Migrate a disposable
PostgreSQL database, seed fictional content and supply the built
`NEANDER_TEMPLATE_IMAGE`, exact `DATABASE_URL` /
`NEANDER_TEMPLATE_TEST_DATABASE_URL`, generated `BETTER_AUTH_SECRET` and
`DEMO_PASSWORD`. `pnpm test:production` and `pnpm test:template` share the same
smoke entrypoint. HTTPS production behavior remains enforced; local browser
verification uses only its own disposable TLS fixture.

Reports, runtime data and raw browser captures belong outside committed source
or under ignored `.cache/`. Only deliberately reviewed fictional screenshots
belong in the gallery. Never use live credentials or send external email as a
test shortcut. A successful check describes the exact run; it does not certify
reference-product parity, unknown vulnerabilities or a live user deployment.
