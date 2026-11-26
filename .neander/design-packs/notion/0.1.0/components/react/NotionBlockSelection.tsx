import {branchEnd} from './NotionBlockBranches';
import * as React from 'react';
import {createPortal} from 'react-dom';
import {NotionButton} from './NotionPrimitives';
import {Bold,Italic,Copy,Trash2,MessageSquare} from './ui/icons';
import {NotionDocumentContext} from './NotionDocumentContext';
import {sliceRuns,plainText,restoreSelection} from './NotionRichText';
import {useNotionLayerZIndex} from './ui/theme';
import type {NotionBlock} from './NotionFramework';

export function walkNotionBlocks(blocks:NotionBlock[]):NotionBlock[]{return blocks.flatMap(block=>[block,...walkNotionBlocks(block.children??[]),...(block.columnBlocks??[]).flatMap(walkNotionBlocks)]);}
export function mapNotionBlocks(blocks:NotionBlock[],change:(block:NotionBlock)=>NotionBlock):NotionBlock[]{return blocks.map(block=>change({...block,children:block.children?mapNotionBlocks(block.children,change):undefined,columnBlocks:block.columnBlocks?.map(column=>mapNotionBlocks(column,change))}));}
function clone(blocks:NotionBlock[]):NotionBlock[]{return mapNotionBlocks(structuredClone(blocks),block=>({...block,id:`block-${crypto.randomUUID()}`}));}
type Range={id:string;from:number;to:number};
function sourceLength(range:globalThis.Range){const fragment=range.cloneContents();fragment.querySelectorAll<HTMLElement>('[data-notion-equation]').forEach(node=>node.replaceWith(document.createTextNode(node.dataset.expression??'')));fragment.querySelectorAll('[data-notion-cursor]').forEach(node=>node.remove());return fragment.textContent?.length??0;}

/** Native cross-block ranges and keyboard block selection use the same document draft. */
export function useNotionBlockSelection(root:React.RefObject<HTMLElement|null>,blocks:NotionBlock[],onChange:(blocks:NotionBlock[])=>void,editable:boolean,documentContext?:React.ContextType<typeof NotionDocumentContext>){
  const inherited=React.useContext(NotionDocumentContext),{theme,resources,pageId}=documentContext??inherited,z=useNotionLayerZIndex('popup')+30;
  const [ids,setIds]=React.useState<string[]>([]),[span,setSpan]=React.useState<string[]>([]),[ranges,setRanges]=React.useState<Range[]>([]),[position,setPosition]=React.useState<{x:number;y:number;modal:boolean}|null>(null),[error,setError]=React.useState('');
  const selectionStart=React.useRef<string|null>(null),selectAllArmed=React.useRef(false),selectionEnd=React.useRef<string|null>(null),latest=React.useRef(blocks);latest.current=blocks;
  React.useEffect(()=>{const outside=(event:Event)=>{const target=event.target;if(target instanceof Element&&!root.current?.contains(target)&&!target.closest('.notion-multi-selection-toolbar,.notion-selection-toolbar')){setIds(current=>current.length?[]:current);setRanges(current=>current.length?[]:current);setSpan(current=>current.length?[]:current);selectAllArmed.current=false;}};document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',outside,true);return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',outside,true);};},[root]);
  function nativeSelection(includeSingle=false){
    const selection=getSelection();if(!root.current||!selection?.rangeCount||selection.isCollapsed)return;
    const native=selection.getRangeAt(0),first=(native.startContainer.nodeType===1?native.startContainer as Element:native.startContainer.parentElement)?.closest<HTMLElement>('[data-rich-block-id]'),last=(native.endContainer.nodeType===1?native.endContainer as Element:native.endContainer.parentElement)?.closest<HTMLElement>('[data-rich-block-id]');
    if(!first||!last||!includeSingle&&first===last||!root.current.contains(first)||!root.current.contains(last))return;
    let owner=first.closest('[data-notion-selection-root]');while(owner&&!owner.contains(last))owner=owner.parentElement?.closest('[data-notion-selection-root]')??null;if(owner!==root.current)return;
    const all=walkNotionBlocks(latest.current),from=all.findIndex(block=>block.id===first.dataset.richBlockId),to=all.findIndex(block=>block.id===last.dataset.richBlockId);if(from<0||to<from)return;
    const before=native.cloneRange();before.selectNodeContents(first);before.setEnd(native.startContainer,native.startOffset);const after=native.cloneRange();after.selectNodeContents(last);after.setEnd(native.endContainer,native.endOffset);
    const rect=native.getBoundingClientRect(),modal=root.current.closest<HTMLElement>('[role=dialog]'),bounds=modal?.getBoundingClientRect();
    return {span:all.slice(from,to+1).map(block=>block.id),ranges:all.slice(from,to+1).filter(block=>block.id===first.dataset.richBlockId||block.id===last.dataset.richBlockId||['text','heading1','heading2','heading3','todo','bullet','numbered','quote','callout'].includes(block.type)).map(block=>({id:block.id,from:block.id===first.dataset.richBlockId?sourceLength(before):0,to:block.id===last.dataset.richBlockId?sourceLength(after):block.text.length})),position:{x:Math.max(8,Math.min((bounds?.width??innerWidth)-280,rect.left-(bounds?.left??0))),y:Math.max(8,rect.top-(bounds?.top??0)-42)+(modal?.scrollTop??0),modal:Boolean(modal)}};
  }
  React.useEffect(()=>{const update=()=>{const selection=nativeSelection();if(!selection){setRanges([]);setSpan([]);return;}setIds([]);setSpan(selection.span);setRanges(selection.ranges);setPosition(selection.position);};document.addEventListener('selectionchange',update);return()=>document.removeEventListener('selectionchange',update);},[root]);
  const clear=()=>{setIds([]);setRanges([]);setSpan([]);setPosition(null);selectionStart.current=null;selectionEnd.current=null;};
  const selected=()=>{const keep=new Set(ids);let level:number|undefined;return latest.current.filter(block=>{const indent=block.indent??0;if(level!==undefined&&indent<=level)level=undefined;if(keep.has(block.id)){level=level===undefined?indent:Math.min(level,indent);return true;}return level!==undefined;});};
  function duplicate(){const keep=new Set(selected().map(block=>block.id)),next:NotionBlock[]=[];let last=-1;latest.current.forEach((block,index)=>{next.push(block);if(keep.has(block.id))last=index;});if(last>=0)next.splice(last+1,0,...clone(selected()));onChange(next);clear();}
  function withoutSelection(selection?:{ranges:Range[];span:string[]}):NotionBlock[]{const targets=selection?.ranges??ranges,covered=selection?.span??span;if(!selection&&ids.length){const keep=new Set(selected().map(block=>block.id));const next=latest.current.filter(block=>!keep.has(block.id));return next;}
    else if(targets.length){const first=targets[0],last=targets.at(-1)!,all=walkNotionBlocks(latest.current),a=all.find(block=>block.id===first.id)!,b=all.find(block=>block.id===last.id)!,runs=[...sliceRuns(a.richText??[{text:a.text}],0,first.from),...sliceRuns(b.richText??[{text:b.text}],last.to,b.text.length)],spanIds=new Set(covered),remove=new Set(all.filter(block=>block.id!==first.id&&spanIds.has(block.id)&&walkNotionBlocks([block]).every(child=>spanIds.has(child.id))).map(block=>block.id));const prune=(items:NotionBlock[]):NotionBlock[]=>items.filter(block=>!remove.has(block.id)).map(block=>({...block,...(block.id===first.id?{text:plainText(runs),richText:runs}:spanIds.has(block.id)?{text:'',richText:undefined}:{}),children:block.children?prune(block.children):undefined,columnBlocks:block.columnBlocks?.map(prune)}));return prune(latest.current);}
    return latest.current;}
  function remove(){const next=withoutSelection();onChange(next.length?next:[{id:`block-${crypto.randomUUID()}`,type:'text',text:''}]);getSelection()?.removeAllRanges();clear();}
  function format(key:'bold'|'italic'){const targets=ranges.length?ranges:ids.map(id=>({id,from:0,to:walkNotionBlocks(latest.current).find(block=>block.id===id)?.text.length??0})),all=walkNotionBlocks(latest.current),remove=targets.every(range=>sliceRuns(all.find(block=>block.id===range.id)?.richText??[{text:all.find(block=>block.id===range.id)?.text??''}],range.from,range.to).every(run=>run[key]));onChange(mapNotionBlocks(latest.current,block=>{const range=targets.find(range=>range.id===block.id);if(!range)return block;const runs=block.richText??[{text:block.text}];return {...block,richText:[...sliceRuns(runs,0,range.from),...sliceRuns(runs,range.from,range.to).map(run=>({...run,[key]:remove?undefined:true})),...sliceRuns(runs,range.to,block.text.length)]};}));if(ranges.length)requestAnimationFrame(()=>{const first=ranges[0],last=ranges.at(-1)!,a=root.current?.querySelector<HTMLElement>(`[data-rich-block-id="${first.id}"]`),b=root.current?.querySelector<HTMLElement>(`[data-rich-block-id="${last.id}"]`);if(!a||!b)return;restoreSelection(a,first.from,first.from);const start=getSelection()!.getRangeAt(0).cloneRange();restoreSelection(b,last.to,last.to);const end=getSelection()!.getRangeAt(0);start.setEnd(end.endContainer,end.endOffset);getSelection()?.removeAllRanges();getSelection()?.addRange(start);});}
  function keyboard(event:React.KeyboardEvent){if(!editable||!(event.target instanceof HTMLElement)||event.target.closest('[role=dialog]')&&!root.current?.contains(event.target))return;if(event.target.closest('[data-notion-selection-root]')!==root.current||!(event.target.closest('.notion-rich-editor')||event.target===root.current))return;const command=event.metaKey||event.ctrlKey,key=event.key.toLowerCase(),target=event.target.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
    if(command&&key==='a'){if(ids.length||selectAllArmed.current||event.target===root.current){event.preventDefault();event.stopPropagation();setIds(blocks.map(block=>block.id));setRanges([]);setSpan([]);root.current?.focus();}else selectAllArmed.current=true;return;}if(!command)selectAllArmed.current=false;
    if(event.key==='Escape'&&target){event.preventDefault();event.stopPropagation();getSelection()?.removeAllRanges();setIds([target]);selectionStart.current=target;selectionEnd.current=target;root.current?.focus();return;}
    if(ids.length&&event.shiftKey&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const start=blocks.findIndex(block=>block.id===(selectionStart.current??ids[0])),end=blocks.findIndex(block=>block.id===(selectionEnd.current??ids.at(-1))),to=Math.max(0,Math.min(blocks.length-1,end+(event.key==='ArrowDown'?1:-1)));selectionEnd.current=blocks[to]?.id??null;setIds(blocks.slice(Math.min(start,to),Math.max(start,to)+1).map(block=>block.id));return;}
    if(!ids.length&&!ranges.length)return;
    if(['Backspace','Delete'].includes(event.key)){event.preventDefault();event.stopPropagation();remove();}else if(command&&key==='d'&&ids.length){event.preventDefault();event.stopPropagation();duplicate();}else if(command&&['b','i'].includes(key)){event.preventDefault();event.stopPropagation();format(key==='b'?'bold':'italic');}else if(event.key==='Escape'){event.preventDefault();clear();}
  }
  // Preserve the selected forest once, including enclosed media and containers.
  // Text formatting still uses only rich-text ranges, with partial endpoints.
  function rangeBlocks(items:NotionBlock[]):NotionBlock[]{return items.flatMap(block=>{
    const children=block.children?rangeBlocks(block.children):undefined,columnBlocks=block.columnBlocks?.map(rangeBlocks);
    if(!span.includes(block.id))return [...(children??[]),...(columnBlocks??[]).flat()];
    const range=ranges.find(range=>range.id===block.id),selected={...block,children,columnBlocks};
    if(!range)return [selected];
    const runs=sliceRuns(block.richText??[{text:block.text}],range.from,range.to);
    return [{...selected,text:plainText(runs),richText:runs}];
  });}
  function copy(event:React.ClipboardEvent,cut=false){if(event.defaultPrevented||!editable||!ids.length&&!ranges.length)return;event.preventDefault();const data=ranges.length?rangeBlocks(latest.current):selected();event.clipboardData.setData('text/plain',walkNotionBlocks(data).map(block=>block.text).join('\n'));event.clipboardData.setData('application/x-notion-blocks',JSON.stringify(data));if(cut)remove();}
  function paste(event:React.ClipboardEvent){
    if(event.defaultPrevented||!editable||!(event.target instanceof HTMLElement)||event.target.closest('[data-notion-selection-root]')!==root.current)return;
    const editor=event.target.closest<HTMLElement>('.notion-rich-editor[data-rich-block-id]');if(event.target!==root.current&&(!editor||!walkNotionBlocks(latest.current).some(block=>block.id===editor.dataset.richBlockId)))return;
    const raw=event.clipboardData.getData('application/x-notion-blocks'),plain=event.target===root.current?event.clipboardData.getData('text/plain'):'';if(!raw&&!plain)return;
    try{
      const parsed:NotionBlock[]=raw?JSON.parse(raw):[{id:'clipboard-text',type:'text',text:plain}];if(!Array.isArray(parsed)||!parsed.length||walkNotionBlocks(parsed).some(block=>typeof block.text!=='string'||!['text','heading1','heading2','heading3','todo','bullet','numbered','quote','callout','code','divider','simple-table','columns','toggle','group','image','video','audio','file','bookmark','equation','embed','page','database','linked-database','synced','toc'].includes(block.type)))return;
      event.preventDefault();event.stopPropagation();
      const current=latest.current,pasted=clone(parsed),origin=Math.min(...parsed.map(block=>block.indent??0)),atLevel=(level:number)=>pasted.map(block=>({...block,indent:(block.indent??0)-origin+level}));
      const native=ids.length?undefined:nativeSelection(true);let next:NotionBlock[];
      if(native){
        const first=native.ranges[0],last=native.ranges.at(-1)!,all=walkNotionBlocks(current),a=all.find(block=>block.id===first.id)!,b=all.find(block=>block.id===last.id)!,prefix=sliceRuns(a.richText??[{text:a.text}],0,first.from),suffix=sliceRuns(b.richText??[{text:b.text}],last.to,b.text.length);
        const remaining=withoutSelection(native),tailKept=b.id!==a.id&&walkNotionBlocks(remaining).some(block=>block.id===b.id);
        const restored=tailKept?mapNotionBlocks(remaining,block=>block.id===b.id?{...block,text:plainText(suffix),richText:suffix}:block):remaining;
        const insert=(items:NotionBlock[]):NotionBlock[]=>items.flatMap(block=>{
          const children=block.children?insert(block.children):undefined,columnBlocks=block.columnBlocks?.map(insert);
          if(block.id!==a.id)return [{...block,children,columnBlocks}];
          const before={...block,text:plainText(prefix),richText:prefix,children,columnBlocks},tail:NotionBlock[]=!tailKept&&suffix.length?[{...b,id:`block-${crypto.randomUUID()}`,text:plainText(suffix),richText:suffix,indent:block.indent,children:undefined,columnBlocks:undefined}]:[];
          if(block.type==='toggle'&&children?.length)return [{...before,children:[...atLevel(0),...tail.map(block=>({...block,indent:0})),...children]}];
          return [...(prefix.length||children?.length||columnBlocks?.some(column=>column.length)?[before]:[]),...atLevel(block.indent??0),...tail];
        });
        next=insert(restored);
      }else if(ids.length){
        const keep=new Set(selected().map(block=>block.id)),at=current.findIndex(block=>keep.has(block.id)),remaining=withoutSelection();if(at<0)throw new Error('Selection unavailable');next=[...remaining.slice(0,at),...atLevel(current[at].indent??0),...remaining.slice(at)];
      }else{
        const after=(event.target as HTMLElement).closest<HTMLElement>('[data-block-id]')?.dataset.blockId,index=current.findIndex(block=>block.id===after),at=index<0?current.length:branchEnd(current,index);next=[...current.slice(0,at),...atLevel(index<0?0:current[index].indent??0),...current.slice(at)];
      }
      onChange(next);getSelection()?.removeAllRanges();clear();
    }catch{setError('Could not paste these blocks.');}
  }
  const count=ids.length||span.length;
  const toolbar=editable&&count>0&&createPortal(<div data-ui-pack="notion" className={`notion-multi-selection-toolbar notion-${theme}`} role="toolbar" aria-label="Selected blocks" onMouseDown={event=>event.preventDefault()} style={{position:position?.modal?'absolute':'fixed',left:position?.x??Math.max(8,root.current?.getBoundingClientRect().left??8),top:position?.y??Math.max(48,(root.current?.getBoundingClientRect().top??48)-36),zIndex:z}}><span>{count} blocks</span><NotionButton aria-label="Bold selected blocks" onClick={()=>format('bold')}><Bold size={15}/></NotionButton><NotionButton aria-label="Italic selected blocks" onClick={()=>format('italic')}><Italic size={15}/></NotionButton>{ids.length>0&&<NotionButton aria-label="Duplicate selected blocks" onClick={duplicate}><Copy size={15}/></NotionButton>}<NotionButton aria-label="Delete selected blocks" onClick={remove}><Trash2 size={15}/></NotionButton>{ranges.length===1&&resources?.actions.onCommentText&&<NotionButton aria-label="Comment selected blocks" onClick={()=>{const range=ranges[0],block=walkNotionBlocks(blocks).find(block=>block.id===range.id)!;resources.actions.onCommentText!(pageId,{blockId:block.id,from:range.from,to:range.to,quote:block.text.slice(range.from,range.to)});}}><MessageSquare size={15}/></NotionButton>}{error&&<span role="alert">{error}</span>}</div>,root.current?.closest('[role=dialog]')??document.body);
  function pointer(){selectAllArmed.current=false;if(ids.length)clear();}
  function move(id:string,target:string){if(!ids.includes(id)||ids.length<2)return false;const keep=new Set(selected().map(block=>block.id));if(keep.has(target))return true;const current=latest.current,from=current.findIndex(block=>block.id===id),to=current.findIndex(block=>block.id===target),rest=current.filter(block=>!keep.has(block.id)),destination=rest.findIndex(block=>block.id===target);if(destination<0)return true;let at=destination;if(to>from)at=branchEnd(rest,destination);const moved:NotionBlock[]=[];for(let index=0;index<current.length;){if(!keep.has(current[index].id)){index++;continue;}const end=branchEnd(current,index),delta=(rest[destination].indent??0)-(current[index].indent??0);moved.push(...current.slice(index,end).map(block=>({...block,indent:(block.indent??0)+delta})));index=end;}rest.splice(at,0,...moved);onChange(rest);return true;}
  return {ids,toolbar,keyboard,copy,paste,clear,pointer,move};
}
