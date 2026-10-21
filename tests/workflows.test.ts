import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.ts';
import {Tools} from '../src/tools.ts';
import {Workflows,validateWorkflow,validatePlan} from '../src/workflows.ts';
import {gaiaMatch,callsMatch,importCases} from '../src/evaluation.ts';
import type {RunContext} from '../src/config.ts';

test('拒绝非法角色、循环依赖和错误机制预算',()=>{
  assert.throws(()=>validateWorkflow({roles:[{id:'x'}]},'qwen'));
  assert.throws(()=>validateWorkflow({maxSteps:0},'qwen'));
  assert.throws(()=>validateWorkflow({mode:'toString'},'qwen'));
  const w=validateWorkflow({mode:'team'},'auto');assert.equal(w.roles[0].engine,'qwen');
  assert.throws(()=>validatePlan({steps:[{id:'a',goal:'x',role:'builder',dependsOn:['b']},{id:'b',goal:'x',role:'builder',dependsOn:['a']}]},w.roles,20));
});
async function fixture(callback:(s:Store,c:RunContext,t:Tools)=>Promise<void>){const dir=await mkdtemp(path.join(os.tmpdir(),'la-workflows-')),s=new Store(dir),t=new Tools(s),task=s.create('测试机制','qwen',dir);const c:RunContext={task,signal:new AbortController().signal,emit:(type,e,data)=>{s.event(task.id,type,e,data);},tool:(n,a,e)=>t.call(c,n,a,e)};try{await callback(s,c,t);}finally{s.close();await rm(dir,{recursive:true,force:true});}}
test('ReAct 真正执行动作、观察并完成；续接不重放成功写操作',async()=>fixture(async(s,c)=>{
  let requests=0,denied=false;
  const engine:any={run:async(_e:string,_p:string,ctx:RunContext)=>{requests++;await assert.rejects(ctx.tool('write_file',{path:'escape',content:'x'},'qwen'),/禁止/);denied=true;await ctx.tool('submit_stage',{payload:JSON.stringify(ctx.stage!.id.endsWith('.1')?{action:'write_file',arguments:{path:'test.txt',content:'OK'}}:{done:true,summary:'完成',files:['test.txt']})},'qwen');return '';}};
  const runner=new Workflows(engine,s,()=>{}),w=validateWorkflow({mode:'react'},'qwen');await runner.run('测试',c,w);assert(denied);assert.equal(requests,2);
  await runner.run('测试',c,w);assert.equal(requests,2);assert.equal(s.events(c.task.id).filter(e=>e.type==='tool_start'&&e.data.name==='write_file').length,1);
  c.task.options=JSON.stringify({turnId:'new-turn'});await runner.run('测试',c,w);assert.equal(requests,4,'新一轮用户指令不能复用上一轮完成结果');assert.equal(s.events(c.task.id).filter(e=>e.type==='tool_start'&&e.data.name==='write_file').length,2);
  await runner.run('测试',c,w);assert.equal(requests,4,'同一轮重试仍不能重放成功写操作');
}));
test('反思不通过触发修订，预算耗尽不得标为完成',async()=>fixture(async(s,c)=>{
  const engine:any={run:async(_e:string,_p:string,ctx:RunContext)=>{const review=ctx.stage!.id.startsWith('review');await ctx.tool('submit_stage',{payload:JSON.stringify(review?{passed:false,issues:['缺少证据']}:{done:true,summary:'初稿',files:[]})},'qwen');return '';}};
  await assert.rejects(new Workflows(engine,s,()=>{}).run('测试',c,validateWorkflow({mode:'reflection',maxRevisions:1},'qwen')),/审查未通过/);
  assert(s.events(c.task.id).some(e=>e.type==='stage_start'&&e.data.id==='repair.1.1'));
  assert(!s.events(c.task.id).some(e=>e.type==='completion'));
}));
test('规划按角色及依赖派发子智能体，再统一交付',async()=>fixture(async(s,c)=>{
  const engines:string[]=[];
  const engine:any={run:async(e:string,_p:string,ctx:RunContext)=>{engines.push(e);await ctx.tool('submit_stage',{payload:JSON.stringify(ctx.stage!.id==='plan'?{steps:[{id:'a',role:'researcher',goal:'提取',dependsOn:[]},{id:'b',role:'builder',goal:'分析',dependsOn:['a']}]}:{done:true,summary:'已核实',files:[]})},e);return '';}};
  await new Workflows(engine,s,()=>{}).run('测试',c,validateWorkflow({mode:'team'},'auto'));
  assert.deepEqual(engines,['qwen','qwen','harness','qwen']);assert.equal(s.events(c.task.id).filter(e=>e.type==='subagent_done').length,2);assert.equal(s.events(c.task.id).filter(e=>e.type==='completion').length,1);
}));
test('取消阶段与不确定的动作不会继续执行',async()=>fixture(async(s,c)=>{
  const controller=new AbortController();controller.abort();c.signal=controller.signal;
  await assert.rejects(new Workflows({run:async()=>{throw new Error('不应启动');}} as any,s,()=>{}).run('测试',c,validateWorkflow({mode:'react'},'qwen')),e=>(e as Error).name==='AbortError');
}));
test('动作已开始但结果丢失时续接拒绝重放；缺少阶段提交也不能完成',async()=>fixture(async(s,c)=>{
  const abort=new AbortController();c.signal=abort.signal;let calls=0;
  c.tool=async()=>{calls++;abort.abort();throw new Error('连接中断，副作用状态未知');};
  const engine:any={run:async(_e:string,_p:string,ctx:RunContext)=>{await ctx.tool('submit_stage',{payload:JSON.stringify({action:'write_file',arguments:{path:'x',content:'x'}})},'qwen');return '';}};
  const w=validateWorkflow({mode:'react'},'qwen'),runner=new Workflows(engine,s,()=>{});
  await assert.rejects(runner.run('测试',c,w));c.signal=new AbortController().signal;
  await assert.rejects(runner.run('测试',c,w),/避免重复副作用/);assert.equal(calls,1);
  const other={...c,task:{...c.task,prompt:'另一个任务'}};
  await assert.rejects(new Workflows({run:async()=>''} as any,s,()=>{}).run('测试',other,w),/未提交/);
}));
test('评分拒绝附件缺失、区分数字及列表，并精确比较原生调用参数',()=>{
  assert(gaiaMatch('1,000','1000'));assert(!gaiaMatch('12','1,2'));assert(!gaiaMatch('0x10','16'));assert(gaiaMatch('Paris','paris'));assert(!gaiaMatch('12','13'));assert(gaiaMatch('A; 2','a;2'));assert(!gaiaMatch('2;a','a;2'));
  assert(callsMatch([{name:'f',arguments:{a:1,b:2}}],[{name:'f',arguments:{b:2,a:1}}]));assert(!callsMatch([{name:'f',arguments:{a:'1'}}],[{name:'f',arguments:{a:1}}]));
  assert.throws(()=>importCases('gaia',[{Question:'Q','Final answer':'a',file_name:'x.pdf'}]),/附件/);
  assert.throws(()=>importCases('bfcl',[{question:[[]],function:[]}]),/格式/);
});
