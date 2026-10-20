// 本机专用验收：账号结果只写入本机任务目录与已忽略的 acceptance/。
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {config} from '../src/config.ts';
const base='http://127.0.0.1:'+config.port,response=await fetch(base+'/api/session'),cookie=response.headers.get('set-cookie')!.split(';')[0];
async function api(route:string,method='GET',body?:any){const r=await fetch(base+'/api'+route,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d:any=await r.json();assert(r.ok,JSON.stringify(d));return d;}
const t=await api('/tasks','POST',{engine:'qwen',options:{qwen:{effort:'none'}},prompt:'这是仅在本机执行的连接器工具验收。用 desktop_search 查 github.get_user_login，然后 desktop_call 调用这个只读工具取得当前登录名。用 write_file 把真实登录名写入 connector-check.txt，最后 finish_task(outcome=completed,summary=桌面连接器验收完成,files=[connector-check.txt])。不要运行命令或调用外部写入工具。'});
let passed=false;
try{const deadline=Date.now()+240000;while(Date.now()<deadline){const d=await api('/tasks/'+t.id);if(['succeeded','failed','cancelled'].includes(d.task.status)){assert.equal(d.task.status,'succeeded',d.task.error);const event=d.events.find((e:any)=>e.type==='tool_done'&&e.engine==='qwen'&&e.data.name==='desktop_call');assert(event?.data.result.data.login);passed=true;await writeFile('acceptance/connector-task.json',JSON.stringify({passed,taskId:t.id,engine:'qwen',tool:event.data.result.tool,structuredDataReturned:true,checkedAt:new Date().toISOString()},null,2));console.log('本机 Qwen 实际调用桌面 GitHub 连接器通过');break;}await new Promise(r=>setTimeout(r,1500));}assert(passed,'连接器任务超时');}finally{if(!passed)await api('/tasks/'+t.id+'/cancel','POST',{});}
