import {ArrowLeft} from './ui/icons';
import * as React from 'react';
import katex from 'katex';
import {Textarea} from './ui/textarea';
import * as Popover from './ui/popover';
import {NotionButton} from './NotionPrimitives';

// Native MathML keeps math accessible and prevents third-party global CSS or
// font names from leaking into inactive packs. The parser never trusts TeX URLs.
export function renderNotionEquation(source:string,displayMode=false){
 try{return {html:katex.renderToString(source,{output:'mathml',displayMode,throwOnError:true,trust:false,maxExpand:200,maxSize:20}),error:''};}
 catch{return {html:'',error:'This equation has invalid or unsupported TeX. Check the expression and try again.'};}
}
export function NotionEquationFields({source,onDone,onCancel,display=false}:{source:string;onDone:(source:string)=>void;onCancel:()=>void;display?:boolean}){
 const [draft,setDraft]=React.useState(source),history=React.useRef<{past:string[];future:string[]}>({past:[],future:[]}),result=React.useMemo(()=>renderNotionEquation(draft,display),[draft,display]);
 return <form className={`notion-equation-fields ${display?'is-block':'is-inline'}`} onSubmit={event=>{event.preventDefault();if(draft.trim()&&!result.error)onDone(draft);}}>
  <Textarea autoFocus aria-label="Equation expression" placeholder="E = mc^2" rows={display?2:1} value={draft} onChange={event=>{history.current.past.push(draft);history.current.future=[];setDraft(event.target.value);}} onKeyDown={event=>{const command=event.metaKey||event.ctrlKey,key=event.key.toLowerCase();if(command&&['z','y'].includes(key)){event.preventDefault();event.stopPropagation();const redo=key==='y'||event.shiftKey,stack=redo?history.current.future:history.current.past,next=stack.pop();if(next!==undefined){(redo?history.current.past:history.current.future).push(draft);setDraft(next);}return;}if(event.key==='Enter'&&(!display&&!event.shiftKey||event.metaKey||event.ctrlKey)){event.preventDefault();if(draft.trim()&&!result.error)onDone(draft);}}}/>
  {result.error?<p role="alert" className="notion-surface-error">{result.error}</p>:display&&<div className="notion-equation-preview" aria-label="Equation preview" dangerouslySetInnerHTML={{__html:result.html}}/>}
  <footer>{display&&<NotionButton onClick={onCancel}>Cancel</NotionButton>}<NotionButton variant="default" type="submit" disabled={!draft.trim()||Boolean(result.error)}>Done{!display&&<ArrowLeft size={13}/>}</NotionButton></footer>
 </form>;
}
export function NotionEquation({source,editable,onChange}:{source:string;editable:boolean;onChange:(source:string)=>void}){
 const trigger=React.useRef<HTMLButtonElement>(null);
 const [open,setOpen]=React.useState(false),result=React.useMemo(()=>renderNotionEquation(source,true),[source]);
 return <Popover.Popover open={open} onOpenChange={setOpen}><Popover.PopoverTrigger asChild><NotionButton ref={trigger} className="notion-equation-block" aria-label="Edit block equation" disabled={!editable}>
  {source&&!result.error?<span dangerouslySetInnerHTML={{__html:result.html}}/>:<span>{source||'Add an equation'}</span>}
 </NotionButton></Popover.PopoverTrigger><Popover.PopoverContent container={trigger.current?.closest<HTMLElement>('[role=dialog]')} collisionBoundary={trigger.current?.closest<HTMLElement>('[role=dialog]')??undefined} collisionPadding={8} className="notion-equation-popover" aria-label="Edit equation" onInteractOutside={event=>{if((event.target as HTMLElement).closest?.('.notion-equation-block'))event.preventDefault();}}><NotionEquationFields key={open?'open':'closed'} source={source} display onCancel={()=>setOpen(false)} onDone={value=>{onChange(value);setOpen(false);}}/></Popover.PopoverContent></Popover.Popover>;
}
