# Scope and limits

Pages implements a team wiki, not the full Notion product. It includes rich
pages and tables, a page tree, team spaces, role/grant-based access, discussions
and mentions, private attachments, revision history, review reminders, search,
Markdown exchange, archive/restore and explicit public snapshots.

## Delivery and operations

Email delivery needs your own configured provider and verified sender. The
template contains no provider credentials, delivery accounts or live workspace
data. Registration can create an independent workspace without email delivery;
invitation/reset requests fail clearly when production delivery is unavailable.

The runtime checks review reminders on startup and every minute. These checks
are application behavior, not managed scheduler infrastructure. Review reminder
email still requires an operator-supplied provider. Rate limiting is per-process
and keyed from the socket; arbitrary forwarded headers are not trusted.

Production requires PostgreSQL, HTTPS and a strong generated auth secret. Run
migrations before startup. Private attachment bytes are stored in PostgreSQL in
production so instance replacement does not discard them. Establish and test
your own consistent backup/restore process; see [the guide](BACKUP_RESTORE.md).

Public snapshots intentionally expose the captured page content by bearer URL
until revoked. They are separate from a deployment of the whole app. Browser
Save as PDF uses the browser's print facility, not a server PDF generation service.
Realtime multiplayer editing, domain verification and MFA are outside this scope.

## Mention input verification

Source intake recorded a discard confirmation when tapping a mention recipient
in a native inline reply. The template fixes that interaction through the
native comment controllers and keeps suggestions inside a resized viewport.
Browser regressions exercise keyboard, mouse and touch selection, saved tokens,
resolved recipients and notifications, plus the normal outside-click draft warning.
Generic touch and Android mobile emulation pass. These are emulated checks,
not physical-phone tests or a fresh comparison with Notion.

No package/image scanner can prove the absence of vulnerabilities. Keep source
checks, image scans, application permission tests and actual browser evidence
distinct from a claim of general production readiness.
