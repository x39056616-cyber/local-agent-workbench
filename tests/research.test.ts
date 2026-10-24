import {toolResponse} from './sse-fixture.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {EvidenceLedger,taskEvidence} from '../src/evidence.ts';
import {researchKinds,taskRoute,requiresFileDelivery} from '../src/routing.ts';
import {Store} from '../src/store.ts';
import {Tools} from '../src/tools.ts';
import {Workflows,validateWorkflow} from '../src/workflows.ts';
import {Desktop} from '../src/desktop.ts';
import {Engines} from '../src/engines.ts';
import {config} from '../src/config.ts';

test('资料请求不会误进纯聊天，教学问题仍不强制检索',()=>{
 for(const prompt of ['帮我找一些Agent资料','查找资料：ReAct原始论文','介绍ReAct，并搜索原始来源','请查阅知识库中的说明','读取附件并整理'])assert.equal(taskRoute({prompt,engine:'auto'}).kind,'task',prompt);
 for(const prompt of ['你好，你是谁','解释向量检索的原理','如何查找资料','比较搜索和检索','什么是ReAct'])assert.equal(taskRoute({prompt,engine:'auto'}).kind,'chat',prompt);
 assert.deepEqual(researchKinds('从本地文件查找资料'),['local']);assert.deepEqual(researchKinds('不用联网，计算12*8'),[]);
});
test('搜索标题、空结果、工具目录不能冒充已读取资料；伪造来源和摘录被拒绝',()=>{
 const ledger=new EvidenceLedger(process.cwd());for(const [name,result] of [['web_search',{text:'标题和网址'}],['knowledge_search',{hits:[]}],['tools_search',{tools:[{name:'fetch_url'}]}]])ledger.record(name as string,{},result);
 assert.throws(()=>ledger.require(['web']),/尚无实际读取/);assert.throws(()=>ledger.require(['local']),/尚无实际读取/);
 ledger.record('web_read',{}, {url:'https://example.com/paper',text:'原始来源包含事实证据和完整说明。'});
 ledger.require(['web'],[{ref:'https://example.com/paper',quote:'事实证据和完整说明'}]);
 assert.throws(()=>ledger.require(['web'],[{ref:'https://fake.example/',quote:'不存在的证据'}]),/没有实际工具记录/);
 assert.throws(()=>ledger.require(['web'],[{ref:'https://example.com/paper',quote:'编造出来的其他结论'}]),/实际读取的原文/);
});
test('网页查看器的行号和排版不会使真实跨行摘录被误判为伪造',()=>{
 const ledger=new EvidenceLedger(process.cwd());ledger.record('web_read',{}, {url:'https://example.com/',text:'L12: reasoning and acting\nL13: in language models'});ledger.require(['web'],[{ref:'https://example.com/',quote:'reasoning and acting in language models'}]);assert.throws(()=>ledger.require(['web'],[{ref:'https://example.com/',quote:'不存在的虚构文字'}]),/实际读取的原文/);
});
test('用户明确需要文件时，文字完成声明与内部计划不能替代文件交付',async()=>fixture(async(s,t,c)=>{
 for(const prompt of ['生成 result.md 文件','导出 PDF','修改 test.py 文件'])assert(requiresFileDelivery(prompt));
 for(const prompt of ['不需要生成文件','不用保存文件','解释如何保存文件','写一段Python示例'])assert(!requiresFileDelivery(prompt),prompt);
 c.task.prompt='请生成 result.md 文件';await assert.rejects(t.call(c,'finish_task',{outcome:'completed',summary:'做完了',files:[]},'qwen'),/用户要求交付文件/);
 await assert.rejects(t.call(c,'finish_task',{outcome:'completed',summary:'做完了',files:['.agent-reports/plan.json']},'qwen'),/内部报告/);
}));
async function fixture(fn:(s:Store,t:Tools,c:any)=>Promise<void>){const dir=await mkdtemp(path.join(os.tmpdir(),'la-research-')),s=new Store(dir),t=new Tools(s),task=s.create('搜索原始来源并生成研究摘要','auto',dir),c:any={task,signal:new AbortController().signal,emit:(type:string,e:string,data:any)=>s.event(task.id,type,e,data),tool:(name:string,args:any,e:string)=>t.call(c,name,args,e)};try{await fn(s,t,c);}finally{s.close();await rm(dir,{recursive:true,force:true});}}
test('研究员必须实际查阅，执行者收到来源；审查员必须读全部成果且不能拿无关文件充数',async()=>fixture(async(s,t,c)=>{
 const execute=t.execute.bind(t);t.execute=async(ctx,name,args,e)=>name==='web_read'?{url:args.url,text:'ReAct combines reasoning and acting in language models.'}:execute(ctx,name,args,e);
 let builderSawEvidence=false;
 const engines:any={run:async(e:string,prompt:string,ctx:any)=>{
  if(ctx.stage?.id==='balanced.plan'){
   await assert.rejects(ctx.tool('submit_stage',{payload:JSON.stringify({summary:'准备搜索',steps:['计划']})},e),/尚无实际读取/);
   await ctx.tool('web_read',{url:'https://example.com/react'},e);
   await ctx.tool('submit_stage',{payload:JSON.stringify({summary:'已读原文',sources:[{ref:'https://example.com/react',quote:'reasoning and acting'}],steps:['引用原文写摘要']})},e);
  }else if(ctx.stage){
   const result={passed:true,summary:'已核对',issues:[],files:['one.md','two.md']};
   await ctx.tool('read_file',{path:'unrelated.md'},e);await assert.rejects(ctx.tool('submit_stage',{payload:JSON.stringify(result)},e),/全部声明成果/);
   await ctx.tool('read_file',{path:'one.md'},e);await assert.rejects(ctx.tool('submit_stage',{payload:JSON.stringify(result)},e),/全部声明成果/);
   await ctx.tool('read_file',{path:'two.md'},e);await ctx.tool('submit_stage',{payload:JSON.stringify(result)},e);
  }else{builderSawEvidence=prompt.includes('https://example.com/react')&&prompt.includes('ReAct combines');for(const file of ['one.md','two.md','unrelated.md'])await ctx.tool('write_file',{path:file,content:'真实单测成果'},e);await ctx.tool('finish_task',{outcome:'completed',summary:'两份摘要完成',files:['one.md','two.md']},e);}
  return '';
 }};
 await new Workflows(engines,s,()=>{}).run(c.task.prompt,c,validateWorkflow({mode:'balanced'},'auto'));assert(builderSawEvidence);assert(s.events(c.task.id).some(e=>e.type==='research_evidence'&&e.data.sources.length===1));
}));
test('原生任务不能只声称检索完成，历史轮次来源不能借用',async()=>fixture(async(s,t,c)=>{
 await assert.rejects(t.call(c,'finish_task',{outcome:'completed',summary:'查完了',files:[]},'qwen'),/尚无实际读取/);
 s.event(c.task.id,'tool_start','qwen',{id:'old',name:'web_read',args:{url:'https://example.com/old'}});s.event(c.task.id,'tool_done','qwen',{id:'old',name:'web_read',result:{url:'https://example.com/old',text:'旧资料'}});s.event(c.task.id,'user_message','user',{text:'搜索新的资料',turnId:'next'});
 assert.throws(()=>taskEvidence(s.events(c.task.id),c.task.workspace,c.task.prompt),/尚无实际读取/);
 assert.equal((await t.call(c,'finish_task',{outcome:'blocked',summary:'连接不可用，未取得来源',files:[]},'qwen')).recorded,true);
}));
test('反思审查必须读取成果，文件变化后不能复用旧审查结论',async()=>fixture(async(s,t,c)=>{
 c.task.prompt='检查结果';c.task.engine='qwen';await writeFile(path.join(c.task.workspace,'result.md'),'有效成果');let reviews=0;
 const engine:any={run:async(_e:string,_p:string,ctx:any)=>{if(ctx.stage.id.startsWith('review')){reviews++;await assert.rejects(ctx.tool('submit_stage',{payload:JSON.stringify({passed:true,issues:[]})},'qwen'),/全部声明成果/);const r=await ctx.tool('read_file',{path:'result.md'},'qwen');await ctx.tool('submit_stage',{payload:JSON.stringify(r.text==='有效成果'?{passed:true,issues:[]}:{passed:false,issues:['内容已改变']})},'qwen');}else await ctx.tool('submit_stage',{payload:JSON.stringify({done:true,summary:'初稿',files:['result.md']})},'qwen');return '';}};
 const runner=new Workflows(engine,s,()=>{}),w=validateWorkflow({mode:'reflection',maxRevisions:0},'qwen');await runner.run('检查结果',c,w);await runner.run('检查结果',c,w);assert.equal(reviews,1);await writeFile(path.join(c.task.workspace,'result.md'),'已改变');await assert.rejects(runner.run('检查结果',c,w),/审查未通过/);assert.equal(reviews,2);
}));
test('升级导致执行方案变化时，均衡协作不能重放旧版已执行的子任务',async()=>fixture(async(s,t,c)=>{
 c.task.prompt='自包含计算';s.event(c.task.id,'subagent_start','harness',{id:'balanced.execute.0',key:'old-version'});s.event(c.task.id,'subagent_done','harness',{id:'balanced.execute.0',key:'old-version',result:{summary:'旧操作已完成',files:[]}});let executions=0;
 const engine:any={run:async(_e:string,_p:string,ctx:any)=>{if(ctx.stage)await ctx.tool('submit_stage',{payload:JSON.stringify({summary:'新计划',steps:['执行']})},'qwen');else executions++;return '';}};
 await assert.rejects(new Workflows(engine,s,()=>{}).run('自包含计算',c,validateWorkflow({mode:'balanced'},'auto')),/避免升级或重新规划后重复副作用/);assert.equal(executions,0);
}));
test('ReAct 旧版动作没有新序号时，改变决定不能重放副作用',async()=>fixture(async(s,t,c)=>{
 c.task.prompt='自包含任务';s.event(c.task.id,'action','qwen',{id:'react',key:'old-action',action:'write_file'});let actions=0;
 const engine:any={run:async(_e:string,_p:string,ctx:any)=>{await ctx.tool('submit_stage',{payload:JSON.stringify({action:'write_file',arguments:{path:'new.txt',content:'不应执行'}})},'qwen');return '';}};const original=c.tool;c.tool=async(n:string,a:any,e:string)=>{actions++;return original(n,a,e);};
 await assert.rejects(new Workflows(engine,s,()=>{}).run('自包含任务',c,validateWorkflow({mode:'react'},'qwen')),/避免重复副作用/);assert.equal(actions,0);
}));
test('研究连接器写入与未知权限在发出调用前被拒绝，搜索遵循真实参数名',async()=>{
 const d=new Desktop();d.status=async()=>({error:'',apps:[],servers:[{name:'codex_apps',tools:[{name:'search_service.web_run',readOnly:true,inputSchema:{properties:{system2_search_query:{},open:{}}}},{name:'write',readOnly:false}]}]});
 const ctx:any={signal:new AbortController().signal};await assert.rejects(d.call(ctx,'codex_apps','write',{},async()=>true,true),/只允许明确标为只读/);
 let args:any;d.call=async(_c,_s,_t,a,_approval,readOnly)=>{assert(readOnly);args=a;return {content:[{type:'text',text:'真实连接器协议样例'}]} as any;};await d.web(ctx,{query:'test'});assert.equal(args.system2_search_query[0].q,'test');assert(!args.search_query);
 d.call=async()=>({content:[{type:'text',text:'Internal Error ()\nFailed to fetch'}]}) as any;await assert.rejects(d.web(ctx,{url:'https://example.com/'}),/不能作为已读取/);
});
test('已取消的搜索或连接器请求不能启动发现与执行进程',async()=>{
 const d=new Desktop(),controller=new AbortController();let inspected=false;controller.abort(new Error('已取消'));d.status=async()=>{inspected=true;throw new Error('不应发现');};const ctx:any={signal:controller.signal};await assert.rejects(d.web(ctx,{query:'test'}),/已取消/);await assert.rejects(d.call(ctx,'s','t',{},async()=>true),/已取消/);await assert.rejects(d.connect(controller.signal),/已取消/);assert.equal(inspected,false);
});
test('搜索正文有界返回，长网页保留按行继续阅读入口',async()=>{
 const d=new Desktop(),ctx:any={signal:new AbortController().signal};d.status=async()=>({error:'',servers:[{name:'codex_apps',tools:[{name:'search_service.web_run',readOnly:true,inputSchema:{properties:{search_query:{},open:{}}}}]}]});let args:any;
 d.call=async(_c,_s,_t,a)=>{args=a;return {content:[{type:'text',text:'原始内容'.repeat(6000)}]} as any;};const search=await d.web(ctx,{query:'test'});assert.equal(search.text.length,8000);assert(search.truncated);assert.equal(args.response_length,'short');const read=await d.web(ctx,{url:'https://example.com/',line:120});assert.equal(read.text.length,16000);assert(read.truncated);assert.equal(args.open[0].lineno,120);assert.equal(args.response_length,'medium');
 const ledger=new EvidenceLedger(process.cwd());ledger.record('web_read',{}, {url:'https://example.com/',text:'第一页的原始资料'});ledger.record('web_read',{}, {url:'https://example.com/',text:'后续页面的原始资料'});ledger.require(['web'],[{ref:'https://example.com/',quote:'第一页的原始资料'}]);
});
test('用户明确禁止命令时，在审批或启动进程前拒绝',async()=>fixture(async(_s,t,c)=>{
 c.task.prompt='请查资料，不要运行命令';let approved=false;t.approval=async()=>{approved=true;return true;};await assert.rejects(t.call(c,'run_command',{command:['echo','test']},'harness'),/用户明确禁止/);assert.equal(approved,false);
}));
test('Markdown 结构换行重复转义时不写入文件，代码中的字面转义保持原样',async()=>fixture(async(_s,t,c)=>{
 await assert.rejects(t.call(c,'write_file',{path:'report.md',content:'# 报告\\n\\n- 内容'},'harness'),/真实换行字符/);await assert.rejects(readFile(path.join(c.task.workspace,'report.md')));const content='# 报告\n\n- 内容';await t.call(c,'write_file',{path:'report.md',content},'harness');assert.equal(await readFile(path.join(c.task.workspace,'report.md'),'utf8'),content);const code='print("\\n")';await t.call(c,'write_file',{path:'demo.py',content:code},'harness');assert.equal(await readFile(path.join(c.task.workspace,'demo.py'),'utf8'),code);
}));
test('Qwen 原生任务提交有效 finish_task 后不再多请求一轮模型',async()=>{
 let count=0;const server=http.createServer(async(req,res)=>{for await(const _ of req){}count++;res.setHeader('Content-Type','text/event-stream');res.end(toolResponse({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'finish',type:'function',function:{name:'finish_task',arguments:JSON.stringify({outcome:'completed',summary:'最终答案',files:[]})}}]}}]}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const original=config.qwenBase;config.qwenBase='http://127.0.0.1:'+(server.address() as any).port;
 try{await new Engines('',()=>[]).qwen('测试',{task:{options:'{}'},signal:AbortSignal.timeout(5000),emit:()=>{},tool:async()=>({recorded:true})} as any);assert.equal(count,1);}finally{config.qwenBase=original;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
test('Qwen 阶段只输出计划时仅提醒一次，随后必须使用实际工具协议',async()=>{
 let count=0;const server=http.createServer(async(req,res)=>{for await(const _ of req){}count++;res.setHeader('Content-Type','text/event-stream');res.end(toolResponse({choices:[{message:count===1?{role:'assistant',content:'我会先规划再查资料。'}:{role:'assistant',content:null,tool_calls:[{id:'submit',type:'function',function:{name:'submit_stage',arguments:JSON.stringify({payload:'{}'})}}]}}]}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const original=config.qwenBase;config.qwenBase='http://127.0.0.1:'+(server.address() as any).port;
 try{const e=new Engines('',()=>[]);let submitted=false;await e.qwen('研究阶段',{task:{options:'{}'},signal:AbortSignal.timeout(5000),stage:{id:'test',readOnly:true},emit:()=>{},tool:async()=>{submitted=true;return {accepted:true};}} as any);assert.equal(count,2);assert(submitted);}finally{config.qwenBase=original;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
test('Qwen 对同一工具错误最多尝试三次，不把不可恢复环境问题循环到三十轮',async()=>{
 let count=0;const server=http.createServer(async(req,res)=>{for await(const _ of req){}count++;res.setHeader('Content-Type','text/event-stream');res.end(toolResponse({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'repeat-'+count,type:'function',function:{name:'web_read',arguments:'{"url":"https://example.com"}'}}]}}]}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const original=config.qwenBase;config.qwenBase='http://127.0.0.1:'+(server.address() as any).port;
 try{await assert.rejects(new Engines('',()=>[]).qwen('测试',{task:{options:'{}'},signal:AbortSignal.timeout(5000),emit:()=>{},tool:async()=>{throw new Error('HTTP 502');}} as any),/连续失败三次/);assert.equal(count,3);}finally{config.qwenBase=original;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
