import * as React from 'react';
import {useNotionSaveGuard} from './NotionNavigationGuard';
import type {NotionDatabaseModel,NotionDatabaseViewSettings} from './NotionDatabase';

const empty:NotionDatabaseViewSettings={query:'',sort:null,filter:null};
type Draft={value:NotionDatabaseViewSettings;accepted:string;incoming:string};

/** Keep rapid query/layout edits in order, and retain rejected view drafts. */
export function useNotionDatabaseSettings(model:NotionDatabaseModel,onSave?: (id:string,value:NotionDatabaseViewSettings)=>Promise<boolean>|void) {
  const id=React.useId(),drafts=React.useRef<Record<string,Draft>>({});
  const callback=React.useRef(onSave);callback.current=onSave;
  const [,render]=React.useReducer(value=>value+1,0),[pending,setPending]=React.useState(false),[error,setError]=React.useState(false);
  const flight=React.useRef<Promise<boolean>|null>(null);
  for(const view of model.views){
    const incoming=view.settings??empty,key=JSON.stringify(incoming),draft=drafts.current[view.id];
    if(!draft)drafts.current[view.id]={value:incoming,accepted:key,incoming:key};
    else if(draft.incoming!==key){if(JSON.stringify(draft.value)===draft.accepted)draft.value=incoming;draft.incoming=key;draft.accepted=key;}
  }
  function flush():Promise<boolean>{
    if(flight.current)return flight.current;
    if(!callback.current)return Promise.resolve(true);
    setPending(true);setError(false);
    const request=Promise.resolve().then(async()=>{
      for(;;){const entry=Object.entries(drafts.current).find(([,draft])=>JSON.stringify(draft.value)!==draft.accepted);if(!entry)return true;
        const [viewId,draft]=entry,value=draft.value,key=JSON.stringify(value);
        if(await callback.current!(viewId,value)===false)throw new Error('Rejected');draft.accepted=key;
      }
    }).catch(()=>{setError(true);return false;}).finally(()=>{flight.current=null;setPending(false);});
    flight.current=request;return request;
  }
  const revision=JSON.stringify(Object.values(drafts.current).map(draft=>draft.value)),dirty=Object.values(drafts.current).some(draft=>JSON.stringify(draft.value)!==draft.accepted);
  useNotionSaveGuard(`database-settings-${id}`,flush,revision,pending||dirty);
  function change(changes:Partial<NotionDatabaseViewSettings>){
    const active=model.views.find(view=>view.id===model.activeViewId)??model.views[0];if(!active)return;
    const draft=drafts.current[active.id];draft.value={...draft.value,...changes};setError(false);render();
    if(callback.current)void flush();else draft.accepted=JSON.stringify(draft.value);
  }
  function discard(){if(flight.current)return;for(const draft of Object.values(drafts.current))draft.value=JSON.parse(draft.accepted);setError(false);render();}
  const active=model.views.find(view=>view.id===model.activeViewId)??model.views[0];
  return {settings:active?drafts.current[active.id].value:empty,change,pending,error,retry:flush,discard};
}
