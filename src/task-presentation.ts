import type {OverviewTask} from './task-overview.js';

export function taskName(task:Pick<OverviewTask,'title'|'goal'>,index?:number){
 const title=task.title?.trim();
 if(title)return {text:title,source:'事项名称'};
 const first=task.goal?.trim().split(/[。！？\n]/u).map(part=>part.trim()).find(Boolean);
 if(first)return {text:first,source:'要求首句'};
 return {text:index===undefined?'未命名事项':`Worker ${index}`,source:'名称未记录'};
}
