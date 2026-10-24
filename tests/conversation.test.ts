import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {isGreeting,taskRoute} from '../src/routing.ts';
import {previewArtifact} from '../src/artifacts.ts';
import {Store} from '../src/store.ts';
import {Agent} from '../src/agent.ts';

test('组合问候、知识问答和代码解释直接聊天，附件与实际操作保留工具路由',()=>{
 for(const prompt of ['你好，你是谁','您好，请介绍一下你自己'])assert(isGreeting(prompt));
 for(const prompt of ['你好，你是谁','什么是ReAct？','帮我解释这段代码：```js\nrun()\n```','比较两种排序算法','如何部署一个网站？'])assert.equal(taskRoute({prompt,engine:'auto'}).kind,'chat',prompt);
 for(const prompt of ['你好，帮我删除文件','创建 hello.md 文件','搜索一下今天的新闻','请运行测试','读取项目代码并修复','解释原理，然后创建 example.md 文件'])assert.equal(taskRoute({prompt,engine:'auto'}).kind,'task',prompt);
 assert.equal(taskRoute({prompt:'总结资料',engine:'auto',hasAttachments:true}).kind,'task');
 for(const mode of ['react','plan','reflection','team'])assert.equal(taskRoute({prompt:'你好',engine:'auto',options:JSON.stringify({workflow:{mode}})}).kind,'task');
 assert.equal(taskRoute({prompt:'旧任务',engine:'harness',options:JSON.stringify({currentPrompt:'解释ReAct'})}).engine,'harness');
});

test('工具任务直接交付 finish_task 的最终答案，后续引擎说明不能覆盖正文',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-final-')),s=new Store(dir),a=new Agent(s,'');
 try{
  const t=s.create('计算结果，不需要文件','qwen',dir);s.update(t.id,{options:JSON.stringify({intent:'task',workflow:{mode:'native'}})});
  a.tools.retrieval.search=async()=>({hits:[],mode:'test',warning:''} as any);
  a.engines.run=async(_e,_p,c)=>{await c.tool('finish_task',{outcome:'completed',summary:'最终答案是77。',files:[]},'qwen');return '我将检查并提交结果。';};
  await a.pump();assert.equal(s.get(t.id)?.status,'succeeded');assert.equal(s.get(t.id)?.result,'最终答案是77。');assert.equal(s.events(t.id).find(e=>e.type==='final')?.data.text,'最终答案是77。');
 }finally{s.close();await rm(dir,{recursive:true,force:true});}
});

test('原生执行的blocked结果直接显示缺口，不换模型重做或丢失最终答复',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-blocked-')),s=new Store(dir),a=new Agent(s,'');
 try{const t=s.create('核对现有资料','qwen',dir);s.update(t.id,{options:JSON.stringify({intent:'task',workflow:{mode:'native'}})});
  a.router.candidates=async()=>[{engine:'qwen',profile:'test',available:true}];a.tools.retrieval.search=async()=>({hits:[],mode:'test',warning:''}) as any;
  let calls=0;a.engines.run=async(_e,_p,c)=>{calls++;await c.tool('finish_task',{outcome:'blocked',summary:'已保存目录，全文0/20份，尚未完成。',files:[]},'qwen');return '结果已提交';};
  await a.pump();assert.equal(calls,1);assert.equal(s.get(t.id)?.status,'failed');assert.equal(s.get(t.id)?.result,'已保存目录，全文0/20份，尚未完成。');assert.equal(s.events(t.id).find(e=>e.type==='final')?.data.outcome,'blocked');
 }finally{s.close();await rm(dir,{recursive:true,force:true});}
});

test('文件预览有界读取、保留中文，拒绝越界和二进制，HTML仅返回文本',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-preview-'));
 try{
  await writeFile(path.join(dir,'a.md'),'# 中文成果');assert.equal((await previewArtifact(dir,'a.md')).kind,'markdown');
  await writeFile(path.join(dir,'big.txt'),'文'.repeat(100000));const large=await previewArtifact(dir,'big.txt');assert(large.truncated);assert(!large.text?.includes('�'));assert(Buffer.byteLength(large.text!)<=262144);
  await writeFile(path.join(dir,'binary.txt'),Buffer.from([0,1,2]));assert.equal((await previewArtifact(dir,'binary.txt')).kind,'download');
  await writeFile(path.join(dir,'x.html'),'<script>alert(1)</script>');assert.equal((await previewArtifact(dir,'x.html')).kind,'text');
  await assert.rejects(previewArtifact(dir,'../secret.txt'));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('聊天首块即时记录、最终答案持久化，取消仍保留部分正文且不生成文件',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-chat-')),s=new Store(dir),a=new Agent(s,'');
 try{
  const t=s.create('你好，你是谁','auto',dir);s.update(t.id,{options:JSON.stringify({intent:'chat',turnId:'one'})});
  a.engines.chat=async(_e,_p,c)=>{c.emit('chat_delta','qwen',{text:'你好'});assert(s.events(t.id).some(e=>e.type==='chat_delta'));c.emit('chat_delta','qwen',{text:'，我是Qwen'});return '你好，我是Qwen';};
  await a.runChat(s.get(t.id)!);assert.equal(s.get(t.id)?.result,'你好，我是Qwen');assert(s.events(t.id).some(e=>e.type==='final'));assert(!s.events(t.id).some(e=>e.type==='artifact'));
  const next=s.create('取消测试','qwen',dir);a.engines.chat=async(_e,_p,c)=>{c.emit('chat_delta','qwen',{text:'保留正文'});c.emit('chat_delta','qwen',{text:'后续'});a.cancel(next.id);c.signal.throwIfAborted();return '';};await a.runChat(next);assert.equal(s.get(next.id)?.status,'cancelled');assert.equal(s.events(next.id).filter(e=>e.type==='chat_delta').map(e=>e.data.text).join(''),'保留正文后续');
 }finally{s.close();await rm(dir,{recursive:true,force:true});}
});
