import {NotionDocumentContext} from './NotionDocumentContext';
import {renderNotionEquation,NotionEquationFields} from './NotionEquation';
import * as Popover from './ui/popover';
import {useNotionPreferences} from './NotionPreferences';
import {useNotionLayerZIndex} from './ui/theme';
import * as React from 'react';
import {NotionRichColorMenu,type NotionRichColorChoice} from './NotionRichColorMenu';
import { Bold, Italic, Underline, Strikethrough, Code, Link2, MessageSquare } from "./ui/icons";
import { Input } from './ui/input';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from './ui/dialog';
import { NotionButton } from './NotionPrimitives';
import type { NotionBlock, NotionRichRun, NotionTextComment, NotionCollaborator } from './NotionFramework';

type Marks = Omit<NotionRichRun, 'text'>;
type Highlight = NonNullable<Marks['highlight']>;
const colors:Highlight[]=['gray','brown','orange','yellow','green','blue','purple','pink','red'];

export function plainText(runs: NotionRichRun[]) { return runs.map((run) => run.text).join(''); }

export function sliceRuns(runs: NotionRichRun[], start: number, end: number): NotionRichRun[] {
  let offset = 0;
  return runs.flatMap((run) => {
    const from = Math.max(0, start - offset);
    const to = Math.min(run.text.length, end - offset);
    offset += run.text.length;
    return to > from ? [{ ...run, text: run.text.slice(from, to) }] : [];
  });
}

function signature(runs: NotionRichRun[]) { return JSON.stringify(runs); }
function sameMarks(a: NotionRichRun, b: NotionRichRun) {
  return a.color===b.color&&a.equation===b.equation&&a.code===b.code&&a.href===b.href&&a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike && a.highlight === b.highlight;
}
function appendRun(runs: NotionRichRun[], text: string, marks: Marks) {
  if (!text) return;
  const next = { text, ...marks };
  const previous = runs.at(-1);
  if (previous && sameMarks(previous, next)) previous.text += text;
  else runs.push(next);
}
function parseNode(node: Node, marks: Marks, runs: NotionRichRun[]) {
  if (node.nodeType === Node.TEXT_NODE) { appendRun(runs, node.textContent ?? '', marks); return; }
  if (!(node instanceof HTMLElement)) return;
  if(node.dataset.notionCursor||node.dataset.notionTail)return;
  if(node.dataset.notionEquation==='true'){appendRun(runs,node.dataset.expression??'',{...marks,equation:true});return;}
  if(node.matches('script,style,iframe,object,embed,svg,template'))return;
  if (node.tagName === 'BR') { appendRun(runs, '\n', marks); return; }
  const next = { ...marks };
  if(node.matches('code,.notion-rich-code'))next.code=true;
  if(node instanceof HTMLAnchorElement&&safeHref(node.getAttribute('href')??''))next.href=node.getAttribute('href')!;
  if (node.matches('b,strong,.notion-rich-bold') || node.style.fontWeight === 'bold' || Number(node.style.fontWeight) >= 600) next.bold = true;
  if (node.matches('i,em,.notion-rich-italic') || node.style.fontStyle === 'italic') next.italic = true;
  if (node.matches('u,.notion-rich-underline') || node.style.textDecoration.includes('underline')) next.underline = true;
  if (node.matches('s,strike,del,.notion-rich-strike') || node.style.textDecoration.includes('line-through')) next.strike = true;
  if(colors.includes(node.dataset.notionColor as Highlight))next.color=node.dataset.notionColor as Highlight;
  if(colors.includes(node.dataset.notionHighlight as Highlight))next.highlight=node.dataset.notionHighlight as Highlight;
  const highlight = node.dataset.notionHighlight || node.style.backgroundColor;
  if (/yellow|255, 243, 176|255, 236, 174/i.test(highlight)) next.highlight = 'yellow';
  if (/pink|255, 220, 223|255, 206, 212/i.test(highlight)) next.highlight = 'pink';
  if (/blue|210, 235, 250|191, 230, 249/i.test(highlight)) next.highlight = 'blue';
  node.childNodes.forEach((child) => parseNode(child, next, runs));
  if (node.matches('div,p') && node.nextSibling) appendRun(runs, '\n', marks);
}
function readRuns(element: HTMLElement): NotionRichRun[] {
  const runs: NotionRichRun[] = [];
  element.childNodes.forEach((node) => parseNode(node, {}, runs));
  return runs;
}
function safeHref(value:string){try{const parsed=new URL(value,window.location.href);return ['http:','https:','mailto:'].includes(parsed.protocol)?value:undefined;}catch{return undefined;}}
function renderRuns(element:HTMLElement,runs:NotionRichRun[],comments:NotionTextComment[]=[],collaborators:NotionCollaborator[]=[]) {
  element.replaceChildren();let offset=0;
  function cursor(at:number){for(const user of collaborators.filter(user=>user.offset===at)){const caret=document.createElement('span');caret.dataset.notionCursor=user.id;caret.dataset.name=user.name;caret.contentEditable='false';caret.setAttribute('aria-hidden','true');caret.className='notion-collaboration-caret';caret.style.setProperty('--notion-caret-color',`var(--notion-tag-${user.color??'blue'}-fg)`);element.append(caret);}}
  for(const run of runs){const boundaries=[...new Set([0,run.text.length,...comments.flatMap(comment=>[comment.from-offset,comment.to-offset]),...collaborators.map(user=>user.offset-offset)])].filter(value=>value>=0&&value<=run.text.length).sort((a,b)=>a-b);
    const segments=run.equation?[[0,run.text.length]]:boundaries.slice(0,-1).map((from,i)=>[from,boundaries[i+1]]);
    for(const [from,to] of segments){cursor(offset+from);if(to===from)continue;const text=run.text.slice(from,to),link=run.href?safeHref(run.href):undefined;let node:HTMLElement|Text;
      if(run.equation){const span=document.createElement('span'),result=renderNotionEquation(text);span.dataset.notionEquation='true';span.dataset.expression=text;span.contentEditable='false';span.tabIndex=0;span.setAttribute('role','button');span.setAttribute('aria-label',`Edit inline equation ${text}`);span.className='notion-inline-equation';if(result.error)span.textContent=text;else span.innerHTML=result.html;node=span;}
      else if(!run.bold&&!run.italic&&!run.underline&&!run.strike&&!run.highlight&&!run.color&&!run.code&&!link)node=document.createTextNode(text);
      else{const span=document.createElement(link?'a':'span');span.textContent=text;if(link){span.setAttribute('href',link);span.setAttribute('target','_blank');span.setAttribute('rel','noopener noreferrer');span.classList.add('notion-rich-link');}for(const [key,name]of [['bold','bold'],['italic','italic'],['underline','underline'],['strike','strike'],['code','code']] as const)if(run[key])span.classList.add(`notion-rich-${name}`);if(run.color){span.dataset.notionColor=run.color;span.classList.add(`notion-rich-color-${run.color}`);}if(run.highlight){span.dataset.notionHighlight=run.highlight;span.classList.add(`notion-rich-highlight-${run.highlight}`);}node=span;}
      const anchors=comments.filter(comment=>comment.from<=offset+from&&comment.to>=offset+to);if(anchors.length){const mark=document.createElement('span');mark.className='notion-comment-range';mark.dataset.commentId=anchors[0].id;mark.append(node);node=mark;}element.append(node);
    }offset+=run.text.length;
  }cursor(offset);if(plainText(runs).endsWith('\n')){const tail=document.createElement('br');tail.dataset.notionTail='true';element.append(tail);}
}
function selectionOffsets(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return null;
  const range = selection.getRangeAt(0);
  const start = range.cloneRange(); start.selectNodeContents(element); start.setEnd(range.startContainer, range.startOffset);
  const end = range.cloneRange(); end.selectNodeContents(element); end.setEnd(range.endContainer, range.endOffset);
  return { start: sourceLength(start), end: sourceLength(end), range };
}
function sourceLength(range:Range){const fragment=range.cloneContents();fragment.querySelectorAll('[data-notion-cursor]').forEach(node=>node.remove());fragment.querySelectorAll<HTMLElement>('[data-notion-equation]').forEach(node=>node.replaceWith(document.createTextNode(node.dataset.expression??'')));return fragment.textContent?.length??0;}
export function restoreSelection(element:HTMLElement,start:number,end:number){
 function point(offset:number):{node:Node;offset:number}{let remaining=offset;const walker=document.createTreeWalker(element,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{acceptNode(node){if(node instanceof HTMLElement&&node.dataset.notionCursor)return NodeFilter.FILTER_REJECT;if(node.parentElement?.closest('[data-notion-equation],[data-notion-cursor]'))return NodeFilter.FILTER_REJECT;if(node instanceof HTMLElement)return node.dataset.notionEquation?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP;return NodeFilter.FILTER_ACCEPT;}});while(walker.nextNode()){const node=walker.currentNode;if(node instanceof HTMLElement){const length=node.dataset.expression?.length??0;if(remaining<=length){const parent=node.parentNode!;return {node:parent,offset:Array.from(parent.childNodes).indexOf(node)+(remaining>0?1:0)};}remaining-=length;}else{const length=node.textContent?.length??0;if(remaining<=length)return {node,offset:remaining};remaining-=length;}}return {node:element,offset:element.childNodes.length};}
 const from=point(start),to=point(end),range=document.createRange();range.setStart(from.node,from.offset);range.setEnd(to.node,to.offset);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
}

export function NotionRichText({ block, index, editable, theme, onChange, onEnter, onEmptyBackspace, onIndent, onMergePrevious, onMergeNext, onNavigate, onDirection, ariaLabel }: {
  ariaLabel?:string;block: NotionBlock; index: number; editable: boolean; theme: 'light' | 'dark';
  onChange: (runs: NotionRichRun[]) => void; onEnter: (start: number, end: number) => void; onEmptyBackspace: () => void; onIndent?:(delta:number)=>void; onMergePrevious?:()=>boolean;onMergeNext?:()=>boolean;onNavigate?:(direction:-1|1)=>void;onDirection?:(direction:'ltr'|'rtl')=>void;
}) {
  const preferences=useNotionPreferences(),documentContext=React.useContext(NotionDocumentContext);
  const ref = React.useRef<HTMLDivElement>(null);
  const lastLocal = React.useRef('');
  const [toolbar,setToolbar]=React.useState<{rect:DOMRect}|null>(null),owner=React.useId();
  const savedSelection=React.useRef<{start:number;end:number;quote:string;range:Range}|null>(null);
  const toolbarZ=useNotionLayerZIndex('popup')+25;
  const equationSelection=React.useRef<{start:number;end:number}|null>(null);
  const [equation,setEquation]=React.useState<{start:number;end:number;source:string;rect:DOMRect}|null>(null);
  const [activeMarks,setActiveMarks]=React.useState<Marks>({});
  const [colorsOpen, setColorsOpen] = React.useState(false),[recentColor,setRecentColor]=React.useState<NotionRichColorChoice>();
  const [linkOpen,setLinkOpen]=React.useState(false),[href,setHref]=React.useState(''),[linkError,setLinkError]=React.useState('');
  const linkSelection=React.useRef<{start:number;end:number}|null>(null);
  const runs = block.richText ?? [{ text: block.text }];
  const currentSignature = signature(runs);
  const comments=(documentContext.resources?.textComments??[]).filter(comment=>comment.pageId===documentContext.pageId&&comment.blockId===block.id&&!comment.resolved&&block.text.slice(comment.from,comment.to)===comment.quote);
  const collaborators=(documentContext.resources?.collaborators??[]).filter(user=>user.pageId===documentContext.pageId&&user.blockId===block.id);
  const presentation=JSON.stringify({comments,collaborators}),lastPresentation=React.useRef('');
  React.useLayoutEffect(() => {
    const element = ref.current;
    if(element&&(currentSignature!==lastLocal.current||presentation!==lastPresentation.current)){const selection=selectionOffsets(element);renderRuns(element,runs,comments,collaborators);lastLocal.current=currentSignature;lastPresentation.current=presentation;if(selection)restoreSelection(element,selection.start,selection.end);}
  }, [block.id, currentSignature,presentation]);
  React.useEffect(() => {
    const updateToolbar = () => {
      const element = ref.current;
      const offsets = element && selectionOffsets(element);
      if (!offsets || offsets.start === offsets.end) {if((document.activeElement as HTMLElement)?.closest('[data-notion-rich-owner]')?.getAttribute('data-notion-rich-owner')===owner)return;setToolbar(null);setColorsOpen(false);return;}
      savedSelection.current={start:offsets.start,end:offsets.end,quote:plainText(readRuns(element!)).slice(offsets.start,offsets.end),range:offsets.range.cloneRange()};
      const selected=sliceRuns(readRuns(element!),offsets.start,offsets.end);
      const marks:Marks={};for(const key of ['bold','italic','underline','strike','code','equation','href','color','highlight'] as const){const value=selected[0]?.[key];if(value&&selected.every(run=>run[key]===value))Object.assign(marks,{[key]:value});}setActiveMarks(marks);
      const rect = offsets.range.getBoundingClientRect();
      if (rect.bottom < 44 || rect.top > innerHeight) { setToolbar(null); return; }
      setToolbar({rect});
    };
    document.addEventListener('selectionchange', updateToolbar);
    window.addEventListener('scroll', updateToolbar, true);
    window.addEventListener('resize', updateToolbar);
    return () => { document.removeEventListener('selectionchange', updateToolbar); window.removeEventListener('scroll', updateToolbar, true); window.removeEventListener('resize', updateToolbar); };
  }, []);
  function actionRange(){const element=ref.current;if(!element)return null;const live=selectionOffsets(element);if(live&&(live.start!==live.end||element===document.activeElement||element.contains(document.activeElement)))return live;const saved=savedSelection.current;return saved&&plainText(readRuns(element)).slice(saved.start,saved.end)===saved.quote?saved:null;}
  function emit() {
    if (!ref.current) return;
    const next = readRuns(ref.current);
    if(!plainText(next).endsWith('\n'))ref.current.querySelectorAll('[data-notion-tail]').forEach(node=>node.remove());
    lastLocal.current = signature(next);
    onChange(next);
  }
  function apply(command: 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'hiliteColor', value?: string) {
    const element = ref.current;
    const offsets = actionRange();
    if (!element || !offsets) return;
    // Browser typing marks are kept at a caret; selected ranges use the same
    // source model as colors/links so CSS-backed marks can be removed reliably.
    if(offsets.start===offsets.end){document.execCommand(command,false,value);return;}
    const key=command==='strikeThrough'?'strike':command==='hiliteColor'?'highlight':command;
    const selected=sliceRuns(readRuns(element),offsets.start,offsets.end);
    if(key==='highlight')mark({highlight:value as Highlight},offsets);
    else mark({[key]:selected.every(run=>run[key])?undefined:true},offsets);
    setColorsOpen(false);
  }


  function mark(changes:Marks,offsets:{start:number;end:number}|null=actionRange()){
    const element=ref.current;if(!element||!offsets)return;
    if(offsets.start===offsets.end)return;
    const current=readRuns(element),selected=sliceRuns(current,offsets.start,offsets.end).map(run=>({...run,...changes}));
    const next=[...sliceRuns(current,0,offsets.start),...selected,...sliceRuns(current,offsets.end,plainText(current).length)];
    lastLocal.current=signature(next);renderRuns(element,next,comments,collaborators);restoreSelection(element,offsets.start,offsets.end);onChange(next);
  }
  function openEquation(){const offsets=actionRange();if(!offsets||offsets.start===offsets.end)return;equationSelection.current={start:offsets.start,end:offsets.end};setEquation({start:offsets.start,end:offsets.end,source:plainText(sliceRuns(readRuns(ref.current!),offsets.start,offsets.end)),rect:offsets.range.getBoundingClientRect()});}
  function editEquation(target:EventTarget){const atom=(target as HTMLElement).closest<HTMLElement>('[data-notion-equation]'),element=ref.current;if(!atom||!element)return;const range=document.createRange();range.selectNodeContents(element);range.setEndBefore(atom);const start=sourceLength(range),source=atom.dataset.expression??'';equationSelection.current={start,end:start+source.length};setEquation({start,end:start+source.length,source,rect:atom.getBoundingClientRect()});}
  function openLink(){const offsets=actionRange();if(!offsets||offsets.start===offsets.end)return;linkSelection.current={start:offsets.start,end:offsets.end};setHref(sliceRuns(readRuns(ref.current!),offsets.start,offsets.end)[0]?.href??'');setLinkError('');setLinkOpen(true);}
  return <>
    <div ref={ref} data-rich-block-id={block.id} className="notion-rich-editor" role="textbox" aria-label={ariaLabel??`Block ${index + 1}`} aria-multiline="true" aria-readonly={!editable} contentEditable={editable} suppressContentEditableWarning data-empty={!block.text} data-placeholder={index === 0 ? "Type '/' for commands" : ''}
      onClick={event=>{const comment=(event.target as HTMLElement).closest<HTMLElement>('[data-comment-id]');if(comment)documentContext.resources?.actions.onOpenTextComment?.(documentContext.pageId,comment.dataset.commentId!);else if(editable)editEquation(event.target);}} onKeyUp={()=>{const selection=ref.current&&selectionOffsets(ref.current);if(selection)documentContext.resources?.actions.onTextSelectionChange?.(documentContext.pageId,block.id,selection.end);}} onInput={emit} onPaste={event=>{event.preventDefault();const html=event.clipboardData.getData('text/html');if(html){const parsed=new DOMParser().parseFromString(html,'text/html'),safe=document.createElement('div');renderRuns(safe,readRuns(parsed.body));document.execCommand('insertHTML',false,safe.innerHTML);}else document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));emit();}}
      onKeyDown={(event) => {
        if(!editable)return;
        if((event.target as HTMLElement).closest('[data-notion-equation]')&&['Enter',' '].includes(event.key)){event.preventDefault();editEquation(event.target);return;}
        if(event.nativeEvent.isComposing)return;
        if(event.key==='Escape'&&colorsOpen){event.preventDefault();event.stopPropagation();setColorsOpen(false);return;}
        const command=event.metaKey||event.ctrlKey,key=event.key.toLowerCase();
        if(command&&event.shiftKey&&key==='s'){event.preventDefault();apply('strikeThrough');return;}
        if(command&&!event.altKey&&['b','i','u'].includes(key)){event.preventDefault();apply(key==='b'?'bold':key==='i'?'italic':'underline');return;}
        if(command&&!event.altKey&&key==='e'){event.preventDefault();const offsets=actionRange();if(offsets)mark({code:!sliceRuns(readRuns(ref.current!),offsets.start,offsets.end).every(run=>run.code)});return;}
        if(onNavigate&&!event.shiftKey&&!command&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){const offsets=ref.current&&selectionOffsets(ref.current);if(offsets?.start===offsets?.end&&((['ArrowLeft','ArrowUp'].includes(event.key)&&offsets?.start===0)||(['ArrowRight','ArrowDown'].includes(event.key)&&offsets?.end===block.text.length))){event.preventDefault();onNavigate(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1);return;}}
        if(event.key==='Delete'&&onMergeNext){const offsets=ref.current&&selectionOffsets(ref.current);if(offsets?.start===block.text.length&&offsets.end===offsets.start&&onMergeNext()){event.preventDefault();return;}}
        if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();event.stopPropagation();openLink();}
        else if(event.key==='Tab'&&onIndent){event.preventDefault();onIndent(event.shiftKey?-1:1);}
        else if(event.key==='Enter'&&event.shiftKey){const element=ref.current,offsets=element&&selectionOffsets(element);if(element&&offsets){event.preventDefault();const current=readRuns(element),before=sliceRuns(current,0,offsets.start),previous=before.at(-1),next=[...before,{...(previous?.equation?{}:previous),text:'\n'},...sliceRuns(current,offsets.end,plainText(current).length)];lastLocal.current=signature(next);renderRuns(element,next);onChange(next);restoreSelection(element,offsets.start+1,offsets.start+1);}}
        else if (event.key === 'Enter' && !event.shiftKey) { const offsets = ref.current && selectionOffsets(ref.current); if (offsets) { event.preventDefault(); onEnter(offsets.start, offsets.end); } }
        else if(event.key==='Backspace'&&block.text&&onMergePrevious){const offsets=ref.current&&selectionOffsets(ref.current);if(offsets?.start===0&&offsets.end===0&&onMergePrevious())event.preventDefault();}
        else if (event.key === 'Backspace' && !block.text) { event.preventDefault(); onEmptyBackspace(); }
      }} />
    <Popover.Popover open={Boolean(toolbar&&editable)} onOpenChange={open=>{if(!open){setToolbar(null);setColorsOpen(false);}}}><Popover.PopoverAnchor virtualRef={{current:{getBoundingClientRect:()=>{const live=ref.current&&selectionOffsets(ref.current);const rect=live?.start!==live?.end?live?.range.getBoundingClientRect():savedSelection.current?.range.getBoundingClientRect();return rect?.width?rect:toolbar?.rect??new DOMRect();}}}}/>
    {toolbar&&editable&&<Popover.PopoverContent container={ref.current?.closest<HTMLElement>('[role=dialog]')} data-notion-rich-owner={owner} className={`notion-selection-toolbar notion-${theme}`} role="toolbar" aria-label="Text formatting" side="top" align="start" sideOffset={8} collisionPadding={8} collisionBoundary={ref.current?.closest<HTMLElement>('[role=dialog]')??undefined} style={{zIndex:toolbarZ}} onOpenAutoFocus={event=>event.preventDefault()} onCloseAutoFocus={event=>event.preventDefault()} onInteractOutside={event=>{const target=event.target;if(target instanceof Element&&(ref.current?.contains(target)||target.closest('[data-notion-rich-owner]')?.getAttribute('data-notion-rich-owner')===owner))event.preventDefault();}} onMouseDown={event=>event.preventDefault()} onEscapeKeyDown={event=>{event.preventDefault();event.stopPropagation();if(colorsOpen){setColorsOpen(false);return;}window.getSelection()?.collapseToEnd();ref.current?.focus();setToolbar(null);}}>

      {preferences.showTextDirection&&onDirection&&<><NotionButton aria-label="Left-to-right text" onClick={()=>onDirection('ltr')}>LTR</NotionButton><NotionButton aria-label="Right-to-left text" onClick={()=>onDirection('rtl')}>RTL</NotionButton></>}
      <NotionButton aria-label="Bold" aria-pressed={Boolean(activeMarks.bold)} title="Bold" onClick={() => apply('bold')}><Bold size={16} /></NotionButton>
      <NotionButton aria-label="Italic" aria-pressed={Boolean(activeMarks.italic)} title="Italic" onClick={() => apply('italic')}><Italic size={16} /></NotionButton>
      <NotionButton aria-label="Underline" aria-pressed={Boolean(activeMarks.underline)} title="Underline" onClick={() => apply('underline')}><Underline size={16} /></NotionButton>
      <NotionButton aria-label="Strikethrough" aria-pressed={Boolean(activeMarks.strike)} title="Strikethrough" onClick={() => apply('strikeThrough')}><Strikethrough size={16} /></NotionButton>
      <NotionButton aria-label="Inline code" aria-pressed={Boolean(activeMarks.code)} title="Inline code" onClick={()=>{const offsets=actionRange();if(offsets)mark({code:!sliceRuns(readRuns(ref.current!),offsets.start,offsets.end).every(run=>run.code)});}}><Code size={16}/></NotionButton>
      <NotionButton aria-label="Inline equation" aria-pressed={Boolean(activeMarks.equation)} title="Inline equation" onClick={openEquation}><span className="notion-equation-glyph" aria-hidden="true">√x</span></NotionButton>
      <NotionButton aria-label="Add link" aria-pressed={Boolean(activeMarks.href)} title="Add link" onClick={openLink}><Link2 size={16}/></NotionButton>
      {documentContext.resources?.actions.onCommentText&&<NotionButton aria-label="Comment on selected text" title="Comment" onClick={()=>{const offsets=actionRange();if(offsets)documentContext.resources?.actions.onCommentText?.(documentContext.pageId,{blockId:block.id,from:offsets.start,to:offsets.end,quote:block.text.slice(offsets.start,offsets.end)});}}><MessageSquare size={16}/></NotionButton>}
      <span className="notion-toolbar-separator" />
      <NotionRichColorMenu container={ref.current?.closest<HTMLElement>('[role=dialog]')} owner={owner} recent={recentColor} open={colorsOpen} onOpenChange={setColorsOpen} color={activeMarks.color} highlight={activeMarks.highlight} onChoose={choice=>{setRecentColor(choice);mark(choice.background?{highlight:choice.tone}:{color:choice.tone});}}/>
    </Popover.PopoverContent>}
    </Popover.Popover>

    <Popover.Popover open={Boolean(equation)} onOpenChange={open=>{if(!open)setEquation(null);}}><Popover.PopoverAnchor virtualRef={{current:{getBoundingClientRect:()=>equation?.rect??new DOMRect()}}}/><Popover.PopoverContent container={ref.current?.closest<HTMLElement>('[role=dialog]')} collisionBoundary={ref.current?.closest<HTMLElement>('[role=dialog]')??undefined} collisionPadding={8} data-notion-rich-owner={owner} className="notion-equation-popover" aria-label="Edit inline equation" align="start" onInteractOutside={event=>{if((event.target as HTMLElement).closest?.('.notion-selection-toolbar,[data-notion-equation]'))event.preventDefault();}} onCloseAutoFocus={event=>{event.preventDefault();const element=ref.current,range=equationSelection.current,active=document.activeElement;if(active===element||element?.contains(active))return;if(active instanceof HTMLElement&&active!==document.body&&active!==element&&!element?.contains(active)&&!active.closest('[data-state="closed"],.notion-selection-toolbar'))return;element?.focus();if(element&&range)restoreSelection(element,range.start,range.end);}}>{equation&&<NotionEquationFields source={equation.source} onCancel={()=>setEquation(null)} onDone={source=>{const element=ref.current;if(!element)return;const current=readRuns(element),next=[...sliceRuns(current,0,equation.start),{text:source,equation:true},...sliceRuns(current,equation.end,plainText(current).length)];lastLocal.current=signature(next);renderRuns(element,next);onChange(next);equationSelection.current={start:equation.start+source.length,end:equation.start+source.length};element.focus();restoreSelection(element,equation.start+source.length,equation.start+source.length);setEquation(null);}}/>}</Popover.PopoverContent></Popover.Popover>
    <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent data-notion-rich-owner={owner} className="notion-link-dialog" onCloseAutoFocus={event=>{event.preventDefault();ref.current?.focus();}}><DialogTitle>Link</DialogTitle><DialogDescription>Add a link to the selected text</DialogDescription><form onSubmit={event=>{event.preventDefault();const safe=href.trim()?safeHref(href.trim()):undefined;if(href.trim()&&!safe){setLinkError('Use an http, https or mailto link.');return;}mark({href:safe},linkSelection.current);setLinkOpen(false);}}><Input aria-label="Link URL" placeholder="https://" autoFocus value={href} onChange={event=>setHref(event.target.value)}/>{linkError&&<p role="alert">{linkError}</p>}<NotionButton type="submit" variant="default">Save link</NotionButton><NotionButton onClick={()=>{mark({href:undefined},linkSelection.current);setLinkOpen(false);}}>Remove link</NotionButton></form></DialogContent></Dialog>
  </>;
}
