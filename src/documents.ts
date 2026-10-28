import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {load} from 'cheerio';
import {config} from './config.ts';
import type {RunContext} from './config.ts';
import type {Store} from './store.ts';
import {safePath} from './tools.ts';
import {publicResource} from './public-resource.ts';
import {inferCollectionGoal,evidenceText,reportSignals} from './collection-goal.ts';
const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
const robotsParser=createRequire(import.meta.url)('robots-parser');
export function documentKind(b:Buffer){if(b.subarray(0,5).toString()==='%PDF-')return 'pdf';if(b.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225])))return 'doc';if(b[0]===80&&b[1]===75&&b[2]===3&&b[3]===4)return 'docx';return '';}

export async function parseDocument(file:string,kind:string,signal:AbortSignal):Promise<any>{
 signal.throwIfAborted();return new Promise((resolve,reject)=>{
  const env:NodeJS.ProcessEnv={};for(const k of ['PATH','SystemRoot','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
  const child=spawn(process.execPath,['--max-old-space-size=512',path.join(config.root,'src/document-worker.mjs'),file,kind],{windowsHide:true,env,stdio:['ignore','pipe','pipe']});let out='',error='',settled=false;
  const finish=(e?:unknown,value?:any)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(e){child.kill();reject(e);}else resolve(value);};
  const abort=()=>finish(signal.reason||new Error('任务已取消')),timer=setTimeout(()=>finish(new Error('文档解析超过30秒，原文件已保留')),30000);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  child.stdout.on('data',c=>{out+=c;if(out.length>1_000_000)finish(new Error('提取正文超过限制，原文件已保留'));});child.stderr.on('data',c=>error=(error+c).slice(-2000));child.on('error',e=>finish(e));
  child.on('close',code=>{if(code!==0)return finish(new Error('文档解析失败：'+error));try{finish(undefined,JSON.parse(out));}catch{finish(new Error('文档解析器没有返回有效结果'));}});
 });
}

export class DocumentService{
 store:Store;download=(url:string,signal:AbortSignal,max:number,guard?:(url:string)=>Promise<void>)=>publicResource(url,signal,max,guard);
 parse=parseDocument;
 constructor(store:Store){this.store=store;store.db.exec(`
  CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,taskId TEXT,url TEXT,finalUrl TEXT DEFAULT '',sourceUrl TEXT DEFAULT '',state TEXT,kind TEXT DEFAULT '',path TEXT DEFAULT '',textPath TEXT DEFAULT '',hash TEXT DEFAULT '',textHash TEXT DEFAULT '',textFileHash TEXT DEFAULT '',bytes INTEGER DEFAULT 0,pages INTEGER,complete INTEGER DEFAULT 0,signals INTEGER DEFAULT 0,characters INTEGER DEFAULT 0,duplicateOf TEXT DEFAULT '',error TEXT DEFAULT '',created TEXT,UNIQUE(taskId,url));
  CREATE TABLE IF NOT EXISTS document_sources(taskId TEXT,url TEXT,title TEXT,text TEXT,PRIMARY KEY(taskId,url));
  CREATE TABLE IF NOT EXISTS materials(taskId TEXT,titleKey TEXT,title TEXT,kind TEXT,year INTEGER,documentId TEXT,sourceUrl TEXT,quote TEXT,awardVerified INTEGER DEFAULT 0,PRIMARY KEY(taskId,titleKey));
  UPDATE documents SET state='interrupted',error='下载或解析中断，需显式重试' WHERE state IN ('downloading','parsing');
 `);}
 owned(ctx:RunContext,id:string):any{const d=this.store.db.prepare('SELECT * FROM documents WHERE id=? AND taskId=?').get(id,ctx.task.id);if(!d)throw new Error('本任务没有该文档');return d;}
 async intact(ctx:RunContext,d:any){if(!d.path)return false;try{const b=await fs.readFile(await safePath(ctx.task.workspace,d.path));if(hash(b)!==d.hash)return false;if(d.textPath){const t=await fs.readFile(await safePath(ctx.task.workspace,d.textPath));if(hash(t)!==d.textFileHash)return false;}return true;}catch{return false;}}
 goal(ctx:RunContext){const o=JSON.parse(ctx.task.options||'{}'),current=o.currentPrompt||ctx.task.prompt,direct=inferCollectionGoal(current);if(direct)return direct;if(o.currentPrompt&&/继续|接着|原任务|补齐|剩余|还差|再找|再下载|重试|剩下|重新|再采集/.test(current))return inferCollectionGoal(ctx.task.prompt);if(o.currentPrompt&&/只要|只需|不需要全文|不要全文/.test(current))return inferCollectionGoal(ctx.task.prompt+'\n'+current);return null;}
 async guard(signal:AbortSignal){const cache=new Map<string,any>();return async(url:string)=>{const u=new URL(url);if(!cache.has(u.origin)){let text='';try{text=(await this.download(u.origin+'/robots.txt',signal,1_000_000)).bytes.toString('utf8');}catch(e){if(!/HTTP 404|HTTP 410/.test(String(e)))throw e;}cache.set(u.origin,robotsParser(u.origin+'/robots.txt',text));}if(cache.get(u.origin).isAllowed(url,'LocalAgent')===false)throw new Error('robots.txt 不允许获取此文档');};}
 candidates(bytes:Buffer,url:string){const $=load(bytes.toString('utf8')),title=$('title').first().text();$('script,style,nav,footer,header').remove();const text=$('body').text().replace(/\s+/g,' ').trim().slice(0,60000);
  const links:any[]=[];for(const el of $('a[href]').toArray()){const a=$(el),href=a.attr('href')||'',label=a.text().trim();if(!/\.(pdf|docx?)(?:[?#]|$)|download|附件|全文|报告下载/i.test(href+' '+label))continue;try{const u=new URL(href,url);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!links.some(l=>l.url===u.href))links.push({url:u.href,title:label.slice(0,200)});}catch{}if(links.length>=60)break;}
  return {url,title,text,links};
 }
 async discover(ctx:RunContext,url:string){const guard=await this.guard(ctx.signal),r=await this.download(url,ctx.signal,1_000_000,guard);if(!/html|text/.test(r.type))throw new Error('这是文件链接，请 document_collect 下载');const page=this.candidates(r.bytes,r.url);this.store.db.prepare('INSERT OR REPLACE INTO document_sources VALUES(?,?,?,?)').run(ctx.task.id,page.url,page.title,page.text);return {...page,text:page.text.slice(0,8000),note:'候选链接不算已取得文档；继续 document_collect 验证格式并保存文件。'};}
 async collect(ctx:RunContext,urls:string[],sourceUrl='',engine='system'){
  if(ctx.stage)throw new Error('受控只读阶段不能下载文档');if(!Array.isArray(urls)||!urls.length||urls.length>8||urls.some(u=>typeof u!=='string'))throw new Error('每批提供1–8个公开文档URL');
  const guard=await this.guard(ctx.signal),items:any[]=[];
  for(const url of [...new Set(urls)]){ctx.signal.throwIfAborted();let d:any=this.store.db.prepare('SELECT * FROM documents WHERE taskId=? AND url=?').get(ctx.task.id,url);
   if(d?.state==='parsed'&&await this.intact(ctx,d)){items.push(this.brief(d));continue;}
   if(!d){const budget=this.store.db.prepare('SELECT COUNT(*) n,SUM(bytes) bytes FROM documents WHERE taskId=?').get(ctx.task.id) as any;if(budget.n>=40||budget.bytes>=200_000_000)throw new Error('每任务最多40个文档、合计200 MB');d={id:randomUUID()};this.store.db.prepare('INSERT INTO documents(id,taskId,url,sourceUrl,state,created) VALUES(?,?,?,?,?,?)').run(d.id,ctx.task.id,url,sourceUrl,'downloading',new Date().toISOString());}
   try{
    ctx.emit('document_progress',engine,{id:d.id,url,state:'downloading'});const reuse=d.path&&await this.intact(ctx,d);const r=reuse?{url:d.finalUrl,type:'',bytes:await fs.readFile(await safePath(ctx.task.workspace,d.path))}:await this.download(url,ctx.signal,20_000_000,guard),kind=documentKind(r.bytes);
    if(!kind){if(/html|text/.test(r.type)){if(r.bytes.length>1_000_000)throw new Error('来源页超过1 MB，请使用更具体的附件链接');const page=this.candidates(r.bytes,r.url);this.store.db.prepare('INSERT OR REPLACE INTO document_sources VALUES(?,?,?,?)').run(ctx.task.id,page.url,page.title,page.text);this.store.db.prepare("UPDATE documents SET state='webpage',error=? WHERE id=?").run('实际为网页，不是PDF或Word；应继续寻找附件',d.id);items.push({id:d.id,state:'webpage',url:r.url,candidates:page.links});continue;}throw new Error('文件不是有效PDF/Word；扩展名或响应类型不能替代真实文件格式');}
    const digest=hash(r.bytes),duplicate:any=this.store.db.prepare("SELECT * FROM documents WHERE taskId=? AND hash=? AND path<>'' AND id<>? LIMIT 1").get(ctx.task.id,digest,d.id);
    if(duplicate&&await this.intact(ctx,duplicate)){this.store.db.prepare("UPDATE documents SET state='duplicate',duplicateOf=?,hash=?,finalUrl=? WHERE id=?").run(duplicate.id,digest,r.url,d.id);items.push(this.brief(this.owned(ctx,d.id)));continue;}
    const used:any=this.store.db.prepare('SELECT COALESCE(SUM(bytes),0) n FROM documents WHERE taskId=?').get(ctx.task.id);if(used.n-(d.bytes||0)+r.bytes.length>200_000_000)throw new Error('文档总大小超过200 MB');
    let stem='文档';try{stem=decodeURIComponent(new URL(r.url).pathname.split('/').at(-1)||'文档').replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N} _-]/gu,'_').slice(0,48)||'文档';}catch{}
    const name=path.posix.join('documents',stem+'-'+d.id+'.'+kind),p=await safePath(ctx.task.workspace,name);await fs.mkdir(path.dirname(p),{recursive:true});await safePath(ctx.task.workspace,p);await fs.writeFile(p,r.bytes,{signal:ctx.signal});
    this.store.db.prepare("UPDATE documents SET state='parsing',kind=?,path=?,hash=?,bytes=?,finalUrl=?,error='',complete=0,textPath='',textHash='',textFileHash='',characters=0,signals=0 WHERE id=?").run(kind,name,digest,r.bytes.length,r.url,d.id);ctx.emit('artifact',engine,{path:name,bytes:r.bytes.length});ctx.emit('document_progress',engine,{id:d.id,state:'parsing'});
    const parsed=await this.parse(p,kind,ctx.signal),text=String(parsed.text||''),textPath=name.replace(/\.[^.]+$/,'.txt'),textHash=hash(evidenceText(text.replace(/\[第 \d+ 页\]/g,''))),textFileHash=hash(text),complete=!!text.trim()&&!parsed.truncated&&!(parsed.emptyPages?.length);
    await fs.writeFile(await safePath(ctx.task.workspace,textPath),text,{signal:ctx.signal});ctx.emit('artifact',engine,{path:textPath,bytes:Buffer.byteLength(text)});
    const same:any=this.store.db.prepare("SELECT id FROM documents WHERE taskId=? AND textHash=? AND state='parsed' AND id<>?").get(ctx.task.id,textHash,d.id);
    this.store.db.prepare("UPDATE documents SET state='parsed',textPath=?,textHash=?,textFileHash=?,pages=?,complete=?,signals=?,characters=?,duplicateOf=?,error=? WHERE id=?").run(textPath,textHash,textFileHash,parsed.pages??null,Number(complete),reportSignals(text),text.length,same?.id||'',complete?'':'正文不完整：扫描页需OCR或提取达到上限，不计入已核验全文',d.id);
    items.push(this.brief(this.owned(ctx,d.id)));
   }catch(e){if(ctx.signal.aborted){this.store.db.prepare("UPDATE documents SET state='interrupted',error='用户停止或任务中断' WHERE id=?").run(d.id);await this.status(ctx);throw ctx.signal.reason;}this.store.db.prepare("UPDATE documents SET state='failed',error=? WHERE id=?").run(String(e).slice(0,1000),d.id);items.push(this.brief(this.owned(ctx,d.id)));}
   ctx.emit('document_progress',engine,items.at(-1));
  }
  await this.export(ctx,engine);return {items,progress:await this.status(ctx),note:'成功下载或正文提取尚不等于符合题目。读取后用 material_record 登记真实题名、年份与类别。'};
 }
 brief(d:any){return {id:d.id,url:d.finalUrl||d.url,state:d.state,kind:d.kind,path:d.path,textPath:d.textPath,bytes:d.bytes,pages:d.pages,characters:d.characters,complete:!!d.complete,reportSignals:d.signals,duplicateOf:d.duplicateOf,error:d.error};}
 async read(ctx:RunContext,id:string,offset=0){const d=this.owned(ctx,id);if(d.state!=='parsed'||!d.textPath||!await this.intact(ctx,d))throw new Error('正文尚未提取或文件已被修改/删除');if(!Number.isInteger(offset)||offset<0)throw new Error('正文偏移无效');const text=await fs.readFile(await safePath(ctx.task.workspace,d.textPath),'utf8');return {...this.brief(d),text:text.slice(offset,offset+8000),total:text.length,nextOffset:offset+8000<text.length?offset+8000:null};}
 async search(ctx:RunContext,id:string,query:string,offset=0){
  const d=this.owned(ctx,id);if(d.state!=='parsed'||!d.textPath||!await this.intact(ctx,d))throw new Error('正文尚未提取或文件已被修改/删除');
  if(typeof query!=='string'||!query.trim()||query.length>300||!Number.isInteger(offset)||offset<0)throw new Error('提供1–300字符的关键词和非负偏移');
  const text=await fs.readFile(await safePath(ctx.task.workspace,d.textPath),'utf8'),lower=text.toLowerCase();
  const terms=[...new Set(query.toLowerCase().split('|').map(t=>t.trim()).filter(Boolean))];if(terms.length>8)throw new Error('一次最多8个关键词，用 | 分隔；不是正则表达式');
  const hits:any[]=[];let cursor=offset;
  while(hits.length<8&&cursor<text.length){const positions=terms.map(t=>lower.indexOf(t,cursor)).filter(n=>n>=0);if(!positions.length)break;const at=Math.min(...positions),start=Math.max(0,at-250),end=Math.min(text.length,at+850),page=[...text.slice(0,at).matchAll(/\[第 (\d+) 页\]/g)].at(-1)?.[1];hits.push({offset:start,page:page?Number(page):null,text:text.slice(start,end)});cursor=end;}
  return {id:d.id,url:d.finalUrl||d.url,path:d.path,textPath:d.textPath,hits,total:text.length,nextOffset:hits.length===8&&cursor<text.length?cursor:null,note:'仅为实际命中的局部正文，不代表全文已读；page为提取器物理PDF页序，缺失时使用原文章节定位。'};
 }
 async source(ctx:RunContext,url:string){const own:any=this.store.db.prepare('SELECT text FROM document_sources WHERE taskId=? AND url=?').get(ctx.task.id,url);if(own)return own.text;
  let text='';for(const e of this.store.events(ctx.task.id))if(e.type==='tool_done'&&['web_read','fetch_url','crawl_read'].includes(e.data.name)&&e.data.result?.url===url)text+='\n'+e.data.result.text;return text;
 }
 async record(ctx:RunContext,items:any[],engine:string){if(ctx.stage)throw new Error('受控阶段不能登记交付材料');if(!Array.isArray(items)||!items.length||items.length>20)throw new Error('每次登记1–20项材料');const results:any[]=[];
  for(const item of items){ctx.signal.throwIfAborted();try{
   if(typeof item.title!=='string'||item.title.length<4||item.title.length>500||!['title','award','fulltext'].includes(item.kind)||typeof item.quote!=='string'||item.quote.length<8||item.quote.length>1500)throw new Error('材料须有真实题名、类别和8–1500字原文摘录');
   let text='',d:any;const goal=this.goal(ctx);if(item.documentId){d=this.owned(ctx,item.documentId);if(d.duplicateOf)d=this.owned(ctx,d.duplicateOf);if(!await this.intact(ctx,d))throw new Error('文档不存在或已修改');if(d.textPath)text=await fs.readFile(await safePath(ctx.task.workspace,d.textPath),'utf8');}
   if(item.sourceUrl)text+='\n'+await this.source(ctx,item.sourceUrl);
   const normalized=evidenceText(text);if(!normalized.includes(evidenceText(item.quote))||!evidenceText(item.quote).includes(evidenceText(item.title)))throw new Error('题名与摘录须对应本任务实际取得的原文，搜索标题或模型记忆不能充数');
   if(item.kind==='award'&&!/获奖|一等奖|二等奖|三等奖|金奖|银奖|award|winner|prize/i.test(item.quote))throw new Error('获奖核验须提供含奖项的原文摘录');
   if(item.year!==undefined&&(!Number.isInteger(item.year)||item.year<1900||item.year>2100||typeof item.yearQuote!=='string'||item.yearQuote.length>600||!item.yearQuote.includes(String(item.year))||!normalized.includes(evidenceText(item.yearQuote))))throw new Error('年份须有本任务原文中的证据，不能仅凭文件名推断');
   if(goal?.years.length&&!goal.years.includes(item.year))throw new Error('材料年份不在用户要求范围内，或缺少年份证据');
   const awardVerified=item.kind==='award'||typeof item.awardQuote==='string'&&item.awardQuote.length<=1500&&normalized.includes(evidenceText(item.awardQuote))&&evidenceText(item.awardQuote).includes(evidenceText(item.title))&&/获奖|一等奖|二等奖|三等奖|金奖|银奖|award|winner|prize/i.test(item.awardQuote);
   if(item.kind==='fulltext'&&goal?.award&&!awardVerified)throw new Error('获奖报告全文还须有包含本作品题名与奖项的真实来源摘录');
   if(item.kind==='fulltext'&&(!d||d.state!=='parsed'||!d.complete||d.duplicateOf||goal?.report&&(d.characters<1500||d.signals<3)))throw new Error('全文须有真实文件、完整提取正文；作品报告须包含足够正文及至少三类报告结构，获奖通知或名单不能充数');
   const key=evidenceText(item.title),existing:any=this.store.db.prepare('SELECT * FROM materials WHERE taskId=? AND titleKey=?').get(ctx.task.id,key),levels:any={title:1,award:2,fulltext:3};
   if(existing&&levels[existing.kind]>levels[item.kind]){results.push({title:item.title,recorded:true,reused:true});continue;}
   this.store.db.prepare('INSERT OR REPLACE INTO materials VALUES(?,?,?,?,?,?,?,?,?)').run(ctx.task.id,key,item.title,item.kind,item.year??null,d?.id||'',item.sourceUrl||d?.finalUrl||'',item.quote,Number(awardVerified||existing?.awardVerified||false));results.push({title:item.title,recorded:true});
  }catch(e){results.push({title:item?.title,recorded:false,error:String(e)});}}
  await this.export(ctx,engine);return {items:results,progress:await this.status(ctx)};
 }
 async status(ctx:RunContext){const goal=this.goal(ctx),all=this.store.db.prepare('SELECT * FROM materials WHERE taskId=?').all(ctx.task.id) as any[],materials=all.filter(m=>!goal?.years.length||goal.years.includes(m.year)),unique=new Set<string>();let awards=0;
  for(const m of materials){if(m.awardVerified)awards++;if(m.kind==='fulltext'){const d=this.owned(ctx,m.documentId);if(d.state==='parsed'&&d.complete&&(!goal?.award||m.awardVerified)&&(!goal?.report||d.characters>=1500&&d.signals>=3)&&await this.intact(ctx,d))unique.add(d.textHash);}}
  const docs=this.store.db.prepare('SELECT * FROM documents WHERE taskId=? ORDER BY created').all(ctx.task.id) as any[];
  const progress={goal,titles:materials.length,awards,fulltexts:unique.size,remaining:goal?Math.max(0,goal.target-(goal.fulltext?unique.size:goal.award?awards:materials.length)):null,downloaded:docs.filter(d=>d.path).length,failed:docs.filter(d=>d.state==='failed').length,documents:docs.map(d=>this.brief(d)),materials:materials.map(({quote,...m})=>m)};
  ctx.emit('collection_progress','system',{...progress,documents:undefined,materials:undefined});return progress;
 }
 async assertComplete(ctx:RunContext,files:string[]){const p=await this.status(ctx);if(!p.goal)return;if(p.remaining)throw new Error(`目标尚未满足：已登记名称${p.titles}项、核实获奖${p.awards}项、取得去重全文${p.fulltexts}/${p.goal.target}份。新闻与目录不能代替报告全文；请继续取得材料或 outcome=blocked 如实交付缺口。`);
  if(p.goal.fulltext){
   if(!files.map(f=>f.replaceAll('\\','/')).includes('documents/manifest.json'))throw new Error('全文交付须包含 documents/manifest.json，并提供已登记的原文件下载');
   const manifest=JSON.parse(await fs.readFile(await safePath(ctx.task.workspace,'documents/manifest.json'),'utf8'));
   const expected={documents:this.store.db.prepare('SELECT * FROM documents WHERE taskId=? ORDER BY created').all(ctx.task.id),materials:this.store.db.prepare('SELECT * FROM materials WHERE taskId=?').all(ctx.task.id)};
   if(JSON.stringify(manifest)!==JSON.stringify(expected))throw new Error('文档清单被修改或已过期，请重新登记材料生成实际清单，不能交付伪造的文件目录');
  }
 }
 async export(ctx:RunContext,engine:string){ctx.signal.throwIfAborted();const docs=this.store.db.prepare('SELECT * FROM documents WHERE taskId=? ORDER BY created').all(ctx.task.id),materials=this.store.db.prepare('SELECT * FROM materials WHERE taskId=?').all(ctx.task.id) as any[];const dir=await safePath(ctx.task.workspace,'documents');await fs.mkdir(dir,{recursive:true});
  const escape=(s:any)=>'"'+String(s??'').replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';
  for(const [name,text] of [['manifest.json',JSON.stringify({documents:docs,materials},null,2)],['materials.csv','title,kind,year,sourceUrl,documentId\r\n'+materials.map(m=>[m.title,m.kind,m.year,m.sourceUrl,m.documentId].map(escape).join(',')).join('\r\n')]]){const relative='documents/'+name;await fs.writeFile(await safePath(ctx.task.workspace,relative),text,{signal:ctx.signal});ctx.emit('artifact',engine,{path:relative,bytes:Buffer.byteLength(text)});}
 }
}
