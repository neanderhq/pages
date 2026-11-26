# Pages verification scope

Run the commands in [testing](testing.md) against an exact source revision.
Check login/workspace isolation, roles/page grants, rich content and tables,
inline discussion and mention selection, upload access, snapshots/exports,
revision history and persistence after restart/reseed.

The source intake's standard suite passed with one optional PostgreSQL test;
that alone did not establish a passing native editor browser suite. The recorded touch
inline-reply issue is fixed and covered by generic and Android-emulated browser
regressions. Current results must be reported from actual runs,
including limitations; do not reuse an older delivery checklist as fresh proof.

Published-image verification uses disposable PostgreSQL and fictional accounts.
The public CI runtime job explicitly exercises the PostgreSQL path and actual
image; security scans complement those checks. Never reuse a live workspace,
provider key or external email inbox as a test fixture.
