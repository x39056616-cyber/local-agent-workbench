import path from 'node:path';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {RunContext} from './config.ts';
import type {Store} from './store.ts';
import {safePath} from './tools.ts';
import {ModelRequestError} from './model-request.ts';

const readOnly=new Set(['read_file','list_files','search_files','tools_search','skill_read','memory_search','knowledge_search','fetch_url','web_search','web_read','desktop_search','desktop_read','crawl_status','crawl_read','tool_result_read','image_analyze']);
export const recoveryTools=new Set([...readOnly,'write_file','plan_update','finish_task']);
const names:Record<string,string>={qwen:'Qwen',harness:'DeepSeek',codex:'Codex'};

export function recoveryDiagnosis(error:unknown){
 const reason=error instanceof Error?error.message:String(error);
 if(error instanceof ModelRequestError){const recoverable=error.kind!=='configuration';return {category:'model-'+error.kind,recoverable,reason,advice:recoverable?'模型请求已停止，保留已完成的工具结果，按权限与预算判断能否接续。':'修正模型、密钥、余额或请求配置后再继续，不自动重试。'};}
 if(/HTTP\s*(400|401|402|403|404|405|422)\b|余额不足|模型不存在|model.*not found/i.test(reason))return {category:'configuration',recoverable:false,reason,advice:'检查模型名称、接入地址、余额或凭据，重复请求不能修复这类错误。'};
 if(/用户停止|取消|时限|任务超时/.test(reason))return {category:'stopped',recoverable:false,reason,advice:'已停止，不会自动重新启动任务。'};
 if(/拒绝|禁止|越界|权限|审批|401|403|密钥|认证|credential|unauthorized/i.test(reason))return {category:'permission',recoverable:false,reason,advice:'需要明确授权或修正连接配置；不会换模型绕过限制。'};
 if(/副作用|重复|不同方案|未确认/.test(reason))return {category:'uncertain-operation',recoverable:false,reason,advice:'先核对已执行操作及现有成果，不能自动重放结果不明的操作。'};
 if(/预算|上限|上下文/.test(reason))return {category:'budget',recoverable:true,reason,advice:'保留已有结果，接管者仍受原工具次数与任务时限约束。'};
 if(/HTTP|连接|退出|未返回|未提交|未使用工具|格式|JSON|超时|ECONN|fetch failed|协议|socket/i.test(reason))return {category:'engine-or-protocol',recoverable:true,reason,advice:'可在操作结果已确认的前提下，让其他模型从已有结果接续。'};
 return {category:'unknown',recoverable:false,reason,advice:'未识别的故障已保留记录和成果，不能保证自动修复应用代码。'};
}

export function safeToHandoff(events:any[]){
 if(events.some(e=>e.type==='native_tool'&&!['userMessage','reasoning'].includes(e.data.type)))return false;
 const starts=events.filter(e=>e.type==='tool_start');
 return starts.every(e=>{
  const end=events.find(end=>['tool_done','tool_error'].includes(end.type)&&end.data.id===e.data.id);
  if(end?.type==='tool_done'&&['crawl_start','crawl_resume','crawl_stop'].includes(e.data.name)){
   const jobId=end.data.result?.jobId;
   const state=events.findLast(v=>['crawl_start','crawl_done'].includes(v.type)&&v.data.jobId===jobId);
   return !!jobId&&state?.type==='crawl_done'&&['completed','partial','limited','paused','failed','interrupted'].includes(state.data.status);
  }
  if(!end||!recoveryTools.has(e.data.name))return false;
  // A failed write may have partially modified a file; an error is not proof of rollback.
  if(end.type==='tool_error'&&!readOnly.has(e.data.name))return false;
  if(end.type==='tool_error'&&/拒绝|禁止|权限|审批|越界/i.test(String(end.data.error)))return false;
  return true;
 });
}

export class Supervisor {
 private store:Store;private ctx:RunContext;
 constructor(store:Store,ctx:RunContext){this.store=store;this.ctx=ctx;}
 events(){const events=this.store.events(this.ctx.task.id),last=events.findLastIndex(e=>e.type==='user_message');return events.slice(last<0?0:last);}
 handoff(id:string,from:string,to:string,error:unknown,operations:any[]=[],readOnlyStage=false){
  const diagnosis=recoveryDiagnosis(error),events=this.events();
  if(this.ctx.signal.aborted||this.ctx.task.engine!=='auto'||JSON.parse(this.ctx.task.options||'{}').evaluation||!diagnosis.recoverable||from===to||!readOnlyStage&&!safeToHandoff(operations))return false;
  const prior=events.filter(e=>e.type==='auto_recovery');
  if(prior.length>=2||prior.some(e=>e.data.id===id))return false;
  const text=`${names[from]||from} 在${readOnlyStage?'只读研究或核验':'执行'}阶段遇到问题：${diagnosis.reason}。已交由 ${names[to]||to} 接管，先核对已有记录和成果，不重做已完成操作。`;
  this.ctx.emit('auto_recovery','system',{id,from,to,...diagnosis});
  this.ctx.emit('message','system',{text});return true;
 }
 async protectWrite(ctx:RunContext,args:any,engine:string,readPaths:Set<string>,backedUp:Set<string>){
  const target=await safePath(ctx.task.workspace,args.path);
  if(path.relative(ctx.task.workspace,target).split(path.sep)[0]==='.agent-recovery')throw new Error('接管者不能修改恢复备份');
  let existing;try{existing=await stat(target);}catch(error:any){if(error.code!=='ENOENT')throw error;}
  if(!existing)return;
  if(!readPaths.has(target))throw new Error('接管前必须先 read_file 核对待修改的已有文件');
  if(backedUp.has(target))return;
  if(!existing.isFile()||existing.size>2_000_000)throw new Error('接管只允许修订已读取的小型文本成果');
  const backup=await safePath(ctx.task.workspace,path.join('.agent-recovery',ctx.task.id,randomUUID()+'.bak'));
  await mkdir(path.dirname(backup),{recursive:true});await safePath(ctx.task.workspace,backup);
  await writeFile(backup,await readFile(target),{flag:'wx',signal:ctx.signal});
  backedUp.add(target);ctx.emit('recovery_backup',engine,{path:path.relative(ctx.task.workspace,target),backup:path.relative(ctx.task.workspace,backup)});
 }
}
