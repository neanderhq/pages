import {notionFormSelections} from './NotionFormModel';
import {Avatar,AvatarImage,AvatarFallback} from './ui/avatar';
import {useNotionPreferences,notionNumber} from './NotionPreferences';
import type {NotionDatabaseColumn} from './NotionDatabase';

/** Resolve the same supplied person/relation label for display, grouping and search. */
export function notionPropertyLabel(column:NotionDatabaseColumn,value:string){
 if(column.kind==='person')return column.people?.find(person=>person.id===value||person.name===value)?.name??value;
 if(column.kind==='relation')return column.relationRecords?.find(record=>record.id===value)?.title??value;
 return value;
}
/** One supplied-value presentation across tables, peeks, choices and alternate views. */
export function NotionPropertyPill({column,value}:{column:NotionDatabaseColumn;value:string}){
 const label=notionPropertyLabel(column,value);
 return <span className={`notion-cell-pill notion-tag-${column.optionColors?.[value]??'gray'}`} data-property-kind={column.kind}>{column.kind==='status'&&<i className="notion-status-dot" aria-hidden="true"/>}{label}</span>;
}
export function NotionPropertyPerson({column,value}:{column:NotionDatabaseColumn;value:string}){
 const person=column.people?.find(person=>person.id===value||person.name===value),label=notionPropertyLabel(column,value);
 return <span className="notion-cell-person"><Avatar aria-hidden="true"><AvatarImage src={person?.avatarUrl}/><AvatarFallback>{label.slice(0,1)}</AvatarFallback></Avatar><span>{label}</span></span>;
}
export function NotionPropertyValue({column,value}:{column:NotionDatabaseColumn;value:string}){
 const preferences=useNotionPreferences();
 if(['multi-select','relation','person'].includes(column.kind??''))return <span className="notion-multiselect-value">{notionFormSelections(value).map(id=>column.kind==='person'?<NotionPropertyPerson key={id} column={column} value={id}/>:<NotionPropertyPill key={id} column={column} value={id}/>)}</span>;
 if(['select','status'].includes(column.kind??''))return <NotionPropertyPill column={column} value={value}/>;
 return <span className="notion-alternate-property">{column.kind==='number'?notionNumber(value,preferences.numberFormat):value}</span>;
}
