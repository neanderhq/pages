# Pages architecture

- `src/`: React workspace, rich editor and real API-backed UI.
- `server/`: Node API, Better Auth, Drizzle, authorization, uploads and delivery.
- `drizzle/`: committed production PostgreSQL migrations.
- `server/migrations/`: existing local PGlite migration inputs.
- `.neander/compose.yaml`: normal publishing recipe and environment requirements.
- `.neander/template.yaml`: repository-owned metadata, sample initialization and gallery.
- `tests/`: application, native browser and optional direct PostgreSQL regressions.

Use the [README](../README.md), [development guide](development.md),
[testing guide](testing.md), [role matrix](ROLE_MATRIX.md) and
[limitations](limitations.md). Source preparation, successful verification,
template artifact registration and deployment of a user's app are distinct
operations. No delivery account, shared provider key or live database is part of
this repository.
