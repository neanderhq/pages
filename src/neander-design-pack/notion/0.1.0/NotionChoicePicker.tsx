import * as React from 'react';
import { Input } from './ui/input';
import { Check, Plus, X } from './ui/icons';
import { NotionButton } from './NotionPrimitives';

/** Shared by table cells and record properties. Only hosts publish new options. */
export function NotionChoicePicker({label,options,selected,multiple,pending,error,renderOption,onChoose,onCreate}: {
  label:string;options:{id:string;label:string}[];selected:string[];multiple:boolean;pending:boolean;error:boolean;
  renderOption:(id:string)=>React.ReactNode;onChoose:(id:string)=>void;onCreate?:(label:string)=>Promise<boolean>;
}) {
  const [query,setQuery]=React.useState(''),[creating,setCreating]=React.useState(false),[createError,setCreateError]=React.useState(false);
  const busy=React.useRef(false),root=React.useRef<HTMLDivElement>(null);
  const text=query.trim(),matches=options.filter(option=>option.label.toLocaleLowerCase().includes(text.toLocaleLowerCase()));
  const canCreate=Boolean(onCreate&&text&&!options.some(option=>option.label.toLocaleLowerCase()===text.toLocaleLowerCase()));
  async function create(){if(!onCreate||busy.current)return;busy.current=true;setCreating(true);setCreateError(false);try{if(!await onCreate(text))throw new Error('Rejected');setQuery('');}catch{setCreateError(true);}finally{busy.current=false;setCreating(false);}}
  const disabled=pending||creating;
  return <div ref={root} className="notion-choice-picker" onKeyDown={event=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||event.target instanceof HTMLInputElement&&!['ArrowDown','ArrowUp'].includes(event.key))return;
    const choices=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button[data-choice]:not(:disabled)')??[]);if(!choices.length)return;
    event.preventDefault();const index=choices.indexOf(document.activeElement as HTMLButtonElement);
    choices[event.key==='Home'?0:event.key==='End'?choices.length-1:event.key==='ArrowDown'?(index+1)%choices.length:index<0?choices.length-1:(index+choices.length-1)%choices.length].focus();
  }}>
    <Input autoFocus aria-label={`Search ${label} options`} placeholder="Search for an option…" value={query} disabled={disabled} onChange={event=>{setQuery(event.target.value);setCreateError(false);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(matches.length===1)onChoose(matches[0].id);else if(canCreate)void create();}}}/>
    {multiple&&selected.length>0&&<div className="notion-choice-selected">{selected.map(id=><NotionButton key={id} aria-label={`Remove ${options.find(option=>option.id===id)?.label??id}`} disabled={disabled} onClick={()=>onChoose(id)}>{renderOption(id)}<X size={12}/></NotionButton>)}</div>}
    <div className="notion-menu-caption">{multiple?'Select one or more options':'Select an option'}</div>
    <div className="notion-choice-list" role="group" aria-label={`${label} options`}>{matches.map(option=><NotionButton key={option.id} data-choice className="notion-cell-option" disabled={disabled} aria-pressed={selected.includes(option.id)} onClick={()=>onChoose(option.id)}>{renderOption(option.id)}{selected.includes(option.id)&&<Check size={14} className="notion-choice-check"/>}</NotionButton>)}
      {!matches.length&&!canCreate&&<p className="notion-choice-empty">No options found</p>}
      {canCreate&&<NotionButton data-choice className="notion-cell-option" disabled={disabled} onClick={()=>void create()}><Plus size={14}/>Create “{text}”</NotionButton>}
    </div>
    {selected.length>0&&<NotionButton className="notion-cell-option notion-choice-clear" disabled={disabled} onClick={()=>onChoose('')}>Clear</NotionButton>}
    {(error||createError)&&<p role="alert" className="notion-database-error">Could not {createError?'create the option':'update the cell'}. Try again.</p>}
  </div>;
}
