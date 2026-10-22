import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, errorText } from './config.ts';
import type { Task, RunContext } from './config.ts';
import { Store } from './store.ts';
import { Tools, toolSpecs, safePath } from './tools.ts';
import { Engines } from './engines.ts';
import {Workflows,validateWorkflow} from './workflows.ts';
import {runBfcl} from './evaluation.ts';
import {taskRoute} from './routing.ts';

export class Agent extends EventEmitter {
  store:Store; tools:Tools; engines:Engines; active?: {id:string;controller:AbortController;ctx:RunContext};
  chats=new Map<string,AbortController>();
  approvals=new Map<string,{resolve:(answer:boolean)=>void;taskId:string}>();
  constructor(store:Store,token:string){
    super();this.store=store;this.tools=new Tools(store);this.engines=new Engines(token,toolSpecs);
    this.tools.delegate=(engine,prompt,ctx)=>this.engines.run(engine,prompt,ctx,true);
    this.tools.approval=(ctx,action,detail)=>this.approve(ctx,action,detail);
  }
  emitEvent(taskId:string,type:string,engine:string,data:any){const e=this.store.event(taskId,type,engine,data);this.emit('event',e);}
  async enqueue(task:Task){const o=JSON.parse(task.options||'{}'),turnId=o.turnId||task.id;if(!this.store.events(task.id).some(e=>e.type==='user_message'&&e.data.turnId===turnId))this.emitEvent(task.id,'user_message','user',{text:o.currentPrompt||task.prompt,turnId});this.emitEvent(task.id,'status','system',{status:'queued',intent:o.intent,engine:task.engine});if(taskRoute(task).kind==='chat')void this.runChat(task);else void this.pump();}
  async runChat(task:Task){
    if(this.chats.has(task.id))return;const controller=new AbortController();this.chats.set(task.id,controller);const route=taskRoute(task),start=performance.now();
    const options=JSON.parse(task.options||'{}');let pending='',first=true,flushTimer:ReturnType<typeof setTimeout>|undefined;
    const flush=()=>{if(flushTimer)clearTimeout(flushTimer);flushTimer=undefined;if(pending){this.emitEvent(task.id,'chat_delta',route.engine,{text:pending});pending='';}};
    const ctx:RunContext={task,chat:true,specs:[],signal:controller.signal,emit:(type,e,data)=>{if(type!=='chat_delta'){this.emitEvent(task.id,type,e,data);return;}if(first){first=false;this.emitEvent(task.id,type,e,data);}else{pending+=data.text;if(!flushTimer)flushTimer=setTimeout(flush,24);}},tool:async()=>{throw new Error('快捷对话不允许工具执行');}};
    const timer=setTimeout(()=>controller.abort(new Error('快捷对话超时，请检查模型连接或关闭思考')),90000);
    try{this.store.update(task.id,{status:'running',error:'',result:''});ctx.emit('status','system',{status:'running',result:''});ctx.emit('routing','system',route);const result=await this.engines.chat(route.engine,options.currentPrompt||task.prompt,ctx);controller.signal.throwIfAborted();flush();ctx.emit('final',route.engine,{text:result,turnId:options.turnId||task.id});ctx.emit('latency','system',{totalMs:Math.round(performance.now()-start)});this.store.update(task.id,{status:'succeeded',result});ctx.emit('status','system',{status:'succeeded',result});}
    catch(e){const status=controller.signal.aborted?'cancelled':'failed',error=errorText(controller.signal.aborted?controller.signal.reason:e);this.store.update(task.id,{status,error});ctx.emit('status','system',{status,error});}
    finally{flush();clearTimeout(timer);this.chats.delete(task.id);}
  }
  async pump(){
    if(this.active)return;
    const task=this.store.list().reverse().find(t=>t.status==='queued'&&!t.archived&&taskRoute(t).kind!=='chat');if(!task)return;
    const controller=new AbortController();
    const ctx:RunContext={task,signal:controller.signal,emit:(type,engine,data)=>this.emitEvent(task.id,type,engine,data),tool:(name,args,engine)=>this.tools.call(ctx,name,args,engine)};
    this.active={id:task.id,controller,ctx};
    const timeout=setTimeout(()=>controller.abort(new Error('已达到任务时限')),this.store.setting('timeoutMinutes',30)*60000);
    this.store.update(task.id,{status:'running',error:''});ctx.emit('status','system',{status:'running'});
    const startEvent=this.store.events(task.id).at(-1)?.id||0;
    try{
      await fs.mkdir(task.workspace,{recursive:true});
      const history=this.store.events(task.id).filter(e=>['engine_done','checkpoint','tool_done'].includes(e.type)).slice(-10).map(e=>({type:e.type,engine:e.engine,data:e.data}));
      const evaluation=JSON.parse(task.options||'{}').evaluation;
      const retrieved=evaluation?{hits:[],mode:'evaluation-isolated',warning:''}:await this.tools.retrieval.search(JSON.parse(task.options||'{}').currentPrompt||task.prompt,'all',task.id,controller.signal);
      const memory=retrieved.hits.map((m:any)=>`[${m.scope} / ${m.title||m.source}] ${m.text}`).join('\n');
      ctx.emit('retrieval','system',{mode:retrieved.mode,hits:retrieved.hits.length,warning:retrieved.warning});
      const options=JSON.parse(task.options||'{}');
      const prompt=`任务工作目录：${task.workspace}\n用户任务：${options.currentPrompt||task.prompt}\n${options.conversation?.length?'此前对话（仅作任务上下文）：\n'+JSON.stringify(options.conversation).slice(-18000):''}\n${memory?'用户明确保存的长期记忆：\n'+memory:''}\n${history.length?'这是继续执行。下面是历史检查点（不要重复已有副作用操作，先读取现有成果）：\n'+JSON.stringify(history).slice(-16000):''}\n自动模式可以按需调用 delegate；仅在用户需要文件时生成成果。完成时提交可直接展示给用户的最终回答，而不是执行计划。`;
      const capabilityHints=this.tools.skillHints(options.currentPrompt||task.prompt);
      const workflow=validateWorkflow(JSON.parse(task.options||'{}').workflow,task.engine);
      ctx.emit('workflow_start','system',workflow);
      const result=evaluation?.kind==='bfcl'?await this.engines.serialQwen(()=>runBfcl(ctx,evaluation),ctx):await new Workflows(this.engines,this.store,c=>{if(this.active)this.active.ctx=c;}).run(prompt+'\n'+capabilityHints,ctx,workflow);
      controller.signal.throwIfAborted();
      const currentEvents=this.store.events(task.id,startEvent);
      const rootEngine=evaluation?.kind==='bfcl'?'qwen':workflow.mode==='balanced'?'system':task.engine==='auto'?'codex':task.engine;
      const completion=currentEvents.filter(e=>e.type==='completion'&&e.engine===rootEngine).at(-1);
      if(!completion){this.store.update(task.id,{result});throw new Error('执行器已结束，但未通过 finish_task 提交可验证的完成声明。请检查回答后继续。');}
      if(completion.data.outcome!=='completed'){this.store.update(task.id,{result});throw new Error(completion.data.summary||'执行器报告任务尚未完成');}
      const artifacts=currentEvents.filter(e=>e.type==='artifact');
      const verified:any[]=[];
      for(const e of artifacts){try{const p=await safePath(task.workspace,e.data.path),s=await fs.stat(p);verified.push({path:e.data.path,exists:s.isFile(),bytes:s.size});}catch{verified.push({path:e.data.path,exists:false});}}
      ctx.emit('verification','system',{files:verified,note:'检查已登记文件是否存在；内容正确性与任务相关测试以执行记录为准。'});
      if(verified.some(x=>!x.exists))throw new Error('部分登记成果不存在，请检查执行记录');
      if(evaluation?.kind==='gaia'){const answer=await fs.readFile(await safePath(task.workspace,'answer.txt'),'utf8');await fs.writeFile(path.join(task.workspace,'prediction.json'),JSON.stringify(answer.trim()));ctx.emit('artifact','system',{path:'prediction.json'});}
      const answer=String(completion.data.summary||result||'任务已完成。');
      await fs.writeFile(path.join(task.workspace,'agent-result.md'),answer,'utf8');
      ctx.emit('artifact','system',{path:'agent-result.md'});
      ctx.emit('final',rootEngine,{text:answer,files:completion.data.files,turnId:options.turnId||task.id});
      this.store.update(task.id,{status:'succeeded',result:answer});ctx.emit('status','system',{status:'succeeded',result:answer});
    }catch(e){const status=controller.signal.aborted?'cancelled':'failed';const message=controller.signal.aborted?errorText(controller.signal.reason):errorText(e);this.store.update(task.id,{status,error:message});ctx.emit('status','system',{status,error:message});}
    finally{clearTimeout(timeout);for(const [id,a] of this.approvals)if(a.taskId===task.id){a.resolve(false);this.approvals.delete(id);}this.active=undefined;void this.pump();}
  }
  cancel(id:string){const task=this.store.get(id);if(!task)throw new Error('任务不存在');
    if(this.chats.has(id)){this.chats.get(id)!.abort(new Error('用户停止了对话'));}
    else if(this.active?.id===id){this.store.update(id,{status:'cancelling'});this.emitEvent(id,'status','system',{status:'cancelling'});this.active.controller.abort(new Error('用户停止了任务'));}
    else if(task.status==='queued'){this.store.update(id,{status:'cancelled'});this.emitEvent(id,'status','system',{status:'cancelled'});}
  }
  async approve(ctx:RunContext,action:string,detail:any):Promise<boolean>{
    ctx.signal.throwIfAborted();const id=randomUUID();
    this.store.db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?,?)').run(id,ctx.task.id,action,JSON.stringify(detail),'pending',new Date().toISOString());
    this.store.update(ctx.task.id,{status:'waiting'});ctx.emit('approval','system',{id,action,detail});ctx.emit('status','system',{status:'waiting'});
    return new Promise<boolean>(resolve=>{
      const abort=()=>finish(false);
      const finish=(approved:boolean)=>{ctx.signal.removeEventListener('abort',abort);this.approvals.delete(id);this.store.db.prepare('UPDATE approvals SET status=? WHERE id=?').run(approved?'approved':'declined',id);if(!ctx.signal.aborted){this.store.update(ctx.task.id,{status:'running'});ctx.emit('status','system',{status:'running'});}ctx.emit('approval_resolved','system',{id,approved});resolve(approved);};
      this.approvals.set(id,{resolve:finish,taskId:ctx.task.id});ctx.signal.addEventListener('abort',abort,{once:true});if(ctx.signal.aborted)finish(false);
    });
  }
  resolveApproval(id:string,approved:boolean){const a=this.approvals.get(id);if(!a)throw new Error('该审批已失效');a.resolve(approved);}
}
