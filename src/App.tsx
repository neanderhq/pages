import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BookOpen, ArrowRight, ArrowLeft, Users, UsersRound, PanelsTopLeft, Settings, ShieldCheck, Plus, LogOut, UserRoundMinus, Mail, ChevronRight, LoaderCircle, LockKeyhole, Check, Building2, Copy, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Button as NavigationButton } from "@/neander-design-pack/notion/0.1.0/ui/button";
import { NotionThemeProvider } from "@/neander-design-pack/notion/0.1.0/ui/theme";
import { api, ApiError, type Identity, type Member, type Workspace, type WorkspaceRole } from "./api";
import { PagesWorkspace } from "./PagesWorkspace";
import { PermissionsPanel } from "./PermissionsPanel";
import { pagesApi, type SharingTarget } from "./pagesApi";
import { AuditLog } from "./AuditLog";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
const initials = (name: string) => name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
const roleLabel = (role: WorkspaceRole) => role === "admin" ? "Admin" : role === "editor" ? "Editor" : "Viewer";
async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return; } catch {}
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Your browser could not copy the invite link.");
}
function Notice({ children, success = false }: { children: ReactNode; success?: boolean }) {
  return <div className={`wiki-notice ${success ? "wiki-notice-success" : ""}`} role={success ? "status" : "alert"}>{children}</div>;
}
function BusyLabel({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <>{busy && <LoaderCircle className="wiki-spinner" size={16} aria-hidden="true" />}{children}</>;
}
function Brand() {
  return <span className="wiki-brand"><span className="wiki-brand-mark"><BookOpen size={19} strokeWidth={1.8} /></span>Pages</span>;
}
function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="wiki-auth"><aside className="wiki-auth-story"><Brand /><div className="wiki-story-copy"><span className="wiki-eyebrow">A LITTLE MORE TOGETHER</span><h1>Great work starts<br />with a shared space.</h1><p>Bring your people together.<br />Build a home for the way your team works.</p><div className="wiki-story-drawing" aria-hidden="true"><div className="wiki-paper"><BookOpen size={28}/><span/><span/><span/><div className="wiki-paper-people"><i/><i/><i/></div></div><span className="wiki-drawing-label"><ShieldCheck size={15}/>Your team. Your workspace.</span></div></div><span className="wiki-story-footer"><LockKeyhole size={14}/>Private by design. Made for your team.</span></aside><main className="wiki-auth-main"><div className="wiki-mobile-brand"><Brand /></div><div className="wiki-auth-form">{children}</div><p className="wiki-auth-footnote">A shared foundation for your company’s knowledge.</p></main></div>;
}
function FormField({ label, id, children, hint }: { label: string; id: string; children: ReactNode; hint?: string }) {
  return <div className="wiki-form-field"><Label htmlFor={id}>{label}</Label>{children}{hint && <small>{hint}</small>}</div>;
}

function AuthForm({ signup, invitation, onSuccess, navigate }: { signup: boolean; invitation?: { email: string; companyName: string; token: string }; onSuccess: (joined: boolean) => Promise<void>; navigate: (path: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (signup) await api("/api/register", "POST", { ...values, email: invitation?.email ?? values.email, ...(invitation ? { inviteToken: invitation.token } : {}) });
      else await api("/api/auth/sign-in/email", "POST", { email: invitation?.email ?? values.email, password: values.password });
      await onSuccess(Boolean(signup && invitation));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <><span className="wiki-auth-icon">{invitation ? <Mail size={24}/> : <BookOpen size={24}/>}</span><h1>{invitation ? `Join ${invitation.companyName}` : signup ? "A home for your team." : "Welcome back."}</h1><p className="wiki-auth-description">{invitation ? signup ? "Create your account to accept your invitation." : "Sign in to accept your invitation." : signup ? "Create your company’s private workspace." : "Sign in to your team’s workspace."}</p>
    <form onSubmit={submit} className="wiki-form" key={`${signup}-${invitation?.email ?? ""}`}>
      {signup && <FormField id="name" label="Your name"><Input id="name" name="name" autoComplete="name" placeholder="Your full name" minLength={2} maxLength={80} required disabled={busy}/></FormField>}
      {signup && !invitation && <FormField id="companyName" label="Company name"><Input id="companyName" name="companyName" autoComplete="organization" placeholder="Your company" minLength={2} maxLength={80} required disabled={busy}/></FormField>}
      <FormField id="email" label="Work email"><Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" maxLength={254} required readOnly={!!invitation} defaultValue={invitation?.email} disabled={busy}/></FormField>
      <FormField id="password" label="Password" hint={signup ? "Use at least 12 characters." : undefined}><Input id="password" name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 12 : 1} maxLength={128} required disabled={busy}/></FormField>
      {!signup && <button type="button" className="wiki-text-link wiki-forgot" onClick={() => navigate("/forgot-password")}>Forgot password?</button>}
      {error && <Notice>{error}</Notice>}
      <Button type="submit" className="wiki-full" disabled={busy}><BusyLabel busy={busy}>{signup ? invitation ? "Create account & join" : "Create workspace" : "Sign in"}</BusyLabel>{!busy && <ArrowRight size={16}/>}</Button>
    </form>
    {signup && !invitation && <p className="wiki-small-note"><ShieldCheck size={15}/>You’ll be your workspace’s first administrator.</p>}
  </>;
}

function Recovery({ reset, navigate }: { reset: boolean; navigate: (path: string) => void }) {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      if (reset && values.get("password") !== values.get("confirmation")) throw new Error("The passwords do not match.");
      await api(reset ? "/api/auth/reset-password" : "/api/auth/request-password-reset", "POST", reset ? { token, newPassword: values.get("password") } : { email: values.get("email") });
      setDone(true);
      if (reset) window.history.replaceState({}, "", "/reset-password");
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <AuthLayout><span className="wiki-auth-icon">{done ? <Check size={24}/> : <LockKeyhole size={24}/>}</span><h1>{done ? reset ? "Password updated." : "Check your email." : reset ? "Choose a new password." : "Let’s get you back in."}</h1><p className="wiki-auth-description">{done ? reset ? "You can now sign in with your new password. Your old sessions have been signed out." : "If an account exists, a reset link is ready. In development, find it in the server console." : reset ? "Make it unique, and at least 12 characters long." : "We’ll send you a link to reset your password."}</p>
    {!done && <form className="wiki-form" onSubmit={submit}>{reset ? <><FormField id="new-password" label="New password"><Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy}/></FormField><FormField id="confirmation" label="Confirm password"><Input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy}/></FormField></> : <FormField id="email" label="Work email"><Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required disabled={busy}/></FormField>}
      {reset && !token && <Notice>This reset link is missing a token. Request a new reset link.</Notice>}{error && <Notice>{error}</Notice>}<Button type="submit" disabled={busy || (reset && !token)}><BusyLabel busy={busy}>{reset ? "Save new password" : "Send reset link"}</BusyLabel></Button></form>}
    <button className="wiki-text-link wiki-back" onClick={() => navigate(reset && !done ? "/forgot-password" : "/login")}><ArrowLeft size={14}/>{reset && !done ? "Request a new link" : "Back to sign in"}</button>
  </AuthLayout>;
}

function InvitationScreen({ identity, refresh, navigate, logout }: { identity: Identity | null; refresh: () => Promise<boolean>; navigate: (path: string) => void; logout: () => Promise<void> }) {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
  const [invite, setInvite] = useState<{ email: string; companyName: string } | null>(null), [error, setError] = useState(""), [signup, setSignup] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; api<{ email: string; companyName: string }>("/api/invitations/preview", "POST", { token }).then(value => { if (active) setInvite(value); }).catch(failure => { if (active) setError(errorMessage(failure)); }); return () => { active = false; }; }, [token]);
  async function accept() { setBusy(true); setError(""); try { const joined = await api<{ companyId: string }>("/api/invitations/accept", "POST", { token }); await refresh(); navigate(`/?company=${encodeURIComponent(joined.companyId)}`); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }
  return <AuthLayout>{!invite ? <><h1>{error ? "Invitation unavailable." : "Opening your invitation…"}</h1>{error ? <><Notice>{error}</Notice><p className="wiki-auth-description">Ask your workspace administrator for a new invitation.</p><Button variant="outline" onClick={() => navigate(identity ? "/" : "/login")}>Back to {identity ? "workspace" : "sign in"}</Button></> : <LoaderCircle className="wiki-spinner"/>}</> : identity ? <><span className="wiki-auth-icon"><Building2 size={24}/></span><h1>Join {invite.companyName}</h1><p className="wiki-auth-description">This invitation is for <strong>{invite.email}</strong>.</p>{identity.user.email !== invite.email ? <><Notice>You’re signed in as {identity.user.email}. Sign out, then sign in with the invited email address.</Notice><Button className="wiki-full" onClick={() => void logout()} disabled={busy}>Sign out</Button></> : <>{error && <Notice>{error}</Notice>}<p className="wiki-small-note">You’ll join as a member. Your other workspaces won’t change.</p><Button className="wiki-full" disabled={busy} onClick={() => void accept()}><BusyLabel busy={busy}>Accept invitation</BusyLabel></Button></>}</> : <><AuthForm signup={signup} invitation={{ ...invite, token }} navigate={navigate} onSuccess={async joined => { await refresh(); if (joined) navigate("/"); }}/><p className="wiki-auth-switch">{signup ? "Already have an account?" : "New to Pages?"} <button className="wiki-text-link" onClick={() => setSignup(!signup)}>{signup ? "Sign in" : "Create an account"}</button></p></>}</AuthLayout>;
}

type Section = "members" | "groups" | "spaces" | "audit";
function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="wiki-empty"><span className="wiki-empty-icon">{icon}</span><h2>{title}</h2><p>{children}</p>{action}</div>;
}
function SettingsScreen({ identity, logout, refresh, openPages }: { identity: Identity; logout: () => Promise<void>; refresh: () => Promise<boolean>; openPages: (companyId: string) => void }) {
  const [companyId, setCompanyId] = useState(() => { const requested = new URLSearchParams(window.location.search).get("company"); return identity.companies.find(company => company.companyId === requested)?.companyId ?? identity.companies[0]?.companyId ?? ""; }), [section, setSection] = useState<Section>("members");
  const [workspace, setWorkspace] = useState<Workspace | null>(null), [error, setError] = useState(""), [success, setSuccess] = useState(""), [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"invite" | "group" | "space" | null>(null), [dialogError, setDialogError] = useState(""), [deactivate, setDeactivate] = useState<Member | null>(null), [groupId, setGroupId] = useState<string | null>(null), [inviteRole, setInviteRole] = useState<WorkspaceRole>("editor");
  const base = `/api/companies/${companyId}`;
  const sharingApi = useMemo(() => pagesApi(companyId), [companyId]);
  const [sharing, setSharing] = useState<SharingTarget | null>(null);
  useEffect(() => { setSharing(null); }, [companyId]);
  async function load() { const value = await api<Workspace>(base); setWorkspace(value); }
  useEffect(() => { if (!identity.companies.some(company => company.companyId === companyId)) setCompanyId(identity.companies[0]?.companyId ?? ""); }, [identity, companyId]);
  useEffect(() => { let active = true; setWorkspace(null); setError(""); setSuccess(""); api<Workspace>(base).then(value => { if (active) setWorkspace(value); }).catch(failure => { if (active) setError(errorMessage(failure)); }); return () => { active = false; }; }, [base]);
  const admin = workspace?.membership.role === "admin";
  const shownSection: Section = !admin && section === "audit" ? "members" : section;
  const activeMembers = workspace?.members.filter(member => member.status === "active") ?? [];
  const adminCount = activeMembers.filter(member => member.role === "admin").length;
  const selectedGroup = workspace?.groups.find(group => group.id === groupId);
  const pending = workspace?.invitations.filter(invite => !invite.usedAt && new Date(invite.expiresAt) > new Date()) ?? [];
  const companyName = identity.companies.find(company => company.companyId === companyId)?.name ?? "Workspace";
  const config = { members: { label: "Members", icon: Users, description: "The people who make your workspace." }, groups: { label: "Groups", icon: UsersRound, description: "Bring the right people together." }, spaces: { label: "Team spaces", icon: PanelsTopLeft, description: "A little structure. A place for every team." }, audit: { label: "Audit log", icon: ScrollText, description: "A record of important workspace changes." } };
  const Icon = config[shownSection].icon;
  function openDialog(value: typeof dialog) { setDialogError(""); if (value === "invite") setInviteRole("editor"); setDialog(value); }
  async function mutate(path: string, method: string, body?: unknown) {
    setBusy(true); setError(""); setSuccess("");
    try { await api(base + path, method, body ?? {}); if (await refresh()) await load(); }
    catch (failure) { if (failure instanceof ApiError && failure.status === 401) await refresh(); throw failure; }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setDialogError(""); const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await mutate(dialog === "invite" ? "/invitations" : dialog === "group" ? "/groups" : "/spaces", "POST", dialog === "invite" ? { ...values, role: inviteRole } : values); setSuccess(dialog === "invite" ? "Invitation sent. Copy its link from Pending invitations." : dialog === "group" ? "Group created. You can now add members." : "Team space created."); setDialog(null); }
    catch (failure) { setDialogError(errorMessage(failure)); }
  }
  async function copyInviteLink(invite: Workspace["invitations"][number]) {
    setError(""); setSuccess("");
    try {
      const result = await api<{ url: string }>(`${base}/invitations/${invite.id}/link`, "POST", {});
      await copyText(result.url);
      setSuccess(`Invite link for ${invite.email} copied.`);
    } catch (failure) { setError(errorMessage(failure)); }
  }
  async function roleChange(member: Member, role: WorkspaceRole) { try { await mutate(`/members/${member.userId}`, "PATCH", { role }); setSuccess(`${member.name}’s role was updated.`); } catch (failure) { setError(errorMessage(failure)); } }
  async function deactivateMember() { if (!deactivate) return; try { await mutate(`/members/${deactivate.userId}`, "PATCH", { status: "deactivated" }); setDeactivate(null); setSuccess("Member deactivated. Past work is preserved."); } catch (failure) { setDialogError(errorMessage(failure)); } }
  async function toggleGroup(userId: string, checked: boolean) { try { await mutate(`/groups/${groupId}/members/${userId}`, checked ? "POST" : "DELETE"); } catch (failure) { setDialogError(errorMessage(failure)); } }
  return <NotionThemeProvider theme="light"><div className="notion-pack notion-light wiki-root" data-ui-pack="notion"><a href="#workspace-content" className="wiki-skip-link">Skip to settings</a><aside className="wiki-sidebar notion-sidebar"><div className="wiki-workspace-heading"><span className="wiki-workspace-avatar">{initials(companyName)}</span><div><strong>{companyName}</strong><small>Team workspace</small></div></div>
    {identity.companies.length > 1 && <Select value={companyId} onValueChange={setCompanyId} disabled={busy}><SelectTrigger aria-label="Switch workspace" className="wiki-full"><SelectValue/></SelectTrigger><SelectContent>{identity.companies.map(company => <SelectItem value={company.companyId} key={company.companyId}>{company.name}</SelectItem>)}</SelectContent></Select>}
    <NavigationButton variant="ghost" className="wiki-nav-item wiki-pages-link" onClick={() => openPages(companyId)}><ArrowLeft size={17}/>Back to pages</NavigationButton>
    <div className="wiki-sidebar-section"><Settings size={14}/><span>WORKSPACE SETTINGS</span></div><nav aria-label="Workspace settings">{(Object.keys(config) as Section[]).filter(key => key !== "audit" || admin).map(key => { const ItemIcon = config[key].icon; return <NavigationButton key={key} variant="ghost" className={`wiki-nav-item ${shownSection === key ? "wiki-nav-selected" : ""}`} aria-current={shownSection === key ? "page" : undefined} onClick={() => { setSection(key); setError(""); setSuccess(""); }}><ItemIcon size={17}/>{config[key].label}{key === "members" && workspace && <span className="wiki-nav-count">{activeMembers.length}</span>}</NavigationButton>; })}</nav>
    <div className="wiki-sidebar-note"><BookOpen size={19}/><strong>Good things start here.</strong><p>Your people and team spaces, together in one workspace.</p></div><div className="wiki-sidebar-user"><span className="wiki-avatar">{initials(identity.user.name)}</span><div><strong>{identity.user.name}</strong><small>{identity.user.email}</small></div><Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" disabled={busy} onClick={() => void logout().catch(failure => setError(errorMessage(failure)))}><LogOut size={16}/></Button></div></aside>
    <div className="wiki-main"><header className="wiki-topbar"><div><Settings size={15}/><span>Workspace</span><ChevronRight size={13}/><strong>Settings</strong></div><span className="wiki-private"><ShieldCheck size={14}/>Private workspace</span></header><main id="workspace-content" className="wiki-settings-canvas" tabIndex={-1}><div className="wiki-section-heading"><div><span className="wiki-page-icon"><Icon size={27} strokeWidth={1.6}/></span><h1>{config[shownSection].label}</h1><p>{config[shownSection].description}</p></div>{workspace && admin && shownSection !== "audit" && <Button onClick={() => openDialog(shownSection === "members" ? "invite" : shownSection === "groups" ? "group" : "space")} disabled={busy}><Plus size={16}/>{shownSection === "members" ? "Invite member" : shownSection === "groups" ? "New group" : "New space"}</Button>}</div>
      {error && <div className="wiki-message-wrap"><Notice>{error}</Notice>{!workspace && <Button variant="outline" onClick={() => { setError(""); void load().catch(failure => setError(errorMessage(failure))); }}>Try again</Button>}</div>}{success && <Notice success>{success}</Notice>}
      {!workspace && !error && <div className="wiki-loading" role="status"><LoaderCircle size={22} className="wiki-spinner"/>Loading workspace settings…</div>}
      {workspace && <>{!admin && <div className="wiki-readonly"><ShieldCheck size={17}/><p>You’re viewing your workspace. Only administrators can make changes.</p></div>}
      {shownSection === "audit" && admin && <AuditLog key={companyId} companyId={companyId}/>}
      {shownSection === "members" && <><div className="wiki-section-line"><h2>Workspace members <span>{activeMembers.length}</span></h2><span>Only invited people can join</span></div><div className="wiki-member-list"><div className="wiki-member-table-head"><span>NAME</span><span>ROLE</span><span>STATUS</span><span/></div>{workspace.members.map(member => { const lastAdmin = member.role === "admin" && member.status === "active" && adminCount === 1; return <div className={`wiki-member-row ${member.status === "deactivated" ? "wiki-member-inactive" : ""}`} key={member.userId}><div className="wiki-person"><span className="wiki-avatar">{initials(member.name)}</span><div><strong>{member.name}{member.userId === identity.user.id && <small className="wiki-you">You</small>}</strong><small>{member.email}</small></div></div><div>{admin && member.status === "active" ? <Select value={member.role} onValueChange={value => void roleChange(member, value as WorkspaceRole)} disabled={busy}><SelectTrigger aria-label={`Role for ${member.name}`} size="sm" className="wiki-role-select"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="editor" disabled={lastAdmin}>Editor</SelectItem><SelectItem value="viewer" disabled={lastAdmin}>Viewer</SelectItem></SelectContent></Select> : <span className="wiki-role-label">{roleLabel(member.role)}</span>}</div><span className="wiki-member-status"><i/>{member.status === "active" ? "Active" : "Deactivated"}</span><div>{admin && member.status === "active" && <Button variant="ghost" size="icon" aria-label={`Deactivate ${member.name}`} title={lastAdmin ? "Keep at least one active administrator" : `Deactivate ${member.name}`} disabled={busy || lastAdmin} onClick={() => { setDialogError(""); setDeactivate(member); }}><UserRoundMinus size={16}/></Button>}</div></div>; })}</div>
        <div className="wiki-explainer"><ShieldCheck size={18}/><p><strong>A safe space for your team.</strong> Admins manage people, groups and spaces. Deactivated members lose access, but their past work stays.</p></div>
        {pending.length > 0 && <section className="wiki-invitations"><div className="wiki-section-line"><h2>Pending invitations <span>{pending.length}</span></h2></div>{pending.map(invite => <div className="wiki-invitation-row" key={invite.id}><Mail size={17}/><span>{invite.email}</span><small>{roleLabel(invite.role)} · Expires {new Date(invite.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small><Badge variant="secondary">Invited</Badge>{admin && <Button type="button" variant="outline" size="sm" aria-label={`Copy invite link for ${invite.email}`} onClick={() => void copyInviteLink(invite)}><Copy size={14}/>Copy invite link</Button>}</div>)}</section>}</>}
      {section === "groups" && (workspace.groups.length ? <div className="wiki-resource-grid">{workspace.groups.map(group => { const count = workspace.groupMembers.filter(entry => entry.groupId === group.id).length; return <article className="wiki-resource-card" key={group.id}><span className="wiki-resource-icon"><UsersRound size={23}/></span><h2>{group.name}</h2><p>{count} {count === 1 ? "member" : "members"}</p><Button variant="outline" onClick={() => { setDialogError(""); setGroupId(group.id); }}>{admin ? "Manage members" : "View members"}<ArrowRight size={14}/></Button></article>; })}</div> : <EmptyState icon={<UsersRound size={32}/>} title="A place for your people to connect." action={admin ? <Button variant="outline" onClick={() => openDialog("group")}><Plus size={16}/>Create your first group</Button> : undefined}>Organise people by department or team. {admin ? "Create a group, then add active workspace members." : "Your administrator hasn’t created any groups yet."}</EmptyState>)}
      {section === "spaces" && <>{workspace.spaces.length ? <div className="wiki-resource-grid">{workspace.spaces.map(space => <article className="wiki-resource-card wiki-space-card" key={space.id}><span className="wiki-resource-icon"><PanelsTopLeft size={23}/></span><h2>{space.name}</h2><p>Created by {workspace.members.find(member => member.userId === space.createdBy)?.name ?? "a workspace member"}</p><Button variant="outline" onClick={() => setSharing({ kind: "space", id: space.id, name: space.name })}>Permissions</Button></article>)}</div> : <EmptyState icon={<PanelsTopLeft size={32}/>} title="Make room for your teams." action={admin ? <Button variant="outline" onClick={() => openDialog("space")}><Plus size={16}/>Create your first space</Button> : undefined}>Give each team a space of its own. {admin ? "Start with a department or shared area." : "Your administrator hasn’t created any spaces yet."}</EmptyState>}<div className="wiki-explainer"><BookOpen size={18}/><p>Spaces start with workspace access. Permissions can restrict inherited page access to selected users and groups; explicit page overrides can grant access separately. Space names remain visible to workspace members.</p></div></>}
      </>}
      <footer className="wiki-canvas-footer"><BookOpen size={14}/><span>{companyName} · Pages</span></footer>
    </main></div>
    {sharing && <PermissionsPanel key={`${companyId}:${sharing.id}`} api={sharingApi} target={sharing} members={workspace?.members ?? []} groups={workspace?.groups ?? []} onClose={() => setSharing(null)} onSaved={load}/>}
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !busy) setDialog(null); }}><DialogContent><DialogHeader><DialogTitle>{dialog === "invite" ? "Invite a teammate" : dialog === "group" ? "Create a group" : "Create a team space"}</DialogTitle><DialogDescription>{dialog === "invite" ? "Choose their workspace role. Invitations expire after 48 hours and only work for the exact email address below." : dialog === "group" ? "Give this group a clear name. You can add active members after creating it." : "New spaces start with workspace access. Use Permissions after creation to restrict inherited pages to selected users and groups. Space names remain visible to workspace members."}</DialogDescription></DialogHeader><form onSubmit={save} className="wiki-form"><FormField label={dialog === "invite" ? "Work email" : "Name"} id="resource-name"><Input id="resource-name" name={dialog === "invite" ? "email" : "name"} type={dialog === "invite" ? "email" : "text"} placeholder={dialog === "invite" ? "teammate@company.com" : dialog === "group" ? "e.g. Operations" : "e.g. People & culture"} required minLength={dialog === "invite" ? 3 : 2} maxLength={dialog === "invite" ? 254 : 80} disabled={busy}/></FormField>{dialog === "invite" && <FormField label="Workspace role" id="invite-role"><Select value={inviteRole} onValueChange={value => setInviteRole(value as WorkspaceRole)} disabled={busy}><SelectTrigger id="invite-role" aria-label="Invite role"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="editor">Editor</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent></Select></FormField>}{dialogError && <Notice>{dialogError}</Notice>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" disabled={busy}><BusyLabel busy={busy}>{dialog === "invite" ? "Send invitation" : dialog === "group" ? "Create group" : "Create space"}</BusyLabel></Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={deactivate !== null} onOpenChange={open => { if (!open && !busy) setDeactivate(null); }}><DialogContent><DialogHeader><DialogTitle>Deactivate {deactivate?.name}?</DialogTitle><DialogDescription>They will be signed out everywhere and lose access to this workspace. Their identity and past work are preserved. This foundation does not include reactivation.</DialogDescription></DialogHeader>{dialogError && <Notice>{dialogError}</Notice>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeactivate(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => void deactivateMember()}><BusyLabel busy={busy}>Deactivate member</BusyLabel></Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={groupId !== null} onOpenChange={open => { if (!open && !busy) setGroupId(null); }}><DialogContent><DialogHeader><DialogTitle>{selectedGroup?.name}</DialogTitle><DialogDescription>{admin ? "Changes are saved as you select or remove members." : "People in this group."}</DialogDescription></DialogHeader>{dialogError && <Notice>{dialogError}</Notice>}<div className="wiki-group-people">{activeMembers.map(member => <label className="wiki-group-person" key={member.userId}><Checkbox checked={workspace?.groupMembers.some(entry => entry.groupId === groupId && entry.userId === member.userId) ?? false} disabled={!admin || busy} onCheckedChange={checked => void toggleGroup(member.userId, checked === true)} aria-label={`${member.name} in ${selectedGroup?.name}`}/><span className="wiki-avatar">{initials(member.name)}</span><span><strong>{member.name}</strong><small>{member.email}</small></span></label>)}</div><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setGroupId(null)}>Done</Button></DialogFooter></DialogContent></Dialog>
  </div></NotionThemeProvider>;
}

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [path, setPath] = useState(window.location.pathname);
  function navigate(destination: string) { window.history.pushState({}, "", destination); setPath(destination); }
  async function refresh() {
    try { const value = await api<Identity>("/api/me"); setIdentity(value); return true; }
    catch (failure) { if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) { setIdentity(null); return false; } throw failure; }
  }
  async function logout() { await api("/api/auth/sign-out", "POST", {}); setIdentity(null); if (path !== "/invite") navigate("/login"); }
  useEffect(() => { void refresh().catch(failure => setError(errorMessage(failure))).finally(() => setLoading(false)); const pop = () => setPath(window.location.pathname); window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, []);
  if (loading) return <div className="wiki-boot" role="status"><Brand/><LoaderCircle className="wiki-spinner" size={24}/><p>Opening your workspace…</p></div>;
  if (error) return <AuthLayout><h1>We couldn’t open your workspace.</h1><Notice>{error}</Notice><Button className="wiki-full" onClick={() => window.location.reload()}>Try again</Button></AuthLayout>;
  if (path === "/invite") return <InvitationScreen identity={identity} refresh={refresh} navigate={navigate} logout={logout}/>;
  if (path === "/reset-password" || path === "/forgot-password") return <Recovery reset={path === "/reset-password"} navigate={navigate} key={path}/>;
  if (identity) return path.startsWith("/settings") ? <SettingsScreen identity={identity} logout={logout} refresh={refresh} openPages={company => navigate(`/?company=${encodeURIComponent(company)}`)}/> : <PagesWorkspace identity={identity} path={path} navigate={navigate} logout={logout}/>;
  const signup = path === "/signup";
  return <AuthLayout><AuthForm signup={signup} navigate={navigate} onSuccess={async () => { await refresh(); navigate("/"); }}/><p className="wiki-auth-switch">{signup ? "Already have an account?" : "New to Pages?"} <button className="wiki-text-link" onClick={() => navigate(signup ? "/login" : "/signup")}>{signup ? "Sign in" : "Create a workspace"}</button></p></AuthLayout>;
}
