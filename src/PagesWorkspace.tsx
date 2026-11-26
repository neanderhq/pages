import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Archive, Bell, BookOpen, Check, Clock, ClipboardCheck, FileText, FolderUp, Home, LoaderCircle, LogOut, Menu, Plus, RotateCcw, Search, Settings, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button as NavigationButton } from "@/neander-design-pack/notion/0.1.0/ui/button";
import { NotionThemeProvider } from "@/neander-design-pack/notion/0.1.0/ui/theme";
import { api, ApiError, type Identity, type Workspace } from "./api";
import { pagesApi, type ArchivedPage, type PageLink, type TreePage } from "./pagesApi";
import { collabApi, tagsChanged, when, type Notification, type ReviewDuePage, type SearchFilters, type SearchResult } from "./collabApi";
import { TemplateChooser } from "./TemplateChooser";
import { createNotificationFeed, type NotificationFeed } from "./notificationFeed";
import { childrenMap, rootKey, SpaceTree, type SpaceRef, type TreeAction } from "./PageTree";
import { canManageWorkspacePages } from "./pageActions";
import { PageView } from "./PageView";
import { PermissionsPanel } from "./PermissionsPanel";
import type { SharingTarget } from "./pagesApi";
import { moveNeedsReview } from "./sharingModel";
import { Checkbox } from "@/components/ui/checkbox";
import "./pages.css";

const message = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
const initials = (name: string) => name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
type Lists = { pages: TreePage[]; favorites: PageLink[]; recent: PageLink[] };
type Dialogs = { kind: "rename"; page: TreePage } | { kind: "move"; page: TreePage } | { kind: "archive"; page: TreePage } | { kind: "import" } | null;

// Ids of a page and everything below it in the visible tree.
function descendants(children: Map<string, TreePage[]>, id: string) {
  const ids = new Set([id]);
  const queue = [id];
  while (queue.length) for (const kid of children.get(queue.shift()!) ?? []) if (!ids.has(kid.id)) { ids.add(kid.id); queue.push(kid.id); }
  return ids;
}

function LinkList({ title, icon, pages, currentId, onOpen }: { title: string; icon: ReactNode; pages: PageLink[]; currentId: string | null; onOpen: (id: string) => void }) {
  if (!pages.length) return null;
  return <section className="pw-space" aria-label={title}>
    <div className="pw-section-label">{icon}<span>{title}</span></div>
    <ul className="pw-tree">{pages.map(page => <li key={page.id}><div className={`pw-tree-row ${currentId === page.id ? "pw-tree-current" : ""}`}>
      <span className="pw-tree-toggle" aria-hidden="true"><FileText size={13}/></span>
      <button type="button" className="pw-tree-title" aria-current={currentId === page.id ? "page" : undefined} onClick={() => onOpen(page.id)}>{page.title || "Untitled"}</button>
    </div></li>)}</ul>
  </section>;
}

export function PagesWorkspace({ identity, path, navigate, logout }: { identity: Identity; path: string; navigate: (path: string) => void; logout: () => Promise<void> }) {
  const [companyId, setCompanyId] = useState(() => { const requested = new URLSearchParams(window.location.search).get("company"); return identity.companies.find(company => company.companyId === requested)?.companyId ?? identity.companies[0]?.companyId ?? ""; });
  const client = useMemo(() => pagesApi(companyId), [companyId]);
  const collaboration = useMemo(() => collabApi(companyId), [companyId]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null), [lists, setLists] = useState<Lists | null>(null);
  const [loadError, setLoadError] = useState(""), [notice, setNotice] = useState<{ text: string; success?: boolean } | null>(null), [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set()), [navOpen, setNavOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialogs>(null), [dialogError, setDialogError] = useState(""), [moveTarget, setMoveTarget] = useState({ space: "company", parent: "top" });
  const [importSpace, setImportSpace] = useState("company"), [importFiles, setImportFiles] = useState<File[]>([]);
  const [trash, setTrash] = useState<ArchivedPage[] | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const notificationFeed = useMemo(() => createNotificationFeed(collaboration), [collaboration]);
  const notificationState = useSyncExternalStore(notificationFeed.subscribe, notificationFeed.getSnapshot);
  const { unread } = notificationState;
  const [sharing, setSharing] = useState<SharingTarget | null>(null), [pageVersion, setPageVersion] = useState(0);
  const unsavedPage = useRef(false);
  const openPermissions = useCallback((target: SharingTarget) => {
    if (unsavedPage.current) { setNotice({ text: "Save or resolve your page changes before changing permissions." }); return; }
    setNavOpen(false);
    setSharing(target);
  }, []);
  const [movePreview, setMovePreview] = useState<{ changed: boolean; token: string } | null>(null), [moveAcknowledged, setMoveAcknowledged] = useState(false);
  useEffect(() => { setMovePreview(null); setMoveAcknowledged(false); }, [moveTarget]);
  useEffect(() => { setSharing(null); }, [companyId]);
  const menuButton = useRef<HTMLButtonElement>(null), sidebar = useRef<HTMLElement>(null), importInput = useRef<HTMLInputElement>(null), creating = useRef(false);
  const pathname = path.split("?")[0];
  const currentId = pathname.startsWith("/p/") ? decodeURIComponent(pathname.slice(3)) : null;
  const view = currentId ? "page" : pathname === "/trash" ? "trash" : pathname === "/search" ? "search" : pathname === "/inbox" ? "inbox" : pathname === "/review-due" ? "review-due" : "home";
  const query = identity.companies.length > 1 ? `?company=${encodeURIComponent(companyId)}` : "";
  const currentCompany = identity.companies.find(company => company.companyId === companyId);
  const companyName = currentCompany?.name ?? "Workspace";
  const canManagePages = canManageWorkspacePages(currentCompany?.role);
  const children = useMemo(() => childrenMap(lists?.pages ?? []), [lists]);
  const spaces: SpaceRef[] = useMemo(() => [{ id: null, name: companyName }, ...(workspace?.spaces ?? []).map(space => ({ id: space.id, name: space.name }))], [companyName, workspace]);
  useEffect(() => { if (dialog?.kind === "import") importInput.current?.setAttribute("webkitdirectory", ""); }, [dialog]);

  const reload = useCallback(async () => {
    const [tree, favorites, recent] = await Promise.all([client.tree(), client.favorites(), client.recent()]);
    setLists({ pages: tree.pages, favorites: favorites.pages, recent: recent.pages });
  }, [client]);
  const refreshQuietly = useCallback(() => { void reload().catch(() => undefined); }, [reload]);
  useEffect(() => notificationFeed.start({ window, document, every: (callback, milliseconds) => { const timer = window.setInterval(callback, milliseconds); return () => window.clearInterval(timer); } }), [notificationFeed]);
  useEffect(() => {
    let active = true;
    setWorkspace(null); setLists(null); setLoadError("");
    Promise.all([api<Workspace>(`/api/companies/${encodeURIComponent(companyId)}`), reload()])
      .then(([value]) => { if (active) setWorkspace(value); })
      .catch(failure => { if (active) setLoadError(failure instanceof ApiError && failure.status === 401 ? "Your session has ended. Please sign in again." : message(failure)); });
    return () => { active = false; };
  }, [companyId, reload]);
  useEffect(() => {
    if (view !== "trash") return;
    let active = true;
    setTrash(null);
    client.archived().then(value => { if (active) setTrash(value.pages); }).catch(failure => { if (active) { setTrash([]); setNotice({ text: message(failure) }); } });
    return () => { active = false; };
  }, [view, client]);
  // Keep the open page visible in the tree by expanding its parents.
  useEffect(() => {
    if (!currentId || !lists) return;
    const byId = new Map(lists.pages.map(page => [page.id, page]));
    const parents: string[] = [];
    for (let page = byId.get(currentId); page?.parentId && parents.length < 256; page = byId.get(page.parentId)) parents.push(page.parentId);
    if (parents.some(id => !expanded.has(id))) setExpanded(previous => new Set([...previous, ...parents]));
  }, [currentId, lists]);
  // Narrow screens: the sidebar is an off-canvas panel. Escape closes it and focus returns to the menu button.
  useEffect(() => {
    if (!navOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.current?.querySelector<HTMLElement>("button, [href], select, input")?.focus();
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[role=menu]")) { setNavOpen(false); menuButton.current?.focus(); }
      if (event.key !== "Tab" || !sidebar.current) return;
      const focusable = [...sidebar.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], select:not(:disabled), input:not(:disabled)')];
      const first = focusable[0], last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", handleKeydown); };
  }, [navOpen]);

  const go = (target: string) => { setNavOpen(false); setNotice(null); const separator = target.includes("?") ? "&" : "?"; navigate(target + (query ? `${separator}${query.slice(1)}` : "")); };
  const open = (id: string) => go(`/p/${encodeURIComponent(id)}`);
  const openNotificationPage = (id: string, threadId?: string | null) => go(`/p/${encodeURIComponent(id)}${threadId ? `?thread=${encodeURIComponent(threadId)}` : ""}`);
  const toggle = (key: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  async function run<T>(work: () => Promise<T>, success?: string) {
    setBusy(true); setNotice(null);
    try { const result = await work(); if (success) setNotice({ text: success, success: true }); return result; }
    catch (failure) { setNotice({ text: message(failure) }); return undefined; }
    finally { setBusy(false); }
  }
  // The new page shows in the tree right away (under an expanded parent and space) and opens; a background reload then confirms the tree.
  async function createPage(body: { parentId?: string; spaceId?: string | null }) {
    if (creating.current) return;
    creating.current = true;
    try {
      const created = await run(() => client.create(body));
      if (!created) return;
      const parentId = body.parentId ?? null;
      const spaceId = parentId ? lists?.pages.find(page => page.id === parentId)?.spaceId ?? null : body.spaceId ?? null;
      const page: TreePage = { id: created.id, parentId, spaceId, title: "", slug: created.slug, position: Number.MAX_SAFE_INTEGER, inherits: true, updatedAt: new Date().toISOString(), role: "editor" };
      setLists(previous => previous && { ...previous, pages: [...previous.pages.filter(item => item.id !== page.id), page] });
      setExpanded(previous => { const next = new Set(previous); if (parentId) next.add(parentId); next.delete(`collapsed:${rootKey(spaceId)}`); return next; });
      open(created.id);
      refreshQuietly();
    } finally { creating.current = false; }
  }
  function action(kind: TreeAction, page: TreePage) {
    const siblings = children.get(page.parentId ?? rootKey(page.spaceId)) ?? [];
    const index = siblings.findIndex(sibling => sibling.id === page.id);
    setDialogError("");
    if (kind === "open") open(page.id);
    else if (kind === "share") openPermissions({ kind: "page", id: page.id, name: page.title || "Untitled" });
    else if (kind === "subpage") void createPage({ parentId: page.id });
    else if (kind === "rename" || kind === "archive") setDialog({ kind, page });
    else if (kind === "move") {
      if (unsavedPage.current) { setNotice({ text: "Save or resolve your page changes before moving pages." }); return; }
      setMovePreview(null); setMoveAcknowledged(false); setMoveTarget({ space: page.spaceId ?? "company", parent: page.parentId ?? "top" }); setDialog({ kind, page });
    }
    else if (kind === "duplicate") void run(async () => { await client.duplicate(page.id); await reload(); }, `A copy of “${page.title || "Untitled"}” was added next to it.`);
    // Reorder: place the page in front of the visible sibling above it, or after the one below it.
    else if (kind === "up" && index > 0) void run(async () => { await client.move(page.id, { parentId: page.parentId, spaceId: page.spaceId, beforeId: siblings[index - 1].id }); await reload(); });
    else if (kind === "down" && index >= 0 && index < siblings.length - 1) void run(async () => { await client.move(page.id, { parentId: page.parentId, spaceId: page.spaceId, beforeId: siblings[index + 2]?.id }); await reload(); });
  }
  async function submitDialog(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!dialog || dialog.kind === "import") return;
    if (dialog.kind === "move" && unsavedPage.current) { setDialogError("Save or resolve your page changes before moving pages."); return; }
    const page = dialog.page;
    setBusy(true); setDialogError("");
    try {
      if (dialog.kind === "rename") {
        const title = String(new FormData(event!.currentTarget).get("title") ?? "").trim();
        await client.rename(page.id, title);
      } else if (dialog.kind === "move") {
        const target = { parentId: moveTarget.parent === "top" ? null : moveTarget.parent, spaceId: moveTarget.space === "company" ? null : moveTarget.space };
        const impact = await client.moveImpact(page.id, target);
        if (moveNeedsReview(impact, movePreview, moveAcknowledged)) { setMovePreview(impact); setMoveAcknowledged(false); return; }
        await client.move(page.id, { ...target, accessAcknowledgement: impact.token });
        setPageVersion(value => value + 1);
        if (moveTarget.parent !== "top") setExpanded(previous => new Set([...previous, moveTarget.parent]));
      } else {
        const removed = descendants(children, page.id);
        await client.archive(page.id);
        if (currentId && removed.has(currentId)) go("/");
        setNotice({ text: `“${page.title || "Untitled"}” was moved to the archive. You can restore it from Archive.`, success: true });
      }
      await reload();
      setDialog(null);
    } catch (failure) { setDialogError(message(failure)); setMovePreview(null); setMoveAcknowledged(false); }
    finally { setBusy(false); }
  }
  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importFiles.length) { setDialogError("Choose a folder containing .md files."); return; }
    setBusy(true); setDialogError("");
    try {
      const files = await Promise.all(importFiles.map(async file => ({ path: file.webkitRelativePath || file.name, content: await file.text() })));
      const result = await client.importMarkdown(importSpace === "company" ? null : importSpace, files);
      await reload();
      setDialog(null);
      setNotice({ text: `Imported ${result.imported} Markdown files as a page tree.`, success: true });
    } catch (failure) { setDialogError(message(failure)); }
    finally { setBusy(false); }
  }
  async function restore(page: ArchivedPage) {
    const restored = await run(async () => { const value = await client.restore(page.id); await reload(); setTrash(previous => previous?.filter(item => item.id !== page.id) ?? null); return value; }, `“${page.title || "Untitled"}” was restored.`);
    return restored;
  }
  function switchCompany(id: string) { setCompanyId(id); setNavOpen(false); navigate(`/?company=${encodeURIComponent(id)}`); }

  const movePage = dialog?.kind === "move" ? dialog.page : null;
  const blockedParents = movePage ? descendants(children, movePage.id) : new Set<string>();
  const parentOptions = (lists?.pages ?? []).filter(page => (page.spaceId ?? "company") === moveTarget.space && page.role === "editor" && !blockedParents.has(page.id));
  const topbar = (crumbs: ReactNode, actions?: ReactNode) => <header className="pw-topbar">
    <button ref={menuButton} type="button" className="pw-menu-button" aria-label="Open navigation" aria-expanded={navOpen} aria-controls="pw-sidebar" onClick={() => setNavOpen(true)}><Menu size={18}/></button>
    <div className="pw-topbar-crumbs">{crumbs}</div>{actions && <div className="pw-topbar-actions">{actions}</div>}
  </header>;
  const events = useMemo(() => ({
    onOpen: (id: string) => open(id),
    onShare: (id: string, name: string) => openPermissions({ kind: "page", id, name }),
    onUnsaved: (unsaved: boolean) => { unsavedPage.current = unsaved; },
    onTitle: (id: string, title: string) => setLists(previous => previous && { pages: previous.pages.map(page => page.id === id ? { ...page, title } : page), favorites: previous.favorites.map(page => page.id === id ? { ...page, title } : page), recent: previous.recent.map(page => page.id === id ? { ...page, title } : page) }),
    onFavorite: refreshQuietly, onCreated: refreshQuietly, onVisited: refreshQuietly,
  }), [refreshQuietly, query, openPermissions]);

  const nav = (key: string, label: string, icon: ReactNode, target: string, selected: boolean) =>
    <NavigationButton key={key} variant="ghost" className={`pw-nav-item ${selected ? "pw-nav-selected" : ""}`} aria-current={selected ? "page" : undefined} onClick={() => go(target)}>{icon}{label}</NavigationButton>;
  return <NotionThemeProvider theme="light"><div className={`notion-pack notion-light pw-root ${navOpen ? "pw-nav-open" : ""}`} data-ui-pack="notion">
    <a href="#workspace-content" className="wiki-skip-link">Skip to page</a>
    {navOpen && <button type="button" className="pw-scrim" aria-label="Close navigation" tabIndex={-1} onClick={() => { setNavOpen(false); menuButton.current?.focus(); }}/>}
    <aside id="pw-sidebar" ref={sidebar} className="pw-sidebar" aria-label="Workspace navigation" role={navOpen ? "dialog" : undefined} aria-modal={navOpen ? true : undefined}>
      <div className="pw-sidebar-top">
        <div className="wiki-workspace-heading"><span className="wiki-workspace-avatar">{initials(companyName)}</span><div><strong>{companyName}</strong><small>Pages</small></div>
          <button type="button" className="pw-tree-icon pw-close-nav" aria-label="Close navigation" onClick={() => { setNavOpen(false); menuButton.current?.focus(); }}><X size={16}/></button></div>
        {identity.companies.length > 1 && <Select value={companyId} onValueChange={switchCompany}><SelectTrigger aria-label="Switch workspace" className="wiki-full"><SelectValue/></SelectTrigger><SelectContent>{identity.companies.map(company => <SelectItem value={company.companyId} key={company.companyId}>{company.name}</SelectItem>)}</SelectContent></Select>}
        <nav aria-label="Workspace" className="pw-nav">
          {nav("home", "Home", <Home size={16}/>, "/", view === "home")}
          {nav("search", "Search pages", <Search size={16}/>, "/search", view === "search")}
          {nav("inbox", `Notifications${notificationState.error ? " · unavailable" : unread ? ` · ${unread}` : ""}`, <Bell size={16}/>, "/inbox", view === "inbox")}
          {nav("reviews", "Review due", <ClipboardCheck size={16}/>, "/review-due", view === "review-due")}
          {nav("trash", "Archive", <Archive size={16}/>, "/trash", view === "trash")}
          {nav("settings", "Settings", <Settings size={16}/>, "/settings", false)}
        </nav>
        {canManagePages && <Button className="wiki-full pw-new" disabled={!lists} aria-busy={busy || undefined} onClick={() => void createPage({ spaceId: null })}><Plus size={15}/>New page</Button>}
        {(canManagePages || lists?.pages.some(page => page.role === "editor")) && <Button variant="outline" className="wiki-full" disabled={!lists} onClick={() => { setTemplatesOpen(true); setNavOpen(false); }}>New page from template</Button>}
        {canManagePages && <Button variant="outline" className="wiki-full" disabled={!lists} onClick={() => { setImportSpace("company"); setImportFiles([]); setDialogError(""); setDialog({ kind: "import" }); }}><FolderUp size={15}/>Import Markdown</Button>}
      </div>
      <div className="pw-sidebar-scroll">
        {notice && <div className={`wiki-notice pw-side-notice ${notice.success ? "wiki-notice-success" : ""}`} role={notice.success ? "status" : "alert"}>{notice.text}<button type="button" className="pw-tree-icon" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={13}/></button></div>}
        {!lists && !loadError && <div className="pw-tree-empty" role="status"><LoaderCircle size={14} className="wiki-spinner"/> Loading pages…</div>}
        {lists && <>
          <LinkList title="FAVORITES" icon={<Star size={12}/>} pages={lists.favorites} currentId={currentId} onOpen={open}/>
          <LinkList title="RECENT" icon={<Clock size={12}/>} pages={lists.recent.slice(0, 5)} currentId={currentId} onOpen={open}/>
          {spaces.map(space => <SpaceTree key={space.id ?? "company"} space={space} children={children} currentId={currentId} expanded={expanded} busy={busy} canCreate={canManagePages} onToggle={toggle} onAction={action} onCreate={spaceId => void createPage({ spaceId })} onPermissions={() => space.id && openPermissions({ kind: "space", id: space.id, name: space.name })}/>)}
        </>}
      </div>
      <div className="wiki-sidebar-user"><span className="wiki-avatar">{initials(identity.user.name)}</span><div><strong>{identity.user.name}</strong><small>{identity.user.email}</small></div><Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" onClick={() => void logout().catch(failure => setNotice({ text: message(failure) }))}><LogOut size={16}/></Button></div>
    </aside>
    <div className="pw-main">
      {loadError ? <>{topbar(null)}<main id="workspace-content" className="pw-canvas" tabIndex={-1}><div className="wiki-message-wrap"><div className="wiki-notice" role="alert">{loadError}</div><Button variant="outline" onClick={() => window.location.reload()}>Try again</Button></div></main></>
        : view === "page" ? <PageView key={`${companyId}:${pageVersion}`} api={client} collab={collaboration} members={workspace?.members ?? []} userId={identity.user.id} isAdmin={currentCompany?.role === "admin"} pageId={currentId!} topbar={topbar} events={events}/>
        : <>{topbar(<span className="pw-crumb-text">{view === "trash" ? "Archive" : view === "search" ? "Search pages" : view === "inbox" ? "Notifications" : view === "review-due" ? "Review due" : "Home"}</span>)}<main id="workspace-content" className="pw-canvas" tabIndex={-1}><div className="pw-page">
          {view === "trash" ? <TrashList pages={trash} spaces={spaces} busy={busy} onRestore={page => void restore(page)}/>
            : view === "search" ? <SearchView api={collaboration} members={workspace?.members ?? []} spaces={spaces} onOpen={open}/>
            : view === "inbox" ? <InboxView key={companyId} api={collaboration} feed={notificationFeed} onOpen={openNotificationPage}/>
            : view === "review-due" ? <ReviewDueView api={collaboration} onOpen={open}/>
            : <HomeView companyName={companyName} recent={lists?.recent ?? []} pages={lists?.pages ?? []} busy={!lists} canCreate={canManagePages} onOpen={open} onCreate={() => void createPage({ spaceId: null })}/>}
        </div></main></>}
    </div>
    {sharing && <PermissionsPanel key={`${companyId}:${sharing.kind}:${sharing.id}`} api={client} target={sharing} members={workspace?.members ?? []} groups={workspace?.groups ?? []} onClose={() => setSharing(null)} onSaved={async () => { setPageVersion(value => value + 1); setLists(null); try { await reload(); } catch (failure) { setLoadError(message(failure)); throw failure; } }}/>}
    {templatesOpen && <TemplateChooser key={companyId} api={client} pages={lists?.pages ?? []} spaces={spaces} onClose={() => setTemplatesOpen(false)} onCreated={id => { setTemplatesOpen(false); refreshQuietly(); open(id); }}/>}
    <Dialog open={dialog !== null} onOpenChange={value => { if (!value && !busy) setDialog(null); }}><DialogContent>
      {dialog?.kind === "rename" && <><DialogHeader><DialogTitle>Rename page</DialogTitle><DialogDescription>Everyone who can see this page will see the new title.</DialogDescription></DialogHeader>
        <form className="wiki-form" onSubmit={event => void submitDialog(event)}><div className="wiki-form-field"><Label htmlFor="pw-rename">Title</Label><Input id="pw-rename" name="title" defaultValue={dialog.page.title} maxLength={200} placeholder="Untitled" autoFocus disabled={busy}/></div>
          {dialogError && <div className="wiki-notice" role="alert">{dialogError}</div>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" disabled={busy}>Save</Button></DialogFooter></form></>}
      {dialog?.kind === "move" && <><DialogHeader><DialogTitle>Move “{dialog.page.title || "Untitled"}”</DialogTitle><DialogDescription>Choose a space and, if you like, a page to nest it under. Its subpages move with it and keep their own sharing settings.</DialogDescription></DialogHeader>
        <form className="wiki-form" onSubmit={event => void submitDialog(event)}>
          <div className="wiki-form-field"><Label htmlFor="pw-move-space">Space</Label><Select value={moveTarget.space} onValueChange={space => setMoveTarget({ space, parent: "top" })} disabled={busy}><SelectTrigger id="pw-move-space" className="wiki-full"><SelectValue/></SelectTrigger><SelectContent>{spaces.map(space => <SelectItem key={space.id ?? "company"} value={space.id ?? "company"}>{space.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="wiki-form-field"><Label htmlFor="pw-move-parent">Place under</Label><Select value={moveTarget.parent} onValueChange={parent => setMoveTarget(previous => ({ ...previous, parent }))} disabled={busy}><SelectTrigger id="pw-move-parent" className="wiki-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="top">Top level of the space</SelectItem>{parentOptions.map(page => <SelectItem key={page.id} value={page.id}>{page.title || "Untitled"}</SelectItem>)}</SelectContent></Select><small>Only pages you can edit are listed. The page itself and its subpages can’t be chosen.</small></div>
          {dialogError && <div className="wiki-notice" role="alert">{dialogError}</div>}
          {movePreview?.changed && <label className="pw-permission-confirm"><Checkbox checked={moveAcknowledged} onCheckedChange={value => setMoveAcknowledged(value === true)} disabled={busy}/>This changes who can access this page or its inheriting subpages, or their effective roles. Explicit overrides stay unchanged. I understand and approve this access change.</label>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" disabled={busy || (movePreview?.changed && !moveAcknowledged)}>{movePreview?.changed ? "Confirm move" : "Review and move"}</Button></DialogFooter></form></>}
      {dialog?.kind === "archive" && <><DialogHeader><DialogTitle>Move “{dialog.page.title || "Untitled"}” to the archive?</DialogTitle><DialogDescription>The page and its subpages will be hidden for everyone. An editor can restore them from Archive with their content and links unchanged.</DialogDescription></DialogHeader>
        {dialogError && <div className="wiki-notice" role="alert">{dialogError}</div>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => void submitDialog()}>Move to archive</Button></DialogFooter></>}
      {dialog?.kind === "import" && <><DialogHeader><DialogTitle>Import Markdown page tree</DialogTitle><DialogDescription>Choose a folder containing .md files. Folder names become parent pages, and each Markdown file becomes a page.</DialogDescription></DialogHeader>
        <form className="wiki-form" onSubmit={event => void submitImport(event)}>
          <div className="wiki-form-field"><Label htmlFor="pw-import-space">Import into</Label><Select value={importSpace} onValueChange={setImportSpace} disabled={busy}><SelectTrigger id="pw-import-space" className="wiki-full"><SelectValue/></SelectTrigger><SelectContent>{spaces.map(space => <SelectItem key={space.id ?? "company"} value={space.id ?? "company"}>{space.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="wiki-form-field"><Label htmlFor="pw-import-files">Markdown folder</Label><Input ref={importInput} id="pw-import-files" type="file" multiple accept=".md,text/markdown" disabled={busy} onChange={event => setImportFiles(Array.from(event.target.files ?? []).filter(file => file.name.toLowerCase().endsWith(".md")))}/><small>{importFiles.length ? `${importFiles.length} Markdown files selected.` : "Select a folder to keep its relative paths and nested structure."}</small></div>
          {dialogError && <div className="wiki-notice" role="alert">{dialogError}</div>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" disabled={busy || !importFiles.length}>{busy ? <LoaderCircle size={14} className="wiki-spinner"/> : <FolderUp size={14}/>}Import pages</Button></DialogFooter>
        </form></>}
    </DialogContent></Dialog>
  </div></NotionThemeProvider>;
}

function SearchView({ api, members, spaces, onOpen }: { api: ReturnType<typeof collabApi>; members: Workspace["members"]; spaces: SpaceRef[]; onOpen: (id: string) => void }) {
  const [filters, setFilters] = useState<SearchFilters>({}), [activeFilters, setActiveFilters] = useState<SearchFilters | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]), [total, setTotal] = useState(0), [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true, generation = 0;
    const refresh = () => { const current = ++generation; void api.tags().then(value => { if (active && current === generation) setTags(value.tags); }).catch(() => undefined); };
    refresh(); window.addEventListener(tagsChanged, refresh);
    return () => { active = false; window.removeEventListener(tagsChanged, refresh); };
  }, [api]);
  useEffect(() => {
    if (!activeFilters) return;
    let active = true; setBusy(true); setError("");
    api.search(activeFilters).then(value => { if (active) { setResults(value.results); setTotal(value.total); } })
      .catch(failure => { if (active) { setResults([]); setTotal(0); setError(message(failure)); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, activeFilters]);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setActiveFilters({ ...filters }); }
  function clear() { setFilters({}); setActiveFilters({}); }
  return <>
    <div className="wiki-section-heading"><div><span className="wiki-page-icon"><Search size={25}/></span><h1>Search pages</h1><p>Find pages you have permission to view, then narrow by owner, space, tag or update date.</p></div></div>
    <form className="pw-search-form" onSubmit={submit}>
      <div className="pw-search-query"><Label htmlFor="pw-search-q">Words in title or page</Label><Input id="pw-search-q" value={filters.q ?? ""} maxLength={200} placeholder="Search your workspace…" onChange={event => setFilters(previous => ({ ...previous, q: event.target.value }))}/></div>
      <div className="pw-filter-grid">
        <div className="wiki-form-field"><Label htmlFor="pw-search-owner">Owner</Label><Select value={filters.ownerId ?? "all"} onValueChange={value => setFilters(previous => ({ ...previous, ownerId: value === "all" ? undefined : value }))}><SelectTrigger id="pw-search-owner"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Anyone</SelectItem>{members.filter(member => member.status === "active").map(member => <SelectItem value={member.userId} key={member.userId}>{member.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="wiki-form-field"><Label htmlFor="pw-search-space">Space</Label><Select value={filters.spaceId ?? "all"} onValueChange={value => setFilters(previous => ({ ...previous, spaceId: value === "all" ? undefined : value }))}><SelectTrigger id="pw-search-space"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All spaces</SelectItem>{spaces.map(space => <SelectItem key={space.id ?? "company"} value={space.id ?? "company"}>{space.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="wiki-form-field"><Label htmlFor="pw-search-tag">Tag</Label><Select value={filters.tag ?? "all"} onValueChange={value => setFilters(previous => ({ ...previous, tag: value === "all" ? undefined : value }))}><SelectTrigger id="pw-search-tag"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Any tag</SelectItem>{tags.map(tag => <SelectItem value={tag.tag} key={tag.tag}>{tag.tag}</SelectItem>)}</SelectContent></Select></div>
        <div className="wiki-form-field"><Label htmlFor="pw-search-after">Updated after</Label><Input id="pw-search-after" type="date" value={filters.updatedAfter ?? ""} onChange={event => setFilters(previous => ({ ...previous, updatedAfter: event.target.value || undefined }))}/></div>
        <div className="wiki-form-field"><Label htmlFor="pw-search-before">Updated before</Label><Input id="pw-search-before" type="date" value={filters.updatedBefore ?? ""} onChange={event => setFilters(previous => ({ ...previous, updatedBefore: event.target.value || undefined }))}/></div>
      </div>
      <div className="pw-search-actions"><Button type="submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="wiki-spinner"/> : <Search size={15}/>}Search</Button><Button type="button" variant="outline" onClick={clear}>Clear filters</Button></div>
    </form>
    {error && <div className="wiki-notice" role="alert">{error}</div>}
    {activeFilters && <div className="pw-search-results" aria-live="polite"><div className="wiki-section-line"><h2>{busy ? "Searching…" : `${total} ${total === 1 ? "result" : "results"}`}</h2></div>
      {!busy && !results.length && !error && <p className="pw-panel-empty">No pages match those filters.</p>}
      <ul>{results.map(result => <li key={result.id}><button type="button" onClick={() => onOpen(result.id)}><strong>{result.title || "Untitled"}</strong><small>{result.spaceName ?? "Team space"} · Owned by {result.ownerName} · Updated {new Date(result.updatedAt).toLocaleDateString()}</small>{result.snippet && <span>{result.snippet}</span>}{!!result.tags.length && <em>{result.tags.join(" · ")}</em>}</button></li>)}</ul>
    </div>}
  </>;
}

function InboxView({ api, feed, onOpen }: { api: ReturnType<typeof collabApi>; feed: NotificationFeed; onOpen: (id: string, threadId?: string | null) => void }) {
  const { notifications, busy, loading, error } = useSyncExternalStore(feed.subscribe, feed.getSnapshot);
  const [emailError, setEmailError] = useState("");
  useEffect(() => { void feed.refresh(); }, [feed]);
  async function markRead(item: Notification, openPage: boolean) {
    if (!item.readAt) {
      if (!await feed.mutate(() => api.markNotificationRead(item.id))) return;
    }
    if (openPage && item.pageId) onOpen(item.pageId, item.threadId);
  }
  async function markAll() {
    await feed.mutate(() => api.markAllNotificationsRead());
  }
  async function retryEmail(item: Notification) {
    setEmailError("");
    await feed.mutate(async () => {
      const result = await api.retryNotificationEmail(item.id);
      if (!result.ok) setEmailError(result.emailError ?? "Email delivery failed. Please retry.");
    });
  }
  const labels: Record<Notification["kind"], string> = { mention: "mentioned you", comment: "commented on a page", access: "changed page access", review_due: "page review is due" };
  return <>
    <div className="wiki-section-heading"><div><span className="wiki-page-icon"><Bell size={25}/></span><h1>Notifications</h1><p>Mentions, comments, access changes and pages that need review.</p></div><Button variant="outline" disabled={busy || loading} onClick={() => void feed.refresh()}>{loading ? "Refreshing…" : "Refresh"}</Button>{notifications?.some(item => !item.readAt) && <Button variant="outline" disabled={busy || loading} onClick={() => void markAll()}>Mark all read</Button>}</div>
    {(error || emailError) && <div className="wiki-notice" role="alert">{error || emailError}{error && <Button variant="outline" size="sm" disabled={busy || loading} onClick={() => void feed.refresh()}>Retry notifications</Button>}</div>}
    {!notifications ? !error && <div className="wiki-loading" role="status"><LoaderCircle size={20} className="wiki-spinner"/>Loading notifications…</div>
      : notifications.length ? <ul className="pw-inbox-list">{notifications.map(item => <li key={item.id} className={!item.readAt ? "pw-inbox-unread" : ""}><div><strong>{item.actorName ?? "Workspace"}</strong> {labels[item.kind]}{item.pageTitle && <>: <b>{item.pageTitle}</b></>}<small>{when(item.createdAt)}</small>{["mention", "review_due"].includes(item.kind) && <small>{item.emailStatus === "sent" ? "Email sent." : item.emailStatus === "failed" || item.emailStatus === "unavailable" ? item.emailError ?? "Email delivery failed." : item.emailStatus === "sending" || item.emailStatus === "pending" ? "Email is being delivered…" : ""}</small>}</div>{item.pageId && <Button variant="outline" size="sm" disabled={busy} onClick={() => void markRead(item, true)}>Open page</Button>}{(item.emailStatus === "failed" || item.emailStatus === "unavailable") && <Button variant="outline" size="sm" disabled={busy} onClick={() => void retryEmail(item)}>Retry email</Button>}{!item.readAt && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void markRead(item, false)}>Mark read</Button>}</li>)}</ul>
      : <div className="wiki-empty"><span className="wiki-empty-icon"><Bell size={28}/></span><h2>You’re all caught up.</h2><p>New mentions and page updates will appear here.</p></div>}
  </>;
}

function ReviewDueView({ api, onOpen }: { api: ReturnType<typeof collabApi>; onOpen: (id: string) => void }) {
  const [mine, setMine] = useState(false), [pages, setPages] = useState<ReviewDuePage[] | null>(null), [error, setError] = useState("");
  useEffect(() => { let active = true; setPages(null); api.reviewDue(mine).then(value => { if (active) setPages(value.pages); }).catch(failure => { if (active) { setPages([]); setError(message(failure)); } }); return () => { active = false; }; }, [api, mine]);
  return <>
    <div className="wiki-section-heading"><div><span className="wiki-page-icon"><ClipboardCheck size={25}/></span><h1>Review due</h1><p>Pages whose scheduled review date has passed, ordered by oldest due date.</p></div><Button variant={mine ? "default" : "outline"} onClick={() => setMine(value => !value)}>{mine ? "Showing my pages" : "Show my pages"}</Button></div>
    {error && <div className="wiki-notice" role="alert">{error}</div>}
    {!pages ? <div className="wiki-loading" role="status"><LoaderCircle size={20} className="wiki-spinner"/>Loading review dates…</div>
      : pages.length ? <ul className="pw-review-list">{pages.map(page => <li key={page.id}><div><strong>{page.title || "Untitled"}</strong><small>Owned by {page.ownerName} · Due {new Date(page.dueAt).toLocaleDateString()}{page.lastReviewedAt ? ` · Last reviewed ${new Date(page.lastReviewedAt).toLocaleDateString()}` : " · Never reviewed"}</small></div><Button variant="outline" size="sm" onClick={() => onOpen(page.id)}>Open and review</Button></li>)}</ul>
      : <div className="wiki-empty"><span className="wiki-empty-icon"><Check size={28}/></span><h2>No reviews are overdue.</h2><p>Pages with a review schedule will appear here when their due date passes.</p></div>}
  </>;
}

function HomeView({ companyName, recent, pages, busy, canCreate, onOpen, onCreate }: { companyName: string; recent: PageLink[]; pages: TreePage[]; busy: boolean; canCreate: boolean; onOpen: (id: string) => void; onCreate: () => void }) {
  const visited = recent.length > 0;
  const updatedPages = [...pages].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, 8);
  const shownPages: { id: string; title: string; updatedAt: string | null }[] = visited
    ? recent.slice(0, 8).map(({ id, title }) => ({ id, title, updatedAt: null }))
    : updatedPages.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
  return <>
    <div className="wiki-section-heading"><div><span className="wiki-page-icon"><BookOpen size={27} strokeWidth={1.6}/></span><h1>{companyName}</h1><p>Your team’s pages, all in one place.</p></div>{canCreate && <Button disabled={busy} onClick={onCreate}><Plus size={16}/>New page</Button>}</div>
    {shownPages.length ? <><div className="wiki-section-line"><h2>{visited ? "Recently visited" : "Recently updated team pages"}</h2></div><ul className="pw-card-list">{shownPages.map(page => <li key={page.id}><button type="button" onClick={() => onOpen(page.id)}><FileText size={16}/><span>{page.title || "Untitled"}{page.updatedAt && <small>Updated {new Date(page.updatedAt).toLocaleDateString()}</small>}</span></button></li>)}</ul></>
      : <div className="wiki-empty"><span className="wiki-empty-icon"><FileText size={30}/></span><h2>Start your first page.</h2><p>Write down how your team works. Pages can hold headings, lists, tables, code, images and files.</p>{canCreate && <Button variant="outline" disabled={busy} onClick={onCreate}><Plus size={16}/>New page</Button>}</div>}
  </>;
}

function TrashList({ pages, spaces, busy, onRestore }: { pages: ArchivedPage[] | null; spaces: SpaceRef[]; busy: boolean; onRestore: (page: ArchivedPage) => void }) {
  return <>
    <div className="wiki-section-heading"><div><span className="wiki-page-icon"><Archive size={27} strokeWidth={1.6}/></span><h1>Archive</h1><p>Archived pages you can restore. Restoring brings back the page with its subpages.</p></div></div>
    {!pages ? <div className="wiki-loading" role="status"><LoaderCircle size={22} className="wiki-spinner"/>Loading archive…</div>
      : pages.length ? <ul className="pw-trash">{pages.map(page => <li key={page.id}><FileText size={16}/><div><strong>{page.title || "Untitled"}</strong><small>{spaces.find(space => space.id === page.spaceId)?.name ?? "Team space"} · archived {new Date(page.archivedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small></div><Button variant="outline" size="sm" disabled={busy} onClick={() => onRestore(page)}><RotateCcw size={14}/>Restore</Button></li>)}</ul>
      : <div className="wiki-empty"><span className="wiki-empty-icon"><Archive size={30}/></span><h2>Nothing in the archive.</h2><p>Pages you move to the archive appear here until you restore them.</p></div>}
  </>;
}
