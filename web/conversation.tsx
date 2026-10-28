import React,{useEffect,useState} from 'react';
import {api,download,imagePreview} from './client.ts';
import {Icon} from './ui.tsx';
import {trimUrlToken} from './links.ts';

const names:Record<string,string>={qwen:'Qwen',harness:'DeepSeek',codex:'Codex',system:'工作台'};
const normalize=(name:string)=>name.replaceAll('\\','/').replace(/^\.\//,'');
export const internalFile=(name:string)=>/^(?:\.agent-reports\/|attachments\/|agent-result\.md$)/.test(normalize(name));

function Inline({text,onFile}:{text:string;onFile?:(name:string)=>void}){
 const pieces=text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\)|https?:\/\/[^\s<>`"'，。；！？、）】》]+)/gi);
 return <>{pieces.map((s,i)=>{
   if(s.startsWith('`')&&s.endsWith('`'))return <code key={i}>{s.slice(1,-1)}</code>;
   if(s.startsWith('**')&&s.endsWith('**'))return <strong key={i}>{s.slice(2,-2)}</strong>;
   const link=s.match(/^\[([^\]]+)\]\(([^)]+)\)$/);if(link){const [,label,url]=link;
     if(/^https?:\/\//i.test(url))return <a href={url} target="_blank" rel="noreferrer noopener" key={i}>{label}</a>;
     if(onFile&&!/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url))return <button className="inline-file" key={i} onClick={()=>{try{onFile(decodeURIComponent(url));}catch{onFile(url);}}}>{label}</button>;
     return <React.Fragment key={i}>{label}</React.Fragment>;
   }
   if(/^https?:\/\//i.test(s)){const {url,trailing}=trimUrlToken(s);return <React.Fragment key={i}><a href={url} target="_blank" rel="noreferrer noopener">{url}</a>{trailing}</React.Fragment>;}
   return <React.Fragment key={i}>{s}</React.Fragment>;
 })}</>;
}
function Copy({text,label='复制'}:{text:string;label?:string}){const [state,setState]=useState('');return <button className="copy-button" onClick={()=>void navigator.clipboard.writeText(text).then(()=>setState('已复制'),()=>setState('复制失败'))}>{state||label}</button>;}
export function Markdown({text,onFile}:{text:string;onFile?:(name:string)=>void}){
 const lines=text.replaceAll('\r','').split('\n'),blocks:React.ReactNode[]=[];let i=0;
 const inline=(s:string)=><Inline text={s} onFile={onFile}/>;
 while(i<lines.length){
   const line=lines[i];if(!line.trim()){i++;continue;}
   const fence=line.match(/^\s*```([\w+-]*)/);if(fence){const code:string[]=[];i++;while(i<lines.length&&!/^\s*```/.test(lines[i]))code.push(lines[i++]);i++;blocks.push(<div className="code-block" key={i}><div><span>{fence[1]||'代码'}</span><Copy text={code.join('\n')}/></div><pre><code>{code.join('\n')}</code></pre></div>);continue;}
   const heading=line.match(/^(#{1,6})\s+(.+)$/);if(heading){blocks.push(React.createElement('h'+Math.min(heading[1].length+1,6),{key:i++},inline(heading[2])));continue;}
   if(i+1<lines.length&&line.includes('|')&&/^\s*\|?\s*:?-{3,}[\s|:-]*$/.test(lines[i+1])){
     const cells=(s:string)=>s.trim().replace(/^\||\|$/g,'').split('|').slice(0,24).map(x=>x.trim()),header=cells(line),rows:string[][]=[];i+=2;
     while(i<lines.length&&lines[i].trim()&&lines[i].includes('|'))rows.push(cells(lines[i++]));
     blocks.push(<div className="answer-table" key={i}><table><thead><tr>{header.map((h,n)=><th key={n}>{inline(h)}</th>)}</tr></thead><tbody>{rows.map((r,n)=><tr key={n}>{header.map((_,c)=><td key={c}>{inline(r[c]||'')}</td>)}</tr>)}</tbody></table></div>);continue;
   }
   if(/^\s*[-*+]\s+/.test(line)||/^\s*\d+[.)]\s+/.test(line)){const ordered=/^\s*\d/.test(line),items:string[]=[];const pattern=ordered?/^\s*\d+[.)]\s+/:/^\s*[-*+]\s+/;while(i<lines.length&&pattern.test(lines[i]))items.push(lines[i++].replace(pattern,''));blocks.push(React.createElement(ordered?'ol':'ul',{key:i},items.map((s,n)=><li key={n}>{inline(s)}</li>)));continue;}
   if(/^>\s?/.test(line)){const q:string[]=[];while(i<lines.length&&/^>/.test(lines[i]))q.push(lines[i++].replace(/^>\s?/,''));blocks.push(<blockquote key={i}>{inline(q.join('\n'))}</blockquote>);continue;}
   const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(?:#{1,6}\s|\s*```|\s*[-*+]\s|\s*\d+[.)]\s|>)/.test(lines[i])){if(i+1<lines.length&&lines[i].includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1]))break;paragraph.push(lines[i++]);}
   blocks.push(<p key={i}>{inline(paragraph.join('\n'))}</p>);
 }
 return <div className="markdown-body">{blocks}</div>;
}

function FileCard({taskId,file,initialOpen=false,forceOpen=false}:{taskId:string;file:any;initialOpen?:boolean;forceOpen?:boolean}){
 const [opened,setOpened]=useState(initialOpen),[preview,setPreview]=useState<any>(),[error,setError]=useState(''),[image,setImage]=useState('');
 useEffect(()=>{if(forceOpen)setOpened(true);},[forceOpen]);
 useEffect(()=>{if(!opened)return;let alive=true,url='';setError('');setPreview(undefined);setImage('');
   const load=async()=>{try{if(/\.(png|jpe?g|webp|gif)$/i.test(file.path)){url=await imagePreview(taskId,file.path);if(alive)setImage(url);else URL.revokeObjectURL(url);}else{const p=await api('/tasks/'+taskId+'/preview?path='+encodeURIComponent(file.path));if(alive)setPreview(p);}}catch(e:any){if(alive)setError(e.message);}};
   void load();return()=>{alive=false;if(url)URL.revokeObjectURL(url);};
 },[opened,taskId,file.path,file.revision]);
 const name=normalize(file.path).split('/').at(-1)!;
 return <article className="artifact-card" data-file-path={normalize(file.path)}><div className="artifact-heading"><Icon name="file" size={18}/><div><strong>{file.displayName||name}</strong><small>{file.category||'成果文件'} · {file.format||name.split('.').at(-1)?.toUpperCase()}{file.description?' · '+file.description:''}{file.bytes!==undefined?' · '+(file.bytes/1024).toFixed(1)+' KB':''}</small><details className="original-filename"><summary>原文件名</summary><span>{normalize(file.path)}</span></details></div><button className="file-preview-toggle" aria-expanded={opened} aria-label={(opened?'收起预览：':'预览：')+name} onClick={()=>setOpened(!opened)}>{opened?'收起':'预览'}</button><button className="artifact-download" aria-label={'下载：'+name} onClick={()=>void download(taskId,file.path).catch(e=>setError(e.message))}><Icon name="download" size={16}/>下载</button></div>
   {opened&&<div className="artifact-preview">{error?<p role="alert">{error}<button onClick={()=>{setOpened(false);setTimeout(()=>setOpened(true),0);}}>重试</button></p>:image?<img src={image} alt={name}/>:preview?preview.kind==='markdown'?<Markdown text={preview.text}/>:preview.kind==='text'?<div className="code-block"><div><span>{preview.language||'文本'}</span><Copy text={preview.text}/></div><pre><code>{preview.text}</code></pre></div>:<p>文件已生成，此格式请下载查看。</p>:<p role="status">正在读取预览…</p>}{preview?.truncated&&<p className="preview-limit">预览前256 KB，下载可查看完整内容。</p>}</div>}
 </article>;
}
export function Conversation({task,events,files,renderEvent}:{task:any;events:any[];files:any[];renderEvent:(e:any)=>React.ReactNode}){
 const turns:any[]=[],hasUserMessages=events.some(e=>e.type==='user_message');let current:any;
 const begin=(id:string,user:string)=>{current={id,user,events:[]};turns.push(current);};
 for(const e of events){if(e.type==='user_message'){begin(e.data.turnId||String(e.id),e.data.text);continue;}if(!current&&hasUserMessages)continue;if(!current)begin('legacy',task.prompt);current.events.push(e);}
 if(!current)begin('empty',task.prompt);
 const [focused,setFocused]=useState('');
 const allFiles=new Map<string,any>(files.map(f=>[normalize(f.path),f]));
 for(const e of events.filter(e=>e.type==='artifact'&&e.data.path)){const name=normalize(e.data.path);allFiles.set(name,{...e.data,...allFiles.get(name),path:name,revision:e.id});}
 const latest=turns.at(-1),active=['queued','running','waiting','cancelling'].includes(task.status);
 return <>{turns.map((turn,index)=>{
   const last=turn===latest,final=turn.events.filter((e:any)=>e.type==='final').at(-1),deltas=turn.events.filter((e:any)=>e.type==='chat_delta').map((e:any)=>e.data.text).join('');
   const text=final?.data.text||(last&&!active?task.result:'')||deltas;
   const engine=final?.engine||turn.events.find((e:any)=>e.type==='engine_start')?.engine;
   const registered=new Set(turn.events.filter((e:any)=>e.type==='artifact').map((e:any)=>normalize(e.data.path||'')));
   const attachments=new Set(events.filter(e=>e.type==='attachment').map(e=>normalize(e.data.path)));
   const visible=[...allFiles.entries()].filter(([p])=>!internalFile(p)&&!attachments.has(p)&&(registered.has(p)||turns.length===1&&!registered.size)).map(([,f])=>f);
   const process=turn.events.filter((e:any)=>!['user_message','chat_delta','final','status','artifact','attachment','usage'].includes(e.type));
   return <section className="conversation-turn" key={task.id+':'+turn.id}><div className="user-message">{turn.user}</div>
     {(text||last&&active)&&<article className="assistant-answer" aria-label="助手回复" aria-busy={last&&active}><div className="answer-heading"><span className={'engine-icon '+engine}>{(names[engine]||'工作台')[0]}</span><b>{names[engine]||'工作台'}</b>{last&&active&&<span className="answer-working">{deltas?'正在回复':'正在处理'}</span>}{text&&!(last&&active)&&<Copy text={text} label="复制回答"/>}</div>{text?<Markdown text={text} onFile={p=>setFocused(normalize(p))}/>:<p className="reply-pending" role="status">{turn.events.some((e:any)=>e.type==='context'&&e.data.message?.includes('准备'))?'本地模型正在准备，就绪后继续…':'正在处理你的消息…'}</p>}</article>}
     {visible.length>0&&<div className="conversation-files" aria-label="成果文件">{visible.map((file,n)=><FileCard key={file.path} taskId={task.id} file={file} initialOpen={n===0&&/\.(md|txt|png|jpe?g|webp)$/i.test(file.path)} forceOpen={focused===normalize(file.path)}/>)}</div>}
     {process.length>0&&<details className="execution-records"><summary>执行过程 · {process.length} 条记录</summary>{process.map((e:any)=><React.Fragment key={e.id}>{renderEvent(e)}</React.Fragment>)}</details>}
     {last&&task.error&&<div className="task-error" role="alert">{task.error}</div>}
   </section>;
 })}</>;
}
