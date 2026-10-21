import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:4323',session=await fetch(base+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0],s:any=await session.json();assert.equal(path.resolve(s.defaultWorkspace),path.resolve('acceptance/conversation-data/tasks'));
async function request(p:string,method='GET',body?:any,ok=true){const r=await fetch(base+'/api'+p,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),d:any=await r.json();assert.equal(r.ok,ok,JSON.stringify(d));return d;}
async function wait(id:string){for(let n=0;n<900;n++){const d=await request('/tasks/'+id);if(['succeeded','failed','cancelled'].includes(d.task.status))return d;await new Promise(r=>setTimeout(r,100));}throw new Error('任务超时');}
const t=await request('/tasks','POST',{engine:'qwen',prompt:'请记住此次测试代号是山海九二，只回答已记住。'});assert.equal((await wait(t.id)).task.status,'succeeded');
await request('/tasks/'+t.id+'/resume','POST',{engine:'harness',prompt:'刚才的代号是什么？只回答代号。',options:{harness:{model:'deepseek-flash',effort:'off'}}});const next=await wait(t.id);assert.equal(next.task.engine,'harness');assert(next.task.result.includes('山海九二'));assert.equal(next.events.filter((e:any)=>e.type==='final').length,2);
await request('/tasks/'+t.id+'/preview?path='+encodeURIComponent('../secret.txt'),'GET',undefined,false);
await request('/tasks','POST',{engine:'qwen',prompt:'读取附件',intent:'chat',files:[{name:'a.txt',base64:'YQ=='}]},false);
await request('/tasks/'+t.id+'/archive','POST',{archived:true});await request('/tasks/'+t.id+'/resume','POST',{prompt:'继续'},false);
const stop=await request('/tasks','POST',{engine:'qwen',prompt:'请写一篇三千字的中文故事，直接从正文开始，持续写到结尾。'});let partial=false;
for(let n=0;n<300;n++){const d=await request('/tasks/'+stop.id);if(d.events.some((e:any)=>e.type==='chat_delta')){partial=true;break;}if(d.task.status==='failed')throw new Error(d.task.error);await new Promise(r=>setTimeout(r,50));}assert(partial);await request('/tasks/'+stop.id+'/cancel','POST',{});const cancelled=await wait(stop.id);assert.equal(cancelled.task.status,'cancelled');assert(!cancelled.events.some((e:any)=>e.type==='final'));assert(cancelled.events.some((e:any)=>e.type==='chat_delta'));
await writeFile('acceptance/conversation-api.json',JSON.stringify({passed:true,switchEngineKeepsContext:true,archiveBlocksResume:true,previewTraversalRejected:true,chatAttachmentsRejected:true,streamingBeforeCompletion:true,cancelKeepsPartial:true},null,2));console.log('多轮切换模型、上下文、边界、流式和停止验收通过');
