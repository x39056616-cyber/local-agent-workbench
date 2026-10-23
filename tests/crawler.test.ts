import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.ts';
import {Tools,publicFetch} from '../src/tools.ts';
import {CrawlService,crawlUrl,extractPage} from '../src/crawler.ts';
import {EvidenceLedger} from '../src/evidence.ts';
import {requiresTools} from '../src/routing.ts';
import {selectTools} from '../src/tool-selection.ts';
import {toolSpecs} from '../src/tools.ts';

async function fixture(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-crawl-')),store=new Store(dir),tools=new Tools(store),task=store.create('采集公开网页并交付资料','auto',dir);task.options='{"turnId":"one"}';store.update(task.id,{options:task.options});
 const controller=new AbortController(),ctx:any={task,signal:controller.signal,emit:(t:string,e:string,d:any)=>store.event(task.id,t,e,d),tool:(n:string,a:any,e:string)=>tools.call(ctx,n,a,e)},crawler=tools.crawler;
 crawler.intervalMs=0;crawler.startWaitMs=0;crawler.validate=async()=>{};
 const hits:string[]=[],pages:any={
  'https://example.com/robots.txt':'User-agent: *\nDisallow: /blocked',
  'https://example.com/':'<title>首页</title><nav>导航垃圾</nav><main><h1>真实正文</h1><p>甲负责开发</p><a href="/two#x">下一页</a><a href="/two?utm_source=x">重复下一页</a><a href="/same">相同内容</a><a href="/blocked">禁止页</a><a href="https://other.example/">站外页</a></main>',
  'https://example.com/two':'<title>第二页</title><main>乙负责测试</main>',
  'https://example.com/same':'<title>镜像</title><main>乙负责测试</main>'};
 crawler.download=async(url,signal)=>{signal.throwIfAborted();hits.push(url);if(!pages[url])throw new Error('网页返回 HTTP 404');return {url,html:pages[url]};};
 return {dir,store,tools,ctx,crawler,hits,pages,controller,settle:async(id:string)=>{await crawler.active.get(id)?.done;return crawler.status(ctx,id);},close:async()=>{await crawler.close(task.id);store.close();await rm(dir,{recursive:true,force:true});}};
}

test('Crawlee 实际队列跟随站内链接、URL 和正文去重、robots 限制，导出可回读文件',async()=>{
 const f=await fixture();try{
  const start=await f.tools.call(f.ctx,'crawl_start',{urls:['https://example.com/#a','https://example.com/?utm_source=b'],maxPages:8,maxDepth:1},'qwen');
  const result=await f.settle(start.jobId);assert.equal(result.status,'completed');assert.equal(result.counts.done,3);assert.equal(result.counts.skipped,1);assert.equal(f.hits.filter(u=>u==='https://example.com/two').length,1);assert(!f.hits.some(u=>u.includes('other.example')||u.includes('/blocked')));
  assert.equal(result.pages.filter((p:any)=>p.duplicateOf).length,1);assert.equal(result.files.length,3);
  const md=await readFile(path.join(f.dir,result.files.find((f:any)=>f.path.endsWith('sources.md')).path),'utf8');assert(md.includes('甲负责开发'));assert(!md.includes('导航垃圾'));assert.equal((md.match(/乙负责测试/g)||[]).length,1);
  const page=await f.tools.call(f.ctx,'crawl_read',{jobId:start.jobId,url:'https://example.com/two'},'harness');assert.equal(page.text,'乙负责测试');assert(page.fetchedAt);
  const ledger=new EvidenceLedger(f.dir);ledger.record('crawl_status',{},result);assert.throws(()=>ledger.require(['web']),/尚无/);ledger.record('crawl_read',{},page);ledger.require(['web']);
  const reused:any=await f.crawler.start(f.ctx,{urls:['https://example.com/'],maxPages:8,maxDepth:1},'qwen');assert.equal(reused.reused,true);
 }finally{await f.close();}
});

test('动态页面 fallback 仅在正文不足时使用，显式 browser 使用渲染结果；失败保留来源和原因',async()=>{
 const f=await fixture();try{
  f.pages['https://example.com/']='<script>load()</script><div id="app"></div>';let rendered=0;
  f.crawler.render=async(_ctx,url)=>{rendered++;return {url,html:'<title>动态网页</title><main>真正渲染出来的正文</main>'};};
  const j=await f.crawler.start(f.ctx,{urls:['https://example.com/','https://example.com/missing'],maxPages:2,maxDepth:0},'harness'),s=await f.settle(j.jobId);
  assert.equal(rendered,1);assert.equal(s.status,'partial');assert.equal(s.counts.failed,1);assert(String(s.pages!.find((p:any)=>p.state==='failed')!.error).includes('404'));assert.equal(f.crawler.read(f.ctx,j.jobId,'https://example.com/').text,'真正渲染出来的正文');
  const second=await f.crawler.start(f.ctx,{urls:['https://example.com/two'],maxPages:1,mode:'browser'},'harness');await f.settle(second.jobId);assert.equal(rendered,2);
 }finally{await f.close();}
});

test('取消保留队列，显式恢复不会重抓成功页；重启保存来源与任务隔离',async()=>{
 const f=await fixture();try{
  const original=f.crawler.download;let waiting!:()=>void;const started=new Promise<void>(r=>waiting=r);
  f.crawler.download=async(url,signal,origins)=>{if(url==='https://example.com/two'){waiting();await delay(30000,undefined,{signal});}return original(url,signal,origins);};
  const j=await f.crawler.start(f.ctx,{urls:['https://example.com/'],maxPages:8,maxDepth:1},'qwen');await started;
  await assert.rejects(f.tools.call(f.ctx,'finish_task',{outcome:'completed',summary:'提前完成',files:[]},'qwen'),/采集仍在运行/);
  await f.crawler.stop(f.ctx,j.jobId);const paused=await f.crawler.status(f.ctx,j.jobId);assert.equal(paused.status,'paused');assert.equal(paused.counts.done,1);assert(paused.counts.pending>0);
  f.crawler.download=original;await f.crawler.resume(f.ctx,j.jobId,'harness');await f.settle(j.jobId);assert.equal(f.hits.filter(u=>u==='https://example.com/').length,1);
  const restarted=new CrawlService(f.store);assert.equal(restarted.read(f.ctx,j.jobId,'https://example.com/').title,'首页');assert.throws(()=>restarted.read({...f.ctx,task:{...f.ctx.task,id:'other'}},j.jobId,'https://example.com/'),/当前任务没有/);
 }finally{await f.close();}
});

test('运行中服务退出标记中断，恢复持久化 frontier，按原页数预算停止且不能重置',async()=>{
 const f=await fixture();try{
  const j=await f.crawler.start(f.ctx,{urls:['https://example.com/'],maxPages:1,maxDepth:1},'qwen');const s=await f.settle(j.jobId);assert.equal(s.status,'limited');assert.equal(s.counts.done,1);assert(s.counts.pending>0);await assert.rejects(f.crawler.resume(f.ctx,j.jobId,'qwen'),/不能重置预算/);
  f.store.db.prepare("UPDATE crawl_jobs SET status='running' WHERE id=?").run(j.jobId);f.store.db.prepare("UPDATE crawl_pages SET state='inflight' WHERE jobId=? AND url=?").run(j.jobId,'https://example.com/two');
  const next=new CrawlService(f.store);next.intervalMs=0;next.startWaitMs=0;next.validate=f.crawler.validate;next.download=f.crawler.download;assert.equal((await next.status(f.ctx,j.jobId)).status,'interrupted');await next.resume(f.ctx,j.jobId,'qwen');await next.active.get(j.jobId)?.done;assert.equal((await next.status(f.ctx,j.jobId)).counts.done,1);
 }finally{await f.close();}
});

test('公网及跨站重定向限制，非法预算和跨任务读取拒绝；长正文分段且保留截断标识',async()=>{
 const f=await fixture();try{
  const production=new CrawlService(f.store);await assert.rejects(production.start(f.ctx,{urls:['http://127.0.0.1/']},'qwen'),/不允许/);
  await assert.rejects(publicFetch('https://other.example/',new AbortController().signal,0,true,new Set(['https://example.com'])),/超出/);
  await assert.rejects(publicFetch('https://example.com/blocked',new AbortController().signal,0,true,new Set(['https://example.com']),()=>false),/robots/);
  await assert.rejects(f.crawler.start({...f.ctx,stage:{id:'research'}},{urls:['https://example.com/']},'qwen'),/受控阶段/);
  await assert.rejects(f.crawler.start(f.ctx,{urls:['https://example.com/'],maxPages:31},'qwen'),/页数/);
  f.pages['https://example.com/']='<main>'+('长'.repeat(60000))+'</main>';
  const j=await f.crawler.start(f.ctx,{urls:['https://example.com/'],maxPages:1,maxDepth:0},'qwen');await f.settle(j.jobId);const page=f.crawler.read(f.ctx,j.jobId,'https://example.com/');assert.equal(page.text.length,8000);assert.equal(page.nextOffset,8000);assert.equal(page.sourceTruncated,true);assert.equal(f.crawler.read(f.ctx,j.jobId,'https://example.com/',48000).nextOffset,null);
 }finally{await f.close();}
});

test('采集意图进入工具循环，正文保留来源，规范化不混淆协议与查询参数',()=>{
 assert(requiresTools('帮我采集这个网站的最新文章'));assert(!requiresTools('什么是网页爬虫'));
 assert.equal(crawlUrl('https://example.com/a?b=2&utm_source=x&a=1#section'),'https://example.com/a?a=1&b=2');assert.throws(()=>crawlUrl('file:///private'));
 const p=extractPage('<title>测试</title><style>垃圾</style><article><h1>正文</h1><p>有效内容</p></article>','https://example.com/');assert(p.text.includes('有效内容'));assert(!p.text.includes('垃圾'));
 const paging=extractPage('<a href="/author">作者</a><a href="/page/2" rel="next">下一页</a>','https://example.com/');assert.equal(paging.links[0],'https://example.com/page/2');
 const arrow=extractPage('<a href="/author">作者</a><li class="next"><a href="/page/2">Next →</a></li>','https://example.com/');assert.equal(arrow.links[0],'https://example.com/page/2');
 const names=selectTools(toolSpecs(false),'使用 crawl_start 批量采集 https://example.com/').map(s=>s.name);assert(names.includes('crawl_read'));assert(!names.includes('browser_open'));assert(names.includes('tool_invoke'));
});
