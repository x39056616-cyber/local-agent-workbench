// 仅验证搜索/读取工具，不启动或调用 Qwen。真实模型任务需用户恢复模型后另行验收。
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {Store} from '../src/store.ts';
import {Tools} from '../src/tools.ts';
import {taskEvidence} from '../src/evidence.ts';
const dir=path.resolve('acceptance/research-tool-data');await mkdir(dir,{recursive:true});const store=new Store(dir),tools=new Tools(store),task=store.create('搜索并读取 ReAct 原始论文来源','qwen',dir);
const ctx:any={task,signal:AbortSignal.timeout(150000),emit:(type:string,engine:string,data:any)=>store.event(task.id,type,engine,data),tool:(name:string,args:any,e:string)=>tools.call(ctx,name,args,e)};
try{
 const result=await ctx.tool('web_search',{query:'site:arxiv.org/abs/2210.03629 ReAct reasoning acting original paper'},'qwen');assert(result.text.includes('2210.03629'));
 assert.throws(()=>taskEvidence(store.events(task.id),dir,task.prompt),/尚无实际读取/);
 const read=await ctx.tool('web_read',{url:'https://arxiv.org/abs/2210.03629'},'qwen');assert(/ReAct|REACT/.test(read.text));assert(/reasoning|Reasoning/.test(read.text));const ledger=taskEvidence(store.events(task.id),dir,task.prompt);assert(ledger.publicSources().some(s=>s.ref==='https://arxiv.org/abs/2210.03629'));
 await writeFile('acceptance/research-tools-real.json',JSON.stringify({passed:true,modelInvoked:false,qwenStarted:false,actualProvider:result.provider,searchReturnsSource:true,searchOnlyNotAccepted:true,readReturnsOriginalText:true,recordedSources:ledger.publicSources().map(s=>({ref:s.ref,kind:s.kind,tool:s.tool}))},null,2));console.log('真实搜索 → 来源读取 → 工具证据验证通过；未请求 Qwen。');
}finally{store.close();}
