import {useNotionSaveGuard} from './NotionNavigationGuard';
import * as React from 'react';
import * as Popover from './ui/popover';
import {Input} from './ui/input';
import {Switch} from './ui/switch';
import {NotionButton} from './NotionPrimitives';
import {Link2,Globe2,Check} from './ui/icons';
import type {NotionDatabaseView} from './NotionDatabase';
/** The host publishes the form and supplies its URL; this UI never manufactures access. */
export function NotionFormSharing({view,onPublish,open,onOpenChange}:{open?:boolean;onOpenChange?:(open:boolean)=>void;view:NotionDatabaseView;onPublish?:(published:boolean)=>Promise<boolean>}){
 const [localOpen,setLocalOpen]=React.useState(false);
 const [pending,setPending]=React.useState(false),[error,setError]=React.useState(''),[copied,setCopied]=React.useState(false),busy=React.useRef(false);
 async function publish(value:boolean){if(!onPublish||busy.current)return;busy.current=true;setPending(true);setError('');try{if(!await onPublish(value))throw new Error();}catch{setError('Could not change form sharing. Try again.');}finally{busy.current=false;setPending(false);}}
 useNotionSaveGuard(`form-publish-${React.useId()}`,async()=>!busy.current,pending,pending);
 React.useEffect(()=>setCopied(false),[view.form?.url]);
 return <Popover.Popover open={open??localOpen} onOpenChange={value=>{if(!pending){if(onOpenChange)onOpenChange(value);else setLocalOpen(value);}}}><Popover.PopoverTrigger asChild><NotionButton variant="default"><Globe2 size={14}/>Share form</NotionButton></Popover.PopoverTrigger><Popover.PopoverContent className="notion-form-sharing" align="end"><strong>Share form</strong><p>Anyone with the link can respond when the form is published.</p><label><span>Publish form</span><Switch aria-label="Publish form" checked={Boolean(view.form?.published)} disabled={!onPublish||pending} onCheckedChange={value=>void publish(value)}/></label>{view.form?.published&&view.form.url&&<><Input readOnly aria-label="Published form link" value={view.form.url}/><NotionButton variant="outline" onClick={()=>void navigator.clipboard.writeText(view.form!.url!).then(()=>setCopied(true)).catch(()=>setError('Could not copy the link. Select and copy it above.'))}>{copied?<Check size={14}/>:<Link2 size={14}/>}Copy form link</NotionButton><a className="notion-form-open-link" href={view.form.url} target="_blank" rel="noopener noreferrer">Open form ↗</a></>}{!view.form?.published&&<small>This form is not published.</small>}{error&&<p role="alert" className="notion-surface-error">{error}</p>}</Popover.PopoverContent></Popover.Popover>;
}
