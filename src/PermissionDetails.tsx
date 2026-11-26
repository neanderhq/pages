import type { AccessSummary, Grant } from "./pagesApi";

export function PermissionDetails({ summary, kind, inherits, label }: { summary: AccessSummary; kind: "page" | "space"; inherits: boolean; label: (grant: Grant) => string }) {
  return <>
    <p>Your effective access: <strong>{summary.workspaceRole === "admin" ? "admin" : summary.role ?? "none"}</strong>. {summary.canManage ? "You can manage these settings." : "Read-only summary. An authorized editor or administrator must change these settings."}</p>
    <p>Active workspace administrators always retain edit access. Page and space grants cannot remove administrator access.</p>
    {summary.workspaceRole === "admin" && <p>Your workspace role is admin; your page capability is {summary.role}. Administrator access is not a removable grant.</p>}
    {kind === "page" && <section aria-label="Inherited access"><strong>Inheritance source: {summary.inherited?.source}</strong><p>{summary.inherited?.workspaceAccess ? "Workspace access: all active members, with workspace Viewers limited to viewing." : "Inherited grants replace earlier defaults; the highest matching user or group role wins."}</p>
      {summary.canManage && summary.inherited?.entriesVisible ? <ul className="pw-permission-summary">{summary.inherited.grants.map(grant => <li key={`${grant.principalType}:${grant.principalId}`}>{label(grant)} — {grant.role}</li>)}</ul> : <p>Inherited entries are not disclosed here.</p>}
      {!inherits && <p>This page overrides the inherited entries; they do not add access here.</p>}
    </section>}
    {kind === "space" && <>
      <p>{summary.workspaceAccess ? "Currently uses workspace access." : "Currently restricted by explicit grants."} No space grants means all active workspace members can access inherited pages. A page’s explicit override can also admit people excluded from this space. Space names remain visible as workspace metadata.</p>
      <p>Only workspace administrators can initially restrict an open space. After that, its effective editors can manage space permissions too.</p>
    </>}
  </>;
}
