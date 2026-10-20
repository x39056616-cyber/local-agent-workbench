// 使用本机桌面版的工具注册接口，不复制凭据或运行外部安装脚本。
const { defineTool } = await import(process.env.LA_DSH_TOOLS_URL);
export const name = 'workbench-bridge';
export const inject = ['tools'];
export function apply(ctx) {
  const specs=JSON.parse(process.env.LA_TOOLS_SPEC || '[]');
  const convert=s=>{const {required,minimum,maximum,minItems,maxItems,...out}=s;if(out.properties)out.properties=Object.fromEntries(Object.entries(out.properties).map(([k,v])=>[k,{...convert(v),...(Array.isArray(required)&&required.includes(k)?{required:true}:{})}]));if(out.items)out.items=convert(out.items);return out;};
  const names=new Set(specs.map(s=>s.name));
  ctx.effect(()=>ctx.tools.guard(call=>names.has(call.name)?undefined:'此运行实例只允许工作台注册的工具。'));
  for(const s of specs){
    const parameters=Object.fromEntries(Object.entries(s.parameters.properties).map(([k,v])=>[k,{...convert(v),...((s.parameters.required||[]).includes(k)?{required:true}:{})}]));
    ctx.effect(()=>{try{return ctx.tools.register(defineTool({name:s.name,description:s.description,parameters,output:{schema:{type:'string'},render:(_a,value)=>[{type:'text',text:value}]},async execute(args,exec){
      const r=await fetch(`http://127.0.0.1:${process.env.LA_PORT}/internal/call`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.LA_WORKER_TOKEN},body:JSON.stringify({taskId:process.env.LA_TASK_ID,name:s.name,args,engine:'harness'}),signal:exec.signal});
      const result=await r.json();if(!r.ok)throw new Error(result.error||'工具执行失败');return JSON.stringify(result);
    }}));}catch(e){process.stderr.write('WORKBENCH_REGISTER_ERROR '+s.name+' '+e.message+'\n');throw e;}});
  }
  process.stderr.write('WORKBENCH_BRIDGE_READY\n');
}
