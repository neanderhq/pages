# Pages development

Read `README.md`, [development](docs/development.md), [testing](docs/testing.md)
and [limitations](docs/limitations.md) first. Pages is a React/Vite client with a
Node TypeScript API, Better Auth and Drizzle. Unit/development databases may use
PGlite; the published application uses real PostgreSQL.

Use the pinned Node and pnpm versions. Keep credentials in ignored `.env.local`
or deployment-owned secret bundles. Never commit workspace databases, uploads,
provider keys, session/reset tokens, delivery evidence or test runtime artifacts.
Use explicitly disposable fixtures and clean up only the test's own resources.

Preserve company isolation, active memberships, workspace roles and page/space
grants on the server. The renderer presents authoritative permissions. Preserve
mutation Origin checks, invitation expiry, password-reset session revocation,
upload authorization and separation between private pages and public snapshots.

Production startup must not migrate a schema or initialize an account. Keep
migrations and retryable fictional seeding explicit. Generated demo credentials
must not reset a user's later password or data. Preserve the literal runtime
secret-bundle parser; never evaluate or source environment text as shell code.

Keep changes in the application's real components. Preserve vendored Notion
design-pack APIs and third-party notices. Do not hide a failing native editor
assertion, or claim physical-phone/reference-product parity from emulated checks.

Run focused tests and `pnpm verify`. Production checks exercise the actual built
image with disposable PostgreSQL and Chromium. Public Actions stay read-only,
SHA-pinned and credential-free. Required PR/CI/security checks and resolved
conversations apply; do not add CODEOWNERS or automatic reviewer routing.
