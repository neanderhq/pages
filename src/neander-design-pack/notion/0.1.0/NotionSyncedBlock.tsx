import * as React from 'react';
import {NotionNestedBlocks,cloneNotionBlocks} from './NotionNestedBlocks';
import {NotionDocumentContext} from './NotionDocumentContext';
import {useNotionSaveGuard,useNotionNavigationGuard} from './NotionNavigationGuard';
import {NotionButton} from './NotionPrimitives';
import * as Menu from './ui/dropdown-menu';
import {Link2,Ellipsis} from './ui/icons';
import type {NotionBlock} from './NotionFramework';

type SyncedDraftSnapshot={draft:NotionBlock[];accepted:string;pending:boolean;error:boolean};
type SyncedUpdate=(id:string,blocks:NotionBlock[])=>Promise<boolean>;
type SyncedSource={id:string;blocks:NotionBlock[]};
type SyncedDraftStore={snapshot:SyncedDraftSnapshot;listeners:Set<()=>void>;flight:Promise<boolean>|null;references:Set<symbol>;update?:SyncedUpdate};
const SyncedDraftScope=React.createContext<Map<string,SyncedDraftStore>|null>(null);
function syncedStore(stores:Map<string,SyncedDraftStore>,id:string,blocks:NotionBlock[]){let store=stores.get(id);if(!store){store={snapshot:{draft:blocks,accepted:JSON.stringify(blocks),pending:false,error:false},listeners:new Set(),references:new Set(),flight:null};stores.set(id,store);}return store;}
function publishSyncedDraft(store:SyncedDraftStore,changes:Partial<SyncedDraftSnapshot>){store.snapshot={...store.snapshot,...changes};for(const listener of store.listeners)listener();}
function useSyncedDraft(store:SyncedDraftStore){const subscribe=React.useCallback((listener:()=>void)=>{store.listeners.add(listener);return()=>{store.listeners.delete(listener);};},[store]),snapshot=React.useCallback(()=>store.snapshot,[store]);return React.useSyncExternalStore(subscribe,snapshot,snapshot);}
function saveSyncedDraft(store:SyncedDraftStore,id:string):Promise<boolean>{
 if(store.flight)return store.flight;
 if(JSON.stringify(store.snapshot.draft)===store.snapshot.accepted)return Promise.resolve(true);
 if(!store.update)return Promise.resolve(false);
 publishSyncedDraft(store,{pending:true,error:false});
 const request=Promise.resolve().then(async()=>{while(JSON.stringify(store.snapshot.draft)!==store.snapshot.accepted){const value=store.snapshot.draft,accepted=JSON.stringify(value);if(!await store.update!(id,value))throw new Error('Rejected');publishSyncedDraft(store,{accepted});}return true;}).catch(()=>{publishSyncedDraft(store,{error:true});return false;}).finally(()=>{store.flight=null;publishSyncedDraft(store,{pending:false});});
 store.flight=request;return request;
}
function SyncedDraftGuard({store,id,source,update,onError}:{store:SyncedDraftStore;id:string;source?:SyncedSource;update?:SyncedUpdate;onError?:()=>void}){
 store.update=update;
 const {draft,accepted,pending,error}=useSyncedDraft(store),incoming=source?JSON.stringify(source.blocks):undefined,changed=JSON.stringify(draft)!==accepted;
 React.useEffect(()=>{const current=store.snapshot;if(incoming!==undefined&&JSON.stringify(current.draft)===current.accepted&&incoming!==current.accepted)publishSyncedDraft(store,{draft:JSON.parse(incoming),accepted:incoming});},[incoming,store]);
 async function save(){const accepted=await saveSyncedDraft(store,id);if(!accepted&&!store.references.size)onError?.();return accepted;}
 useNotionSaveGuard(`synced-source-${id}`,save,JSON.stringify(draft),changed||pending);
 React.useEffect(()=>{if(!changed||error)return;const timer=setTimeout(()=>void save(),500);return()=>clearTimeout(timer);},[store,id,draft,accepted,error]);
 return null;
}
/** Source persistence and guards survive the last mounted reference, until the workspace leaves. */
export function NotionSyncedDraftProvider({children,sources=[],onUpdate,onError}:{children:React.ReactNode;sources?:SyncedSource[];onUpdate?:SyncedUpdate;onError?:()=>void}){
 const stores=React.useRef(new Map<string,SyncedDraftStore>()),byId=new Map(sources.map(source=>[source.id,source]));
 for(const source of sources)syncedStore(stores.current,source.id,source.blocks);
 return <SyncedDraftScope.Provider value={stores.current}>{[...stores.current].map(([id,store])=><SyncedDraftGuard key={id} id={id} store={store} source={byId.get(id)} update={onUpdate} onError={onError}/>)}{children}</SyncedDraftScope.Provider>;
}

export function countSyncedReferences(blocks:NotionBlock[],id:string):number{return blocks.reduce((sum,block)=>sum+Number(block.syncedId===id)+countSyncedReferences(block.children??[],id)+(block.columnBlocks??[]).reduce((sum,column)=>sum+countSyncedReferences(column,id),0),0);}
type SyncedBlockProps={block:NotionBlock;editable:boolean;onChange:(changes:Partial<NotionBlock>)=>void};
export function NotionSyncedBlock(props:SyncedBlockProps){
 const {syncedAncestors=[]}=React.useContext(NotionDocumentContext);
 if(props.block.syncedId&&syncedAncestors.includes(props.block.syncedId))return <p role="alert" className="notion-surface-error">This synced reference creates a cycle and cannot be displayed.</p>;
 return <SyncedBlockContent {...props}/>;
}
function hasSyncedCycle(blocks:NotionBlock[],ancestors:string[],resolve:(id:string)=>NotionBlock[]):boolean{
 return blocks.some(block=>Boolean(block.syncedId&&(ancestors.includes(block.syncedId)||hasSyncedCycle(resolve(block.syncedId),[...ancestors,block.syncedId],resolve)))||hasSyncedCycle(block.children??[],ancestors,resolve)||(block.columnBlocks??[]).some(column=>hasSyncedCycle(column,ancestors,resolve)));
}
function SyncedBlockContent({block,editable,onChange}:SyncedBlockProps) {
  const context=React.useContext(NotionDocumentContext),{resources,syncedAncestors=[]}=context,guard=useNotionNavigationGuard();
  const source=resources?.syncedBlocks?.find(source=>source.id===block.syncedId);
  const fallback=React.useRef(new Map<string,SyncedDraftStore>()),shared=React.useContext(SyncedDraftScope),scope=shared??fallback.current,key=source?.id??block.syncedId??block.id;
  const store=React.useMemo(()=>syncedStore(scope,key,source?.blocks??[]),[scope,key]);
  React.useLayoutEffect(()=>{const reference=Symbol();store.references.add(reference);return()=>{store.references.delete(reference);};},[store]);
  const {draft,accepted,pending,error}=useSyncedDraft(store);
  const [cycleError,setCycleError]=React.useState(false);
  const [copyError,setCopyError]=React.useState(false),[copying,setCopying]=React.useState(false);
  const changed=JSON.stringify(draft)!==accepted;
  function setDraft(next:NotionBlock[]){if(source&&hasSyncedCycle(next,[source.id],id=>scope.get(id)?.snapshot.draft??resources?.syncedBlocks?.find(item=>item.id===id)?.blocks??[])){setCycleError(true);return;}setCycleError(false);publishSyncedDraft(store,{draft:next});}
  function save(){return saveSyncedDraft(store,key);}
  if(!source)return <div className="notion-synced-missing" role="status"><Link2 size={16}/>This synced content is unavailable.</div>;
  const locations=resources?.pages.filter(page=>countSyncedReferences(page.blocks,source.id)>0)??[];
  async function insert(target:string){if(copying)return;setCopying(true);setCopyError(false);try{let allowed=false;await guard(()=>{allowed=true;});if(!allowed)return;if(!await resources?.actions.onInsertSyncedBlock?.(target,source!.id))throw new Error('Rejected');}catch{setCopyError(true);}finally{setCopying(false);}}
  return <section className="notion-synced-block" aria-label="Synced block" aria-busy={pending}>{!shared&&<SyncedDraftGuard store={store} id={key} source={source} update={resources?.actions.onUpdateSyncedBlock}/>}<header><Menu.DropdownMenu><Menu.DropdownMenuTrigger asChild><NotionButton><Link2 size={13}/>Editing in {Math.max(0,locations.length-1)} other {locations.length===2?'page':'pages'}</NotionButton></Menu.DropdownMenuTrigger><Menu.DropdownMenuContent>{locations.map(page=><Menu.DropdownMenuItem key={page.id} onSelect={()=>void guard(()=>resources?.actions.onSelectPage?.(page.id))}>{page.title||'Untitled'}{page.id===source.sourcePageId?' (Original)':''}</Menu.DropdownMenuItem>)}</Menu.DropdownMenuContent></Menu.DropdownMenu><div><Menu.DropdownMenu><Menu.DropdownMenuTrigger asChild><NotionButton disabled={!editable||!resources?.actions.onInsertSyncedBlock||copying}>Copy and sync</NotionButton></Menu.DropdownMenuTrigger><Menu.DropdownMenuContent><Menu.DropdownMenuLabel>Copy and sync to</Menu.DropdownMenuLabel>{resources?.pages.filter(page=>!page.database).map(page=><Menu.DropdownMenuItem key={page.id} onSelect={()=>void insert(page.id)}>{page.title||'Untitled'}</Menu.DropdownMenuItem>)}</Menu.DropdownMenuContent></Menu.DropdownMenu><Menu.DropdownMenu><Menu.DropdownMenuTrigger asChild><NotionButton aria-label="Synced block actions"><Ellipsis size={14}/></NotionButton></Menu.DropdownMenuTrigger><Menu.DropdownMenuContent><Menu.DropdownMenuItem disabled={!editable||pending} onSelect={()=>{if(!changed)onChange({type:'group',children:cloneNotionBlocks(draft),syncedId:undefined});else void save().then(saved=>{if(saved)onChange({type:'group',children:cloneNotionBlocks(store.snapshot.draft),syncedId:undefined});});}}>Unsync</Menu.DropdownMenuItem></Menu.DropdownMenuContent></Menu.DropdownMenu></div></header>
    <NotionDocumentContext.Provider value={{...context,syncedAncestors:[...syncedAncestors,source.id]}}><NotionNestedBlocks label="Synced content" blocks={draft} editable={editable&&Boolean(resources?.actions.onUpdateSyncedBlock)&&!copying} onChange={setDraft}/></NotionDocumentContext.Provider>
    {cycleError&&<p role="alert" className="notion-surface-error">This synced reference creates a cycle. Your content is unchanged.</p>}
    {error&&<div className="notion-surface-error" role="alert">Could not save synced content. Your draft is preserved. <NotionButton onClick={()=>void save()}>Retry synced content</NotionButton></div>}{copyError&&<p role="alert" className="notion-surface-error">Could not copy this synced block. Try again.</p>}
  </section>;
}
