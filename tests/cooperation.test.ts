import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {cooperationBlueprint,assignCooperation} from '../src/cooperation.ts';
import {automaticCooperation} from '../src/cooperation-router.ts';
import {classifyTask,chooseModel,rankModels} from '../src/model-policy.ts';
import {validateWorkflow} from '../src/workflows.ts';
import {Store} from '../src/store.ts';
import {Agent} from '../src/agent.ts';
import {pdf} from './document-fixture.ts';
import {deliveryRecovery} from '../src/delivery-recovery.ts';

const prompt='Download https://example.com/report.pdf . Extract the annual report revenue, compare fields, verify against the source, and create comparison.csv and brief.md. Retain the PDF. Do not run commands.';
const candidates:any[]=['qwen','harness','codex'].map(engine=>({engine,available:true,profile:'test',observations:[]}));
async function fixture(fn:(a:Agent,s:Store,t:any)=>Promise<void>){const dir=await mkdtemp(path.join(os.tmpdir(),'la-cooperation-')),s=new Store(dir),a=new Agent(s,''),t=s.create(prompt,'auto',dir);t.options=JSON.stringify({workflow:{mode:'adaptive'},turnId:'one',intent:'task'});s.update(t.id,{options:t.options});s.event(t.id,'user_message','user',{turnId:'one',text:prompt});a.router.candidates=async()=>candidates;a.tools.retrieval.search=async()=>({hits:[],mode:'test',warning:''}) as any;
 a.tools.documents.download=async url=>({url,type:'application/octet-stream',bytes:url.endsWith('robots.txt')?Buffer.from('User-agent: *\nAllow: /'):pdf('Annual Report 2025\nRevenue 2025 USD million: 12345\nRevenue 2024 USD million: 10000')});
 try{await fn(a,s,t);}finally{s.close();await rm(dir,{recursive:true,force:true});}}

test('复合任务按阶段分别选模，问候与单步骤下载不强行多人轮流',()=>{
 const b=cooperationBlueprint(prompt)!;assert(b.documents);const plan=assignCooperation(b,'balanced',candidates);assert.deepEqual(plan.roles.map(r=>[r.id,r.engine]),[['researcher','harness'],['extractor','qwen'],['builder','harness'],['reviewer','codex']]);
 assert.equal(cooperationBlueprint('你好，你是谁'),null);assert.equal(cooperationBlueprint('下载2份PDF并提取正文，交付原件'),null);
 const engineering=assignCooperation(cooperationBlueprint('修复多文件并发竞态，添加回归测试')!,'balanced',candidates);assert.equal(engineering.roles.find(r=>r.id==='builder')?.engine,'codex');assert.notEqual(engineering.roles.find(r=>r.id==='reviewer')?.engine,'codex');
 assert.equal(classifyTask('Extract names from this attachment'),'extract');
 const research=candidates.map(c=>({...c,observations:c.engine==='harness'?[{status:'engine_error',durationMs:100},{status:'completed',durationMs:142105}]:[]}));
 assert.equal(chooseModel(rankModels('research','balanced',research),'balanced')?.engine,'harness');
 assert.throws(()=>assignCooperation(b,'balanced',candidates.map(c=>({...c,available:c.engine==='codex'}))),/独立核验/);
});

test('真实文件与证据经四阶段交接，来源获取可下载但不能任意写入，恢复不重放',async()=>fixture(async(a,s,t)=>{
 const calls:string[]=[],ids:string[]=[];
 a.engines.run=async(engine,_prompt,c)=>{calls.push(engine+':'+(c.stage?.id||'writer'));c.emit('engine_start',engine,{});assert.equal(a.active?.ctx,c);
  if(c.stage?.id==='balanced.plan'){
   assert(c.specs!.some(s=>s.name==='document_collect'));await assert.rejects(c.tool('write_file',{path:'forbidden.txt',content:'x'},engine),/禁止/);await assert.rejects(c.tool('run_command',{command:'echo x'},engine),/禁止/);
   const r=await c.tool('document_collect',{urls:['https://example.com/report.pdf']},engine);ids.push(r.items[0].id);await c.tool('document_read',{id:ids[0]},engine);await c.tool('submit_stage',{payload:JSON.stringify({summary:JSON.stringify(r.items),steps:['提取收入','生成CSV并核验']})},engine);
  }else if(c.stage?.id==='balanced.extract'){
   await assert.rejects(c.tool('document_collect',{urls:['https://example.com/other.pdf']},engine),/禁止/);await c.tool('document_search',{id:ids[0],query:'Revenue 2025'},engine);
   await assert.rejects(c.tool('submit_stage',{payload:JSON.stringify({summary:'伪造出处',findings:[{field:'revenue',value:'1',source:'https://false.test',locator:'1',quote:'this was not read'}],issues:[]})},engine),/source|来源/);
   await c.tool('submit_stage',{payload:JSON.stringify({summary:'收入为12345',findings:[{field:'revenue',value:'12345',source:'https://example.com/report.pdf',locator:'PDF page 1',quote:'Revenue 2025 USD million: 12345'}],issues:[]})},engine);
  }else if(c.stage?.id?.startsWith('balanced.review')){
   await assert.rejects(c.tool('submit_stage',{payload:JSON.stringify({passed:true,summary:'未读也通过',issues:[],files:['comparison.csv']})},engine),/实际读取/);
   await c.tool('read_file',{path:'comparison.csv'},engine);await c.tool('document_search',{id:ids[0],query:'Revenue 2025'},engine);
   await c.tool('submit_stage',{payload:JSON.stringify({passed:true,summary:'已核对原文与CSV，收入12345',issues:[],files:['comparison.csv']})},engine);
  }else{assert(_prompt.includes('收入为12345'));await c.tool('write_file',{path:'comparison.csv',content:'year,revenue\n2025,12345\n'},engine);await c.tool('finish_task',{outcome:'completed',summary:'收入12345，见比较表。',files:['comparison.csv']},engine);}
  return 'ok';};
 await a.pump();assert.equal(s.get(t.id)?.status,'succeeded',s.get(t.id)?.error);assert.deepEqual(calls,['harness:balanced.plan','qwen:balanced.extract','harness:writer','codex:balanced.review.0']);assert(s.events(t.id).some(e=>e.type==='final'&&e.engine==='system'));assert((await readFile(path.join(t.workspace,'comparison.csv'),'utf8')).includes('12345'));
 s.update(t.id,{status:'queued'});await a.pump();assert.equal(calls.length,4,'同轮复用全部已核实阶段');assert.equal(s.get(t.id)?.status,'succeeded',s.get(t.id)?.error);
 await writeFile(path.join(t.workspace,'comparison.csv'),'changed');s.update(t.id,{status:'queued'});await a.pump();assert.equal(calls.length,5,'成果改变后必须重新请求独立核验，不能复用旧审查');
}));

test('显式单模型不自动拆分，旧版执行保持恢复边界，取消前不获取候选',async()=>fixture(async(a,s,t)=>{
 const ctx:any={task:t,signal:new AbortController().signal,emit:(ty:string,e:string,d:any)=>s.event(t.id,ty,e,d)};
 const w=validateWorkflow({mode:'adaptive'},'auto');t.engine='qwen';assert.equal(await automaticCooperation(ctx,w,a.router,s),null);t.engine='auto';
 s.event(t.id,'engine_start','codex',{});s.event(t.id,'native_tool','codex',{type:'commandExecution'});assert.equal(await automaticCooperation(ctx,w,a.router,s),null);
 s.event(t.id,'user_message','user',{turnId:'two'});const cancel=new AbortController();cancel.abort();ctx.signal=cancel.signal;a.router.candidates=async()=>{ctx.signal.throwIfAborted();return candidates;};await assert.rejects(automaticCooperation(ctx,w,a.router,s));
}));

test('旧版只完成读取和计划时可迁移，写入过的旧轮不自动重放',async()=>fixture(async(a,s,t)=>{
 const ctx:any={task:t,signal:new AbortController().signal,emit:(ty:string,e:string,d:any)=>s.event(t.id,ty,e,d)},w=validateWorkflow({mode:'adaptive'},'auto');
 s.event(t.id,'engine_start','codex',{});s.event(t.id,'tool_start','codex',{id:'list',name:'list_files'});s.event(t.id,'tool_done','codex',{id:'list',name:'list_files',result:[]});assert(await automaticCooperation(ctx,w,a.router,s));assert(s.events(t.id).some(e=>e.type==='cooperation_migration'));
 s.event(t.id,'user_message','user',{turnId:'two'});s.event(t.id,'engine_start','codex',{});s.event(t.id,'tool_start','codex',{id:'write',name:'write_file'});s.event(t.id,'tool_done','codex',{id:'write',name:'write_file',result:{}});assert.equal(await automaticCooperation(ctx,w,a.router,s),null);
}));

test('获取阶段缺资料提交blocked直达对话，不空跑提取或让别的引擎重做',async()=>fixture(async(a,s,t)=>{
 const calls:string[]=[];a.engines.run=async(e,_p,c)=>{calls.push(e);await c.tool('submit_stage',{payload:JSON.stringify({blocked:true,summary:'原PDF不可访问，尚未取得数据。',steps:['等待来源修复']})},e);return '';};
 await a.pump();assert.equal(s.get(t.id)?.status,'failed');assert.equal(calls.length,1);assert(s.events(t.id).some(e=>e.type==='final'&&e.data.outcome==='blocked'));assert.equal(s.events(t.id).filter(e=>e.type==='auto_recovery').length,0);
}));

test('正文定位返回真实片段和物理页码，空搜索不冒充全文，篡改与跨任务拒绝',async()=>fixture(async(a,s,t)=>{
 const ctx:any={task:t,signal:new AbortController().signal,emit:(ty:string,e:string,d:any)=>s.event(t.id,ty,e,d)},r=await a.tools.documents.collect(ctx,['https://example.com/report.pdf']);const d=r.items[0];
 const found=await a.tools.documents.search(ctx,d.id,'Revenue 2025');assert(found.hits[0].text.includes('12345'));assert.equal(found.hits[0].page,1);assert.equal((await a.tools.documents.search(ctx,d.id,'absent')).hits.length,0);
 await assert.rejects(a.tools.documents.search({...ctx,task:{...t,id:'other'}},d.id,'Revenue'),/本任务/);await writeFile(path.join(t.workspace,d.textPath),'tampered');await assert.rejects(a.tools.documents.search(ctx,d.id,'Revenue'),/修改/);
}));

test('获取阶段最多八次真实工具后自动交接，不等待模型继续包办，阶段记录不冒充质量好评',async()=>fixture(async(a,s,t)=>{
 const calls:string[]=[];let id='';const execute=a.tools.execute.bind(a.tools);a.tools.execute=async(c,name,args,e)=>{if(name==='web_read')throw new Error('网络请求失败');return execute(c,name,args,e);};a.engines.run=async(e,_p,c)=>{calls.push(e);
  if(c.stage?.id==='balanced.plan'){const r=await c.tool('document_collect',{urls:['https://example.com/report.pdf']},e);id=r.items[0].id;for(let i=0;i<7;i++)try{await c.tool('web_read',{url:'https://example.com/fallback/'+i},e);}catch{ /* 失败同样占用获取阶段预算 */ }assert(c.stage.isSubmitted?.());await assert.rejects(c.tool('document_status',{},e),/已提交/);}
  else if(c.stage?.id==='balanced.extract'){await c.tool('document_search',{id,query:'Revenue'},e);await c.tool('submit_stage',{payload:JSON.stringify({summary:'已定位收入',findings:[],issues:[]})},e);}
  else await c.tool('finish_task',{outcome:'blocked',summary:'保留文档，等待补充字段要求。',files:[]},e);return '';
 };
 await a.pump();assert.deepEqual(calls,['harness','qwen','harness']);assert.equal(s.events(t.id).filter(e=>e.type==='tool_start'&&e.engine==='harness').length,8);assert(s.events(t.id).some(e=>e.type==='stage_submission'&&e.data.automatic));assert.equal(s.events(t.id).filter(e=>e.type==='tool_error').length,7);
 const samples=s.db.prepare('SELECT category,rating FROM routing_samples').all();assert.equal(samples.length,2);assert(samples.every((r:any)=>r.rating===null));
}));

test('预算blocked从已核验来源恢复，导出额度跨修订共享，不重跑获取和提取',async()=>fixture(async(a,s,t)=>{
 let blocked=false,id='',writer=0;const calls:string[]=[];
 a.engines.run=async(e,_p,c)=>{calls.push(e+':'+(c.stage?.id||'writer'));
  if(c.stage?.id==='balanced.plan'){const r=await c.tool('document_collect',{urls:['https://example.com/report.pdf']},e);id=r.items[0].id;await c.tool('submit_stage',{payload:JSON.stringify({summary:'已保存原件',steps:['提取并制作CSV']})},e);}
  else if(c.stage?.id==='balanced.extract'){await c.tool('document_read',{id},e);for(let i=0;i<29;i++)await a.tools.call({...c,emit:(ty:string,actor:string,d:any)=>s.event(t.id,ty,actor,d)},'document_status',{},'harness');await c.tool('submit_stage',{payload:JSON.stringify({summary:'收入12345',findings:[],issues:[]})},e);}
  else if(c.stage?.id?.startsWith('balanced.review')){await c.tool('read_file',{path:'comparison.csv'},e);await c.tool('document_search',{id,query:'Revenue'},e);await c.tool('submit_stage',{payload:JSON.stringify(c.stage.id.endsWith('.0')?{passed:false,summary:'需要补单位',issues:['补充USD millions'],files:['comparison.csv']}:{passed:true,summary:'已核对收入与单位',issues:[],files:['comparison.csv']})},e);}
  else if(!blocked){await assert.rejects(c.tool('write_file',{path:'comparison.csv',content:'must not write'},e),/预算/);blocked=true;await c.tool('finish_task',{outcome:'blocked',summary:'工具预算耗尽，尚未导出',files:[]},e);}
  else{writer++;assert(c.budget);await assert.rejects(c.tool('web_search',{query:'not allowed'},e),/成果恢复额度/);if(writer>1)await c.tool('read_file',{path:'comparison.csv'},e);await c.tool('write_file',{path:'comparison.csv',content:'year,revenue'+(writer>1?',unit':'')+'\n2025,12345'+(writer>1?',USD millions':'')+'\n'},e);await c.tool('read_file',{path:'comparison.csv'},e);await c.tool('finish_task',{outcome:'completed',summary:'已保存比较表',files:['comparison.csv']},e);}
  return '';
 };
 await a.pump();assert.equal(s.get(t.id)?.status,'failed');
 const task=s.get(t.id)!;
 const recovery=deliveryRecovery(task,s.events(t.id));assert(recovery);s.update(t.id,{status:'queued',options:JSON.stringify({...JSON.parse(task.options||'{}'),deliveryRecovery:recovery})});
 await a.pump();assert.equal(s.get(t.id)?.status,'succeeded',s.get(t.id)?.error);assert.equal(writer,2);assert((await readFile(path.join(t.workspace,'comparison.csv'),'utf8')).includes('USD millions'));assert.equal(calls.filter(c=>c.includes('balanced.plan')).length,1);assert.equal(calls.filter(c=>c.includes('balanced.extract')).length,1);
}));
