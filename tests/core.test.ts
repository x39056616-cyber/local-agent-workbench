import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, readFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.ts';
import { safePath, publicIPv4, Tools } from '../src/tools.ts';
import { Agent } from '../src/agent.ts';
import type { RunContext } from '../src/config.ts';

test('工作区允许内部文件，拒绝同名前缀目录、上级目录与 junction',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'local-agent-path-')),root=path.join(dir,'work'),outside=path.join(dir,'work-other');await mkdir(root);await mkdir(outside);
  try{assert.equal(await safePath(root,'a/b.txt'),path.join(await realpath(root),'a/b.txt'));await assert.rejects(safePath(root,'../work-other/file.txt'),/超出/);await assert.rejects(safePath(root,outside),/超出/);await symlink(outside,path.join(root,'escape'),process.platform==='win32'?'junction':'dir');await assert.rejects(safePath(root,'escape/new.txt'),/工作区外/);}finally{await rm(dir,{recursive:true,force:true});}
});
test('公网读取阻止内网、回环、链路本地及非 IPv4 地址',()=>{for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.2','169.254.169.254','100.64.0.1','::1','224.0.0.1'])assert.equal(publicIPv4(ip),false,ip);assert.equal(publicIPv4('1.1.1.1'),true);});
test('重启将活动任务标为已中断，保留事件与长期记忆',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'local-agent-db-'));let s=new Store(dir);try{const t=s.create('整理测试','qwen',dir);s.update(t.id,{status:'running'});s.event(t.id,'tool_done','qwen',{path:'result.md'});s.remember('报告使用简体中文并列出来源');s.close();s=new Store(dir);assert.equal(s.get(t.id)?.status,'interrupted');assert.equal(s.events(t.id)[0].data.path,'result.md');assert.equal(s.memories('简体中文').length,1);}finally{s.close();await rm(dir,{recursive:true,force:true});}
});
test('工具拒绝非法参数和委派越权，写入成果可重新读取且有操作登记',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'local-agent-tools-'));const store=new Store(dir),tools=new Tools(store);const task=store.create('生成文本','qwen',dir),events:any[]=[];const ctx:RunContext={task,signal:new AbortController().signal,emit:(...args)=>events.push(args),tool:async()=>{}};
  try{await assert.rejects(tools.call(ctx,'write_file',{path:'x.txt',content:12},'qwen'),/类型/);await assert.rejects(tools.call(ctx,'delegate',{engine:'harness',task:'test'},'qwen'),/主控/);await tools.call(ctx,'write_file',{path:'result/output.md',content:'验收通过'},'qwen');const r=await tools.call(ctx,'read_file',{path:'result/output.md'},'qwen');assert.equal(r.text,'验收通过');assert(events.some(e=>e[0]==='artifact'));assert.equal((store.db.prepare("SELECT count(*) n FROM operations WHERE status='succeeded'").get() as any).n,2);}finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('审批拒绝会被记录，取消等待不触发执行',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'local-agent-approve-'));const store=new Store(dir),agent=new Agent(store,'test'),task=store.create('test','qwen',dir),controller=new AbortController();let approvalId='';const ctx:RunContext={task,signal:controller.signal,emit:(type,_engine,data)=>{if(type==='approval')approvalId=data.id;},tool:async()=>{}};
  try{const pending=agent.approve(ctx,'test',{});assert(approvalId);agent.resolveApproval(approvalId,false);assert.equal(await pending,false);const other=agent.approve(ctx,'test2',{});controller.abort();assert.equal(await other,false);assert.equal(agent.approvals.size,0);}finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('完成声明引用不存在的文件时不能通过，预算耗尽会阻止后续调用',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'local-agent-finish-')),store=new Store(dir),tools=new Tools(store),task=store.create('test','qwen',dir),events:any[]=[];
  const ctx:RunContext={task,signal:new AbortController().signal,emit:(...e)=>events.push(e),tool:async()=>{}};
  try{await assert.rejects(tools.call(ctx,'finish_task',{outcome:'completed',summary:'完成',files:['不存在.md']},'qwen'));assert(!events.some(e=>e[0]==='completion'));store.setSetting('maxCalls',1);await assert.rejects(tools.call(ctx,'list_files',{},'qwen'),/预算/);}finally{store.close();await rm(dir,{recursive:true,force:true});}
});
