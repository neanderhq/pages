import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Workspace } from "./api";
import type { AccessSummary, Grant, PageRole, PagesApi, SharingTarget } from "./pagesApi";
import { availablePrincipals, emptyGrantMessage, sharingPrincipals } from "./sharingModel";
import { PermissionDetails } from "./PermissionDetails";
import { useNotionThemeClass } from "@/neander-design-pack/notion/0.1.0/ui/theme";

const roles: PageRole[] = ["editor", "commenter", "viewer"];
function PermissionSelectContent({ children }: { children: ReactNode }) {
  const theme = useNotionThemeClass();
  return <SelectContent className={`notion-pack ${theme} pw-permission-select`} data-ui-pack="notion">{children}</SelectContent>;
}
export function PermissionsPanel({ api, target, members, groups, onClose, onSaved }: { api: PagesApi; target: SharingTarget; members: Workspace["members"]; groups: Workspace["groups"]; onClose: () => void; onSaved: () => Promise<void> }) {
  const theme = useNotionThemeClass();
  const returnFocus = useRef(typeof document === "undefined" ? null : document.activeElement);
  const [summary, setSummary] = useState<AccessSummary | null>(null), [error, setError] = useState("");
  const [inherits, setInherits] = useState(true), [grants, setGrants] = useState<Grant[]>([]), [principal, setPrincipal] = useState("");
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [needsConfirmation, setNeedsConfirmation] = useState(false);
  const principals = sharingPrincipals(members, groups);
  const label = (grant: Grant) => principals.find(entry => entry.type === grant.principalType && entry.id === grant.principalId)?.name ?? grant.name ?? "Unavailable principal";
  useEffect(() => {
    let active = true;
    api.access(target).then(value => { if (active) { setSummary(value); setInherits(value.inherits); setGrants(value.grants); } }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Could not load permissions."); });
    return () => { active = false; };
  }, [api, target]);
  function changed() { setConfirmed(false); setNeedsConfirmation(false); setError(""); }
  async function save() {
    setBusy(true); setError("");
    try { await api.saveAccess(target, { inherits, grants: inherits && target.kind === "page" ? [] : grants, confirmSelfLockout: confirmed }); }
    catch (failure) {
      const text = failure instanceof Error ? failure.message : "Permissions could not be saved.";
      setError(text); setNeedsConfirmation(text.includes("Confirm self-lockout")); setBusy(false); return;
    }
    try { await onSaved(); onClose(); }
    catch { setError("Permissions were saved, but the workspace could not refresh. Close this panel and reload before continuing."); }
    finally { setBusy(false); }
  }
  const explicit = target.kind === "space" || !inherits;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className={`notion-pack ${theme} pw-permissions`} data-ui-pack="notion" showCloseButton={!busy} onCloseAutoFocus={event => { if (returnFocus.current instanceof HTMLElement && returnFocus.current.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }}>
    <DialogHeader><DialogTitle>Share / Permissions</DialogTitle><DialogDescription>{target.name} · Private workspace access, not public publishing.</DialogDescription></DialogHeader>
    <div className="pw-permissions-body">
    {!summary && !error && <p role="status">Loading permissions…</p>}
    {summary && <>
      <PermissionDetails summary={summary} kind={target.kind} inherits={inherits} label={label}/>
      {target.kind === "page" && <>
        <div className="wiki-form-field"><Label htmlFor="permission-mode">Access settings</Label><Select value={inherits ? "inherit" : "explicit"} disabled={!summary.canManage || busy} onValueChange={value => { setInherits(value === "inherit"); changed(); }}><SelectTrigger id="permission-mode"><SelectValue/></SelectTrigger><PermissionSelectContent><SelectItem value="inherit">Use inheritance</SelectItem><SelectItem value="explicit">Explicit override</SelectItem></PermissionSelectContent></Select></div>
      </>}
      {explicit && summary.canManage && <section className="wiki-form" aria-label="Explicit permissions">
        <Label htmlFor="permission-principal">Add user or group</Label><div className="pw-permission-add"><Select value={principal} disabled={busy} onValueChange={setPrincipal}><SelectTrigger id="permission-principal"><SelectValue placeholder="Select a user or group"/></SelectTrigger><PermissionSelectContent>{availablePrincipals(principals, grants).map(entry => <SelectItem key={entry.key} value={entry.key}>{entry.name}</SelectItem>)}</PermissionSelectContent></Select><Button variant="outline" disabled={!principal || busy} onClick={() => { const entry = principals.find(value => value.key === principal); if (entry && !grants.some(grant => grant.principalType === entry.type && grant.principalId === entry.id)) { setGrants([...grants, { principalType: entry.type, principalId: entry.id, role: "viewer" }]); setPrincipal(""); changed(); } }}>Add</Button></div>
        <ul className="pw-permission-list">{grants.map((grant, index) => <li key={`${grant.principalType}:${grant.principalId}`}><span>{label(grant)}</span><Select value={grant.role} disabled={busy} onValueChange={role => { setGrants(grants.map((entry, position) => position === index ? { ...entry, role: role as PageRole } : entry)); changed(); }}><SelectTrigger aria-label={`Role for ${label(grant)}`}><SelectValue/></SelectTrigger><PermissionSelectContent>{roles.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}</PermissionSelectContent></Select><Button variant="ghost" disabled={busy} aria-label={`Remove ${label(grant)}`} onClick={() => { setGrants(grants.filter((_, position) => position !== index)); changed(); }}>Remove</Button></li>)}</ul>
        {!grants.length && <p role="status">{emptyGrantMessage(target.kind)}</p>}
      </section>}
      {!summary.canManage && <p>Individual permission entries are visible only to permission managers.</p>}
      <p>Workspace Viewers never gain editing or commenting rights from a grant. Sharing changes do not revoke public snapshots: existing snapshot links remain public until revoked using the separate publishing controls.</p>
    </>}
    {error && <div className="wiki-notice" role="alert">{error}</div>}
    {needsConfirmation && <label className="pw-permission-confirm"><Checkbox checked={confirmed} disabled={busy} onCheckedChange={value => setConfirmed(value === true)}/>I understand I may lose access and may be unable to undo this change myself. Active workspace administrators retain edit access.</label>}
    </div>
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{summary?.canManage ? "Cancel" : "Close"}</Button>{summary?.canManage && <Button disabled={busy || (needsConfirmation && !confirmed)} onClick={() => void save()}>{busy ? "Saving…" : "Save permissions"}</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
