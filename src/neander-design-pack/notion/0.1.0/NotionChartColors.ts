import {notionChartValue} from './NotionChartData';
import type {NotionChartConfig,NotionDatabaseColumn} from './NotionDatabase';
export const notionChartPalettes=['auto','colorful','colorless','blue','yellow','green','purple','teal','orange','pink','red'] as const;
export type NotionChartPalette=typeof notionChartPalettes[number]|'gray';
/** Auto uses supplied option colors. Explicit families use five theme-aware shades in visible order. */
export function notionChartColor(config:NotionChartConfig,key:string,index:number,column?:NotionDatabaseColumn){
 const palette=config.palette??'auto',bar=['bar','horizontal-bar'].includes(config.kind),tones=palette==='colorful'?['blue','yellow','green','purple','orange']:bar?['red','green','yellow','blue','purple','pink','brown','orange']:['blue','green','yellow','purple','pink','red','brown','orange'];
 if(palette==='auto'||palette==='colorful')return `var(--notion-chart-${palette==='auto'?column?.optionColors?.[notionChartValue(key)??'']??tones[index%tones.length]:tones[index%tones.length]})`;
 const tone=palette==='colorless'||palette==='gray'?'gray':palette,amount=[100,70,50,30,12][index%5];
 return amount===100?`var(--notion-chart-${tone})`:`color-mix(in srgb,var(--notion-chart-${tone}) ${amount}%,var(--notion-canvas))`;
}
