import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.ts';
import {Tools,toolSpecs} from '../src/tools.ts';
import {compactMessages} from '../src/context.ts';
import {selectTools} from '../src/tool-selection.ts';
import {researchSubtask} from '../src/subtasks.ts';
import {BrowserTools} from '../src/browser.ts';
import {chromium} from 'playwright';

async function fixture(){const dir=await mkdtemp(path.join(os.tmpdir(),'la-runtime-')),store=new Store(dir),tools=new Tools(store),task=store.create('核对给定材料','auto',dir);task.options=JSON.stringify({turnId:'one'});store.update(task.id,{options:task.options});store.event(task.id,'user_message','user',{turnId:'one'});const ctx:any={task,signal:new AbortController().signal,emit:(type:string,e:string,data:any)=>store.event(task.id,type,e,data),tool:(n:string,a:any,e:string)=>tools.call(ctx,n,a,e)};return {store,tools,ctx,close:async()=>{store.close();await rm(dir,{recursive:true,force:true});}};}

test('长记录只压缩完整调用组，原始目标和最近工具的关联仍完整，未结束调用不能被切断',()=>{
 const messages:any[]=[{role:'system',content:'规则'},{role:'user',content:'原始任务不可变'}];
 for(let i=0;i<7;i++){messages.push({role:'assistant',content:'计划',tool_calls:[{id:String(i),function:{name:'web_read',arguments:'{"url":"https://example.com"}'}}]},{role:'tool',tool_call_id:String(i),content:JSON.stringify({operationId:'op'+i,text:'资料'.repeat(5000)})});}
 assert(compactMessages(messages,5000));assert.equal(messages[1].content,'原始任务不可变');assert.equal(messages[0].content,'规则');
 for(const m of messages.filter(m=>m.role==='assistant'))for(const call of m.tool_calls)assert(messages.some(m=>m.role==='tool'&&m.tool_call_id===call.id));
 assert(messages.some(m=>m.tool_call_id==='6'));assert(messages[2].content.includes('operationId'));
 const unfinished=[...messages,{role:'assistant',tool_calls:[{id:'pending',function:{name:'write_file',arguments:'{}'}}]}],copy=JSON.stringify(unfinished);assert.equal(compactMessages(unfinished,1),false);assert.equal(JSON.stringify(unfinished),copy);
});

test('工具精简仍可按发现的真实 schema 调用，未知工具与递归入口被拒绝',async()=>{
 const basic=selectTools(toolSpecs(false),'将文字按姓名分类');assert(basic.length<toolSpecs(false).length);assert(basic.some(s=>s.name==='tool_invoke'));assert(!basic.some(s=>s.name==='run_command'));
 const browser=selectTools(toolSpecs(false),'打开网页查找资料');assert(browser.some(s=>s.name==='browser_open'));
 const f=await fixture();try{const r=await f.tools.call(f.ctx,'tool_invoke',{name:'list_files',arguments:{path:'.'}},'qwen');assert(Array.isArray(r));await assert.rejects(f.tools.call(f.ctx,'tool_invoke',{name:'unknown',arguments:{}},'qwen'),/未知/);await assert.rejects(f.tools.call(f.ctx,'tool_invoke',{name:'tool_invoke',arguments:{}},'qwen'),/嵌套/);}finally{await f.close();}
});

test('长结果提供可回看引用，不丢失六万字后的内容，其他任务不能读取',async()=>{
 const f=await fixture();try{const original=f.tools.execute.bind(f.tools);f.tools.execute=async()=>({text:'a'.repeat(90000)+'END-VERIFIED',url:'https://example.com'});const brief=await f.tools.call(f.ctx,'read_file',{path:'fixture.txt'},'qwen');f.tools.execute=original;
 assert(brief.text.length<=8000);assert(brief.operationId);const tail=await f.tools.call(f.ctx,'tool_result_read',{operationId:brief.operationId,offset:89000},'qwen');assert(tail.text.includes('END-VERIFIED'));
 const other={...f.ctx,task:{...f.ctx.task,id:'other'}};await assert.rejects(f.tools.call(other,'tool_result_read',{operationId:brief.operationId},'qwen'),/本任务没有/);
 }finally{await f.close();}
});

test('子任务受后端总量限制、不能完成顶层或递归，Qwen 父请求不进入同一单并发队列',async()=>{
 const f=await fixture();try{let calls=0,active=f.ctx;const router:any={select:async(c:any,exclude:string[])=>{assert(exclude.includes('qwen'));c.emit('model_route','system',{engine:'harness'});return {engine:'harness'};}};
 const engines:any={run:async(e:string,_p:string,c:any)=>{calls++;assert.equal(active,c);assert.equal(e,'harness');await assert.rejects(c.tool('write_file',{path:'x',content:'x'},e),/只允许/);await assert.rejects(c.tool('research_subtask',{task:'递归'},e),/只允许/);await c.tool('submit_stage',{payload:JSON.stringify({summary:'材料中共有两位姓名'})},e);return '完成';}};
 const run=(goal:string)=>researchSubtask(f.ctx,goal,'qwen',f.store,engines,router,c=>{active=c;});
 await run('分析给定资料中的姓名');await run('分析给定资料中的姓名');assert.equal(calls,1);assert.equal(active,f.ctx);assert(!f.store.events(f.ctx.task.id).some(e=>e.type==='completion'));assert(f.store.events(f.ctx.task.id).some(e=>e.type==='subtask_route'));
 for(let i=0;i<3;i++)await run('分析材料'+i);await assert.rejects(run('第五个'),/四个/);
 await assert.rejects(researchSubtask({...f.ctx,stage:{id:'child'}},'递归','qwen',f.store,engines,router,()=>{}),/递归/);
 }finally{await f.close();}
});

test('子任务宣称联网完成却没有实际来源会被拒绝，取消前不启动执行器',async()=>{
 const f=await fixture();try{let called=0;const engines:any={run:async(e:string,_p:string,c:any)=>{called++;await c.tool('submit_stage',{payload:'{"summary":"查完了"}'},e);}},router:any={select:async()=>({engine:'harness'})};
 await assert.rejects(researchSubtask(f.ctx,'在 GitHub 查找最新资料','qwen',f.store,engines,router,()=>{}),/尚无实际读取/);
 const controller=new AbortController();controller.abort(new Error('已取消'));await assert.rejects(researchSubtask({...f.ctx,signal:controller.signal},'已取消任务','qwen',f.store,engines,router,()=>{}),/已取消/);assert.equal(called,1);
 }finally{await f.close();}
});

test('真实浏览器快照控件可操作，拒绝审批不点击，过期快照不执行，内网不能打开',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext(),page=await context.newPage(),tools=new BrowserTools();
 const ctx:any={task:{id:'browser-test'},signal:new AbortController().signal};const state:any={browser,context,page,snapshot:'',elements:[]};tools.sessions.set(ctx.task.id,state);
 try{await page.setContent('<h1>控件测试</h1><input aria-label="问题"><button onclick="document.querySelector(\'h1\').textContent=\'已执行\'">运行</button>');const snap=await tools.read(ctx),index=snap.elements.find((e:any)=>e.label==='运行').index;
 await assert.rejects(tools.action(ctx,{snapshotId:snap.snapshotId,index,action:'click'},async()=>false),/拒绝/);assert.equal(await page.locator('h1').innerText(),'控件测试');
 const after=await tools.action(ctx,{snapshotId:snap.snapshotId,index,action:'click'},async()=>true);assert(after.text.includes('已执行'));
 await assert.rejects(tools.action(ctx,{snapshotId:snap.snapshotId,index,action:'click'},async()=>true),/过期/);
 await assert.rejects(tools.open(ctx,'http://127.0.0.1/'),/不允许/);
 await page.setContent('<p>'+('长文本'.repeat(6000))+'</p>'+Array.from({length:120},(_,i)=>'<button>按钮'+i+'</button>').join(''));const first=await tools.read(ctx);assert.equal(first.nextOffset,6000);assert.equal(first.nextControlsOffset,20);const next=await tools.read(ctx,14000,100);assert.equal(next.elements[0].index,100);assert(next.text.length>0);assert.equal(next.elements.length,20);
 }finally{await tools.close(ctx.task.id);assert.equal(tools.sessions.size,0);}
});
