import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { config, errorText } from './config.ts';
import type { Engine } from './config.ts';
import { Store } from './store.ts';
import { Agent } from './agent.ts';
import { safePath, toolSpecs } from './tools.ts';
import { modelCatalog, validateProfiles } from './profiles.ts';
import {validateWorkflow} from './workflows.ts';
import {Evaluation,evaluationExamples} from './evaluation.ts';
import {isGreeting,taskRoute} from './routing.ts';
import {startQwen,qwenStatus} from './runtime.ts';
import {previewArtifact} from './artifacts.ts';
import {maintenanceScope} from './maintenance-intent.ts';
import {preference} from './model-policy.ts';

const store=new Store(config.data), workerToken=randomBytes(32).toString('hex'),cookieToken=randomBytes(32).toString('hex');
const agent=new Agent(store,workerToken);
const evaluation=new Evaluation(store,agent);
let pairedOrigin='',pairedToken='';
const remoteStreams=new Set<http.ServerResponse>();
function revokePair(){pairedOrigin='';pairedToken='';for(const stream of remoteStreams)stream.end();remoteStreams.clear();}
await agent.tools.inventory();
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function json(res:http.ServerResponse,status:number,value:any){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req:http.IncomingMessage):Promise<any>{let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>12_000_000)throw new Error('请求超过 12 MB');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new Error('请求 JSON 格式错误');}}
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json; charset=utf-8','.ttf':'font/ttf'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  const host=req.headers.host||'';
  if(![`127.0.0.1:${config.port}`,`localhost:${config.port}`].includes(host))return json(res,403,{error:'Host 不受信任'});
  const origin=req.headers.origin;
  const remote=!!origin&&origin!=='http://'+host;
  const trustedRemote=remote&&pairedOrigin===origin&&!!pairedToken;
  if(remote&&!trustedRemote)return json(res,403,{error:'此网页尚未与本机配对，请从本机工作台开启 GitHub 网页连接。'});
  if(trustedRemote){res.setHeader('Access-Control-Allow-Origin',origin!);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, Last-Event-ID');res.setHeader('Access-Control-Allow-Private-Network','true');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}}
  if(req.headers['sec-fetch-site']==='cross-site'&&!trustedRemote)return json(res,403,{error:'拒绝跨站请求'});
  let url:URL;try{url=new URL(req.url||'/','http://'+host);}catch{return json(res,400,{error:'URL 无效'});}
  try{
    if(url.pathname.startsWith('/internal/')){
      if(!equal(req.headers.authorization||'','Bearer '+workerToken))return json(res,403,{error:'执行器认证失败'});
      if(req.method!=='POST')return json(res,405,{error:'方法不支持'});
      const data=await body(req);
      const active=agent.active;
      if(!active||active.id!==data.taskId)return json(res,409,{error:'任务已不在运行'});
      if((data.stageId||'')!==(active.ctx.stage?.id||''))return json(res,409,{error:'执行阶段已失效'});
      if(url.pathname==='/internal/tools')return json(res,200,active.ctx.specs??toolSpecs(data.delegation===true&&active.ctx.task.engine==='auto'));
      if(url.pathname==='/internal/call')return json(res,200,await active.ctx.tool(data.name,data.args||{},data.engine==='harness'?'harness':'codex'));
      return json(res,404,{error:'接口不存在'});
    }
    if(url.pathname==='/api/session'&&req.method==='GET'&&!remote){
      res.setHeader('Set-Cookie',`la_session=${cookieToken}; HttpOnly; SameSite=Strict; Path=/`);
      return json(res,200,{ready:true,version:'0.4.0',local:true,publishedUrl:config.publishedUrl,defaultWorkspace:path.join(config.data,'tasks'),profiles:store.setting('profiles',{}),settings:{timeoutMinutes:store.setting('timeoutMinutes',30),maxCalls:store.setting('maxCalls',30)},routingPreference:store.setting('routingPreference','balanced')});
    }
    if(url.pathname.startsWith('/api/')){
      const cookies=String(req.headers.cookie||'').split(';').map(s=>s.trim());
      if(remote?!trustedRemote||!equal(req.headers.authorization||'','Bearer '+pairedToken):!cookies.some(c=>equal(c,'la_session='+cookieToken)))return json(res,401,{error:'本地会话或网页配对已失效，请从本机工作台重新连接'});
      if(url.pathname==='/api/session'&&req.method==='GET')return json(res,200,{ready:true,version:'0.4.0',local:false,publishedUrl:config.publishedUrl,profiles:store.setting('profiles',{}),settings:{timeoutMinutes:store.setting('timeoutMinutes',30),maxCalls:store.setting('maxCalls',30)},routingPreference:store.setting('routingPreference','balanced')});
      if(url.pathname==='/api/pair'&&req.method==='POST'){
        if(remote)return json(res,403,{error:'只能在本机工作台开启连接'});
        const target=new URL(config.publishedUrl);if(target.protocol!=='https:')throw new Error('发布地址必须使用 HTTPS');
        revokePair();pairedOrigin=target.origin;pairedToken=randomBytes(32).toString('hex');
        return json(res,200,{url:target.href+'#'+new URLSearchParams({backend:'http://127.0.0.1:'+config.port,token:pairedToken}).toString()});
      }
      if(url.pathname==='/api/pair'&&req.method==='DELETE'){if(remote)return json(res,403,{error:'请在本机工作台关闭连接'});revokePair();return json(res,200,{ok:true});}
      if(url.pathname==='/api/providers/deepseek'&&req.method==='GET')return json(res,200,agent.engines.provider.status());
      if(url.pathname.startsWith('/api/providers/deepseek')&&['POST','DELETE'].includes(req.method||'')){if(remote)return json(res,403,{error:'密钥和接入配置请在本机工作台修改'});if(agent.active||agent.chats.size)return json(res,409,{error:'请等待执行结束或停止任务后再修改模型接入'});if(url.pathname.endsWith('/test'))return json(res,200,await agent.engines.provider.test());if(req.method==='DELETE')return json(res,200,agent.engines.provider.clearKey());return json(res,200,await agent.engines.provider.save(await body(req)));}
      if(url.pathname==='/api/evaluations/examples'&&req.method==='GET')return json(res,200,evaluationExamples);
      if(url.pathname==='/api/evaluations'&&req.method==='GET')return json(res,200,await evaluation.list());
      if(url.pathname==='/api/evaluations'&&req.method==='POST'){const d=await body(req);if(!['auto','codex','harness','qwen'].includes(d.engine))throw new Error('执行器无效');d.options=await validateProfiles(d.options??{},agent.tools.desktop);d.workflow=validateWorkflow(d.workflow,d.engine);return json(res,201,await evaluation.create(d));}
      if(url.pathname.startsWith('/api/evaluations/')&&req.method==='DELETE'){evaluation.cancel(url.pathname.split('/').at(-1)!);return json(res,200,{ok:true});}
      if(url.pathname==='/api/models'&&req.method==='GET')return json(res,200,await modelCatalog(agent.tools.desktop));
      if(url.pathname==='/api/connectors'&&req.method==='GET')return json(res,200,await agent.tools.desktop.status(url.searchParams.get('refresh')==='1'));
      if(url.pathname==='/api/runtime/qwen'&&req.method==='GET')return json(res,200,await qwenStatus());
      if(url.pathname==='/api/runtime/qwen'&&req.method==='POST'){
        if(remote)return json(res,403,{error:'请在本机工作台启动本地模型'});
        await body(req);return json(res,202,startQwen());
      }
      if(url.pathname==='/api/health'&&req.method==='GET'){
        const engines=(await agent.engines.health()).map(e=>{const last=store.db.prepare("SELECT e.created FROM events e JOIN tasks t ON e.taskId=t.id WHERE e.engine=? AND e.type='engine_done' AND t.status='succeeded' ORDER BY e.id DESC LIMIT 1").get(e.id) as any;return {...e,verifiedAt:last?.created||null};});
        const desktop=agent.tools.desktop.snapshot;
        return json(res,200,{engines,tools:toolSpecs(true),skills:agent.tools.skills,retrieval:agent.tools.retrieval.status(),connectors:{checkedAt:desktop.checkedAt,apps:desktop.apps,error:desktop.error,detail:desktop.checkedAt?'已通过 Codex App Server 验证运行时状态；媒体及宿主交互工具仍需桌面查看。':'点击检测连接器，核对当前登录下可用的桌面能力。'}});
      }
      if(url.pathname==='/api/tasks'&&req.method==='GET')return json(res,200,store.list().filter(t=>Boolean(t.archived)===(url.searchParams.get('archived')==='1')).map(({id,title,status,engine,created,updated,archived})=>({id,title,status,engine,created,updated,archived})));
      if(url.pathname==='/api/tasks'&&req.method==='POST'){
        const data=await body(req);if(typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>30000)throw new Error('请输入 1–30000 字符的任务');
        if(!['auto','codex','harness','qwen'].includes(data.engine))throw new Error('执行器无效');
        if(data.intent!==undefined&&!['auto','chat','task'].includes(data.intent))throw new Error('任务类型无效');
        const workflow=validateWorkflow(data.workflow,data.engine);
        const chat=taskRoute({prompt:data.prompt,engine:data.engine,hasAttachments:!!data.files?.length,options:JSON.stringify({intent:data.intent,workflow})}).kind==='chat';
        if(chat&&data.files?.length)throw new Error('带附件请使用工具任务类型，快捷对话不读取附件');
        const routingPreference=preference(data.routingPreference??store.setting('routingPreference','balanced'));
        const requested=data.options??store.setting('profiles',{}),target=taskRoute({prompt:data.prompt,engine:data.engine,options:JSON.stringify({routingPreference})}).engine;
        const profiles=await validateProfiles(chat&&data.engine!=='auto'?(requested[target]?{[target]:requested[target]}:{}):requested,agent.tools.desktop);
        if(chat&&isGreeting(data.prompt)&&target!=='codex')profiles[target]={...(profiles[target]||{}),effort:target==='qwen'?'none':'off'};
        const taskOptions={...profiles,routingPreference,workflow,maintenance:maintenanceScope(data.prompt),intent:chat?'chat':'task',requestedIntent:data.intent||'auto',turnId:randomBytes(8).toString('hex')};
        if(data.files!==undefined&&(!Array.isArray(data.files)||data.files.length>5))throw new Error('最多上传 5 个附件');
        const uploads=(data.files||[]).map((file:any)=>{if(typeof file.name!=='string'||typeof file.base64!=='string')throw new Error('附件无效');const name=path.basename(file.name).replace(/[^\p{L}\p{N}._ -]/gu,'_');if(!name||['.','..'].includes(name))throw new Error('附件名称无效');const bytes=Buffer.from(file.base64,'base64');if(bytes.length>5_000_000)throw new Error('附件超过 5 MB');return {name,bytes};});
        if(data.workspace && !path.isAbsolute(data.workspace))throw new Error('任务目录必须是绝对路径');
        const workspace=data.workspace?path.resolve(data.workspace):path.join(config.data,'tasks',randomBytes(8).toString('hex'));
        await fs.mkdir(workspace,{recursive:true});
        const realWorkspace=await fs.realpath(workspace),attachmentRecords=[];
        for(const file of uploads){const p=await safePath(realWorkspace,path.join('attachments',randomBytes(3).toString('hex')+'-'+file.name));await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,file.bytes,{flag:'wx'});attachmentRecords.push({path:path.relative(realWorkspace,p),bytes:file.bytes.length});}
        const attachmentPrompt=attachmentRecords.length?'\n附件文件：\n'+attachmentRecords.map(f=>f.path).join('\n'):'';
        const task=store.create(data.prompt.trim()+attachmentPrompt,data.engine as Engine,realWorkspace);
        store.update(task.id,{options:JSON.stringify(taskOptions)});task.options=JSON.stringify(taskOptions);
        for(const file of attachmentRecords)agent.emitEvent(task.id,'attachment','user',file);
        await agent.enqueue(task);return json(res,201,task);
      }
      const match=url.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)(?:\/(.*))?$/);
      if(match){const task=store.get(match[1]);if(!task)return json(res,404,{error:'任务不存在'});const action=match[2];
        if(!action&&req.method==='GET')return json(res,200,{task,events:store.events(task.id),approvals:store.db.prepare("SELECT * FROM approvals WHERE taskId=? AND status='pending'").all(task.id)});
        if(action==='events'&&req.method==='GET'){
          let last=Number(req.headers['last-event-id']||url.searchParams.get('after')||0);if(!Number.isSafeInteger(last)||last<0)last=0;
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
          if(remote)remoteStreams.add(res);
          const send=(e:any)=>{if(e.taskId===task.id&&e.id>last){last=e.id;res.write('id: '+e.id+'\ndata: '+JSON.stringify(e)+'\n\n');}};
          agent.on('event',send);for(const e of store.events(task.id,last))send(e);
          const timer=setInterval(()=>res.write(': keepalive\n\n'),15000);
          req.on('close',()=>{clearInterval(timer);agent.removeListener('event',send);remoteStreams.delete(res);});return;
        }
        if(action==='routing-feedback'&&req.method==='POST'){const d=await body(req),feedback=agent.router.feedback(task.id,d.decisionId,d.rating);agent.emitEvent(task.id,'routing_feedback','user',feedback);return json(res,200,feedback);}
        if(action==='archive'&&req.method==='POST'){const d=await body(req);if(typeof d.archived!=='boolean')throw new Error('归档参数无效');store.archive(task.id,d.archived);agent.emitEvent(task.id,'archived','user',{archived:d.archived});return json(res,200,store.get(task.id));}
        if(action==='cancel'&&req.method==='POST'){agent.cancel(task.id);return json(res,200,{ok:true});}
        if(action==='resume'&&req.method==='POST'){
          if(['queued','running','waiting','cancelling'].includes(task.status))return json(res,409,{error:'任务正在执行'});
          if(task.archived)return json(res,409,{error:'请先取消归档再继续任务'});
          const input=await body(req);if(input.prompt && typeof input.prompt!=='string')throw new Error('补充指令无效');
          const prior=JSON.parse(task.options||'{}');
          if(input.prompt){
            const current=input.prompt.slice(0,10000),history=[...(prior.conversation||[]),{role:'user',content:prior.currentPrompt||task.prompt},...(task.result?[{role:'assistant',content:task.result}]:[])].slice(-12);
            const engine=input.engine||task.engine;if(!['auto','qwen','harness','codex'].includes(engine))throw new Error('执行器无效');
            const requestedIntent=input.intent||prior.requestedIntent||'auto';if(!['auto','chat','task'].includes(requestedIntent))throw new Error('任务类型无效');
            const hasImages=store.events(task.id).some(e=>e.type==='attachment'&&/\.(?:png|jpe?g|webp)$/i.test(e.data.path||''));
            const continuingFiles=prior.intent==='task'&&(/继续|再改|改成|补充|优化|调整|再生成|这个文件|该文件|刚才的文件|上面的文件/.test(current)||hasImages&&/图片|照片|截图|图中|附件|看清|识别|这是什么|这个呢|那这|刚才/.test(current));
            const maintenance=maintenanceScope(current,prior.maintenance===true);
            const workflow=validateWorkflow(input.workflow||prior.workflow,engine),chat=taskRoute({prompt:current,engine,hasAttachments:continuingFiles,options:JSON.stringify({intent:requestedIntent,workflow,maintenance})}).kind==='chat';
            const routingPreference=preference(input.routingPreference??prior.routingPreference??store.setting('routingPreference','balanced'));
            const target=taskRoute({prompt:current,engine,options:JSON.stringify({routingPreference})}).engine,requested=input.options||Object.fromEntries(['qwen','harness','codex'].filter(k=>prior[k]).map(k=>[k,prior[k]]));
            const profiles=await validateProfiles(chat&&engine!=='auto'?(requested[target]?{[target]:requested[target]}:{}):requested,agent.tools.desktop);
            if(chat&&isGreeting(current)&&target!=='codex')profiles[target]={...(profiles[target]||{}),effort:target==='qwen'?'none':'off'};
            const next={...prior,...profiles,routingPreference,workflow,maintenance,conversation:history,currentPrompt:current,turnId:randomBytes(8).toString('hex'),requestedIntent,intent:chat?'chat':'task'};
            store.update(task.id,{status:'queued',error:'',result:'',engine,options:JSON.stringify(next)});
          }else {
            const reviews=store.events(task.id).filter(e=>e.type==='stage_done'&&/^balanced\.review\.\d+$/.test(e.data.id||'')&&e.data.value?.passed===false);
            const limit=Math.min(3,(prior.workflow?.maxRevisions??1)+(prior.repairAllowance||0));
            if(prior.workflow?.mode==='balanced'&&reviews.some(e=>Number(e.data.id.split('.').at(-1))>=limit)&&limit<3){prior.repairAllowance=Math.min(2,(prior.repairAllowance||0)+1);agent.emitEvent(task.id,'repair_budget','system',{additionalRevisions:1,totalLimit:limit+1});}
            // 旧版曾把联网请求保存成自动聊天，重新续接时按当前路由修正。
            if(prior.intent==='chat'&&prior.requestedIntent!=='chat'&&taskRoute({...task,options:JSON.stringify({...prior,intent:'auto'})}).kind==='task')prior.intent='task';
            store.update(task.id,{status:'queued',error:'',result:'',options:JSON.stringify(prior)});
          }
          agent.emitEvent(task.id,'checkpoint','user',{message:'用户继续任务。先核对已有成果与操作记录。'});
          await agent.enqueue(store.get(task.id)!);return json(res,200,{ok:true,task:store.get(task.id)});
        }
        if(action==='files'&&req.method==='GET'){
          const files:any[]=[];const walk=async(dir:string,depth:number)=>{if(depth>3||files.length>=200)return;for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink()||['node_modules','.git','.agent-recovery'].includes(e.name))continue;const p=await safePath(task.workspace,path.join(dir,e.name));if(e.isDirectory())await walk(p,depth+1);else {const s=await fs.stat(p);files.push({path:path.relative(task.workspace,p),bytes:s.size});}}};await walk(task.workspace,0);return json(res,200,files);
        }
        if(action==='preview'&&req.method==='GET')return json(res,200,await previewArtifact(task.workspace,url.searchParams.get('path')||''));
        if(action==='file'&&req.method==='GET'){
          const name=url.searchParams.get('path')||'',p=await safePath(task.workspace,name),stat=await fs.stat(p);if(!stat.isFile()||stat.size>20_000_000)throw new Error('成果无效或超过 20 MB');
          const bytes=await fs.readFile(p);res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(p))}`);res.end(bytes);return;
        }
      }
      if(url.pathname.startsWith('/api/approvals/')&&req.method==='POST'){const data=await body(req);if(typeof data.approved!=='boolean')throw new Error('审批格式错误');agent.resolveApproval(url.pathname.split('/').at(-1)!,data.approved);return json(res,200,{ok:true});}
      if(url.pathname==='/api/memories'&&req.method==='GET')return json(res,200,store.memories(url.searchParams.get('q')||''));
      if(url.pathname==='/api/memories'&&req.method==='POST'){const data=await body(req);if(typeof data.text!=='string'||!data.text.trim()||data.text.length>6000)throw new Error('记忆长度无效');const m=store.remember(data.text.trim());try{return json(res,201,{...m,indexed:await agent.tools.retrieval.index(m.id,'memory',m.text)});}catch(e){return json(res,201,{...m,warning:'记忆已保存，向量索引失败，可稍后重建：'+errorText(e)});}}
      if(url.pathname.startsWith('/api/memories/')&&req.method==='DELETE'){store.forget(url.pathname.split('/').at(-1)!);return json(res,200,{ok:true});}
      if(url.pathname==='/api/knowledge'&&req.method==='GET')return json(res,200,agent.tools.retrieval.status());
      if(url.pathname==='/api/knowledge'&&req.method==='POST'){const d=await body(req);if(typeof d.title!=='string'||!d.title.trim()||d.title.length>200||typeof d.text!=='string'||!d.text.trim()||d.text.length>200000)throw new Error('资料标题或正文无效（最多 20 万字符）');return json(res,201,await agent.tools.retrieval.add(d.title.trim(),d.text));}
      if(url.pathname.startsWith('/api/knowledge/')&&req.method==='DELETE'){agent.tools.retrieval.remove(url.pathname.split('/').at(-1)!);return json(res,200,{ok:true});}
      if(url.pathname==='/api/retrieval/search'&&req.method==='POST'){const d=await body(req);if(typeof d.query!=='string'||!d.query.trim()||d.query.length>1800)throw new Error('请输入不超过 1800 字符的查询');return json(res,200,await agent.tools.retrieval.search(d.query));}
      if(url.pathname==='/api/retrieval/reindex'&&req.method==='POST')return json(res,200,await agent.tools.retrieval.reindex());
      if(url.pathname==='/api/profiles'&&req.method==='POST'){const d=await validateProfiles(await body(req),agent.tools.desktop);store.setSetting('profiles',d);return json(res,200,d);}
      if(url.pathname==='/api/settings'&&req.method==='POST'){const data=await body(req);for(const [k,min,max] of [['timeoutMinutes',1,120],['maxCalls',5,100]] as const){if(data[k]!==undefined){if(!Number.isInteger(data[k])||data[k]<min||data[k]>max)throw new Error('设置范围无效');store.setSetting(k,data[k]);}}return json(res,200,{ok:true});}
      return json(res,404,{error:'接口不存在'});
    }
    if(req.method!=='GET')return json(res,405,{error:'方法不支持'});
    const rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
    const p=await safePath(path.join(config.root,'dist'),rel);
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Content-Type',types[path.extname(p)]||'application/octet-stream');res.end(await fs.readFile(p));
  }catch(e){if(!res.headersSent)json(res,400,{error:errorText(e)});else res.end();}
});
server.listen(config.port,'127.0.0.1',async()=>{
  await fs.writeFile(path.join(config.data,'server.json'),JSON.stringify({pid:process.pid,port:config.port,root:config.root}));
  console.log(`本地 Agent 工作台：http://127.0.0.1:${config.port}`);for(const t of store.list().filter(t=>t.status==='queued'))void agent.enqueue(t);void agent.pump();
});
server.on('error',e=>{console.error(errorText(e));process.exitCode=1;});
let closing=false;
async function shutdown(){if(closing)return;closing=true;if(agent.active)agent.cancel(agent.active.id);for(const id of agent.chats.keys())agent.cancel(id);server.close();setTimeout(()=>process.exit(0),3000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
