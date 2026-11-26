import * as React from 'react';
export type NotionWorkspacePreferences={startWeekOnMonday?:boolean;enterAddsNewLine?:boolean;showTextDirection?:boolean;numberFormat?:string};
const PreferencesContext=React.createContext<NotionWorkspacePreferences>({});
export function NotionPreferencesProvider({value,children}:{value?:NotionWorkspacePreferences;children:React.ReactNode}){return <PreferencesContext.Provider value={value??{}}>{children}</PreferencesContext.Provider>;}
export function useNotionPreferences(){return React.useContext(PreferencesContext);}
export function notionShouldSubmit(event:React.KeyboardEvent,preferences:NotionWorkspacePreferences){return event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&(!preferences.enterAddsNewLine||event.metaKey||event.ctrlKey);}
export function notionNumber(value:string,format?:string){if(!format||format==='Default'||!value.trim()||!Number.isFinite(Number(value)))return value;const locale=format==='1.234,56'?'de-DE':format==='1 234,56'?'fr-FR':'en-US';return new Intl.NumberFormat(locale,{maximumFractionDigits:12}).format(Number(value));}
const systemThemeQuery='(prefers-color-scheme: dark)';
function subscribeSystemTheme(notify:()=>void){if(typeof window==='undefined')return()=>{};const query=window.matchMedia(systemThemeQuery);query.addEventListener('change',notify);return()=>query.removeEventListener('change',notify);}
export function useNotionAppearance(appearance?:'light'|'dark'|'system'){
 const dark=React.useSyncExternalStore(subscribeSystemTheme,()=>typeof window!=='undefined'&&window.matchMedia(systemThemeQuery).matches,()=>false);
 return appearance==='system'?(dark?'dark':'light'):appearance??'light';
}
