import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {config} from './config.ts';
import type {RunContext} from './config.ts';
import type {Store} from './store.ts';
import type {Agent} from './agent.ts';
import {safePath} from './tools.ts';

// GAIA 的数字、列表、文字归一化。局部验证成绩，不等同官方榜单提交。
export function gaiaMatch(prediction:string,answer:string):boolean {
  const numeric=(s:string,formatted=false)=>{const t=formatted?s.trim().replaceAll(',',''):s.trim();return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(t)&&Number.isFinite(Number(t))?Number(t):null;};
  const n=numeric(answer);if(n!==null)return numeric(prediction,true)===n;
  const normalize=(s:string,punctuation=true)=>s.toLowerCase().replace(/\s/g,'').replace(punctuation?/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g:/$^/g,'');
  if(/[,;]/.test(answer)){const a=answer.split(/[,;]/),p=prediction.split(/[,;]/);return a.length===p.length&&a.every((s,i)=>numeric(s)!==null?numeric(s)===numeric(p[i]):normalize(s,false)===normalize(p[i],false));}
  return normalize(prediction)===normalize(answer);
}
function canonical(v:any):string {return JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);}
export function callsMatch(actual:any[],expected:any[]):boolean {return canonical(actual)===canonical(expected);}
export type EvalCase={id:string;question:string;answer?:string;level?:string;functions?:any[];expectedCalls?:any[]};
export function importCases(kind:string,input:any):EvalCase[]{
  if(!['gaia','bfcl'].includes(kind)||!Array.isArray(input)||!input.length||input.length>20)throw new Error('请选择 GAIA 或 BFCL，每批导入 1–20 题');
  const ids=new Set<string>();return input.map((v,i)=>{
    const id=String(v.id??v.task_id??i+1);if(ids.has(id))throw new Error('题目 ID 重复');ids.add(id);
    if(kind==='gaia'){
      if(v.file_name)throw new Error('这批题含附件；当前导入仅支持纯文本题。请勿省略附件后评分。');
      const question=v.question??v.Question,answer=v.answer??v['Final answer'];
      if(typeof question!=='string'||!question.trim()||question.length>24000||typeof answer!=='string')throw new Error('GAIA 题目需要 Question 和 Final answer 字符串');
      return {id,question,answer,level:String(v.level??v.Level??'unknown')};
    }
    const question=v.question,functions=v.functions,expectedCalls=v.expectedCalls;
    if(typeof question!=='string'||!question.trim()||question.length>24000||!Array.isArray(functions)||!functions.length||functions.length>30||!Array.isArray(expectedCalls))throw new Error('BFCL 本地练习格式需要 question、functions、expectedCalls；官方原始多轮数据请用官方评测器');
    const names=new Set();for(const f of functions){if(!f||!/^\w{1,64}$/.test(f.name)||names.has(f.name)||f.parameters?.type!=='object')throw new Error('函数名称或参数 schema 无效');names.add(f.name);}
    for(const call of expectedCalls)if(!call||!names.has(call.name)||!call.arguments||typeof call.arguments!=='object')throw new Error('预期工具调用格式无效');
    return {id,question,functions,expectedCalls};
  });
}
export const evaluationExamples={
  gaia:[{id:'local-arithmetic',question:'一个仓库有 12 箱物品，每箱 8 件，发走 19 件后剩多少件？仅给出数字。',answer:'77',level:'local'}],
  bfcl:[{id:'local-weather',question:'查询杭州今天的天气。',functions:[{name:'get_weather',description:'查询某城市天气',parameters:{type:'object',properties:{city:{type:'string'}},required:['city'],additionalProperties:false}}],expectedCalls:[{name:'get_weather',arguments:{city:'杭州'}}]}]
};
export class Evaluation {
  store:Store; agent:Agent;
  constructor(store:Store,agent:Agent){this.store=store;this.agent=agent;store.db.exec('CREATE TABLE IF NOT EXISTS evaluations(id TEXT PRIMARY KEY,kind TEXT,created TEXT,metadata TEXT,cases TEXT);');}
  async create(input:any){
    const cases=importCases(input.kind,input.cases),id=randomUUID();
    if(input.kind==='bfcl'&&input.engine!=='qwen')throw new Error('BFCL 原生工具调用适配器当前只支持本地 Qwen；不会静默切换引擎');
    const metadata={implementation:'local-agent-workbench/0.3.0',source:String(input.source||'用户本地练习集').slice(0,300),datasetHash:createHash('sha256').update(JSON.stringify(cases)).digest('hex'),engine:input.engine,workflow:input.workflow,profiles:input.options,scorer:input.kind==='gaia'?'gaia-normalized-local-v1':'ordered-json-calls-local-v1',official:false};
    const records=[];
    for(const c of cases){
      const workspace=path.join(config.data,'evaluations',id,randomUUID());await mkdir(workspace,{recursive:true});
      const prompt=input.kind==='gaia'?`${c.question}\n最终答案只写入 answer.txt，不加解释或 Markdown。其它推导可另存文件；finish_task 必须包含 answer.txt。`:'BFCL 本地函数调用练习：'+c.question;
      const task=this.store.create(prompt,input.engine,workspace);
      this.store.update(task.id,{options:JSON.stringify({...input.options,workflow:input.workflow,evaluation:{id,kind:input.kind,...(input.kind==='bfcl'?{question:c.question,functions:c.functions}:{})}})});
      records.push({...c,taskId:task.id});
    }
    this.store.db.prepare('INSERT INTO evaluations VALUES(?,?,?,?,?)').run(id,input.kind,new Date().toISOString(),JSON.stringify(metadata),JSON.stringify(records));
    for(const c of records)await this.agent.enqueue(this.store.get(c.taskId)!);
    return {id};
  }
  async list(){const rows=this.store.db.prepare('SELECT * FROM evaluations ORDER BY created DESC LIMIT 30').all() as any[];return Promise.all(rows.map(async r=>{
    const cases=JSON.parse(r.cases),results=[];
    for(const c of cases){const task=this.store.get(c.taskId)!;let prediction:any=null,passed:boolean|null=null,error=task.error;
      if(task.status==='succeeded'){try{prediction=JSON.parse(await readFile(await safePath(task.workspace,'prediction.json'),'utf8'));if(r.kind==='gaia')passed=gaiaMatch(prediction,c.answer);else passed=callsMatch(prediction,c.expectedCalls);}catch(e:any){error=e.message;passed=false;}}
      else if(['failed','cancelled','interrupted'].includes(task.status))passed=false;
      const events=this.store.events(task.id),usage=events.filter(e=>e.type==='usage');
      results.push({id:c.id,level:c.level,taskId:c.taskId,status:task.status,passed,prediction,error,configurations:events.filter(e=>e.type==='model_config').map(e=>({engine:e.engine,...e.data})),stages:events.filter(e=>e.type==='stage_done').length,toolCalls:events.filter(e=>e.type==='tool_start').length,usage:usage.map(e=>({engine:e.engine,...e.data})),durationMs:events.some(e=>e.type==='status'&&e.data.status==='running')?Math.max(0,Date.parse(task.updated)-Date.parse(events.find(e=>e.type==='status'&&e.data.status==='running')!.created)):0,wallTimeMs:Date.parse(task.updated)-Date.parse(task.created)});
    }
    const scored=results.filter(x=>x.passed!==null),correct=results.filter(x=>x.passed===true).length;
    return {id:r.id,kind:r.kind,created:r.created,metadata:JSON.parse(r.metadata),total:cases.length,scored:scored.length,correct,accuracy:scored.length===cases.length?correct/cases.length:null,results};
  }));}
  cancel(id:string){const r=this.store.db.prepare('SELECT cases FROM evaluations WHERE id=?').get(id) as any;if(!r)throw new Error('评估不存在');for(const c of JSON.parse(r.cases)){const t=this.store.get(c.taskId);if(t&&['queued','running','waiting'].includes(t.status))this.agent.cancel(t.id);}}
}
export async function runBfcl(ctx:RunContext,ev:any):Promise<string>{
  const profile=JSON.parse(ctx.task.options||'{}').qwen||{};
  ctx.emit('model_config','qwen',{model:config.qwenModel,effort:profile.effort||'inherit',evaluation:'bfcl-single-turn',maxTokens:2048});
  const res=await fetch(config.qwenBase+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},signal:ctx.signal,body:JSON.stringify({model:config.qwenModel,messages:[{role:'user',content:ev.question}],tools:ev.functions.map((f:any)=>({type:'function',function:f})),tool_choice:'auto',max_tokens:2048,stream:false,...(profile.effort?{reasoning_effort:profile.effort==='none'?'none':'low'}:{})})});
  if(!res.ok)throw new Error('BFCL 模型请求 HTTP '+res.status);const data:any=await res.json(),m=data.choices?.[0]?.message;if(!m)throw new Error('模型无有效返回');
  const calls=(m.tool_calls||[]).map((c:any)=>({name:c.function.name,arguments:JSON.parse(c.function.arguments)}));
  ctx.emit('benchmark_prediction','qwen',{calls,message:{content:m.content,tool_calls:m.tool_calls},model:data.model});if(data.usage)ctx.emit('usage','qwen',data.usage);
  await writeFile(path.join(ctx.task.workspace,'prediction.json'),JSON.stringify(calls,null,2));
  await ctx.tool('finish_task',{outcome:'completed',summary:'已记录原生工具调用预测；未执行题目中的函数。',files:['prediction.json']},'qwen');return 'BFCL 本地工具调用预测已保存。';
}
