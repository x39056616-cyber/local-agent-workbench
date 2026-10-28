import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4333);
async function ready(){for(let i=0;i<50;i++){try{return await fetch(base+'/api/session');}catch(error){if(i===49)throw error;await new Promise(r=>setTimeout(r,200));}}throw new Error('隔离服务未就绪');}
const session=await ready(),cookie=session.headers.get('set-cookie')!.split(';')[0];
async function api(p:string,method='GET',body?:any){const r=await fetch(base+'/api'+p,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),d:any=await r.json();assert(r.ok,d.error);return d;}
let prompt='Download https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf and https://raw.githubusercontent.com/morungos/node-word-extractor/develop/__tests__/data/test02.docx . Extract the exact document title/first sentence from each original into comparison.csv with columns source,text; create brief.md with source links and actual missing fields. Independently verify the source extraction as a financial-document pipeline test, without inventing financial figures. Retain the original files. Do not run commands.';
if(process.env.LA_SOURCE_TASK_ID){const db=new DatabaseSync('data/agent.sqlite',{readOnly:true});try{const row=db.prepare('SELECT prompt FROM tasks WHERE id=?').get(process.env.LA_SOURCE_TASK_ID) as any;assert(row);prompt=row.prompt;}finally{db.close();}}
let task:any;const start=performance.now();await mkdir('acceptance',{recursive:true});
try{
 if(process.env.LA_RESUME_TASK_ID){const d=await api('/tasks/'+process.env.LA_RESUME_TASK_ID);task=d.task;await api('/tasks/'+task.id+'/resume','POST',{});}else task=await api('/tasks','POST',{prompt,engine:'auto',intent:'auto',workflow:{mode:'adaptive',maxSteps:20,maxRevisions:1},options:{qwen:{effort:'none'},harness:{effort:'off'}}});console.log('自然语言自动分工验收',task.id);let d:any,last='';
 for(;;){d=await api('/tasks/'+task.id);const state=d.task.status+':'+d.events.filter((e:any)=>e.type==='engine_start').map((e:any)=>e.engine).join(',')+':'+d.events.filter((e:any)=>e.type==='tool_start').length;if(state!==last){console.log(state);last=state;}if(['failed','succeeded','cancelled'].includes(d.task.status))break;if(performance.now()-start>540000){await api('/tasks/'+task.id+'/cancel','POST',{});throw new Error('验收超过九分钟，已停止并保留记录');}await new Promise(r=>setTimeout(r,1000));}
 const choices=d.events.find((e:any)=>e.type==='cooperation_route')?.data.choices;assert(choices,'没有后端自动分工');assert.equal(d.task.status,'succeeded',d.task.error);
 const engines=d.events.filter((e:any)=>e.type==='engine_start').map((e:any)=>e.engine);for(const e of ['harness','qwen','codex'])assert(engines.includes(e),'缺少实际参与 '+e);
 const collected=d.events.filter((e:any)=>e.type==='tool_done'&&e.data.name==='document_collect');assert(collected.length);assert(d.events.some((e:any)=>e.engine==='qwen'&&e.type==='tool_done'&&['document_search','document_read'].includes(e.data.name)));
 const review=d.events.findLast((e:any)=>e.type==='stage_done'&&e.data.id.startsWith('balanced.review'));assert(review?.data.value.passed);
 assert(d.events.some((e:any)=>e.engine==='codex'&&e.type==='tool_done'&&e.data.name==='read_file'));
 const completion=d.events.findLast((e:any)=>e.type==='completion'&&e.engine==='system');assert(completion?.data.files.length);for(const f of completion.data.files)assert((await readFile(path.join(d.task.workspace,f.path))).length>0);
 await writeFile('acceptance/cooperation-live.json',JSON.stringify({passed:true,taskId:task.id,durationMs:Math.round(performance.now()-start),choices:choices.map((c:any)=>({id:c.id,engine:c.engine,category:c.category})),engines,files:completion.data.files,review:review.data.value,answer:d.task.result},null,2));console.log('真实自动分工及独立核验通过');
}catch(error){await writeFile('acceptance/cooperation-live.json',JSON.stringify({passed:false,taskId:task?.id,durationMs:Math.round(performance.now()-start),error:String(error)},null,2));console.error(String(error));process.exitCode=1;}
