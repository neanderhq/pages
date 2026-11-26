import * as React from 'react';
import {NotionButton} from './NotionPrimitives';
import {NotionSelect} from './NotionSelect';
import {NotionSortItem,NotionSortList} from './NotionSortable';
import * as Popover from './ui/popover';
import {ArrowUpDown,GripVertical,Plus,X} from './ui/icons';
import type {NotionDatabaseColumn,NotionDatabaseRow} from './NotionDatabase';
import type {NotionDatabaseSort} from './NotionDatabaseControls';

export type NotionSortRule=NonNullable<NotionDatabaseSort>;
export function sortNotionRows(rows:NotionDatabaseRow[],columns:NotionDatabaseColumn[],rules:NotionSortRule[]){
 return [...rows].sort((a,b)=>{
  for(const {columnId,direction}of rules){
   const column=columns.find(item=>item.id===columnId),left=columnId==='name'?a.title:a.values[columnId]??'',right=columnId==='name'?b.title:b.values[columnId]??'';
   // Empty cells stay last, and equality falls through to the next rule.
   if(!left||!right){if(left!==right)return left?-1:1;continue;}
   let compared=left.localeCompare(right,undefined,{numeric:true,sensitivity:'base'});
   if(column?.kind==='number'&&Number.isFinite(Number(left))&&Number.isFinite(Number(right)))compared=Number(left)-Number(right);
   if((column?.kind==='status'||column?.kind==='select')&&column.options?.includes(left)&&column.options.includes(right))compared=column.options.indexOf(left)-column.options.indexOf(right);
   if(compared)return compared*(direction==='asc'?1:-1);
  }
  return 0;
 });
}
export function NotionDatabaseSorts({columns,rules,onChange}:{columns:NotionDatabaseColumn[];rules:NotionSortRule[];onChange:(rules:NotionSortRule[])=>void}){
 const [open,setOpen]=React.useState(false),fields=[{id:'name',label:'Name'},...columns],ids=rules.map(rule=>rule.columnId);
 const available=fields.filter(field=>!ids.includes(field.id));
 return <Popover.Popover open={open} onOpenChange={setOpen}><Popover.PopoverTrigger asChild><NotionButton className="notion-icon-action" aria-label="Sort database" aria-pressed={rules.length>0}><ArrowUpDown size={16}/>{rules.length>0&&<span>{rules.length}</span>}</NotionButton></Popover.PopoverTrigger><Popover.PopoverContent className="notion-sort-control" align="end" aria-label="Database sorts">
  <NotionSortList ids={ids} label="Sort priority" preview={id=><span>{fields.find(field=>field.id===id)?.label}</span>} onDrop={(id,target)=>{const next=[...rules],from=ids.indexOf(id),to=ids.indexOf(target);next.splice(to,0,...next.splice(from,1));onChange(next);}}>
   {rules.map((rule,index)=><NotionSortItem key={rule.columnId} id={rule.columnId}>{({attributes,listeners,setActivatorNodeRef})=><div className="notion-sort-rule"><NotionButton ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder sort ${index+1}`} className="notion-sort-grip"><GripVertical size={14}/></NotionButton><NotionSelect label={`Sort ${index+1} property`} value={rule.columnId} options={fields.filter(field=>field.id===rule.columnId||!ids.includes(field.id)).map(field=>({value:field.id,label:field.label}))} onValueChange={columnId=>onChange(rules.map((item,i)=>i===index?{...item,columnId}:item))}/><NotionSelect label={`Sort ${index+1} direction`} value={rule.direction} options={[{value:'asc',label:'Ascending'},{value:'desc',label:'Descending'}]} onValueChange={direction=>onChange(rules.map((item,i)=>i===index?{...item,direction:direction as 'asc'|'desc'}:item))}/><NotionButton aria-label={`Remove sort ${index+1}`} onClick={()=>onChange(rules.filter((_,i)=>i!==index))}><X size={14}/></NotionButton></div>}</NotionSortItem>)}
  </NotionSortList>
  {!rules.length&&<p className="notion-muted">Sort pages by a property.</p>}
  <NotionButton className="notion-sort-add" disabled={!available.length} onClick={()=>{if(available[0])onChange([...rules,{columnId:available[0].id,direction:'asc'}]);}}><Plus size={14}/>Add sort</NotionButton>
  {!!rules.length&&<NotionButton className="notion-sort-add" onClick={()=>{onChange([]);setOpen(false);}}>Delete all sorts</NotionButton>}
 </Popover.PopoverContent></Popover.Popover>;
}
