import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../src/store.ts';
import {Retrieval,chunks,cosine} from '../src/retrieval.ts';
import {validateProfiles} from '../src/profiles.ts';
import {Desktop} from '../src/desktop.ts';

test('混合检索按任务隔离，索引失败保留旧版本，删除记忆同步删除向量',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'agent-vector-')),store=new Store(dir),r=new Retrieval(store);
 r.embed=async text=>text.includes('猫')?[1,0,0,0,0,0,0,0]:[0,1,0,0,0,0,0,0];
 try{const m=store.remember('猫喜欢玩毛线球');await r.index(m.id,'memory',m.text);await r.index('secret.txt','task:other','另一任务的秘密');
  const result=await r.search('宠物猫');assert.equal(result.mode,'hybrid');assert.equal(result.hits[0].source,m.id);assert(!result.hits.some(h=>h.scope==='task:other'));
  r.embed=async()=>{throw new Error('offline');};await assert.rejects(r.index(m.id,'memory','更新内容'),/offline/);
  const fallback=await r.search('毛线球','memory');assert.equal(fallback.mode,'fulltext');assert(fallback.warning);assert.equal(fallback.hits[0].text,m.text);
  store.forget(m.id);assert.equal((store.db.prepare("SELECT count(*) n FROM vectors WHERE scope='memory'").get() as any).n,0);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('向量维度不混用，分块保留重叠且不会截断 Unicode',()=>{
 assert.equal(cosine([1,0],[1,0]),1);assert.equal(cosine([1,0],[1,0,0]),0);assert.equal(cosine([0,0],[1,0]),0);
 const input='猫😀'.repeat(1000),parts=chunks(input);assert(parts.length>1);assert(!parts.some(p=>p.includes('\uFFFD')));assert(parts[0].endsWith(Array.from(parts[1]).slice(0,120).join('')));
});
test('模型配置拒绝虚构强度，自动模式保留三个独立执行器配置',async()=>{
 const desktop=new Desktop();desktop.models=async()=>({models:[{id:'real-model',efforts:['low','high'],isDefault:true}],error:''});
 const p=await validateProfiles({codex:{effort:'high'},harness:{effort:'off'},qwen:{effort:'none'}},desktop);assert.equal(p.codex.model,'real-model');assert.equal(p.qwen.effort,'none');
 await assert.rejects(validateProfiles({codex:{model:'fake'}},desktop),/不可用/);await assert.rejects(validateProfiles({qwen:{effort:'xhigh'}},desktop),/不支持/);
});
test('桌面写入审批被拒绝时不启动调用，未知工具不能越过清单',async()=>{
 const d=new Desktop();d.status=async()=>({error:'',apps:[{id:'id',enabled:true,callable:true}],servers:[{name:'codex_apps',tools:[{name:'write',connectorId:'id',readOnly:false}]}]});let connected=false;d.connect=async()=>{connected=true;throw new Error('不得启动');};
 const ctx:any={signal:new AbortController().signal,task:{workspace:os.tmpdir()}};
 await assert.rejects(d.call(ctx,'codex_apps','write',{},async()=>false),/拒绝/);assert.equal(connected,false);
 await assert.rejects(d.call(ctx,'codex_apps','unknown',{},async()=>true),/不允许/);assert.equal(connected,false);
});
