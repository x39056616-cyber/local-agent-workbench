import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {config} from '../src/config.ts';
import {publicFetch} from '../src/tools.ts';
import {Rpc} from '../src/rpc.ts';
const base=`http://127.0.0.1:${config.port}`;
const session=await fetch(base+'/api/session');const cookie=session.headers.get('set-cookie')!.split(';')[0];
assert.equal((await fetch(base+'/api/tasks')).status,401);
assert.equal((await fetch(base+'/api/tasks',{headers:{cookie,Origin:'https://example.org'}})).status,403);
assert.equal((await fetch(base+'/internal/tools',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
const report:any={sessionAuth:true,crossOriginDenied:true,workerAuth:true,checkedAt:new Date().toISOString()};
const tasks:any=await(await fetch(base+'/api/tasks',{headers:{cookie}})).json();const completed=tasks.find((t:any)=>t.status==='succeeded');
if(completed){const response=await fetch(base+'/api/tasks/'+completed.id+'/events?after=0',{headers:{cookie},signal:AbortSignal.timeout(3000)});const reader=response.body!.getReader();const chunk=await reader.read();assert(new TextDecoder().decode(chunk.value).includes('data:'));await reader.cancel();report.sseReplay=true;}
try{const web=await publicFetch('https://raw.githubusercontent.com/datawhalechina/hello-agents/main/README.md',AbortSignal.timeout(25000));report.publicWeb={ok:web.text.includes('Hello')||web.text.includes('智能体'),characters:web.text.length};}catch(e:any){report.publicWeb={ok:false,error:e.message};}
const dir=path.join(config.root,'acceptance','code');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'sum.js'),'console.log(37 + 12);\n');
const rpc=new Rpc(config.codex,['app-server'],{cwd:dir});
try{await rpc.request('initialize',{clientInfo:{name:'local_agent_sandbox_test',version:'0.1.0'}});rpc.notify('initialized');const result=await rpc.request('command/exec',{command:[process.execPath,'sum.js'],cwd:dir,sandboxPolicy:{type:'workspaceWrite'},timeoutMs:10000},20000);report.codeTask={ok:result.exitCode===0&&result.stdout.trim()==='49',exitCode:result.exitCode,output:result.stdout.trim()};}catch(e:any){report.codeTask={ok:false,error:e.message};}finally{await rpc.close();}
await writeFile(path.join(config.root,'acceptance/system.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(!report.codeTask.ok||!report.publicWeb.ok)process.exitCode=1;
