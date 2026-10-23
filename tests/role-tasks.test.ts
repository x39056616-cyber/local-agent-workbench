import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.ts';
import {Tools} from '../src/tools.ts';
import {roleTask} from '../src/role-tasks.ts';
import {researchSubtask} from '../src/subtasks.ts';

async function fixture(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-roles-')),store=new Store(dir),tools=new Tools(store),task=store.create('制作给定材料的摘要','auto',dir);
 task.options=JSON.stringify({turnId:'one'});store.update(task.id,{options:task.options});store.event(task.id,'user_message','user',{turnId:'one'});
 const controller=new AbortController(),ctx:any={task,signal:controller.signal,emit:(t:string,e:string,d:any)=>store.event(task.id,t,e,d),tool:(n:string,a:any,e:string)=>tools.call(ctx,n,a,e)};
 let active=ctx,engine:any={run:async()=>''};
 const exclusions:string[][]=[],router:any={select:async(c:any,exclude:string[])=>{exclusions.push(exclude);const e=['harness','codex','qwen'].find(e=>!exclude.includes(e));if(!e)throw new Error('没有可用模型');c.emit('model_route','system',{engine:e});return {engine:e};}};
 const run=(args:any,caller='qwen')=>roleTask(ctx,args,caller,store,engine,router,tools,c=>{active=c;});
 return {dir,ctx,store,tools,controller,engine,exclusions,run,active:()=>active,close:async()=>{store.close();await rm(dir,{recursive:true,force:true});}};
}
const writer={role:'writer',task:'把给定材料整理为 JSON',expected_output:'result.json 为非空 JSON，含 items 数组',input_files:['source.txt'],output_files:['result.json']};
const submit=(c:any,e:string,v:any)=>c.tool('submit_stage',{payload:JSON.stringify(v)},e);
async function produce(e:string,_p:string,c:any){await c.tool('read_file',{path:'input/source.txt'},e);await c.tool('write_file',{path:'output/result.json',content:'{"items":["甲"]}'},e);await c.tool('read_file',{path:'output/result.json'},e);await submit(c,e,{summary:'已生成 JSON'});return '';}

test('角色交接真实文件、独立核验、可复用；子路由不污染主模型，子目录不冒充成果',async()=>{
 const f=await fixture();try{
  await writeFile(path.join(f.dir,'source.txt'),'甲');let calls=0;
  f.engine.run=async(e:string,p:string,c:any)=>{assert.equal(f.active(),c);calls++;return produce(e,p,c);};
  const result=await f.run(writer);assert.equal(result.engine,'harness');assert.equal(JSON.parse(await readFile(path.join(f.dir,result.files[0].path),'utf8')).items[0],'甲');
  assert.equal((await f.run(writer)).reused,true);assert.equal(calls,1);assert.equal(f.active(),f.ctx);
  f.engine.run=async(e:string,_p:string,c:any)=>{assert.equal(e,'codex');await assert.rejects(submit(c,e,{passed:true,summary:'已查',issues:[]}),/完整读取/);await c.tool('read_file',{path:'input/'+result.files[0].path},e);await submit(c,e,{passed:true,summary:'内容符合',issues:[]});return '';};
  const review=await f.run({role:'reviewer',task:'检查交付 JSON',expected_output:writer.expected_output,input_files:result.files.map((f:any)=>f.path),output_files:[]});assert.equal(review.passed,true);assert(f.exclusions.at(-1)!.includes('harness'));
  const events=f.store.events(f.ctx.task.id);assert(!events.some(e=>e.type==='model_route'));assert(events.some(e=>e.type==='subtask_route'));assert(events.filter(e=>e.type==='artifact').every(e=>e.data.path.startsWith('delegated/')));assert(!events.some(e=>e.type==='completion'));
  await writeFile(path.join(f.dir,result.files[0].path),'changed');await assert.rejects(f.run(writer),/被更改/);
 }finally{await f.close();}
});

test('角色工具拒绝越界、改输入、任意命令、递归；错误 JSON 和不完整回读不能交付',async()=>{
 const f=await fixture();try{
  await writeFile(path.join(f.dir,'source.txt'),'a'.repeat(10000));
  f.engine.run=async(e:string,_p:string,c:any)=>{
   for(const [n,a] of [['run_command',{}],['agent_task',{}],['tool_invoke',{name:'write_file'}],['write_file',{path:'input/source.txt',content:'改'}],['write_file',{path:'../escape.txt',content:'越界'}],['write_file',{path:'output/undeclared.md',content:'未声明'}]] as any[])await assert.rejects(c.tool(n,a,e));
   await c.tool('read_file',{path:'input/source.txt',limit:4000},e);
   await assert.rejects(submit(c,e,{summary:'尚未读完'}),/完整读取/);
   await c.tool('read_file',{path:'input/source.txt',offset:4000,limit:6000},e);
   await c.tool('write_file',{path:'output/result.json',content:'{bad'},e);await assert.rejects(submit(c,e,{summary:'格式错误'}),/JSON|position|property|Expected/i);
   await c.tool('write_file',{path:'output/result.json',content:'{"items":["甲"]}'},e);await assert.rejects(submit(c,e,{summary:'未回读'}),/完整读取/);
   await c.tool('read_file',{path:'output/result.json'},e);await submit(c,e,{summary:'已修正并核验'});return '';
  };
  assert((await f.run(writer)).files.length);
 }finally{await f.close();}
});

test('交接要求强制、单引擎与评估禁止委派，取消不发布；未提交不能算成功',async()=>{
 const f=await fixture();try{
  await writeFile(path.join(f.dir,'source.txt'),'甲');
  await assert.rejects(f.run({...writer,expected_output:''}),/验收要求/);
  await assert.rejects(f.run({...writer,output_files:['../escape.json']}),/规范相对路径/);
  await assert.rejects(f.run({...writer,role:'reviewer'}),/不能声明写入/);
  f.ctx.task.engine='qwen';await assert.rejects(f.run(writer),/自动模式/);f.ctx.task.engine='auto';
  await assert.rejects(f.run(writer),/没有提交/);
  f.engine.run=async(e:string,_p:string,c:any)=>{await produce(e,_p,c);f.controller.abort(new Error('已停止'));return '';};
  await assert.rejects(f.run({...writer,task:'第二个独立任务'}),/已停止/);assert(!f.store.events(f.ctx.task.id).some(e=>e.type==='artifact'));
 }finally{await f.close();}
});

test('角色与研究共享四次预算、同引擎共享工具预算；改变输入不复用旧结果',async()=>{
 const f=await fixture();try{
  await writeFile(path.join(f.dir,'source.txt'),'甲');let calls=0;f.engine.run=async(e:string,p:string,c:any)=>{calls++;return produce(e,p,c);};
  await f.run(writer);await writeFile(path.join(f.dir,'source.txt'),'乙');await f.run(writer);assert.equal(calls,2);
  f.store.setSetting('maxCalls',6);await assert.rejects(f.tools.call(f.ctx,'list_files',{},'harness'),/工具调用预算/);
  for(let i=0;i<2;i++)f.store.event(f.ctx.task.id,'research_subtask_start','codex',{});
  await assert.rejects(f.run({...writer,task:'第五个任务'}),/四个/);
  await assert.rejects(researchSubtask(f.ctx,'第五个','qwen',f.store,f.engine,{} as any,()=>{}),/四个/);
 }finally{await f.close();}
});

test('拒绝验收不能完成顶层，修订并重验后可交付；验收后修改会失效',async()=>{
 const f=await fixture();try{
  await writeFile(path.join(f.dir,'source.txt'),'甲');f.engine.run=produce;const result=await f.run(writer),file=result.files[0].path;
  const reviewArgs={role:'reviewer',task:'审查 JSON',expected_output:'包含正确的 items 数组',input_files:[file],output_files:[]};let passed=false;
  f.engine.run=async(e:string,_p:string,c:any)=>{await c.tool('read_file',{path:'input/'+file},e);await submit(c,e,{summary:'检查完成',passed,issues:passed?[]:['items 需要更多材料']});return '';};
  await f.run(reviewArgs);await assert.rejects(f.tools.call(f.ctx,'finish_task',{outcome:'completed',summary:'完成',files:[file]},'qwen'),/验收未通过/);
  await writeFile(path.join(f.dir,file),'{"items":["甲","乙"]}');passed=true;await f.run(reviewArgs);
  await writeFile(path.join(f.dir,file),'{}');await assert.rejects(f.tools.call(f.ctx,'finish_task',{outcome:'completed',summary:'完成',files:[file]},'qwen'),/验收后发生变化/);
 }finally{await f.close();}
});

test('长读取预览按实际返回字符计证据，提供准确下一偏移，不能把截断当作读完',async()=>{
 const f=await fixture();try{
  await writeFile(path.join(f.dir,'source.txt'),'a'.repeat(20000));
  f.engine.run=async(e:string,_p:string,c:any)=>{
   const first=await c.tool('read_file',{path:'input/source.txt'},e);assert.equal(first.nextOffset,8000);assert.equal(first.truncated,true);
   await assert.rejects(submit(c,e,{summary:'不能把预览当全文'}),/完整读取/);
   const next=await c.tool('read_file',{path:'input/source.txt',offset:first.nextOffset,limit:8000},e);assert.equal(next.nextOffset,16000);
   await c.tool('read_file',{path:'input/source.txt',offset:next.nextOffset},e);
   await c.tool('write_file',{path:'output/result.json',content:'{"items":[]}'},e);await c.tool('read_file',{path:'output/result.json'},e);await submit(c,e,{summary:'实际完整回读'});return '';
  };assert((await f.run(writer)).files.length);
 }finally{await f.close();}
});

test('没有独立候选时不得自评，十六次上限也包含失败和提交调用',async()=>{
 const f=await fixture();try{
  await writeFile(path.join(f.dir,'source.txt'),'甲');f.engine.run=produce;const result=await f.run(writer);let called=0;
  f.engine.run=async(e:string,_p:string,c:any)=>{called++;assert.equal(e,'codex');for(let i=0;i<16;i++)await c.tool('read_file',{path:'input/'+result.files[0].path},e);await submit(c,e,{passed:true,issues:[],summary:'超过预算不允许提交'});return '';};
  await assert.rejects(f.run({role:'reviewer',task:'检查是否符合',expected_output:'必须通过完整核验',input_files:[result.files[0].path],output_files:[]}),/十六次/);assert.equal(called,1);
  const router:any={select:async()=>({engine:'harness'})};
  await assert.rejects(roleTask(f.ctx,{role:'reviewer',task:'不可由作者自评',expected_output:'独立核验',input_files:[result.files[0].path],output_files:[]},'qwen',f.store,f.engine,router,f.tools,()=>{}),/独立模型/);assert.equal(called,1);
 }finally{await f.close();}
});
