import path from 'node:path';
import {researchKinds} from './routing.ts';

export type Evidence={ref:string;kind:'web'|'local';text:string;tool:string};
export class EvidenceLedger {
 sources=new Map<string,Evidence>();
 workspace:string;
 constructor(workspace:string){this.workspace=workspace;}
 record(name:string,args:any,result:any){
  if(result?.error)return;
  const add=(ref:string,kind:'web'|'local',text:any)=>{if(typeof text==='string'&&text.trim())this.sources.set(kind+':'+ref,{ref,kind,text:text.slice(0,30000),tool:name});};
  if(['fetch_url','web_read'].includes(name)&&typeof result?.url==='string')add(result.url,'web',result.text);
  if(name==='read_file'&&typeof result?.path==='string')add(path.relative(this.workspace,path.resolve(this.workspace,result.path)).replaceAll('\\','/'),'local',result.total===0?'[已实际读取：文件为空]':result.text);
  if(name==='search_files')for(const h of result?.hits||[])if(typeof h.path==='string')add(h.path.replaceAll('\\','/'),'local',h.snippet);
  if(['knowledge_search','memory_search'].includes(name))for(const h of result?.hits||[])if(typeof h.source==='string')add('knowledge:'+h.source+':'+(h.part||0),'local',h.text);
  if(name==='desktop_read'){
   const text=(result?.content||[]).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n');
   if(args.tool==='search_service.web_run'){for(const item of args.arguments?.open||[])if(/^https?:\/\//i.test(item.ref_id||''))add(item.ref_id,'web',text);}
   else if(text)add('connector:'+args.server+'/'+args.tool,'local',text);
  }
 }
 require(kinds:('web'|'local')[],claimed?:any){
  for(const kind of kinds)if(![...this.sources.values()].some(s=>s.kind===kind))throw new Error((kind==='web'?'联网研究':'本地资料研究')+'尚无实际读取的非空来源。请先读取资料；仅搜索标题、列计划或返回空结果不能算完成。');
  if(claimed!==undefined){
   if(!Array.isArray(claimed)||claimed.length>12)throw new Error('sources 应为最多 12 项的来源数组');
   for(const c of claimed){const actual=[...this.sources.values()].find(s=>s.ref===c?.ref);if(!actual)throw new Error('来源没有实际工具记录：'+String(c?.ref));if(typeof c.quote!=='string'||c.quote.length<4||c.quote.length>600||!actual.text.replace(/\s+/g,' ').includes(c.quote.replace(/\s+/g,' ')))throw new Error('来源摘录必须取自本阶段实际读取的原文：'+c.ref);}
  }
 }
 publicSources(){return [...this.sources.values()].slice(0,12).map(s=>({ref:s.ref,kind:s.kind,tool:s.tool,excerpt:s.text.slice(0,600)}));}
}
export function taskEvidence(events:any[],workspace:string,prompt:string){
 const lastUser=events.findLastIndex(e=>e.type==='user_message'),current=events.slice(lastUser<0?0:lastUser),ledger=new EvidenceLedger(workspace);
 const starts=new Map(current.filter(e=>e.type==='tool_start').map(e=>[e.data.id,e.data]));
 for(const e of current)if(e.type==='tool_done'){const start=starts.get(e.data.id);if(start)ledger.record(start.name,start.args,e.data.result);}
 ledger.require(researchKinds(prompt));return ledger;
}
