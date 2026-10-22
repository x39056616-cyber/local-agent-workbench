// 对隔离服务进行真实模型验收；不得指向含用户待执行任务的共享测试数据库。
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4329);
const session=await fetch(base+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0];
async function api(p:string,method='GET',body?:any){const r=await fetch(base+'/api'+p,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d:any=await r.json();assert(r.ok,JSON.stringify(d));return d;}
const results:any[]=[];await mkdir('acceptance',{recursive:true});
const cases=[
 {name:'本地提取',expected:'qwen',prompt:'提取以下文本中的姓名并去重分类：张三负责开发，李四负责设计，张三还负责测试。生成 names.md，列出两个姓名和各自职责。不要联网，不运行命令。'},
 {name:'常规联网研究',expected:'harness',prompt:'帮我在github找这一个月内最受欢迎有关ai的3个开源项目，并分别说明用途和为什么受欢迎。以 GitHub Trending 月榜为口径，实际读取月榜与项目主页，给可点击来源；不要生成文件，不运行命令。'},
 {name:'复杂工程',expected:'codex',prompt:'实现多文件并发竞态修复的最小示例：生成 queue.ts 与 cache.ts，给异步缓存的同键请求做 single-flight 去重，不同键保持并发；失败后应移除占位以允许重试。简要解释设计和边界，不运行命令，不联网。'}
];
for(const item of cases.filter(c=>!process.env.LA_TEST_CASE||c.expected===process.env.LA_TEST_CASE)){
 const start=performance.now();let task:any;
 try{
  task=await api('/tasks','POST',{engine:'auto',intent:'task',workflow:{mode:'native'},routingPreference:'balanced',options:{qwen:{effort:'none'},harness:{effort:'off'}},prompt:item.prompt});
  console.log('已提交',item.name,task.id);let data:any,previous='',until=Date.now()+360000;
  for(;;){data=await api('/tasks/'+task.id);const state=data.task.status+':'+data.events.filter((e:any)=>e.type==='tool_start').length;
   if(previous!==state){console.log(item.name,state);previous=state;}
   if(['succeeded','failed','cancelled'].includes(data.task.status))break;
   if(Date.now()>until){await api('/tasks/'+task.id+'/cancel','POST',{});throw new Error('真实验收超过 6 分钟');}
   await new Promise(r=>setTimeout(r,700));
  }
  const route=data.events.find((e:any)=>e.type==='model_route')?.data,called=[...new Set(data.events.filter((e:any)=>e.type==='engine_start').map((e:any)=>e.engine))];
  assert.equal(route.engine,item.expected,'选择的模型');assert.equal(data.task.status,'succeeded',data.task.error);assert(called.includes(item.expected));
  assert(data.events.some((e:any)=>e.type==='completion'&&e.engine===item.expected&&e.data.outcome==='completed'));
  assert(data.events.some((e:any)=>e.type==='tool_done'&&e.engine===item.expected));
  const feedback=await api('/tasks/'+task.id+'/routing-feedback','POST',{decisionId:route.id,rating:1});assert.equal(feedback.rating,1);
  results.push({name:item.name,taskId:task.id,status:'passed',expected:item.expected,called,durationMs:Math.round(performance.now()-start),reason:route.reason,models:data.events.filter((e:any)=>e.type==='model_config').map((e:any)=>({engine:e.engine,...e.data})),tools:data.events.filter((e:any)=>e.type==='tool_start').map((e:any)=>({engine:e.engine,name:e.data.name})),answer:data.task.result,feedback});
  console.log('通过',item.name,called.join(','),Math.round((performance.now()-start)/1000)+'s');
 }catch(error){results.push({name:item.name,taskId:task?.id,status:'failed',error:error instanceof Error?error.message:String(error)});console.error('失败',item.name,results.at(-1).error);process.exitCode=1;}
 await writeFile(process.env.LA_TEST_CASE?'acceptance/model-routing-live-retry.json':'acceptance/model-routing-live.json',JSON.stringify(results,null,2));
}
