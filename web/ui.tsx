import React from 'react';

const paths:Record<string,string>={
 check:'m5 12 4 4L19 6',
 tasks:'M4 4h16v16H4zM4 9h16M9 9v11',
 capabilities:'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
 memory:'M4 5h6l2 2 2-2h6v15h-6l-2 1-2-1H4zM12 7v14',
 evaluation:'m5 17 4-5 4 2 6-8M4 3v18h17',
 archive:'M4 8h16v13H4zM3 3h18v5H3zM9 12h6',
 settings:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
 menu:'M4 6h16M4 12h16M4 18h16',close:'m6 6 12 12M18 6 6 18',
 arrow:'M5 12h14m-6-6 6 6-6 6',plus:'M12 5v14M5 12h14',
};
export function Icon({name,size=18}:{name:string;size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.tasks}/></svg>;}
export function Mark(){return <svg className="brand-mark" width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 24 16 5l11 19H5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="m5 24 11-6 11 6M16 5v13" stroke="currentColor" strokeWidth="1.5"/><circle cx="16" cy="18" r="3" fill="currentColor"/></svg>;}
export function TeamFlow({engines,roles}:{engines:any[];roles?:any[]}){
 const defaults=[{id:'researcher',engine:'qwen',name:'资料研究',detail:'提取事实，形成计划'},{id:'builder',engine:'harness',name:'执行制作',detail:'调用工具，生成成果'},{id:'reviewer',engine:'codex',name:'独立核验',detail:'检查文件，反馈修订'}];
 const members=(roles||defaults).map((r:any,i:number)=>({...r,detail:r.instructions||defaults[i]?.detail||'按角色职责执行'}));
 return <div className="team-flow" aria-label="协作分工">{members.map((r:any,i:number)=>{const e=engines.find((e:any)=>e.id===r.engine);return <div className="flow-member" key={r.id}><div className="flow-top"><span className="flow-step">{String(i+1)}</span><span className={'dot '+(e?.ok?'succeeded':'interrupted')}/><span>{e?.ok?'可连接':'待连接'}</span></div><strong>{r.engine==='qwen'?'Qwen':r.engine==='harness'?'DeepSeek':'Codex'}</strong><span className="flow-duty">{r.name}</span><small>{r.detail}</small>{i<members.length-1&&<span className="flow-arrow"><Icon name="arrow" size={16}/></span>}</div>;})}</div>;
}
