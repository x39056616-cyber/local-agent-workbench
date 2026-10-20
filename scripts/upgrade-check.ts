import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {config} from '../src/config.ts';
import {Desktop} from '../src/desktop.ts';
const base='http://127.0.0.1:'+config.port;
const session=await fetch(base+'/api/session'),cookie=session.headers.get('set-cookie')!.split(';')[0];
async function api(route:string,method='GET',body?:any){const r=await fetch(base+'/api'+route,{method,headers:{cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const d:any=await r.json();assert(r.ok,JSON.stringify(d));return d;}
const before:any=await(await fetch(config.qwenBase.replace(/\/v1$/,'/api/v1/models'))).json();
const report:any={checkedAt:new Date().toISOString()};
let documentId='',memoryId='';
try{
 const doc=await api('/knowledge','POST',{title:'验收资料：出行安排',text:'The traveler reserved a train ticket for Friday. The departure station is Shanghai Hongqiao.\n用户选择周五乘坐高铁，从上海虹桥站出发。'});documentId=doc.id;assert.equal(doc.dimensions,768);
 const m=await api('/memories','POST',{text:'验收偏好：写作使用简体中文，并标明原始资料出处。'});memoryId=m.id;assert(m.indexed);
 const found=await api('/retrieval/search','POST',{query:'Where will the passenger begin the railway journey?'});assert.equal(found.mode,'hybrid');assert(found.hits.some((h:any)=>h.source===doc.id));
 report.vector={mode:found.mode,dimensions:doc.dimensions,hits:found.hits.map((h:any)=>({title:h.title,scope:h.scope,similarity:h.similarity}))};
 const models=await api('/models');assert(models.codex.models.length>0);report.models=models;
 const state=await api('/connectors?refresh=1');assert(!state.error);const t=state.servers.flatMap((s:any)=>s.tools.map((t:any)=>({...t,server:s.name}))).find((t:any)=>t.name==='github.get_user_login');assert(t);
 const desktop=new Desktop();desktop.snapshot=state;
 const result=await desktop.call({task:{workspace:config.root},signal:AbortSignal.timeout(120000)} as any,t.server,t.name,{},async()=>false);assert.equal(result.data.login,'x39056616-cyber');
 report.connectors={apps:state.apps,githubLogin:result.data.login,tool:t.name};
 const paired=await api('/pair','POST',{}),pairURL=new URL(paired.url),token=new URLSearchParams(pairURL.hash.slice(1)).get('token')!,origin=pairURL.origin;
 const remote=await fetch(base+'/api/tasks',{headers:{Origin:origin,Authorization:'Bearer '+token}});assert.equal(remote.status,200);assert.equal(remote.headers.get('access-control-allow-origin'),origin);
 const missing=await fetch(base+'/api/tasks',{headers:{Origin:origin}});assert.equal(missing.status,401);
 const wrongOrigin=await fetch(base+'/api/tasks',{headers:{Origin:'https://evil.example',Authorization:'Bearer '+token}});assert.equal(wrongOrigin.status,403);
 const preflight=await fetch(base+'/api/tasks',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});assert.equal(preflight.status,204);
 const internal=await fetch(base+'/internal/tools',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token}});assert.equal(internal.status,403);
 await api('/pair','DELETE');assert.equal((await fetch(base+'/api/tasks',{headers:{Origin:origin,Authorization:'Bearer '+token}})).status,403);
 report.pairing={authenticated:true,missingTokenDenied:true,wrongOriginDenied:true,preflight:true,workerDenied:true,revoked:true};
 const after:any=await(await fetch(config.qwenBase.replace(/\/v1$/,'/api/v1/models'))).json();const getConfig=(data:any)=>data.models.find((m:any)=>m.key===config.qwenModel).loaded_instances[0]?.config;
 assert.deepEqual(getConfig(after),getConfig(before));report.qwenConfig={unchanged:true,config:getConfig(after),embeddingLoaded:after.models.find((m:any)=>m.type==='embedding').loaded_instances.length>0};
 report.passed=true;console.log('向量、连接器、模型目录、网页配对与 Qwen 配置检查通过');
}finally{if(documentId)await api('/knowledge/'+documentId,'DELETE');if(memoryId)await api('/memories/'+memoryId,'DELETE');await mkdir(path.join(config.root,'acceptance'),{recursive:true});await writeFile(path.join(config.root,'acceptance/upgrade.json'),JSON.stringify(report,null,2));}
