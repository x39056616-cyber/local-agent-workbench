import React,{useEffect,useState} from 'react';
const phases:Record<string,string>={queued:'等待本地模型空闲',preparing:'检查本地模型是否就绪',ready:'本地模型已就绪',requesting:'正在连接模型',waiting_output:'等待模型首次输出',reasoning:'模型正在计算',generating:'模型正在生成回复',tool_arguments:'模型正在生成工具参数',completed:'本轮模型输出已接收',retrying:'连接暂时失败，等待重试',failed:'本轮模型请求失败'};
const names:Record<string,string>={qwen:'Qwen',harness:'DeepSeek',codex:'Codex',system:'工作台'};
export function progressText(event:any){
 if(!event)return '等待任务开始';
 if(event.type==='model_progress')return phases[event.data.phase]||'模型正在处理';
 if(event.type==='tool_start')return '正在执行工具：'+event.data.name;
 if(event.type==='tool_done')return '工具已返回，模型将检查结果';
 if(event.type==='tool_error')return '工具执行失败，正在判断下一步';
 if(event.type==='auto_recovery')return '已交给 '+(names[event.data.to]||event.data.to)+' 接续';
 if(event.type==='approval')return '等待你的确认';
 return '执行器正在处理任务';
}
export function ExecutionProgress({task,events}:{task:any;events:any[]}){
 const active=['queued','running','waiting','cancelling'].includes(task.status),[,tick]=useState(0);
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>tick(n=>n+1),1000);return()=>clearInterval(timer);},[active]);
 const lastUser=events.findLastIndex(e=>e.type==='user_message'),current=events.slice(Math.max(0,lastUser));
 const event=current.findLast(e=>['model_progress','tool_start','tool_done','tool_error','engine_start','auto_recovery','approval'].includes(e.type));
 const metrics=current.filter(e=>e.type==='model_progress'&&e.data.phase==='completed');
 const diagnosis=current.findLast(e=>e.type==='failure_diagnosis');
 if(!active&&!metrics.length&&!diagnosis)return null;
 const age=event?Math.max(0,Math.floor((Date.now()-Date.parse(event.created))/1000)):0;
 return <section className="execution-progress" aria-label="运行状态">
  {active&&<p role="status">{task.status==='cancelling'?'正在停止任务':task.status==='waiting'?'等待你的确认':progressText(event)} <span>· {names[event?.engine]||'工作台'}</span>{age>0&&<small> · 距最近状态 {age} 秒</small>}</p>}
  {active&&event?.type==='model_progress'&&['requesting','waiting_output'].includes(event.data.phase)&&<small>此段可能包含服务端排队或输入处理；尚未收到生成内容。</small>}
  {metrics.length>0&&<details><summary>模型请求耗时 · {metrics.length} 轮</summary><ul>{metrics.map(e=><li key={e.id}>{names[e.engine]}：首次输出 {e.data.firstOutputMs===undefined?'未提供':(e.data.firstOutputMs/1000).toFixed(1)+' 秒'}，请求合计 {(e.data.elapsedMs/1000).toFixed(1)} 秒</li>)}</ul></details>}
  {!active&&task.status==='failed'&&diagnosis&&<p>{diagnosis.data.advice}</p>}
 </section>;
}
