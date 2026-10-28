import {cooperationBlueprint,assignCooperation} from './cooperation.ts';
import {preference} from './model-policy.ts';
import type {Candidate} from './model-policy.ts';
import type {RunContext} from './config.ts';
import type {ModelRouter} from './model-router.ts';
import type {Store} from './store.ts';
import type {Workflow} from './workflows.ts';
import {safeToHandoff} from './supervisor.ts';

export async function automaticCooperation(ctx:RunContext,w:Workflow,router:ModelRouter,store:Store):Promise<Workflow|null>{
 ctx.signal.throwIfAborted();const o=JSON.parse(ctx.task.options||'{}');if(ctx.task.engine!=='auto'||w.mode!=='adaptive'||o.evaluation)return null;
 const events=store.events(ctx.task.id),last=events.findLastIndex(e=>e.type==='user_message'),current=events.slice(Math.max(0,last));
 const saved=current.findLast(e=>e.type==='cooperation_route');
 if(saved){ctx.emit('cooperation_route_reused','system',{reason:'沿用本轮分工与检查点，不重新分配或重放操作'});return saved.data.workflow;}
 const blueprint=cooperationBlueprint(o.currentPrompt||ctx.task.prompt);if(!blueprint)return null;
 // 旧轮仅做过已确认的读取/计划时可迁移；有写入或未知原生动作则保留恢复边界。
 if(current.some(e=>e.type==='engine_start')){
  const harmless=new Set(['tools_search','skill_read','list_files','read_file','search_files','plan_update','document_status','document_search','document_read','crawl_status','crawl_read','fetch_url','web_read','web_search','tool_result_read']);
  if(!safeToHandoff(current)||current.some(e=>e.type==='tool_start'&&!harmless.has(e.data.name))||current.some(e=>e.type==='completion')){ctx.emit('message','system',{text:'本轮已有写入或尚未确认的旧执行记录，继续时保留原路径以免重放；新一轮要求将使用自动分工。'});return null;}
  ctx.emit('cooperation_migration','system',{reason:'旧轮仅有已确认的读取与计划，安全切换为分阶段执行，不重放写入或外部操作'});
 }
 const policy=preference(o.routingPreference??store.setting('routingPreference','balanced'));
 const candidates:Candidate[][]=[];for(const duty of blueprint.duties){candidates.push(await router.candidates(ctx.task,duty.category));ctx.signal.throwIfAborted();}
 // 每阶段使用各自类别的记录，不把资料获取的一次故障套给字段提取或写作。
 const byCategory=Object.fromEntries(blueprint.duties.map((d,i)=>[d.category,candidates[i]]));
 const {roles,choices}=assignCooperation(blueprint,policy,byCategory);
 const workflow:Workflow={...w,mode:'balanced',roles:roles.filter(r=>r.id!=='extractor'),automatic:{...blueprint,extractor:roles.find(r=>r.id==='extractor')}};
 ctx.emit('cooperation_route','system',{reason:blueprint.reason,choices,workflow,basis:'启发式阶段拆分 + 按类别的本机记录；相对成本为偏好值，不是实时API报价'});
 return workflow;
}
