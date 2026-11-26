import {notionFormSelections,encodeNotionSelections} from './NotionFormModel';
import type {NotionChartPalette} from './NotionChartColors';
import {NotionPropertyPill,NotionPropertyValue,NotionPropertyPerson,notionPropertyLabel} from './NotionPropertyValue';
import type {NotionFormQuestion} from './NotionFormModel';
import {useNotionDatabaseSettings} from './NotionDatabaseState';
import {NotionChoicePicker} from './NotionChoicePicker';
import type {NotionTimelineScale} from './NotionTimeline';
import {sortNotionRows,type NotionSortRule} from './NotionDatabaseSorts';
import {useNotionPreferences,notionNumber} from './NotionPreferences';
import type {NotionDateRange} from './NotionTimelineRange';
import {NotionColumnResize,NotionDatabaseSummary,type NotionCalculation} from './NotionDatabaseTable';
import {matchNotionRule,matchNotionGroup,type NotionFilterGroup} from './NotionDatabaseQuery';
import { NotionBoard,type NotionBoardMove } from './NotionBoard';
import { NotionDatabaseForm } from './NotionDatabaseForm';
import { NotionDatabaseViewMenu } from './NotionDatabaseViewMenu';
import { useNotionNavigationGuard,useNotionBeforeUnload } from './NotionNavigationGuard';
import type { NotionPage, NotionFrameworkActions } from './NotionFramework';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import { Checkbox } from './ui/checkbox';
import { NotionCreateView, NotionViewIcon, NotionDatabaseAlternateView } from './NotionDatabaseViews';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import * as React from 'react';
import * as PopoverPrimitive from './ui/popover';
import * as TabsPrimitive from './ui/tabs';
import { ChevronDown, FileText, Plus, Type } from "./ui/icons";
import { NotionButton } from './NotionPrimitives';
import { NotionDatabaseTools, NotionPropertyMenu, NotionPropertyIcon, type NotionDatabaseSort, type NotionDatabaseFilter } from './NotionDatabaseControls';

export type NotionDatabaseOpenMode = 'side-peek' | 'center-peek' | 'full-page';
export type NotionTagColor = 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red';
export type NotionFormulaPreview={valid:boolean;result?:string;error?:string};
export type NotionRelationSource={id:string;name:string;properties:{id:string;label:string}[];records:{id:string;title:string}[]};
export type NotionDatabaseColumn = { includeTime?:boolean; relationDatabaseId?:string;relationRecords?:{id:string;title:string}[];rollup?:{relationId:string;propertyId:string;calculation:'count'|'sum'|'average'|'min'|'max'|'show-original'}; id: string; label: string; people?:{id:string;name:string;avatarUrl?:string}[];required?:boolean;kind?: 'text' | 'select' | 'status' | 'multi-select' | 'number' | 'date' | 'checkbox' | 'url' | 'email' | 'phone' | 'person' | 'formula' | 'rollup' | 'relation'; formula?:string; options?: string[]; optionColors?: Partial<Record<string,NotionTagColor>>; editable?: boolean };
export type NotionDatabaseRow = { id: string; title: string; values: Record<string, string>; groupId?: string; coverUrl?:string; preview?:string };
export type NotionDatabaseViewSettings={timelineShowTable?:boolean;timelineScale?:NotionTimelineScale;timelineDate?:string;sorts?:NotionSortRule[];filterTree?:NotionFilterGroup;hiddenColumnIds?:string[];columnOrder?:string[];columnWidths?:Record<string,number>;calculations?:Record<string,NotionCalculation>;query:string;sort:NotionDatabaseSort;filter:NotionDatabaseFilter;filters?:NonNullable<NotionDatabaseFilter>[];filterMode?:'and'|'or';verticalLines?:boolean;wrap?:boolean;showPageIcon?:boolean};
export type NotionChartConfig={kind:'bar'|'horizontal-bar'|'line'|'donut'|'number';aggregation:'count'|'sum'|'average'|'min'|'max'|'unique';valueColumnId?:string;xColumnId?:string;groupColumnId?:string;sort?:'manual'|'name-asc'|'name-desc'|'value-asc'|'value-desc';palette?:NotionChartPalette;showLegend?:boolean;showLabels?:boolean;grid?:boolean;cumulative?:boolean;stacked?:boolean;omitZero?:boolean;hiddenGroups?:string[];xLabel?:string;yLabel?:string;dateUnit?:'day'|'week'|'month'|'year';height?:'small'|'medium'|'large'};
export type NotionFormConfig={questions?:NotionFormQuestion[];canUseConditionalLogic?:boolean;conditionalUnavailableReason?:string;accessLabel?:string;title?:string;description?:string;confirmationTitle?:string;confirmationBody?:string;buttonLabel?:string;published?:boolean;url?:string;acceptingResponses?:boolean};
export type NotionDependency={predecessorId:string;successorId:string};
export type NotionDatabaseView = { dependencies?:NotionDependency[];dependencyShift?:'overlap'|'none';form?:NotionFormConfig;settings?:NotionDatabaseViewSettings;
  chart?:NotionChartConfig;
  todayDate?:string;id: string; name: string; kind: 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline' | 'feed' | 'chart' | 'form'; dateColumnId?:string;endDateColumnId?:string;groupColumnId?:string;calendarDate?:string;openMode?: NotionDatabaseOpenMode;
  columns?: NotionDatabaseColumn[]; groups?: { id: string; label: string }[]; rows: NotionDatabaseRow[];
};
export type NotionDatabaseModel = { activeViewId: string; views: NotionDatabaseView[] };

const openModeLabels: Record<NotionDatabaseOpenMode, string> = { 'side-peek': 'Side peek', 'center-peek': 'Center peek', 'full-page': 'Full page' };

/** Current host sources supersede embedded relation-choice snapshots. */
export function notionRelationColumns(columns:NotionDatabaseColumn[],sources?:NotionRelationSource[]){
  if(!sources)return columns;
  return columns.map(column=>column.kind==='relation'&&column.relationDatabaseId?{...column,relationRecords:sources.find(source=>source.id===column.relationDatabaseId)?.records??[]}:column);
}

function DatabaseCell({ row, column, value, theme, onUpdate, onCreateOption, registerBeforeLeave }: {
  row: NotionDatabaseRow; column: NotionDatabaseColumn; value: string; theme: 'light' | 'dark';
  onUpdate?: (rowId: string, columnId: string, value: string) => Promise<boolean>;
  onCreateOption?: (label:string)=>Promise<boolean>;
  registerBeforeLeave?: (save: () => Promise<boolean>) => () => void;
}) {
  const preferences=useNotionPreferences();
  const editable = Boolean(column.editable && onUpdate && column.kind!=='formula' && column.kind!=='rollup');
  const [editing,setEditing]=React.useState(false),[draft,setDraft]=React.useState(value),[pending,setPending]=React.useState(false),[error,setError]=React.useState(false),[open,setOpen]=React.useState(false);
  useNotionBeforeUnload((editing&&draft!==value)||pending);
  const inFlight=React.useRef<Promise<boolean>|null>(null),cancelled=React.useRef(false);
  React.useEffect(()=>{if(!editing)setDraft(value);},[value,editing]);
  function commit(next:string):Promise<boolean>{
    if(inFlight.current)return inFlight.current;
    if((column.kind==='number'&&next.trim()&&!Number.isFinite(Number(next)))||(column.kind==='date'&&next&&(!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(next)||!Number.isFinite(Date.parse(next))))){setError(true);return Promise.resolve(false);}
    if(!onUpdate||next===value){setEditing(false);setError(false);return Promise.resolve(true);}
    setPending(true);setError(false);
    const request=Promise.resolve().then(()=>onUpdate(row.id,column.id,next)).then(accepted=>{
      if(!accepted)throw new Error('Cell update rejected');setEditing(false);if(!['multi-select','relation','person'].includes(column.kind??''))setOpen(false);return true;
    }).catch(()=>{setError(true);if(!['select','status','multi-select','relation','person','checkbox'].includes(column.kind??''))setEditing(true);return false;}).finally(()=>{inFlight.current=null;setPending(false);});
    inFlight.current=request;return request;
  }
  function createOption(label:string):Promise<boolean>{
    if(!onCreateOption)return Promise.resolve(false);
    if(inFlight.current)return inFlight.current;
    setPending(true);setError(false);
    const request=Promise.resolve().then(()=>onCreateOption(label)).then(async accepted=>{
      inFlight.current=null;if(!accepted){setError(true);return false;}
      const selected=notionFormSelections(value);
      return commit(column.kind==='multi-select'?encodeNotionSelections([...new Set([...selected,label])]):label);
    }).catch(()=>{setError(true);return false;}).finally(()=>{if(inFlight.current===request)inFlight.current=null;setPending(false);});
    inFlight.current=request;return request;
  }
  React.useLayoutEffect(()=>{
    if(!editing&&!pending)return;
    return registerBeforeLeave?.(()=>cancelled.current?Promise.resolve(true):commit(draft));
  },[editing,pending,draft,value,registerBeforeLeave]);
  const pill=(value:string)=><NotionPropertyPill column={column} value={value}/>;
  const isSelect=['select','status','relation','multi-select'].includes(column.kind??'')||(column.kind==='person'&&Boolean(column.people?.length||column.options?.length));
  const display=(isSelect||column.kind==='person')&&value?<NotionPropertyValue column={column} value={value}/>:<span className={`notion-cell-value ${!value?'is-empty':''}`}>{(column.kind==='number'?notionNumber(value,preferences.numberFormat):value)||(editable?'Empty':'')}</span>;
  if(column.kind==='checkbox')return <><Checkbox aria-label={`Edit ${column.label} for ${row.title}`} checked={value==='true'} disabled={!editable||pending} onCheckedChange={checked=>void commit(String(checked===true))}/>{error&&<span role="alert" className="notion-cell-error">Could not update. Try again.</span>}</>;
  if(isSelect&&editable){
    const multiple=['multi-select','relation','person'].includes(column.kind??'');
    const options=column.kind==='relation'&&column.relationRecords?column.relationRecords.map(record=>({id:record.id,label:record.title})):column.kind==='person'&&column.people?.length?column.people.map(person=>({id:person.id,label:person.name})):(column.options??[]).map(id=>({id,label:id}));
    return <PopoverPrimitive.Popover open={open} onOpenChange={next=>{if(!pending)setOpen(next);}}><PopoverPrimitive.PopoverTrigger asChild><NotionButton className="notion-database-cell-button" aria-label={`Edit ${column.label} for ${row.title}`}>{display}<ChevronDown size={13} className="notion-cell-chevron"/></NotionButton></PopoverPrimitive.PopoverTrigger><PopoverPrimitive.PopoverContent className={`notion-cell-options notion-${theme}`} sideOffset={4} align="start"><NotionChoicePicker label={column.label} options={options} selected={multiple?notionFormSelections(value):value?[value]:[]} multiple={multiple} pending={pending} error={error} renderOption={id=>column.kind==='person'?<NotionPropertyPerson column={column} value={id}/>:pill(id)} onChoose={option=>{const selected=notionFormSelections(value);void commit(!option?'':multiple?encodeNotionSelections(selected.includes(option)?selected.filter(item=>item!==option):[...selected,option]):option);}} onCreate={onCreateOption?createOption:undefined}/></PopoverPrimitive.PopoverContent></PopoverPrimitive.Popover>;
  }
  if(editing&&editable){const fieldProps={className:'notion-cell-input','aria-label':`Edit ${column.label} for ${row.title}`,value:draft,disabled:pending,autoFocus:true,onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>{cancelled.current=false;setDraft(event.target.value);setError(false);},onKeyDown:(event:React.KeyboardEvent<HTMLInputElement|HTMLTextAreaElement>)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void commit(draft);}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelled.current=true;setEditing(false);setError(false);}},onBlur:()=>{if(!error&&!cancelled.current)void commit(draft);}};return <div className="notion-cell-edit-wrap">{!column.kind||column.kind==='text'?<Textarea {...fieldProps} rows={Math.min(6,Math.max(1,draft.split('\n').length))}/>:<Input {...fieldProps} value={column.kind==='date'&&column.includeTime&&/^\d{4}-\d{2}-\d{2}$/.test(draft)?`${draft}T00:00`:draft} type={column.kind==='number'?'number':column.kind==='date'?(column.includeTime||draft.includes('T')?'datetime-local':'date'):column.kind==='email'?'email':column.kind==='url'?'url':'text'}/>} {error&&<NotionButton className="notion-cell-error" aria-label="Retry cell update" onClick={()=>void commit(draft)}>Retry</NotionButton>}</div>;}

  return editable?<NotionButton className="notion-database-cell-button" aria-label={`Edit ${column.label} for ${row.title}`} onClick={()=>{cancelled.current=false;setDraft(value);setEditing(true);}}>{display}</NotionButton>:display;
}

export function NotionDatabaseProperties({ columns, row, theme = 'light', onUpdate, onUpdateSchema, registerCellBeforeLeave }: {
  columns: NotionDatabaseColumn[]; row: NotionDatabaseRow; theme?: 'light' | 'dark';
  onUpdate?: (rowId: string, columnId: string, value: string) => Promise<boolean>;
  onUpdateSchema?: (columns:NotionDatabaseColumn[])=>Promise<boolean>;
  registerCellBeforeLeave?: (rowId:string,columnId:string,save:()=>Promise<boolean>)=>()=>void;
}) {
  return <dl className="notion-record-properties" aria-label="Page properties">{columns.map((column) => <div className="notion-record-property" key={column.id}><dt><NotionPropertyIcon column={column}/>{column.label}</dt><dd><DatabaseCell row={row} column={column} value={row.values[column.id] ?? ''} theme={theme} onUpdate={onUpdate} onCreateOption={onUpdateSchema&&['select','multi-select','status'].includes(column.kind??'')?label=>onUpdateSchema(columns.map(item=>item.id===column.id?{...item,options:[...new Set([...(item.options??[]),label])]}:item)):undefined} registerBeforeLeave={registerCellBeforeLeave ? save=>registerCellBeforeLeave(row.id,column.id,save):undefined}/></dd></div>)}</dl>;
}

function DatabaseTitle({ title, onRename, registerBeforeLeave }: { title: string; onRename: (title: string) => Promise<boolean>; registerBeforeLeave?: (save: () => Promise<boolean>) => () => void }) {
  const [draft, setDraft] = React.useState(title);
  const [error, setError] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const accepted=React.useRef(title),incomingTitle=React.useRef(title);incomingTitle.current=title;
  React.useEffect(() => {accepted.current=title;setDraft(title);}, [title]);
  useNotionBeforeUnload(draft!==accepted.current||pending);
  const inFlight = React.useRef<Promise<boolean> | null>(null);
  function commit(): Promise<boolean> {
    if (inFlight.current) return inFlight.current;
    if (draft === title) return Promise.resolve(true);
    setPending(true); setError(false);
    const request = (async () => {
      try { if (!await onRename(draft)) throw new Error('Rename rejected');if(incomingTitle.current===title)accepted.current=draft;return true; }
      catch { setError(true); return false; }
      finally { inFlight.current = null; setPending(false); }
    })();
    inFlight.current = request;
    return request;
  }
  React.useLayoutEffect(() => registerBeforeLeave?.(commit), [draft, title, onRename, registerBeforeLeave]);
  return <><Textarea className="notion-database-title" aria-label="Database title" placeholder="New database" value={draft} autoFocus={!title} rows={1} disabled={pending} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}/>{error && <p role="alert" className="notion-database-error">Could not rename the database. <NotionButton onClick={() => void commit()}>Retry</NotionButton></p>}</>;
}

export function NotionDatabase({ title, showTitle=true, model, theme = 'light', onSelectView, onSetOpenMode, onOpenRecord, onCreateRecord, onUpdateCell, onRename, registerBeforeLeave, onUpdateSchema, registerCellBeforeLeave, onUpdateViewSettings, onCreateView, onUpdateView, onDeleteView, onMoveRecord, relationSources, onPreviewFormula, onUpdateDates,onPublishForm,onUpdateForm,onUpdateFormQuestions,onSubmitForm }: {
  title: string; showTitle?:boolean; model: NotionDatabaseModel; theme?: 'light' | 'dark';
  onSubmitForm?:(viewId:string,values:Record<string,string>)=>Promise<string|null>;
  onUpdateFormQuestions?:(viewId:string,form:NotionFormConfig)=>Promise<boolean>;
  onUpdateForm?:(viewId:string,definition:{form:NotionFormConfig;columns:NotionDatabaseColumn[]})=>Promise<boolean>;
  onPublishForm?:(viewId:string,published:boolean)=>Promise<boolean>;
  onUpdateDates?:(id:string,range:NotionDateRange,startColumnId:string,endColumnId?:string)=>Promise<boolean>;
  relationSources?:NotionRelationSource[];onPreviewFormula?:(formula:string)=>Promise<NotionFormulaPreview>;
  onSelectView?: (viewId: string) => void;
  onSetOpenMode?: (viewId: string, mode: NotionDatabaseOpenMode) => void;
  onMoveRecord?:(id:string,move:NotionBoardMove)=>Promise<boolean>;
  onOpenRecord?: (rowId: string, mode: NotionDatabaseOpenMode) => void;
  onCreateRecord?: (values?:Record<string,string>,groupId?:string) => Promise<string | null>;
  onUpdateCell?: (rowId: string, columnId: string, value: string) => Promise<boolean>;
  onCreateView?: (name:string,kind:NotionDatabaseView['kind'])=>Promise<boolean>;
  onUpdateView?:(view:NotionDatabaseView)=>Promise<boolean>;onDeleteView?:(id:string)=>Promise<boolean>;
  onRename?: (title: string) => Promise<boolean>;
  registerBeforeLeave?: (save: () => Promise<boolean>) => () => void;
  onUpdateSchema?: (columns:NotionDatabaseColumn[])=>Promise<boolean>;
  onUpdateViewSettings?: (viewId:string,settings:NotionDatabaseViewSettings)=>Promise<boolean>|void;
  registerCellBeforeLeave?: (rowId:string,columnId:string,save:()=>Promise<boolean>)=>()=>void;
}) {
  const guard=useNotionNavigationGuard();
  const [formToolbar,setFormToolbar]=React.useState<HTMLDivElement|null>(null);
  function openRecord(id:string,mode:NotionDatabaseOpenMode){void guard(()=>onOpenRecord?.(id,mode));}
  const [formDrafts,setFormDrafts]=React.useState<Record<string,Record<string,string>>>({});
  const [creating, setCreating] = React.useState(false);
  const creatingRef=React.useRef(false);
  const [error, setError] = React.useState(false);
  const active = React.useMemo(()=>{
    const view=model.views.find(view=>view.id===model.activeViewId)??model.views[0];
    return view?{...view,columns:notionRelationColumns(view.columns??[],relationSources)}:undefined;
  },[model.views,model.activeViewId,relationSources]);
  const openMode = active?.openMode ?? 'side-peek';
  const {settings,change:changeSettings,pending:settingsPending,error:settingsError,retry:retrySettings,discard:discardSettings}=useNotionDatabaseSettings(model,onUpdateViewSettings);
  const menuView=React.useMemo(()=>active?{...active,settings}:active,[active,settings]);
  const [resizingWidths,setResizingWidths]=React.useState<Record<string,number>>({});
  React.useEffect(()=>setResizingWidths({}),[active?.id]);
  const displayColumns=[...(active?.columns??[])].filter(column=>!settings.hiddenColumnIds?.includes(column.id)).sort((a,b)=>{const order=settings.columnOrder??(active?.columns??[]).map(column=>column.id);return order.indexOf(a.id)-order.indexOf(b.id);});
  const widthFor=(id:string)=>resizingWidths[id]??settings.columnWidths?.[id];
  const resize=(id:string,label:string)=><NotionColumnResize label={label} width={widthFor(id)} onPreview={width=>setResizingWidths(current=>({...current,[id]:width}))} onCommit={width=>{setResizingWidths(current=>({...current,[id]:width}));changeSettings({columnWidths:{...settings.columnWidths,[id]:width}});}}/>;

  const filters=[...(settings.filter?[settings.filter]:[]),...(settings.filters??[])];
  function match(row:NotionDatabaseRow,filter:NonNullable<NotionDatabaseFilter>){return matchNotionRule(row,active?.columns?.find(column=>column.id===filter.columnId),{...filter,operator:filter.operator??'contains'});}
  const searchableColumns=(active?.columns??[]).filter(column=>['person','relation'].includes(column.kind??'')),searchQuery=settings.query.toLowerCase();
  function matchesSearch(row:NotionDatabaseRow){
    if(!searchQuery)return true;
    const labels=searchableColumns.flatMap(column=>notionFormSelections(row.values[column.id]??'').map(value=>notionPropertyLabel(column,value)));
    return [row.title,...Object.values(row.values),...labels].join(' ').toLowerCase().includes(searchQuery);
  }
  let rows=(active?.rows??[]).filter(row=>matchesSearch(row)&&(!settings.filterTree||matchNotionGroup(row,active?.columns??[],settings.filterTree))&&(!filters.length||(settings.filterMode==='or'?filters.some(filter=>match(row,filter)):filters.every(filter=>match(row,filter)))));
  const groupingColumn=active?.columns?.find(column=>column.id===active.groupColumnId);
  const groupFor=(row:NotionDatabaseRow)=>{if(!groupingColumn)return active?.groups?.length?row.groupId:'';const value=row.values[groupingColumn.id]??'';if(!['person','multi-select','relation'].includes(groupingColumn.kind??''))return value;const selected=notionFormSelections(value);return selected.length?selected:[''];};
  const configuredGroups=groupingColumn?(groupingColumn.kind==='person'&&groupingColumn.people?.length?groupingColumn.people.map(person=>({id:person.id,label:person.name})):(groupingColumn.options??[]).map(value=>({id:value,label:notionPropertyLabel(groupingColumn,value)}))):[];
  const groupedValues=[...new Set((active?.rows??[]).flatMap(row=>{const value=groupFor(row);return Array.isArray(value)?value:value?[value]:[];}))];
  const unmatchedGroups=groupingColumn?groupedValues.filter(value=>value&&!configuredGroups.some(group=>group.id===value)).map(value=>({id:value,label:notionPropertyLabel(groupingColumn,value)})):[];
  const groups=groupingColumn?[...configuredGroups,...unmatchedGroups,{id:'',label:'No '+groupingColumn.label}]:(active?.groups?.length?active.groups:[{id:'',label:'All records'}]);
  rows=sortNotionRows(rows,active?.columns??[],settings.sorts??(settings.sort?[settings.sort]:[]));
  async function createRecord(values?:Record<string,string>,groupId?:string) {
    if (!onCreateRecord || creatingRef.current) return;
    creatingRef.current=true;let allowed=false;await guard(()=>{allowed=true;});if(!allowed){creatingRef.current=false;return;}
    setCreating(true); setError(false);
    try { const id = await onCreateRecord(values,groupId); if (!id) throw new Error('Record creation failed'); openRecord(id, openMode); }
    catch { setError(true); }
    finally { creatingRef.current=false;setCreating(false); }
  }
  function createGroupedRecord(groupId:string){
    const value=groupingColumn&&['person','multi-select','relation'].includes(groupingColumn.kind??'')?encodeNotionSelections(groupId?[groupId]:[]):groupId;
    return createRecord(groupingColumn?{[groupingColumn.id]:value}:undefined,groupId);
  }
  return <section className="notion-database" aria-label={`${title} database`}>
    {showTitle&&(onRename ? <DatabaseTitle title={title} onRename={onRename} registerBeforeLeave={registerBeforeLeave}/> : <h1>{title || 'Untitled'}</h1>)}
    {!active&&<div className="notion-database-empty"><p>No database views yet</p>{onCreateView&&<NotionCreateView onCreate={onCreateView}/>}</div>}
    {active && <TabsPrimitive.Tabs value={active.id} onValueChange={(value) => void guard(()=>onSelectView?.(value))}>
      <div className="notion-database-toolbar"><TabsPrimitive.TabsList variant="embedded" aria-label="Database views" className="notion-database-tabs">
        {model.views.map((view) => <TabsPrimitive.TabsTrigger key={view.id} value={view.id} disabled={!onSelectView && view.id !== active.id} className="notion-database-tab"><NotionViewIcon kind={view.kind}/>{view.name}</TabsPrimitive.TabsTrigger>)}
      </TabsPrimitive.TabsList>{onCreateView&&<NotionCreateView onCreate={onCreateView}/>}{(onUpdateView||onDeleteView)&&<NotionDatabaseViewMenu key={`menu-${active.id}`} view={menuView!} onUpdate={onUpdateView} onDelete={onDeleteView&&model.views.length>1?()=>onDeleteView(active.id):undefined}/>}
        {active.kind==='form'&&<div className="notion-form-toolbar-slot" ref={setFormToolbar}/>}
        {active.kind!=='form'&&<NotionDatabaseTools key={`tools-${active.id}`} columns={active.columns??[]} layout={settings} onLayout={changes=>changeSettings(changes)} query={settings.query} onQuery={query=>changeSettings({query})} sort={settings.sort} filter={settings.filter} onFilter={filter=>changeSettings({filter})} openMode={openMode} onSetOpenMode={onSetOpenMode?mode=>onSetOpenMode(active.id,mode):undefined}/>}
        {onCreateRecord && active.kind!=='form'&&<NotionButton variant="default" disabled={creating} onClick={() => void createRecord()}><Plus size={15} />New</NotionButton>}
      </div>
      {settingsError&&<p role="alert" className="notion-database-error">Could not save view settings. Your changes are preserved. <NotionButton onClick={()=>void retrySettings()} disabled={settingsPending}>Retry view settings</NotionButton><NotionButton disabled={settingsPending} onClick={discardSettings}>Discard view changes</NotionButton></p>}
    {error && <p className="notion-database-error" role="alert">Could not create the item. Try again.</p>}
      <TabsPrimitive.TabsContent value={active.id}>
      {active.kind === 'table' ? <div className="notion-database-table-scroll"><Table style={Object.keys(settings.columnWidths??{}).length||Object.keys(resizingWidths).length?{width:Math.max(640,(widthFor('name')??260)+displayColumns.reduce((total,column)=>total+(widthFor(column.id)??160),0)+(onUpdateSchema?40:0))}:undefined} className={`notion-database-table ${settings.verticalLines!==false?'notion-table-has-lines':''} ${settings.wrap?'notion-table-wrap':''}`}><TableHeader><TableRow><TableHead scope="col" style={widthFor('name')?{width:widthFor('name')}:undefined}><span className="notion-property-name"><Type size={15}/>Name</span>{resize('name','Name')}</TableHead>{displayColumns.map((column) => <TableHead scope="col" key={column.id} style={widthFor(column.id)?{width:widthFor(column.id)}:undefined}><NotionPropertyMenu column={column} columns={active.columns??[]} relationSources={relationSources} onPreviewFormula={onPreviewFormula} onUpdate={onUpdateSchema} onSort={sort=>changeSettings({sort,sorts:sort?[sort]:[]})} onFilter={filter=>changeSettings({filter})}/>{resize(column.id,column.label)}</TableHead>)}{onUpdateSchema&&<TableHead className="notion-property-add"><NotionPropertyMenu columns={active.columns??[]} relationSources={relationSources} onPreviewFormula={onPreviewFormula} onUpdate={onUpdateSchema} onSort={sort=>changeSettings({sort,sorts:sort?[sort]:[]})} onFilter={filter=>changeSettings({filter})}/></TableHead>}</TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell><div className="notion-cell-name">{onOpenRecord ? <><NotionButton className="notion-cell-title" onClick={() => openRecord(row.id, openMode)}>{settings.showPageIcon!==false&&<FileText size={15}/>}<span className="notion-truncate">{row.title || 'Untitled'}</span></NotionButton><NotionButton className="notion-cell-open" aria-label={`Open ${row.title || 'Untitled'} in ${openModeLabels[openMode]}`} onClick={() => openRecord(row.id, openMode)}>OPEN</NotionButton></> : <span>{row.title || 'Untitled'}</span>}</div></TableCell>{displayColumns.map((column) => <TableCell key={column.id}><DatabaseCell row={row} column={column} value={row.values[column.id] ?? ''} theme={theme} onUpdate={onUpdateCell} onCreateOption={onUpdateSchema&&['select','multi-select','status'].includes(column.kind??'')?label=>onUpdateSchema((active.columns??[]).map(item=>item.id===column.id?{...item,options:[...new Set([...(item.options??[]),label])]}:item)):undefined} registerBeforeLeave={registerCellBeforeLeave?save=>registerCellBeforeLeave(row.id,column.id,save):undefined}/></TableCell>)}{onUpdateSchema&&<TableCell/>}</TableRow>)}</TableBody><NotionDatabaseSummary columns={displayColumns} rows={rows} calculations={settings.calculations} onChange={(id,value)=>changeSettings({calculations:{...settings.calculations,[id]:value}})} extraColumn={Boolean(onUpdateSchema)}/></Table>{rows.length === 0 && <p className="notion-database-empty">No items yet</p>}{onCreateRecord && <NotionButton className="notion-database-new-row" disabled={creating} onClick={() => void createRecord()}><Plus size={15} /> New page</NotionButton>}</div>
        : active.kind==='form'?<NotionDatabaseForm key={active.id} view={active} toolbar={formToolbar} onUpdateDefinition={onUpdateForm?definition=>onUpdateForm(active.id,definition):onUpdateFormQuestions?definition=>onUpdateFormQuestions(active.id,definition.form):onUpdateView?definition=>onUpdateView({...active,...definition}):undefined} canUpdateProperties={Boolean(onUpdateForm)} onPublish={onPublishForm?published=>onPublishForm(active.id,published):undefined} draft={formDrafts[active.id]??{}} onDraftChange={values=>setFormDrafts(current=>({...current,[active.id]:values}))} onSubmit={onSubmitForm?values=>onSubmitForm(active.id,values):onCreateRecord} onUpdateSchema={onUpdateSchema}/>:active.kind!=='board'?<NotionDatabaseAlternateView key={active.id} view={{...active,settings}} rows={rows} onLayout={changeSettings} onUpdateView={onUpdateView} onUpdateDates={onUpdateDates} onOpen={onOpenRecord?id=>openRecord(id,openMode):undefined} onCreate={onCreateRecord?values=>void createRecord(values):undefined}/>: <NotionBoard groupColumn={groupingColumn} rows={rows} groups={groups} groupFor={groupFor} groupColumnId={groupingColumn?.id} onMove={onMoveRecord} onOpen={onOpenRecord?id=>openRecord(id,openMode):undefined} onCreate={onCreateRecord?groupId=>void createGroupedRecord(groupId):undefined}/>}
      </TabsPrimitive.TabsContent>
    </TabsPrimitive.Tabs>}
  </section>;
}

export function NotionDatabasePage(page: NotionPage, actions: NotionFrameworkActions, theme?: 'light' | 'dark', registerBeforeLeave?: (id: string, save: () => Promise<boolean>) => () => void, linked?:{viewId:string;onSelectView:(id:string)=>void},showTitle=true) {
  return <NotionDatabase key={page.id} title={page.title} showTitle={showTitle} model={linked?{...page.database!,activeViewId:linked.viewId}:page.database!} theme={theme} registerBeforeLeave={registerBeforeLeave ? (save) => registerBeforeLeave(`database-${page.id}`, save) : undefined}
    onMoveRecord={actions.onMoveDatabaseRecord?(id,move)=>actions.onMoveDatabaseRecord!(page.id,id,move):undefined}
    onSubmitForm={actions.onSubmitDatabaseForm?(viewId,values)=>actions.onSubmitDatabaseForm!(page.id,viewId,values):undefined}
    onUpdateFormQuestions={actions.onUpdateDatabaseFormQuestions?(viewId,form)=>actions.onUpdateDatabaseFormQuestions!(page.id,viewId,form):undefined}
    onUpdateForm={actions.onUpdateDatabaseForm?(viewId,definition)=>actions.onUpdateDatabaseForm!(page.id,viewId,definition):undefined}
    onPublishForm={actions.onSetDatabaseFormPublished?(viewId,published)=>actions.onSetDatabaseFormPublished!(page.id,viewId,published):undefined}
    onUpdateView={actions.onUpdateDatabaseView?view=>actions.onUpdateDatabaseView!(page.id,view):undefined}
    onDeleteView={actions.onDeleteDatabaseView?id=>actions.onDeleteDatabaseView!(page.id,id):undefined}
    onCreateView={actions.onCreateDatabaseView?(name,kind)=>actions.onCreateDatabaseView!(page.id,name,kind):undefined}
    onUpdateViewSettings={actions.onUpdateDatabaseViewSettings?(view,settings)=>actions.onUpdateDatabaseViewSettings!(page.id,view,settings):undefined}
    onUpdateSchema={actions.onUpdateDatabaseSchema ? columns=>actions.onUpdateDatabaseSchema!(page.id,columns):undefined}
    registerCellBeforeLeave={registerBeforeLeave?(row,column,save)=>registerBeforeLeave(`cell-${page.id}-${row}-${column}`,save):undefined}
    onRename={!page.locked&&actions.onUpdatePage ? (title) => actions.onUpdatePage!(page.id, { title, blocks: page.blocks }) : undefined}
    onUpdateDates={actions.onUpdateDatabaseRecordDates?(id,range,startColumnId,endColumnId)=>actions.onUpdateDatabaseRecordDates!(page.id,id,range,startColumnId,endColumnId):undefined}
    relationSources={actions.databaseRelationSources} onPreviewFormula={actions.onPreviewDatabaseFormula?formula=>actions.onPreviewDatabaseFormula!(page.id,formula):undefined}
    onSelectView={linked?linked.onSelectView:actions.onSelectDatabaseView ? (id) => actions.onSelectDatabaseView!(page.id, id) : undefined}
    onSetOpenMode={actions.onSelectDatabaseOpenMode ? (id, mode) => actions.onSelectDatabaseOpenMode!(page.id, id, mode) : undefined}
    onOpenRecord={actions.onOpenDatabaseRecord ? (id, mode) => actions.onOpenDatabaseRecord!(page.id, id, mode) : undefined}
    onCreateRecord={actions.onCreateDatabaseRecord ? (values,groupId) => actions.onCreateDatabaseRecord!(page.id,values,groupId) : undefined}
    onUpdateCell={actions.onUpdateDatabaseCell ? (id, column, value) => actions.onUpdateDatabaseCell!(page.id, id, column, value) : undefined}/>;
}
