import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {config} from './config.ts';
import type {RunContext} from './config.ts';
import {Rpc} from './rpc.ts';
import {safePath} from './tools.ts';
import {requestsWorkbenchChange} from './maintenance-intent.ts';
export {requestsWorkbenchChange} from './maintenance-intent.ts';

export const sourceHash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function maintenanceAuthorized(ctx:RunContext){
 const o=JSON.parse(ctx.task.options||'{}');return !o.evaluation&&(requestsWorkbenchChange(o.currentPrompt||ctx.task.prompt)||o.maintenance===true);
}
type Change={path:string;beforeHash:string;content:string};
type Check={name:string;ok:boolean;output:string};
export class Maintenance {
 root:string;data:string;
  attempts=new Map<string,number>();
  declined=new Set<string>();
 validate:(stage:string,ctx:RunContext)=>Promise<Check[]>;
 approve:(ctx:RunContext,action:string,detail:any)=>Promise<boolean>=async()=>false;
 constructor(root=config.root,data=config.data){this.root=root;this.data=data;this.validate=(stage,ctx)=>this.sandboxChecks(stage,ctx);}
 allowed(name:string,write=false){
  if(!name||name.includes('\\')||name.includes(':')||name.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(name))throw new Error('维护源码路径必须为项目内的规范相对路径');
  const permitted=write?/^(?:web\/[\w\p{L}./-]+\.(?:tsx?|jsx?|css|json|html|svg)|tests\/web-[\w-]+\.test\.ts)$/u:/^(?:(?:web|src|tests|scripts)\/[\w\p{L}./-]+\.(?:tsx?|jsx?|mjs|css|json|html|svg|ps1)|(?:package(?:-lock)?\.json|tsconfig\.json|vite\.config\.ts|PRODUCT\.md|DESIGN\.md))$/u;
  if(!permitted.test(name))throw new Error(write?'当前维护入口仅支持网页与对应测试；后端、启动脚本和凭据不能在此自动改写':'此文件不属于公开维护源码，任务数据、账号和应用状态不可读取');
 }
 require(ctx:RunContext){if(!maintenanceAuthorized(ctx))throw new Error('只有用户明确要求修改本工作台时才能使用维护入口');ctx.signal.throwIfAborted();}
 async read(ctx:RunContext,name?:string,offset=0){
  this.require(ctx);
  if(!name){const files:string[]=[];for(const dir of ['web','src','tests','scripts']){await this.walk(await safePath(this.root,dir),async(file)=>{const relative=path.relative(this.root,file).replaceAll('\\','/');try{this.allowed(relative);files.push(relative);}catch{}});}return {files,scope:'可读取公开源码；可提议网页与测试改动；先隔离检查，通过后在当前网页确认应用。'};}
  this.allowed(name);const target=await safePath(this.root,name),info=await fs.stat(target);if(!info.isFile()||info.size>500000)throw new Error('仅支持小于 500 KB 的源码文件');
  const text=await fs.readFile(target,'utf8');if(text.includes('\0'))throw new Error('只支持文本源码');
  return {path:name,hash:sourceHash(text),text:text.slice(offset,offset+24000),total:text.length,truncated:offset+24000<text.length};
 }
 async walk(dir:string,visit:(file:string)=>Promise<void>){let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch(e:any){if(e.code==='ENOENT')return;throw e;}for(const e of entries){if(e.isSymbolicLink()||e.name==='node_modules'||e.name.startsWith('.'))continue;const p=path.join(dir,e.name);if(e.isDirectory())await this.walk(p,visit);else if(e.isFile())await visit(p);}}
 async propose(ctx:RunContext,summary:string,changes:Change[]){
  this.require(ctx);if(typeof summary!=='string'||!summary.trim()||summary.length>2000||!Array.isArray(changes)||!changes.length||changes.length>8)throw new Error('提议必须包含简洁说明和 1–8 个源码改动');
  const attemptKey=ctx.task.id+':'+(JSON.parse(ctx.task.options||'{}').turnId||'initial'),attempts=this.attempts.get(attemptKey)||0;
  if(this.declined.has(attemptKey))throw new Error('你已拒绝本轮工作台改动，不会重复请求确认；需新的用户指令才能重新提议');
  if(attempts>=2)throw new Error('本轮维护检查最多两次，不能重复提交同一环境故障；请保留报告并说明阻碍');
  const seen=new Set<string>(),originals=new Map<string,string|undefined>();let total=0;
  for(const c of changes){this.allowed(c.path,true);if(seen.has(c.path)||typeof c.content!=='string'||typeof c.beforeHash!=='string'||c.content.includes('\0'))throw new Error('重复路径或源码改动格式错误');seen.add(c.path);total+=Buffer.byteLength(c.content);if(total>250000)throw new Error('一次维护改动最多 250 KB');
   const p=await safePath(this.root,c.path);let old:string|undefined;try{old=await fs.readFile(p,'utf8');}catch(e:any){if(e.code!=='ENOENT')throw e;}
   if((old===undefined?'new':sourceHash(old))!==c.beforeHash)throw new Error('源码版本已变化，请重新读取后再提议：'+c.path);originals.set(c.path,old);
  }
  if(changes.every(c=>originals.get(c.path)===c.content))throw new Error('提议没有实际改动，不能冒充已修改工作台');
  this.attempts.set(attemptKey,attempts+1);
  const id=randomUUID(),dir=path.join(this.data,'maintenance',ctx.task.id,id),stage=path.join(dir,'staging');await fs.mkdir(stage,{recursive:true});
  const baseline=new Map<string,string>();
  for(const source of ['web','src','tests','scripts'])await this.walk(await safePath(this.root,source),async file=>{const relative=path.relative(this.root,file),target=path.join(stage,relative),bytes=await fs.readFile(file);baseline.set(relative,createHash('sha256').update(bytes).digest('hex'));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);});
  for(const name of ['package.json','package-lock.json','tsconfig.json','vite.config.ts']){const bytes=await fs.readFile(await safePath(this.root,name));baseline.set(name,createHash('sha256').update(bytes).digest('hex'));await fs.writeFile(path.join(stage,name),bytes);}
  for(const c of changes){const p=await safePath(stage,c.path);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,c.content,'utf8');}
  ctx.emit('message','system',{text:'正在隔离目录检查工作台改动：'+summary+'。通过检查后会在此显示改动并请求应用。'});
  const checks=await this.validate(stage,ctx);ctx.signal.throwIfAborted();
  const reportName='workbench-change-'+id+'.md',report=await safePath(ctx.task.workspace,reportName);
  const text='# 工作台改动提议\n\n'+summary+'\n\n'+checks.map(c=>'- '+c.name+'：'+(c.ok?'通过':'失败')+'\n```text\n'+c.output.slice(-4000)+'\n```').join('\n')+'\n\n'+changes.map(c=>'## '+c.path+'\n\n原版本：`'+c.beforeHash+'`\n\n### 修改前\n```text\n'+(originals.get(c.path)??'[新文件]')+'\n```\n\n### 修改后\n```text\n'+c.content+'\n```').join('\n\n');
  await fs.writeFile(report,text,'utf8');ctx.emit('artifact','system',{path:reportName});
  if(checks.length!==3||checks.some(c=>!c.ok))return {status:'checks_failed',id,checks,report:reportName,note:'检查未通过，正式源码和网页均未修改，请调整方案后重试。'};
  const backup=path.join(dir,'backup');await fs.mkdir(backup,{recursive:true});for(const [name,old] of originals)if(old!==undefined){const p=path.join(backup,name);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,old,'utf8');}
  await fs.writeFile(path.join(dir,'proposal.json'),JSON.stringify({id,taskId:ctx.task.id,summary,changes,checks,report:reportName},null,2));
  const approved=await this.approve(ctx,'应用工作台网页改动',{id,summary,files:changes.map(c=>({path:c.path,beforeHash:c.beforeHash,afterHash:sourceHash(c.content)})),checks:checks.map(c=>({name:c.name,ok:c.ok})),report:reportName,note:'完整修改前后内容已在对话成果文件中展示。仅更新本机网页；不会发布 GitHub 或修改模型、密钥与任务数据。'});
  ctx.signal.throwIfAborted();if(!approved){this.declined.add(attemptKey);ctx.emit('maintenance_declined','system',{id});return {status:'declined',id,report:reportName,note:'你已拒绝应用，正式源码和网页保持原状。'};}
  for(const [file,hash] of baseline){let bytes;try{bytes=await fs.readFile(await safePath(this.root,file));}catch{throw new Error('等待确认期间源码已变化，未应用本提议：'+file);}if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('等待确认期间源码已变化，未应用本提议：'+file);}
  for(const c of changes){let old:string|undefined;try{old=await fs.readFile(await safePath(this.root,c.path),'utf8');}catch(e:any){if(e.code!=='ENOENT')throw e;}if((old===undefined?'new':sourceHash(old))!==c.beforeHash)throw new Error('等待确认期间源码已变化，未应用本提议：'+c.path);}
  const oldIndex=await fs.readFile(path.join(this.root,'dist','index.html')).catch(()=>undefined);let touched:string[]=[];
  try{
   for(const c of changes){ctx.signal.throwIfAborted();const p=await safePath(this.root,c.path);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,c.content,'utf8');touched.push(c.path);}
   await fs.mkdir(path.join(this.root,'dist'),{recursive:true});await this.walk(path.join(stage,'dist'),async file=>{if(path.relative(path.join(stage,'dist'),file)==='index.html')return;const target=await safePath(this.root,path.join('dist',path.relative(path.join(stage,'dist'),file)));await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(file,target);});
   ctx.signal.throwIfAborted();const temporary=path.join(this.root,'dist','index-'+id+'.tmp');await fs.copyFile(path.join(stage,'dist','index.html'),temporary);await fs.rename(temporary,path.join(this.root,'dist','index.html'));
  }catch(error){for(const name of touched){const target=await safePath(this.root,name),old=originals.get(name);if(old===undefined)await fs.unlink(target);else await fs.writeFile(target,old,'utf8');}if(oldIndex)await fs.writeFile(path.join(this.root,'dist','index.html'),oldIndex);throw error;}
  ctx.emit('maintenance_applied','system',{id,summary,files:changes.map(c=>c.path),report:reportName});
  return {status:'applied',id,report:reportName,files:changes.map(c=>c.path),note:'本机网页改动已应用，刷新工作台即可看到。未自动提交或发布 GitHub。'};
 }
 async sandboxChecks(stage:string,ctx:RunContext):Promise<Check[]>{
  const env={...process.env};for(const key of Object.keys(env))if(/TOKEN|SECRET|PASSWORD|API_KEY|COOKIE/i.test(key)||key.startsWith('LA_'))delete env[key];
  const rpc=new Rpc(config.codex,['app-server'],{cwd:stage,env}),abort=()=>rpc.kill();ctx.signal.addEventListener('abort',abort,{once:true});
  const tests=(await fs.readdir(path.join(stage,'tests'))).filter(f=>/^web-[\w-]+\.test\.ts$/.test(f)).map(f=>path.join(stage,'tests',f));
  try{await rpc.request('initialize',{clientInfo:{name:'workbench_maintenance_checks',version:'0.4.0'}});rpc.notify('initialized');const results:Check[]=[];
   for(const [name,args] of [['TypeScript',[path.join(config.root,'node_modules','typescript','bin','tsc'),'--noEmit','--project',path.join(stage,'tsconfig.json')]],['Frontend tests',['--disable-warning=ExperimentalWarning','--test','--experimental-test-isolation=none',...tests]],['Build',[path.join(stage,'scripts','maintenance-build.ts')]]] as [string,string[]][]){
    ctx.signal.throwIfAborted();const r=await rpc.request('command/exec',{command:[process.execPath,...args],cwd:stage,sandboxPolicy:{type:'workspaceWrite',writableRoots:[stage],networkAccess:false,excludeTmpdirEnvVar:false,excludeSlashTmp:false},timeoutMs:60000},65000);
    results.push({name,ok:r.exitCode===0,output:String(r.stdout||'')+'\n'+String(r.stderr||'')});if(r.exitCode!==0)break;
   }return results;
  }catch(e:any){if(ctx.signal.aborted)throw e;return [{name:'Sandbox',ok:false,output:e.message}];}
  finally{ctx.signal.removeEventListener('abort',abort);await rpc.close();}
 }
}
