import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {config} from '../src/config.ts';
const base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4319);
const session=await fetch(base+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0];
async function api(p:string,method='GET',body?:any){const r=await fetch(base+'/api'+p,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d:any=await r.json();assert(r.ok,JSON.stringify(d));return d;}
const results:any[]=[];
const options={qwen:{model:config.qwenModel,effort:'none'},harness:{model:'deepseek-flash',effort:'off'},codex:{model:'gpt-6.1-sol',effort:'low'}};
for(const mode of (process.env.LA_TEST_MODES?.split(',')||['react','plan','reflection','team']).filter(Boolean)){
 const task=await api('/tasks','POST',{engine:mode==='team'?'auto':'qwen',options,workflow:{mode,maxSteps:20,maxRevisions:1},prompt:mode==='team'?'验收角色协作。规划必须恰好两步：researcher 使用 Qwen 计算 7*8 并提交 summary；builder 使用 Harness 把依赖结果 56 写入 answer.txt。然后主控读取核对 answer.txt 内容为 56，交付该文件。不要运行命令或联网。':'创建 answer.txt，内容精确为 56，再读取确认并交付。只用 write_file 和 read_file。若是规划求解，只规划一个 solver 步骤。'});
 console.log('开始',mode,task.id);
 const deadline=Date.now()+1200000;
 for(;;){const d=await api('/tasks/'+task.id);if(['succeeded','failed','cancelled'].includes(d.task.status)){
   results.push({mode,id:task.id,status:d.task.status,error:d.task.error,stages:d.events.filter((e:any)=>e.type==='stage_done').length,engines:[...new Set(d.events.filter((e:any)=>e.type==='engine_done').map((e:any)=>e.engine))]});
   await mkdir('acceptance',{recursive:true});await writeFile('acceptance/mechanisms.json',JSON.stringify(results,null,2));
   assert.equal(d.task.status,'succeeded',mode+': '+d.task.error);assert(d.events.some((e:any)=>e.type==='workflow_done'));console.log('通过',mode,results.at(-1));break;
 }if(Date.now()>deadline){await api('/tasks/'+task.id+'/cancel','POST',{});throw new Error('验收超时 '+mode);}await new Promise(r=>setTimeout(r,2000));}
}
const examples=await api('/evaluations/examples');
for(const kind of ['gaia','bfcl']){const run=await api('/evaluations','POST',{kind,engine:'qwen',options,workflow:{mode:'react',maxSteps:8},source:'自编验收题（非官方题库）',cases:examples[kind]});const deadline=Date.now()+180000;for(;;){const runs=await api('/evaluations'),r=runs.find((v:any)=>v.id===run.id);if(r.accuracy!==null){assert.equal(r.accuracy,1,JSON.stringify(r));console.log('评估通过',kind);await writeFile('acceptance/eval-'+kind+'.json',JSON.stringify(r,null,2));break;}if(Date.now()>deadline){await api('/evaluations/'+run.id,'DELETE');throw new Error('评估超时');}await new Promise(r=>setTimeout(r,2000));}}
