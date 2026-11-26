import * as React from 'react';
import type {NotionFrameworkActions,NotionPage,NotionSyncedContent,NotionTextComment,NotionCollaborator} from './NotionFramework';
export type NotionDocumentResources={pages:NotionPage[];actions:NotionFrameworkActions;syncedBlocks?:NotionSyncedContent[];textComments?:NotionTextComment[];collaborators?:NotionCollaborator[]};
export const NotionDocumentContext=React.createContext<{pageId:string;theme:'light'|'dark';resources?:NotionDocumentResources;syncedAncestors?:string[]}>({pageId:'',theme:'light'});
