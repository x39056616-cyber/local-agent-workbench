import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {config} from './config.ts';
import type {Task,RunContext} from './config.ts';
import type {Store} from './store.ts';
import {DeepSeekProvider} from './providers.ts';
import {categories,classifyTask,modelNames,preference,rankModels,chooseModel} from './model-policy.ts';
import type {ModelEngine,Candidate,Category} from './model-policy.ts';
import {recoveryDiagnosis} from './supervisor.ts';

export class ModelRouter {
 store:Store;availability?:{at:number;items:Record<string,{available:boolean;reason:string}>};
 constructor(store:Store){this.store=store;store.db.exec(`CREATE TABLE IF NOT EXISTS routing_samples(
  id TEXT PRIMARY KEY,taskId TEXT NOT NULL,turnId TEXT NOT NULL,engine TEXT NOT NULL,category TEXT NOT NULL,profile TEXT NOT NULL,
  status TEXT NOT NULL,durationMs INTEGER NOT NULL DEFAULT 0,rating INTEGER,created TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS routing_profile ON routing_samples(category,engine,profile,created);`);}
 profile(task:Task,engine:ModelEngine){
  const o=JSON.parse(task.options||'{}'),p=o[engine]||{},d=new DeepSeekProvider().read();
  // 未显式指定 Codex 模型时，以其默认配置文件版本分桶；不会读取或记录凭据。
  let defaults='default';if(engine==='codex')try{const file=path.join(process.env.USERPROFILE||'', '.codex','config.toml');defaults=createHash('sha256').update(readFileSync(file)).digest('hex').slice(0,16);}catch{}
  return JSON.stringify({model:p.model||(engine==='qwen'?config.qwenModel:engine==='harness'?(d.mode==='api'?d.model:'deepseek-flash'):defaults),effort:p.effort||'inherit',source:engine==='harness'?d.mode:engine,...(engine==='harness'&&d.mode==='api'?{endpoint:createHash('sha256').update(d.baseUrl).digest('hex').slice(0,16)}:{})});
 }
 async candidates(task:Task,stageCategory?:Category):Promise<Candidate[]>{
  if(!this.availability||Date.now()-this.availability.at>10000){
   const provider=new DeepSeekProvider().status();let qwen=false;
   try{const r=await fetch(config.qwenBase+'/models',{signal:AbortSignal.timeout(700)});if(r.ok){const data=await r.json() as any;qwen=data.data?.some((m:any)=>m.id===config.qwenModel)===true;}}catch{}
   this.availability={at:Date.now(),items:{qwen:{available:qwen,reason:qwen?'':'本地 API 未就绪或未列出指定模型'},harness:{available:provider.mode==='api'?provider.hasKey:existsSync(config.harnessExe),reason:'DeepSeek 接入缺少密钥或桌面程序'},codex:{available:existsSync(config.codex)||config.codex==='codex',reason:'未找到 Codex 程序'}}};
  }
  const category=stageCategory||classifyTask(JSON.parse(task.options||'{}').currentPrompt||task.prompt);
  return (['qwen','harness','codex'] as ModelEngine[]).map(engine=>{const p=this.profile(task,engine),state=this.availability!.items[engine];return {engine,profile:p,available:state.available,unavailableReason:state.available?'':state.reason,observations:this.store.db.prepare('SELECT status,durationMs,rating FROM routing_samples WHERE category=? AND engine=? AND profile=? ORDER BY created DESC,rowid DESC LIMIT 40').all(category,engine,p) as any[]};});
 }
 async select(ctx:RunContext,exclude:string[]=[],purpose:'recovery'|'subtask'='recovery'){
  ctx.signal.throwIfAborted();const o=JSON.parse(ctx.task.options||'{}'),turnId=o.turnId||ctx.task.id;
  const events=this.store.events(ctx.task.id),last=events.findLastIndex(e=>e.type==='user_message'),current=events.slice(Math.max(0,last));
  // 同轮继续使用原决定，不因新增反馈重新选择并重放操作；明确的新用户消息才重选。
  const saved=!exclude.length&&current.findLast(e=>e.type==='model_route'&&e.data.turnId===turnId);
  if(saved){ctx.emit('model_route_reused','system',{decisionId:saved.data.id,engine:saved.data.engine,reason:'沿用本轮已保存的选模决定'});return saved.data;}
  const category=classifyTask(o.currentPrompt||ctx.task.prompt),policy=preference(o.routingPreference??this.store.setting('routingPreference','balanced'));
  const candidates=rankModels(category,policy,await this.candidates(ctx.task));ctx.signal.throwIfAborted();
  const chosen=ctx.task.engine!=='auto'?candidates.find(c=>c.engine===ctx.task.engine):chooseModel(candidates.filter(c=>c.available&&!exclude.includes(c.engine)),policy);
  if(!chosen)throw new Error('没有可用的执行模型，请检查模型连接；已有操作不会重放');
  const informed=chosen.ratings>0;
  const ideal=[...candidates].sort((a,b)=>b.score-a.score)[0];
  const basis=exclude.length?(purpose==='subtask'?'按子任务的独立性和单并发约束排除不合适的模型，再比较质量与相对成本':'此前执行未完成，按剩余候选的适配度接续'):ideal.engine!==chosen.engine&&!ideal.available?`${modelNames[ideal.engine]} 当前不可用，改选可用候选中更合适的模型`:chosen.engine==='codex'?'预期质量收益足以抵消更高的相对成本':chosen.engine==='harness'?'质量满足常规任务要求，优先节省 Codex 额度':'适合本地直接处理，节省云端额度';
  const reason=ctx.task.engine!=='auto'?'遵循你指定的执行器，不自动换模型':`${categories[category]}：${basis}。${informed?'已参考同类任务的 '+chosen.ratings+' 次用户评价':'当前依据初始偏好，尚无同类用户评价'}。`;
  const decision={id:randomUUID(),turnId,engine:chosen.engine,category,preference:policy,profile:chosen.profile,reason,candidates,automatic:ctx.task.engine==='auto',feedbackEligible:ctx.chat===true||['adaptive','native'].includes(o.workflow?.mode||'adaptive'),basis:'偏好先验 + 同类别、同模型配置的本机记录；相对成本不是 API 报价'};
  ctx.emit('model_route','system',decision);return decision;
 }
 record(ctx:RunContext,decision:any,status:string,durationMs:number,error?:unknown){
  if(JSON.parse(ctx.task.options||'{}').evaluation)return;
  // 取消、拒绝审批、来源权限等不记成模型质量/可靠性失败。
  if(status!=='completed'&&(ctx.signal.aborted||recoveryDiagnosis(error).category!=='engine-or-protocol'))return;
  this.store.db.prepare('INSERT INTO routing_samples(id,taskId,turnId,engine,category,profile,status,durationMs,created) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,durationMs=excluded.durationMs').run(decision.id,ctx.task.id,decision.turnId,decision.engine,decision.category,decision.profile,status==='completed'?'completed':'engine_error',Math.round(durationMs),new Date().toISOString());
 }
 recordCooperation(ctx:RunContext){
  const events=this.store.events(ctx.task.id),last=events.findLastIndex(e=>e.type==='user_message'),current=events.slice(Math.max(0,last)),plan=current.find(e=>e.type==='cooperation_route')?.data;
  if(!plan||JSON.parse(ctx.task.options||'{}').evaluation)return;
  const turnId=JSON.parse(ctx.task.options||'{}').turnId||ctx.task.id;
  for(const event of current.filter(e=>['stage_done','subagent_done'].includes(e.type))){
   const duty=event.data.id==='balanced.plan'?'researcher':event.data.id==='balanced.extract'?'extractor':event.data.id?.startsWith('balanced.execute.')?'builder':event.data.id?.startsWith('balanced.review.')?'reviewer':'';
   const choice=plan.choices.find((c:any)=>c.id===duty),start=current.find(e=>['stage_start','subagent_start'].includes(e.type)&&e.data.key===event.data.key);
   if(!choice||!start)continue;
   const id=createHash('sha256').update(JSON.stringify([ctx.task.id,turnId,event.data.key,event.engine])).digest('hex');
   // 阶段完成只记录运行与耗时，不当作用户质量好评；无最终交付的阶段不能独立获评。
   this.store.db.prepare('INSERT OR IGNORE INTO routing_samples(id,taskId,turnId,engine,category,profile,status,durationMs,created) VALUES(?,?,?,?,?,?,?,?,?)').run(id,ctx.task.id,turnId,event.engine,choice.category,this.profile(ctx.task,event.engine as ModelEngine),'completed',Math.max(0,Date.parse(event.created)-Date.parse(start.created)),event.created);
  }
 }
 feedback(taskId:string,id:string,rating:unknown){
  if(rating!==1&&rating!==-1)throw new Error('评价无效');
  const task=this.store.get(taskId);if(!task)throw new Error('任务不存在');
  const events=this.store.events(taskId),decision=events.find(e=>e.type==='model_route'&&e.data.id===id)?.data;
  const sample=this.store.db.prepare('SELECT * FROM routing_samples WHERE id=? AND taskId=?').get(id,taskId) as any;
  // 必须关联该轮真实最终交付，不给失败阶段或仅规划的模型记满意度。
  const final=decision&&events.find(e=>e.type==='final'&&e.data.turnId===decision.turnId&&e.engine===decision.engine);
  if(!sample||sample.status!=='completed'||!final||!decision.automatic)throw new Error('只有自动选模并实际交付的回答可以评价');
  this.store.db.prepare('UPDATE routing_samples SET rating=? WHERE id=?').run(rating,id);
  return {decisionId:id,rating};
 }
 feedbackFor(taskId:string){return this.store.db.prepare('SELECT id,rating FROM routing_samples WHERE taskId=? AND status=?').all(taskId,'completed');}
}
