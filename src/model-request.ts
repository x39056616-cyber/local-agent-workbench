import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {RunContext} from './config.ts';

export class ModelRequestError extends Error {
 kind:'transient'|'timeout'|'protocol'|'configuration';status?:number;headers?:Headers;
 constructor(message:string,kind:ModelRequestError['kind'],status?:number,headers?:Headers){super(message);this.kind=kind;this.status=status;this.headers=headers;}
}
export function retryDelay(headers:Headers|undefined,attempt:number){
 const raw=headers?.get('retry-after'),ms=raw?(Number.isFinite(Number(raw))?Number(raw)*1000:Date.parse(raw)-Date.now()):NaN;
 return Number.isFinite(ms)&&ms>=0?Math.min(ms,60000):Math.min(1000*2**attempt+Math.floor(Math.random()*250),10000);
}

// Assemble complete calls before executing anything. A truncated stream never executes partial arguments.
export async function readToolStream(response:any,signal:AbortSignal,onProgress:(phase:string,chars:number)=>void,onUsage:(value:any)=>void){
 if(!response.body)throw new ModelRequestError('模型流式响应缺少正文','protocol');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,content='',reasoning='',finish='';
 const calls=new Map<number,any>();
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 const line=(raw:string)=>{
  if(!raw.startsWith('data:'))return;raw=raw.slice(5).trim();if(!raw||raw==='[DONE]')return;
  let d:any;try{d=JSON.parse(raw);}catch{throw new ModelRequestError('模型流式 JSON 无效','protocol');}
  if(d.error)throw new ModelRequestError('模型流式返回错误','protocol');
  if(d.usage)onUsage(d.usage);
  const c=d.choices?.find((x:any)=>x.index===0)??d.choices?.[0];if(!c)return;
  const v=c.delta||{};
  if(typeof v.reasoning_content==='string'&&v.reasoning_content){reasoning+=v.reasoning_content;onProgress('reasoning',reasoning.length);}
  if(typeof v.content==='string'&&v.content){content+=v.content;onProgress('generating',content.length);}
  for(const t of v.tool_calls||[]){
   if(!Number.isInteger(t.index)||t.index<0||t.index>63)throw new ModelRequestError('模型工具索引无效','protocol');
   const call=calls.get(t.index)||{id:'',type:'function',function:{name:'',arguments:''}};
   call.id+=t.id||'';call.function.name+=t.function?.name||'';call.function.arguments+=t.function?.arguments||'';calls.set(t.index,call);
   onProgress('tool_arguments',[...calls.values()].reduce((n,x)=>n+x.function.arguments.length,0));
  }
  if(c.finish_reason)finish=c.finish_reason;
 };
 try{
  for(;;){signal.throwIfAborted();const {value,done}=await reader.read();signal.throwIfAborted();if(done)break;
   bytes+=value.byteLength;if(bytes>2_000_000)throw new ModelRequestError('模型响应超过容量限制','protocol');
   buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){line(buffer.slice(0,end).trim());buffer=buffer.slice(end+1);}
  }
  buffer+=decoder.decode();if(buffer.trim())line(buffer.trim());
  if(!['stop','tool_calls'].includes(finish))throw new ModelRequestError(finish==='length'?'模型输出达到长度限制，尚未完成':'模型流式响应中断，未收到完成标记','protocol');
  const tool_calls=[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,v])=>v);
  for(const c of tool_calls){if(!c.id||!c.function.name)throw new ModelRequestError('模型工具调用不完整','protocol');try{JSON.parse(c.function.arguments);}catch{throw new ModelRequestError('模型工具参数 JSON 不完整','protocol');}}
  if(new Set(tool_calls.map(c=>c.id)).size!==tool_calls.length)throw new ModelRequestError('模型工具调用 ID 重复','protocol');
  return {role:'assistant',content:content||null,...(reasoning?{reasoning_content:reasoning}:{}),...(tool_calls.length?{tool_calls}:{})};
 }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

// Retry only the model request, never the tool loop. The same step keeps its completed tool results.
export async function modelRequest(ctx:RunContext,engine:string,body:any,send:(body:any,signal:AbortSignal)=>Promise<any>,limits={firstMs:180000,idleMs:60000,totalMs:300000}){
 const requestId=randomUUID(),started=performance.now();
 for(let attempt=0;attempt<3;attempt++){
  ctx.signal.throwIfAborted();const controller=new AbortController(),signal=AbortSignal.any([ctx.signal,controller.signal]);
  let phase='requesting',chars=0,firstMs:number|undefined,lastEmit=0,headers:Headers|undefined;
  const emit=(extra:any={})=>ctx.emit('model_progress',engine,{requestId,attempt:attempt+1,phase,elapsedMs:Math.round(performance.now()-started),chars,...extra});
  emit({inputChars:JSON.stringify(body.messages).length,toolCount:body.tools?.length||0});
  const timeout=(message:string)=>controller.abort(new ModelRequestError(message,'timeout'));
  let idle=setTimeout(()=>timeout('模型首段输出等待超时'),limits.firstMs);
  const total=setTimeout(()=>timeout('单次模型请求超时'),limits.totalMs);
  const heartbeat=setInterval(()=>emit({waiting:true}),5000);
  try{
   const response=await send({...body,stream:true,stream_options:{include_usage:true}},signal);headers=response.headers;
   if(!response.ok){await response.body?.cancel();throw new ModelRequestError('模型接口 HTTP '+response.status,[408,429,500,502,503,504].includes(response.status)?'transient':'configuration',response.status);}
   phase='waiting_output';emit();
   const message=await readToolStream(response,signal,(next,n)=>{
    clearTimeout(idle);idle=setTimeout(()=>timeout('模型流式输出停滞超时'),limits.idleMs);
    const now=performance.now(),changed=phase!==next;phase=next;chars=n;
    if(firstMs===undefined){firstMs=Math.round(now-started);emit({firstOutputMs:firstMs});lastEmit=now;}
    else if(changed||now-lastEmit>=1000){emit();lastEmit=now;}
   },usage=>ctx.emit('usage',engine,usage));
   phase='completed';emit({firstOutputMs:firstMs});return message;
  }catch(error:any){
   if(ctx.signal.aborted)throw ctx.signal.reason;
   const failure=controller.signal.aborted?controller.signal.reason:error;
   const transient=failure instanceof ModelRequestError?failure.kind==='transient':/fetch failed|ECONNRESET|ECONNREFUSED|socket|network/i.test(String(failure));
   if(!transient||attempt===2){phase='failed';emit({category:failure instanceof ModelRequestError?failure.kind:'network'});throw failure;}
   const delayMs=retryDelay(headers||failure?.headers,attempt);phase='retrying';emit({delayMs});
   clearTimeout(idle);clearTimeout(total);clearInterval(heartbeat);
   await delay(delayMs,undefined,{signal:ctx.signal});
  }finally{clearTimeout(idle);clearTimeout(total);clearInterval(heartbeat);}
 }
 throw new ModelRequestError('模型请求重试已耗尽','transient');
}
