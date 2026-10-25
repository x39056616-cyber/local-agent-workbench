import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4332),r=await fetch(base+'/api/session'),cookie=r.headers.get('set-cookie')!.split(';')[0];
async function api(route:string,method='GET',body?:any){const response=await fetch(base+'/api'+route,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),d:any=await response.json();assert(response.ok,d.error);return d;}
const prompt='下载2份公开文档：https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf 和 https://raw.githubusercontent.com/morungos/node-word-extractor/develop/__tests__/data/test02.docx 。请提取两份文档的正文并去重，交付原PDF、Word、提取文本和来源清单，最后在对话说明每份内容及实际完成数量。不要运行命令。';
let task:any;const started=performance.now();try{
 task=await api('/tasks','POST',{prompt,engine:'auto',intent:'auto',workflow:{mode:'native'},options:{harness:{effort:'off'},qwen:{effort:'none'}}});console.log('真实文档任务',task.id);let d:any,last='';
 for(;;){d=await api('/tasks/'+task.id);const state=d.task.status+':'+d.events.filter((e:any)=>e.type==='tool_start').length;if(last!==state){console.log(state);last=state;}if(['failed','succeeded','cancelled'].includes(d.task.status))break;if(performance.now()-started>240000){await api('/tasks/'+task.id+'/cancel','POST',{});throw new Error('文档验收超过时限，已停止');}await new Promise(r=>setTimeout(r,1000));}
 assert.equal(d.task.status,'succeeded',d.task.error);const progress=d.events.findLast((e:any)=>e.type==='collection_progress').data;assert.equal(progress.fulltexts,2);assert.equal(progress.remaining,0);
 const done=d.events.filter((e:any)=>e.type==='tool_done').map((e:any)=>e.data.name);for(const name of ['document_collect','document_read','material_record','finish_task'])assert(done.includes(name),name);
 await writeFile('acceptance/document-live.json',JSON.stringify({passed:true,taskId:task.id,durationMs:Math.round(performance.now()-started),progress,tools:done,answer:d.task.result},null,2));console.log('通过真实文档交付');
}catch(error){await writeFile('acceptance/document-live.json',JSON.stringify({passed:false,taskId:task?.id,error:String(error)},null,2));console.error(String(error));process.exitCode=1;}
