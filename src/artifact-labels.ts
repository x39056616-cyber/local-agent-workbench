import {open} from 'node:fs/promises';
import path from 'node:path';
import {safePath} from './tools.ts';

async function prefix(workspace:string,file:string){const p=await safePath(workspace,file),h=await open(p,'r');try{const b=Buffer.alloc(24000),r=await h.read(b,0,b.length,0);return b.subarray(0,r.bytesRead).includes(0)?'':b.toString('utf8',0,r.bytesRead);}finally{await h.close();}}
const clean=(s:string)=>s.replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'').slice(0,100);
export async function describeArtifact(workspace:string,file:string,document?:any){
 const relative=file.replaceAll('\\','/'),filename=path.posix.basename(relative),ext=path.extname(filename).toLowerCase(),format=ext.slice(1).toUpperCase()||'文件';
 let displayName='',description='',category='成果文件',text='';
 const known:Record<string,[string,string]>={
  'company_comparison.csv':['公司财务对比表','公司指标与计算结果'],
  'research_brief.md':['研究简报','主要结论、对比与来源依据'],
  'execution_notes.md':['执行记录','执行过程、验证情况与未解决问题'],
  'manifest.json':['来源文件清单','已保存文档的来源、路径与校验信息'],
  'materials.csv':['材料登记表','已登记材料的题名、类别与来源']
 };
 if(known[filename]&&(filename!=='manifest.json'||relative.startsWith('documents/'))){[displayName,description]=known[filename];if(['manifest.json','materials.csv'].includes(filename))category='来源清单';}
 if(document){
  try{text=await prefix(workspace,document.textPath);}catch{}
  const head=text.replace(/\s+/g,' '),url=document.finalUrl||document.url||'';
  const appleAt=head.search(/\bApple\s+Inc\.?\b/i),msAt=head.search(/\bMicrosoft\s+Corporation\b/i);
  const issuer=appleAt>=0&&(msAt<0||appleAt<msAt)?'苹果':msAt>=0||/https?:\/\/(?:[^/]*\.)?microsoft(?:\.gcs-web)?\.com\//i.test(url)||/dear shareholders/i.test(head.slice(0,3000))&&/\bMicrosoft\b/i.test(head.slice(0,3000))?'微软':'';
  const year=head.match(/(?:for the )?fiscal year ended.{0,70}?\b(20\d{2})\b/i)?.[1]||head.match(/\b(?:fiscal year|FY)\s*(20\d{2})\b/i)?.[1]||filename.match(/(?:^|[-_ ])(20\d{2})(?:[-_ .]|$)/)?.[1];
  const report=/annual report|form\s+10[ -]?k|年报/i.test(head+' '+filename)||issuer==='微软'&&/dear shareholders/i.test(head);
  const sourceTitle=issuer?(issuer+(year?' FY'+year:'')+(report?' 年报':' 文档')):'';
  const firstLine=text.split(/\r?\n/).map(s=>s.trim()).find(s=>s.length>5&&s.length<130&&!/^\[第 \d+ 页\]|^UNITED STATES$|^SECURITIES AND EXCHANGE/i.test(s));
  displayName=sourceTitle||clean(firstLine||'')||'来源文档';
  const extracted=relative===String(document.textPath||'').replaceAll('\\','/');
  if(extracted)displayName+=' · 提取文本';
  category=extracted?'提取文本':'来源原件';description=extracted?'从原文件提取的正文':'下载保存的原始文档';
  if(document.pages)description+=' · '+document.pages+' 页';
  if(extracted&&document.complete===0)description+=' · 提取不完整';
 }
 if(!displayName&&['.md','.txt'].includes(ext)){try{text=await prefix(workspace,relative);const heading=text.match(/^#{1,3}\s+(.+)$/m)?.[1];if(heading)displayName=clean(heading);}catch{}}
 if(!displayName){const stem=filename.slice(0,ext? -ext.length:undefined).replace(/-?[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi,'').replace(/(?:^|[-_])[a-f\d]{24,}(?:$|[-_])/gi,' ');displayName=clean(stem)||format+' 文档';}
 displayName=clean(displayName)||format+' 文档';description=description||format+' 文件，点击预览查看内容';
 const suffix=document?'-'+String(document.id||'').slice(0,6):'';
 return {displayName,description,category,format,originalName:filename,downloadName:clean(displayName+suffix)+ext,...(document?{sourceUrl:document.finalUrl||document.url}:{} )};
}
