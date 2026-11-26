import {NotionSyncedDraftProvider} from './NotionSyncedBlock';
import type {NotionPageStarterKind} from './NotionPageStarters';
import type {NotionSavePhase} from './NotionNavigationGuard';
import {NotionPreferencesProvider,type NotionWorkspacePreferences} from './NotionPreferences';
import type {NotionDateRange} from './NotionTimelineRange';
import type { NotionBoardMove } from './NotionBoard';
import type { NotionNavigationModel } from './NotionNavigation';
import { NotionThemeProvider } from './ui/theme';
import { TooltipProvider } from './ui/tooltip';
import * as React from 'react';
import { Menu, X, ChevronsRight, Maximize2 } from "./ui/icons";
import { NotionButton, type NotionBlockType } from './NotionPrimitives';
import { notionRelationColumns, NotionDatabasePage, NotionDatabaseProperties, type NotionDatabaseModel, type NotionDatabaseOpenMode, type NotionDatabaseColumn, type NotionDatabaseViewSettings, type NotionDatabaseView, type NotionRelationSource, type NotionFormulaPreview,type NotionFormConfig } from './NotionDatabase';
import { NotionPageChrome, NotionSidebar } from './NotionChrome';
import { NotionNavigationGuard, NotionDraftRegistry } from './NotionNavigationGuard';
import { NotionPageEditor } from './NotionPageEditor';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

export type NotionTextColor='gray'|'brown'|'orange'|'yellow'|'green'|'blue'|'purple'|'pink'|'red';
export type NotionRichRun = { text: string; equation?:boolean; code?: boolean; href?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?:NotionTextColor;highlight?:NotionTextColor };
export type NotionTextAnchor={blockId:string;from:number;to:number;quote:string};
export type NotionTextComment=NotionTextAnchor&{id:string;pageId:string;resolved?:boolean};
export type NotionSyncedContent={id:string;sourcePageId:string;blocks:NotionBlock[]};
export type NotionCollaborator={id:string;name:string;pageId:string;blockId:string;offset:number;color?:NotionTextColor};
export type NotionEmbed={src:string;title:string;allow?:string;sandbox?:string};
export type NotionBlock = { id: string; type: NotionBlockType; text: string; children?:NotionBlock[];columnBlocks?:NotionBlock[][];cellRichText?:NotionRichRun[][][];syncedId?:string;embed?:NotionEmbed; content?:string; expanded?:boolean; url?:string;caption?:string;language?:string;cells?:string[][];tableHeaderRow?:boolean;tableHeaderColumn?:boolean;tableColumnWidths?:number[];columns?:string[]; referenceId?: string; referenceViewId?:string; richText?: NotionRichRun[]; checked?: boolean; icon?: string; indent?: number; direction?:'ltr'|'rtl'; spacing?: 'paragraph' | 'section' };
export type NotionPage = { id: string; parentId?: string | null; kind?: 'page' | 'meeting' | 'agent'; title: string;coverUrl?:string; createdBy?:string;icon?: string; favorite?: boolean; badgeLabel?: string; accessLabel?: string; showLinkAction?: boolean; locked?: boolean; appearance?: 'default' | 'serif' | 'mono'; notification?: 'all' | 'comments' | 'off'; lastEditedLabel?: string; lastEditedBy?: string; lastEditedAt?: string; blocks: NotionBlock[]; database?: NotionDatabaseModel };
export type NotionWorkspace = { id: string; name: string; icon?: string };
export type NotionFrameworkModel = {
  syncedBlocks?:NotionSyncedContent[];textComments?:NotionTextComment[];collaborators?:NotionCollaborator[];
  workspaceName: string;
  preferences?:NotionWorkspacePreferences;
  workspaceId?: string;
  navigation?: NotionNavigationModel;
  workspaces?: NotionWorkspace[];
  user?: { name: string; avatarUrl?: string };
  trash?: {pages:NotionPage[]};
  shareDialog?: { pageId: string; accessLabel: string; accessOptions?: string[]; members?: { name: string; email?: string; avatarUrl?: string; role: string; roleOptions?: string[]; isYou?: boolean }[]; published?: boolean; helpUrl?: string; agentAccessNotice?: string } | null;
  pages: NotionPage[];
  selectedPageId: string | null;
  sidePeekPageId?: string | null;
  centerPeekPageId?: string | null;
  theme?: 'light' | 'dark';
  loading?: boolean;
};
export type NotionFrameworkActions = {
  onCreateSyncedBlock?:(pageId:string,blocks:NotionBlock[])=>Promise<string|null>;
  onUpdateSyncedBlock?:(id:string,blocks:NotionBlock[])=>Promise<boolean>;
  onInsertSyncedBlock?:(pageId:string,id:string)=>Promise<boolean>;
  onCommentText?:(pageId:string,anchor:NotionTextAnchor)=>void;
  onOpenTextComment?:(pageId:string,id:string)=>void;
  onTextSelectionChange?:(pageId:string,blockId:string,offset:number)=>void;
  onResolveEmbed?:(pageId:string,blockId:string,url:string)=>Promise<NotionEmbed|null>;
  onUpdateDatabaseRecordDates?:(pageId:string,rowId:string,range:NotionDateRange,startColumnId:string,endColumnId?:string)=>Promise<boolean>;
  databaseRelationSources?:NotionRelationSource[];
  onSubmitDatabaseForm?:(pageId:string,viewId:string,values:Record<string,string>)=>Promise<string|null>;
  onUpdateDatabaseFormQuestions?:(pageId:string,viewId:string,form:NotionFormConfig)=>Promise<boolean>;
  onUpdateDatabaseForm?:(pageId:string,viewId:string,definition:{form:NotionFormConfig;columns:NotionDatabaseColumn[]})=>Promise<boolean>;
  onSetDatabaseFormPublished?:(pageId:string,viewId:string,published:boolean)=>Promise<boolean>;
  onPreviewDatabaseFormula?:(pageId:string,formula:string)=>Promise<NotionFormulaPreview>;
  onSelectPage?: (id: string) => void;
  onCreatePage?: (parentId?: string) => Promise<string | null>;
  onStartPage?:Partial<Record<NotionPageStarterKind,(pageId:string)=>Promise<boolean>>>;
  onCreateForm?: (parentId?:string)=>Promise<string|null>;
  onCreateDatabase?: (parentId?: string) => Promise<string | null>;
  onCreateMeeting?: (mode:'recording'|'note') => Promise<string|null>;
  onUpdatePage?: (id: string, changes: { title: string; blocks: NotionBlock[] }) => Promise<boolean>;
  onUpdatePageIcon?: (id: string, icon: string | null) => Promise<boolean>;
  onUploadPageIcon?: (id: string, file: File) => Promise<string | null>;
  onSetPageCover?: (pageId:string,url:string|null)=>Promise<boolean>;
  onUploadBlockFile?: (pageId:string,blockId:string,file:File)=>Promise<string|null>;
  onNavigate?: (id: string) => void;
  onStartChat?: () => void;
  onMoveFavorite?: (id: string, targetId: string, placement: 'before' | 'after') => Promise<boolean>;
  onSwitchWorkspace?: (id: string) => void;
  onToggleFavorite?: (id: string, favorite: boolean) => Promise<boolean>;
  onMovePage?: (id: string, targetId: string, placement: 'before' | 'after' | 'inside') => Promise<boolean>;
  onDuplicatePage?: (id: string) => Promise<string | null>;
  onTrashPage?: (id: string) => Promise<boolean>;
  onRestorePage?: (id:string)=>Promise<boolean>;
  onCopyPageLink?: (id: string) => Promise<boolean>;
  onCopyPageContents?: (id: string) => Promise<boolean>;
  onOpenPageVersionHistory?: (id: string) => void;
  onOpenPageComments?: (id:string)=>void;
  onOpenPageAnalytics?: (id: string) => void;
  onSetPageAppearance?: (id: string, appearance: 'default' | 'serif' | 'mono') => Promise<boolean>;
  onUsePageWithAI?: (id: string, action: 'summarize' | 'improve') => void;
  onSuggestPageEdits?: (id: string) => void;
  onSetPageNotification?: (id: string, notification: 'all' | 'comments' | 'off') => Promise<boolean>;
  onSetPageLocked?: (id: string, locked: boolean) => Promise<boolean>;
  onOpenPageInNewTab?: (id: string) => void;
  onOpenPageInSidePeek?: (id: string) => void;
  onCloseSidePeek?: () => void;
  onSharePage?: (id: string) => void;
  onCloseShare?: () => void;
  onSetShareMemberRole?: (pageId:string,email:string,role:string)=>Promise<boolean>;
  onInvitePeople?: (id: string, email: string) => Promise<boolean>;
  onSetShareAccess?: (id: string, accessLabel: string) => Promise<boolean>;
  onSetPagePublished?: (id: string, published: boolean) => Promise<boolean>;
  onUpdateDatabaseViewSettings?: (pageId:string,viewId:string,settings:NotionDatabaseViewSettings)=>Promise<boolean>|void;
  onSelectDatabaseView?: (pageId: string, viewId: string) => void;
  onOpenDatabaseRecord?: (pageId: string, rowId: string, mode: NotionDatabaseOpenMode) => void;
  onSelectDatabaseOpenMode?: (pageId: string, viewId: string, mode: NotionDatabaseOpenMode) => void;
  onUpdateDatabaseSchema?: (pageId:string,columns:NotionDatabaseColumn[])=>Promise<boolean>;
  onUpdateDatabaseCell?: (pageId: string, rowId: string, columnId: string, value: string) => Promise<boolean>;
  onCloseCenterPeek?: () => void;
  onMoveDatabaseRecord?:(pageId:string,rowId:string,move:NotionBoardMove)=>Promise<boolean>;
  onUpdateDatabaseView?: (pageId:string,view:NotionDatabaseView)=>Promise<boolean>;
  onDeleteDatabaseView?: (pageId:string,viewId:string)=>Promise<boolean>;
  onCreateDatabaseView?: (pageId:string,name:string,kind:NotionDatabaseView['kind'])=>Promise<boolean>;
  onCreateDatabaseRecord?: (pageId: string, values?:Record<string,string>,groupId?:string) => Promise<string | null>;
};


export type NotionFrameworkProps = { model: NotionFrameworkModel; actions?: NotionFrameworkActions; content?: React.ReactNode; header?: React.ReactNode; inspector?: React.ReactNode; children?:React.ReactNode };


function NotionFrameworkContent({ model, actions: hostActions = {}, content, header, inspector, children }: NotionFrameworkProps) {
  const peekOpener = React.useRef<HTMLElement | null>(null);
  const peekRef = React.useRef<HTMLElement>(null);
  const leaveGuards = React.useRef(new Map<symbol, (phase?:NotionSavePhase) => Promise<boolean>>());
  const creatingRef=React.useRef(false);
  const registerBeforeLeave = React.useCallback((id: string, save: (phase?:NotionSavePhase) => Promise<boolean>) => {
    const instance=Symbol(id);
    leaveGuards.current.set(instance, save);
    return () => { leaveGuards.current.delete(instance); };
  }, []);
  async function flushAll(phase:NotionSavePhase='navigation'){
    const completed=new Set<symbol>();
    // A draft can change and register a new revision while another save waits.
    // Drain the live registry, rather than allowing a stale completed snapshot.
    while(true){const next=[...leaveGuards.current].find(([id])=>!completed.has(id));if(!next){setActionError(current=>current==="Could not save all changes. Your drafts are preserved. Try again."?"":current);return true;}const [id,save]=next;if(!await save(phase))return false;completed.add(id);}
  }
  async function leave(intent:()=>void,phase?:NotionSavePhase){if(await flushAll(phase))intent();}
  const actions: NotionFrameworkActions = { ...hostActions,
    onSetPageLocked:hostActions.onSetPageLocked?async(id,locked)=>(!locked||await flushAll())?hostActions.onSetPageLocked!(id,locked):false:undefined,
    onUpdateDatabaseFormQuestions:hostActions.onUpdateDatabaseFormQuestions??(hostActions.onUpdateDatabaseView?async(pageId,viewId,form)=>{const view=model.pages.find(page=>page.id===pageId)?.database?.views.find(view=>view.id===viewId);return view?hostActions.onUpdateDatabaseView!(pageId,{...view,form}):false;}:undefined),
    onSubmitDatabaseForm:hostActions.onSubmitDatabaseForm??(hostActions.onCreateDatabaseRecord?async(pageId,_viewId,values)=>hostActions.onCreateDatabaseRecord!(pageId,values):undefined),
    onStartPage:hostActions.onStartPage?Object.fromEntries(Object.entries(hostActions.onStartPage).filter(([,action])=>Boolean(action)).map(([kind,action])=>[kind,async(pageId:string)=>await flushAll({pageStarter:pageId})?action!(pageId):false])):undefined,
    onCommentText:hostActions.onCommentText?(id,anchor)=>void leave(()=>hostActions.onCommentText!(id,anchor)):undefined,
    onOpenTextComment:hostActions.onOpenTextComment?(id,comment)=>void leave(()=>hostActions.onOpenTextComment!(id,comment)):undefined,
    onOpenPageVersionHistory:hostActions.onOpenPageVersionHistory?(id)=>void leave(()=>hostActions.onOpenPageVersionHistory!(id)):undefined,
    onOpenPageComments:hostActions.onOpenPageComments?(id)=>void leave(()=>hostActions.onOpenPageComments!(id)):undefined,
    onMoveDatabaseRecord:hostActions.onMoveDatabaseRecord?async(...args)=>await flushAll()?hostActions.onMoveDatabaseRecord!(...args):false:undefined,
    onCreateDatabaseView:hostActions.onCreateDatabaseView?async(...args)=>await flushAll()?hostActions.onCreateDatabaseView!(...args):false:undefined,
    onUpdateDatabaseView:hostActions.onUpdateDatabaseView?async(...args)=>await flushAll('view-definition')?hostActions.onUpdateDatabaseView!(...args):false:undefined,
    onDeleteDatabaseView:hostActions.onDeleteDatabaseView?async(...args)=>await flushAll('view-definition')?hostActions.onDeleteDatabaseView!(...args):false:undefined,
    onCreateDatabaseRecord:hostActions.onCreateDatabaseRecord?async(...args)=>await flushAll()?hostActions.onCreateDatabaseRecord!(...args):null:undefined,
    onDuplicatePage:hostActions.onDuplicatePage?async(id)=>await flushAll()?hostActions.onDuplicatePage!(id):null:undefined,
    onTrashPage:hostActions.onTrashPage?async(id)=>await flushAll()?hostActions.onTrashPage!(id):false:undefined,
    onOpenPageInNewTab:hostActions.onOpenPageInNewTab?(id)=>void leave(()=>hostActions.onOpenPageInNewTab!(id)):undefined,
    onSelectPage: hostActions.onSelectPage ? (id) => void leave(() => hostActions.onSelectPage!(id)) : undefined,
    onSwitchWorkspace: hostActions.onSwitchWorkspace ? (id) => void leave(() => hostActions.onSwitchWorkspace!(id)) : undefined,
    onOpenPageInSidePeek: hostActions.onOpenPageInSidePeek ? (id) => { peekOpener.current = document.activeElement as HTMLElement; void leave(() => hostActions.onOpenPageInSidePeek!(id)); } : undefined,
    onNavigate: hostActions.onNavigate ? (id) => void leave(() => hostActions.onNavigate!(id)) : undefined,
    onSelectDatabaseView: hostActions.onSelectDatabaseView ? (id, view) => void leave(() => hostActions.onSelectDatabaseView!(id, view)) : undefined,
    onStartChat: hostActions.onStartChat ? () => void leave(() => hostActions.onStartChat!()) : undefined,
    onCloseSidePeek: hostActions.onCloseSidePeek ? () => void leave(() => { hostActions.onCloseSidePeek!(); requestAnimationFrame(() => peekOpener.current?.focus()); }) : undefined,
    onCloseCenterPeek: hostActions.onCloseCenterPeek ? () => void leave(() => hostActions.onCloseCenterPeek!()) : undefined,
    onOpenDatabaseRecord: hostActions.onOpenDatabaseRecord ? (parent, id, mode) => { peekOpener.current = document.activeElement as HTMLElement; void leave(() => hostActions.onOpenDatabaseRecord!(parent, id, mode)); } : undefined,
  };
  const rootRef=React.useRef<HTMLDivElement>(null);
  const [actionError,setActionError]=React.useState('');
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [sidebarWidth, setSidebarWidth] = React.useState(270);
  const destination=model.sidePeekPageId??model.centerPeekPageId??model.navigation?.activeId??model.selectedPageId;
  const previousDestination=React.useRef({id:destination,inspector:Boolean(inspector)});
  React.useEffect(()=>{const changed=previousDestination.current.id!==destination||(!previousDestination.current.inspector&&Boolean(inspector));previousDestination.current={id:destination,inspector:Boolean(inspector)};if(changed&&window.matchMedia('(max-width: 620px)').matches)setSidebarOpen(false);},[destination,Boolean(inspector)]);

  const resizing = React.useRef(false);
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState(false);
  const [peekSaveState,setPeekSaveState]=React.useState<'saved'|'edited'|'saving'|'failed'>('saved');
  const [centerSaveState,setCenterSaveState]=React.useState<'saved'|'edited'|'saving'|'failed'>('saved');
  const [saveState, setSaveState] = React.useState<'saved' | 'edited' | 'saving' | 'failed'>('saved');
  const [renameRequest, setRenameRequest] = React.useState<{ id: string; token: number } | null>(null);
  const page = model.pages.find((item) => item.id === model.selectedPageId);
  const peekPage = model.pages.find((item) => item.id === model.sidePeekPageId && item.id !== model.centerPeekPageId);
  const lastCenterPage = React.useRef<NotionPage|undefined>(undefined);
  const currentCenterPage = model.pages.find((item) => item.id === model.centerPeekPageId);
  const pageInPeek=page&&(page.id===peekPage?.id||page.id===currentCenterPage?.id);
  if (currentCenterPage) lastCenterPage.current = currentCenterPage;
  const centerPeekPage = currentCenterPage ?? lastCenterPage.current;
  React.useEffect(() => { setSaveState('saved'); }, [model.selectedPageId]);
  React.useEffect(()=>{if(renameRequest?.id===page?.id&&page?.database)requestAnimationFrame(()=>rootRef.current?.querySelector<HTMLTextAreaElement>('.notion-main [aria-label="Database title"]')?.focus());},[renameRequest,model.selectedPageId]);
  function recordProperties(record: NotionPage) {
    const parent = model.pages.find((item) => item.id === record.parentId);
    const database = parent?.database;
    const view = database?.views.find(item => item.id === database.activeViewId && item.rows.some(row => row.id === record.id))
      ?? database?.views.find(item => item.rows.some(row => row.id === record.id));
    const row = view?.rows.find((item) => item.id === record.id);
    return view && row && parent ? <NotionDatabaseProperties columns={notionRelationColumns(view.columns??[],actions.databaseRelationSources)} row={row} theme={model.theme} onUpdateSchema={actions.onUpdateDatabaseSchema?columns=>actions.onUpdateDatabaseSchema!(parent.id,columns):undefined} registerCellBeforeLeave={(id,column,save)=>registerBeforeLeave(`cell-${parent.id}-${id}-${column}`,save)} onUpdate={actions.onUpdateDatabaseCell ? (id, column, value) => actions.onUpdateDatabaseCell!(parent.id, id, column, value) : undefined}/> : undefined;
  }
  React.useEffect(()=>{
    const handle=async(event:KeyboardEvent)=>{
      if(event.defaultPrevented||!(event.metaKey||event.ctrlKey)||event.repeat)return;
      const active=document.activeElement;
      if(active&&active!==document.body&&!rootRef.current?.contains(active)&&!(active instanceof HTMLElement&&active.closest('[data-ui-pack="notion"]')))return;
      const selected=currentCenterPage??peekPage??page;if(!selected)return;
      try{
        if(event.key.toLowerCase()==='d'&&!event.altKey&&!event.shiftKey&&actions.onDuplicatePage){event.preventDefault();if(!await actions.onDuplicatePage(selected.id))setActionError('Could not duplicate this page.');}
        if(event.key.toLowerCase()==='l'&&event.altKey&&actions.onCopyPageLink){event.preventDefault();if(!await actions.onCopyPageLink(selected.id))setActionError('Could not copy this link.');}
      }catch{setActionError('This action could not be completed. Try again.');}
    };
    document.addEventListener('keydown',handle);return()=>document.removeEventListener('keydown',handle);
  },[page?.id,peekPage?.id,currentCenterPage?.id,actions.onDuplicatePage,actions.onCopyPageLink]);
  function selectPage(id: string) {
    actions.onSelectPage?.(id);
    if (window.matchMedia('(max-width: 620px)').matches) setSidebarOpen(false);
  }
  function renamePage(id: string) {
    if(id!==model.sidePeekPageId&&id!==model.centerPeekPageId)selectPage(id);
    setRenameRequest({ id, token: Date.now() });
  }
  async function createPage(parentId?: string, database = false, meeting?:'recording'|'note') {
    const create = meeting ? () => actions.onCreateMeeting?.(meeting) : database ? actions.onCreateDatabase : actions.onCreatePage;
    if (!create || creatingRef.current) return;
    creatingRef.current=true;
    if(!await flushAll()){creatingRef.current=false;return;}
    setCreating(true); setCreateError(false);
    try {
      const id = await create(parentId);
      if (!id) throw new Error('Page creation failed');
      if (actions.onSelectPage) selectPage(id);
      setRenameRequest({id,token:Date.now()});
    } catch { setCreateError(true); }
    finally { creatingRef.current=false;setCreating(false); }
  }
  React.useEffect(() => {
    if (peekPage?.title) requestAnimationFrame(() => peekRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
  }, [peekPage?.id]);
  React.useEffect(() => {
    if (!peekPage) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) actions.onCloseSidePeek?.();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [peekPage?.id, actions.onCloseSidePeek]);
  return <NotionNavigationGuard.Provider value={leave}><NotionDraftRegistry.Provider value={registerBeforeLeave}><NotionSyncedDraftProvider sources={model.syncedBlocks} onUpdate={hostActions.onUpdateSyncedBlock} onError={()=>setActionError("Could not save all changes. Your drafts are preserved. Try again.")}><div ref={rootRef} className={`notion-pack notion-${model.theme ?? 'light'}`} data-ui-pack="notion" style={{ '--notion-layout-sidebar': `${sidebarWidth}px` } as React.CSSProperties}>
    <NotionSidebar model={model} actions={actions} open={sidebarOpen} onClose={() => setSidebarOpen(false)} onSelectPage={selectPage} onCreatePage={createPage} onCreateDatabase={actions.onCreateDatabase ? () => void createPage(undefined, true) : undefined} onCreateMeeting={actions.onCreateMeeting ? mode=>void createPage(undefined,false,mode):undefined} onRename={renamePage} creating={creating} createError={createError} />
    {sidebarOpen && <div className="notion-sidebar-resizer" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={190} aria-valuemax={480} aria-valuenow={sidebarWidth} tabIndex={0} style={{ left: sidebarWidth - 3 }}
      onPointerDown={(event) => { resizing.current = true; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
      onPointerMove={(event) => { if (resizing.current) setSidebarWidth(Math.max(190, Math.min(480, event.clientX - event.currentTarget.parentElement!.getBoundingClientRect().left))); }}
      onPointerUp={(event) => { resizing.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { resizing.current = false; }}
      onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSidebarWidth((width) => Math.max(190, Math.min(480, width + (event.key === 'ArrowRight' ? 16 : -16)))); } }}
      onDoubleClick={() => setSidebarWidth(270)} />}
    <div className="notion-main">
      {header ?? <NotionPageChrome model={model} page={page} actions={actions} sidebarOpen={sidebarOpen} onOpenSidebar={() => setSidebarOpen(true)} onRename={renamePage} saveState={saveState} />}
      <main className="notion-canvas">{actionError&&<p className="notion-editor-error" role="alert">{actionError}<NotionButton onClick={()=>setActionError('')}>Dismiss</NotionButton></p>}{content ?? (pageInPeek ? <div className="notion-status">This page is open in {currentCenterPage?.id===page?.id?'center':'side'} peek.</div> : model.loading ? <div className="notion-status" role="status">Loading page…</div> : page?.database ? NotionDatabasePage(page, actions, model.theme, registerBeforeLeave) : page ? <NotionPageEditor registerBeforeLeave={registerBeforeLeave} resources={{pages:model.pages,actions,syncedBlocks:model.syncedBlocks,textComments:model.textComments,collaborators:model.collaborators}} properties={recordProperties(page)} key={page.id} theme={model.theme} page={page} onUpdatePage={page.locked ? undefined : actions.onUpdatePage} onUpdatePageIcon={page.locked ? undefined : actions.onUpdatePageIcon} onUploadPageIcon={page.locked ? undefined : actions.onUploadPageIcon} onSaveStateChange={setSaveState} focusTitle={renameRequest?.id === page.id ? renameRequest.token : 0} /> : <div className="notion-status">Select a page to get started</div>)}</main>
    </div>
    {inspector}
    {peekPage && <aside ref={peekRef} className="notion-side-peek" aria-label={`Side peek: ${peekPage.title || 'Untitled'}`}><NotionPageChrome model={model} page={peekPage} actions={actions} sidebarOpen onOpenSidebar={() => setSidebarOpen(true)} onRename={renamePage} saveState={peekSaveState} leading={<><NotionButton className="notion-icon-action" aria-label="Close side peek" onClick={actions.onCloseSidePeek}><ChevronsRight size={18}/></NotionButton><NotionButton className="notion-icon-action" aria-label="Open peek as full page" onClick={() => void leave(() => { hostActions.onCloseSidePeek?.(); hostActions.onSelectPage?.(peekPage.id); })}><Maximize2 size={16}/></NotionButton></>}/><div className="notion-side-peek-content">{peekPage.database?NotionDatabasePage(peekPage,actions,model.theme,registerBeforeLeave):<NotionPageEditor registerBeforeLeave={registerBeforeLeave} resources={{pages:model.pages,actions,syncedBlocks:model.syncedBlocks,textComments:model.textComments,collaborators:model.collaborators}} properties={recordProperties(peekPage)} key={peekPage.id} focusTitle={renameRequest?.id===peekPage.id?renameRequest.token:0} onSaveStateChange={setPeekSaveState} page={peekPage} theme={model.theme} onUpdatePage={peekPage.locked ? undefined : actions.onUpdatePage} onUpdatePageIcon={peekPage.locked ? undefined : actions.onUpdatePageIcon} onUploadPageIcon={peekPage.locked ? undefined : actions.onUploadPageIcon} />}</div></aside>}
    <Dialog open={Boolean(currentCenterPage)} onOpenChange={(open) => { if (!open) actions.onCloseCenterPeek?.(); }}>
      {centerPeekPage && <DialogContent className="notion-center-peek" showCloseButton={false} aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); peekOpener.current?.focus(); }}>
        <DialogTitle className="notion-ui-sr-only">Center peek: {centerPeekPage.title || 'Untitled'}</DialogTitle>
        <div className={`notion-pack notion-center-peek-body notion-${model.theme ?? 'light'}`}><NotionPageChrome model={model} page={centerPeekPage} actions={actions} sidebarOpen onOpenSidebar={()=>setSidebarOpen(true)} onRename={renamePage} saveState={centerSaveState} leading={<><NotionButton className="notion-icon-action" aria-label="Close center peek" onClick={actions.onCloseCenterPeek}><X size={17}/></NotionButton><NotionButton className="notion-icon-action" aria-label="Open peek as full page" onClick={()=>void leave(()=>{hostActions.onCloseCenterPeek?.();hostActions.onSelectPage?.(centerPeekPage.id);})}><Maximize2 size={16}/></NotionButton></>}/>
        <div className="notion-center-peek-content">{centerPeekPage.database?NotionDatabasePage(centerPeekPage,currentCenterPage?actions:{},model.theme,registerBeforeLeave):<NotionPageEditor registerBeforeLeave={registerBeforeLeave} resources={{pages:model.pages,actions,syncedBlocks:model.syncedBlocks,textComments:model.textComments,collaborators:model.collaborators}} properties={recordProperties(centerPeekPage)} key={centerPeekPage.id} focusTitle={renameRequest?.id===centerPeekPage.id?renameRequest.token:0} onSaveStateChange={setCenterSaveState} page={centerPeekPage} theme={model.theme} onUpdatePage={!currentCenterPage||centerPeekPage.locked ? undefined : actions.onUpdatePage} onUpdatePageIcon={!currentCenterPage||centerPeekPage.locked ? undefined : actions.onUpdatePageIcon} onUploadPageIcon={!currentCenterPage||centerPeekPage.locked ? undefined : actions.onUploadPageIcon}/>}</div></div>
      </DialogContent>}
    </Dialog>
    {children}
    {!sidebarOpen&&header!==undefined&&<NotionButton className="notion-mobile-open" aria-label="Open sidebar" onClick={()=>setSidebarOpen(true)}><Menu size={18}/></NotionButton>}
  </div></NotionSyncedDraftProvider></NotionDraftRegistry.Provider></NotionNavigationGuard.Provider>;
}

export function NotionFramework(props: NotionFrameworkProps) {
  return <NotionPreferencesProvider value={props.model.preferences}><NotionThemeProvider theme={props.model.theme ?? 'light'}><TooltipProvider delayDuration={350}><NotionFrameworkContent key={props.model.workspaceId??'default'} {...props} /></TooltipProvider></NotionThemeProvider></NotionPreferencesProvider>;
}
