import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Maintenance,sourceHash,requestsWorkbenchChange} from '../src/maintenance.ts';
import {Store} from '../src/store.ts';
import {Tools} from '../src/tools.ts';
import {taskRoute} from '../src/routing.ts';
import {trimUrlToken} from '../web/links.ts';
import {maintenanceScope} from '../src/maintenance-intent.ts';
import {Workflows,validateWorkflow} from '../src/workflows.ts';

test('维护意图进入工具任务；普通资料任务不获得维护权限',()=>{
 for(const p of ['你自己修改一下你自己，让我点链接就能直接新建标签页跳转过去','为什么执行失败，你自己再修改一下','帮我修复本工作台的链接']){assert(requestsWorkbenchChange(p));assert.equal(taskRoute({prompt:p,engine:'auto'}).kind,'task');}
 assert(!requestsWorkbenchChange('在资料目录写一个网页'));assert(!requestsWorkbenchChange('不要修改本工作台'));
 assert(maintenanceScope('继续修改链接',true));assert(!maintenanceScope('继续帮我查找论文',true));assert(!maintenanceScope('再改一下',false));
});
test('裸网址保留参数和成对括号，去掉中英文句末分隔',()=>{
 assert.deepEqual(trimUrlToken('https://example.com/a?x=1&y=2;'),{url:'https://example.com/a?x=1&y=2',trailing:';'});
 assert.equal(trimUrlToken('https://example.com/a_(b)').url,'https://example.com/a_(b)');
 assert.deepEqual(trimUrlToken('https://example.com/a).'),{url:'https://example.com/a',trailing:').'});
});
async function fixture(fn:(m:Maintenance,c:any,root:string,tools:Tools)=>Promise<void>){
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-maint-')),root=path.join(dir,'app'),workspace=path.join(dir,'task');await mkdir(path.join(root,'web'),{recursive:true});await mkdir(path.join(root,'dist'),{recursive:true});await mkdir(workspace);
 await writeFile(path.join(root,'web','a.tsx'),'before');await writeFile(path.join(root,'dist','index.html'),'old index');for(const f of ['package.json','package-lock.json','tsconfig.json','vite.config.ts'])await writeFile(path.join(root,f),'{}');
 const store=new Store(path.join(dir,'db')),tools=new Tools(store),task=store.create('请修改你自己的界面','auto',workspace),c:any={task,signal:new AbortController().signal,emit:(t:string,e:string,data:any)=>store.event(task.id,t,e,data)};
 const m=new Maintenance(root,path.join(dir,'private'));m.validate=async stage=>{await mkdir(path.join(stage,'dist','assets'),{recursive:true});await writeFile(path.join(stage,'dist','assets','new.js'),'asset');await writeFile(path.join(stage,'dist','index.html'),'new index');return ['TypeScript','Tests','Build'].map(name=>({name,ok:true,output:'通过'}));};
 try{await fn(m,c,root,tools);}finally{store.close();await rm(dir,{recursive:true,force:true});}
}
test('维护读取真实源码和版本，禁止数据、越界、后端写入和普通任务访问',async()=>fixture(async(m,c,_root)=>{
 const file=await m.read(c,'web/a.tsx') as any;assert.equal(file.hash,sourceHash('before'));assert.equal(file.text,'before');
 for(const name of ['data/agent.sqlite','../secret','web/../src/a.ts','.env'])await assert.rejects(m.read(c,name));
 await assert.rejects(m.propose(c,'改后端',[{path:'src/server.ts',beforeHash:'new',content:'bad'}]),/仅支持网页/);
 c.task.prompt='查找资料';await assert.rejects(m.read(c,'web/a.tsx'),/明确要求修改/);
}));
test('先隔离检查和完整报告，拒绝审批不修改正式文件，允许后更新网页',async()=>fixture(async(m,c,root)=>{
 const changes=[{path:'web/a.tsx',beforeHash:sourceHash('before'),content:'after'}];let approvals=0;
 m.approve=async(_ctx,_action,detail)=>{approvals++;assert.equal(detail.checks.length,3);const report=await readFile(path.join(c.task.workspace,detail.report),'utf8');assert(report.includes('修改前')&&report.includes('before')&&report.includes('after'));assert.equal(await readFile(path.join(root,'web','a.tsx'),'utf8'),'before');return false;};
 assert.equal((await m.propose(c,'改界面',changes)).status,'declined');assert.equal(approvals,1);assert.equal(await readFile(path.join(root,'dist','index.html'),'utf8'),'old index');
 await assert.rejects(m.propose(c,'重复请求',changes),/已拒绝/);c.task.options=JSON.stringify({turnId:'new-user-request'});m.approve=async()=>true;assert.equal((await m.propose(c,'改界面',changes)).status,'applied');assert.equal(await readFile(path.join(root,'web','a.tsx'),'utf8'),'after');assert.equal(await readFile(path.join(root,'dist','index.html'),'utf8'),'new index');
}));
test('检查失败、过期版本、审批期间外部修改和发布失败都不能覆盖现有工作',async()=>fixture(async(m,c,root)=>{
 const changes=[{path:'web/a.tsx',beforeHash:sourceHash('before'),content:'after'}];let approvals=0;m.approve=async()=>{approvals++;return true;};
 const valid=m.validate;m.validate=async()=>[{name:'TypeScript',ok:false,output:'错误'}];assert.equal((await m.propose(c,'改界面',changes)).status,'checks_failed');assert.equal(approvals,0);
 m.validate=valid;await assert.rejects(m.propose(c,'旧版本',[{...changes[0],beforeHash:'outdated'}]),/版本已变化/);
 m.approve=async()=>{await writeFile(path.join(root,'web','a.tsx'),'external');return true;};await assert.rejects(m.propose(c,'改界面',changes),/确认期间源码已变化/);assert.equal(await readFile(path.join(root,'web','a.tsx'),'utf8'),'external');
 await writeFile(path.join(root,'web','a.tsx'),'before');c.task.options=JSON.stringify({turnId:'rollback'});m.approve=async()=>true;m.validate=async()=>['TypeScript','Tests','Build'].map(name=>({name,ok:true,output:'未生成文件'}));await assert.rejects(m.propose(c,'模拟发布失败',changes));assert.equal(await readFile(path.join(root,'web','a.tsx'),'utf8'),'before');assert.equal(await readFile(path.join(root,'dist','index.html'),'utf8'),'old index');
}));
test('没有实际维护应用记录，不能用任务目录文件冒充修改成功',async()=>fixture(async(_m,c,_root,tools)=>{
 await assert.rejects(tools.call(c,'finish_task',{outcome:'completed',summary:'我已修改',files:[]},'qwen'),/没有成功应用的维护记录/);
 assert.equal((await tools.call(c,'finish_task',{outcome:'blocked',summary:'未应用',files:[]},'qwen')).recorded,true);
}));
test('均衡协作维护时，审查员必须读取全部实际改动源码，报告或无关源码不能充数',async()=>fixture(async(m,c,_root,tools)=>{
 tools.maintenance=m;m.approve=async()=>true;c.tool=(n:string,a:any,e:string)=>tools.call(c,n,a,e);let report='';
 const engines:any={run:async(e:string,_p:string,ctx:any)=>{
  if(ctx.stage?.id==='balanced.plan'){await ctx.tool('workbench_read',{path:'web/a.tsx'},e);await ctx.tool('submit_stage',{payload:JSON.stringify({summary:'修改界面源码',steps:['应用并独立核验']})},e);}
  else if(ctx.stage){const value={passed:true,summary:'已核对实际源码',issues:[],files:[report]};await ctx.tool('read_file',{path:report},e);await assert.rejects(ctx.tool('submit_stage',{payload:JSON.stringify(value)},e),/全部应用后的改动源码/);await ctx.tool('workbench_read',{path:'package.json'},e);await assert.rejects(ctx.tool('submit_stage',{payload:JSON.stringify(value)},e),/无关文件/);await ctx.tool('workbench_read',{path:'web/a.tsx'},e);await ctx.tool('submit_stage',{payload:JSON.stringify(value)},e);}
  else {const before=await ctx.tool('workbench_read',{path:'web/a.tsx'},e),r=await ctx.tool('workbench_propose_change',{summary:'修复本工作台界面',changes:[{path:'web/a.tsx',beforeHash:before.hash,content:'after'}]},e);assert.equal(r.status,'applied');report=r.report;await ctx.tool('finish_task',{outcome:'completed',summary:'已应用网页改动',files:[report]},e);}return '';
 }};
 await new Workflows(engines,tools.store,()=>{}).run(c.task.prompt,c,validateWorkflow({mode:'balanced'},'auto'));
 assert(tools.store.events(c.task.id).some(e=>e.type==='completion'&&e.engine==='system'));
}));
test('等待审批期间其他源码或配置变化也必须重新验证，不能部署陈旧网页包',async()=>fixture(async(m,c,root)=>{
 m.approve=async()=>{await writeFile(path.join(root,'package.json'),'{"external":true}');return true;};
 await assert.rejects(m.propose(c,'改界面',[{path:'web/a.tsx',beforeHash:sourceHash('before'),content:'after'}]),/确认期间源码已变化/);
 assert.equal(await readFile(path.join(root,'web','a.tsx'),'utf8'),'before');assert.equal(await readFile(path.join(root,'dist','index.html'),'utf8'),'old index');
}));
