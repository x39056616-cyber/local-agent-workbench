import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/store.ts';
import {Tools} from '../src/tools.ts';
const dir=path.resolve('acceptance/crawler-network-'+Date.now());await mkdir(dir,{recursive:true});
const store=new Store(dir),tools=new Tools(store),controller=new AbortController(),task=store.create('真实公开网站翻页与动态采集验收','auto',dir);
task.options='{"turnId":"network"}';
const ctx:any={task,signal:controller.signal,emit:(t:string,e:string,d:any)=>store.event(task.id,t,e,d),tool:(n:string,a:any,e:string)=>tools.call(ctx,n,a,e)};
const results:any[]=[];
try{
 for(const mode of ['http','browser']){
  const start=performance.now(),url=mode==='http'?'https://quotes.toscrape.com/':'https://quotes.toscrape.com/js/';
  console.log('实际网络验收',mode,url);
  let state:any=await tools.call(ctx,'crawl_start',{urls:[url],maxPages:mode==='http'?2:1,maxDepth:mode==='http'?1:0,mode},'harness');
  while(['queued','running'].includes(state.status))state=await tools.call(ctx,'crawl_status',{jobId:state.jobId,waitMs:10000},'harness');
  assert.equal(state.counts.done,mode==='http'?2:1,JSON.stringify(state));assert.equal(state.counts.failed,0);
  if(mode==='http')assert(state.pages.some((p:any)=>p.url==='https://quotes.toscrape.com/page/2/'),'未实际跟随下一页链接');
  for(const p of state.pages.filter((p:any)=>p.state==='done')){const page=await tools.call(ctx,'crawl_read',{jobId:state.jobId,url:p.url},'harness');assert(page.text.includes('Albert Einstein')||page.text.includes('J.K. Rowling')||page.text.includes('Jane Austen'));}
  results.push({mode,passed:true,durationMs:Math.round(performance.now()-start),jobId:state.jobId,counts:state.counts,pages:state.pages.filter((p:any)=>p.state==='done').map((p:any)=>({url:p.url,title:p.title})),files:state.files});console.log('通过',mode);
 }
}catch(error){results.push({passed:false,error:String(error)});console.error(String(error));process.exitCode=1;}
finally{await tools.crawler.close(task.id);store.close();await writeFile('acceptance/crawler-network-live.json',JSON.stringify(results,null,2));}
