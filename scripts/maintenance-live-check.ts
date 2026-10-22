// 隔离验收：真实 Qwen 提议网页修改，真实 Codex 沙箱检查，只允许应用到验收副本。
import path from 'node:path';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from '../src/config.ts';
import {Store} from '../src/store.ts';
import {Tools,toolSpecs} from '../src/tools.ts';
import {Maintenance} from '../src/maintenance.ts';
import {Engines} from '../src/engines.ts';
import type {RunContext} from '../src/config.ts';

const data=path.join(config.root,'acceptance','maintenance-live-data'),root=path.join(data,randomUUID(),'app'),workspace=path.join(data,'tasks',randomUUID());
assert(root.startsWith(data+path.sep));await mkdir(root,{recursive:true});await mkdir(workspace,{recursive:true});
const source=new Maintenance();for(const folder of ['web','src','tests','scripts'])await source.walk(path.join(config.root,folder),async file=>{const p=path.join(root,path.relative(config.root,file));await mkdir(path.dirname(p),{recursive:true});await copyFile(file,p);});
for(const file of ['package.json','package-lock.json','tsconfig.json','vite.config.ts'])await copyFile(path.join(config.root,file),path.join(root,file));
await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'dist','index.html'),'old index');
await writeFile(path.join(root,'web','links.ts'),'export function trimUrlToken(token:string){return {url:token,trailing:""};}\n');
const store=new Store(path.join(data,'db')),tools=new Tools(store),m=new Maintenance(root,data);tools.maintenance=m;
const task=store.create('请修改你自己的网页：修复聊天裸网址末尾标点的问题。维护入口的 web/links.ts 中 trimUrlToken 应从末尾去掉 . , ; : ! ?，只移除不成对的 ) ] }，保留查询参数和成对括号。必须 workbench_read 查看源码和 hash，再 workbench_propose_change 提议完整文件，检查通过并收到 applied 后才 finish_task。不要修改其他文件、不运行命令、不联网、不发布 GitHub。','qwen',workspace);
task.options=JSON.stringify({qwen:{effort:'none'}});store.update(task.id,{options:task.options,status:'running'});
const ctx:RunContext={task,signal:AbortSignal.timeout(360000),emit:(type,engine,data)=>{store.event(task.id,type,engine,data);if(type==='message'&&engine==='system')console.log(data.text);},tool:(name,args,engine)=>tools.call(ctx,name,args,engine)};
m.approve=async(_ctx,_action,detail)=>{assert(root.startsWith(data+path.sep));assert(detail.checks.every((c:any)=>c.ok));ctx.emit('fixture_approval','system',{id:detail.id,note:'仅批准隔离副本，不批准正式工作台改动'});return true;};
try{
 const result=await new Engines('',toolSpecs).run('qwen',task.prompt,ctx),events=store.events(task.id);assert(events.some(e=>e.type==='maintenance_applied'));
 assert(events.some(e=>e.type==='tool_done'&&e.engine==='qwen'&&e.data.name==='workbench_read'));
 assert(events.some(e=>e.type==='tool_done'&&e.engine==='qwen'&&e.data.name==='workbench_propose_change'&&e.data.result.status==='applied'));
 assert((await readFile(path.join(root,'dist','index.html'),'utf8')).includes('/assets/'));
 const completion=events.filter(e=>e.type==='completion').at(-1);assert.equal(completion?.data.outcome,'completed');store.update(task.id,{status:'succeeded',result:String(completion?.data.summary||result)});await writeFile(path.join(config.root,'acceptance','maintenance-live.json'),JSON.stringify({task:store.get(task.id),events,fixtureRoot:root},null,2));
 console.log(JSON.stringify({status:'succeeded',taskId:task.id,realModel:'qwen',validation:'Codex command/exec sandbox',appliedTo:'isolated-copy'}));
}catch(e:any){store.update(task.id,{status:'failed',error:e.message});await writeFile(path.join(config.root,'acceptance','maintenance-live-failed.json'),JSON.stringify({task:store.get(task.id),events:store.events(task.id),fixtureRoot:root},null,2));throw e;}
finally{store.close();}
