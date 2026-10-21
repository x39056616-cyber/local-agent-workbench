// 只把最终回答增量发往网页，推理内容保留在执行器内部。
export async function readChatStream(response:{body:any},onText:(text:string)=>void,onUsage:(usage:any)=>void,signal:AbortSignal){
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',text='';
  try{for(;;){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line.startsWith('data:'))continue;const raw=line.slice(5).trim();if(raw==='[DONE]')continue;let d:any;try{d=JSON.parse(raw);}catch{continue;}if(d.error)throw new Error('模型流式返回错误');if(d.usage)onUsage(d.usage);const token=d.choices?.[0]?.delta?.content;if(typeof token==='string'&&token){text+=token;onText(token);}}}return text;}finally{reader.releaseLock();}
}
