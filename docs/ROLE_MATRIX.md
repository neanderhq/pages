# Roles and access

Source-checked on November 25, 2026. The current feature and verification status is in [acceptance evidence](ACCEPTANCE.md). See also [setup](SETUP.md), [walkthrough](WALKTHROUGH.md) and [handover](HANDOVER.md).

## Two different kinds of role

Workspace membership is **Admin, Editor or Viewer**. Page and space grants are **editor, commenter or viewer**. A workspace Editor is not automatically an editor of a restricted page. Matching user/group grants combine at the highest role. Workspace Viewers are capped at viewer even if granted editor or commenter.

**Owner** is the person responsible for a page, not a workspace role or superuser. **Guest** is not implemented: a nonmember has no private workspace access. A **public link** is a bearer link to a separately published, immutable snapshot, not membership or live page access.

## Action matrix

All private actions require active membership in the same workspace. Except restore and publication management, page actions below refer to active pages. “Editor”, “Commenter” and “Viewer” columns mean the **effective page role**, after inheritance and the workspace Viewer cap. “Conditional” means ownership alone grants nothing for that action; apply the effective-role/destination rules below.

| Action | Page owner | Workspace Admin | Effective Editor | Effective Commenter | Effective Viewer | Guest/nonmember | Public link holder |
| --- | --- | --- | --- | --- | --- | --- | --- |
| View | Conditional | Yes | Yes | Yes | Yes | No | Snapshot only |
| Edit/rename/upload/tags/restore revision | Conditional | Yes | Yes | No | No | No | No |
| Comment/reply/resolve/reopen | Conditional | Yes | Yes | Yes | No | No | No |
| Share private page/change page grants | Conditional | Yes | Yes | No | No | No | No |
| Publish public snapshot | Owner + effective editor | Yes | Only if also owner | No | No | No | No |
| Move/reorder | Conditional | Destination rules | Destination + tree rules | No | No | No | No |
| Archive | Conditional | Yes | Tree rules | No | No | No | No |
| Restore archived tree | Archived-root rules | Yes | Archived-root rules | No | No | No | No |
| Export Markdown | Conditional | Yes | Yes | Yes | Yes | No | No private export endpoint |
| Import Markdown/create | Destination editor required | Yes | Destination editor required | Destination editor required elsewhere | Destination editor required elsewhere; workspace Viewer cannot | No | No |
| Manage members/invitations/groups/create spaces | Only if workspace Admin | Yes | Only if workspace Admin | No | No | No | No |
| Browse paginated audit log | No | Yes | No | No | No | No | No |

An effective Commenter/Viewer on one restricted page may be an editor at a different destination; page-local roles do not govern creation elsewhere. The audit log is available only to workspace Admins and is paginated; non-admin requests are denied. Resolved audit targets may show a page title or member name/email while retaining the raw target ID; cross-company labels are not revealed. Public readers can read/copy the snapshot HTML; there is no public Markdown export API. A user may manually use its Save as PDF action, which invokes OS/browser printing, not a server-generated PDF download.

### Important boundaries

- Admin bypass applies to all **active** pages, including explicit empty page overrides. It does not bypass workspace membership/company isolation or allow normal reads of archived pages. Demotion/deactivation removes the exception.
- Comment messages may be edited only by their own author with comment access. An Admin can delete another person's message, not rewrite it.
- Any effective viewer can read comments, revisions and page activity, download that page's private attachments and export its Markdown. Page activity is separate from the stored workspace audit log, which only workspace Admins can browse.
- An accessible page's owner may change the review interval and mark reviewed even without effective editor, unless their workspace role is Viewer. Effective editors can also do this. Reassigning ownership requires effective editor; the new owner must be an active member able to view the page. Ownership grants no otherwise missing access.
- Comment mention suggestions exclude the signed-in user and are restricted to active same-workspace members who can access the page; the endpoint returns at most eight matches. Mention notifications also recheck page access.
- Review-due reminders are scheduled on server startup and every minute, deduplicated once per due period, and sent to the page owner. The scheduler is stopped and awaited during shutdown; email failures remain visible and can be retried.
- Markdown import chooses the title from the exported title marker, then the first H1, then the filename. The H1 remains in the imported page body.
- Publishing requires owner **or** Admin **and** effective editor. An active owner/Admin can inspect/revoke an existing publication even after archival. Public snapshots do not track later edits; revoke them explicitly. Private attachment bytes remain private.
- Duplication needs source visibility and editor at the copy's destination (beside the original). Only the visible, active subtree is copied; hidden subtrees are skipped. The copier owns the new pages; explicit restrictions are copied with the copier added as editor. This is not a complete backup.

## Overrides, inheritance and moves

1. With inheritance enabled, access walks to the nearest ancestor with explicit settings; otherwise it reaches the space. Matching user/group grants at that target determine access, not a union of every ancestor.
2. A space with **no grants** (including the company space) is open to active members as editors, subject to the workspace Viewer cap. Only Admin can initially restrict an open team space. Editors of an already restricted space may manage its sharing. Saving an empty space grant list reopens it.
3. A page with inheritance **off** and **zero grants** denies non-Admins. It does not become workspace-open. Restoring inheritance removes the page's own grants. Removing one's own edit access requires explicit self-lockout confirmation.
4. Moving requires editor on the source and destination parent/space, rejects cycles and cross-company targets, and checks the whole affected tree. Non-Admins must be able to **view every descendant**, not edit every child. Traversal includes archived descendants; because normal visibility excludes them, they can block move/archive. Admin bypasses that descendant guard.
5. The move preview compares audiences and roles. Changed access requires explicit acknowledgement with a current impact token; stale confirmation is rejected. Explicit overrides remain in place. Inheriting pages follow the new ancestry. Cross-space moves update the entire subtree's space.
6. Archiving preserves IDs, content, history and restrictions. Restore authorization uses editor access at the **archived root**, not normal active-page access or a child's independent grant. Restore returns that archived tree; if the former parent is missing/archived, its root returns at the space's top level. Previously separately archived descendants retain their own archive roots.

Pages public snapshots are an application capability under these matrix rules. Neander Publish deploys the entire app, and template publication registers reusable images/source metadata; neither operation copies a live workspace's data.

## Source map

- [Schema](../server/schema.ts), [permission evaluation](../server/permissions.ts), [page actions, tree guards, duplication and publication](../server/pages.ts).
- [Sharing impact](../server/sharing.ts), [reviews/ownership](../server/review.ts), [comments](../server/comments.ts), [workspace administration](../server/app.ts).
