import {randomUUID,createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {BasicCrawler} from '@crawlee/basic';
import {Configuration,Log,LogLevel} from '@crawlee/core';
import {load} from 'cheerio';
import {createRequire} from 'node:module';
import type {RunContext} from './config.ts';
import type {Store} from './store.ts';
import {publicAddress,publicFetch,safePath} from './tools.ts';
import {BrowserTools} from './browser.ts';

const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const robotsParser=createRequire(import.meta.url)('robots-parser') as (url:string,text:string)=>{isAllowed:(url:string,agent:string)=>boolean|undefined;getCrawlDelay:(agent:string)=>number|undefined};
export function crawlUrl(input:string,base?:string){
 const u=new URL(input,base);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>2000||u.port&&!['80','443'].includes(u.port))throw new Error('只采集标准端口的公开 HTTP/HTTPS 链接');
 u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.href;
}
export function extractPage(html:string,url:string){
 const $=load(html),title=$('title').first().text().trim().slice(0,300),description=$('meta[name="description"]').attr('content')||'';
 const anchors=$('a[href]').toArray(),next=anchors.filter(el=>/\bnext\b/i.test($(el).attr('rel')||'')||$(el).closest('.next').length>0||/^(下一页|下页|next|next page|›|»)\s*$/i.test($(el).text().trim().replace(/\s*[→›»>⇒]\s*$/,'')));
 const links=[...new Set([...next,...anchors].map(el=>{try{return crawlUrl($(el).attr('href')!,url);}catch{return '';}}).filter(Boolean))].slice(0,500);
 const scripted=$('script').length>0;
 $('script,style,nav,footer,header,aside,noscript,template,form,[hidden]').remove();
 const main=$('main').first().length?$('main').first():$('article').first().length?$('article').first():$('body');
 main.find('p,div,section,h1,h2,h3,h4,li,tr,pre,br').each((_,el)=>{$(el).before('\n');});
 const full=main.text().replace(/[\t \f]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 return {title,description:description.slice(0,1000),text:full.slice(0,50000),truncated:full.length>50000,links,scripted};
}
type Job=any;
type Active={taskId:string;controller:AbortController;done:Promise<void>;crawler?:BasicCrawler;browserId:string};
export class CrawlService {
 store:Store;active=new Map<string,Active>();tail:Promise<void>=Promise.resolve();browser=new BrowserTools();
 intervalMs=1000;startWaitMs=10000;
 // 测试可替换网络边界；实际默认始终校验公网并固定 DNS 解析结果。
 validate=async(url:string)=>{await publicAddress(url);};
 download=async(url:string,signal:AbortSignal,origins:Set<string>,allow?:(url:string)=>boolean)=>publicFetch(url,signal,0,true,origins,allow);
 render=async(ctx:RunContext,url:string,origins:Set<string>)=>{
  const scoped={...ctx,navigationOrigins:[...origins]};await this.browser.open(scoped,url);const s=await this.browser.session(scoped);await s.page.waitForLoadState('networkidle',{timeout:4000}).catch(()=>{});ctx.signal.throwIfAborted();
  const html=await s.page.content();if(Buffer.byteLength(html)>1_000_000)throw new Error('渲染页面超过 1 MB');return {url:s.page.url(),html};
 };
 constructor(store:Store){
  this.store=store;store.db.exec(`CREATE TABLE IF NOT EXISTS crawl_jobs(id TEXT PRIMARY KEY,taskId TEXT,turnId TEXT,key TEXT,options TEXT,status TEXT,created TEXT,updated TEXT,error TEXT DEFAULT '',files TEXT DEFAULT '[]');
   CREATE INDEX IF NOT EXISTS crawl_task ON crawl_jobs(taskId,key);
   CREATE TABLE IF NOT EXISTS crawl_pages(jobId TEXT,url TEXT,depth INTEGER,state TEXT,attempts INTEGER DEFAULT 0,finalUrl TEXT DEFAULT '',title TEXT DEFAULT '',text TEXT DEFAULT '',links TEXT DEFAULT '[]',hash TEXT DEFAULT '',duplicateOf TEXT DEFAULT '',fetchedAt TEXT DEFAULT '',error TEXT DEFAULT '',truncated INTEGER DEFAULT 0,PRIMARY KEY(jobId,url));`);
  store.db.exec("UPDATE crawl_jobs SET status='interrupted',error='服务退出，已保存队列；需显式恢复' WHERE status IN ('running','queued'); UPDATE crawl_pages SET state='pending' WHERE state='inflight';");
 }
 owned(ctx:RunContext,id:string):Job {if(typeof id!=='string')throw new Error('缺少采集任务 ID');const j=this.store.db.prepare('SELECT * FROM crawl_jobs WHERE id=? AND taskId=?').get(id,ctx.task.id);if(!j)throw new Error('当前任务没有这个采集任务');return j;}
 patch(id:string,status:string,error=''){this.store.db.prepare('UPDATE crawl_jobs SET status=?,error=?,updated=? WHERE id=?').run(status,error,new Date().toISOString(),id);}
 async start(ctx:RunContext,args:any,engine:string){
  ctx.signal.throwIfAborted();if(ctx.stage)throw new Error('受控阶段不能创建后台采集；请由顶层执行者创建');
  if(!Array.isArray(args.urls)||!args.urls.length||args.urls.length>8||args.urls.some((u:any)=>typeof u!=='string'))throw new Error('需要 1–8 个起始 URL');
  const urls=[...new Set<string>(args.urls.map((u:string)=>crawlUrl(u)))],maxPages=args.maxPages??8,maxDepth=args.maxDepth??1,mode=args.mode??'auto';
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>30||urls.length>maxPages||!Number.isInteger(maxDepth)||maxDepth<0||maxDepth>3||!['http','auto','browser'].includes(mode))throw new Error('页数 1–30、深度 0–3；模式 http/auto/browser，起始页数不能超过页数预算');
  for(const url of urls)await this.validate(url);
  const options={urls,maxPages,maxDepth,mode},turnId=JSON.parse(ctx.task.options||'{}').turnId||ctx.task.id,key=digest(JSON.stringify([turnId,options]));
  const old=this.store.db.prepare('SELECT * FROM crawl_jobs WHERE taskId=? AND key=? ORDER BY created DESC LIMIT 1').get(ctx.task.id,key) as Job;
  if(old)return {...await this.status(ctx,old.id),reused:true};
  const budget=this.store.db.prepare('SELECT COUNT(*) n,COALESCE(SUM(json_extract(options,\'$.maxPages\')),0) pages FROM crawl_jobs WHERE taskId=? AND turnId=?').get(ctx.task.id,turnId) as any;
  if(budget.n>=4||budget.pages+maxPages>40)throw new Error('每轮最多四个采集任务、合计四十页预算');
  const id=randomUUID(),now=new Date().toISOString();this.store.db.prepare('INSERT INTO crawl_jobs(id,taskId,turnId,key,options,status,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(id,ctx.task.id,turnId,key,JSON.stringify(options),'queued',now,now);
  for(const url of urls)this.enqueue(id,url,0,maxPages);
  ctx.emit('crawl_start',engine,{jobId:id,...options});this.launch(ctx,id,engine);return this.status(ctx,id,this.startWaitMs);
 }
 enqueue(id:string,url:string,depth:number,maxPages:number){
  const n=this.store.db.prepare('SELECT COUNT(*) n FROM crawl_pages WHERE jobId=?').get(id) as any;if(n.n>=maxPages*10)return false;
  return this.store.db.prepare("INSERT OR IGNORE INTO crawl_pages(jobId,url,depth,state) VALUES(?,?,?,'pending')").run(id,url,depth).changes>0;
 }
 launch(ctx:RunContext,id:string,engine:string){
  if(this.active.has(id))return;
  const controller=new AbortController(),browserId=ctx.task.id+':crawl:'+id;
  const abort=()=>controller.abort(ctx.signal.reason);ctx.signal.addEventListener('abort',abort,{once:true});if(ctx.signal.aborted)abort();
  const entry:Active={taskId:ctx.task.id,controller,browserId,done:Promise.resolve()};this.active.set(id,entry);
  entry.done=this.tail.catch(()=>{}).then(()=>this.run(ctx,id,engine,entry)).finally(async()=>{ctx.signal.removeEventListener('abort',abort);await this.browser.close(browserId);this.active.delete(id);});this.tail=entry.done.catch(()=>{});
 }
 async run(parent:RunContext,id:string,engine:string,entry:Active){
  const j=this.owned(parent,id),o=JSON.parse(j.options),origins=new Set<string>(o.urls.map((u:string)=>new URL(u).origin)),controller=entry.controller;
  const ctx={...parent,task:{...parent.task,id:entry.browserId},signal:controller.signal},signal=controller.signal;
  const timer=setTimeout(()=>controller.abort(new Error('采集达到三分钟时限，进度已保留')),180000);
  const robots=new Map<string,ReturnType<typeof robotsParser>>();let lastRequest=0;
  const pace=async(ms=this.intervalMs)=>{await delay(Math.max(0,lastRequest+ms-Date.now()),undefined,{signal});lastRequest=Date.now();};
  let runError='';
  try{
   signal.throwIfAborted();this.patch(id,'running');
   const counts=this.store.db.prepare("SELECT COUNT(*) n FROM crawl_pages WHERE jobId=? AND state IN ('done','failed','skipped')").get(id) as any;
   const remaining=o.maxPages-counts.n;if(remaining<=0){this.patch(id,'limited');return;}
   const pending=this.store.db.prepare("SELECT url,depth FROM crawl_pages WHERE jobId=? AND state='pending' ORDER BY depth,rowid").all(id) as any[];
   const cfg=new Configuration({purgeOnStart:false,persistStorage:false,storageClientOptions:{localDataDirectory:path.join(this.store.directory,'crawler-runtime',id,randomUUID()),persistStorage:false}});
   const crawler=new BasicCrawler({maxConcurrency:1,maxRequestsPerCrawl:remaining,maxRequestRetries:1,requestHandlerTimeoutSecs:80,useSessionPool:false,log:new Log({level:LogLevel.ERROR}),
    requestHandler:async({request})=>{
     signal.throwIfAborted();const url=crawlUrl(request.url),origin=new URL(url).origin;if(!origins.has(origin))throw new Error('超出采集站点范围');await this.validate(url);
     const row=this.store.db.prepare('SELECT * FROM crawl_pages WHERE jobId=? AND url=?').get(id,url) as any;
     if(row.state==='done'||row.state==='skipped')return;
     this.store.db.prepare("UPDATE crawl_pages SET state='inflight',attempts=attempts+1 WHERE jobId=? AND url=?").run(id,url);
     if(!robots.has(origin)){
      const rurl=origin+'/robots.txt';let text='';try{await pace();text=(await this.download(rurl,signal,origins)).html;}catch(e){if(!/HTTP 404|HTTP 410/.test(String(e)))throw e;}
      robots.set(origin,robotsParser(rurl,text));
     }
     const policy=robots.get(origin)!;
     if(policy.isAllowed(url,'LocalAgent')===false){this.store.db.prepare("UPDATE crawl_pages SET state='skipped',error='robots.txt 不允许采集' WHERE jobId=? AND url=?").run(id,url);parent.emit('crawl_progress',engine,{jobId:id,url,state:'skipped'});return;}
     await pace(Math.max(this.intervalMs,(policy.getCrawlDelay('LocalAgent')||0)*1000));
     const allow=(target:string)=>{const p=robots.get(new URL(target).origin);return !!p&&p.isAllowed(target,'LocalAgent')!==false;};
     const attemptSignal=AbortSignal.any([signal,AbortSignal.timeout(65000)]),requestCtx={...ctx,signal:attemptSignal,navigationAllowed:allow};
     let downloaded=o.mode==='browser'?await this.render(requestCtx,url,origins):await this.download(url,attemptSignal,origins,allow),page=extractPage(downloaded.html,downloaded.url);
     if(o.mode==='auto'&&page.scripted&&page.text.length<120){downloaded=await this.render(requestCtx,url,origins);page=extractPage(downloaded.html,downloaded.url);}
     signal.throwIfAborted();if(!origins.has(new URL(downloaded.url).origin))throw new Error('渲染或重定向超出采集站点范围');if(!page.text.trim())throw new Error('网页未取得非空正文');
     const hash=digest(page.text),duplicate=this.store.db.prepare("SELECT url FROM crawl_pages WHERE jobId=? AND hash=? AND state='done' AND url<>? LIMIT 1").get(id,hash,url) as any;
     // 正文与下一页队列在同一个事务落盘，崩溃后不会漏掉已读页发现的链接。
     const next:string[]=[];this.store.db.exec('BEGIN');
     try{
      this.store.db.prepare("UPDATE crawl_pages SET state='done',finalUrl=?,title=?,text=?,links=?,hash=?,duplicateOf=?,fetchedAt=?,error='',truncated=? WHERE jobId=? AND url=?").run(downloaded.url,page.title,page.text,JSON.stringify(page.links),hash,duplicate?.url||'',new Date().toISOString(),Number(page.truncated),id,url);
      if(row.depth<o.maxDepth)for(const link of page.links){if(origins.has(new URL(link).origin)&&! /\.(pdf|zip|png|jpg|jpeg|gif|mp4|mp3|exe|dmg|woff2?)(?:\?|$)/i.test(link)&&this.enqueue(id,link,row.depth+1,o.maxPages))next.push(link);}
      this.store.db.exec('COMMIT');
     }catch(e){this.store.db.exec('ROLLBACK');throw e;}
     if(next.length)await crawler.addRequests(next.map(url=>({url,uniqueKey:url})));
     parent.emit('crawl_progress',engine,{jobId:id,url:downloaded.url,title:page.title,state:'done',duplicateOf:duplicate?.url||'',discovered:next.length});
    },failedRequestHandler:async({request},error)=>{
     const url=crawlUrl(request.url);this.store.db.prepare('UPDATE crawl_pages SET state=?,error=? WHERE jobId=? AND url=?').run(signal.aborted?'pending':'failed',String(error).slice(0,1500),id,url);parent.emit('crawl_progress',engine,{jobId:id,url,state:signal.aborted?'pending':'failed',error:String(error).slice(0,500)});
    }},cfg);
   entry.crawler=crawler;const stop=()=>crawler.stop('采集已停止');signal.addEventListener('abort',stop,{once:true});
   try{await crawler.run(pending.map(p=>({url:p.url,uniqueKey:p.url})));}finally{signal.removeEventListener('abort',stop);}
   signal.throwIfAborted();
   const states=this.stats(id);this.patch(id,states.pending?'limited':states.failed?'partial':'completed');
  }catch(error){runError=String(error);this.patch(id,signal.aborted?'paused':'failed',runError);}
  finally{
   clearTimeout(timer);this.store.db.prepare("UPDATE crawl_pages SET state='pending' WHERE jobId=? AND state='inflight'").run(id);
   if(!parent.signal.aborted){try{await this.export(parent,id,engine);}catch(e){runError=String(e);this.patch(id,'failed','成果导出失败：'+runError);}}
   parent.emit('crawl_done',engine,{...this.summary(id),error:runError||this.owned(parent,id).error});
  }
 }
 stats(id:string){const rows=this.store.db.prepare('SELECT state,COUNT(*) n FROM crawl_pages WHERE jobId=? GROUP BY state').all(id) as any[];const s:any={done:0,pending:0,inflight:0,failed:0,skipped:0};for(const row of rows)s[row.state]=row.n;return s;}
 summary(id:string){const j=this.store.db.prepare('SELECT * FROM crawl_jobs WHERE id=?').get(id) as Job;return {jobId:id,status:j.status,counts:this.stats(id),error:j.error,files:JSON.parse(j.files)};}
 list(ctx:RunContext){ctx.signal.throwIfAborted();return {jobs:this.store.db.prepare('SELECT id AS jobId,status,created,error FROM crawl_jobs WHERE taskId=? ORDER BY created DESC LIMIT 20').all(ctx.task.id),note:'选择 jobId 查询或恢复，不要重新创建重复采集'};}
 async status(ctx:RunContext,id:string,waitMs=0,pagesOffset=0){
  ctx.signal.throwIfAborted();
  this.owned(ctx,id);if(!Number.isInteger(waitMs)||waitMs<0||waitMs>10000||!Number.isInteger(pagesOffset)||pagesOffset<0)throw new Error('等待应为 0–10000 毫秒，目录偏移应为非负整数');
  const a=this.active.get(id);if(a&&waitMs){const waitController=new AbortController();try{await Promise.race([a.done,delay(waitMs,undefined,{signal:AbortSignal.any([ctx.signal,waitController.signal])})]);}finally{waitController.abort();}}
  ctx.signal.throwIfAborted();const pages=this.store.db.prepare('SELECT url,finalUrl,title,state,depth,duplicateOf,fetchedAt,error,truncated FROM crawl_pages WHERE jobId=? ORDER BY rowid LIMIT 10 OFFSET ?').all(id,pagesOffset);
  const n=this.store.db.prepare('SELECT COUNT(*) n FROM crawl_pages WHERE jobId=?').get(id) as any;
  return {...this.summary(id),pages,nextPagesOffset:pagesOffset+pages.length<n.n?pagesOffset+pages.length:null,note:'status 只提供目录。请 crawl_read 读取正文，不能把目录当作已阅读证据。'};
 }
 read(ctx:RunContext,id:string,url:string,offset=0){this.owned(ctx,id);ctx.signal.throwIfAborted();if(!Number.isInteger(offset)||offset<0)throw new Error('读取偏移无效');const p=this.store.db.prepare("SELECT * FROM crawl_pages WHERE jobId=? AND url=? AND state='done'").get(id,crawlUrl(url)) as any;if(!p)throw new Error('本次采集没有该网页的成功正文');return {jobId:id,url:p.finalUrl,title:p.title,text:p.text.slice(offset,offset+8000),total:p.text.length,nextOffset:offset+8000<p.text.length?offset+8000:null,sourceTruncated:!!p.truncated,fetchedAt:p.fetchedAt,duplicateOf:p.duplicateOf,linkCount:JSON.parse(p.links).length};}
 async resume(ctx:RunContext,id:string,engine:string){const j=this.owned(ctx,id);ctx.signal.throwIfAborted();if(ctx.stage)throw new Error('受控阶段不能恢复采集');if(this.active.has(id))return this.status(ctx,id,this.startWaitMs);if(!['paused','interrupted'].includes(j.status))throw new Error('仅暂停或中断的采集可恢复；完成、失败或页数达限不能重置预算');this.patch(id,'queued');this.launch(ctx,id,engine);return this.status(ctx,id,this.startWaitMs);}
 async stop(ctx:RunContext,id:string){this.owned(ctx,id);const a=this.active.get(id);if(a){a.controller.abort(new Error('用户停止采集'));await a.done;}return this.summary(id);}
 async close(taskId:string){const entries=[...this.active.values()].filter(a=>a.taskId===taskId);for(const a of entries)a.controller.abort(new Error('顶层任务已停止或结束，采集进度已保存'));await Promise.allSettled(entries.map(a=>a.done));}
 async export(ctx:RunContext,id:string,engine:string){
  const pages=this.store.db.prepare('SELECT url,finalUrl,title,text,hash,duplicateOf,fetchedAt,state,error,truncated FROM crawl_pages WHERE jobId=? ORDER BY rowid').all(id) as any[],name='crawl-'+id;
  const dir=await safePath(ctx.task.workspace,name);await fs.mkdir(dir,{recursive:true});const files=[];
  const escape=(v:any)=>{const value=String(v??'');return '"'+(/^[\s]*[=+@-]/.test(value)?"'":'')+value.replaceAll('"','""')+'"';};
  const content:any={'pages.json':JSON.stringify({...this.summary(id),pages},null,2),'sources.md':'# 网页采集资料\n\n'+pages.filter(p=>p.state==='done'&&!p.duplicateOf).map(p=>'## '+p.title+'\n\n来源：'+p.finalUrl+'\n\n采集时间：'+p.fetchedAt+'\n\n'+p.text+(p.truncated?'\n\n[正文超过五万字符，已截断]':'')).join('\n\n---\n\n'),'data.csv':'url,title,state,fetchedAt,duplicateOf,error\r\n'+pages.map(p=>[p.finalUrl||p.url,p.title,p.state,p.fetchedAt,p.duplicateOf,p.error].map(escape).join(',')).join('\r\n')};
  for(const [file,text] of Object.entries(content) as [string,string][]){ctx.signal.throwIfAborted();const target=await safePath(ctx.task.workspace,name+'/'+file);await fs.writeFile(target,text,{encoding:'utf8',signal:ctx.signal});files.push({path:name+'/'+file,bytes:Buffer.byteLength(text)});}
  this.store.db.prepare('UPDATE crawl_jobs SET files=? WHERE id=?').run(JSON.stringify(files),id);for(const f of files)ctx.emit('artifact',engine,f);
 }
}
