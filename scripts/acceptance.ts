import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.ts';
const base=`http://127.0.0.1:${config.port}`;
const session=await fetch(base+'/api/session');const cookie=session.headers.get('set-cookie')!.split(';')[0];
async function api(route:string,method='GET',data?:any){const r=await fetch(base+'/api'+route,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const x:any=await r.json();if(!r.ok)throw new Error(x.error);return x;}
const cases:Record<string,{engine:string;prompt:string;file:string;expected:string}>={
  codex:{engine:'codex',prompt:'仅使用工作台 MCP 的 write_file 和 read_file：创建 codex-smoke.txt，完整内容为 CODEX_OK，然后读取确认。不要调用 shell，不委派。',file:'codex-smoke.txt',expected:'CODEX_OK'},
  qwen:{engine:'qwen',prompt:'使用 write_file 创建 qwen-smoke.txt，完整内容为 QWEN_OK；再使用 read_file 读取核对，然后汇报。',file:'qwen-smoke.txt',expected:'QWEN_OK'},
  harness:{engine:'harness',prompt:'使用 write_file 创建 harness-smoke.txt，完整内容为 HARNESS_OK；再使用 read_file 读取核对，然后汇报。',file:'harness-smoke.txt',expected:'HARNESS_OK'},
  team:{engine:'auto',prompt:'这是三引擎真实协作验收，必须依次执行：1.使用 delegate 调用 qwen，要求它从“产品A库存37，产品B库存12”提取数据，写入 inventory.json 并读取核对。2.使用 delegate 调用 harness，要求它读取 inventory.json，计算库存总数并写 team-total.txt，内容必须为 49。3.你自己使用 read_file 检查两个文件，确认总数49，再生成 team-report.md。不要只在回答中模拟委派，不运行 shell。',file:'team-total.txt',expected:'49'}
};
const key=process.argv[2]||'codex',test=cases[key];if(!test)throw new Error('指定 codex / qwen / harness / team');
const existing=process.argv[3];
const task=existing?(await api('/tasks/'+existing)).task:await api('/tasks','POST',{engine:test.engine,prompt:test.prompt});
if(existing&&!['running','queued','waiting'].includes(task.status))await api('/tasks/'+task.id+'/resume','POST',{});
console.log('任务：',key,task.id);
let detail:any,status='';const start=Date.now();
for(;;){detail=await api('/tasks/'+task.id);if(detail.task.status!==status){status=detail.task.status;console.log('状态：',status);}
  if(['succeeded','failed','cancelled','interrupted'].includes(status))break;
  if(status==='waiting'){
    // 仅批准此固定验收任务中明确要求的委派；其他审批保留给网页用户。
    for(const approval of detail.approvals||[]){const p=JSON.parse(approval.detail);if(p.serverName==='workbench'&&p._meta?.codex_approval_kind==='mcp_tool_call'&&['qwen','harness'].includes(p._meta?.tool_params?.engine)){await api('/approvals/'+approval.id,'POST',{approved:true});console.log('允许已授权的固定验收委派：'+p._meta.tool_params.engine);}}
  }
  if(Date.now()-start>600000){await api('/tasks/'+task.id+'/cancel','POST',{});throw new Error('验收超过10分钟，已请求停止');}
  await new Promise(r=>setTimeout(r,1500));
}
let artifact='',artifactOk=false;
if(status==='succeeded'){const r=await fetch(base+'/api/tasks/'+task.id+'/file?path='+encodeURIComponent(test.file),{headers:{Cookie:cookie}});artifact=await r.text();artifactOk=r.ok&&artifact.trim()===test.expected;}
const report={case:key,taskId:task.id,status,error:detail.task.error,artifact:test.file,artifactOk,elapsedMs:Date.now()-start,engines:[...new Set(detail.events.filter((e:any)=>e.type==='engine_start').map((e:any)=>e.engine))],toolCalls:detail.events.filter((e:any)=>e.type==='tool_start').map((e:any)=>({engine:e.engine,name:e.data.name})),checkedAt:new Date().toISOString()};
await mkdir(path.join(config.root,'acceptance'),{recursive:true});await writeFile(path.join(config.root,'acceptance',key+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(!artifactOk)process.exitCode=1;
if(key==='team'&&!['codex','qwen','harness'].every(e=>report.engines.includes(e)))process.exitCode=1;
