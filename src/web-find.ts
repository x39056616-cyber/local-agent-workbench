import type {EventRecord} from './config.ts';
export function cachedWebFind(events:EventRecord[],url:string,query:string){
 if(typeof query!=='string'||!query.trim()||query.length>300)throw new Error('网页定位关键词应为1–300字符');
 const terms=[...new Set(query.toLowerCase().split('|').map(x=>x.trim()).filter(Boolean))];if(terms.length>8)throw new Error('网页定位最多8个关键词');
 const last=events.findLastIndex(e=>e.type==='user_message'),hits:any[]=[],seen=new Set<string>();
 for(const e of events.slice(Math.max(0,last)).toReversed()){
  if(e.type!=='tool_done'||!['web_read','web_find','fetch_url','crawl_read'].includes(e.data.name)||e.data.result?.url!==url)continue;
  const text=e.data.result.text;if(typeof text!=='string')continue;const lower=text.toLowerCase();let cursor=0;
  while(hits.length<6){const offsets=terms.map(t=>lower.indexOf(t,cursor)).filter(i=>i>=0);if(!offsets.length)break;const at=Math.min(...offsets),start=Math.max(0,at-200),end=Math.min(text.length,at+900),snippet=text.slice(start,end),line=[...text.slice(0,at).matchAll(/(?:^|\n)L(\d+):/g)].at(-1)?.[1];cursor=end;if(!seen.has(snippet)){seen.add(snippet);hits.push({text:snippet,line:line?Number(line):null,readAt:e.created});}}
  if(hits.length>=6)break;
 }
 return {url,query,cached:true,hits,text:hits.map(h=>h.text).join('\n\n'),note:'仅定位本轮实际读取过的网页片段，不代表整页已下载或全部字段已找到。'};
}
