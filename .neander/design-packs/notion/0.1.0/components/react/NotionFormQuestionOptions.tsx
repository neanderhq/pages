import * as React from 'react';
import {Popover,PopoverTrigger,PopoverContent} from './ui/popover';
import {Switch} from './ui/switch';
import {NotionButton} from './NotionPrimitives';
import {Ellipsis,X,Copy,Trash2,ArrowUp,ArrowDown,ArrowUpDown,Type,Hash,Settings2,List,Network,ChevronRight} from './ui/icons';
import type {NotionFormQuestion} from './NotionFormModel';
import type {NotionDatabaseColumn} from './NotionDatabase';
/** Source-shaped quick controls; complex edits share the canonical question editor. */
export function NotionFormQuestionOptions({question,column,pending,editable,canUpdateProperties,canBranch,first,last,onChange,onEdit,onLogic,onMove,onDuplicate,onRemove,onCapture,linkedProperty,conditionalUnavailableReason}:{question:NotionFormQuestion;column:NotionDatabaseColumn;pending:boolean;editable:boolean;canUpdateProperties:boolean;canBranch:boolean;first:boolean;last:boolean;onChange:(patch:Partial<NotionFormQuestion>)=>Promise<boolean>;onEdit:()=>void;onLogic:()=>void;onMove:(delta:number)=>void;onDuplicate:()=>void;onRemove:()=>void;onCapture:(element:HTMLElement)=>void;linkedProperty?:React.ReactNode;conditionalUnavailableReason?:string}){
 const [open,setOpen]=React.useState(false),[moving,setMoving]=React.useState(false),handoff=React.useRef(false);
 function launch(action:()=>void){handoff.current=true;setOpen(false);action();}
 const multiple=['multi-select','person','relation'].includes(column.kind??'');
 return <Popover open={open} onOpenChange={value=>{if(!pending){handoff.current=false;setOpen(value);setMoving(false);}}}><PopoverTrigger asChild><NotionButton className="notion-form-question-actions" onPointerDownCapture={event=>onCapture(event.currentTarget)} onFocus={event=>onCapture(event.currentTarget)} aria-label={`Question actions for ${question.title??column.label}`} disabled={pending}><Ellipsis size={15}/></NotionButton></PopoverTrigger><PopoverContent className="notion-form-question-options" aria-label="Question options" aria-hidden={!open||undefined} ref={node=>{if(node)node.inert=!open;}} side="right" align="start" sideOffset={24} collisionPadding={12} padding="none" onCloseAutoFocus={event=>{if(handoff.current)event.preventDefault();}} onInteractOutside={event=>{if(pending)event.preventDefault();}} onEscapeKeyDown={event=>{if(pending)event.preventDefault();}}>
 <header><strong>Question options</strong><NotionButton aria-label="Close question options" disabled={pending} onClick={()=>setOpen(false)}><X size={14}/></NotionButton></header>
 <label><span>∗</span>Required<Switch aria-label="Question required" checked={question.required??column.required??false} disabled={!editable||pending} onCheckedChange={required=>void onChange({required})}/></label>
 <label><List size={16}/>Description<Switch aria-label="Question description enabled" checked={question.description!==undefined} disabled={!editable||pending} onCheckedChange={enabled=>void onChange({description:enabled?'':undefined})}/></label>
 {multiple&&<NotionButton disabled={!editable||pending} onClick={()=>launch(onEdit)}><Hash size={16}/>Max selection<span>{question.maxSelections??'Unlimited'}</span><ChevronRight size={14}/></NotionButton>}
 <hr/><NotionButton disabled={!editable||pending} onClick={()=>launch(onEdit)}><Type size={16}/>Question type<span>{['select','status','multi-select'].includes(column.kind??'')?'Multiple choice':column.kind==='text'?'Text':column.kind}</span><ChevronRight size={14}/></NotionButton>
 {linkedProperty}
 <NotionButton disabled={!editable||pending} onClick={()=>launch(onEdit)}><Settings2 size={16}/>Edit question<ChevronRight size={14}/></NotionButton>
 <label><Network size={16}/>Sync with property name<Switch aria-label="Sync with property name" checked={!question.title} disabled={!editable||pending||!canUpdateProperties||column.id==='name'} onCheckedChange={sync=>void onChange({title:sync?undefined:column.label})}/></label>
 <hr/><NotionButton disabled={!editable||pending} aria-expanded={moving} onClick={()=>setMoving(!moving)}><ArrowUpDown size={16}/>Move question<ChevronRight size={14}/></NotionButton>
 {moving&&<div className="notion-form-question-move"><NotionButton disabled={first||pending} onClick={()=>launch(()=>onMove(-1))}><ArrowUp size={16}/>Move up</NotionButton><NotionButton disabled={last||pending} onClick={()=>launch(()=>onMove(1))}><ArrowDown size={16}/>Move down</NotionButton></div>}
 <NotionButton title={!canBranch?conditionalUnavailableReason:undefined} disabled={!editable||pending||!canBranch||last} onClick={()=>launch(onLogic)}><Network size={16}/>Add conditional logic</NotionButton>
 <NotionButton disabled={!editable||pending||!canUpdateProperties} onClick={()=>launch(onDuplicate)}><Copy size={16}/>Duplicate question</NotionButton>
 <NotionButton disabled={!editable||pending} onClick={()=>launch(onRemove)}><Trash2 size={16}/>Delete question</NotionButton>
 </PopoverContent></Popover>;
}
