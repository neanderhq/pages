import type {NotionBlock,NotionPage} from './NotionFramework';
import type {NotionDatabaseColumn} from './NotionDatabase';
/** RFC-style quoted fields, including escaped quotes and embedded newlines. No I/O or host writes. */
export function parseNotionCsv(text:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 const source=text.replace(/^\uFEFF/,'');
 for(let index=0;index<source.length;index++){const character=source[index];if(quoted){if(character==='"'){if(source[index+1]==='"'){field+='"';index++;}else{quoted=false;closed=true;}}else field+=character;continue;}
 if(character==='"'&&!field&&!closed){quoted=true;continue;}
 if(character===','){row.push(field);field='';closed=false;continue;}
 if(character==='\r'||character==='\n'){if(character==='\r'&&source[index+1]==='\n')index++;row.push(field);if(row.some(value=>value!==''))rows.push(row);row=[];field='';closed=false;continue;}
 if(closed&&character.trim())throw new Error('Unexpected content after a quoted CSV field');
 if(!closed)field+=character;
 }
 if(quoted)throw new Error('Unclosed quoted CSV field');row.push(field);if(row.some(value=>value!==''))rows.push(row);return rows;
}
export function notionCsvPages(text:string,title:string,newId:()=>string=()=>crypto.randomUUID()):NotionPage[]{
 const matrix=parseNotionCsv(text);if(!matrix.length)throw new Error('The CSV file is empty');const width=Math.max(...matrix.map(row=>row.length)),headers=Array.from({length:width},(_,index)=>matrix[0][index]?.trim()||`Column ${index+1}`),id=`database-${newId()}`,values=matrix.slice(1);
 const columns:NotionDatabaseColumn[]=headers.slice(1).map((label,index)=>{const nonempty=values.map(row=>row[index+1]??'').filter(Boolean),kind=nonempty.length&&nonempty.every(value=>/^\d{4}-\d{2}-\d{2}$/.test(value))?'date':nonempty.length&&nonempty.every(value=>/^(true|false)$/i.test(value))?'checkbox':nonempty.length&&nonempty.every(value=>Number.isFinite(Number(value)))?'number':'text';return {id:`column-${index+1}`,label,kind,editable:true};});
 const rows=values.map(row=>({id:`record-${newId()}`,title:row[0]??'',values:Object.fromEntries(columns.map((column,index)=>[column.id,column.kind==='checkbox'?(row[index+1]??'').toLowerCase():row[index+1]??'']))}));
 return [{id,title,icon:'notion-icon:table',blocks:[],database:{activeViewId:'table',views:[{id:'table',name:'Table',kind:'table',columns,rows,openMode:'side-peek'}]}},...rows.map(row=>({id:row.id,parentId:id,title:row.title,blocks:[{id:`block-${newId()}`,type:'text' as const,text:''}]}))];
}
export function notionMarkdownBlocks(text:string,newId:()=>string=()=>crypto.randomUUID()):NotionBlock[]{
 const blocks:NotionBlock[]=[];let code:string[]|null=null,language='';
 for(const line of text.replace(/\r\n/g,'\n').split('\n')){const fence=line.match(/^\s*```(.*)$/);if(fence){if(code){blocks.push({id:newId(),type:'code',text:code.join('\n'),language});code=null;}else{code=[];language=fence[1].trim();}continue;}if(code){code.push(line);continue;}if(!line.trim())continue;const heading=line.match(/^(#{1,3})\s+(.*)$/),todo=line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/),bullet=line.match(/^(\s*)[-*]\s+(.*)$/),numbered=line.match(/^(\s*)\d+\.\s+(.*)$/);const indent=Math.min(8,Math.floor((line.match(/^\s*/)?.[0].length??0)/2));blocks.push({id:newId(),type:heading?`heading${heading[1].length}` as NotionBlock['type']:todo?'todo':bullet?'bullet':numbered?'numbered':/^>\s/.test(line)?'quote':/^(-{3,}|\*{3,})$/.test(line.trim())?'divider':'text',text:heading?.[2]??todo?.[3]??bullet?.[2]??numbered?.[2]??line.replace(/^>\s?/,''),checked:todo?todo[2].toLowerCase()==='x':undefined,indent:indent||undefined});}
 if(code)blocks.push({id:newId(),type:'code',text:code.join('\n'),language});return blocks.length?blocks:[{id:newId(),type:'text',text:''}];
}
