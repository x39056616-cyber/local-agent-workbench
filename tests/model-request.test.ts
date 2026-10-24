import test from 'node:test';
import assert from 'node:assert/strict';
import {readToolStream,modelRequest,retryDelay,ModelRequestError} from '../src/model-request.ts';
import {recoveryDiagnosis,safeToHandoff} from '../src/supervisor.ts';

const chunk=(delta:any,finish_reason:any=null)=>'data: '+JSON.stringify({choices:[{index:0,delta,finish_reason}]})+'\n\n';
function response(text:string){const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}),{headers:{'content-type':'text/event-stream'}});}
function fixture(){const events:any[]=[];const c=new AbortController();return {events,c,ctx:{signal:c.signal,emit:(type:string,engine:string,data:any)=>events.push({type,engine,data})} as any};}

test('流式 UTF-8、交错工具参数与推理计数，完整后才返回工具',async()=>{
 const progress:any[]=[];
 const r=await readToolStream(response(chunk({reasoning_content:'内部分析'})+chunk({content:'你好'})+chunk({tool_calls:[{index:0,id:'one',function:{name:'read_file',arguments:'{"pa'}},{index:1,id:'two',function:{name:'list_files',arguments:'{'} } ]})+chunk({tool_calls:[{index:1,function:{arguments:'}'}},{index:0,function:{arguments:'th":"中文.md"}'}}]},'tool_calls')+'data: [DONE]'),new AbortController().signal,(...x)=>progress.push(x),()=>{});
 assert.equal(r.content,'你好');assert.equal(r.tool_calls?.[0].function.arguments,'{"path":"中文.md"}');assert.equal(r.tool_calls?.[1].function.arguments,'{}');assert(!JSON.stringify(progress).includes('内部分析'));
});
test('截断、达到输出上限、坏参数、重复调用 ID 都不能执行',async()=>{
 for(const text of [chunk({content:'partial'}),chunk({},'length'),chunk({tool_calls:[{index:0,id:'x',function:{name:'write_file',arguments:'{'}}]},'tool_calls'),chunk({tool_calls:[0,1].map(index=>({index,id:'same',function:{name:'x',arguments:'{}'}}))},'tool_calls')])await assert.rejects(readToolStream(response(text),new AbortController().signal,()=>{},()=>{}),ModelRequestError);
});
test('429 遵守 retry-after，最多两次重试；401 不重试',async()=>{
 const {ctx,events}=fixture();let attempts=0;
 const m=await modelRequest(ctx,'qwen',{messages:[],tools:[]},async()=>++attempts<3?new Response('',{status:429,headers:{'retry-after':'0'}}):response(chunk({content:'ok'},'stop')));
 assert.equal(m.content,'ok');assert.equal(attempts,3);assert.equal(events.filter(e=>e.data.phase==='retrying').length,2);assert(events.some(e=>e.data.firstOutputMs!==undefined));
 attempts=0;await assert.rejects(modelRequest(ctx,'qwen',{messages:[]},async()=>{attempts++;return new Response('',{status:401});}),/401/);assert.equal(attempts,1);
 assert.equal(retryDelay(new Headers({'retry-after':'2'}),0),2000);
});
test('首段无响应超时、流中停滞与用户取消都终止读取且不重试',async()=>{
 for(const first of [false,true]){
  const {ctx}=fixture();let attempts=0,cancelled=false;
  await assert.rejects(modelRequest(ctx,'qwen',{messages:[]},async()=>{attempts++;return new Response(new ReadableStream({start(c){if(first)c.enqueue(new TextEncoder().encode(chunk({content:'x'})));},cancel(){cancelled=true;}}));},{firstMs:25,idleMs:25,totalMs:200}),/超时/);
  assert.equal(attempts,1);assert(cancelled);
 }
 const {ctx,c}=fixture();const pending=modelRequest(ctx,'qwen',{messages:[]},async()=>new Response(new ReadableStream()));setTimeout(()=>c.abort(new Error('用户停止')),10);await assert.rejects(pending,/用户停止/);
});
test('失败分类和采集接管保留权限及副作用边界',()=>{
 assert.equal(recoveryDiagnosis(new ModelRequestError('首段超时','timeout')).recoverable,true);
 for(const message of ['HTTP 402','HTTP 422','用户取消','审批拒绝'])assert.equal(recoveryDiagnosis(new Error(message)).recoverable,false);
 const start={type:'tool_start',data:{id:'1',name:'write_file'}};
 assert(!safeToHandoff([start,{type:'tool_error',data:{id:'1',error:'disk failure'}}]));
 assert(safeToHandoff([start,{type:'tool_done',data:{id:'1'}}]));
 const crawl=[{type:'tool_start',data:{id:'c',name:'crawl_start'}},{type:'tool_done',data:{id:'c',result:{jobId:'j'}}}];
 assert(!safeToHandoff(crawl));assert(safeToHandoff([...crawl,{type:'crawl_done',data:{jobId:'j',status:'completed'}}]));
 assert(!safeToHandoff([...crawl,{type:'crawl_done',data:{jobId:'other',status:'completed'}}]));
});
