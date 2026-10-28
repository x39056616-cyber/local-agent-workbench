import {randomUUID} from 'node:crypto';
import {safeToHandoff} from './supervisor.ts';
import type {EventRecord,Task} from './config.ts';

export const deliveryTools=['list_files','read_file','write_file','document_status','document_read','document_search','document_collect','web_find','finish_task'];
// A single bounded export retry, only after a known blocked writer that made no writes.
export function deliveryRecovery(task:Task,events:EventRecord[]){
 const options=JSON.parse(task.options||'{}');if(options.deliveryRecovery?.version===2)return options.deliveryRecovery;
 if(task.engine!=='auto'||task.status!=='failed')return;
 const last=events.findLastIndex(e=>e.type==='user_message'),current=events.slice(Math.max(0,last));
 const start=current.findLast(e=>e.type==='subagent_start'&&e.data.id?.startsWith('balanced.execute.'));
 if(!start||!['harness','qwen'].includes(start.engine))return;
 const tail=current.filter(e=>e.id>start.id),blocked=tail.findLast(e=>e.type==='subtask_completion'&&e.data.outcome==='blocked');
 const limit=current.findLast(e=>e.type==='cooperation_route')?.data;
 if(!blocked||!limit||! /预算|额度/.test(blocked.data.summary||'')||!current.some(e=>e.type==='stage_done'&&e.data.id==='balanced.extract'))return;
 if(tail.some(e=>e.type==='tool_start'&&!['list_files','read_file','finish_task'].includes(e.data.name))||!safeToHandoff(tail))return;
 return {id:options.deliveryRecovery?.id||randomUUID(),key:start.data.key,engine:start.engine,limit:24,version:2};
}
