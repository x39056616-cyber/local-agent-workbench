import React from 'react';
export function CollectionProgress({events}:{events:any[]}){
 const last=events.findLastIndex(e=>e.type==='user_message'),event=events.slice(Math.max(0,last)).findLast(e=>e.type==='collection_progress');
 if(!event?.data.goal)return null;const p=event.data,g=p.goal;
 return <section className="execution-progress" aria-label="材料交付进度" aria-live="polite">
  <p><strong>目标：{g.target}{g.fulltext?'份'+(g.report?'报告全文':'完整文档'):'项'+(g.award?'获奖信息':'材料名称')}</strong>{g.years.length>0&&<span> · {g.years[0]}—{g.years.at(-1)}年</span>}</p>
  <p>名称已登记 {p.titles} 项{g.award&&<> · 获奖已核实 {p.awards} 项</>} · 去重全文 {p.fulltexts}/{g.target} 份</p>
  <small>已下载 {p.downloaded} 个文件，{p.failed} 个来源失败。{p.remaining>0?'还缺 '+p.remaining+(g.fulltext?' 份符合要求的全文。':' 项有原文证据的材料。'):'数量与材料证据已满足，交付前仍会检查文件。'}</small>
 </section>;
}
