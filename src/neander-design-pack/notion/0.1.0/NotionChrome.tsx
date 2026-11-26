import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { NotionTrash } from './NotionTrash';
import { NotionNavigation } from './NotionNavigation';
import { NotionSortList, NotionSortItem, type NotionDropPlacement } from './NotionSortable';
import * as React from 'react';
import * as Menu from './ui/dropdown-menu';
import { ChevronDown, ChevronRight, Copy, Ellipsis, ExternalLink, FileText, Link2, LockKeyhole, PanelLeftClose, PanelLeftOpen, Plus, Star, Trash2, Settings2, MessageSquare } from "./ui/icons";
import { NotionButton, NotionIconGlyph, NotionSearch } from './NotionPrimitives';
import { NotionSharePopover } from './NotionShare';
import { NotionPageMenu } from './NotionPageMenu';
import type { NotionFrameworkActions, NotionFrameworkModel, NotionPage } from './NotionFramework';

type Theme = 'light' | 'dark';
type SelectPage = (id: string) => void;
type CreatePage = (parentId?: string) => Promise<void>;

function hasPageMenuActions(actions: NotionFrameworkActions) {
  return Boolean(actions.onToggleFavorite || actions.onCopyPageLink || actions.onDuplicatePage || actions.onUpdatePage || actions.onMovePage || actions.onTrashPage || actions.onOpenPageInNewTab || actions.onOpenPageInSidePeek);
}

function PageIcon({ page }: { page: NotionPage }) {
  return <span className="notion-page-icon" aria-hidden="true"><NotionIconGlyph icon={page.icon} size={16} /></span>;
}

function PageMenu({ page, pages, actions, theme, onRename, label }: {
  page: NotionPage; pages: NotionPage[]; actions: NotionFrameworkActions; theme: Theme;
  onRename: (id: string) => void; label: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState('');
  const destinations = pages.filter((target) => target.id !== page.id && !isDescendant(pages, target.id, page.id));
  async function run(action: () => Promise<unknown> | unknown) {
    setError('');
    try {
      const result = await action();
      if (result === false || result === null) throw new Error('This action could not be completed.');
      setOpen(false);
    } catch { setError('This action could not be completed. Try again.'); }
  }
  return <Menu.DropdownMenu open={open} onOpenChange={(value) => { setOpen(value); if (!value) setError(''); }}>
    <Menu.DropdownMenuTrigger asChild><NotionButton className="notion-icon-action" aria-label={label} title={label}><Ellipsis size={17} /></NotionButton></Menu.DropdownMenuTrigger>
    <Menu.DropdownMenuContent data-ui-pack="notion" className={`notion-menu notion-${theme}`} sideOffset={4} align="end">
      <div className="notion-menu-caption">Page</div>
      {actions.onToggleFavorite && <Menu.DropdownMenuItem className="notion-menu-item" onSelect={(event) => { event.preventDefault(); void run(() => actions.onToggleFavorite!(page.id, !page.favorite)); }}><Star size={16} />{page.favorite ? 'Remove from Favorites' : 'Add to Favorites'}</Menu.DropdownMenuItem>}
      {actions.onCopyPageLink && <Menu.DropdownMenuItem className="notion-menu-item" onSelect={(event) => { event.preventDefault(); void run(() => actions.onCopyPageLink!(page.id)); }}><Link2 size={16} />Copy link</Menu.DropdownMenuItem>}
      {actions.onDuplicatePage && <Menu.DropdownMenuItem className="notion-menu-item" onSelect={(event) => { event.preventDefault(); void run(() => actions.onDuplicatePage!(page.id)); }}><Copy size={16} />Duplicate</Menu.DropdownMenuItem>}
      {actions.onUpdatePage && <Menu.DropdownMenuItem className="notion-menu-item" onSelect={() => onRename(page.id)}><FileText size={16} />Rename</Menu.DropdownMenuItem>}
      {actions.onMovePage && destinations.length > 0 && <Menu.DropdownMenuSub>
        <Menu.DropdownMenuSubTrigger className="notion-menu-item"><ChevronRight size={16} />Move to </Menu.DropdownMenuSubTrigger>
        <Menu.DropdownMenuSubContent data-ui-pack="notion" className={`notion-menu notion-${theme}`} sideOffset={4}>{destinations.map((target) => <Menu.DropdownMenuItem key={target.id} className="notion-menu-item" onSelect={(event) => { event.preventDefault(); void run(() => actions.onMovePage!(page.id, target.id, 'inside')); }}><PageIcon page={target} />{target.title || 'Untitled'}</Menu.DropdownMenuItem>)}</Menu.DropdownMenuSubContent>
      </Menu.DropdownMenuSub>}
      {actions.onTrashPage && <Menu.DropdownMenuItem className="notion-menu-item" onSelect={(event) => { event.preventDefault(); void run(() => actions.onTrashPage!(page.id)); }}><Trash2 size={16} />Move to Trash</Menu.DropdownMenuItem>}
      {(actions.onOpenPageInNewTab || actions.onOpenPageInSidePeek) && <Menu.DropdownMenuSeparator className="notion-menu-separator" />}
      {actions.onOpenPageInNewTab && <Menu.DropdownMenuItem className="notion-menu-item" onSelect={() => actions.onOpenPageInNewTab!(page.id)}><ExternalLink size={16} />Open in new tab</Menu.DropdownMenuItem>}
      {actions.onOpenPageInSidePeek && <Menu.DropdownMenuItem className="notion-menu-item" onSelect={() => actions.onOpenPageInSidePeek!(page.id)}><PanelLeftOpen size={16} />Open in side peek</Menu.DropdownMenuItem>}
      {error && <div className="notion-menu-error" role="alert">{error}</div>}
    </Menu.DropdownMenuContent>
  </Menu.DropdownMenu>;
}

function isDescendant(pages: NotionPage[], candidateId: string, ancestorId: string): boolean {
  let candidate = pages.find((page) => page.id === candidateId);
  const visited = new Set<string>();
  while (candidate?.parentId && !visited.has(candidate.id)) {
    if (candidate.parentId === ancestorId) return true;
    visited.add(candidate.id);
    candidate = pages.find((page) => page.id === candidate?.parentId);
  }
  return false;
}

function WorkspaceMenu({ model, actions, theme, children }: { model: NotionFrameworkModel; actions: NotionFrameworkActions; theme: Theme; children: React.ReactNode }) {
  const workspaces = model.workspaces ?? [{ id: model.workspaceId ?? model.workspaceName, name: model.workspaceName }];
  return <Menu.DropdownMenu><Menu.DropdownMenuTrigger asChild>{children}</Menu.DropdownMenuTrigger><Menu.DropdownMenuContent data-ui-pack="notion" className={`notion-menu notion-${theme}`} sideOffset={4} align="start">
    <div className="notion-workspace-profile"><Avatar><AvatarImage src={model.user?.avatarUrl}/><AvatarFallback>{model.user?.name.slice(0,1)||'W'}</AvatarFallback></Avatar><div><strong>{model.user?.name||'Workspaces'}</strong><small>Workspaces</small></div></div>
    {actions.onNavigate&&<><Menu.DropdownMenuItem onSelect={()=>actions.onNavigate!('settings')}><Settings2 size={15}/>Settings</Menu.DropdownMenuItem><Menu.DropdownMenuItem onSelect={()=>actions.onNavigate!('invite-members')}>Invite members</Menu.DropdownMenuItem><Menu.DropdownMenuSeparator/></>}
    {workspaces.map((workspace) => <Menu.DropdownMenuItem key={workspace.id} className="notion-menu-item" disabled={!actions.onSwitchWorkspace} onSelect={() => actions.onSwitchWorkspace?.(workspace.id)}><span className="notion-workspace-avatar">{workspace.icon || workspace.name.slice(0, 1).toUpperCase()}</span>{workspace.name}{workspace.id === model.workspaceId && <span className="notion-menu-trailing">Current</span>}</Menu.DropdownMenuItem>)}
  </Menu.DropdownMenuContent></Menu.DropdownMenu>;
}

function PageTree({ model, actions, rootIds, favorites = false, collapsed, setCollapsed, onSelectPage, onCreatePage, onRename, onMoveFailure, creating }: {
  model: NotionFrameworkModel; actions: NotionFrameworkActions; rootIds: string[]; favorites?: boolean;
  collapsed: Record<string, boolean>; setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSelectPage: SelectPage; onCreatePage: CreatePage; onRename: (id: string) => void; onMoveFailure: () => void; creating: boolean;
}) {
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const rows: { page: NotionPage; depth: number }[] = [];
  function children(page: NotionPage) {
    return model.pages.filter((item) => item.parentId === page.id && !page.database?.views.some((view) => view.rows.some((row) => row.id === item.id)));
  }
  function append(id: string, depth: number, ancestors: string[]) {
    const page = model.pages.find((item) => item.id === id);
    if (!page || ancestors.includes(id) || depth > 16) return;
    rows.push({ page, depth });
    if (!favorites && !collapsed[id] && draggingId !== id) children(page).forEach((child) => append(child.id, depth + 1, [...ancestors, id]));
  }
  rootIds.forEach((id) => append(id, 0, []));
  const enabled = Boolean(favorites ? actions.onMoveFavorite : actions.onMovePage);
  async function move(id: string, target: string, placement: NotionDropPlacement) {
    if (id === target || (!favorites && isDescendant(model.pages, target, id))) return;
    try {
      const accepted = favorites ? await actions.onMoveFavorite?.(id, target, placement === 'before' ? 'before' : 'after') : await actions.onMovePage?.(id, target, placement);
      if (!accepted) onMoveFailure();
    } catch { onMoveFailure(); }
  }
  return <NotionSortList ids={rows.map(({ page }) => page.id)} label={favorites ? 'Favorite pages' : 'Pages'} disabled={!enabled} allowNesting={!favorites} onActiveChange={setDraggingId} onDrop={(id, target, placement) => void move(id, target, placement)}
    preview={(id) => { const page = model.pages.find((item) => item.id === id); return <div className="notion-drag-page-preview">{page && <PageIcon page={page} />}<span>{page?.title || 'Untitled'}</span></div>; }}>
    {rows.map(({ page, depth }) => <NotionSortItem key={page.id} id={page.id} disabled={!enabled}>{({ attributes, listeners, setActivatorNodeRef }) => {
      const hasChildren = !favorites && children(page).length > 0;
      return <div className="notion-page-row" style={{ paddingInlineStart: `${depth * 16}px` }}>
        {hasChildren ? <NotionButton className="notion-tree-toggle" aria-label={`${collapsed[page.id] ? 'Expand' : 'Collapse'} ${page.title}`} aria-expanded={!collapsed[page.id]} onClick={() => setCollapsed((current) => ({ ...current, [page.id]: !current[page.id] }))}>{collapsed[page.id] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</NotionButton> : <span className="notion-tree-spacer" />}
        <NotionButton ref={setActivatorNodeRef} {...attributes} {...listeners} className="notion-page-link" aria-disabled={!actions.onSelectPage || undefined} aria-roledescription={enabled ? 'sortable' : undefined} aria-label={page.title || 'Untitled'} aria-current={model.selectedPageId === page.id ? 'page' : undefined} disabled={!actions.onSelectPage} onClick={() => onSelectPage(page.id)}><PageIcon page={page} /><span className="notion-truncate">{page.title || 'Untitled'}</span>{page.badgeLabel && <span className="notion-nav-badge">{page.badgeLabel}</span>}</NotionButton>
        <span className="notion-row-actions">{actions.onCreatePage && <NotionButton className="notion-icon-action" aria-label={`Add subpage to ${page.title || 'Untitled'}`} title="Add subpage" disabled={creating} onClick={() => void onCreatePage(page.id)}><Plus size={16} /></NotionButton>}{hasPageMenuActions(actions) && <PageMenu page={page} pages={model.pages} actions={actions} theme={model.theme ?? 'light'} onRename={onRename} label={`More actions for ${page.title || 'Untitled'}`} />}</span>
      </div>;
    }}</NotionSortItem>)}
  </NotionSortList>;
}

export function NotionSidebar({ model, actions, open, onClose, onSelectPage, onCreatePage, onCreateDatabase, onCreateMeeting, onRename, creating, createError }: {
  model: NotionFrameworkModel; actions: NotionFrameworkActions; open: boolean; onClose: () => void;
  onSelectPage: SelectPage; onCreatePage: CreatePage; onCreateDatabase?: () => void; onCreateMeeting?: (mode:'recording'|'note')=>void; onRename: (id: string) => void; creating: boolean; createError: boolean;
}) {
  const sidebarRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => { if (sidebarRef.current) sidebarRef.current.inert = !open; }, [open]);
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [favoritesOpen, setFavoritesOpen] = React.useState(true);
  const [privateOpen, setPrivateOpen] = React.useState(true);
  const [moveError, setMoveError] = React.useState(false);
  const theme = model.theme ?? 'light';
  const favoritePages = model.pages.filter((page) => page.favorite);
  const roots = model.navigation?.privatePageIds ? model.navigation.privatePageIds.flatMap((id) => model.pages.find((page) => page.id === id) ?? []) : model.pages.filter((page) => !page.parentId || !model.pages.some((parent) => parent.id === page.parentId));
  const favoriteIds = model.navigation?.favoritePageIds ?? favoritePages.map((page) => page.id);
  const treeProps = { model, actions, collapsed, setCollapsed, onSelectPage, onCreatePage, onRename, onMoveFailure: () => setMoveError(true), creating };
  const recent = model.navigation?.recentPageIds?.filter((id) => model.pages.some((page) => page.id === id));
  return <aside ref={sidebarRef} className={`notion-sidebar ${open ? 'is-open' : ''}`} aria-label="Workspace sidebar" aria-hidden={!open}>
    <NotionNavigation trash={model.trash?<NotionTrash pages={model.trash.pages} currentPageId={model.selectedPageId} userName={model.user?.name} onRestore={actions.onRestorePage}/>:undefined} model={model.navigation} onNavigate={actions.onNavigate} onStartChat={actions.onStartChat} onCreatePage={actions.onCreatePage ? () => void onCreatePage() : undefined} onCreateDatabase={onCreateDatabase} onCreateMeeting={onCreateMeeting} creating={creating} feedback={createError?<div className="notion-sidebar-error" role="alert">Could not create the page. Try again.</div>:undefined}
      workspace={<WorkspaceMenu model={model} actions={actions} theme={theme}><NotionButton className="notion-workspace-switcher" aria-label={`Switch workspace, current: ${model.workspaceName}`}><span className="notion-workspace-avatar">{model.workspaces?.find((item) => item.id === model.workspaceId)?.icon || '💼'}</span><strong className="notion-truncate">{model.workspaceName}</strong><ChevronDown className="notion-workspace-chevron" size={13} /></NotionButton></WorkspaceMenu>}
      closeControl={<NotionButton className="notion-icon-action" aria-label="Close sidebar" onClick={onClose}><PanelLeftClose size={17} /></NotionButton>}
      search={actions.onSelectPage ? <NotionSearch theme={theme} pages={model.pages} onSelect={onSelectPage} /> : undefined}
      recents={recent?.length ? <nav aria-label="Recent pages">{recent.map((id) => { const page = model.pages.find((item) => item.id === id)!; return <NotionButton key={id} className="notion-nav-item notion-recent-page" aria-current={model.selectedPageId === id ? 'page' : undefined} aria-label={`Recent: ${page.title||'Untitled'}`} disabled={!actions.onSelectPage} onClick={() => onSelectPage(id)}><PageIcon page={page} /><span className="notion-truncate">{page.title||'Untitled'}</span>{page.badgeLabel && <span className="notion-nav-badge">{page.badgeLabel}</span>}</NotionButton>; })}</nav> : undefined}
      favorites={<>
        {favoriteIds.length > 0 && <section className="notion-nav-section"><div className="notion-nav-heading"><NotionButton className="notion-section-toggle" aria-label={`${favoritesOpen ? 'Collapse' : 'Expand'} Favorites section`} aria-expanded={favoritesOpen} onClick={() => setFavoritesOpen((value) => !value)}>Favorites</NotionButton></div>{favoritesOpen && <nav aria-label="Favorites"><PageTree rootIds={favoriteIds} favorites {...treeProps} /></nav>}</section>}
      </>}
      pages={<>
        <section className="notion-nav-section"><div className="notion-nav-heading"><NotionButton className="notion-section-toggle" aria-label={`${privateOpen ? 'Collapse' : 'Expand'} Private section`} aria-expanded={privateOpen} onClick={() => setPrivateOpen((value) => !value)}>Private</NotionButton></div>
          {moveError && <div className="notion-sidebar-error" role="alert">Could not move the page. Try again.</div>}
          {privateOpen && <><nav aria-label="Pages"><PageTree rootIds={roots.map((page) => page.id)} {...treeProps} /></nav>{actions.onCreatePage && <NotionButton className="notion-nav-item notion-nav-add" aria-label="New page" disabled={creating} onClick={() => void onCreatePage()}><Plus size={17} strokeWidth={1.6} />Add new</NotionButton>}</>}
        </section>
      </>} />
  </aside>;
}

export function NotionPageChrome({ model, page, actions, sidebarOpen, onOpenSidebar, onRename, saveState, leading }: {
  model: NotionFrameworkModel; page?: NotionPage; actions: NotionFrameworkActions; sidebarOpen: boolean;
  onOpenSidebar: () => void; onRename: (id: string) => void; saveState: 'saved' | 'edited' | 'saving' | 'failed'; leading?: React.ReactNode;
}) {
  const [error, setError] = React.useState('');
  const ancestors: NotionPage[] = [];
  let current = page;
  while (current?.parentId && ancestors.length < 8) {
    const parent = model.pages.find((item) => item.id === current?.parentId);
    if (!parent || ancestors.some((item) => item.id === parent.id)) break;
    ancestors.unshift(parent); current = parent;
  }
  async function run(action: () => Promise<boolean>) {
    setError('');
    try { if (!await action()) throw new Error('Action failed'); }
    catch { setError('Could not update this page. Try again.'); }
  }
  return <header className="notion-topbar">
    <div className="notion-topbar-start">{leading ?? <>{!sidebarOpen && <NotionButton className="notion-icon-action" aria-label="Open sidebar" onClick={onOpenSidebar}><PanelLeftOpen size={17} /></NotionButton>}
      <div className="notion-breadcrumbs">{[...ancestors, ...(page ? [page] : [])].map((item, index, all) => <React.Fragment key={item.id}>{index > 0 && <span className="notion-breadcrumb-separator">/</span>}<NotionButton className="notion-breadcrumb" disabled={!actions.onSelectPage || index === all.length - 1} onClick={() => actions.onSelectPage?.(item.id)}><PageIcon page={item} /><span className="notion-truncate">{item.title || 'Untitled'}</span></NotionButton></React.Fragment>)}{!page && <span>{model.workspaceName}</span>}</div>{page?.accessLabel && <NotionButton className="notion-page-access" disabled={!actions.onSharePage} onClick={() => actions.onSharePage?.(page.id)}><LockKeyhole size={13} />{page.accessLabel}<ChevronDown size={12} /></NotionButton>}</>}
    </div>
    {page && <div className="notion-topbar-actions">
      {error && <span className="notion-topbar-error" role="alert">{error}</span>}
      <span className="notion-edit-status" role={saveState === 'failed' ? 'alert' : 'status'}>{saveState === 'saving' ? 'Saving…' : saveState === 'edited' ? 'Editing…' : saveState === 'failed' ? 'Save failed' : page.lastEditedLabel || ''}</span>
      {actions.onOpenPageComments&&<NotionButton className="notion-icon-action" aria-label="Open comments" onClick={()=>actions.onOpenPageComments!(page.id)}><MessageSquare size={17}/></NotionButton>}
      {actions.onSharePage && <NotionSharePopover key={page.id} page={page} share={model.shareDialog?.pageId === page.id ? model.shareDialog : null} theme={model.theme ?? 'light'} actions={actions} />}
      {page.showLinkAction && actions.onCopyPageLink && <NotionButton className="notion-icon-action" aria-label="Copy page link" title="Copy link" onClick={() => void run(() => actions.onCopyPageLink!(page.id))}><Link2 size={17} /></NotionButton>}
      {actions.onToggleFavorite && <NotionButton className="notion-icon-action" aria-label={page.favorite ? 'Remove from Favorites' : 'Add to Favorites'} title={page.favorite ? 'Remove from Favorites' : 'Add to Favorites'} onClick={() => void run(() => actions.onToggleFavorite!(page.id, !page.favorite))}><Star size={17} fill={page.favorite ? 'currentColor' : 'none'} /></NotionButton>}
      {hasPageMenuActions(actions) && <NotionPageMenu page={page} pages={model.pages} actions={actions} theme={model.theme ?? 'light'} onRename={onRename} />}
    </div>}
  </header>;
}
