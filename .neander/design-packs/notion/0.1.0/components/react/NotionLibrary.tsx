import { useNotionNavigationGuard } from './NotionNavigationGuard';
import * as React from 'react';
import { Building2, Clock, Star, Users, LockKeyhole, FileAudio, Bot, Search, ListFilter, SlidersHorizontal, FileText, Table2, ChevronRight, MessageSquare } from './ui/icons';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from './ui/table';
import { Input } from './ui/input';
import { Checkbox } from './ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import * as Popover from './ui/popover';
import * as Menu from './ui/dropdown-menu';
import { NotionButton, NotionIconGlyph } from './NotionPrimitives';

export type NotionLibraryTab = 'teamspaces' | 'recents' | 'favorites' | 'shared' | 'private' | 'meetings' | 'agents';
export type NotionLibraryEntry = { id: string; title: string; icon?: string; creator: string; avatarUrl?: string; source: string; sourceKind?: 'private' | 'database' | 'teamspace'; edited: string; visited: string; favorite?: boolean; shared?: boolean; groupLabel?: string; kind?: 'page' | 'meeting' | 'agent'; expandable?: boolean; commentCount?: number };
const tabs = [{ id: 'teamspaces', label: 'Teamspaces', Icon: Building2 }, { id: 'recents', label: 'Recents', Icon: Clock }, { id: 'favorites', label: 'Favorites', Icon: Star }, { id: 'shared', label: 'Shared', Icon: Users }, { id: 'private', label: 'Private', Icon: LockKeyhole }, { id: 'meetings', label: 'AI Meeting Notes', Icon: FileAudio }, { id: 'agents', label: 'Agents', Icon: Bot }] as const;
const properties=[{id:'creator',label:'Created by'},{id:'source',label:'Source'},{id:'edited',label:'Last edited time'},{id:'visited',label:'Last visited time'}] as const;

/** Host-owned records and semantic creation, with local presentation filters and view preferences. */
export function NotionLibrary({ entries, onOpen, onCreate, initialTab='recents' }: { entries: NotionLibraryEntry[]; onOpen?: (id: string) => void; onCreate?: (kind?:'page'|'meeting'|'agent') => void; initialTab?:NotionLibraryTab }) {
  const guard=useNotionNavigationGuard();
  const [tab,setTab]=React.useState<NotionLibraryTab>(initialTab),[searchOpen,setSearchOpen]=React.useState(false),[query,setQuery]=React.useState('');
  const [sort,setSort]=React.useState<'default'|'asc'|'desc'>('default');
  const [hidden,setHidden]=React.useState<string[]>([]);
  const visible=entries.filter(entry=>entry.title.toLowerCase().includes(query.toLowerCase())&&(tab==='favorites'?entry.favorite:tab==='private'?entry.sourceKind==='private':tab==='teamspaces'?entry.sourceKind==='teamspace':tab==='shared'?entry.shared:tab==='meetings'?entry.kind==='meeting':tab==='agents'?entry.kind==='agent':true));
  if(sort!=='default')visible.sort((a,b)=>a.title.localeCompare(b.title)*(sort==='asc'?1:-1));
  const list=tab==='meetings'||tab==='agents';
  const groups=[...new Set(visible.map(entry=>entry.groupLabel??'Pages'))];
  function pageLink(entry:NotionLibraryEntry){return <NotionButton className="notion-library-page" disabled={!onOpen} onClick={()=>void guard(()=>onOpen?.(entry.id))}>{entry.expandable&&<ChevronRight size={12}/>}<NotionIconGlyph icon={entry.icon} size={17}/><span>{entry.title||'New page'}</span>{entry.commentCount&&<small><MessageSquare size={12}/> {entry.commentCount}</small>}</NotionButton>;}
  return <section className="notion-library notion-wide-surface" aria-label="Library"><Tabs value={tab} onValueChange={value=>setTab(value as NotionLibraryTab)}>
    <div className="notion-surface-heading"><h1>Library</h1><NotionButton variant="default" disabled={!onCreate} onClick={()=>void guard(()=>onCreate?.(tab==='meetings'?'meeting':tab==='agents'?'agent':'page'))}>{tab==='meetings'?'New AI meeting note':tab==='agents'?'New agent':'New page'}</NotionButton></div>
    <div className="notion-library-toolbar"><TabsList variant="embedded" aria-label="Library views" className="notion-pill-tabs">{tabs.map(({id,label,Icon})=><TabsTrigger key={id} value={id}><Icon size={16}/>{label}</TabsTrigger>)}</TabsList><div className="notion-surface-tools">
      <Menu.DropdownMenu><Menu.DropdownMenuTrigger asChild><NotionButton aria-label="Sort library"><ListFilter size={16}/></NotionButton></Menu.DropdownMenuTrigger><Menu.DropdownMenuContent align="end"><Menu.DropdownMenuLabel>Sort pages</Menu.DropdownMenuLabel>{(['default','asc','desc'] as const).map(value=><Menu.DropdownMenuItem key={value} onSelect={()=>setSort(value)}>{value===sort?'✓ ':''}{value==='default'?'Recent order':value==='asc'?'Name ascending':'Name descending'}</Menu.DropdownMenuItem>)}</Menu.DropdownMenuContent></Menu.DropdownMenu>
      <NotionButton aria-label="Search library" aria-expanded={searchOpen} onClick={()=>{setSearchOpen(value=>!value);setQuery('');}}><Search size={16}/></NotionButton>
      <Popover.Popover><Popover.PopoverTrigger asChild><NotionButton aria-label="Library view options"><SlidersHorizontal size={16}/></NotionButton></Popover.PopoverTrigger><Popover.PopoverContent className="notion-library-properties" align="end"><strong>Properties</strong>{properties.map(property=><label key={property.id}><Checkbox checked={!hidden.includes(property.id)} aria-label={`Show ${property.label}`} onCheckedChange={checked=>setHidden(current=>checked?current.filter(id=>id!==property.id):[...current,property.id])}/>{property.label}</label>)}<NotionButton onClick={()=>{setHidden([]);setSort('default');setQuery('');}}>Reset view</NotionButton></Popover.PopoverContent></Popover.Popover>
    </div></div>
    {searchOpen&&<Input className="notion-library-search" aria-label="Filter library pages" placeholder="Search pages…" autoFocus value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setSearchOpen(false);setQuery('');}}}/>}
    <TabsContent value={tab}>
      {list?<div className="notion-library-groups">{groups.map(group=><section key={group}><h2>{group}</h2>{visible.filter(entry=>(entry.groupLabel??'Pages')===group).map(entry=><div key={entry.id} className="notion-library-list-row">{pageLink(entry)}<span>{entry.edited}</span></div>)}</section>)}</div>:<Table className="notion-library-table"><TableHeader><TableRow><TableHead><FileText size={16}/>Page name</TableHead>{properties.filter(property=>!hidden.includes(property.id)).map(property=><TableHead key={property.id}>{property.id==='creator'?<Users size={16}/>:property.id==='source'?null:<Clock size={16}/>} {property.label}</TableHead>)}</TableRow></TableHeader><TableBody>{visible.map(entry=><TableRow key={entry.id}><TableCell>{pageLink(entry)}</TableCell>{!hidden.includes('creator')&&<TableCell><div className="notion-library-person"><Avatar><AvatarImage src={entry.avatarUrl}/><AvatarFallback>{entry.creator.slice(0,1)}</AvatarFallback></Avatar>{entry.creator}</div></TableCell>}{!hidden.includes('source')&&<TableCell><span className="notion-library-source">{entry.sourceKind==='private'?<LockKeyhole size={15}/>:entry.sourceKind==='teamspace'?<Building2 size={16}/>:<Table2 size={16}/>}<u>{entry.source}</u></span></TableCell>}{!hidden.includes('edited')&&<TableCell>{entry.edited}</TableCell>}{!hidden.includes('visited')&&<TableCell>{entry.visited}</TableCell>}</TableRow>)}</TableBody></Table>}
      {!visible.length&&<p className="notion-surface-empty">No pages found</p>}
    </TabsContent>
  </Tabs></section>;
}
