import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
const id=process.env.LA_RECOVERY_TASK;if(!id)throw new Error('指定 LA_RECOVERY_TASK；仅用于已核对无写入的预算blocked任务');
const base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4317),session=await fetch(base+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0];
async function api(p:string,method='GET',body?:any){const r=await fetch(base+'/api'+p,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),d:any=await r.json();assert(r.ok,d.error);return d;}
const previous=await api('/tasks/'+id),after=previous.events.at(-1)?.id||0;assert.equal(previous.task.status,'failed');const start=performance.now();let result:any;
try{await api('/tasks/'+id+'/resume','POST',{});let d:any,last='';
 for(;;){d=await api('/tasks/'+id);const recent=d.events.filter((e:any)=>e.id>after),state=d.task.status+':'+recent.filter((e:any)=>e.type==='engine_start').map((e:any)=>e.engine).join(',')+':'+recent.filter((e:any)=>e.type==='tool_start').length;if(state!==last){console.log(state);last=state;}if(['failed','succeeded','cancelled'].includes(d.task.status))break;if(performance.now()-start>300000){await api('/tasks/'+id+'/cancel','POST',{});throw new Error('成果恢复超过五分钟，已停止，不会再自动重做检索');}await new Promise(r=>setTimeout(r,1000));}
 const events=d.events.filter((e:any)=>e.id>after);assert.equal(d.task.status,'succeeded',d.task.error);assert(!events.some((e:any)=>e.type==='tool_start'&&e.data.name==='document_collect'));assert(!events.some((e:any)=>e.type==='engine_start'&&e.engine==='qwen'),'不应重跑已完成提取');
 for(const name of ['company_comparison.csv','research_brief.md','execution_notes.md'])assert((await readFile(path.join(d.task.workspace,name),'utf8')).trim().length>50);
 const review=events.findLast((e:any)=>e.type==='stage_done'&&e.data.id.startsWith('balanced.review'));assert(review?.data.value.passed);
 result={passed:true,taskId:id,durationMs:Math.round(performance.now()-start),status:d.task.status,engines:events.filter((e:any)=>e.type==='engine_start').map((e:any)=>e.engine),files:['company_comparison.csv','research_brief.md','execution_notes.md'],review:review.data.value,answer:d.task.result};console.log('原任务已恢复文件交付并通过独立核验');
}catch(error){result={passed:false,taskId:id,durationMs:Math.round(performance.now()-start),error:String(error)};console.error(String(error));process.exitCode=1;}
await writeFile('acceptance/stall-recovery.json',JSON.stringify(result,null,2));
