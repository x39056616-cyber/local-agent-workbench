import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4332),session=await fetch(base+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0];
async function api(p:string,method='GET',body?:any){const r=await fetch(base+'/api'+p,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),d:any=await r.json();assert(r.ok,d.error);return d;}
const task=await api('/tasks','POST',{prompt:'下载20份获奖作品。这次只做未完成结果的流程验收，不联网、不搜索、不下载，不生成文件；直接finish_task提交outcome=blocked，说明真实全文为0/20份，没有取得任何作品。',engine:'harness',intent:'task',workflow:{mode:'native'},options:{harness:{effort:'off'}}});
console.log('未完成目标验收',task.id);const start=Date.now();let d:any;
for(;;){d=await api('/tasks/'+task.id);if(['failed','succeeded','cancelled'].includes(d.task.status))break;if(Date.now()-start>60000){await api('/tasks/'+task.id+'/cancel','POST',{});throw Error('未完成验收超时');}await new Promise(r=>setTimeout(r,1000));}
assert.equal(d.task.status,'failed');assert(d.task.result.includes('0/20'));assert.equal(d.events.findLast((e:any)=>e.type==='final').data.outcome,'blocked');const p=d.events.findLast((e:any)=>e.type==='collection_progress').data;assert.equal(p.goal.target,20);assert.equal(p.fulltexts,0);
await writeFile('acceptance/document-blocked-live.json',JSON.stringify({passed:true,taskId:task.id,status:d.task.status,answer:d.task.result,progress:p},null,2));console.log('通过：0/20不冒充完成，缺口直接显示在对话');
