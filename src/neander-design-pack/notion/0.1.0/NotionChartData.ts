import {notionFormSelections} from './NotionFormModel';
import type {NotionChartConfig,NotionDatabaseColumn,NotionDatabaseRow} from './NotionDatabase';
// Reserve a namespace for missing buckets and escape literal values in that
// namespace, so no supplied text can impersonate an internal identity.
const prefix='\u0000notion-chart:',missingKey=`${prefix}empty`,valuePrefix=`${prefix}value:`;
export function notionChartValueKey(value:string){return value.startsWith(prefix)?`${valuePrefix}${value}`:value;}
export function notionChartValue(key:string){return key===missingKey?undefined:key.startsWith(valuePrefix)?key.slice(valuePrefix.length):key;}
/** Keys identify buckets; display names never determine grouping or visibility. */
export function notionChartLabel(key:string,column?:NotionDatabaseColumn){
 const value=notionChartValue(key);if(value===undefined)return 'Empty';
 const label=column?.kind==='person'?column.people?.find(person=>person.id===value)?.name??value:column?.kind==='relation'?column.relationRecords?.find(record=>record.id===value)?.title??value:value;
 return label==='Empty'?'Empty (value)':label;
}
export function notionChartKeys(row:NotionDatabaseRow,column:NotionDatabaseColumn|undefined,config:NotionChartConfig):string[]{
 if(!column)return ['Pages'];let raw=row.values[column.id]??'';
 if(column.kind==='date'&&raw){if(config.dateUnit==='year')raw=raw.slice(0,4);else if(config.dateUnit==='month')raw=raw.slice(0,7);else if(config.dateUnit==='week'){const date=new Date(`${raw.slice(0,10)}T12:00:00Z`);if(Number.isFinite(date.getTime())){date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));raw=date.toISOString().slice(0,10);}else raw='';}else raw=raw.slice(0,10);}
 const values=['multi-select','person','relation'].includes(column.kind??'')?notionFormSelections(raw):raw?[raw]:[];return values.length?[...new Set(values.map(notionChartValueKey))]:[missingKey];
}
