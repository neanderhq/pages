import type {NotionBlock} from './NotionFramework';

/** Flat indented arrays own a complete branch up to the next peer or ancestor. */
export function branchEnd(blocks:NotionBlock[],index:number){let end=index+1;while(end<blocks.length&&(blocks[end].indent??0)>(blocks[index].indent??0))end++;return end;}
export function siblingBlock(blocks:NotionBlock[],index:number,direction:-1|1){
 const level=blocks[index].indent??0;
 if(direction>0){const next=blocks[branchEnd(blocks,index)];return next&&(next.indent??0)===level?next:undefined;}
 for(let previous=index-1;previous>=0;previous--){const block=blocks[previous],indent=block.indent??0;if(indent<level)return undefined;if(indent===level)return block;}
 return undefined;
}
export function visibleBlock(blocks:NotionBlock[],index:number,expanded?:Readonly<Record<string,boolean>>){let level=blocks[index].indent??0;for(let i=index-1;i>=0&&level>0;i--){const parent=blocks[i];if((parent.indent??0)<level){if(parent.type==='toggle'&&(expanded?.[parent.id]??parent.expanded)===false)return false;level=parent.indent??0;}}return true;}
export function moveBranch(current:NotionBlock[],id:string,targetId:string){
 const blocks=[...current],from=blocks.findIndex(block=>block.id===id),target=blocks.findIndex(block=>block.id===targetId);
 if(from<0||target<0)return current;const end=branchEnd(blocks,from);if(target>=from&&target<end)return current;
 const delta=(blocks[target].indent??0)-(blocks[from].indent??0),moved=blocks.splice(from,end-from).map(block=>({...block,indent:Math.max(0,(block.indent??0)+delta)})),to=blocks.findIndex(block=>block.id===targetId);
 blocks.splice(from<target?branchEnd(blocks,to):to,0,...moved);return blocks;
}
export function indentBranch(current:NotionBlock[],id:string,delta:number){
 const index=current.findIndex(block=>block.id===id);if(index<0)return current;
 const end=branchEnd(current,index),level=current[index].indent??0,next=Math.max(0,Math.min(8,level+delta,index?((current[index-1].indent??0)+1):0));
 const moved=current.slice(index,end).map(block=>({...block,indent:(block.indent??0)+next-level}));
 if(next<level){const rest=[...current.slice(0,index),...current.slice(end)];let at=index;while(at<rest.length&&(rest[at].indent??0)>next)at++;rest.splice(at,0,...moved);return rest;}
 return [...current.slice(0,index),...moved,...current.slice(end)];
}

export function adjacentVisibleIndex(blocks:NotionBlock[],index:number,direction:-1|1){for(let next=index+direction;next>=0&&next<blocks.length;next+=direction)if(visibleBlock(blocks,next))return next;return -1;}
function parentId(blocks:NotionBlock[],index:number){const level=blocks[index].indent??0;for(let previous=index-1;previous>=0;previous--)if((blocks[previous].indent??0)<level)return blocks[previous].id;return null;}
export function canMergeTextBlocks(blocks:NotionBlock[],from:number,to:number){const a=blocks[from],b=blocks[to],types=['text','heading1','heading2','heading3','bullet','numbered','todo','quote','callout'];return Boolean(a&&b&&types.includes(a.type)&&types.includes(b.type)&&(a.indent??0)===(b.indent??0)&&parentId(blocks,from)===parentId(blocks,to));}
