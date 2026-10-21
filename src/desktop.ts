import { config,codexHttpArgs } from './config.ts';
import type { RunContext } from './config.ts';
import { Rpc } from './rpc.ts';
export const codexTransportArgs=codexHttpArgs;

export function codexEnv(){const env={...process.env};for(const k of Object.keys(env))if(k==='LA_DEEPSEEK_API_KEY'||k.startsWith('CODEX_')&&!['CODEX_HOME','CODEX_API_KEY'].includes(k))delete env[k];return env;}
export class Desktop {
  snapshot:any={checkedAt:null,apps:[],servers:[],models:[],currentModel:'',currentEffort:'',error:''};
  pending?:Promise<any>; modelSnapshot:any; modelPending?:Promise<any>;
  async models(){if(this.modelSnapshot&&Date.now()-this.modelSnapshot.at<300000)return this.modelSnapshot;if(this.modelPending)return this.modelPending;this.modelPending=(async()=>{let rpc:Rpc|undefined;try{rpc=new Rpc(config.codex,['app-server',...codexTransportArgs,'-c','features.apps=false'],{cwd:config.root,env:codexEnv()});await rpc.request('initialize',{clientInfo:{name:'workbench_model_catalog',version:'0.4.0'}},10000);rpc.notify('initialized');const [models,current]=await Promise.all([rpc.request('model/list',{limit:100},10000),rpc.request('config/read',{includeLayers:false},10000)]);return this.modelSnapshot={at:Date.now(),models:(models.data||[]).map((m:any)=>({id:m.model,name:m.displayName,defaultEffort:m.defaultReasoningEffort,efforts:m.supportedReasoningEfforts.map((e:any)=>e.reasoningEffort),isDefault:m.isDefault})),currentModel:current.config?.model||'',currentEffort:current.config?.model_reasoning_effort||'',error:''};}catch(e:any){return {models:[],currentModel:'',currentEffort:'',error:e.message};}finally{await rpc?.close();}})().finally(()=>this.modelPending=undefined);return this.modelPending;}
  async connect(){const r=new Rpc(config.codex,['app-server',...codexTransportArgs,'-c','features.apps=true'],{cwd:config.root,env:codexEnv()});try{await r.request('initialize',{clientInfo:{name:'local_agent_desktop_bridge',version:'0.2.0'},capabilities:{experimentalApi:true}},20000);r.notify('initialized');return r;}catch(e){await r.close();throw e;}}
  async status(refresh=false){
    if(!refresh&&this.snapshot.checkedAt&&Date.now()-Date.parse(this.snapshot.checkedAt)<300000)return this.snapshot;
    if(this.pending)return this.pending;
    this.pending=this.inspect().finally(()=>{this.pending=undefined;});return this.pending;
  }
  async inspect(){let rpc:Rpc|undefined;try{rpc=await this.connect();const [apps,models,servers,current]=await Promise.all([rpc.request('app/installed',{forceRefresh:true},45000),rpc.request('model/list',{limit:100},20000),rpc.request('mcpServerStatus/list',{limit:100},45000),rpc.request('config/read',{includeLayers:false},15000)]);
      this.snapshot={checkedAt:new Date().toISOString(),error:'',currentModel:current.config?.model||'',currentEffort:current.config?.model_reasoning_effort||'',apps:apps.apps||[],models:(models.data||[]).map((m:any)=>({id:m.model,name:m.displayName,defaultEffort:m.defaultReasoningEffort,efforts:m.supportedReasoningEfforts.map((e:any)=>e.reasoningEffort),isDefault:m.isDefault})),servers:(servers.data||[]).map((s:any)=>({name:s.name,error:s.toolsError?String(s.toolsError).slice(0,180):'',tools:Object.values(s.tools||{}).filter((t:any)=>s.name==='codex_apps'&&t._meta?.connector_id).map((t:any)=>({name:t.name,description:t.description,inputSchema:t.inputSchema,connectorId:t._meta.connector_id,connectorName:t._meta.connector_name,readOnly:t.annotations?.readOnlyHint===true}))}))};
    }catch(e:any){this.snapshot={...this.snapshot,checkedAt:new Date().toISOString(),error:e.message.slice(0,240)};}finally{await rpc?.close();}return this.snapshot;}
  async call(ctx:RunContext,server:string,tool:string,args:any,approval:(action:string,detail:any)=>Promise<boolean>){
    const state=await this.status();if(state.error)throw new Error(state.error);
    const definition=state.servers.find((s:any)=>s.name===server)?.tools.find((t:any)=>t.name===tool);if(!definition)throw new Error('未发现或不允许的桌面连接器工具，请先 desktop_search');
    const installed=state.apps.find((a:any)=>a.id===definition.connectorId);if(!installed?.enabled||!installed.callable)throw new Error('此连接器当前未启用或不可调用');
    if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('连接器 arguments 必须是对象');
    // 所有写入或语义未知的桌面能力均逐次确认；审批前不发出调用。
    if(!definition.readOnly&&!await approval('调用桌面连接器（可能写入外部服务）',{connector:definition.connectorName,tool,arguments:args}))throw new Error('用户拒绝连接器调用');
    const rpc=await this.connect(),abort=()=>rpc.kill();ctx.signal.addEventListener('abort',abort,{once:true});
    rpc.on('message',async m=>{if(m.id!==undefined&&m.method){try{const yes=await approval('桌面连接器确认',{method:m.method,...m.params});rpc.respond(m.id,m.method==='mcpServer/elicitation/request'?{action:yes?'accept':'decline',content:yes?{}:null}:{decision:yes?'accept':'decline'});}catch{if(!rpc.ended)rpc.send({id:m.id,error:{code:-32000,message:'操作已取消'}});}}});
    try{ctx.signal.throwIfAborted();const started=await rpc.request('thread/start',{cwd:ctx.task.workspace,ephemeral:true,approvalPolicy:'on-request',sandbox:'workspace-write'},30000);const result=await rpc.request('mcpServer/tool/call',{threadId:started.thread.id,server,tool,arguments:args},120000);if(result.isError)throw new Error(JSON.stringify(result.content).slice(0,1000));const structured=JSON.stringify(result.structuredContent??null);return {connector:definition.connectorName,tool,data:structured.length<50000?result.structuredContent:{text:structured.slice(0,50000),truncated:true},content:result.content.filter((c:any)=>c.type==='text').slice(0,20).map((c:any)=>({type:'text',text:String(c.text).slice(0,20000)})),note:'回传文本与结构化结果；媒体与交互组件需在 Codex 桌面查看。'};}finally{ctx.signal.removeEventListener('abort',abort);await rpc.close();}
  }
}
