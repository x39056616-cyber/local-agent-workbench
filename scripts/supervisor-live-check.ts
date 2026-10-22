// 故障注入验收：只模拟规划与执行器退出；接管 Qwen 和审查 Codex 均为真实调用。
// 只能在独立 acceptance 数据目录和 4326 端口运行，不允许指向正式历史。
import http from 'node:http';
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {config} from '../src/config.ts';
import {Store} from '../src/store.ts';
import {Tools,toolSpecs} from '../src/tools.ts';
import {Engines} from '../src/engines.ts';
import {Workflows,validateWorkflow} from '../src/workflows.ts';
import type {RunContext} from '../src/config.ts';

assert.equal(config.port,4326);assert.equal(config.data,path.join(config.root,'acceptance','supervisor-live-data'));
const store=new Store(config.data),tools=new Tools(store),token=randomBytes(32).toString('hex'),real=new Engines(token,toolSpecs);
const workspace=path.join(config.data,'tasks',randomBytes(6).toString('hex'));await mkdir(workspace,{recursive:true});
const task=store.create('把现有草稿 result.md 修订成一句中文：我已接管并完成任务。不得运行命令或联网。','auto',workspace);
store.update(task.id,{status:'running',options:JSON.stringify({qwen:{effort:'none'}})});task.options=store.get(task.id)!.options;
const signal=AbortSignal.timeout(180000);
const ctx:RunContext={task,signal,emit:(type,engine,data)=>store.event(task.id,type,engine,data),tool:(name,args,engine)=>tools.call(ctx,name,args,engine)};
let active=ctx;
const server=http.createServer(async(req,res)=>{
 const send=(status:number,data:any)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 try{
  if(req.method!=='POST'||req.headers.authorization!=='Bearer '+token)return send(403,{error:'认证失败'});
  let body='';for await(const part of req){body+=part;if(body.length>100000)throw new Error('请求过大');}const data=JSON.parse(body);
  if(data.taskId!==task.id||(data.stageId||'')!==(active.stage?.id||''))return send(409,{error:'阶段失效'});
  if(req.url==='/internal/tools')return send(200,active.specs??toolSpecs(false));
  if(req.url==='/internal/call')return send(200,await active.tool(data.name,data.args||{},data.engine==='harness'?'harness':'codex'));
  return send(404,{error:'接口不存在'});
 }catch(e:any){return send(400,{error:e.message});}
});
await new Promise<void>(resolve=>server.listen(config.port,'127.0.0.1',resolve));
try{
 const injected={run:async(engine:string,prompt:string,scoped:RunContext,delegate=false)=>{
  if(scoped.stage?.id==='balanced.plan'){ctx.emit('fault_fixture','system',{kind:'deterministic-plan'});await scoped.tool('submit_stage',{payload:JSON.stringify({summary:'用户已提供目标句子，无需外部资料',steps:['核对并修订草稿']})},engine);return '验收规划';}
  if(engine==='harness'&&!scoped.stage){await scoped.tool('write_file',{path:'result.md',content:'尚未完成的草稿'},engine);ctx.emit('fault_fixture','system',{kind:'injected-executor-exit'});throw new Error('Harness 进程退出（验收注入）');}
  return real.run(engine,prompt,scoped,delegate);
 }};
 const result=await new Workflows(injected as Engines,store,c=>{active=c;}).run(task.prompt,ctx,validateWorkflow({mode:'balanced'},'auto'));
 const events=store.events(task.id);assert(events.some(e=>e.type==='auto_recovery'&&e.data.from==='harness'&&e.data.to==='qwen'));
 assert(events.some(e=>e.type==='tool_done'&&e.engine==='qwen'&&e.data.name==='write_file'));
 assert(events.some(e=>e.type==='tool_done'&&e.engine==='codex'&&e.data.name==='read_file'));
 const backup=events.find(e=>e.type==='recovery_backup');assert(backup);assert.equal(await readFile(path.join(workspace,backup.data.backup),'utf8'),'尚未完成的草稿');
 assert((await readFile(path.join(workspace,'result.md'),'utf8')).includes('我已接管并完成任务'));
 store.update(task.id,{status:'succeeded',result});await writeFile(path.join(config.root,'acceptance','supervisor-live.json'),JSON.stringify({task:store.get(task.id),events},null,2));
 console.log(JSON.stringify({status:'succeeded',taskId:task.id,actualModels:['qwen','codex'],injected:'executor-exit',backupVerified:true,tools:events.filter(e=>e.type==='tool_done').map(e=>({engine:e.engine,name:e.data.name}))}));
}catch(e:any){store.update(task.id,{status:'failed',error:e.message});await writeFile(path.join(config.root,'acceptance','supervisor-live-failed.json'),JSON.stringify({task:store.get(task.id),events:store.events(task.id)},null,2));throw e;}
finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();}
