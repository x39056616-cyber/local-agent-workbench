import React,{useState} from 'react';
import {api} from './client.ts';
import {modelNames,preferences,categories} from '../src/model-policy.ts';

export function RoutingPreference({value,onChange}:{value:string;onChange:(value:string)=>void}){
 return <label className="intent-picker">自动选模偏好<select aria-label="自动选模偏好" value={value} onChange={e=>onChange(e.target.value)}>{Object.entries(preferences).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select><small>质量接近时优先 DeepSeek；复杂任务可用 Codex，本地整理可用 Qwen。</small></label>;
}
export function ModelRouting({task,events}:{task:any;events:any[]}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const last=events.findLastIndex(e=>e.type==='user_message'),current=events.slice(Math.max(0,last)),decision=current.findLast(e=>e.type==='model_route')?.data;
 const cooperation=current.findLast(e=>e.type==='cooperation_route')?.data;
 if(cooperation)return <section className="model-routing" aria-label="本次自动分工"><div className="model-routing-heading"><strong>按阶段自动分工</strong><span>{cooperation.choices.length} 个职责</span></div><p>{cooperation.reason}</p><div className="routing-candidates">{cooperation.choices.map((c:any)=><div key={c.id}><b>{cooperation.workflow.automatic.duties.find((d:any)=>d.id===c.id)?.name} · {modelNames[c.engine]}</b><span>{c.reason}</span></div>)}</div><details><summary>查看分工依据</summary><p className="muted">{cooperation.basis}。这是派发计划；实际执行以阶段记录和模型返回为准。</p><pre>{JSON.stringify(cooperation.choices,null,2)}</pre></details></section>;
 if(!decision)return null;
 const final=current.some(e=>e.type==='final'&&e.engine===decision.engine),rating=current.findLast(e=>e.type==='routing_feedback'&&e.data.decisionId===decision.id)?.data.rating;
 const rate=async(value:number)=>{setBusy(true);setError('');try{await api('/tasks/'+task.id+'/routing-feedback','POST',{decisionId:decision.id,rating:value});}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return <section className="model-routing" aria-label="本次模型选择"><div className="model-routing-heading"><strong>{modelNames[decision.engine]} · {decision.automatic?'自动选用':'指定执行'}</strong><span>{categories[decision.category as keyof typeof categories]}</span></div><p>{decision.reason}</p><details><summary>查看选择依据</summary><p className="muted">{decision.basis}。仅比较配置可用的候选；CLI 已安装不代表账号已验证。</p><div className="routing-candidates">{decision.candidates.map((c:any)=><div key={c.engine}><b>{modelNames[c.engine]}</b><span>{c.available?`${c.samples} 次本机执行 · ${c.ratings} 次评价`:c.unavailableReason}</span></div>)}</div></details>{final&&decision.automatic&&decision.feedbackEligible!==false&&<div className="routing-feedback"><span>{rating?'评价已保存，下次同类任务会参考。':'这次回答符合预期吗？'}</span><button disabled={busy} aria-pressed={rating===1} onClick={()=>void rate(1)}>符合预期</button><button disabled={busy} aria-pressed={rating===-1} onClick={()=>void rate(-1)}>需要改进</button></div>}{error&&<p role="alert">评价未保存：{error}，请重试。</p>}</section>;
}
