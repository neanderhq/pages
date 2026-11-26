# Backup and restore

These are operational recommendations, not a production recovery certification.
Use a database you own, preserve the current data and rehearse recovery in an
isolated location with delivery disabled before considering a cutover.

## Published PostgreSQL deployment

Production stores workspace content, authentication records and attachment bytes
in PostgreSQL. Use a consistent provider snapshot or compatible `pg_dump` /
`pg_restore` process for the whole application database. Do not substitute a copy
of an application container's filesystem.

Keep the exact configured auth secret, public origin and matching application /
runtime/migration versions with the recovery plan. Protect secrets separately
with encryption and access controls. The literal managed environment loader
preserves the configured secret; keep it unchanged with the matching application
version. Changing it invalidates sessions and can make existing invitation copy
tokens undecryptable.

Restore into a new database rather than overwriting a live one. Start a separate
application with email disabled, use an isolated browser profile, and check fresh
Admin/non-Admin login, workspace and page permissions, revisions/comments,
archive state, upload byte hashes and public snapshot revocation. Record actual
results before relying on the restored data. A database migration or close/reopen
test is not a full operational recovery rehearsal.

## Embedded local development database

With `DATABASE_URL` empty, the existing development path uses PGlite. Stop all
writers before making an offline copy of the entire configured `DATA_DIR`, local
uploads directory and actual secret source. If the secret was generated locally,
it is under `.data/auth-secret` regardless of `DATA_DIR`. Environment-supplied
secrets must be preserved separately; copying that file does not preserve them.

Keep copies outside Git and outside the live data directory, with private
permissions. Restore into a new directory using the same application version,
configure its paths and secret explicitly, disable email and test it separately.
Never copy PostgreSQL server data directories using the PGlite procedure.

Workspace backups contain sensitive account, session, content and invitation
material. Do not publish them, put them in source or use them as template sample
data. Template and browser tests use independent fictional fixtures only.
