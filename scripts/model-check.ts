import assert from 'node:assert/strict';
import {config} from '../src/config.ts';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:'+config.port,s=await fetch(base+'/api/session'),cookie=s.headers.get('set-cookie')!.split(';')[0];
async function api(route:string,method='GET',value?:any){const r=await fetch(base+'/api'+route,{method,headers:{cookie,'Content-Type':'application/json'},body:value?JSON.stringify(value):undefined});const d:any=await r.json();assert(r.ok,JSON.stringify(d));return d;}
const results:any[]=[];
for(const [engine,model,effort]of [['harness','deepseek-flash','off'],['qwen',config.qwenModel,'none'],['codex','gpt-6.1-sol','high']]){
 const task=await api('/tasks','POST',{engine,options:{[engine]:{model,effort}},prompt:`只做一个强度验收：调用 write_file 创建 strength-${engine}.txt，内容精确为 ${engine.toUpperCase()}_${effort.toUpperCase()}，然后调用 finish_task(outcome=completed,summary=强度验收完成,files=[strength-${engine}.txt])。无需运行命令或其他工具。`});
 const deadline=Date.now()+360000;
 for(;;){const d=await api('/tasks/'+task.id);if(['succeeded','failed','cancelled'].includes(d.task.status)){assert.equal(d.task.status,'succeeded',engine+': '+d.task.error);const event=d.events.find((e:any)=>e.type==='model_config'&&e.engine===engine);assert.equal(event.data.effort,effort);const f=await fetch(base+'/api/tasks/'+task.id+'/file?path=strength-'+engine+'.txt',{headers:{cookie}});assert.equal((await f.text()).trim(),engine.toUpperCase()+'_'+effort.toUpperCase());results.push({engine,taskId:task.id,status:d.task.status,configuration:event.data});console.log(engine,'强度执行通过');break;}if(Date.now()>deadline){await api('/tasks/'+task.id+'/cancel','POST',{});throw new Error(engine+' 验收超时');}await new Promise(r=>setTimeout(r,1500));}
}
await writeFile('acceptance/model-strength.json',JSON.stringify({passed:true,results,checkedAt:new Date().toISOString()},null,2));
