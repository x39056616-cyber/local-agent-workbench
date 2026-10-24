import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {requestsCrawl} from '../src/crawl-intent.ts';
import {taskRoute,researchKinds} from '../src/routing.ts';
import {classifyTask} from '../src/model-policy.ts';
import {selectTools} from '../src/tool-selection.ts';
import {Tools,toolSpecs,safePath} from '../src/tools.ts';
import {Store} from '../src/store.ts';
import {imageInput} from '../src/image-input.ts';
import {EvidenceLedger} from '../src/evidence.ts';
import {Engines} from '../src/engines.ts';
import {config} from '../src/config.ts';
import {toolResponse} from './sse-fixture.ts';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');

test('无网址、没有网页关键词的爬取仍进入工具研究，教学和禁止爬取不误触发',()=>{
 const prompt='帮我爬取一下23-26正大杯的获奖作品，爬取20份就可以';
 assert.equal(taskRoute({prompt,engine:'auto',options:'{}'}).kind,'task');assert.equal(classifyTask(prompt),'research');assert.deepEqual(researchKinds(prompt),['web']);
 const names=selectTools(toolSpecs(false),prompt).map(s=>s.name);for(const n of ['crawl_start','crawl_read','web_search','web_read'])assert(names.includes(n));
 for(const p of ['如何爬取正大杯获奖作品？','请解释爬虫的原理','不要爬取作品，只解释思路'])assert.equal(requestsCrawl(p),false,p);
 assert.equal(requestsCrawl('请解释规则，然后帮我爬取作品'),true);
 assert.equal(classifyTask('那这是什么\n附件文件：attachments/test.jpg'),'extract');
 assert(selectTools(toolSpecs(false),'那这是什么\n附件文件：attachments/test.jpg').some(s=>s.name==='image_analyze'));
});

test('图片真实格式、大小、工作区边界校验；视觉正文可作为本地资料证据但不冒充网页',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-image-'));try{
  const ctx:any={task:{workspace:dir},signal:new AbortController().signal};await writeFile(path.join(dir,'image.png'),png);await writeFile(path.join(dir,'fake.jpg'),'text');
  const data=await imageInput(ctx,'image.png',safePath);assert.equal(data.mime,'image/png');assert(data.dataUrl.startsWith('data:image/png;base64,'));
  await assert.rejects(imageInput(ctx,'fake.jpg',safePath),/格式无效/);await assert.rejects(imageInput(ctx,'../outside.png',safePath),/越界|工作区/);
  const ledger=new EvidenceLedger(dir);ledger.record('image_analyze',{path:'image.png'},{path:'image.png',text:'识别到图中有文字'});ledger.require(['local']);assert.throws(()=>ledger.require(['web']),/尚无/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('共享图片工具实传 image_url；Qwen 自身及其等待的同任务子工具不排在自己后面，日志没有图片数据',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-vision-')),store=new Store(dir),task=store.create('分析附件图片','auto',dir);task.options='{}';
 const bodies:any[]=[],events:any[]=[],server=http.createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;bodies.push(JSON.parse(raw));res.setHeader('content-type','text/event-stream');res.end(toolResponse({choices:[{message:{role:'assistant',content:'实际图片识别结果'}}]}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const original=config.qwenBase;config.qwenBase='http://127.0.0.1:'+(server.address() as any).port;
 try{
  await writeFile(path.join(dir,'test.png'),png);const engines=new Engines('',()=>[]),tools=new Tools(store);
  tools.vision=(ctx,image,question)=>engines.analyzeImage(ctx,image,question);
  const ctx:any={task,signal:AbortSignal.timeout(5000),emit:(type:string,engine:string,data:any)=>{events.push({type,engine,data});store.event(task.id,type,engine,data);}};
  await engines.serialQwen(async()=>{const result=await tools.call(ctx,'image_analyze',{path:'test.png'},'qwen');assert.equal(result.text,'实际图片识别结果');await tools.call({...ctx},'image_analyze',{path:'test.png',question:'识别文字'},'harness');},ctx);
  assert.equal(bodies.length,2);assert.equal(bodies[0].messages[1].content[1].type,'image_url');assert(bodies[0].messages[1].content[1].image_url.url.startsWith('data:image/png;base64,'));
  assert(!JSON.stringify(events).includes('base64'));assert.equal(engines.qwenOwnerTask,undefined);
 }finally{config.qwenBase=original;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();await rm(dir,{recursive:true,force:true});}
});
