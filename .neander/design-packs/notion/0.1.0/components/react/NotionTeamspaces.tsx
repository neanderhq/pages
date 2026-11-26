import * as React from 'react';
import type {NotionTeamspace} from './NotionSettings';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {Input} from './ui/input';
import {Textarea} from './ui/textarea';
import {Table,TableHeader,TableBody,TableHead,TableRow,TableCell} from './ui/table';
import {Building2,Plus,Search} from './ui/icons';
import {NotionButton} from './NotionPrimitives';
import {NotionSelect} from './NotionSelect';
import {Switch} from './ui/switch';
import * as Menu from './ui/dropdown-menu';

export function NotionTeamspaceDefaults({items,value,limited,disabled,onChange}: {
  items:NotionTeamspace[];value:string;limited:boolean;disabled:boolean;
  onChange:(changes:{defaultTeamspaces?:string;limitTeamspaceCreation?:boolean})=>void;
}) {
  const selected=value.split(',').map(id=>id.trim()).filter(Boolean);
  return <><h2>Default teamspaces</h2><p>Choose which teamspaces all existing and new workspace members should automatically join</p>
    <Menu.DropdownMenu><Menu.DropdownMenuTrigger asChild><NotionButton variant="outline" className="notion-default-teamspaces" aria-label="Default teamspaces" disabled={disabled}>{items.filter(item=>selected.includes(item.id)).map(item=>item.name).join(', ')||'Select teamspaces'}</NotionButton></Menu.DropdownMenuTrigger><Menu.DropdownMenuContent>{items.map(item=><Menu.DropdownMenuCheckboxItem key={item.id} checked={selected.includes(item.id)} onSelect={event=>event.preventDefault()} onCheckedChange={checked=>onChange({defaultTeamspaces:(checked?[...selected,item.id]:selected.filter(id=>id!==item.id)).join(',')})}>{item.name}</Menu.DropdownMenuCheckboxItem>)}</Menu.DropdownMenuContent></Menu.DropdownMenu>
    <div className="notion-settings-row"><div><strong>Limit teamspace creation to workspace owners</strong><p>Only workspace owners can create teamspaces.</p></div><Switch aria-label="Limit teamspace creation to workspace owners" checked={limited} disabled={disabled} onCheckedChange={checked=>onChange({limitTeamspaceCreation:checked})}/></div>
  </>;
}

export function NotionTeamspaces({items,pending,onCreate,onJoin}: {
  items:NotionTeamspace[];pending:boolean;
  onCreate?:(name:string,description:string)=>Promise<boolean>;
  onJoin?:(id:string,joined:boolean)=>Promise<boolean>;
}) {
  const [query,setQuery]=React.useState(''),[membership,setMembership]=React.useState('all'),[open,setOpen]=React.useState(false);
  const [name,setName]=React.useState(''),[description,setDescription]=React.useState(''),[error,setError]=React.useState(false),[working,setWorking]=React.useState(false);
  const busy=React.useRef(false),createTrigger=React.useRef<HTMLButtonElement>(null);
  const visible=items.filter(item=>(membership==='all'||item.joined===(membership==='joined'))&&`${item.name} ${item.description??''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  async function create(){if(!onCreate||busy.current||!name.trim())return;busy.current=true;setWorking(true);setError(false);try{if(!await onCreate(name.trim(),description.trim()))throw new Error('Rejected');setOpen(false);setName('');setDescription('');setQuery('');setMembership('all');}catch{setError(true);}finally{busy.current=false;setWorking(false);}}
  return <section className="notion-teamspaces" aria-label="Workspace teamspaces"><h2>Teamspaces</h2><p>Manage all teamspaces you have access to here</p>
    <div className="notion-teamspaces-toolbar"><NotionSelect label="Teamspace membership" value={membership} options={[{value:'all',label:'All teamspaces'},{value:'joined',label:'Joined'},{value:'other',label:'Not joined'}]} onValueChange={setMembership}/><label className="notion-teamspace-search"><Search size={14}/><Input aria-label="Search teamspaces" placeholder="Search…" value={query} onChange={event=>setQuery(event.target.value)}/></label><NotionButton ref={createTrigger} variant="default" disabled={!onCreate||pending} onClick={()=>{setError(false);setOpen(true);}}><Plus size={14}/>New teamspace</NotionButton></div>
    <Table><TableHeader><TableRow><TableHead>Teamspace</TableHead><TableHead>Access</TableHead><TableHead>Membership</TableHead><TableHead/></TableRow></TableHeader><TableBody>{visible.map(item=><TableRow key={item.id}><TableCell><div className="notion-teamspace-name"><Building2 size={18}/><div><strong>{item.name}</strong><small>{item.description}</small></div></div></TableCell><TableCell>{item.access}</TableCell><TableCell>{item.joined?'Joined':'Not joined'}</TableCell><TableCell><NotionButton variant="outline" aria-label={`${item.joined?'Leave':'Join'} ${item.name}`} disabled={!onJoin||pending} onClick={()=>void onJoin?.(item.id,!item.joined)}>{item.joined?'Leave':'Join'}</NotionButton></TableCell></TableRow>)}</TableBody></Table>
    {!visible.length&&<p className="notion-settings-empty" role="status">{query?'No teamspaces match your search':'No teamspaces in this view'}</p>}
    <Dialog open={open} onOpenChange={value=>{if(!working)setOpen(value);}}><DialogContent onCloseAutoFocus={event=>{event.preventDefault();createTrigger.current?.focus();}} className="notion-teamspace-create" onEscapeKeyDown={event=>{if(working)event.preventDefault();}}><DialogTitle>Create a teamspace</DialogTitle><DialogDescription>A shared home for your team’s pages and work.</DialogDescription><form onSubmit={event=>{event.preventDefault();void create();}}><label>Name<Input autoFocus aria-label="Teamspace name" maxLength={100} value={name} onChange={event=>setName(event.target.value)} disabled={working} placeholder="e.g. Design team"/></label><label>Description<Textarea aria-label="Teamspace description" value={description} onChange={event=>setDescription(event.target.value)} disabled={working} placeholder="What is this teamspace for?"/></label>{error&&<p role="alert" className="notion-surface-error">Could not create the teamspace. Your draft is preserved. Try again.</p>}<div className="notion-property-form-actions"><NotionButton disabled={working} onClick={()=>setOpen(false)}>Cancel</NotionButton><NotionButton type="submit" variant="default" disabled={!onCreate||working||!name.trim()}>{working?'Creating…':'Create teamspace'}</NotionButton></div></form></DialogContent></Dialog>
  </section>;
}
