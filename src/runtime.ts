import {spawn,type ChildProcess} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {config} from './config.ts';
import {setTimeout as delay} from 'node:timers/promises';

type Startup={status:'idle'|'starting'|'loading'|'ready'|'failed'|'disabled';message:string;updated:string};
let child:ChildProcess|undefined;
const statePath=path.join(config.data,'qwen-startup.json');
export function qwenStartup():Startup{
 try{const value=JSON.parse(readFileSync(statePath,'utf8'));if(['starting','loading','ready','failed','disabled'].includes(value.status))return {status:value.status,message:String(value.message||'').slice(0,500),updated:String(value.updated||'')};}catch{}
 return {status:'idle',message:'本地 Qwen 将在打开工作台时自动准备',updated:''};
}
export async function qwenStatus():Promise<Startup>{
 const state=qwenStartup();if(state.status!=='ready')return state;
 try{
   const response=await fetch(config.qwenBase.replace(/\/v1\/?$/,'')+'/api/v1/models',{signal:AbortSignal.timeout(1500)});
   if(!response.ok)throw new Error('offline');const data:any=await response.json();
   if(data.models?.some((m:any)=>m.key===config.qwenModel&&m.loaded_instances?.length))return state;
   return {...state,status:'failed',message:'Qwen 当前未加载，点击重试即可重新准备'};
 }catch{return {...state,status:'failed',message:'本地模型服务已离线，点击重试即可重新准备'};}
}
export async function waitForQwen(signal:AbortSignal,notify:()=>void){
 let state=qwenStartup();if(!['starting','loading'].includes(state.status))return;
 const elapsed=Date.now()-Date.parse(state.updated);if(!Number.isFinite(elapsed)||elapsed>270000)return;
 notify();const deadline=Date.now()+270000;
 while(['starting','loading'].includes(state.status)){
   signal.throwIfAborted();if(Date.now()>deadline)throw new Error('Qwen 准备超时，请在页面重试');
   await delay(500,undefined,{signal});state=qwenStartup();
 }
 if(state.status==='failed')throw new Error(state.message);
}
export function startQwen(){
 if(child)return qwenStartup();
 mkdirSync(config.data,{recursive:true});
 const save=(status:Startup['status'],message:string)=>{const value={status,message,updated:new Date().toISOString()};writeFileSync(statePath,JSON.stringify(value));return value;};
 if(process.env.LA_AUTO_START_QWEN==='0')return save('disabled','此工作台实例已关闭 Qwen 自动启动');
 if(process.platform!=='win32')return save('disabled','自动启动适用于 Windows；请启动已有的本地模型服务');
 const endpoint=new URL(config.qwenBase);
 if(!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.protocol!=='http:')return save('disabled','自定义的远程模型服务由你自行启动');
 save('starting','正在准备本地 Qwen，工作台可以继续使用');
 try{
   child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(config.root,'scripts/start-qwen-api.ps1'),'-DataDirectory',config.data,'-BaseUrl',config.qwenBase,'-Model',config.qwenModel],{cwd:config.root,windowsHide:true,stdio:'ignore'});
   child.once('error',()=>{save('failed','无法启动模型准备进程，请检查 PowerShell 和 Bionic 安装');child=undefined;});
   child.once('exit',code=>{if(code&&['starting','loading'].includes(qwenStartup().status))save('failed','Qwen 准备失败，可重试或检查模型应用的本地 API 页面');child=undefined;});
 }catch{child=undefined;return save('failed','无法启动模型准备进程');}
 return qwenStartup();
}
