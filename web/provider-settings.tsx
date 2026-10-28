import React,{useEffect,useState} from 'react';
import {api,remote} from './client.ts';
import {Icon} from './ui.tsx';
import {engineLifecycle} from '../src/engine-lifecycle.ts';
export function ProviderSettings({onChanged}:{onChanged:()=>void}){
  const [config,setConfig]=useState<any>(),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{api('/providers/deepseek').then(setConfig).catch(e=>setMessage(e.message));},[]);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await fn();}catch(e:any){setMessage(e.message);}finally{setBusy(false);}};
  if(!config)return <p>{message||'读取 DeepSeek 接入配置…'}</p>;
  return <section className="provider-settings"><h2>DeepSeek 接入</h2><p className="muted">{config.accountNote}</p><label>接入方式<select aria-label="DeepSeek 接入方式" disabled={remote||busy} value={config.mode} onChange={e=>setConfig({...config,mode:e.target.value})}><option value="harness">Harness 桌面账号（已登录账号）</option><option value="api">DeepSeek API Key（开发者 API）</option></select></label><p className="provider-state">{config.mode==='harness'?'调用本机 Harness CLI，复用桌面登录；无需再填 API Key。':`API 密钥：${config.hasKey?'已保存 / 已配置':'未配置'} · ${config.keySource==='windows-dpapi'?'Windows 当前用户加密':config.keySource==='environment'?'服务端环境变量':'请添加密钥'}`}</p>{config.mode==='api'&&<><label>API Base URL<input aria-label="DeepSeek API 地址" autoComplete="off" disabled={remote||busy} value={config.baseUrl} onChange={e=>setConfig({...config,baseUrl:e.target.value})}/></label><label>默认模型<input aria-label="DeepSeek API 模型" disabled={remote||busy} value={config.model} onChange={e=>setConfig({...config,model:e.target.value})} placeholder="deepseek-flash"/></label><label>API Key（留空保留现有密钥）<input aria-label="DeepSeek API Key" type="password" autoComplete="new-password" spellCheck={false} disabled={remote||busy} value={key} onChange={e=>setKey(e.target.value)} placeholder={config.hasKey?'已保存，不回显':'在本机输入密钥'}/></label></>}{remote?<p>密钥请在 <a href="http://127.0.0.1:4317/" target="_blank" rel="noreferrer">本机工作台</a> 管理。</p>:<div className="pair-actions"><button className="primary" disabled={busy} onClick={()=>void run(async()=>{setConfig(await api('/providers/deepseek','POST',{mode:config.mode,baseUrl:config.baseUrl,model:config.model,...(key?{apiKey:key}:{})}));setKey('');setMessage('接入方式已保存');onChanged();})}>保存接入设置</button>{config.mode==='api'&&<><button disabled={busy} onClick={()=>void run(async()=>{const d=await api('/providers/deepseek/test','POST',{});setConfig(d);setMessage('API 连接成功，发现模型：'+d.models.join('、'));onChanged();})}>测试已保存的 API</button><button disabled={busy||!config.hasKey} onClick={()=>void run(async()=>{setConfig(await api('/providers/deepseek','DELETE'));setKey('');setMessage('本机保存的密钥已移除；环境变量需在服务端移除');})}>移除保存的密钥</button></>}</div>}{message&&<p role="status">{message}</p>}<p className="muted">强度选项：关闭、最小、低、中、高、很高、极高、最高。实际映射为关闭 / low / high / max；其中最小→低，中与很高→高，极高→最高。</p></section>;
}
export function Participation({events,status}:{events:any[];status?:string}){
  const active=['running','waiting','queued','cancelling'].includes(status||''),[now,setNow]=useState(Date.now());
  useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[active]);
  const names:Record<string,string>={qwen:'Qwen',harness:'DeepSeek',codex:'Codex'};
  return <div className="participation">{Object.entries(names).map(([id,name])=>{
    const state=engineLifecycle(events,id,now),tools=events.filter(e=>e.type==='tool_start'&&e.engine===id).length,running=active&&state.open>0;
    return <div key={id} className={running?'participant-working':state.success?'participant-done':''}><b>{name}<em>{running?'处理中':state.failed?'已结束 · 有中断':state.success?'已返回':state.starts?'已中断':'未参与'}</em></b><span>{state.starts?`${state.success+state.failed}/${state.starts} 次结束`:'尚未参与'}</span><small>{tools} 次共享工具 · {(state.duration/1000).toFixed(1)} 秒</small></div>;
  })}</div>;
}
export function ArchivePanel({onOpen,onChanged}:{onOpen:(id:string)=>void;onChanged:()=>void}){
  const [tasks,setTasks]=useState<any[]>([]),[error,setError]=useState('');
  const refresh=()=>api('/tasks?archived=1').then(setTasks).catch(e=>setError(e.message));
  useEffect(()=>{void refresh();},[]);
  return <section className="page archive-page"><h1>已归档的任务。</h1><p className="muted">归档保留执行记录、附件和成果，取消归档后可以继续。</p>{error&&<p role="alert">{error}</p>}{!tasks.length&&<p>暂无归档任务。</p>}{tasks.map(t=><article data-task-id={t.id} key={t.id}><button className="text-button" onClick={()=>onOpen(t.id)}>{t.title} <Icon name="arrow" size={14}/></button><small>{new Date(t.updated).toLocaleString('zh-CN')}</small><button onClick={()=>void api('/tasks/'+t.id+'/archive','POST',{archived:false}).then(()=>{void refresh();onChanged();}).catch(e=>setError(e.message))}>取消归档</button></article>)}</section>;
}
