// Codex 的独立 stdio MCP 子进程。stdout 只写协议，令牌仅从环境继承。
let buffer='';
async function api(route:string,body:any){const r=await fetch(`http://127.0.0.1:${process.env.LA_PORT}/internal/${route}`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.LA_WORKER_TOKEN},body:JSON.stringify({...body,taskId:process.env.LA_TASK_ID,stageId:process.env.LA_STAGE_ID||'',delegation:process.env.LA_DELEGATION==='1'})});const data=await r.json();if(!r.ok)throw new Error((data as any).error || '工具请求失败');return data;}
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);void handle(line);}});
async function handle(line:string){let m:any;try{m=JSON.parse(line);}catch{return;}if(m.id===undefined)return;
  try{let result:any;
    if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'local-agent-workbench',version:'0.4.0'}};
    else if(m.method==='tools/list'){const specs:any=await api('tools',{});result={tools:specs.map((s:any)=>({name:s.name,description:s.description,inputSchema:s.parameters,annotations:{readOnlyHint:['read_file','list_files','search_files','tools_search','skill_read','memory_search','knowledge_search','desktop_search','fetch_url'].includes(s.name),destructiveHint:false,idempotentHint:!['run_command','desktop_call'].includes(s.name),openWorldHint:s.name==='fetch_url'}}))};}
    else if(m.method==='tools/call'){try{const data=await api('call',{name:m.params.name,args:m.params.arguments||{},engine:'codex'});result={content:[{type:'text',text:JSON.stringify(data)}]};}catch(e:any){result={isError:true,content:[{type:'text',text:e.message}]};}}
    else if(m.method==='ping')result={};else throw new Error('不支持 '+m.method);
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
  }catch(e:any){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:e.message}})+'\n');}
}
