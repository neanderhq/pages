import * as React from 'react';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from './ui/dialog';
import { NotionButton,NotionIconGlyph } from './NotionPrimitives';
import { NotionPageEditor } from './NotionPageEditor';
import { X } from './ui/icons';
import type { NotionPage } from './NotionFramework';
export type NotionPageVersion={id:string;label:string;author:string;page:NotionPage};
/** Read-only revisions. Restoring is a semantic host write, never a fabricated success state. */
export function NotionVersionHistory({open,onClose,versions,onRestore,theme='light'}:{open:boolean;onClose:()=>void;versions:NotionPageVersion[];onRestore?:(id:string)=>Promise<boolean>;theme?:'light'|'dark'}){
 const [selected,setSelected]=React.useState(versions[0]?.id),[pending,setPending]=React.useState(false),[error,setError]=React.useState(false);const busy=React.useRef(false),revision=versions.find(item=>item.id===selected)??versions[0];
 React.useEffect(()=>{if(open){setSelected(versions[0]?.id);setError(false);}},[open]);
 async function restore(){if(!revision||!onRestore||busy.current)return;busy.current=true;setPending(true);setError(false);try{if(!await onRestore(revision.id))throw new Error('Rejected');onClose();}catch{setError(true);}finally{busy.current=false;setPending(false);}}
 return <Dialog open={open} onOpenChange={value=>{if(!value&&!pending)onClose();}}><DialogContent className="notion-version-dialog" showCloseButton={false} onEscapeKeyDown={event=>{if(pending)event.preventDefault();}}><DialogTitle className="notion-ui-sr-only">Version history</DialogTitle><DialogDescription className="notion-ui-sr-only">Preview a previous revision before restoring it</DialogDescription><div className={`notion-pack notion-version-preview notion-${theme}`}><header>{revision&&<><NotionIconGlyph icon={revision.page.icon} size={16}/>{revision.page.title||'Untitled'}</>}</header>{revision?<NotionPageEditor key={revision.id} page={revision.page} theme={theme}/>:<p className="notion-status">No versions yet</p>}</div><aside><header><strong>Version history</strong><NotionButton aria-label="Close version history" disabled={pending} onClick={onClose}><X size={15}/></NotionButton></header><div className="notion-version-list">{versions.map(version=><NotionButton key={version.id} aria-pressed={version.id===revision?.id} onClick={()=>setSelected(version.id)} disabled={pending}><strong>{version.label}</strong><small>{version.author}</small></NotionButton>)}</div><footer>{error&&<p role="alert" className="notion-surface-error">Could not restore this version. Try again.</p>}<NotionButton variant="default" disabled={!revision||!onRestore||pending} onClick={()=>void restore()}>{pending?'Restoring…':'Restore'}</NotionButton></footer></aside></DialogContent></Dialog>;
}
