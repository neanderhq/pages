import * as React from 'react';
import { Trash2, ArrowLeft, Search } from './ui/icons';
import { Input } from './ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { NotionButton, NotionIconGlyph } from './NotionPrimitives';
import type { NotionPage } from './NotionFramework';

export function NotionTrash({pages,currentPageId,userName,onRestore}:{pages:NotionPage[];currentPageId?:string|null;userName?:string;onRestore?:(id:string)=>Promise<boolean>}){
 const [query,setQuery]=React.useState(''),[tab,setTab]=React.useState('all'),[pending,setPending]=React.useState<string|null>(null),[error,setError]=React.useState(false);
 const visible=pages.filter(page=>(page.title||'Untitled').toLowerCase().includes(query.toLowerCase())&&(tab==='current'?page.parentId===currentPageId:tab==='mine'?page.lastEditedBy===userName:true));
 async function restore(id:string){if(!onRestore||pending)return;setPending(id);setError(false);try{if(!await onRestore(id))throw new Error('Rejected');}catch{setError(true);}finally{setPending(null);}}
 return <Popover><PopoverTrigger asChild><NotionButton className="notion-nav-item" aria-label="Trash"><Trash2 size={18}/><span>Trash</span></NotionButton></PopoverTrigger><PopoverContent className="notion-trash-menu" side="right" align="end" sideOffset={8} aria-label="Trash"><Tabs value={tab} onValueChange={setTab}><TabsList variant="embedded" aria-label="Trash views"><TabsTrigger value="all">All pages</TabsTrigger><TabsTrigger value="current">In current page</TabsTrigger><TabsTrigger value="mine">Last edited by me</TabsTrigger></TabsList><label className="notion-trash-search"><Search size={16}/><Input variant="embedded" autoFocus aria-label="Search pages in trash" placeholder="Search pages in trash…" value={query} onChange={event=>setQuery(event.target.value)}/></label><TabsContent value={tab} className="notion-trash-list">{visible.map(page=><div className="notion-trash-row" key={page.id}><NotionIconGlyph icon={page.icon} size={16}/><span>{page.title||'Untitled'}</span><NotionButton size="icon" aria-label={`Restore ${page.title||'Untitled'}`} title="Restore page" disabled={!onRestore||pending!==null} onClick={()=>void restore(page.id)}><ArrowLeft size={16}/></NotionButton></div>)}{!visible.length&&<p className="notion-surface-empty">No pages in Trash</p>}</TabsContent></Tabs>{error&&<p className="notion-surface-error" role="alert">Could not restore the page. Try again.</p>}<footer>Pages can be restored to their original location.</footer></PopoverContent></Popover>;
}
