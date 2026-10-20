import { createHash, randomUUID } from 'node:crypto';
import { config, errorText } from './config.ts';
import type { Store } from './store.ts';

export function chunks(text:string,size=900,overlap=120){
  const points=Array.from(text.replace(/\r\n/g,'\n')),out:string[]=[];
  for(let i=0;i<points.length;i+=size-overlap){const part=points.slice(i,i+size).join('').trim();if(part)out.push(part);if(i+size>=points.length)break;}
  return out;
}
export function cosine(a:number[],b:number[]){if(a.length!==b.length||!a.length)return 0;let dot=0,x=0,y=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];x+=a[i]**2;y+=b[i]**2;}return x&&y?dot/Math.sqrt(x*y):0;}
export class Retrieval {
  store:Store; tail:Promise<any>=Promise.resolve(); lastError='';
  constructor(store:Store){this.store=store;store.db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge(id TEXT PRIMARY KEY,title TEXT,text TEXT,created TEXT);
    CREATE TABLE IF NOT EXISTS vectors(id TEXT PRIMARY KEY,source TEXT,scope TEXT,part INTEGER,text TEXT,hash TEXT,model TEXT,dimensions INTEGER,embedding TEXT);
    CREATE INDEX IF NOT EXISTS vectors_source ON vectors(source,scope);
  `);}
  model(){return this.store.setting('embeddingModel',config.embeddingModel) as string;}
  async keepEmbedding(model:string,signal?:AbortSignal){
    // 本机 LM Studio 的手动加载不会触发 JIT 互斥淘汰，避免检索卸载 Qwen。
    if(new URL(config.qwenBase).hostname!=='127.0.0.1')return;
    const base=new URL(config.qwenBase).origin,timeout=signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000);
    const response=await fetch(base+'/api/v1/models',{signal:timeout});if(response.status===404)return;if(!response.ok)throw new Error('无法检查本地 embedding 运行状态');
    const data:any=await response.json(),entry=data.models?.find((m:any)=>m.key===model);
    if(entry?.type==='embedding'&&!entry.loaded_instances?.length){const loaded=await fetch(base+'/api/v1/models/load',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,context_length:2048}),signal:timeout});if(!loaded.ok)throw new Error('Embedding 模型加载失败：HTTP '+loaded.status);await loaded.body?.cancel();}
  }
  status(){return {model:this.model(),backend:config.qwenBase,documents:this.store.db.prepare('SELECT id,title,created,length(text) AS characters FROM knowledge ORDER BY created DESC').all(),chunks:(this.store.db.prepare('SELECT count(*) AS n FROM vectors WHERE model=?').get(this.model()) as any).n,error:this.lastError};}
  // 串行向量请求，避免同时索引/搜索占用本机推理资源。
  async embed(text:string,kind:'query'|'document',signal?:AbortSignal):Promise<number[]>{
    const model=this.model();
    const operation=async()=>{signal?.throwIfAborted();await this.keepEmbedding(model,signal);const r=await fetch(config.qwenBase+'/embeddings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,input:(model.includes('nomic')?(kind==='query'?'search_query: ':'search_document: '):'')+text}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)});if(!r.ok)throw new Error('Embedding API HTTP '+r.status);const data:any=await r.json(),v=data.data?.[0]?.embedding;if(!Array.isArray(v)||v.length<8||v.length>8192||v.some(n=>typeof n!=='number'||!Number.isFinite(n)))throw new Error('Embedding 返回了无效向量');this.lastError='';return v as number[];};
    const p=this.tail.then(operation,operation);this.tail=p.catch(()=>{});return p;
  }
  async index(source:string,scope:string,text:string,signal?:AbortSignal){
    const model=this.model(),parts=chunks(text);if(parts.length>260)throw new Error('单篇资料最多约 20 万字，请分段导入');
    const records=[];
    for(let part=0;part<parts.length;part++){signal?.throwIfAborted();const hash=createHash('sha256').update(parts[part]).digest('hex');const cached=this.store.db.prepare('SELECT embedding,dimensions FROM vectors WHERE model=? AND hash=? LIMIT 1').get(model,hash) as any;
      const v=cached?JSON.parse(cached.embedding):await this.embed(parts[part],'document',signal);records.push({part,text:parts[part],hash,v});}
    // 全部成功后原子替换；失败保留旧索引。
    if(scope==='memory'&&!this.store.db.prepare('SELECT id FROM memories WHERE id=?').get(source))throw new Error('记忆已被删除，停止写入向量');
    this.store.db.exec('BEGIN');try{this.store.db.prepare('DELETE FROM vectors WHERE source=? AND scope=?').run(source,scope);const q=this.store.db.prepare('INSERT INTO vectors VALUES(?,?,?,?,?,?,?,?,?)');for(const r of records)q.run(randomUUID(),source,scope,r.part,r.text,r.hash,model,r.v.length,JSON.stringify(r.v));this.store.db.exec('COMMIT');}catch(e){this.store.db.exec('ROLLBACK');throw e;}
    return {source,scope,chunks:records.length,model,dimensions:records[0]?.v.length||0};
  }
  async add(title:string,text:string){const id=randomUUID(),created=new Date().toISOString();const indexed=await this.index(id,'knowledge',text);this.store.db.prepare('INSERT INTO knowledge VALUES(?,?,?,?)').run(id,title,text,created);return {id,title,created,...indexed};}
  remove(id:string){this.store.db.prepare('DELETE FROM knowledge WHERE id=?').run(id);this.store.db.prepare("DELETE FROM vectors WHERE source=? AND scope='knowledge'").run(id);}
  async reindex(){let count=0;for(const m of this.store.db.prepare('SELECT * FROM memories').all() as any[]){await this.index(m.id,'memory',m.text);count++;}for(const d of this.store.db.prepare('SELECT * FROM knowledge').all() as any[]){await this.index(d.id,'knowledge',d.text);count++;}return {count,...this.status()};}
  async search(query:string,scope='all',taskId='',signal?:AbortSignal){
    if(!query.trim())return {mode:'recent',hits:scope==='memory'?this.store.memories().map(m=>({...m,scope:'memory'})):[],warning:''};
    const scopes=scope==='memory'?['memory']:scope==='task'?['task:'+taskId]:['memory','knowledge',...(taskId?['task:'+taskId]:[])];
    const rows=this.store.db.prepare(`SELECT * FROM vectors WHERE scope IN (${scopes.map(()=>'?').join(',')}) AND model=? AND (scope NOT IN ('memory','knowledge') OR scope='memory' AND EXISTS(SELECT 1 FROM memories WHERE memories.id=vectors.source) OR scope='knowledge' AND EXISTS(SELECT 1 FROM knowledge WHERE knowledge.id=vectors.source))`).all(...scopes,this.model()) as any[];
    // 未建向量的记忆仍可全文命中，不会静默丢失。
    const candidates=[...rows.map(r=>({...r,vector:JSON.parse(r.embedding)}))];
    if(scopes.includes('memory'))for(const m of this.store.db.prepare('SELECT * FROM memories').all() as any[])if(!rows.some(r=>r.source===m.id&&r.scope==='memory'))candidates.push({id:m.id,source:m.id,scope:'memory',part:0,text:m.text,vector:null});
    if(scopes.includes('knowledge'))for(const d of this.store.db.prepare('SELECT * FROM knowledge').all() as any[])if(!rows.some(r=>r.source===d.id&&r.scope==='knowledge'))for(const [part,text] of chunks(d.text).entries())candidates.push({id:d.id+':'+part,source:d.id,scope:'knowledge',part,text,vector:null});
    if(!candidates.length)return {mode:'empty',hits:[],warning:''};
    let vector:number[]|undefined,warning='';
    if(rows.length)try{vector=await this.embed(query.slice(0,1800),'query',signal);}catch(e){if(signal?.aborted)throw e;warning='向量服务不可用，已使用全文匹配：'+errorText(e);this.lastError=warning;}
    const tokens=[...new Set(query.toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]{1,2}/gu)||[])];
    const lex=candidates.map(r=>({...r,lex:tokens.filter(t=>r.text.toLowerCase().includes(t)).length/Math.max(1,tokens.length)})).sort((a,b)=>b.lex-a.lex);
    const semantic=vector?candidates.filter(r=>r.vector?.length===vector!.length).map(r=>({...r,similarity:cosine(vector!,r.vector)})).sort((a,b)=>b.similarity-a.similarity):[];
    const rank=new Map<string,any>();
    for(const [i,r] of lex.filter(r=>r.lex>0).entries())rank.set(r.id,{...r,score:1/(60+i+1)});
    for(const [i,r] of semantic.entries()){const old=rank.get(r.id);rank.set(r.id,{...r,score:(old?.score||0)+1/(60+i+1)});}
    const titles=new Map((this.store.db.prepare('SELECT id,title FROM knowledge').all() as any[]).map(d=>[d.id,d.title]));
    return {mode:vector?'hybrid':'fulltext',model:vector?this.model():null,warning,hits:[...rank.values()].sort((a,b)=>b.score-a.score).slice(0,8).map(r=>({id:r.id,source:r.source,scope:r.scope,part:r.part,text:r.text,title:titles.get(r.source)||r.source,score:r.score,similarity:r.similarity}))};
  }
}
