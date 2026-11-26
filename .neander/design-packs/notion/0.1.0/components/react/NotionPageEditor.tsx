import {branchEnd,siblingBlock,visibleBlock as branchVisible,moveBranch,indentBranch,adjacentVisibleIndex,canMergeTextBlocks} from './NotionBlockBranches';
import type {NotionSavePhase} from './NotionNavigationGuard';
import {useNotionSaveGuard,useNotionBeforeUnload} from './NotionNavigationGuard';
import {NotionPageStarters,type NotionPageStarterKind,type NotionPageStarterActions} from './NotionPageStarters';
import {useNotionBlockSelection} from './NotionBlockSelection';
import {NotionDocumentContext,type NotionDocumentResources} from './NotionDocumentContext';
import {freshNotionBlock,cloneNotionBlocks} from './NotionNestedBlocks';
import * as React from 'react';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from './ui/dialog';
import { NotionPageCover } from './NotionPageCover';
import { NotionBlockContent } from './NotionBlockContent';
import { Checkbox } from './ui/checkbox';
import { Textarea } from './ui/textarea';
import { GripVertical, Plus } from './ui/icons';
import { NotionSortList, NotionSortItem } from './NotionSortable';
import { NotionBlockActions, NotionBlockMenu, NotionButton, NotionIconGlyph, type NotionBlockType } from './NotionPrimitives';
import { NotionIconPicker } from './NotionIconPicker';
import { NotionDatabasePage } from './NotionDatabase';
import { NotionRichText, plainText, sliceRuns, restoreSelection } from './NotionRichText';
import type { NotionPage, NotionBlock, NotionRichRun, NotionFrameworkActions } from './NotionFramework';

export function NotionPageEditor({ page, onUpdatePage, onUpdatePageIcon, onUploadPageIcon, onSaveStateChange, focusTitle = 0, theme = 'light', resources, properties, registerBeforeLeave }: {
  page: NotionPage; onUpdatePage?: NotionFrameworkActions['onUpdatePage']; onUpdatePageIcon?: NotionFrameworkActions['onUpdatePageIcon']; onUploadPageIcon?: NotionFrameworkActions['onUploadPageIcon'];
  onSaveStateChange?: (state: 'saved' | 'edited' | 'saving' | 'failed') => void; focusTitle?: number; theme?: 'light' | 'dark';
  resources?: NotionDocumentResources; properties?: React.ReactNode;
  registerBeforeLeave?: (id: string, save: (phase?:NotionSavePhase) => Promise<boolean>) => () => void;
}) {
  const [draft, setDraft] = React.useState({ title: page.title, blocks: page.blocks });
  const [icon, setIcon] = React.useState(page.icon);
  const [iconError, setIconError] = React.useState(false);
  const [iconPending,setIconPending]=React.useState(false),iconBusy=React.useRef(false);
  useNotionSaveGuard(`page-icon-save-${page.id}`,async()=>!iconBusy.current,iconPending,iconPending);
  const [saved, setSaved] = React.useState(JSON.stringify({ title: page.title, blocks: page.blocks }));
  const latestDraft = React.useRef(draft); latestDraft.current = draft;
  const persisted = React.useRef(saved);
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [activeBlock, setActiveBlock] = React.useState<string | null>(null);
  const [menuMode, setMenuMode] = React.useState<'insert' | 'transform'>('insert');
  const [linkDatabaseOpen,setLinkDatabaseOpen]=React.useState(false);
  const [resourcePending, setResourcePending] = React.useState(false);
  const [resourceError, setResourceError] = React.useState(false);
  const readOnly=!onUpdatePage||resourcePending;
  const [readerExpanded,setReaderExpanded]=React.useState<Record<string,boolean>>({});
  React.useEffect(()=>setReaderExpanded({}),[page.id,readOnly]);
  const starting=React.useRef(false);
  const saveTimer = React.useRef<number|undefined>(undefined);
  const saveQueue = React.useRef<Promise<unknown>>(Promise.resolve());
  const editorRef = React.useRef<HTMLDivElement>(null);
  const titleRef = React.useRef<HTMLTextAreaElement>(null);
  const selection=useNotionBlockSelection(editorRef,draft.blocks,blocks=>setDraft(current=>({...current,blocks})),Boolean(onUpdatePage),{pageId:page.id,theme,resources});
  const serialized = JSON.stringify(draft);
  useNotionBeforeUnload(serialized!==saved||saving||resourcePending);
  const history=React.useRef<{past:string[];future:string[];current:string;group:string;time:number}>({past:[],future:[],current:serialized,group:'',time:0});
  const restoring=React.useRef(false);
  React.useLayoutEffect(()=>{
    const state=history.current;
    if(state.current===serialized)return;
    if(restoring.current){state.current=serialized;restoring.current=false;return;}
    const previous=JSON.parse(state.current) as typeof draft;
    const changed=draft.blocks.filter((block,index)=>JSON.stringify(block)!==JSON.stringify(previous.blocks[index]));
    const group=draft.title!==previous.title?'title':changed.length===1&&draft.blocks.length===previous.blocks.length&&changed[0].text!==previous.blocks.find(block=>block.id===changed[0].id)?.text?`text-${changed[0].id}`:`edit-${performance.now()}`;
    const now=performance.now();
    if(group!==state.group||now-state.time>750)state.past=[...state.past.slice(-99),state.current];
    state.current=serialized;state.future=[];state.group=group;state.time=now;
  },[serialized]);
  React.useLayoutEffect(()=>{if(titleRef.current){titleRef.current.style.height='auto';titleRef.current.style.height=`${titleRef.current.scrollHeight}px`;}},[draft.title]);
  function undo(redo:boolean){
    const state=history.current;const next=redo?state.future.pop():state.past.pop();if(!next)return;
    if(redo)state.past.push(state.current);else state.future.push(state.current);
    restoring.current=true;state.group='';setDraft(JSON.parse(next));
  }
  const incoming = JSON.stringify({ title: page.title, blocks: page.blocks });
  const lastIncoming = React.useRef(incoming);

  React.useEffect(() => {
    const initial = { title: page.title, blocks: page.blocks };
    history.current={past:[],future:[],current:JSON.stringify(initial),group:'',time:0};
    lastIncoming.current = JSON.stringify(initial);
    setDraft(initial);
    setIcon(page.icon);
    setIconError(false);
    setSaved(JSON.stringify(initial));
    persisted.current = JSON.stringify(initial);
    setFailed(null);
    setSaving(false);
    if (!page.title && onUpdatePage) window.requestAnimationFrame(() => titleRef.current?.focus());
  }, [page.id]);

  React.useEffect(() => { setIcon(page.icon); }, [page.icon]);
  React.useEffect(() => { if (focusTitle) window.requestAnimationFrame(() => titleRef.current?.focus()); }, [focusTitle]);
  React.useEffect(() => { onSaveStateChange?.(failed ? 'failed' : saving ? 'saving' : serialized !== saved ? 'edited' : 'saved'); }, [failed, saving, serialized, saved, onSaveStateChange]);

  React.useEffect(() => {
    if (lastIncoming.current === incoming) return;
    lastIncoming.current = incoming;
    if (serialized === saved && serialized === persisted.current) {
      setDraft(JSON.parse(incoming));
      setSaved(incoming);
      persisted.current = incoming;
    }
  }, [incoming, saved, serialized]);

  React.useEffect(() => {
    if (!onUpdatePage || resourcePending || serialized === saved || saving || failed === serialized) return;
    saveTimer.current = window.setTimeout(async () => {
      setSaving(true);
      try {
        const result = await persist(JSON.parse(serialized));
        if (result !== true) throw new Error('Could not save this page.');
        setSaved(serialized);
        setFailed(null);
      } catch (error) {
        setFailed(serialized);
      } finally {
        setSaving(false);
      }
    }, 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [failed, onUpdatePage, page.id, saved, saving, serialized, resourcePending]);

  // Serialize explicit navigation saves behind any in-flight autosave.
  function persist(next: typeof draft) {
    const request = saveQueue.current.catch(() => undefined).then(async () => {
      const result = await onUpdatePage?.(page.id, next);
      if(result===true)persisted.current=JSON.stringify(next);
      return result;
    });
    saveQueue.current = request;
    return request;
  }
  async function openResource(id: string) {
    window.clearTimeout(saveTimer.current);
    setResourcePending(true); setResourceError(false);
    try {
      if (onUpdatePage && await persist(draft) !== true) throw new Error('Page save rejected');
      setSaved(JSON.stringify(draft));
      requestAnimationFrame(()=>resources?.actions.onSelectPage?.(id));
    } catch { setResourceError(true); }
    finally { setResourcePending(false); }
  }
  async function createResource(type: 'page' | 'database',form=false) {
    const create = type === 'page' ? resources?.actions.onCreatePage : form?resources?.actions.onCreateForm:resources?.actions.onCreateDatabase;
    if (!create || resourcePending || !onUpdatePage) return;
    window.clearTimeout(saveTimer.current);
    setResourcePending(true); setResourceError(false);
    try {
      const id = await create(page.id);
      if (!id) throw new Error('Creation rejected');
      const block: NotionBlock = { id: `block-${crypto.randomUUID()}`, type, text: '', referenceId: id };
      const current=latestDraft.current,blocks=[...current.blocks];
      const target=activeBlock?blocks.findIndex(item=>item.id===activeBlock):-1;
      // A removed insertion target stays removed; append the accepted resource.
      const index=target<0?blocks.length:menuMode==='insert'?branchEnd(blocks,target):target;
      if(target>=0)block.indent=blocks[target].indent;
      blocks.splice(index,menuMode==='transform'&&target>=0?1:0,block);
      const next={...current,blocks};
      latestDraft.current=next;setDraft(next);
      if (await persist(next) !== true) { setFailed(JSON.stringify(next)); throw new Error('Parent save rejected'); }
      setSaved(JSON.stringify(next)); setFailed(null);
      if (type === 'page') requestAnimationFrame(()=>resources?.actions.onSelectPage?.(id));
    } catch { setResourceError(true); }
    finally { setResourcePending(false); }
  }
  const empty=Boolean(onUpdatePage)&&!properties&&!resources?.pages.some(parent=>parent.id===page.parentId&&parent.database)&&draft.blocks.length<=1&&draft.blocks.every(block=>block.type==='text'&&!block.text.trim());
  async function startPage(kind:NotionPageStarterKind){const action=resources?.actions.onStartPage?.[kind];if(!action||resourcePending||starting.current)return;starting.current=true;window.clearTimeout(saveTimer.current);setResourcePending(true);setResourceError(false);try{if(onUpdatePage&&await persist(draft)!==true)throw new Error('Save rejected');setSaved(JSON.stringify(draft));if(!await action(page.id))throw new Error('Rejected');}catch{setResourceError(true);}finally{starting.current=false;setResourcePending(false);}}
  const starterActions:NotionPageStarterActions={};
  if(resources?.actions.onCreateDatabase)starterActions.database=()=>{setActiveBlock(null);setMenuMode('insert');void createResource('database');};
  if(resources?.actions.onCreateForm)starterActions.form=()=>{setActiveBlock(null);setMenuMode('insert');void createResource('database',true);};
  if(resources?.actions.onStartChat)starterActions.ai=()=>resources.actions.onStartChat?.();
  if(resources?.actions.onNavigate)starterActions.templates=()=>resources.actions.onNavigate?.('resources');
  for(const kind of ['ai','meeting','database','form','templates'] as const)if(resources?.actions.onStartPage?.[kind])starterActions[kind]=()=>void startPage(kind);
  const menuResources = { canCreatePage: Boolean(resources?.actions.onCreatePage), canCreateDatabase: Boolean(resources?.actions.onCreateDatabase), mode: menuMode,canCreateSynced:Boolean(resources?.actions.onCreateSyncedBlock) };

  React.useLayoutEffect(() => registerBeforeLeave?.(page.id, async phase => {
    window.clearTimeout(saveTimer.current);
    if(resourcePending)return Boolean(starting.current&&typeof phase==='object'&&phase.pageStarter===page.id);
    if (!onUpdatePage) return JSON.stringify(latestDraft.current) === persisted.current;
    setSaving(true);
    try {
      // A reverted draft may match the old baseline while an autosave is still
      // pending. Observe that write before comparing against persisted data.
      await saveQueue.current.catch(() => undefined);
      while (JSON.stringify(latestDraft.current) !== persisted.current) {
        const next = latestDraft.current;
        if (await persist(next) !== true) throw new Error('Save rejected');
        setSaved(JSON.stringify(next)); setFailed(null);
      }
      return true;
    } catch { setFailed(JSON.stringify(latestDraft.current)); return false; }
    finally { setSaving(false); }
  }), [page.id, serialized, saved, onUpdatePage, registerBeforeLeave,resourcePending]);

  function updateBlock(id: string, update: Partial<NotionBlock>) {
    if (!onUpdatePage) return;
    setDraft((current) => ({ ...current, blocks: current.blocks.map((block) => block.id === id ? { ...block, ...update } : block) }));
  }
  function focusBlock(id:string,offset?:number){window.requestAnimationFrame(()=>{const dialog=document.activeElement?.closest('[role="dialog"]');if(dialog&&editorRef.current&&!dialog.contains(editorRef.current))return;const element=editorRef.current?.querySelector<HTMLElement>(`[data-block-id="${id}"] :is([contenteditable="true"],textarea,input,.notion-equation-block)`);element?.focus();if(element&&offset!==undefined){if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement)element.setSelectionRange(offset,offset);else if(element.isContentEditable)restoreSelection(element,offset,offset);}});}
  function mergePrevious(block:NotionBlock,index:number){if((block.indent??0)>0){changeIndent(block.id,-1);focusBlock(block.id,0);return true;}const at=adjacentVisibleIndex(draft.blocks,index,-1),previous=draft.blocks[at];if(!canMergeTextBlocks(draft.blocks,index,at))return false;const runs=[...(previous.richText??[{text:previous.text}]),...(block.richText??[{text:block.text}])];setDraft(current=>({...current,blocks:current.blocks.filter(item=>item.id!==block.id).map(item=>item.id===previous.id?{...item,text:plainText(runs),richText:runs}:item)}));focusBlock(previous.id,previous.text.length);return true;}
  function navigateBlock(index:number,direction:-1|1){const next=draft.blocks.map((block,i)=>({block,i})).filter(({block,i})=>visibleBlock(block,i)&&(direction<0?i<index:i>index));const target=direction<0?next.at(-1):next[0];if(target)focusBlock(target.block.id,direction<0?target.block.text.length:0);}
  function mergeNext(block:NotionBlock,index:number){const at=adjacentVisibleIndex(draft.blocks,index,1),next=draft.blocks[at];if(!canMergeTextBlocks(draft.blocks,index,at))return false;const runs=[...(block.richText??[{text:block.text}]),...(next.richText??[{text:next.text}])];setDraft(current=>({...current,blocks:current.blocks.filter(item=>item.id!==next.id).map(item=>item.id===block.id?{...item,text:plainText(runs),richText:runs}:item)}));focusBlock(block.id,block.text.length);return true;}
  function insertBlock(afterId: string | null, type: NotionBlockType = 'text', text = '', richText?: NotionRichRun[]) {
    const id = `block-${crypto.randomUUID()}`;
    setDraft((current) => {
      const target=afterId?current.blocks.findIndex(block=>block.id===afterId):-1,index=target<0?current.blocks.length:branchEnd(current.blocks,target);
      const blocks = [...current.blocks];
      const parent=afterId?current.blocks.find(block=>block.id===afterId):undefined;
      blocks.splice(index, 0, { id, type, text, indent:parent?.indent, ...(richText ? { richText } : {}) });
      return { ...current, blocks };
    });
    focusBlock(id);
  }
  async function createSynced(){
    if(!resources?.actions.onCreateSyncedBlock||resourcePending)return;
    setResourcePending(true);setResourceError(false);
    try{if(onUpdatePage&&await persist(draft)!==true)throw new Error('Save rejected');
      const before=latestDraft.current,index=activeBlock?before.blocks.findIndex(block=>block.id===activeBlock):-1;
      const initial=menuMode==='transform'&&index>=0?before.blocks.slice(index,branchEnd(before.blocks,index)):[freshNotionBlock()];
      const id=await resources.actions.onCreateSyncedBlock(page.id,initial);if(!id)throw new Error('Rejected');
      const current=latestDraft.current,next=[...current.blocks],target=activeBlock?next.findIndex(block=>block.id===activeBlock):-1;
      const branch=target<0?[]:next.slice(target,branchEnd(next,target));
      const replace=menuMode==='transform'&&target>=0&&JSON.stringify(branch)===JSON.stringify(initial);
      // Preserve a target edited or removed while the host created the source.
      const at=target<0?next.length:replace?target:branchEnd(next,target);
      next.splice(at,replace?branch.length:0,{...freshNotionBlock('synced'),syncedId:id,indent:target<0?0:current.blocks[target].indent});const updated={...current,blocks:next};latestDraft.current=updated;setDraft(updated);
    }catch{setResourceError(true);}finally{setResourcePending(false);}
  }
  function chooseBlockType(type: NotionBlockType) {
    if(type==='synced'){void createSynced();return;}
    if(type==='linked-database'){setLinkDatabaseOpen(true);return;}
    if (type === 'page' || type === 'database') { void createResource(type); return; }
    if (activeBlock && menuMode === 'transform') updateBlock(activeBlock, { type });
    else if (activeBlock) insertBlock(activeBlock, type);
    else insertBlock(draft.blocks.at(-1)?.id ?? null, type);
  }
  function visibleBlock(_block:NotionBlock,index:number){return branchVisible(draft.blocks,index,readOnly?readerExpanded:undefined);}
  function changeIndent(id:string,delta:number){setDraft(current=>({...current,blocks:indentBranch(current.blocks,id,delta)}));}
  function removeBlock(id:string){setDraft(current=>{const index=current.blocks.findIndex(block=>block.id===id),end=branchEnd(current.blocks,index);return {...current,blocks:current.blocks.filter((_,i)=>i<index||i>=end)};});}
  function duplicateBlock(id:string){setDraft(current=>{const index=current.blocks.findIndex(block=>block.id===id),end=branchEnd(current.blocks,index),blocks=[...current.blocks];blocks.splice(end,0,...cloneNotionBlocks(blocks.slice(index,end)));return {...current,blocks};});}
  function moveBlock(id:string,targetId:string){setDraft(current=>({...current,blocks:moveBranch(current.blocks,id,targetId)}));}
  async function chooseIcon(nextIcon: string | null) {
    if (!onUpdatePageIcon||iconBusy.current) return;
    iconBusy.current=true;setIconPending(true);setIconError(false);
    try {
      const accepted = await onUpdatePageIcon(page.id, nextIcon);
      if (!accepted) throw new Error('Icon change rejected');
      setIcon(nextIcon ?? undefined);
    } catch { setIconError(true); } finally {iconBusy.current=false;setIconPending(false);}
  }
  function splitBlock(block: NotionBlock, start: number, end: number) {
    if(!block.text&&['bullet','numbered','todo','quote'].includes(block.type)){updateBlock(block.id,{type:'text'});return;}
    const runs = block.richText ?? [{ text: block.text }];
    const before = sliceRuns(runs, 0, start), after = sliceRuns(runs, end, block.text.length);
    updateBlock(block.id, { text: plainText(before), richText: before });
    insertBlock(block.id, block.type === 'todo' || block.type === 'bullet' || block.type==='numbered' ? block.type : 'text', plainText(after), after);
  }
  function removeEmptyBlock(block: NotionBlock, index: number) {
    const previous=adjacentVisibleIndex(draft.blocks,index,-1);
    if(previous<0||branchEnd(draft.blocks,index)>index+1)return;
    const previousId=draft.blocks[previous].id;
    setDraft((current) => ({ ...current, blocks: current.blocks.filter((item) => item.id !== block.id) }));
    focusBlock(previousId);
  }

  return <NotionDocumentContext.Provider value={{pageId:page.id,theme,resources}}><NotionPageCover url={page.coverUrl} onChange={onUpdatePage&&resources?.actions.onSetPageCover?url=>resources.actions.onSetPageCover!(page.id,url):undefined} onUpload={onUpdatePage&&resources?.actions.onUploadBlockFile?file=>resources.actions.onUploadBlockFile!(page.id,'cover',file):undefined}/><article className={`notion-editor ${empty?'notion-editor-empty':''} ${!icon?'notion-editor-no-icon':''} ${page.coverUrl?'notion-editor-has-cover':''} notion-appearance-${page.appearance ?? 'default'}`} ref={editorRef} tabIndex={-1} onPointerDownCapture={event=>{if(!(event.target as HTMLElement).closest('.notion-block-controls,.notion-multi-selection-toolbar'))selection.pointer();}} onKeyDownCapture={selection.keyboard} onCopy={event=>selection.copy(event)} onCut={event=>selection.copy(event,true)} onPasteCapture={selection.paste} data-notion-selection-root="page" aria-label="Page editor" onKeyDown={event=>{
    const target=event.target as HTMLElement;
    const ownsDraft=target===editorRef.current||target===titleRef.current||Boolean(target.closest('[data-block-id]')&&!target.closest('.notion-synced-block,.notion-inline-database'));
    if(!onUpdatePage||!ownsDraft)return;
    if(editorRef.current?.contains(target)&&(target===editorRef.current||target.matches('input,textarea')||target.closest('.notion-rich-editor'))&&(event.metaKey||event.ctrlKey)&&!event.altKey&&(event.key.toLowerCase()==='z'||event.key.toLowerCase()==='y')){event.preventDefault();event.stopPropagation();undo(event.shiftKey||event.key.toLowerCase()==='y');}
  }}>
    {!onUpdatePageIcon&&!icon&&<div className="notion-editor-icon-space" aria-hidden="true"/>}
    {(onUpdatePageIcon || icon) && <NotionIconPicker icon={icon} onChoose={(choice) => void chooseIcon(choice)} onUpload={onUploadPageIcon ? (file) => onUploadPageIcon(page.id, file) : undefined} theme={theme} disabled={!onUpdatePageIcon||iconPending} />}
    {iconError && <div className="notion-editor-error" role="alert">Could not change the icon. Try again.</div>}
    {failed && <div className="notion-editor-error" role="alert">Save failed. <NotionButton onClick={() => setFailed(null)}>Retry</NotionButton></div>}
    {resourcePending && <div role="status" className="notion-editor-status">Saving page…</div>}
    {resourceError && <div role="alert" className="notion-editor-error">Could not complete this action. Your draft is preserved. Try again.</div>}
    <Textarea ref={titleRef} className="notion-title" aria-label="Page title" placeholder="New page" value={draft.title} disabled={!onUpdatePage||resourcePending} rows={1} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(draft.blocks[0])focusBlock(draft.blocks[0].id,0);else insertBlock(null);}}} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
    {properties}{selection.toolbar}
    <NotionSortList ids={draft.blocks.filter(visibleBlock).map((block) => block.id)} label="Document blocks" disabled={!onUpdatePage}
      preview={(id) => {
        const block = draft.blocks.find((item) => item.id === id);
        const original = editorRef.current?.querySelector<HTMLElement>(`[data-block-id="${id}"] .notion-rich-editor`);
        return <div className="notion-drag-block-preview" style={original ? { font: getComputedStyle(original).font } : undefined}>{block?.type === 'bullet' ? '• ' : ''}{block?.text || 'Empty block'}</div>;
      }}
      onDrop={(id, targetId) => {if(!selection.move(id,targetId))moveBlock(id,targetId);}}>
    {draft.blocks.map((block, index) => {
      if(!visibleBlock(block,index))return null;
      const previous=siblingBlock(draft.blocks,index,-1),next=siblingBlock(draft.blocks,index,1);
      return <NotionSortItem key={block.id} id={block.id} disabled={!onUpdatePage}>{({ attributes, listeners, setActivatorNodeRef }) => <div className={`notion-block notion-block--${block.type} ${block.spacing ? `notion-block-space-${block.spacing}` : ''}`} style={{direction:block.direction,marginInlineStart:block.indent?`${block.indent*32}px`:undefined}} data-block-id={block.id} data-block-selected={selection.ids.includes(block.id)||undefined}>
      {onUpdatePage && <div className="notion-block-controls">
        <NotionBlockMenu {...menuResources} theme={theme} open={menuOpen && activeBlock === block.id} onOpenChange={setMenuOpen} onChoose={chooseBlockType} trigger={<NotionButton className="notion-block-control" aria-label={`Add block after block ${index + 1}`} onClick={() => { setActiveBlock(block.id); setMenuMode('insert'); }}><Plus size={16} /></NotionButton>} />
        <NotionBlockActions theme={theme} onMoveUp={previous ? () => moveBlock(block.id, previous.id) : undefined} onMoveDown={next ? () => moveBlock(block.id, next.id) : undefined} onDelete={()=>removeBlock(block.id)} onDuplicate={()=>duplicateBlock(block.id)} onTurnInto={type=>updateBlock(block.id,{type})} onIndent={index>0&&(block.indent??0)<8?()=>changeIndent(block.id,1):undefined} onOutdent={(block.indent??0)>0?()=>changeIndent(block.id,-1):undefined} trigger={<NotionButton ref={setActivatorNodeRef} {...attributes} {...listeners} className="notion-block-control notion-drag-handle" aria-label={`Drag block ${index + 1} to reorder`} title="Drag to reorder, click for block actions"><GripVertical size={16} /></NotionButton>} />
      </div>}
      {block.type === 'todo' && <Checkbox className="notion-todo-checkbox" aria-label={`Complete to-do ${index + 1}`} checked={Boolean(block.checked)} disabled={!onUpdatePage} onCheckedChange={(checked) => updateBlock(block.id, { checked: checked === true })} />}
      {block.type === 'callout' && <span className="notion-callout-icon" aria-hidden="true"><NotionIconGlyph icon={block.icon ?? 'notion-icon:idea'} size={22} /></span>}
      {block.type==='numbered'&&<span className="notion-numbered-marker">{index-draft.blocks.slice(0,index).reduce((last,item,i)=>item.type!=='numbered'?i:last,-1)}.</span>}
      {block.type === 'bullet' && <span className="notion-bullet" aria-hidden="true">•</span>}
      {['group','synced','embed','equation','toggle','code','divider','image','video','audio','file','bookmark','simple-table','columns'].includes(block.type)?<NotionBlockContent block={block} index={index} expanded={readOnly?readerExpanded[block.id]??block.expanded:block.expanded} onToggleExpanded={expanded=>setReaderExpanded(current=>({...current,[block.id]:expanded}))} hasNestedChildren={(draft.blocks[index+1]?.indent??0)>(block.indent??0)} editable={Boolean(onUpdatePage)&&!resourcePending} onChange={changes=>updateBlock(block.id,changes)} onUpload={resources?.actions.onUploadBlockFile?(file)=>resources.actions.onUploadBlockFile!(page.id,block.id,file):undefined}/>:block.type === 'page' || block.type === 'database' ? (block.type === 'database' && resources?.pages.find((item) => item.id === block.referenceId)?.database ? <div className="notion-inline-database">{NotionDatabasePage(resources.pages.find((item) => item.id === block.referenceId)!, resources.actions, theme, registerBeforeLeave,block.referenceViewId?{viewId:block.referenceViewId,onSelectView:id=>updateBlock(block.id,{referenceViewId:id})}:undefined)}</div> : <NotionButton className="notion-page-reference" disabled={!block.referenceId || !resources?.pages.some(item=>item.id===block.referenceId) || resourcePending || !resources?.actions.onSelectPage} onClick={() => block.referenceId && void openResource(block.referenceId)}><NotionIconGlyph icon={resources?.pages.find((item) => item.id === block.referenceId)?.icon}/>{resources?.pages.find((item) => item.id === block.referenceId)?.title || (resources?.pages.some(item=>item.id===block.referenceId)?'Untitled':'Page in Trash')}</NotionButton>) : block.type === 'toc' ? <nav className="notion-document-toc" aria-label="Table of contents">{draft.blocks.filter((item) => item.type === 'heading1' || item.type === 'heading2' || item.type === 'heading3').map((heading) => <NotionButton key={heading.id} onClick={() => editorRef.current?.querySelector<HTMLElement>(`[data-block-id="${heading.id}"]`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })}>{heading.text}</NotionButton>)}</nav> : <NotionRichText block={block} index={index} editable={Boolean(onUpdatePage)&&!resourcePending} theme={theme} onChange={(runs) => {
        const text = plainText(runs);
        if (text === '/') { setActiveBlock(block.id); setMenuMode('transform'); setMenuOpen(true); updateBlock(block.id, { text: '', richText: [] }); return; }
        const shortcuts:Record<string,NotionBlockType>={'# ':'heading1','## ':'heading2','### ':'heading3','- ':'bullet','* ':'bullet','1. ':'numbered','[] ':'todo','[ ] ':'todo','> ':'quote'};
        if(block.type==='text'&&shortcuts[text]){updateBlock(block.id,{type:shortcuts[text],text:'',richText:[]});return;}
        updateBlock(block.id, { text, richText: runs });
      }} onEnter={(start, end) => splitBlock(block, start, end)} onEmptyBackspace={() => (block.indent??0)>0?changeIndent(block.id,-1):removeEmptyBlock(block,index)} onIndent={delta=>changeIndent(block.id,delta)} onMergePrevious={()=>mergePrevious(block,index)} onMergeNext={()=>mergeNext(block,index)} onNavigate={direction=>navigateBlock(index,direction)} onDirection={direction=>updateBlock(block.id,{direction})} />}
    </div>}</NotionSortItem>;})}
    </NotionSortList>
    {onUpdatePage&&<NotionPageStarters empty={empty} actions={starterActions} pending={resourcePending} more={<NotionBlockMenu {...menuResources} theme={theme} open={menuOpen&&activeBlock===null} onOpenChange={setMenuOpen} onChoose={chooseBlockType} trigger={<NotionButton className={empty?'notion-page-more':'notion-add-block'} aria-label="Add a block" title={empty?'More ways to start':undefined} disabled={resourcePending} onClick={()=>{setActiveBlock(null);setMenuMode('insert');}}>{empty?'···':<><Plus size={15}/>Add a block</>}</NotionButton>}/>}/>}
    <Dialog open={linkDatabaseOpen} onOpenChange={setLinkDatabaseOpen}><DialogContent><DialogTitle>Link a database</DialogTitle><DialogDescription>Choose a database from this workspace. Records stay connected to the source.</DialogDescription>{resources?.pages.filter(page=>page.database).map(source=><NotionButton key={source.id} onClick={()=>{const id=`block-${crypto.randomUUID()}`;setDraft(current=>{const blocks=[...current.blocks],target=activeBlock?blocks.findIndex(block=>block.id===activeBlock):-1,index=target<0?blocks.length:menuMode==='insert'?branchEnd(blocks,target):target;blocks.splice(index,menuMode==='transform'&&target>=0?1:0,{id,type:'database',text:'',indent:target<0?0:blocks[target].indent,referenceId:source.id,referenceViewId:source.database!.views[0]?.id});return {...current,blocks};});setLinkDatabaseOpen(false);}}>{source.title||'Untitled database'}</NotionButton>)}{!resources?.pages.some(page=>page.database)&&<p>No databases in this workspace yet.</p>}</DialogContent></Dialog>
  </article></NotionDocumentContext.Provider>;
}
