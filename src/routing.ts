export function isGreeting(prompt:string){const p=prompt.replace(/[\s，。！？,.!?～~]/g,'');return /^(你好|您好|嗨|哈喽|hello|hi|hey|你是谁|你叫什么|你叫什么名字|介绍一下你自己|你能做什么|你可以做什么|谢谢|谢谢你|早上好|晚上好|在吗)$/i.test(p);}
export function taskRoute(task:{prompt:string;engine:string;options?:string}){
  const options=JSON.parse(task.options||'{}'),mode=options.workflow?.mode||'balanced';
  const chat=options.intent==='chat'||options.intent!=='task'&&isGreeting(task.prompt)&&!['react','plan','reflection','team'].includes(mode);
  if(chat)return {kind:'chat',engine:task.engine==='auto'?'qwen':task.engine,reason:'短对话使用无工具、无资料检索的轻量通道'};
  return {kind:'task',engine:task.engine==='auto'?'codex':task.engine,reason:mode==='balanced'?'工作台调度：Qwen 规划 → DeepSeek 执行 → Codex 核验':'按所选引擎和机制执行'};
}
