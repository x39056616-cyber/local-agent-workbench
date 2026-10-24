import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4332),session=await fetch(base+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0];
async function api(route:string,method='GET',body?:any){const r=await fetch(base+'/api'+route,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),d:any=await r.json();assert(r.ok,d.error);return d;}
const results:any[]=[];
try{
 const cases:any[]=[];
 if(process.env.LA_TEST_IMAGE){const p=process.env.LA_TEST_IMAGE;cases.push({name:'vision',engine:'qwen',prompt:'那这是什么？请实际看附件图片，简要说明画面内容并识别其中出现的几个项目名称。',files:[{name:path.basename(p),base64:(await readFile(p)).toString('base64')}]});}
 if(process.env.LA_TEST_CRAWL!=='0')cases.push({name:'crawl-without-url',engine:'auto',prompt:'帮我爬取一份 IANA 对示例域名用途的资料。先搜索找到官网网址，再用 crawl_start 采集一页、maxDepth=0，用 crawl_read 实际读取正文。最后简短说明用途并交付采集文件。不要运行命令。'});
 for(const c of cases){const start=performance.now(),task=await api('/tasks','POST',{...c,intent:'auto',workflow:{mode:'native'},options:{qwen:{effort:'none'},harness:{effort:'off'}}});console.log('开始',c.name,task.id);let d:any,last='';
  for(;;){d=await api('/tasks/'+task.id);const progress=d.task.status+':'+d.events.filter((e:any)=>e.type==='tool_start').length;if(progress!==last){console.log(c.name,progress);last=progress;}if(['succeeded','failed','cancelled'].includes(d.task.status))break;if(performance.now()-start>240000){await api('/tasks/'+task.id+'/cancel','POST',{});throw new Error('验收超时，已停止');}await new Promise(r=>setTimeout(r,1000));}
  assert.equal(d.task.status,'succeeded',d.task.error);assert.equal(JSON.parse(d.task.options).intent,'task');
  const tools=d.events.filter((e:any)=>e.type==='tool_done').map((e:any)=>e.data.name);
  if(c.name==='vision'){assert(tools.includes('image_analyze'));assert(d.events.some((e:any)=>e.type==='vision_done'));assert(!JSON.stringify(d.events).includes(';base64,'));}
  else {for(const name of ['web_search','crawl_start','crawl_read'])assert(tools.includes(name),name);}
  results.push({name:c.name,taskId:task.id,passed:true,durationMs:Math.round(performance.now()-start),tools,answer:d.task.result});console.log('通过',c.name);
 }
}catch(error){results.push({passed:false,error:String(error)});process.exitCode=1;console.error(String(error));}
await mkdir('acceptance',{recursive:true});await writeFile(process.env.LA_TEST_RESULT||'acceptance/vision-crawl-live.json',JSON.stringify(results,null,2));
