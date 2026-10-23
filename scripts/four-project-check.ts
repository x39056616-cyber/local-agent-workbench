import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4330),s=await fetch(base+'/api/session'),cookie=s.headers.get('set-cookie')!.split(';')[0];
async function api(p:string,method='GET',body?:any){const r=await fetch(base+'/api'+p,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const d:any=await r.json();assert(r.ok,JSON.stringify(d));return d;}
const cases=[
 {name:'Qwen 请求真实 DeepSeek 子任务并整合成果',prompt:'提取并核对这段材料：张三负责开发和测试，李四负责设计，张三再次负责测试。请先调用 research_subtask，把独立去重核对交给子模型，子任务完整提供这段材料，要求返回去重姓名与职责；收到子模型结果后，由你生成 result.md，并在最终回答中列出两个人的职责。不要联网，不运行命令。',verify:(d:any)=>{assert(d.events.some((e:any)=>e.type==='research_subtask_done'));assert(d.events.some((e:any)=>e.type==='engine_start'&&e.engine==='qwen'));assert(d.events.some((e:any)=>e.type==='engine_start'&&e.engine==='harness'));assert(d.task.result.includes('张三'));}},
 {name:'模型真实使用浏览器读网页并交付来源',prompt:'请用 browser_open 打开 https://example.com ，根据返回的网页快照说明页面用途，并列出页面中实际存在的链接，生成 browser-report.md。必须实际调用 browser_open，不用 web_read 代替；无需点击按钮或填写表单，不运行命令。',verify:(d:any)=>{assert(d.events.some((e:any)=>e.type==='tool_done'&&e.data.name==='browser_open'&&e.data.result.title==='Example Domain'&&e.data.result.text.length>0&&e.data.result.elements.some((x:any)=>x.href?.includes('iana.org'))));assert(d.task.result.includes('example.com')||d.task.result.includes('Example'));}}
];
const prior=process.env.LA_VERIFY_LAST?JSON.parse(await readFile('acceptance/four-project-live.json','utf8')):[];
const results:any[]=[];
for(const c of cases){let task:any;const start=performance.now();try{
 task=process.env.LA_VERIFY_LAST?{id:prior.find((x:any)=>x.name===c.name).taskId}:await api('/tasks','POST',{engine:'auto',intent:'task',workflow:{mode:'adaptive'},options:{qwen:{effort:'none'},harness:{effort:'off'}},prompt:c.prompt});console.log('提交',c.name,task.id);
 let d:any,last='',deadline=Date.now()+240000;for(;;){d=await api('/tasks/'+task.id);const progress=d.task.status+':'+d.events.filter((e:any)=>e.type==='tool_start').length;if(progress!==last){console.log(c.name,progress);last=progress;}if(['succeeded','failed','cancelled'].includes(d.task.status))break;if(Date.now()>deadline){await api('/tasks/'+task.id+'/cancel','POST',{});throw new Error('真实验收超过四分钟');}await new Promise(r=>setTimeout(r,700));}
 assert.equal(d.task.status,'succeeded',d.task.error);c.verify(d);results.push({name:c.name,taskId:task.id,passed:true,durationMs:Math.round(performance.now()-start),engines:d.events.filter((e:any)=>e.type==='engine_start').map((e:any)=>e.engine),tools:d.events.filter((e:any)=>e.type==='tool_start').map((e:any)=>({engine:e.engine,name:e.data.name})),answer:d.task.result});console.log('通过',c.name);
 }catch(error){results.push({name:c.name,taskId:task?.id,passed:false,error:String(error)});process.exitCode=1;console.error('失败',String(error));}
 await writeFile('acceptance/four-project-live.json',JSON.stringify(results,null,2));
}
