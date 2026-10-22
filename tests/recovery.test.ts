import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.ts';
import {Tools} from '../src/tools.ts';
import {config} from '../src/config.ts';
import {taskRoute,researchKinds} from '../src/routing.ts';
import {Workflows,validateWorkflow} from '../src/workflows.ts';

async function fixture(fn:(s:Store,t:Tools,c:any)=>Promise<void>){
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-recovery-')),s=new Store(dir),t=new Tools(s),task=s.create('核对自包含资料','auto',dir);
 const c:any={task,signal:new AbortController().signal,emit:(type:string,e:string,data:any)=>s.event(task.id,type,e,data),tool:(name:string,args:any,e:string)=>t.call(c,name,args,e)};
 try{await fn(s,t,c);}finally{s.close();await rm(dir,{recursive:true,force:true});}
}

test('平台检索和月度热榜进入工具任务，平台原理解释仍是快捷对话',()=>{
 for(const prompt of ['帮我在github找这一个月内最受欢迎的3个ai咨询，并总结核心观点','去B站找本月热门AI视频','查 Reddit 最新讨论']){assert.equal(taskRoute({prompt,engine:'auto'}).kind,'task',prompt);assert.deepEqual(researchKinds(prompt),['web']);}
 for(const prompt of ['GitHub是什么','解释 GitHub 如何查找项目','你好'])assert.equal(taskRoute({prompt,engine:'auto'}).kind,'chat',prompt);
});

test('多行 Skill 描述可搜索；参考文件可读但不能越界',async()=>fixture(async(_s,t,c)=>{
 const skillDir=path.join(c.task.workspace,'skills','agent-reach');await mkdir(path.join(skillDir,'references'),{recursive:true});
 await writeFile(path.join(skillDir,'SKILL.md'),'---\nname: agent-reach\ndescription: >\n  用于联网搜索和 GitHub 资料读取。\n  需要验证只读工具。\n---\n# 指令');
 await writeFile(path.join(skillDir,'references','web.md'),'通过已验证只读工具读取网页');
 const old=config.skillRoots;config.skillRoots=[path.join(c.task.workspace,'skills')];try{await t.inventory();}finally{config.skillRoots=old;}
 const found=await t.call(c,'tools_search',{query:'联网 GitHub'},'qwen');assert.equal(found.skills.length,1);assert(found.skills[0].description.includes('需要验证只读工具'));
 assert(t.skillHints('搜索资料').includes('agent-reach'));
 const id=found.skills[0].id;assert((await t.call(c,'skill_read',{id,resource:'references/web.md'},'qwen')).instructions.includes('已验证'));
 await assert.rejects(t.call(c,'skill_read',{id,resource:'../../../outside.md'},'qwen'),/工作|目录|范围|越/);
}));

test('修订修改文件后续接，恢复原审查输入而不重放执行',async()=>fixture(async(s,_t,c)=>{
 let executions=0,reviewOneAttempts=0;
 const engines:any={run:async(e:string,_p:string,ctx:any)=>{
  if(ctx.stage?.id==='balanced.plan')await ctx.tool('submit_stage',{payload:JSON.stringify({summary:'已给定事实',steps:['写摘要']})},e);
  else if(ctx.stage){
   const file=await ctx.tool('read_file',{path:'result.md'},e);
   if(ctx.stage.id==='balanced.review.1'&&++reviewOneAttempts===1)throw new Error('模拟审查中断');
   await ctx.tool('submit_stage',{payload:JSON.stringify({passed:file.text==='修订完成',summary:'核对结论',issues:file.text==='修订完成'?[]:['需要修订'],files:['result.md']})},e);
  }else{executions++;await ctx.tool('write_file',{path:'result.md',content:executions===1?'初稿':'修订完成'},e);await ctx.tool('finish_task',{outcome:'completed',summary:'用户可读答案',files:['result.md']},e);}
  return '';
 }};
 const w=validateWorkflow(undefined,'auto'),runner=new Workflows(engines,s,()=>{});
 await assert.rejects(runner.run('原任务',c,w),/模拟审查中断/);assert.equal(executions,2);
 await runner.run('原任务',c,w);assert.equal(executions,2);assert.equal(await readFile(path.join(c.task.workspace,'result.md'),'utf8'),'修订完成');
 assert(s.events(c.task.id).some(e=>e.type==='stage_reused'&&e.data.reason?.includes('原始审查')));
}));

test('自动模式只读研究失败可移交 Harness，显式 Qwen 保持原错误',async()=>fixture(async(s,_t,c)=>{
 const calls:string[]=[];
 const engines:any={run:async(e:string,_p:string,ctx:any)=>{
  calls.push(e+':'+(ctx.stage?.id||'execute'));
  if(ctx.stage?.id==='balanced.plan'){if(e==='qwen')throw new Error('Qwen 未使用工具');await ctx.tool('submit_stage',{payload:JSON.stringify({summary:'已给定事实',steps:['输出']})},e);}
  else if(ctx.stage)await ctx.tool('submit_stage',{payload:JSON.stringify({passed:true,summary:'已核对',issues:[],files:[]})},e);
  else await ctx.tool('finish_task',{outcome:'completed',summary:'直接交付答案',files:[]},e);
  return '';
 }};
 await new Workflows(engines,s,()=>{}).run('原任务',c,validateWorkflow(undefined,'auto'));
 assert(calls.includes('harness:balanced.plan'));assert(s.events(c.task.id).some(e=>e.type==='research_fallback'&&e.data.to==='harness'));assert(s.events(c.task.id).some(e=>e.type==='stage_done'&&e.data.id==='balanced.plan'&&e.engine==='harness'));
 c.task.engine='qwen';const w=validateWorkflow({mode:'balanced'},'qwen');await assert.rejects(new Workflows(engines,s,()=>{}).run('不同任务',c,w),/Qwen 未使用工具/);
}));
