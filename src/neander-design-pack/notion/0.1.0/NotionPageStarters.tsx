import type {ReactNode} from 'react';
import {NotionButton} from './NotionPrimitives';
import {Sparkles,FileAudio,Table2,FileText,Shapes} from './ui/icons';
export type NotionPageStarterKind='ai'|'meeting'|'database'|'form'|'templates';
export type NotionPageStarterActions=Partial<Record<NotionPageStarterKind,()=>void>>;
/** Empty-page entry points. An absent authoritative action remains visibly disabled. */
export function NotionPageStarters({actions,pending,more,empty}:{actions:NotionPageStarterActions;pending:boolean;more:ReactNode;empty:boolean}){
 return <section className={empty?"notion-page-starters":"notion-page-block-entry"} aria-label={empty?"Get started with":undefined}><span hidden={!empty}>Get started with</span><div>{empty&&([{id:'ai',label:'Ask AI',Icon:Sparkles},{id:'meeting',label:'AI Meeting Notes',Icon:FileAudio},{id:'database',label:'Database',Icon:Table2},{id:'form',label:'Form',Icon:FileText},{id:'templates',label:'Templates',Icon:Shapes}] as const).map(({id,label,Icon})=><NotionButton key={id} disabled={pending||!actions[id]} onClick={actions[id]}><Icon size={15}/>{label}</NotionButton>)}{more}</div></section>;
}
