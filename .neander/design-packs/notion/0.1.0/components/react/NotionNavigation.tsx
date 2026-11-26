import * as React from 'react';
import { Home, FileText, FileAudio, Table2, MessageCircle, CalendarDays, Inbox, Gift, Plus, Building2, Library, SquareCheck, Shapes, CircleHelp, Trash2, SquarePen, Sparkles, Mic, MessageCirclePlus, UserRoundPlus, X } from './ui/icons';
import { NotionButton } from './NotionPrimitives';
import * as Menu from './ui/dropdown-menu';

export type NotionNavigationIcon = 'home' | 'chat' | 'calendar' | 'inbox' | 'trial' | 'teamspace' | 'library' | 'tasks' | 'resources' | 'help' | 'trash' | 'compose' | 'agent';
export type NotionNavigationItem = { id: string; label: string; icon: NotionNavigationIcon; badge?: string; notification?: boolean; notificationCount?: number; disabled?: boolean };
export type NotionMeetingNavigation = {
  calendarConnected: boolean;
  canConnectCalendar?: boolean;
  canCreate?: boolean;
  upcoming?: { id: string; label: string; time: string }[];
  groups: { label: string; items: { id: string; label: string }[] }[];
};
export type NotionNavigationModel = {
  activeId?: string;
  primaryActiveId?: string;
  inboxContent?: React.ReactNode;
  meetings?: NotionMeetingNavigation;
  privatePageIds?: string[];
  initialScrollTop?: number;
  agentShortcuts?: { id: string; label: string; imageUrl?: string }[];
  history?: { label: string; items: { id: string; label: string; time: string }[] }[];
  primary?: NotionNavigationItem[];
  trial?: { label: string; remaining: string };
  recentPageIds?: string[];
  favoritePageIds?: string[];
  agents?: { badge?: string; items: NotionNavigationItem[] };
  teamspaces?: NotionNavigationItem[];
  destinations?: NotionNavigationItem[];
  invitation?: { title: string; description: string };
  agentIconUrl?: string;
  chat?: { label: string; shortcut?: string };
};

const icons = { home: Home, chat: MessageCircle, calendar: CalendarDays, inbox: Inbox, trial: Gift, teamspace: Building2, library: Library, tasks: SquareCheck, resources: Shapes, help: CircleHelp, trash: Trash2, compose: SquarePen, agent: Sparkles };

/** Product marks stay pack-local; generic controls continue using the shared Lucide family. */
function NavigationGlyph({ icon }: { icon: NotionNavigationIcon }) {
  if (icon === 'teamspace') return <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" rx="3" fill="var(--notion-navigation-active)" /><path d="m3 9 7-6 7 6h-3v8h-3v-5H9v5H6V9Z" fill="currentColor" /></svg>;
  const Icon = icons[icon];
  return <Icon size={18} strokeWidth={1.7} />;
}

function MeetingNavigation({ model, activeId, onNavigate }: { model?: NotionMeetingNavigation; activeId?: string; onNavigate?: (id: string) => void }) {
  return <section aria-label="Meeting navigation" className="notion-meeting-navigation">
    {model?.calendarConnected ? <section className="notion-nav-section"><div className="notion-nav-heading">Upcoming events</div>
      {model.upcoming?.length ? model.upcoming.map(item => <NotionButton key={item.id} className="notion-nav-item notion-upcoming-meeting" disabled={!onNavigate} onClick={() => onNavigate?.(item.id)}><span className="notion-event-dot"/><span className="notion-truncate">{item.label}</span><small>{item.time}</small></NotionButton>) : <p className="notion-nav-empty">No upcoming events</p>}
    </section> : <div className="notion-meeting-connect"><CalendarDays size={26} strokeWidth={1.6}/><p>See upcoming events and<br/>auto-create meeting notes</p><NotionButton disabled={!onNavigate || !model?.canConnectCalendar} onClick={() => onNavigate?.('connect-calendar')}>Connect Calendar</NotionButton></div>}
    {model?.groups.map(group => <section className="notion-nav-section" key={group.label}><div className="notion-nav-heading">{group.label}</div>{group.items.map(item => <NotionButton key={item.id} className="notion-nav-item" aria-current={activeId === item.id ? 'page' : undefined} disabled={!onNavigate} onClick={() => onNavigate?.(item.id)}><FileAudio size={17}/><span className="notion-truncate">{item.label}</span></NotionButton>)}</section>)}
    {!model?.groups.some(group => group.items.length) && <p className="notion-nav-empty">No meeting notes yet</p>}
  </section>;
}

function ChatNavigation({ model, onNavigate }: { model?: NotionNavigationModel; onNavigate?: (id: string) => void }) {
  return <section aria-label="Chat navigation" className="notion-chat-navigation">
    {!!model?.agentShortcuts?.length && <section className="notion-nav-section"><div className="notion-nav-heading">Notion AI</div><div className="notion-agent-shortcuts">{model.agentShortcuts.map(item => <NotionButton key={item.id} aria-label={item.label} disabled={!onNavigate} onClick={() => onNavigate?.(item.id)}>{item.imageUrl ? <img src={item.imageUrl} alt=""/> : <Plus size={22}/>}<span>{item.label}</span></NotionButton>)}</div></section>}
    {model?.history?.map(group => <section className="notion-nav-section" key={group.label}><div className="notion-nav-heading">{group.label}</div>{group.items.map(item => <NotionButton key={item.id} className="notion-nav-item" aria-current={model.activeId === item.id ? 'page' : undefined} disabled={!onNavigate} onClick={() => onNavigate?.(item.id)}><MessageCircle size={18}/><span className="notion-truncate">{item.label}</span><small>{item.time}</small></NotionButton>)}</section>)}
    {!model?.history?.some(group => group.items.length) && <p className="notion-nav-empty">No chats yet</p>}
  </section>;
}

function NavigationItem({ item, activeId, onNavigate, compact = false }: { item: NotionNavigationItem; activeId?: string; onNavigate?: (id: string) => void; compact?: boolean }) {
  return <NotionButton className={`notion-nav-item ${compact ? 'notion-nav-compact' : ''}`} aria-label={item.label} aria-current={activeId === item.id ? 'page' : undefined} disabled={!onNavigate || item.disabled} onClick={() => onNavigate?.(item.id)}>
    <span className={`notion-nav-icon ${item.notification ? 'has-notification' : ''}`}><NavigationGlyph icon={item.icon} />{item.notificationCount && <span className="notion-nav-notification-count">{item.notificationCount}</span>}</span>
    {(!compact || activeId === item.id) && <span className="notion-truncate">{item.label}</span>}{item.badge && <span className="notion-nav-badge">{item.badge}</span>}
  </NotionButton>;
}

export function NotionNavigation({ model, workspace, closeControl, search, recents, favorites, pages, onNavigate, onStartChat, onCreatePage, onCreateDatabase, onCreateMeeting, creating, feedback, trash }: {
  model?: NotionNavigationModel; workspace: React.ReactNode; closeControl: React.ReactNode; search?: React.ReactNode;
  recents?: React.ReactNode; favorites?: React.ReactNode; pages: React.ReactNode; onNavigate?: (id: string) => void; onStartChat?: () => void;
  onCreatePage?: () => void; onCreateDatabase?: () => void; onCreateMeeting?: (mode:'recording'|'note')=>void; creating?:boolean; feedback?:React.ReactNode; trash?:React.ReactNode;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const composeRef=React.useRef<HTMLButtonElement>(null),creationIntent=React.useRef(false);
  React.useEffect(()=>{if(feedback&&!creating)composeRef.current?.focus();},[Boolean(feedback),creating]);
  const primaryActiveId = model?.primaryActiveId ?? (model?.primary?.some(item => item.id === model.activeId) ? model.activeId : 'home');
  const meetingsActive = primaryActiveId === 'meetings';
  React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = model?.initialScrollTop ?? 0; }, [primaryActiveId, model?.initialScrollTop]);
  const [inviteVisible, setInviteVisible] = React.useState(true);
  React.useEffect(() => {
    const shortcut = model?.chat?.shortcut;
    if (!onStartChat || !shortcut?.startsWith('⌘') || shortcut.length !== 2) return;
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && !event.repeat && event.key.toLowerCase() === shortcut[1].toLowerCase()) {
        event.preventDefault(); onStartChat();
      }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [model?.chat?.shortcut, onStartChat]);
  return <>
    <div className="notion-nav-workspace">{workspace}<span className="notion-nav-collapse">{closeControl}</span></div>
    <div className="notion-nav-primary">{model?.primary?.map((item) => <NavigationItem key={item.id} item={item} activeId={primaryActiveId} onNavigate={onNavigate} compact />)}{search && <span className="notion-nav-search">{search}</span>}</div>
    {model?.trial && <NotionButton className="notion-nav-item notion-nav-trial" disabled={!onNavigate} onClick={() => onNavigate?.('trial')}><Gift size={18} strokeWidth={1.7} /><span>{model.trial.label}</span><span className="notion-trial-remaining">{model.trial.remaining}</span></NotionButton>}
    <div className="notion-sidebar-scroll" ref={scrollRef}>{feedback}
      {primaryActiveId === 'inbox' ? model?.inboxContent ?? <section aria-label="Inbox"><p className="notion-nav-empty">No notifications to show</p></section> : primaryActiveId === 'chat' ? <ChatNavigation model={model} onNavigate={onNavigate}/> : meetingsActive ? <MeetingNavigation model={model?.meetings} activeId={model?.activeId} onNavigate={onNavigate}/> : <>
      {recents && <section className="notion-nav-section"><div className="notion-nav-heading">Recents</div>{recents}</section>}
      {favorites}
      {model?.agents && <section className="notion-nav-section"><div className="notion-nav-heading">Agents {model.agents.badge && <span className="notion-nav-badge">{model.agents.badge}</span>}</div>{model.agents.items.map((item) => <NotionButton key={item.id} className="notion-nav-item notion-nav-add" disabled={!onNavigate || item.disabled} onClick={() => onNavigate?.(item.id)}><Plus size={17} strokeWidth={1.6} />{item.label}</NotionButton>)}</section>}
      {pages}
      {!!model?.teamspaces?.length && <section className="notion-nav-section"><div className="notion-nav-heading">Teamspaces</div>{model.teamspaces.map((item) => <NavigationItem key={item.id} item={item} activeId={model.activeId} onNavigate={onNavigate} />)}<NotionButton className="notion-nav-item notion-nav-add" disabled={!onNavigate} onClick={() => onNavigate?.('teamspace-add')}><Plus size={17} strokeWidth={1.6} />Add new</NotionButton></section>}
      {!!model?.destinations?.length && <nav aria-label="Workspace tools" className="notion-nav-section notion-nav-tools">{model.destinations.map((item) => item.id==='trash'&&trash?<React.Fragment key={item.id}>{trash}</React.Fragment>:<NavigationItem key={item.id} item={item} activeId={model.activeId} onNavigate={onNavigate} />)}</nav>}
      </>}
    </div>
    {model?.invitation && inviteVisible && <div className="notion-nav-invitation"><NotionButton className="notion-invite-content" disabled={!onNavigate} onClick={() => onNavigate?.('invite-members')}><UserRoundPlus size={18} /><span><strong>{model.invitation.title}</strong><small>{model.invitation.description}</small></span></NotionButton><NotionButton className="notion-invite-dismiss" aria-label="Dismiss invite members" onClick={() => setInviteVisible(false)}><X size={13} /></NotionButton></div>}
    {model?.chat && <div className="notion-nav-bottom"><NotionButton variant="outline" className="notion-nav-chat" aria-label={meetingsActive ? 'New meeting' : model.chat.label} disabled={creating || (meetingsActive ? !onCreateMeeting || !model.meetings?.canCreate : !onStartChat)} onClick={meetingsActive ? () => onCreateMeeting?.('recording') : onStartChat}>{meetingsActive ? <Mic size={17}/> : model.agentIconUrl ? <img className="notion-nav-agent-icon" src={model.agentIconUrl} alt="" /> : <Sparkles size={17} strokeWidth={1.7} />}<span>{meetingsActive ? 'New meeting' : model.chat.label}</span>{!meetingsActive && model.chat.shortcut && <kbd>{model.chat.shortcut}</kbd>}</NotionButton>{meetingsActive&&<NotionButton variant="outline" className="notion-nav-compose" aria-label="New meeting note" disabled={creating||!onCreateMeeting||!model.meetings?.canCreate} onClick={()=>onCreateMeeting?.('note')}><MessageCirclePlus size={18}/></NotionButton>}<Menu.DropdownMenu><Menu.DropdownMenuTrigger asChild><NotionButton variant="outline" ref={composeRef} className="notion-nav-compose" aria-label="Create new" disabled={!onStartChat && !onCreatePage && !onCreateDatabase}><SquarePen size={18} strokeWidth={1.7} /></NotionButton></Menu.DropdownMenuTrigger><Menu.DropdownMenuContent onCloseAutoFocus={event=>{if(creationIntent.current){event.preventDefault();creationIntent.current=false;}}} className="notion-menu" side="top" align="end" sideOffset={8}>
      <Menu.DropdownMenuItem className="notion-menu-item" disabled={creating||!onCreatePage} onSelect={()=>{creationIntent.current=true;onCreatePage?.();}}><FileText size={17}/>Page</Menu.DropdownMenuItem>
      <Menu.DropdownMenuItem className="notion-menu-item" disabled={!onStartChat} onSelect={onStartChat}><MessageCircle size={17}/>Chat</Menu.DropdownMenuItem>
      <Menu.DropdownMenuSeparator className="notion-menu-separator"/>
      <Menu.DropdownMenuItem className="notion-menu-item" disabled={creating||!onCreateDatabase} onSelect={()=>{creationIntent.current=true;onCreateDatabase?.();}}><Table2 size={17}/>Database</Menu.DropdownMenuItem>
    </Menu.DropdownMenuContent></Menu.DropdownMenu></div>}
  </>;
}
