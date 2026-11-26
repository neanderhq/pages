import * as React from 'react';
import {NotionButton} from './NotionPrimitives';
import {NotionColumnResize} from './NotionDatabaseTable';
import {NotionRichText,plainText} from './NotionRichText';
import {NotionDocumentContext} from './NotionDocumentContext';
import {Table,TableBody,TableRow,TableCell} from './ui/table';
import * as Menu from './ui/dropdown-menu';
import {GripVertical,Plus} from './ui/icons';
import type {NotionBlock,NotionRichRun} from './NotionFramework';

/** Rich cells and table structure remain one page draft and one history. */
export function NotionSimpleTable({block,index,editable,onChange}:{block:NotionBlock;index:number;editable:boolean;onChange:(changes:Partial<NotionBlock>)=>void}){
 const {theme}=React.useContext(NotionDocumentContext),[previewWidths,setPreviewWidths]=React.useState<Record<number,number>>({});
 const root=React.useRef<HTMLDivElement>(null),cells=block.cells?.length?block.cells:[['','',''],['','','']],count=Math.max(1,...cells.map(row=>row.length));
 const widths=Array.from({length:count},(_,column)=>previewWidths[column]??block.tableColumnWidths?.[column]??180);
 const normalized=()=>cells.map(row=>Array.from({length:count},(_,column)=>row[column]??''));
 const rich=()=>normalized().map((row,r)=>row.map((value,c)=>block.cellRichText?.[r]?.[c]??[{text:value}]));
 function commit(next:string[][],runs:NotionRichRun[][][],other:Partial<NotionBlock>={}){if(!editable)return;onChange({cells:next,cellRichText:runs,...other});}
 function clearPreview(column:number){setPreviewWidths(current=>{const next={...current};delete next[column];return next;});}
 function focus(row:number,column:number){requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>(`[data-cell-row="${row}"][data-cell-column="${column}"] .notion-rich-editor`)?.focus());}
 function insertRow(at:number,copy?:number){const next=normalized(),runs=rich();next.splice(at,0,copy===undefined?Array(count).fill(''):[...next[copy]]);runs.splice(at,0,copy===undefined?Array.from({length:count},()=>[{text:''}]):structuredClone(runs[copy]));commit(next,runs);focus(at,0);}
 function insertColumn(at:number,copy?:number){const next=normalized(),runs=rich();next.forEach(row=>row.splice(at,0,copy===undefined?'':row[copy]));runs.forEach(row=>row.splice(at,0,copy===undefined?[{text:''}]:structuredClone(row[copy])));commit(next,runs,{tableColumnWidths:[...widths.slice(0,at),copy===undefined?180:widths[copy],...widths.slice(at)]});focus(0,at);}
 function moveRow(row:number,to:number){const next=normalized(),runs=rich();next.splice(to,0,...next.splice(row,1));runs.splice(to,0,...runs.splice(row,1));commit(next,runs);focus(to,0);}
 function paste(event:React.ClipboardEvent,row:number,column:number){if(!editable)return;const text=event.clipboardData.getData('text/plain');if(!text.includes('\t'))return;event.preventDefault();event.stopPropagation();const values=text.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n').map(line=>line.split('\t')),size=Math.max(count,column+Math.max(...values.map(row=>row.length))),next=Array.from({length:Math.max(cells.length,row+values.length)},(_,r)=>Array.from({length:size},(_,c)=>cells[r]?.[c]??'')),runs=next.map((row,r)=>row.map((text,c)=>block.cellRichText?.[r]?.[c]??[{text}]));values.forEach((values,r)=>values.forEach((value,c)=>{next[row+r][column+c]=value;runs[row+r][column+c]=[{text:value}];}));commit(next,runs);focus(row+values.length-1,column+values.at(-1)!.length-1);}
 function key(event:React.KeyboardEvent,row:number,column:number){if(!editable||event.nativeEvent.isComposing)return;if(event.key==='Tab'){const offset=row*count+column+(event.shiftKey?-1:1);if(offset<0)return;event.preventDefault();event.stopPropagation();if(offset>=cells.length*count)insertRow(cells.length);else focus(Math.floor(offset/count),offset%count);}}
 function axisMenu(axis:'row'|'column',at:number){const isRow=axis==='row',length=isRow?cells.length:count;return <Menu.DropdownMenu><Menu.DropdownMenuTrigger asChild><NotionButton className={`notion-simple-${axis}-handle`} aria-label={`Table ${index+1} ${axis} ${at+1} actions`}><GripVertical size={14}/></NotionButton></Menu.DropdownMenuTrigger><Menu.DropdownMenuContent>
  <Menu.DropdownMenuCheckboxItem checked={Boolean(isRow?block.tableHeaderRow:block.tableHeaderColumn)} onCheckedChange={checked=>onChange(isRow?{tableHeaderRow:checked}:{tableHeaderColumn:checked})}>Header {axis}</Menu.DropdownMenuCheckboxItem><Menu.DropdownMenuSeparator/>
  <Menu.DropdownMenuItem onSelect={()=>isRow?insertRow(at):insertColumn(at)}>Insert {isRow?'above':'left'}</Menu.DropdownMenuItem><Menu.DropdownMenuItem onSelect={()=>isRow?insertRow(at+1):insertColumn(at+1)}>Insert {isRow?'below':'right'}</Menu.DropdownMenuItem>
  <Menu.DropdownMenuItem onSelect={()=>isRow?insertRow(at+1,at):insertColumn(at+1,at)}>Duplicate {axis}</Menu.DropdownMenuItem>
  {isRow&&<><Menu.DropdownMenuItem disabled={at===0} onSelect={()=>moveRow(at,at-1)}>Move row up</Menu.DropdownMenuItem><Menu.DropdownMenuItem disabled={at===length-1} onSelect={()=>moveRow(at,at+1)}>Move row down</Menu.DropdownMenuItem></>}
  <Menu.DropdownMenuItem onSelect={()=>{const next=normalized().map((row,r)=>row.map((value,c)=>(isRow?r===at:c===at)?'':value)),runs=rich().map((row,r)=>row.map((value,c)=>(isRow?r===at:c===at)?[{text:''}]:value));commit(next,runs);}}>Clear {axis}</Menu.DropdownMenuItem>
  <Menu.DropdownMenuSeparator/><Menu.DropdownMenuItem disabled={length===1} onSelect={()=>commit(isRow?normalized().filter((_,r)=>r!==at):normalized().map(row=>row.filter((_,c)=>c!==at)),isRow?rich().filter((_,r)=>r!==at):rich().map(row=>row.filter((_,c)=>c!==at)),isRow?{}:{tableColumnWidths:widths.filter((_,c)=>c!==at)})}>Delete {axis}</Menu.DropdownMenuItem>
 </Menu.DropdownMenuContent></Menu.DropdownMenu>;}
 return <div ref={root} className="notion-simple-table-scroll"><div className="notion-simple-table-canvas" style={{width:widths.reduce((total,value)=>total+value,0)}}>
  {editable&&<div className="notion-simple-column-tools">{widths.map((width,column)=><div key={column} style={{width}}>{axisMenu('column',column)}<NotionColumnResize label={`table ${index+1} column ${column+1}`} width={width} onPreview={value=>setPreviewWidths(current=>({...current,[column]:value}))} onCancel={()=>clearPreview(column)} onCommit={value=>{onChange({tableColumnWidths:widths.map((width,c)=>c===column?value:width)});clearPreview(column);}}/></div>)}</div>}
  <Table className="notion-simple-table" aria-label={`Simple table ${index+1}`}><colgroup>{widths.map((width,column)=><col key={column} style={{width}}/>)}</colgroup><TableBody>{normalized().map((row,r)=><TableRow key={r}>{row.map((value,c)=><TableCell key={c} data-cell-row={r} data-cell-column={c} className={(block.tableHeaderRow&&r===0)||(block.tableHeaderColumn&&c===0)?'notion-simple-header':undefined} onPasteCapture={event=>paste(event,r,c)} onKeyDownCapture={event=>key(event,r,c)}>
   {editable&&c===0&&axisMenu('row',r)}<NotionRichText ariaLabel={`Table ${index+1} row ${r+1} column ${c+1}`} block={{id:`${block.id}-${r}-${c}`,type:'text',text:value,richText:block.cellRichText?.[r]?.[c]}} index={r*count+c} editable={editable} theme={theme} onChange={value=>{const next=normalized(),runs=rich();next[r][c]=plainText(value);runs[r][c]=value;commit(next,runs);}} onEnter={()=>{if(r===cells.length-1)insertRow(cells.length);else focus(r+1,c);}} onEmptyBackspace={()=>{}}/>
  </TableCell>)}</TableRow>)}</TableBody></Table>
  {editable&&<><NotionButton className="notion-simple-add-row" aria-label={`Add row to table ${index+1}`} onClick={()=>insertRow(cells.length)}><Plus size={14}/></NotionButton><NotionButton className="notion-simple-add-column" aria-label={`Add column to table ${index+1}`} onClick={()=>insertColumn(count)}><Plus size={14}/></NotionButton></>}
 </div></div>;
}
