import { Component, lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Activity, ChevronRight, CloudOff, Download, Eye, FileQuestion, History, LoaderCircle, MessageSquare, RotateCcw, Star, Check, TriangleAlert, Copy, Upload, X, CircleCheck, Clock3, Share2, Link2, Printer, MoreHorizontal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError } from "./api";
import { ConflictError, type Block, type Conflict, type PageDetail, type PagesApi } from "./pagesApi";
import { commentsChanged, insertMentionToken, mentionPopoverPlacement, mentionQueryAt, when, type ActivityRow, type CollabApi, type MentionMember, type RevisionRow, type Thread } from "./collabApi";
import type { Member } from "./api";
import { canReviewPage } from "./pageActions";
import { PageBacklinks, PageTags } from "./PageTools";
import { printPage } from "./printPage";
import "./print.css";

// BlockNote is large, so the editor loads on demand the first time a page opens.
const PageEditor = lazy(() => import("./PageEditor"));
const message = (error: unknown) => error instanceof Error ? error.message
  : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message
  : "The page could not be opened. Please try again.";
type Crumb = { id: string; title: string };
type Loaded = { state: "loading" } | { state: "missing" } | { state: "error"; message: string } | { state: "ready"; page: PageDetail; breadcrumbs: Crumb[] };
export type PageEvents = { onOpen: (id: string) => void; onShare: (id: string, name: string) => void; onUnsaved: (unsaved: boolean) => void; onTitle: (id: string, title: string) => void; onFavorite: () => void; onCreated: () => void; onVisited: () => void };

function EditorFallback() {
  return <div className="pw-editor-loading" role="status"><LoaderCircle className="wiki-spinner" size={18}/>Opening the editor…</div>;
}

function MentionTextarea({ api, pageId, value, onChange, label, placeholder, rows }: { api: CollabApi; pageId: string; value: string; onChange: (value: string) => void; label?: string; placeholder: string; rows: number }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const optionsId = useId();
  const [query, setQuery] = useState<string | null>(null), [members, setMembers] = useState<MentionMember[]>([]), [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<ReturnType<typeof mentionPopoverPlacement> | null>(null);
  useEffect(() => {
    if (!query) { setMembers([]); return; }
    let current = true;
    const timer = window.setTimeout(() => {
      void api.mentionMembers(pageId, query).then(result => { if (current) { setMembers(result.members); setActive(0); } }).catch(() => { if (current) setMembers([]); });
    }, 100);
    return () => { current = false; window.clearTimeout(timer); };
  }, [api, pageId, query]);
  useLayoutEffect(() => {
    if (!members.length) { setPlacement(null); return; }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = input.current;
        if (!element) return;
        const visual = window.visualViewport;
        const rect = element.getBoundingClientRect();
        setPlacement(mentionPopoverPlacement(rect, {
          width: visual?.width ?? window.innerWidth,
          height: visual?.height ?? window.innerHeight,
          offsetLeft: visual?.offsetLeft ?? 0,
          offsetTop: visual?.offsetTop ?? 0,
          layoutWidth: window.innerWidth,
          layoutHeight: window.innerHeight,
        }));
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [members.length]);
  function choose(member: MentionMember) {
    const element = input.current;
    if (!element) return;
    const inserted = insertMentionToken(value, element.selectionStart, member.email);
    onChange(inserted.value); setQuery(null);
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(inserted.caret, inserted.caret); });
  }
  return <div className="pw-mention-field">
    <textarea ref={input} aria-label={label} aria-autocomplete="list" aria-expanded={members.length > 0} aria-controls={members.length ? optionsId : undefined} aria-activedescendant={members.length ? `${optionsId}-${active}` : undefined} value={value} onChange={event => {
      onChange(event.target.value);
      const match = mentionQueryAt(event.target.value, event.target.selectionStart);
      setQuery(match && match.query ? match.query : null);
    }} onKeyDown={event => {
      if (!members.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(index => (index + (event.key === "ArrowDown" ? 1 : members.length - 1)) % members.length); }
      else if (event.key === "Enter" && members[active]) { event.preventDefault(); choose(members[active]); }
      else if (event.key === "Escape") { event.preventDefault(); setMembers([]); setQuery(null); }
    }} placeholder={placeholder} rows={rows}/>
    {members.length > 0 && placement && createPortal(<div className="pw-mention-options" id={optionsId} role="listbox" aria-label="Mention a workspace member" style={{ position: "fixed", zIndex: 10000, left: placement.left, width: placement.width, maxHeight: placement.maxHeight, overflowY: "auto", ...(placement.side === "below" ? { top: placement.top } : { bottom: placement.bottom }) }}>
      {members.map((member, index) => <button type="button" id={`${optionsId}-${index}`} role="option" aria-selected={index === active} key={member.userId} onMouseDown={event => event.preventDefault()} onClick={() => choose(member)}><strong>{member.name}</strong><span>{member.email}</span></button>)}
    </div>, document.body)}
  </div>;
}

class PageEditorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="wiki-message-wrap" role="alert"><p>The page content could not be opened. Your saved page is unchanged.</p><Button variant="outline" onClick={this.props.onRetry}><RotateCcw size={14}/>Reload page content</Button></div>;
    return this.props.children;
  }
}

export function PageView({ api, collab, members, userId, isAdmin, pageId, topbar, events }: { api: PagesApi; collab: CollabApi; members: Member[]; userId: string; isAdmin: boolean; pageId: string; topbar: (crumbs: ReactNode, actions?: ReactNode) => ReactNode; events: PageEvents }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" }), [attempt, setAttempt] = useState(0);
  const threadId = new URLSearchParams(window.location.search).get("thread");
  useEffect(() => {
    let active = true;
    setLoaded({ state: "loading" });
    api.page(pageId).then(value => { if (active) { setLoaded({ state: "ready", ...value }); events.onVisited(); } })
      .catch(failure => { if (active) setLoaded(failure instanceof ApiError && failure.status === 404 ? { state: "missing" } : { state: "error", message: message(failure) }); });
    return () => { active = false; };
  }, [api, pageId, attempt]);
  if (loaded.state === "ready") return <PageDocument key={loaded.page.id} api={api} collab={collab} members={members} userId={userId} isAdmin={isAdmin} initialThreadId={threadId} page={loaded.page} breadcrumbs={loaded.breadcrumbs} topbar={topbar} events={events}/>;
  return <>{topbar(null)}<main id="workspace-content" className="pw-canvas" tabIndex={-1}>
    {loaded.state === "loading" && <div className="wiki-loading" role="status"><LoaderCircle size={22} className="wiki-spinner"/>Opening page…</div>}
    {loaded.state === "missing" && <div className="wiki-empty"><span className="wiki-empty-icon"><FileQuestion size={30}/></span><h2>Page not found or you don’t have access.</h2><p>It may have been moved to the archive, or it hasn’t been shared with you. Ask a teammate to share it if you need it.</p></div>}
    {loaded.state === "error" && <div className="wiki-message-wrap"><div className="wiki-notice" role="alert">{loaded.message}</div><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Try again</Button></div>}
  </main></>;
}

type SaveState = "saved" | "pending" | "saving" | "error" | "conflict";

// One open page. Edits autosave about a second after typing stops, always against the revision they started from.
// A 409 stops autosaving and the editor becomes read-only until the person chooses a version in the conflict panel.
function PageDocument({ api, collab, members, userId, isAdmin, initialThreadId, page, breadcrumbs, topbar, events }: { api: PagesApi; collab: CollabApi; members: Member[]; userId: string; isAdmin: boolean; initialThreadId: string | null; page: PageDetail; breadcrumbs: Crumb[]; topbar: (crumbs: ReactNode, actions?: ReactNode) => ReactNode; events: PageEvents }) {
  const canEdit = page.role === "editor";
  const canManageSnapshot = isAdmin || page.ownerId === userId;
  const revision = useRef(page.revision), latest = useRef<Block[]>(page.content);
  const dirty = useRef(false), saving = useRef(false), blocked = useRef(false), timer = useRef<number | undefined>(undefined);
  const [saveState, setSaveState] = useState<SaveState>("saved"), [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null), [conflictBusy, setConflictBusy] = useState(false), [conflictNote, setConflictNote] = useState<{ text: string; copyId?: string } | null>(null);
  const [editorContent, setEditorContent] = useState(page.content), [editorKey, setEditorKey] = useState(0);
  const [title, setTitle] = useState(page.title), [savedTitle, setSavedTitle] = useState(page.title), [titleError, setTitleError] = useState("");
  const [snapshotState, setSnapshotState] = useState<"loading" | "published" | "unpublished" | "error">("loading"), [snapshotUrl, setSnapshotUrl] = useState(""), [snapshotError, setSnapshotError] = useState(""), [snapshotBusy, setSnapshotBusy] = useState(false);
  const [favorite, setFavorite] = useState(page.favorite), [uploadError, setUploadError] = useState(""), [panelOpen, setPanelOpen] = useState(!!initialThreadId);
  const printRoot = useRef<HTMLDivElement>(null), printPreparation = useRef<AbortController | null>(null);
  const [printing, setPrinting] = useState(false);
  useEffect(() => () => { printPreparation.current?.abort(); }, [api]);
  useEffect(() => { events.onUnsaved(canEdit && (saveState !== "saved" || title.trim() !== savedTitle)); }, [canEdit, saveState, title, savedTitle, events]);
  useEffect(() => () => events.onUnsaved(false), [events]);

  useEffect(() => {
    if (!canManageSnapshot) return;
    let active = true;
    setSnapshotState("loading"); setSnapshotError("");
    api.publicSnapshotStatus(page.id).then(value => { if (active) setSnapshotState(value.published ? "published" : "unpublished"); })
      .catch(failure => { if (active) { setSnapshotState("error"); setSnapshotError(message(failure)); } });
    return () => { active = false; };
  }, [api, page.id, canManageSnapshot]);

  async function publishSnapshot() {
    setSnapshotBusy(true); setSnapshotError("");
    try {
      const result = await api.publishSnapshot(page.id);
      setSnapshotUrl(result.url); setSnapshotState("published");
    } catch (failure) { setSnapshotError(message(failure)); }
    finally { setSnapshotBusy(false); }
  }
  async function revokeSnapshot() {
    setSnapshotBusy(true); setSnapshotError("");
    try {
      await api.revokeSnapshot(page.id); setSnapshotUrl(""); setSnapshotState("unpublished");
    } catch (failure) { setSnapshotError(message(failure)); }
    finally { setSnapshotBusy(false); }
  }
  async function copySnapshotLink() {
    try { await navigator.clipboard.writeText(snapshotUrl); setSnapshotError("Public snapshot link copied."); }
    catch { setSnapshotError(`Copy this public snapshot link: ${snapshotUrl}`); }
  }

  async function save() {
    window.clearTimeout(timer.current);
    if (saving.current || blocked.current || !dirty.current) return;
    saving.current = true; dirty.current = false; setSaveState("saving");
    const content = latest.current, started = Date.now();
    let ok = false;
    try {
      const result = await api.save(page.id, content, revision.current);
      revision.current = result.revision; ok = true;
      window.dispatchEvent(new Event(commentsChanged));
      // Keep "Saving…" on screen long enough to notice, even when the server answers instantly.
      const wait = 300 - (Date.now() - started);
      if (wait > 0) await new Promise(resolve => window.setTimeout(resolve, wait));
      setSaveError(""); setSaveState(dirty.current ? "pending" : "saved");
    } catch (failure) {
      if (failure instanceof ConflictError) {
        blocked.current = true; dirty.current = false;
        setConflict({ ...failure.conflict, yours: { baseRevision: failure.conflict.yours.baseRevision, content: latest.current } }); setSaveState("conflict");
      } else { dirty.current = true; setSaveError(message(failure)); setSaveState("error"); }
    } finally { saving.current = false; }
    if (ok && dirty.current && !blocked.current) timer.current = window.setTimeout(() => void save(), 1000);
  }
  function changed(document: Block[]) {
    if (!canEdit || blocked.current) return;
    latest.current = document; dirty.current = true; setSaveState("pending");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 1000);
  }
  async function prepareComment() {
    while (saving.current) await new Promise(resolve => window.setTimeout(resolve, 30));
    if (dirty.current) await save();
    if (blocked.current || dirty.current || saving.current) throw new Error("Save or resolve the page conflict before commenting on this text.");
  }
  // Leaving the page (or switching to another one) flushes pending edits instead of dropping them.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current || saving.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); if (dirty.current && !blocked.current) void save(); };
  }, []);

  function keepTheirs() {
    if (!conflict) return;
    revision.current = conflict.current.revision; latest.current = conflict.current.content;
    dirty.current = false; blocked.current = false;
    setEditorContent(conflict.current.content); setEditorKey(key => key + 1);
    setConflict(null); setConflictNote(null); setSaveError(""); setSaveState("saved");
  }
  // Explicit overwrite: saves my version on top of the server's latest revision named in the conflict.
  async function overwrite() {
    if (!conflict) return;
    setConflictBusy(true);
    try {
      const result = await api.save(page.id, conflict.yours.content, conflict.current.revision);
      revision.current = result.revision; latest.current = conflict.yours.content; blocked.current = false;
      setConflict(null); setConflictNote(null); setSaveError(""); setSaveState("saved");
    } catch (failure) {
      if (failure instanceof ConflictError) setConflict({ ...failure.conflict, yours: { baseRevision: failure.conflict.current.revision, content: conflict.yours.content } });
      setConflictNote({ text: failure instanceof ConflictError ? "Someone saved again in the meantime. Compare the newest version below." : message(failure) });
    } finally { setConflictBusy(false); }
  }
  async function copyMine() {
    if (!conflict) return;
    setConflictBusy(true);
    try {
      const created = await api.create({ title: `${savedTitle || "Untitled"} (my version)`.slice(0, 200), parentId: page.parentId, spaceId: page.spaceId });
      await api.save(created.id, conflict.yours.content, 1);
      events.onCreated();
      setConflictNote({ text: "Your version was saved as a new page next to this one.", copyId: created.id });
    } catch (failure) { setConflictNote({ text: message(failure) }); }
    finally { setConflictBusy(false); }
  }
  async function saveTitle() {
    const next = title.trim();
    if (next === savedTitle) { setTitle(next); return; }
    setTitleError("");
    try { await api.rename(page.id, next); setSavedTitle(next); setTitle(next); events.onTitle(page.id, next); }
    catch (failure) { setTitleError(message(failure)); }
  }
  async function toggleFavorite() {
    try { await api.favorite(page.id, !favorite); setFavorite(!favorite); events.onFavorite(); }
    catch (failure) { setUploadError(message(failure)); }
  }
  async function exportPage() {
    setUploadError("");
    try {
      const blob = await api.exportMarkdown(page.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${savedTitle || "Untitled"}.md`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (failure) { setUploadError(message(failure)); }
  }
  async function exportPdf() {
    if (printPreparation.current) return;
    setUploadError("");
    const root = printRoot.current;
    if (!root?.querySelector('.pw-editor[aria-label="Page content"] .bn-editor') || conflict) {
      setUploadError("Wait for the page content to open and resolve any conflicting changes before printing.");
      return;
    }
    const controller = new AbortController();
    printPreparation.current = controller;
    setPrinting(true);
    try { await printPage(root, () => window.print(), { signal: controller.signal }); }
    catch (failure) { if (!controller.signal.aborted) setUploadError(`PDF could not be prepared. ${message(failure)}`); }
    finally { if (!controller.signal.aborted) setPrinting(false); printPreparation.current = null; }
  }
  async function uploadFile(file: File) {
    setUploadError("");
    try { return (await api.upload(page.id, file)).url; }
    catch (failure) { setUploadError(`${file.name}: ${message(failure)}`); throw failure; }
  }
  function retry() { dirty.current = true; setSaveError(""); void save(); }

  const crumbs = <nav aria-label="Breadcrumb" className="pw-crumbs"><ol>
    {breadcrumbs.map(crumb => <li key={crumb.id}><button type="button" onClick={() => events.onOpen(crumb.id)}>{crumb.title || "Untitled"}</button><ChevronRight size={13} aria-hidden="true"/></li>)}
    <li aria-current="page"><span>{savedTitle || "Untitled"}</span></li>
  </ol></nav>;
  const status = !canEdit ? <><Eye size={14}/>View only</>
    : saveState === "saved" ? <><Check size={14}/>Saved</>
    : saveState === "error" ? <><CloudOff size={14}/>Not saved</>
    : saveState === "conflict" ? <><TriangleAlert size={14}/>Needs your review</>
    : saveState === "pending" ? <>Editing · unsaved changes</>
    : <><LoaderCircle size={14} className="wiki-spinner"/>Saving changes…</>;
  const menuActions: { label: string; icon: LucideIcon; onSelect: () => void; disabled?: boolean; expanded?: boolean; pressed?: boolean }[] = [];
  if (canEdit && canManageSnapshot && snapshotState === "unpublished") menuActions.push({ label: snapshotBusy ? "Publishing…" : "Publish snapshot", icon: Share2, onSelect: () => void publishSnapshot(), disabled: snapshotBusy || saveState !== "saved" });
  if (canManageSnapshot && snapshotState === "published") {
    menuActions.push({ label: "Copy link", icon: Link2, onSelect: () => void copySnapshotLink(), disabled: snapshotBusy || !snapshotUrl });
    menuActions.push({ label: "Revoke link", icon: X, onSelect: () => void revokeSnapshot(), disabled: snapshotBusy });
  }
  menuActions.push(
    { label: "Share / Permissions", icon: Share2, disabled: canEdit && saveState !== "saved", onSelect: () => events.onShare(page.id, savedTitle || "Untitled") },
    { label: "Markdown", icon: Download, onSelect: () => void exportPage() },
    { label: printing ? "Preparing PDF…" : "PDF", icon: Printer, disabled: printing, onSelect: () => void exportPdf() },
    { label: "Discussion & history", icon: MessageSquare, onSelect: () => setPanelOpen(value => !value), expanded: panelOpen },
    { label: favorite ? "Remove from favorites" : "Add to favorites", icon: Star, onSelect: () => void toggleFavorite(), pressed: favorite },
  );
  const actions = <>
    <span className={`pw-save pw-save-${canEdit ? saveState : "view"}`} role="status" aria-live="polite">{status}</span>
    <div className="pw-toolbar-desktop">
    <Button variant="outline" size="sm" disabled={canEdit && saveState !== "saved"} onClick={() => events.onShare(page.id, savedTitle || "Untitled")}><Share2 size={15}/>Share</Button>
    {canEdit && canManageSnapshot && snapshotState === "unpublished" && <Button variant="outline" size="sm" disabled={snapshotBusy || saveState !== "saved"} onClick={() => void publishSnapshot()}><Share2 size={15}/>{snapshotBusy ? "Publishing…" : "Publish snapshot"}</Button>}
    {canManageSnapshot && snapshotState === "published" && <><Button variant="outline" size="sm" disabled={snapshotBusy || !snapshotUrl} title={snapshotUrl ? "Copy the public snapshot link" : "The token is not stored; revoke and publish again to create a new link"} onClick={() => void copySnapshotLink()}><Link2 size={15}/>Copy link</Button><Button variant="outline" size="sm" disabled={snapshotBusy} onClick={() => void revokeSnapshot()}>Revoke link</Button></>}
    <Button variant="outline" size="sm" onClick={() => void exportPage()}><Download size={15}/>Markdown</Button>
    <Button variant="outline" size="sm" onClick={() => window.print()} title="Print this page or save it as a PDF"><Printer size={15}/>PDF</Button>
    <Button variant="outline" size="sm" aria-expanded={panelOpen} onClick={() => setPanelOpen(value => !value)}><MessageSquare size={15}/>Discussion & history</Button>
    <Button variant="ghost" size="icon" aria-pressed={favorite} aria-label={favorite ? "Remove from favorites" : "Add to favorites"} title={favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => void toggleFavorite()}><Star size={16} fill={favorite ? "currentColor" : "none"}/></Button>
    </div>
    <div className="pw-toolbar-mobile">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Page actions"><MoreHorizontal size={18}/></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {menuActions.map(({ label, icon: Icon, onSelect, disabled, expanded, pressed }) => <DropdownMenuItem key={label} disabled={disabled} aria-expanded={expanded} aria-pressed={pressed} onSelect={onSelect}><Icon size={16}/>{label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </>;
  async function restoreRevision(result: { revision: number; content: Block[] }) {
    revision.current = result.revision; latest.current = result.content; dirty.current = false; blocked.current = false;
    setEditorContent(result.content); setEditorKey(value => value + 1); setSaveState("saved"); setSaveError("");
  }
  return <>{topbar(crumbs, actions)}<main id="workspace-content" className="pw-canvas" tabIndex={-1}><div className={`pw-document-layout ${panelOpen ? "pw-document-panel-open" : ""}`}><div className="pw-page" ref={printRoot}>
    {canEdit
      ? <h1 className="pw-title"><input aria-label="Page title" placeholder="Untitled" maxLength={200} value={title} onChange={event => setTitle(event.target.value)} onBlur={() => void saveTitle()}
          onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setTitle(savedTitle); setTitleError(""); } }}/></h1>
      : <h1 className="pw-title">{savedTitle || "Untitled"}</h1>}
    {titleError && <div className="wiki-notice" role="alert">{titleError}</div>}
    {!canEdit && <div className="wiki-readonly"><Eye size={17}/><p>{page.role === "commenter" ? "You can read this page as a commenter." : "You can read this page."} Only editors can change it.</p></div>}
    {snapshotError && <div className={`wiki-notice ${snapshotUrl && snapshotError === "Public snapshot link copied." ? "wiki-notice-success" : ""}`} role={snapshotUrl && snapshotError === "Public snapshot link copied." ? "status" : "alert"}>{snapshotError}</div>}
    {canManageSnapshot && snapshotState === "published" && !snapshotUrl && <p className="wiki-small-note">This saved snapshot is public. Its link token is not stored, so revoke it before creating a replacement link.</p>}
    {saveState === "error" && <div className="wiki-message-wrap"><div className="wiki-notice" role="alert">{saveError} Your changes are still here and will be saved when you retry.</div><Button variant="outline" onClick={retry}><RotateCcw size={14}/>Retry</Button></div>}
    {uploadError && <div className="wiki-notice" role="alert">{uploadError}</div>}
    {conflict && <section className="pw-conflict" aria-labelledby="pw-conflict-title">
      <div className="pw-conflict-head"><TriangleAlert size={18}/><div><h2 id="pw-conflict-title">Someone else changed this page</h2><p>{conflict.message} Nothing was overwritten. Choose which version to keep.</p></div></div>
      <div className="pw-conflict-grid">
        <div><h3>Their version <small>saved · revision {conflict.current.revision}</small></h3><Suspense fallback={<EditorFallback/>}><PageEditor key={`theirs-${conflict.current.revision}`} content={conflict.current.content} editable={false} label="Their version"/></Suspense></div>
        <div><h3>Your version <small>not saved</small></h3><Suspense fallback={<EditorFallback/>}><PageEditor key={`yours-${conflict.current.revision}`} content={conflict.yours.content} editable={false} label="Your version"/></Suspense></div>
      </div>
      {conflictNote && <div className={`wiki-notice ${conflictNote.copyId ? "wiki-notice-success" : ""}`} role="status">{conflictNote.text} {conflictNote.copyId && <button type="button" className="wiki-text-link" onClick={() => events.onOpen(conflictNote.copyId!)}>Open the copy</button>}</div>}
      <div className="pw-conflict-actions">
        <Button variant="outline" disabled={conflictBusy} onClick={keepTheirs}><RotateCcw size={14}/>Keep theirs</Button>
        <Button variant="outline" disabled={conflictBusy} onClick={() => void copyMine()}><Copy size={14}/>Copy mine to a new page</Button>
        <Button disabled={conflictBusy} onClick={() => void overwrite()}>{conflictBusy ? <LoaderCircle size={14} className="wiki-spinner"/> : <Upload size={14}/>}Overwrite with mine</Button>
      </div>
  </section>}
    <PageEditorBoundary key={editorKey} onRetry={() => setEditorKey(value => value + 1)}><Suspense fallback={<EditorFallback/>}><PageEditor content={editorContent} editable={canEdit && !conflict} label="Page content" outline onChange={changed} comments={{ api: collab, pageId: page.id, userId, isAdmin, canComment: page.role !== "viewer" && !conflict, prepare: prepareComment, onCreated: () => setPanelOpen(true) }} uploadFile={uploadFile}/></Suspense></PageEditorBoundary>
    <PageBacklinks api={collab} pageId={page.id} onOpen={events.onOpen}/>
  </div>{panelOpen && <PageCollaborationPanel api={collab} page={page} members={members} userId={userId} activeThreadId={initialThreadId} canRestore={canEdit && saveState === "saved" && !conflict} onClose={() => setPanelOpen(false)} onRestored={restoreRevision}/>}</div></main></>;
}

type ReviewInfo = NonNullable<PageDetail["review"]>;
function PageCollaborationPanel({ api, page, members, userId, activeThreadId, canRestore, onClose, onRestored }: { api: CollabApi; page: PageDetail; members: Member[]; userId: string; activeThreadId: string | null; canRestore: boolean; onClose: () => void; onRestored: (result: { revision: number; content: Block[] }) => void }) {
  const [tab, setTab] = useState<"comments" | "history" | "activity" | "details">("comments");
  const [threads, setThreads] = useState<Thread[]>([]), [revisions, setRevisions] = useState<RevisionRow[]>([]), [activity, setActivity] = useState<ActivityRow[]>([]);
  const [review, setReview] = useState<ReviewInfo | null>(page.review ?? null), [preview, setPreview] = useState<{ revision: number; content: Block[] } | null>(null);
  const [draft, setDraft] = useState(""), [replyId, setReplyId] = useState(""), [replyDraft, setReplyDraft] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const panelContent = useRef<HTMLDivElement>(null);
  const canEdit = page.role === "editor", canComment = page.role !== "viewer";
  const canReview = canReviewPage(page.role, members.find(member => member.userId === userId)?.role, (review?.ownerId ?? page.ownerId) === userId);
  async function refresh() {
    const [commentData, revisionData, activityData, reviewData] = await Promise.all([api.comments(page.id), api.revisions(page.id), api.activity(page.id), api.review(page.id)]);
    setThreads(commentData.threads); setRevisions(revisionData.revisions); setActivity(activityData.activity); setReview(reviewData.review);
  }
  useEffect(() => { let active = true; void refresh().catch(failure => { if (active) setError(message(failure)); }); return () => { active = false; }; }, [api, page.id]);
  useEffect(() => {
    const reload = () => { void refresh().catch(failure => setError(message(failure))); };
    window.addEventListener(commentsChanged, reload);
    return () => window.removeEventListener(commentsChanged, reload);
  }, [api, page.id]);
  useEffect(() => {
    if (!activeThreadId) return;
    const target = Array.from(panelContent.current?.querySelectorAll<HTMLElement>("[data-thread-id]") ?? []).find(element => element.dataset.threadId === activeThreadId);
    target?.scrollIntoView({ block: "nearest" });
  }, [activeThreadId, threads]);
  async function act(action: () => Promise<unknown>, success?: () => void) {
    setBusy(true); setError("");
    try { await action(); success?.(); await refresh(); window.dispatchEvent(new Event(commentsChanged)); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  async function submitComment(event: React.FormEvent<HTMLFormElement>, threadId?: string) {
    event.preventDefault(); const text = (threadId ? replyDraft : draft).trim(); if (!text) return;
    await act(() => threadId ? api.reply(page.id, threadId, text) : api.comment(page.id, text), () => { if (threadId) { setReplyDraft(""); setReplyId(""); } else setDraft(""); });
  }
  async function selectRevision(number: number) {
    setError(""); setPreview(null);
    try { const value = await api.revision(page.id, number); setPreview({ revision: value.revision.revision, content: value.revision.content }); }
    catch (failure) { setError(message(failure)); }
  }
  async function restoreSelected() {
    if (!preview) return;
    await act(async () => { const result = await api.restoreRevision(page.id, preview.revision); await onRestored(result); setPreview(null); });
  }
  async function saveReview(body: { ownerId?: string; reviewIntervalDays?: number | null }) {
    setBusy(true); setError("");
    try { const value = await api.updateReview(page.id, body); setReview(value.review); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <aside className="pw-page-panel" aria-label="Page discussion and history">
    <header className="pw-panel-header"><div><strong>Page details</strong><span>{page.title || "Untitled"}</span></div><Button variant="ghost" size="icon" aria-label="Close panel" onClick={onClose}><X size={16}/></Button></header>
    <div className="pw-panel-tabs" role="tablist" aria-label="Page panels">{([["comments", "Comments", MessageSquare], ["history", "History", History], ["activity", "Activity", Activity], ["details", "Review", Clock3]] as const).map(([key, label, Icon]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}><Icon size={14}/>{label}</button>)}</div>
    <div className="pw-panel-content" ref={panelContent}>
      {error && <div className="wiki-notice" role="alert">{error}</div>}
      {tab === "comments" && <>
        {canComment && <form className="pw-panel-form" onSubmit={event => void submitComment(event)}><label htmlFor="pw-comment">Add a comment</label><MentionTextarea api={api} pageId={page.id} value={draft} onChange={setDraft} label="Add a comment" placeholder="Write a comment… Use @ to mention a teammate." rows={3}/><Button size="sm" disabled={busy || !draft.trim()}>Comment</Button></form>}
        {!threads.length && <p className="pw-panel-empty">No comments yet.</p>}
        {threads.map(thread => <article className="pw-thread" data-thread-id={thread.id} key={thread.id}>
          <div className="pw-thread-heading"><strong>{thread.createdByName}</strong><time>{when(thread.createdAt)}</time></div>
          {thread.kind === "inline" && <div className={`pw-anchor-status ${thread.anchorStatus === "detached" ? "pw-anchor-detached" : ""}`}>{thread.anchorStatus === "detached" ? "Detached — text no longer appears on this page" : `On text: “${thread.anchor?.quote ?? ""}”`}</div>}
          {thread.messages.map(item => <div className="pw-comment-message" key={item.id}><div className="pw-thread-heading"><strong>{item.authorName}</strong><time>{when(item.createdAt)}</time></div><p>{item.deleted ? "Comment deleted" : item.body}</p>{item.mentions.length > 0 && <small>Mentions {item.mentions.map(person => person.name).join(", ")}</small>}</div>)}
          <div className="pw-thread-actions">{canComment && <button type="button" onClick={() => { setReplyId(replyId === thread.id ? "" : thread.id); setReplyDraft(""); }}>Reply</button>}{canComment && <button type="button" disabled={busy} onClick={() => void act(() => api.resolve(page.id, thread.id, !thread.resolved))}>{thread.resolved ? "Reopen" : "Resolve"}</button>}<span>{thread.resolved ? "Resolved" : "Open"}</span></div>
          {replyId === thread.id && <form className="pw-panel-form pw-reply-form" onSubmit={event => void submitComment(event, thread.id)}><MentionTextarea api={api} pageId={page.id} value={replyDraft} onChange={setReplyDraft} label="Reply" placeholder="Write a reply… Use @ to mention a teammate." rows={2}/><Button size="sm" disabled={busy || !replyDraft.trim()}>Reply</Button></form>}
        </article>)}
      </>}
      {tab === "history" && <>
        {preview && <section className="pw-revision-preview"><div><strong>Revision {preview.revision}</strong><Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Close preview</Button></div><Suspense fallback={<EditorFallback/>}><PageEditor key={`preview-${preview.revision}`} content={preview.content} editable={false} label={`Revision ${preview.revision} preview`}/></Suspense>{canEdit && <>{!canRestore && <small>Save or resolve your current changes before restoring a version.</small>}<Button size="sm" disabled={busy || !canRestore} onClick={() => void restoreSelected()}><RotateCcw size={14}/>Restore this version</Button></>}</section>}
        {!revisions.length && <p className="pw-panel-empty">No saved versions yet.</p>}
        <ul className="pw-panel-list">{revisions.map(row => <li key={row.revision}><div><strong>Revision {row.revision}</strong><small>{row.authorName} · {when(row.createdAt)}</small></div><Button variant="outline" size="sm" onClick={() => void selectRevision(row.revision)}>{preview?.revision === row.revision ? "Previewing" : "Preview"}</Button></li>)}</ul>
      </>}
      {tab === "activity" && <ul className="pw-activity-list">{activity.map(row => <li key={row.id}><span className="pw-activity-dot"/><div><strong>{row.actorName}</strong><p>{row.detail || row.action.replaceAll("_", " ")}{row.count > 1 && row.action === "edited" ? ` (${row.count} updates)` : ""}</p><time>{when(row.updatedAt)}</time></div></li>)}</ul>}
      {tab === "details" && <section className="pw-review-card"><PageTags api={api} pageId={page.id} editable={canEdit}/><h3>Page ownership</h3><p>Owner: <strong>{review?.ownerName ?? "Loading…"}</strong></p>
        {canEdit && <label className="pw-review-field">Change owner<Select value={review?.ownerId ?? page.ownerId} disabled={busy} onValueChange={ownerId => void saveReview({ ownerId })}><SelectTrigger aria-label="Page owner"><SelectValue/></SelectTrigger><SelectContent>{members.filter(member => member.status === "active").map(member => <SelectItem key={member.userId} value={member.userId}>{member.name}</SelectItem>)}</SelectContent></Select></label>}
        <h3>Review status</h3><p className={`pw-review-state pw-review-${review?.state ?? "unreviewed"}`}><CircleCheck size={15}/>{review?.state === "verified" ? "Verified" : review?.state === "stale" ? "Review overdue" : "Not reviewed yet"}</p>
        {review?.dueAt && <p className="pw-review-due">Due {new Date(review.dueAt).toLocaleDateString()}</p>}
        {canReview && <label className="pw-review-field">Review every<Select value={String(review?.reviewIntervalDays ?? "none")} disabled={busy} onValueChange={value => void saveReview({ reviewIntervalDays: value === "none" ? null : Number(value) })}><SelectTrigger aria-label="Review interval"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">No scheduled review</SelectItem><SelectItem value="30">Every 30 days</SelectItem><SelectItem value="90">Every 90 days</SelectItem><SelectItem value="180">Every 6 months</SelectItem><SelectItem value="365">Every year</SelectItem></SelectContent></Select></label>}
        {canReview && <Button size="sm" disabled={busy} onClick={() => void act(async () => { const value = await api.markReviewed(page.id); setReview(value.review); })}><Check size={14}/>Mark as reviewed</Button>}
        {review?.lastReviewedAt && <small>Last reviewed by {review.lastReviewedByName ?? "a teammate"} · {when(review.lastReviewedAt)}</small>}
      </section>}
    </div>
  </aside>;
}
