import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4332),session=await fetch(base+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0];
async function api(p:string,method='GET',body?:any){const r=await fetch(base+'/api'+p,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),d:any=await r.json();assert(r.ok,JSON.stringify(d));return d;}
const cases=[
 {engine:'qwen',mode:'http',urls:['https://example.com/','https://www.iana.org/help/example-domains'],prompt:'使用 crawl_start 批量采集 https://example.com/ 和 https://www.iana.org/help/example-domains ，maxPages=2、maxDepth=0、mode=http。等待采集结束，必须分别 crawl_read 两个网页的实际正文，说明它们各自的用途与联系；最后交付自动生成的 sources.md、pages.json、data.csv，并在对话直接给出简短结论和来源链接。不要用 web_read 或 fetch_url 替代，不运行命令。'},
 {engine:'harness',mode:'browser',urls:['https://example.com/'],prompt:'使用 crawl_start，urls=["https://example.com/"]、maxPages=1、maxDepth=0、mode=browser，通过浏览器实际采集网页。等待结束并 crawl_read 正文，再直接回答页面用途和来源，并交付自动导出的 sources.md、pages.json、data.csv。不要用 browser_open 或 web_read 替代，不运行命令。'}
];
const saved=await readFile('acceptance/crawler-live.json','utf8').then(JSON.parse).catch(()=>[]),previous=process.env.LA_VERIFY_LAST?saved:[],results:any[]=process.env.LA_TEST_ENGINE?saved.filter((p:any)=>p.engine!==process.env.LA_TEST_ENGINE):[];
for(const c of cases.filter(c=>!process.env.LA_TEST_ENGINE||c.engine===process.env.LA_TEST_ENGINE)){let task:any;const start=performance.now();try{
 task=process.env.LA_VERIFY_LAST?{id:previous.find((p:any)=>p.engine===c.engine).taskId}:await api('/tasks','POST',{engine:c.engine,intent:'task',workflow:{mode:'native'},options:{qwen:{effort:'none'},harness:{effort:'off'}},prompt:c.prompt});console.log('提交真实采集',c.engine,task.id);
 let d:any,last='',deadline=Date.now()+240000;for(;;){d=await api('/tasks/'+task.id);const progress=d.task.status+':'+d.events.filter((e:any)=>e.type==='tool_start').length;if(progress!==last){console.log(c.engine,progress);last=progress;}if(['succeeded','failed','cancelled'].includes(d.task.status))break;if(Date.now()>deadline){await api('/tasks/'+task.id+'/cancel','POST',{});throw new Error('验收超时，已停止');}await new Promise(r=>setTimeout(r,1000));}
 assert.equal(d.task.status,'succeeded',d.task.error);
 const startEvent=d.events.find((e:any)=>e.type==='crawl_start');assert(startEvent);assert.equal(startEvent.data.mode,c.mode);
 const done=d.events.find((e:any)=>e.type==='crawl_done');assert(done);assert.equal(done.data.counts.done,c.urls.length);assert.equal(done.data.counts.failed,0);
 const reads=d.events.filter((e:any)=>e.type==='tool_done'&&e.data.name==='crawl_read');assert.equal(new Set(reads.map((e:any)=>e.data.result.url)).size,c.urls.length);
 const source=done.data.files.find((f:any)=>f.path.endsWith('sources.md')),json=done.data.files.find((f:any)=>f.path.endsWith('pages.json')),csv=done.data.files.find((f:any)=>f.path.endsWith('data.csv'));assert(source&&json&&csv);
 const pages=JSON.parse(await readFile(d.task.workspace+'/'+json.path,'utf8')).pages;assert.equal(pages.filter((p:any)=>p.state==='done').length,c.urls.length);assert(pages.every((p:any)=>p.text.length>0&&p.fetchedAt));assert(d.task.result.includes('example.com')||d.task.result.includes('Example'));
 results.push({engine:c.engine,taskId:task.id,passed:true,durationMs:Math.round(performance.now()-start),mode:c.mode,counts:done.data.counts,files:done.data.files,answer:d.task.result});console.log('通过',c.engine,c.mode);
}catch(error){results.push({engine:c.engine,taskId:task?.id,passed:false,error:String(error)});console.error(String(error));process.exitCode=1;}
await mkdir('acceptance',{recursive:true});await writeFile('acceptance/crawler-live.json',JSON.stringify(results,null,2));}
