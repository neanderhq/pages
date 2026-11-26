# Development

The React client lives in `src/`, the application API and authorization in
`server/`, and committed production migrations in `drizzle/`. `server/migrations/`
retains the idempotent local PGlite migrations. The existing Notion-style design
pack is versioned under `.neander/design-packs/` and `src/neander-design-pack/`;
preserve its notices and component APIs.

Use Node24.22.3 and pnpm11.18.0. Install with `pnpm install --frozen-lockfile`.
Repository-policy checks also require Python3 and `PyYAML==6.0.3`. Follow the
PostgreSQL setup in the README. The direct dev/start/seed/migration commands load
an optional ignored `.env.local` using Node's literal env-file parser.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Loopback Vite client and application API |
| `pnpm check` | TypeScript |
| `pnpm test` | Existing application tests with isolated PGlite |
| `pnpm test:editor-browser` | Actual native editor browser regressions |
| `pnpm test:policy` | Repository and workflow conventions |
| `pnpm build` | Production client output |
| `pnpm start` | Built client and Node API |
| `pnpm db:migrate` | Committed PostgreSQL schema migrations |
| `pnpm db:seed` | Explicit fictional template initialization |
| `pnpm test:production` | Real built image/database/browser verification |

Development may use file-backed PGlite when `DATABASE_URL` is empty. A local
auth secret is then generated under ignored `.data/` if none was supplied. Keep
this directory and console-mail output private. Tests use their own temporary
databases and must never attach a real workspace database.

With no mail provider, local development prints links to the server terminal.
Production invitation/reset delivery requires your own `EMAIL_PROVIDER=resend`,
`RESEND_API_KEY` and `EMAIL_FROM`. Unconfigured production delivery fails clearly;
it never falls back to printing bearer links or sending from a shared account.
In-app collaboration and notifications do not require a provider purchase.

The application owns its authorization decisions. See [the role matrix](ROLE_MATRIX.md)
before changing page inheritance, archived-tree access, memberships, uploads or
public snapshot behavior. See [backup and restore](BACKUP_RESTORE.md) before
handling real data. Tests and image checks are not a backup/recovery drill.
