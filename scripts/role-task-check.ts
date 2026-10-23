import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4331),session=await fetch(base+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0];
async function api(p:string,method='GET',body?:any){const r=await fetch(base+'/api'+p,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),d:any=await r.json();assert(r.ok,JSON.stringify(d));return d;}
const start=performance.now();let task:any,record:any;
try{
 task=process.env.LA_VERIFY_LAST?{id:JSON.parse(await readFile('acceptance/role-task-live.json','utf8')).taskId}:await api('/tasks','POST',{
  engine:'auto',intent:'task',workflow:{mode:'adaptive'},options:{qwen:{effort:'none'},harness:{effort:'off'}},
  prompt:'提取给定材料并交付结构化文件：张三负责开发和测试，李四负责设计，张三再次负责测试。请用 agent_task 的 writer 角色派发一个独立写作任务，完整提供上述材料，要求去重姓名与职责，生成 result.json，格式为 {"people":[{"name":"姓名","duties":["职责"]}]}，预期恰好两人、张三职责去重。用明确的 expected_output，不需要输入文件。拿到返回的实际 files 路径后，再用 agent_task 的 reviewer 角色读取此路径独立审查，提交 passed/summary/issues。审查通过才交付原 JSON 文件并直接用中文回答两人的职责。不要自己重写 JSON，不联网，不运行命令。'});
 console.log('验收任务',task.id);let d:any,last='',deadline=Date.now()+300000;
 for(;;){d=await api('/tasks/'+task.id);const p=d.task.status+':'+d.events.filter((e:any)=>e.type==='tool_start').length;if(p!==last){console.log(p);last=p;}if(['succeeded','failed','cancelled'].includes(d.task.status))break;if(Date.now()>deadline){await api('/tasks/'+task.id+'/cancel','POST',{});throw new Error('真实角色验收超过五分钟，已停止');}await new Promise(r=>setTimeout(r,1000));}
 assert.equal(d.task.status,'succeeded',d.task.error);
 const done=d.events.filter((e:any)=>e.type==='agent_task_done'),writer=done.find((e:any)=>e.data.result.role==='writer'),reviewer=done.find((e:any)=>e.data.result.role==='reviewer');
 assert(writer&&reviewer,'缺少真实写作者或审查者交接');assert.notEqual(writer.engine,reviewer.engine);assert.equal(reviewer.data.result.passed,true);
 const file=writer.data.result.files[0];assert(reviewer.data.result.inputs.some((f:any)=>f.path===file.path));
 const data=JSON.parse(await readFile(d.task.workspace+'/'+file.path,'utf8'));assert.equal(data.people.length,2);assert.deepEqual(data.people.find((p:any)=>p.name==='张三').duties.toSorted(),['开发','测试'].toSorted());assert.deepEqual(data.people.find((p:any)=>p.name==='李四').duties,['设计']);
 const engines=d.events.filter((e:any)=>e.type==='engine_start').map((e:any)=>e.engine);for(const e of ['qwen','harness','codex'])assert(engines.includes(e),'缺少真实执行引擎 '+e);
 assert(d.events.some((e:any)=>e.type==='artifact'&&e.data.path===file.path));assert(d.task.result.includes('张三')&&d.task.result.includes('李四'));
 record={taskId:task.id,passed:true,durationMs:Math.round(performance.now()-start),engines,writer:writer.engine,reviewer:reviewer.engine,files:writer.data.result.files,answer:d.task.result};console.log('真实三模型角色交接通过');
}catch(error){record={taskId:task?.id,passed:false,error:String(error)};process.exitCode=1;console.error(record.error);}
await mkdir('acceptance',{recursive:true});await writeFile('acceptance/role-task-live.json',JSON.stringify(record,null,2));
