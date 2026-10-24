import {existsSync,readFileSync,mkdirSync,writeFileSync,copyFileSync,renameSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {config} from './config.ts';
import {ModelRequestError} from './model-request.ts';
import {ProxyAgent,fetch as proxyFetch} from 'undici';

export const deepseekEfforts=['off','minimal','low','medium','high','xhigh','ultra','max'];
export const deepseekModels=['deepseek-flash','deepseek-v4-pro'];
export function deepseekThinking(effort:string){
  if(effort==='off'||effort==='none')return {thinking:{type:'disabled'}};
  if(!effort)return {};
  const map:Record<string,string>={minimal:'low',low:'low',medium:'high',high:'high',xhigh:'high',ultra:'max',max:'max'};
  if(!map[effort])throw new Error('不支持此 DeepSeek 强度');
  return {thinking:{type:'enabled'},reasoning_effort:map[effort]};
}
async function dpapi(value:string,unprotect=false){
  if(process.platform!=='win32')throw new Error('此设备暂不支持系统加密保存，请使用 LA_DEEPSEEK_API_KEY 环境变量');
  const op=unprotect?'Unprotect':'Protect';
  const script=`Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $bytes=${unprotect?'[Convert]::FromBase64String($v)':'[Text.Encoding]::UTF8.GetBytes($v)'}; $r=[Security.Cryptography.ProtectedData]::${op}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); ${unprotect?'[Console]::Out.Write([Text.Encoding]::UTF8.GetString($r))':'[Console]::Out.Write([Convert]::ToBase64String($r))'}`;
  return new Promise<string>((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';child.stdout.on('data',c=>out+=c);child.stderr.resume();const timer=setTimeout(()=>{child.kill();reject(new Error('系统凭据加密超时'));},10000);child.on('error',()=>{clearTimeout(timer);reject(new Error('系统凭据加密不可用'));});child.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(new Error('系统凭据加密失败'));});child.stdin.end(value);});
}
export class DeepSeekProvider {
  file:string; secretFile:string; proxy?:ProxyAgent;
  constructor(dir=config.data){mkdirSync(dir,{recursive:true});this.file=path.join(dir,'deepseek-provider.json');this.secretFile=path.join(dir,'deepseek-secret.dpapi');}
  read():any {return existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{mode:'harness',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-flash',models:[],verifiedAt:null};}
  status(){const d=this.read();return {...d,hasKey:!!process.env.LA_DEEPSEEK_API_KEY||existsSync(this.secretFile),keySource:process.env.LA_DEEPSEEK_API_KEY?'environment':existsSync(this.secretFile)?'windows-dpapi':'none',efforts:deepseekEfforts,effortMapping:{minimal:'low',medium:'high',xhigh:'high',ultra:'max'},accountNote:'Harness 模式复用桌面版已登录的 deepseek-account；API 模式使用单独的开发者密钥，两者账单独立。'};}
  async key(){if(process.env.LA_DEEPSEEK_API_KEY)return process.env.LA_DEEPSEEK_API_KEY;if(!existsSync(this.secretFile))throw new Error('尚未配置 DeepSeek API Key，请到本机运行设置添加');return dpapi(readFileSync(this.secretFile,'utf8'),true);}
  async save(input:any){
    if(!input||!['harness','api'].includes(input.mode)||typeof input.baseUrl!=='string'||typeof input.model!=='string'||!input.model.trim()||input.model.length>150)throw new Error('DeepSeek 接入配置无效');
    const u=new URL(input.baseUrl);if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw new Error('API 地址需为 HTTPS，或本机 HTTP 服务，不可包含凭据或查询参数');
    const previous=this.read(),baseUrl=u.href.replace(/\/$/,'');
    if(baseUrl!==previous.baseUrl&&existsSync(this.secretFile)&&!input.apiKey)throw new Error('更改 API 地址时请重新填写密钥，避免把已有密钥发送到新地址');
    if(input.apiKey!==undefined&&input.apiKey!==''){
      if(typeof input.apiKey!=='string'||input.apiKey.length<8||input.apiKey.length>1000||/[\r\n]/.test(input.apiKey))throw new Error('API Key 格式无效');
      const encrypted=await dpapi(input.apiKey);if(existsSync(this.secretFile))copyFileSync(this.secretFile,this.secretFile+'.bak');writeFileSync(this.secretFile+'.tmp',encrypted,{mode:0o600});renameSync(this.secretFile+'.tmp',this.secretFile);
    }
    const next={mode:input.mode,baseUrl,model:input.model.trim(),models:baseUrl===previous.baseUrl?previous.models||[]:[],verifiedAt:null};
    if(existsSync(this.file))copyFileSync(this.file,this.file+'.bak');writeFileSync(this.file+'.tmp',JSON.stringify(next,null,2));renameSync(this.file+'.tmp',this.file);return this.status();
  }
  clearKey(){rmSync(this.secretFile,{force:true});rmSync(this.secretFile+'.bak',{force:true});return this.status();}
  async request(route:string,body?:any,signal?:AbortSignal){
    const d=this.read(),key=await this.key(),options:any={method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})};
    if(config.webProxy&&!['localhost','127.0.0.1'].includes(new URL(d.baseUrl).hostname)){this.proxy??=new ProxyAgent(config.webProxy);options.dispatcher=this.proxy;}
    const r=await proxyFetch(d.baseUrl+route,options);if(!r.ok){await r.body?.cancel();throw new ModelRequestError('DeepSeek API HTTP '+r.status+(r.status===401?'：密钥无效或已失效':r.status===402?'：账号余额不足':''),[408,429,500,502,503,504].includes(r.status)?'transient':'configuration',r.status,new Headers(r.headers as any));}return r;
  }
  async test(){const r=await this.request('/models'),data:any=await r.json();const models=data.data?.filter((m:any)=>typeof m.id==='string').map((m:any)=>m.id);if(!models?.length)throw new Error('API 未返回模型目录');const d=this.read();writeFileSync(this.file,JSON.stringify({...d,models,verifiedAt:new Date().toISOString()},null,2));return this.status();}
}
