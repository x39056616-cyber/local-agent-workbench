import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.ts';
import {ModelRouter} from '../src/model-router.ts';
import {initialModel,classifyTask,preference,rankModels} from '../src/model-policy.ts';
import {taskRoute,researchKinds} from '../src/routing.ts';
import {adaptiveExecution} from '../src/adaptive-execution.ts';
import {Agent} from '../src/agent.ts';

const available=(profile='one')=>['qwen','harness','codex'].map(engine=>({engine,profile,available:true,observations:[]})) as any;
async function fixture(){const dir=await mkdtemp(path.join(os.tmpdir(),'la-model-router-')),store=new Store(dir),router=new ModelRouter(store);const task=store.create('帮我在github找这一个月内最受欢迎有关ai的3个开源项目，并分别向我说明他们为什么这么受欢迎','auto',dir);task.options=JSON.stringify({turnId:'one',intent:'task',workflow:{mode:'native'}});store.update(task.id,{options:task.options});store.event(task.id,'user_message','user',{text:task.prompt,turnId:'one'});const ctx:any={task,signal:new AbortController().signal,emit:(t:string,e:string,d:any)=>store.event(task.id,t,e,d),tool:async()=>({})};router.candidates=async t=>{const category=classifyTask(t.prompt);return available().map((c:any)=>({...c,observations:store.db.prepare('SELECT * FROM routing_samples WHERE category=? AND engine=? AND profile=?').all(category,c.engine,c.profile)}));};return {dir,store,router,ctx,close:async()=>{if(store.db.isOpen)store.close();await rm(dir,{recursive:true,force:true});}};}

test('跨任务按质量收益和成本选择，不把 GitHub 开源项目检索误判成复杂代码',()=>{
 assert.equal(initialModel('帮我在github找这一个月内最受欢迎有关ai的3个开源项目，并说明原因'),'harness');
 assert.equal(initialModel('读取附件，提取姓名并去重分类'),'qwen');
 assert.equal(initialModel('编写一个 Python 脚本统计词频'),'harness');
 assert.equal(initialModel('修复多文件并发竞态，添加回归测试'),'codex');
 assert.equal(initialModel('严格证明以下数学定理'),'codex');
 assert.equal(initialModel('你好，你是谁'),'qwen');
 assert.equal(initialModel('写一份产品分析报告','quality'),'codex');
 assert.equal(initialModel('写一份产品分析报告','economy'),'harness');
 assert.throws(()=>preference('cheapest-ever'));
 assert.equal(taskRoute({engine:'auto',prompt:'帮我在github查找最新AI开源项目',options:JSON.stringify({workflow:{mode:'native'}})}).engine,'harness');
});

test('实际完成不冒充质量评价；多次同类差评会改变选择，少量评价不过度调整',()=>{
 const candidates=available();candidates[1].observations=Array.from({length:20},()=>({status:'completed',durationMs:3000}));
 assert.equal(rankModels('research','balanced',candidates)[0].engine,'harness');
 candidates[1].observations=[{status:'completed',durationMs:3000,rating:-1}];
 assert.equal(rankModels('research','balanced',candidates)[0].engine,'harness');
 candidates[1].observations=Array.from({length:5},()=>({status:'completed',durationMs:3000,rating:-1}));
 assert.equal(rankModels('research','balanced',candidates)[0].engine,'codex');
});

test('离线候选被排除；手动指定仍保持原模型，不悄悄替换',async()=>{
 const f=await fixture();try{f.router.candidates=async()=>available().map((c:any)=>({...c,available:c.engine!=='harness'}));assert.equal((await f.router.select(f.ctx)).engine,'codex');
 f.ctx.task.engine='harness';f.store.event(f.ctx.task.id,'user_message','user',{turnId:'two'});f.ctx.task.options=JSON.stringify({turnId:'two'});const fixed=await f.router.select(f.ctx);assert.equal(fixed.engine,'harness');assert.equal(fixed.automatic,false);
 }finally{await f.close();}
});

test('选模决定同轮可恢复；真实最终交付才能评价，改评价不重复加权，跨类别和配置不混学',async()=>{
 const f=await fixture();try{const d=await f.router.select(f.ctx);assert.throws(()=>f.router.feedback(f.ctx.task.id,d.id,1),/实际交付/);
 f.router.record(f.ctx,d,'completed',1200);f.ctx.emit('final',d.engine,{turnId:d.turnId,text:'真实结果'});
 f.router.feedback(f.ctx.task.id,d.id,-1);f.router.feedback(f.ctx.task.id,d.id,1);
 assert.equal((f.store.db.prepare('SELECT COUNT(*) AS n FROM routing_samples').get() as any).n,1);
 assert.equal((await f.router.select(f.ctx)).id,d.id);
 const other={...f.ctx.task,prompt:'提取以下文字姓名'};assert.equal((await f.router.candidates(other)).find(c=>c.engine==='harness')?.observations?.length,0);
 const profileCandidates=await new ModelRouter(f.store).candidates(f.ctx.task);assert.equal(profileCandidates.find(c=>c.engine==='harness')?.observations?.length,0);
 f.store.close();const reopened=new Store(f.dir);try{assert.equal((reopened.db.prepare('SELECT rating FROM routing_samples WHERE id=?').get(d.id) as any).rating,1);}finally{reopened.close();}
 }finally{await f.close();}
});

test('取消、审批拒绝不记成模型质量或连接失败',async()=>{
 const f=await fixture();try{const d=await f.router.select(f.ctx);for(const msg of ['用户停止了任务','用户拒绝审批','HTTP 403 权限不足'])f.router.record(f.ctx,d,'failed',100,new Error(msg));assert.equal(f.router.feedbackFor(f.ctx.task.id).length,0);assert.equal((f.store.db.prepare('SELECT COUNT(*) AS n FROM routing_samples').get() as any).n,0);
 }finally{await f.close();}
});

test('自动执行真实接续至下一候选；未知原生命令和拒绝审批禁止自动重放',async()=>{
 const f=await fixture();try{let calls:string[]=[];const run=async(e:string,c:any)=>{calls.push(e);c.emit('engine_start',e,{});if(e==='harness')throw new Error('Harness 进程退出');c.emit('completion',e,{outcome:'completed',summary:'接管完成',files:[]});return '结果';};
 const result=await adaptiveExecution('任务',f.ctx,f.store,f.router,run,()=>{});assert.equal(result.decision.engine,'codex');assert.deepEqual(calls,['harness','codex']);
 f.store.event(f.ctx.task.id,'user_message','user',{turnId:'two'});f.ctx.task.options=JSON.stringify({turnId:'two'});calls=[];
 await assert.rejects(adaptiveExecution('任务',f.ctx,f.store,f.router,async(e,c)=>{calls.push(e);c.emit('native_tool',e,{type:'commandExecution'});throw new Error('进程退出');},()=>{}),/进程退出/);assert.equal(calls.length,1);
 f.store.event(f.ctx.task.id,'user_message','user',{turnId:'three'});f.ctx.task.options=JSON.stringify({turnId:'three'});calls=[];
 await assert.rejects(adaptiveExecution('任务',f.ctx,f.store,f.router,async(e)=>{calls.push(e);throw new Error('用户拒绝审批');},()=>{}),/拒绝/);assert.equal(calls.length,1);
 }finally{await f.close();}
});

test('Agent 的自动＋原生组合执行选中的 DeepSeek，且最终答案和反馈归因一致',async()=>{
 const f=await fixture();try{const agent=new Agent(f.store,''),calls:string[]=[];agent.router=f.router;agent.tools.retrieval.search=async()=>({hits:[],mode:'test',warning:''}) as any;
 // 不伪造网络证据：自包含写作请求仍应优先 DeepSeek。
 f.ctx.task.prompt='写一段春天的文案';f.store.db.prepare('UPDATE tasks SET prompt=? WHERE id=?').run(f.ctx.task.prompt,f.ctx.task.id);
 agent.engines.run=async(e,_p,c)=>{calls.push(e);c.emit('engine_start',e,{});await c.tool('finish_task',{outcome:'completed',summary:'春风拂面。',files:[]},e);return '完成';};
 await agent.pump();assert.deepEqual(calls,['harness']);assert.equal(f.store.get(f.ctx.task.id)?.status,'succeeded');const final=f.store.events(f.ctx.task.id).find(e=>e.type==='final');assert.equal(final?.engine,'harness');assert.equal(final?.data.text,'春风拂面。');const d=f.store.events(f.ctx.task.id).find(e=>e.type==='model_route')!.data;assert.equal(agent.router.feedback(f.ctx.task.id,d.id,1).rating,1);
 }finally{await f.close();}
});

test('联网研究中禁止生成文件不应被误判为本地资料要求，双来源请求仍需双验证',()=>{
 assert.deepEqual(researchKinds('帮我在github找这一个月内最受欢迎的3个AI开源项目，实际读取月榜与项目主页；不要生成文件，不运行命令。'),['web']);
 assert.deepEqual(researchKinds('读取 https://github.com/trending?since=monthly，生成报告文件'),['web']);
 assert.deepEqual(researchKinds('在 GitHub 搜索最新项目，并读取本地文件核对'),['web','local']);
 assert.deepEqual(researchKinds('不要读取本地文件，但请在GitHub查找最新项目'),['web']);
});

test('同轮已确认完成后继续不再请求模型，存在未知原生命令也不重复执行',async()=>{
 const f=await fixture();try{const d=await f.router.select(f.ctx);f.ctx.emit('engine_start',d.engine,{});f.ctx.emit('native_tool',d.engine,{type:'commandExecution'});f.ctx.emit('completion',d.engine,{outcome:'completed',summary:'已有结果',files:[]});let called=0;
 const result=await adaptiveExecution('原任务',f.ctx,f.store,f.router,async()=>{called++;return '';},()=>{});assert.equal(called,0);assert.equal(result.result,'已有结果');assert(f.store.events(f.ctx.task.id).some(e=>e.type==='completion'&&e.data.reused));
 }finally{await f.close();}
});

test('stdio/HTTP 桥接管时激活受限上下文，不能调用未允许的命令工具',async()=>{
 const f=await fixture();try{let active=f.ctx;const result=await adaptiveExecution('任务',f.ctx,f.store,f.router,async(e,c)=>{assert.equal(active,c);if(e==='harness')throw new Error('进程退出');await assert.rejects(active.tool('run_command',{command:'echo unsafe'},e),/接管只允许/);c.emit('completion',e,{outcome:'completed',summary:'已核对',files:[]});return '已核对';},c=>{active=c;});assert.equal(result.decision.engine,'codex');assert.equal(active,f.ctx);
 }finally{await f.close();}
});
