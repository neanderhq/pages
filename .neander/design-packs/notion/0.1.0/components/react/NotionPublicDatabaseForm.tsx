import {NotionDatabaseForm} from './NotionDatabaseForm';
import {NotionThemeProvider} from './ui/theme';
import type {NotionDatabaseView} from './NotionDatabase';
/** Standalone response surface. Publishing, access and submission remain host operations. */
export function NotionPublicDatabaseForm({view,theme='light',onSubmit}:{view:NotionDatabaseView;theme?:'light'|'dark';onSubmit?:(values:Record<string,string>)=>Promise<string|null>}){
 return <NotionThemeProvider theme={theme}><main data-ui-pack="notion" className={`notion-public-form notion-${theme}`}><NotionDatabaseForm publicView view={view} onSubmit={onSubmit}/></main></NotionThemeProvider>;
}
