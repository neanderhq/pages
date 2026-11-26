import { Input } from './ui/input';
import * as React from 'react';
import * as Menu from './ui/dropdown-menu';
import { BarChart3, Bell, Clock3, Copy, Ellipsis, ExternalLink, FileText, Link2, LockKeyhole, MessageSquare, MoveRight, PanelLeftOpen, Search, Sparkles, Star, Trash2, Type, type LucideIcon } from "./ui/icons";
import { NotionButton, NotionIconGlyph } from './NotionPrimitives';
import type { NotionFrameworkActions, NotionPage } from './NotionFramework';

type Theme = 'light' | 'dark';
type Action = { label: string; Icon: LucideIcon; callback?: () => Promise<unknown> | unknown; shortcut?: string };

function isDescendant(pages: NotionPage[], candidateId: string, ancestorId: string) {
  let candidate = pages.find((page) => page.id === candidateId);
  const seen = new Set<string>();
  while (candidate?.parentId && !seen.has(candidate.id)) {
    if (candidate.parentId === ancestorId) return true;
    seen.add(candidate.id);
    candidate = pages.find((page) => page.id === candidate?.parentId);
  }
  return false;
}

export function NotionPageMenu({ page, pages, actions, theme, onRename }: {
  page: NotionPage; pages: NotionPage[]; actions: NotionFrameworkActions; theme: Theme; onRename: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [error, setError] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const destinations = pages.filter((target) => target.id !== page.id && !isDescendant(pages, target.id, page.id));
  async function run(callback?: () => Promise<unknown> | unknown) {
    if (!callback) return;
    setError('');
    try { const result = await callback(); if (result === false || result === null) throw new Error('Action rejected'); setOpen(false); }
    catch { setError('This action could not be completed. Try again.'); }
  }
  const core: Action[] = [
    { label: 'Copy link', Icon: Link2, callback: actions.onCopyPageLink && (() => actions.onCopyPageLink!(page.id)), shortcut: '⌘⌥L' },
    { label: 'Copy page contents', Icon: FileText, callback: actions.onCopyPageContents && (() => actions.onCopyPageContents!(page.id)) },
    { label: 'Duplicate', Icon: Copy, callback: actions.onDuplicatePage && (() => actions.onDuplicatePage!(page.id)), shortcut: '⌘D' },
    { label: 'Version history', Icon: Clock3, callback: actions.onOpenPageVersionHistory && (() => actions.onOpenPageVersionHistory!(page.id)) },
    { label: 'Updates & analytics', Icon: BarChart3, callback: actions.onOpenPageAnalytics && (() => actions.onOpenPageAnalytics!(page.id)) },
  ];
  const more: Action[] = [
    { label: page.favorite ? 'Remove from Favorites' : 'Add to Favorites', Icon: Star, callback: actions.onToggleFavorite && (() => actions.onToggleFavorite!(page.id, !page.favorite)) },
    { label: 'Rename', Icon: FileText, callback: !page.locked && actions.onUpdatePage ? (() => onRename(page.id)) : undefined },
    { label: 'Open in new tab', Icon: ExternalLink, callback: actions.onOpenPageInNewTab && (() => actions.onOpenPageInNewTab!(page.id)) },
    { label: 'Open in side peek', Icon: PanelLeftOpen, callback: actions.onOpenPageInSidePeek && (() => actions.onOpenPageInSidePeek!(page.id)) },
  ];
  const trash: Action = { label: 'Move to Trash', Icon: Trash2, callback: actions.onTrashPage && (() => actions.onTrashPage!(page.id)) };
  function item(action: Action) {
    return <Menu.DropdownMenuItem key={action.label} className="notion-menu-item notion-page-menu-item" disabled={!action.callback} onSelect={(event) => { event.preventDefault(); void run(action.callback); }}><action.Icon size={17} aria-hidden="true" /><span className="notion-page-menu-label">{action.label}</span>{action.shortcut && <span className="notion-page-menu-shortcut" aria-hidden="true">{action.shortcut}</span>}</Menu.DropdownMenuItem>;
  }
  function submenu(label: string, Icon: LucideIcon, content: React.ReactNode, disabled = false) {
    return <Menu.DropdownMenuSub key={label}><Menu.DropdownMenuSubTrigger className="notion-menu-item notion-page-menu-item" disabled={disabled}><Icon size={17} /><span className="notion-page-menu-label">{label}</span></Menu.DropdownMenuSubTrigger><Menu.DropdownMenuSubContent data-ui-pack="notion" className={`notion-menu notion-page-submenu notion-${theme}`} sideOffset={4}>{content}</Menu.DropdownMenuSubContent></Menu.DropdownMenuSub>;
  }
  const appearance = submenu('Appearance & layout', Type, <>{(['default', 'serif', 'mono'] as const).map((value) => <Menu.DropdownMenuItem key={value} className="notion-menu-item notion-page-menu-item" disabled={!actions.onSetPageAppearance} onSelect={(event) => { event.preventDefault(); void run(() => actions.onSetPageAppearance?.(page.id, value)); }}>{value === page.appearance || (!page.appearance && value === 'default') ? '✓' : '　'} {value === 'default' ? 'Default' : value === 'serif' ? 'Serif' : 'Mono'}</Menu.DropdownMenuItem>)}</>, !actions.onSetPageAppearance);
  const ai = submenu('Use with AI', Sparkles, <>{(['summarize', 'improve'] as const).map((value) => <Menu.DropdownMenuItem key={value} className="notion-menu-item notion-page-menu-item" onSelect={(event) => { event.preventDefault(); void run(() => actions.onUsePageWithAI?.(page.id, value)); }}>{value === 'summarize' ? 'Summarize page' : 'Improve writing'}</Menu.DropdownMenuItem>)}</>, !actions.onUsePageWithAI);
  const notify = submenu('Notify me', Bell, <>{(['all', 'comments', 'off'] as const).map((value) => <Menu.DropdownMenuItem key={value} className="notion-menu-item notion-page-menu-item" disabled={!actions.onSetPageNotification} onSelect={(event) => { event.preventDefault(); void run(() => actions.onSetPageNotification?.(page.id, value)); }}>{page.notification === value ? '✓' : '　'} {value === 'all' ? 'All updates' : value === 'comments' ? 'Comments' : 'Off'}</Menu.DropdownMenuItem>)}</>, !actions.onSetPageNotification);
  const move = submenu('Move to', MoveRight, destinations.map((target) => <Menu.DropdownMenuItem key={target.id} className="notion-menu-item notion-page-menu-item" onSelect={(event) => { event.preventDefault(); void run(() => actions.onMovePage?.(page.id, target.id, 'inside')); }}><NotionIconGlyph icon={target.icon} size={16} />{target.title || 'Untitled'}</Menu.DropdownMenuItem>), !actions.onMovePage || destinations.length === 0);
  const moreMenu = submenu('More', Ellipsis, more.map(item), more.every((action) => !action.callback));
  const searchActions: Action[] = [...core, ...more, trash, { label: 'Suggest edits', Icon: MessageSquare, callback: actions.onSuggestPageEdits && (() => actions.onSuggestPageEdits!(page.id)) }, { label: page.locked ? 'Unlock page' : 'Lock page', Icon: LockKeyhole, callback: actions.onSetPageLocked && (() => actions.onSetPageLocked!(page.id, !page.locked)) }];
  const searchTerm = query.trim().toLowerCase();
  const matches = searchActions.filter((action) => action.label.toLowerCase().includes(searchTerm));
  const matchingSubmenus = [
    { label: 'move to', node: move },
    { label: 'appearance & layout', node: appearance },
    { label: 'use with ai', node: ai },
    { label: 'notify me', node: notify },
    { label: 'more', node: moreMenu },
  ].filter((entry) => entry.label.includes(searchTerm));
  return <Menu.DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (next) window.requestAnimationFrame(() => inputRef.current?.focus()); else { setQuery(''); setError(''); } }}>
    <Menu.DropdownMenuTrigger asChild><NotionButton className="notion-icon-action notion-page-menu-trigger" aria-label="More page actions" title="More page actions"><Ellipsis size={17} /></NotionButton></Menu.DropdownMenuTrigger>
    <Menu.DropdownMenuContent data-ui-pack="notion" className={`notion-menu notion-page-menu notion-${theme}`} sideOffset={5} align="end" collisionPadding={8}>
      <div className="notion-page-menu-search"><Search size={16} /><Input variant="embedded" ref={inputRef} aria-label="Search actions" placeholder="Search actions..." value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation(); }} /></div>
      {searchTerm ? <div className="notion-page-menu-results">{matches.map(item)}{matchingSubmenus.map((entry) => entry.node)}{matches.length === 0 && matchingSubmenus.length === 0 && <div className="notion-page-menu-empty">No actions found</div>}</div> : <>
        {core.slice(0, 3).map(item)}{move}{core.slice(3).map(item)}
        <Menu.DropdownMenuSeparator className="notion-menu-separator" />{appearance}<Menu.DropdownMenuSeparator className="notion-menu-separator" />{ai}<Menu.DropdownMenuSeparator className="notion-menu-separator" />
        {item({ label: 'Suggest edits', Icon: MessageSquare, callback: actions.onSuggestPageEdits && (() => actions.onSuggestPageEdits!(page.id)) })}
        {notify}<Menu.DropdownMenuSeparator className="notion-menu-separator" />
        <Menu.DropdownMenuCheckboxItem className="notion-menu-item notion-page-menu-item" checked={Boolean(page.locked)} disabled={!actions.onSetPageLocked} onSelect={(event) => { event.preventDefault(); void run(() => actions.onSetPageLocked?.(page.id, !page.locked)); }}><LockKeyhole size={17} /><span className="notion-page-menu-label">Lock page</span><span className={`notion-page-menu-switch ${page.locked ? 'is-on' : ''}`} aria-hidden="true" /></Menu.DropdownMenuCheckboxItem>
        {item(trash)}<Menu.DropdownMenuSeparator className="notion-menu-separator" />{moreMenu}<Menu.DropdownMenuSeparator className="notion-menu-separator" />
        <div className="notion-page-menu-footer"><span>Last edited</span><small><span className="notion-page-menu-avatar">{(page.lastEditedBy || 'User').split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase()}</span>{page.lastEditedBy || 'Unknown'}</small><small>{page.lastEditedAt || page.lastEditedLabel || 'Recently'}</small></div>
      </>}
      {error && <div className="notion-menu-error" role="alert">{error}</div>}
    </Menu.DropdownMenuContent>
  </Menu.DropdownMenu>;
}
