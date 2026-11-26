import * as React from 'react';
import {useNotionSaveGuard} from './NotionNavigationGuard';
import * as Popover from './ui/popover';
import { Input } from './ui/input';
import { NotionButton } from './NotionPrimitives';
import { Image } from './ui/icons';
export function NotionPageCover({url,onChange,onUpload}:{url?:string;onChange?:(url:string|null)=>Promise<boolean>;onUpload?:(file:File)=>Promise<string|null>}){
 const [open,setOpen]=React.useState(false),[draft,setDraft]=React.useState(url??''),[pending,setPending]=React.useState(false),[error,setError]=React.useState('');const busy=React.useRef(false),input=React.useRef<HTMLInputElement>(null);
 useNotionSaveGuard(`page-cover-${React.useId()}`,async()=>!busy.current,pending,pending);
 const valid=(value:string|null)=>!value||/^https?:\/\//i.test(value)||/^data:image\/(png|jpeg|gif|webp);base64,/.test(value);
 async function save(value:string|null,file?:File){
  if(!onChange||busy.current||(file&&!onUpload))return;
  if(!file&&!valid(value)){setError('Use an image URL beginning with https://.');return;}
  busy.current=true;setPending(true);setError('');let message=file?'Could not upload this image. Try again.':'Could not update the cover. Try again.';
  try{
   if(file){value=await onUpload!(file);if(!value)throw new Error('Upload rejected');setDraft(value);message='Could not update the cover. Try again.';}
   if(!valid(value)){message='Use an image URL beginning with https://.';throw new Error('Invalid URL');}
   if(!await onChange(value))throw new Error('Rejected');setOpen(false);
  }catch{setError(message);}finally{busy.current=false;setPending(false);}
 }
 return <div className={`notion-page-cover ${!url?'notion-page-cover-empty':''}`}>{url&&/^https?:\/\/|^data:image\/(png|jpeg|gif|webp);base64,/i.test(url)&&<img src={url} alt="Page cover"/>}{onChange&&<Popover.Popover open={open} onOpenChange={value=>{if(!pending){setOpen(value);if(value){setDraft(url??'');setError('');}}}}><Popover.PopoverTrigger asChild><NotionButton className="notion-cover-trigger" aria-label={url?'Change cover':'Add cover'}><Image size={14}/>{url?'Change cover':'Add cover'}</NotionButton></Popover.PopoverTrigger><Popover.PopoverContent className="notion-cover-picker"><form onSubmit={event=>{event.preventDefault();void save(draft.trim());}}><strong>Page cover</strong><Input aria-label="Cover image URL" placeholder="https://" value={draft} onChange={event=>setDraft(event.target.value)} disabled={pending}/><div><NotionButton type="submit" variant="default" disabled={pending||!draft.trim()}>Save cover</NotionButton>{onUpload&&<NotionButton variant="outline" disabled={pending} onClick={()=>input.current?.click()}>Upload cover</NotionButton>}<NotionButton disabled={pending||!url} onClick={()=>void save(null)}>Remove cover</NotionButton></div><input ref={input} type="file" hidden accept="image/*" aria-label="Upload page cover" onChange={event=>{const file=event.target.files?.[0];if(file)void save(null,file);event.target.value='';}}/>{error&&<p role="alert" className="notion-surface-error">{error}</p>}</form></Popover.PopoverContent></Popover.Popover>}</div>;
}
