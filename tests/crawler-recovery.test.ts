import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.ts';
import {CrawlService} from '../src/crawler.ts';
import {safeToHandoff} from '../src/supervisor.ts';
test('采集启动调用尚未返回时崩溃，按已落盘job关联中断，不伪造成功或重放未知写入',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-crawl-recovery-'));let store=new Store(dir);
 try{new CrawlService(store);const task=store.create('爬取资料','auto',dir),now=new Date().toISOString();
  store.event(task.id,'tool_start','harness',{id:'operation',name:'crawl_start',args:{urls:['https://example.com/']}});
  store.event(task.id,'crawl_start','harness',{jobId:'job',urls:['https://example.com/']});
  store.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?)').run('operation',task.id,'crawl_start','{}','running','',now);
  store.db.prepare('INSERT INTO crawl_jobs(id,taskId,turnId,key,options,status,created,updated) VALUES(?,?,?,?,?,?,?,?)').run('job',task.id,task.id,'key','{"urls":["https://example.com/"]}','running',now,now);
  store.close();store=new Store(dir);new CrawlService(store);
  assert.equal((store.db.prepare('SELECT status FROM operations WHERE id=?').get('operation') as any).status,'interrupted');
  const events=store.events(task.id);assert(events.some(e=>e.type==='crawl_interrupted'&&e.data.operationId==='operation'));assert(!events.some(e=>e.type==='tool_done'));assert(safeToHandoff(events));
  assert(!safeToHandoff([...events,{type:'tool_start',data:{id:'write',name:'write_file'}}]));
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
