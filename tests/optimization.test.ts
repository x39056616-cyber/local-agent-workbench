import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {DeepSeekProvider,deepseekThinking} from '../src/providers.ts';
import {isGreeting,taskRoute} from '../src/routing.ts';
import {Store} from '../src/store.ts';
import {Workflows,validateWorkflow} from '../src/workflows.ts';
import {Tools} from '../src/tools.ts';
import {readChatStream} from '../src/stream.ts';
import {Engines} from '../src/engines.ts';
import {toolSpecs} from '../src/tools.ts';

test('问候仅走快捷对话，含执行要求的文字、显式工具机制不能误走聊天',()=>{
 assert(isGreeting('你好！'));assert(isGreeting('你是谁'));assert(!isGreeting('你好，帮我删除文件'));
 assert.equal(taskRoute({prompt:'你好',engine:'auto'}).engine,'qwen');assert.equal(taskRoute({prompt:'你好',engine:'codex'}).engine,'codex');
 assert.equal(taskRoute({prompt:'你好',engine:'auto',options:JSON.stringify({intent:'task'})}).kind,'task');assert.equal(taskRoute({prompt:'你好',engine:'auto',options:JSON.stringify({workflow:{mode:'react'}})}).kind,'task');
 assert.equal(validateWorkflow(undefined,'auto').mode,'balanced');assert.equal(validateWorkflow(undefined,'qwen').mode,'native');
});
test('归档保留任务与事件，重启后仍可恢复，活动任务不能归档',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-archive-'));let s=new Store(dir);try{const t=s.create('任务','qwen',dir);s.event(t.id,'message','qwen',{text:'保留'});assert.throws(()=>s.archive(t.id,true),/停止/);s.update(t.id,{status:'succeeded'});s.archive(t.id,true);s.close();s=new Store(dir);assert.equal(s.get(t.id)?.archived,1);assert.equal(s.events(t.id).length,1);s.archive(t.id,false);assert.equal(s.get(t.id)?.archived,0);}finally{s.close();await rm(dir,{recursive:true,force:true});}
});
test('均衡模式由后端分别调用规划、执行、核验，并把核验问题交给原执行者修订',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-balanced-')),s=new Store(dir),t=new Tools(s),task=s.create('制作文件','auto',dir),events:any[]=[];const ctx:any={task,signal:new AbortController().signal,emit:(type:string,engine:string,data:any)=>{s.event(task.id,type,engine,data);events.push({type,engine,data});},tool:(n:string,a:any,e:string)=>t.call(ctx,n,a,e)};
 let reviews=0;const called:string[]=[];const engine:any={run:async(e:string,prompt:string,c:any)=>{called.push(e);if(c.stage?.id==='balanced.plan')await c.tool('submit_stage',{payload:JSON.stringify({summary:'事实',steps:['写文件并校验']})},e);else if(c.stage){await c.tool('read_file',{path:'out.md'},e);reviews++;await c.tool('submit_stage',{payload:JSON.stringify({passed:reviews===2,summary:'独立核验',issues:reviews===2?[]:['需补充证据'],files:['out.md']})},e);}else{await c.tool('write_file',{path:'out.md',content:reviews?'已补证据':'初稿'},e);await c.tool('finish_task',{outcome:'completed',summary:'交付',files:['out.md']},e);}return '';}};
 try{await new Workflows(engine,s,()=>{}).run('制作文件',ctx,validateWorkflow(undefined,'auto'));assert.deepEqual(called,['qwen','harness','codex','harness','codex']);assert.equal(events.filter(e=>e.type==='completion').length,1);assert.equal(await readFile(path.join(dir,'out.md'),'utf8'),'已补证据');}finally{s.close();await rm(dir,{recursive:true,force:true});}
});
test('DeepSeek 强度显式映射，不虚构 8 个不同的后端推理深度',()=>{assert.deepEqual(deepseekThinking('off'),{thinking:{type:'disabled'}});assert.equal(deepseekThinking('medium').reasoning_effort,'high');assert.equal(deepseekThinking('ultra').reasoning_effort,'max');assert.throws(()=>deepseekThinking('unlimited'));});
test('流式正文正确跨分片解析，不把 reasoning_content 发到网页',async()=>{
 const encoder=new TextEncoder(),frames=['data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\n','data: {"choices":[{"delta":{"content":"你','好"}}]}\n\ndata: [DONE]\n'];let text='';
 const body=new ReadableStream({start(c){for(const f of frames)c.enqueue(encoder.encode(f));c.close();}});assert.equal(await readChatStream({body},s=>text+=s,()=>{},new AbortController().signal),'你好');assert.equal(text,'你好');
});
test('Qwen 串行队列允许取消等待中的请求，取消后不再启动模型',async()=>{
 const engine=new Engines('',toolSpecs),abort=new AbortController(),calls:string[]=[];let release!:()=>void;
 const blocked=new Promise<void>(r=>release=r),first=engine.serialQwen(async()=>{calls.push('first');await blocked;return 'first';},{signal:new AbortController().signal} as any);
 const second=engine.serialQwen(async()=>{calls.push('second');return 'second';},{signal:abort.signal} as any);abort.abort(new Error('取消排队'));
 try{await assert.rejects(Promise.race([second,new Promise((_,reject)=>setTimeout(()=>reject(new Error('取消未及时生效')),300))]),/取消排队/);}finally{release();await first;}
 await engine.serialQwen(async()=>{calls.push('third');return 'third';},{signal:new AbortController().signal} as any);assert.deepEqual(calls,['first','third']);
});
test('DeepSeek 密钥系统加密、状态不回显、模型发现和认证错误可验证',async t=>{
 if(process.platform!=='win32')return t.skip('DPAPI 仅适用于 Windows');
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-provider-')),p=new DeepSeekProvider(dir),secret='local-fixture-credential';let fail=false;
 const server=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer '+secret);res.setHeader('Content-Type','application/json');if(fail){res.writeHead(401);res.end(JSON.stringify({error:secret}));return;}res.end(JSON.stringify({data:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const baseUrl='http://127.0.0.1:'+(server.address() as any).port+'/v1';await p.save({mode:'api',baseUrl,model:'deepseek-flash',apiKey:secret});assert(!JSON.stringify(p.status()).includes(secret));assert(!(await readFile(p.secretFile,'utf8')).includes(secret));assert.equal(await p.key(),secret);assert.equal((await p.test()).models.length,2);await assert.rejects(p.save({mode:'api',baseUrl:'https://other.example/v1',model:'x'}),/重新填写密钥/);fail=true;await assert.rejects(p.test(),e=>(e as Error).message.includes('401')&&!(e as Error).message.includes(secret));p.clearKey();assert.equal(p.status().hasKey,false);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
test('DeepSeek API 原生调用工具并回传结果和思考字段，不把密钥或思考内容记入事件',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-api-loop-'));let requests=0;const bodies:any[]=[],events:any[]=[],tools:any[]=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);bodies.push(body);assert.equal(req.headers.authorization,'Bearer fixture-token-local');requests++;const message=requests===1?{role:'assistant',content:null,reasoning_content:'hidden-test-reasoning',tool_calls:[{id:'one',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'out.md',content:'真实协议测试'})}}]}:{role:'assistant',content:'完成',tool_calls:[{id:'two',type:'function',function:{name:'finish_task',arguments:JSON.stringify({outcome:'completed',summary:'完成',files:['out.md']})}}]};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}],usage:{prompt_tokens:100,completion_tokens:10}}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const p=new DeepSeekProvider(dir);p.read=()=>({mode:'api',model:'deepseek-v4-pro',baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1'});p.key=async()=> 'fixture-token-local';const engine=new Engines('',toolSpecs);engine.provider=p;
 const ctx:any={task:{id:'fixture',options:JSON.stringify({harness:{model:'deepseek-v4-pro',effort:'medium'}})},onCompleted:()=>{},signal:new AbortController().signal,emit:(...e:any[])=>events.push(e),tool:async(n:string,a:any)=>{tools.push({n,a});return {recorded:true};}};
 await engine.run('harness','协议测试',ctx);assert.equal(requests,2);assert.equal(bodies[0].reasoning_effort,'high');assert.equal(bodies[1].messages[2].reasoning_content,'hidden-test-reasoning');assert.equal(bodies[1].messages[3].role,'tool');assert.equal(tools.length,2);assert(!JSON.stringify(events).includes('fixture-token-local'));assert(!JSON.stringify(events).includes('hidden-test-reasoning'));
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
