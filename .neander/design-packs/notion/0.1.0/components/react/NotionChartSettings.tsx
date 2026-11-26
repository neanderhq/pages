import {notionChartPalettes,notionChartColor} from './NotionChartColors';
import {notionChartKeys,notionChartLabel,notionChartValueKey} from './NotionChartData';
import {NotionSelect} from './NotionSelect';
import {Input} from './ui/input';
import {Switch} from './ui/switch';
import {Checkbox} from './ui/checkbox';
import {NotionButton} from './NotionPrimitives';
import {ChartColumn,ChartBar,ChartNoAxesCombined,PieChart,Hash} from './ui/icons';
import type {NotionChartConfig,NotionDatabaseColumn,NotionDatabaseRow} from './NotionDatabase';
export function NotionChartSettings({value,columns,rows,onChange,disabled,defaultXColumnId}:{defaultXColumnId?:string;value:NotionChartConfig;columns:NotionDatabaseColumn[];rows:NotionDatabaseRow[];onChange:(value:NotionChartConfig)=>void;disabled:boolean}){
 const change=(change:Partial<NotionChartConfig>)=>onChange({...value,...change}),x=columns.find(column=>column.id===value.xColumnId)??columns.find(column=>column.id===defaultXColumnId)??columns.find(column=>['select','status'].includes(column.kind??'')),groups=[...new Set([...(x?.options??[]).map(notionChartValueKey),...rows.flatMap(row=>notionChartKeys(row,x,value))])];
 const select=(label:string,current:string,options:{value:string;label:string}[],set:(value:string)=>void,caption=label)=><label className="notion-chart-setting-row"><span>{caption}</span><NotionSelect variant="menu" label={label} value={current} options={options} onValueChange={set} disabled={disabled}/></label>;
 const toggle=(label:string,checked:boolean,set:(value:boolean)=>void,extraDisabled=false,caption=label)=><label className="notion-chart-setting-toggle"><span>{caption}</span><Switch aria-label={label} checked={checked} onCheckedChange={set} disabled={disabled||extraDisabled}/></label>;
 return <div className="notion-chart-settings">
 <fieldset><legend>Chart type</legend><div className="notion-chart-types">{([{kind:'bar',label:'Vertical bar',Icon:ChartColumn},{kind:'horizontal-bar',label:'Horizontal bar',Icon:ChartBar},{kind:'line',label:'Line',Icon:ChartNoAxesCombined},{kind:'donut',label:'Donut',Icon:PieChart},{kind:'number',label:'Number',Icon:Hash}] as const).map(({kind,label,Icon})=><NotionButton key={kind} aria-label={`${label} chart`} title={label} aria-pressed={value.kind===kind} disabled={disabled} onClick={()=>change({kind})}><Icon size={22}/></NotionButton>)}</div></fieldset>
 <fieldset><legend>X axis</legend>
 {select('Chart X axis property',value.xColumnId??'',[{value:'',label:x?`${x.label} (default)`:'Pages'},...columns.filter(column=>!['rollup','relation'].includes(column.kind??'')).map(column=>({value:column.id,label:column.label}))],xColumnId=>change({xColumnId,hiddenGroups:[]}),'What to show')}
 {x?.kind==='date'&&select('Chart date grouping',value.dateUnit??'day',['day','week','month','year'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)})),dateUnit=>change({dateUnit:dateUnit as NotionChartConfig['dateUnit']}),'Group dates by')}
 {select('Chart sort',value.sort??(value.kind==='donut'?'value-desc':'manual'),[{value:'manual',label:'Manual'},{value:'name-asc',label:'Name ascending'},{value:'name-desc',label:'Name descending'},{value:'value-asc',label:'Value low to high'},{value:'value-desc',label:'Value high to low'}],sort=>change({sort:sort as NotionChartConfig['sort']}),'Sort by')}
 {toggle('Omit zero values',Boolean(value.omitZero),omitZero=>change({omitZero}))}
 </fieldset>
 <fieldset><legend>Y axis</legend>
 {select('Chart calculation',value.aggregation,['count','sum','average','min','max','unique'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)})),aggregation=>change({aggregation:aggregation as NotionChartConfig['aggregation']}),'What to show')}
 {value.aggregation!=='count'&&select('Chart value property',value.valueColumnId??'',[{value:'',label:'Select a property'},...columns.filter(column=>value.aggregation==='unique'||['number','formula','rollup'].includes(column.kind??'')).map(column=>({value:column.id,label:column.label}))],valueColumnId=>change({valueColumnId}),'Property')}
 {select('Chart group by',value.groupColumnId??'',[{value:'',label:'None'},...columns.filter(column=>['select','status','text','person','checkbox'].includes(column.kind??'')).map(column=>({value:column.id,label:column.label}))],groupColumnId=>change({groupColumnId}),'Group by')}
 {value.groupColumnId&&toggle('Stack chart groups',value.stacked!==false,stacked=>change({stacked}),false,'Stack groups')}
 </fieldset>
 <fieldset><legend>Style</legend>
 <label className="notion-chart-setting-row"><span>Color</span><NotionSelect variant="menu" label="Chart color" value={value.palette==='gray'?'colorless':value.palette??'auto'} disabled={disabled} onValueChange={palette=>change({palette:palette as NotionChartConfig['palette']})} options={notionChartPalettes.map(palette=>({value:palette,separatorBefore:palette==='colorless',label:palette[0].toUpperCase()+palette.slice(1),adornment:palette==='auto'?undefined:<span className="notion-chart-palette" aria-hidden="true">{Array.from({length:5},(_,index)=><i key={index} style={{background:notionChartColor({...value,palette},'',index)}}/>)}</span>}))}/></label>
 {select('Chart height',value.height??'medium',['small','medium','large'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)})),height=>change({height:height as NotionChartConfig['height']}),'Height')}
 {toggle('Show chart legend',Boolean(value.showLegend),showLegend=>change({showLegend}),false,'Legend')}
 {toggle('Show chart data labels',Boolean(value.showLabels),showLabels=>change({showLabels}),false,'Data labels')}
 {toggle('Show chart grid',value.grid!==false,grid=>change({grid}),false,'Grid lines')}
 </fieldset>
 <fieldset><legend>More style options</legend>
 {toggle('Cumulative chart',Boolean(value.cumulative),cumulative=>change({cumulative}),!['count','sum'].includes(value.aggregation)||value.sort!=='name-asc','Cumulative')}
 <label>X axis name<Input aria-label="Chart X axis name" value={value.xLabel??''} disabled={disabled} onChange={event=>change({xLabel:event.target.value})}/></label><label>Y axis name<Input aria-label="Chart Y axis name" value={value.yLabel??''} disabled={disabled} onChange={event=>change({yLabel:event.target.value})}/></label>
 </fieldset><fieldset><legend>Visible groups</legend>{groups.map(group=><label key={group} className="notion-chart-setting-toggle"><span>{notionChartLabel(group,x)}</span><Checkbox aria-label={`Show chart group ${notionChartLabel(group,x)}`} disabled={disabled} checked={!value.hiddenGroups?.includes(group)} onCheckedChange={checked=>change({hiddenGroups:checked?(value.hiddenGroups??[]).filter(value=>value!==group):[...(value.hiddenGroups??[]),group]})}/></label>)}</fieldset>
 </div>;
}
