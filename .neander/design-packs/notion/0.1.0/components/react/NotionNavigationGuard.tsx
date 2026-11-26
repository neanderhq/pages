import * as React from 'react';
/** Keep composed surfaces on the shell's save-before-navigation path. */
export const NotionNavigationGuard = React.createContext<(intent:()=>void,phase?:NotionSavePhase)=>Promise<void>>(async intent=>intent());
export function useNotionNavigationGuard(){return React.useContext(NotionNavigationGuard);}
export type NotionSavePhase='navigation'|'view-definition'|{pageStarter:string};
export const NotionDraftRegistry=React.createContext<((id:string,save:(phase?:NotionSavePhase)=>Promise<boolean>)=>()=>void)|null>(null);
/** Match the sibling Linear pack: warn only while a draft/write needs protection. */
export function useNotionBeforeUnload(blocked:boolean){
 const latest=React.useRef(blocked);latest.current=blocked;
 React.useEffect(()=>{if(!blocked)return;const warn=(event:BeforeUnloadEvent)=>{if(latest.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[blocked]);
}
/** Custom surfaces participate in the same save-before-leaving transaction as page editors. */
export function useNotionSaveGuard(id:string,save:(phase?:NotionSavePhase)=>Promise<boolean>,revision?:unknown,blockUnload=false){
 useNotionBeforeUnload(blockUnload);
 const register=React.useContext(NotionDraftRegistry),latest=React.useRef(save);latest.current=save;
 React.useLayoutEffect(()=>register?.(id,(phase)=>latest.current(phase)),[register,id,revision]);
}
