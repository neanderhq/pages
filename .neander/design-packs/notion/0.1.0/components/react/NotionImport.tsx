import * as React from 'react';
import * as Tabs from './ui/tabs';
import {FileText,Table2,Upload} from './ui/icons';
import {NotionButton} from './NotionPrimitives';

/** File conversion and persistence are host operations, including supported formats. */
export function NotionImport({onImport,accept='.md,.txt,.csv',pending,completedFiles}: {
  onImport?:(file:File)=>Promise<boolean>;accept?:string;pending:boolean;completedFiles?:{id:string;name:string}[];
}) {
  const fileRef=React.useRef<HTMLInputElement>(null),busy=React.useRef(false);
  const [tab,setTab]=React.useState('discover'),[dragging,setDragging]=React.useState(false),[failed,setFailed]=React.useState<File|null>(null),[completed,setCompleted]=React.useState<{id:string;name:string}[]>([]);
  const history=completedFiles??completed;
  async function importFile(file:File){if(!onImport||busy.current)return;busy.current=true;setFailed(null);try{if(!await onImport(file))throw new Error('Rejected');setCompleted(current=>[{id:crypto.randomUUID(),name:file.name},...current]);}catch{setFailed(file);}finally{busy.current=false;}}
  return <><p>Import data from other apps and files into Notion</p><Tabs.Tabs value={tab} onValueChange={setTab}><Tabs.TabsList variant="embedded" aria-label="Import views"><Tabs.TabsTrigger value="discover">Discover</Tabs.TabsTrigger><Tabs.TabsTrigger value="completed">Completed{history.length?` (${history.length})`:''}</Tabs.TabsTrigger></Tabs.TabsList><Tabs.TabsContent value="discover"><h2>Import your content</h2><p>Import files to turn them into pages in your workspace.</p>
    <NotionButton className="notion-import-dropzone" data-dragging={dragging} disabled={!onImport||pending} onClick={()=>fileRef.current?.click()} onDragOver={event=>{event.preventDefault();if(onImport&&!pending){event.dataTransfer.dropEffect='copy';setDragging(true);}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false);}} onDrop={event=>{event.preventDefault();setDragging(false);const file=event.dataTransfer.files[0];if(file&&onImport&&!pending)void importFile(file);}}><Upload size={24}/><strong>{pending?'Importing…':'Import your content to Notion'}</strong><span>Drag and drop a file, or choose a file</span></NotionButton>
    <h2>File-based imports</h2><div className="notion-import-formats">{[{extensions:['.csv'],title:'CSV',description:'Import structured data from spreadsheets.',Icon:Table2},{extensions:['.txt','.md'],title:'Text & Markdown',description:'Import plain text and formatted notes.',Icon:FileText}].filter(format=>!accept||format.extensions.some(extension=>accept.includes(extension))).map(({title,description,Icon})=><NotionButton key={title} variant="outline" disabled={!onImport||pending} onClick={()=>fileRef.current?.click()}><span><Icon size={18}/>{title}</span><small>{description}</small></NotionButton>)}</div>
    {failed&&<div className="notion-import-retry"><span>{failed.name}</span><NotionButton disabled={pending} onClick={()=>void importFile(failed)}>Retry import</NotionButton></div>}
    </Tabs.TabsContent><Tabs.TabsContent value="completed">{history.length?<ul className="notion-import-completed">{history.map(file=><li key={file.id}><FileText size={16}/><span>{file.name}</span><small>Completed</small></li>)}</ul>:<div className="notion-settings-empty">No completed imports</div>}</Tabs.TabsContent></Tabs.Tabs>
    <input ref={fileRef} type="file" hidden aria-label="Import content file" accept={accept} disabled={!onImport||pending} onChange={event=>{const file=event.target.files?.[0];if(file)void importFile(file);event.target.value='';}}/>
  </>;
}
