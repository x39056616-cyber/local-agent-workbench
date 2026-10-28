import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {StageControl} from '../src/stage-control.ts';
import {cachedWebFind} from '../src/web-find.ts';
import {deliveryRecovery} from '../src/delivery-recovery.ts';
import {Store} from '../src/store.ts';
import {Tools} from '../src/tools.ts';
import {EvidenceLedger} from '../src/evidence.ts';
import {engineLifecycle} from '../src/engine-lifecycle.ts';
import {Engines} from '../src/engines.ts';

test('读取阶段有实际次数、时间与重复上限，并为制作保留额度',async()=>{
 for(const [maxCalls,reserve,remaining,regex] of [[2,0,30,/调用上限/],[10,12,12,/保留额度/]] as const){const c=new StageControl(new AbortController().signal,'extract',maxCalls,10000,()=>remaining,reserve);try{if(maxCalls===2){c.before('read_file',{path:'one'});c.before('read_file',{path:'two'});}assert.throws(()=>c.before('read_file',{path:'third'}),regex);assert(c.signal.aborted);}finally{c.close();}}
 const c=new StageControl(new AbortController().signal,'extract',10,10000,()=>30);try{c.before('web_read',{url:'https://example.com',line:100});c.before('web_read',{line:100,url:'https://example.com'});assert.throws(()=>c.before('web_read',{url:'https://example.com',line:100}),/重复读取/);}finally{c.close();}
 const timer=new StageControl(new AbortController().signal,'extract',10,15,()=>30);try{await new Promise(r=>setTimeout(r,30));assert(timer.signal.aborted);assert.match(timer.signal.reason.message,/时间上限/);}finally{timer.close();}
});

test('网页定位复用同轮真实正文，返回匹配片段与行号，不混入其他来源或上一轮',()=>{
 const e:any[]=[{type:'user_message',data:{}},{type:'tool_done',created:'earlier',data:{name:'web_read',result:{url:'https://example.com',text:'L100: Total net sales | 416,161 | 391,035\nL101: Net income | 112,010'}}}];
 const found=cachedWebFind(e,'https://example.com','Total net sales');assert(found.cached);assert.equal(found.hits.length,1);assert.equal(found.hits[0].line,100);assert(found.text.includes('416,161'));assert.equal(cachedWebFind(e,'https://other.test','Total net sales').hits.length,0);
 const ledger=new EvidenceLedger('.');ledger.record('web_find',{},found);ledger.require(['web'],[{ref:'https://example.com',quote:'Total net sales | 416,161'}]);
 assert.equal(cachedWebFind([...e,{type:'user_message',data:{}}],'https://example.com','Total net sales').hits.length,0);
});

test('只有已知blocked且无写入的整理阶段才获得一次受限导出，不替未知副作用开额度',()=>{
 const task:any={id:'t',engine:'auto',status:'failed',options:'{}'},events:any[]=[{id:1,type:'user_message',data:{}},{id:2,type:'cooperation_route',data:{}},{id:3,type:'stage_done',data:{id:'balanced.extract'}},{id:4,type:'subagent_start',engine:'harness',data:{id:'balanced.execute.0',key:'known'}},{id:5,type:'subtask_completion',data:{outcome:'blocked',summary:'工具预算已耗尽'}}];
 const credit=deliveryRecovery(task,events);assert.equal(credit?.limit,24);assert.equal(credit?.key,'known');assert.equal(deliveryRecovery({...task,options:JSON.stringify({deliveryRecovery:credit})},events)?.id,credit?.id);
 assert.equal(deliveryRecovery(task,[...events,{id:6,type:'tool_start',data:{id:'write',name:'write_file'}}]),undefined);assert.equal(deliveryRecovery(task,[...events,{id:6,type:'native_tool',data:{type:'commandExecution'}}]),undefined);
});

test('恢复额度与普通额度分别持久计数，不能借导出额度联网或执行命令',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-delivery-budget-')),store=new Store(dir),tools=new Tools(store),task=store.create('导出已有结果','auto',dir);
 const ctx:any={task,signal:new AbortController().signal,emit:(t:string,e:string,d:any)=>store.event(task.id,t,e,d)},recovery={...ctx,budget:{id:'credit',limit:2,allowed:['write_file','read_file','finish_task']}};
 try{store.setSetting('maxCalls',1);await tools.call(ctx,'write_file',{path:'normal.txt',content:'old'},'harness');await assert.rejects(tools.call(ctx,'list_files',{},'harness'),/预算/);
 await tools.call(recovery,'write_file',{path:'export.txt',content:'real file'},'harness');await tools.call(recovery,'read_file',{path:'export.txt'},'harness');await assert.rejects(tools.call(recovery,'web_search',{query:'anything'},'harness'),/成果恢复额度/);await assert.rejects(tools.call(recovery,'run_command',{command:'echo bad'},'harness'),/成果恢复额度/);await assert.rejects(tools.call(recovery,'read_file',{path:'export.txt'},'harness'),/预算/);
 const restarted=new Tools(store);await assert.rejects(restarted.call(recovery,'read_file',{path:'export.txt'},'harness'),/预算/);await assert.rejects(restarted.call(recovery,'read_file',{path:'export.txt'},'qwen'),/预算/);assert.equal(store.events(task.id).filter(e=>e.type==='tool_start'&&e.data.budgetId==='credit').length,2);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('引擎错误与旧记录接管都结束运行计数，不把已中断Qwen继续显示为处理中',async()=>{
 const events:any[]=[],engine=new Engines('',()=>[]);engine.serialQwen=async(fn:any)=>fn();engine.qwen=async()=>{throw new Error('model stopped');};
 await assert.rejects(engine.run('qwen','test',{signal:new AbortController().signal,emit:(type:string,e:string,data:any)=>events.push({type,engine:e,data,created:new Date().toISOString()})} as any),/model stopped/);
 assert.deepEqual(events.map(e=>e.type),['engine_start','engine_error']);assert.equal(engineLifecycle(events,'qwen').open,0);
 const at=(n:number)=>new Date(n).toISOString(),legacy:any[]=[{type:'engine_start',engine:'qwen',created:at(1000)},{type:'auto_recovery',created:at(6000),data:{from:'qwen',to:'harness'}}];
 assert.equal(engineLifecycle(legacy,'qwen',10000).open,0);assert.equal(engineLifecycle(legacy,'qwen',10000).duration,5000);
 assert.equal(engineLifecycle([{type:'engine_start',engine:'qwen',created:at(1000)},{type:'status',created:at(7000),data:{status:'failed'}}],'qwen',999999).duration,6000);
});
