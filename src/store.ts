import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Task, EventRecord, Engine } from './config.ts';

export class Store {
  db: DatabaseSync;
  directory:string;
  constructor(dir: string) {
    this.directory=path.resolve(dir);
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'agent.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT,prompt TEXT,engine TEXT,workspace TEXT,status TEXT,created TEXT,updated TEXT,result TEXT DEFAULT '',error TEXT DEFAULT '',session TEXT DEFAULT '');
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,taskId TEXT NOT NULL,type TEXT,engine TEXT,data TEXT,created TEXT);
      CREATE INDEX IF NOT EXISTS event_task ON events(taskId,id);
      CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,text TEXT,created TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(id UNINDEXED,text,tokenize='trigram');
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,taskId TEXT,name TEXT,args TEXT,status TEXT,result TEXT,created TEXT);
      CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY,taskId TEXT,action TEXT,detail TEXT,status TEXT,created TEXT);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
    `);
    if(!(this.db.prepare('PRAGMA table_info(tasks)').all() as any[]).some(c=>c.name==='options'))this.db.exec("ALTER TABLE tasks ADD COLUMN options TEXT NOT NULL DEFAULT '{}'");
    if(!(this.db.prepare('PRAGMA table_info(tasks)').all() as any[]).some(c=>c.name==='archived'))this.db.exec('ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
    const stale = this.list().filter(t => ['running','waiting','cancelling'].includes(t.status));
    for (const t of stale) { this.update(t.id, { status: 'interrupted', error: '应用上次退出时任务尚未完成，请检查成果后继续。' }); this.event(t.id,'status','system',{status:'interrupted'}); }
  }
  create(prompt: string, engine: Engine, workspace: string): Task {
    const id = randomUUID(), now = new Date().toISOString();
    this.db.prepare('INSERT INTO tasks(id,title,prompt,engine,workspace,status,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(id,prompt.slice(0,48),prompt,engine,workspace,'queued',now,now);
    return this.get(id)!;
  }
  get(id: string): Task | undefined { return this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as unknown as Task | undefined; }
  list(): Task[] { return this.db.prepare('SELECT * FROM tasks ORDER BY created DESC LIMIT 200').all() as unknown as Task[]; }
  update(id: string, patch: Partial<Task>) {
    const allowed = ['prompt','status','result','error','session','options','archived','engine'];
    const keys = Object.keys(patch).filter(k => allowed.includes(k));
    if (!keys.length) return;
    this.db.prepare(`UPDATE tasks SET ${keys.map(k => k+'=?').join(',')},updated=? WHERE id=?`).run(...keys.map(k => String(patch[k as keyof Task] ?? '')),new Date().toISOString(),id);
  }
  archive(id:string,archived:boolean){const t=this.get(id);if(!t)throw new Error('任务不存在');if(['queued','running','waiting','cancelling'].includes(t.status))throw new Error('请先停止任务后再归档');this.update(id,{archived:archived?1:0});}
  event(taskId: string, type: string, engine: string, data: any): EventRecord {
    const created = new Date().toISOString();
    const r = this.db.prepare('INSERT INTO events(taskId,type,engine,data,created) VALUES(?,?,?,?,?)').run(taskId,type,engine,JSON.stringify(data),created);
    return { id: Number(r.lastInsertRowid), taskId, type, engine, data, created };
  }
  events(taskId: string, after = 0): EventRecord[] {
    return this.db.prepare('SELECT * FROM events WHERE taskId=? AND id>? ORDER BY id').all(taskId,after).map((r: any) => ({ ...r, data: JSON.parse(r.data) })) as EventRecord[];
  }
  setting(key: string, fallback: any): any { const r = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as any; return r ? JSON.parse(r.value) : fallback; }
  setSetting(key: string, value: any) { this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value)); }
  memories(query = ''): any[] {
    if (query.trim().length >= 3) {
      try { return this.db.prepare('SELECT m.* FROM memories m JOIN memory_search f ON m.id=f.id WHERE memory_search MATCH ? LIMIT 12').all('"'+query.replaceAll('"','""')+'"'); } catch { return []; }
    }
    return this.db.prepare('SELECT * FROM memories ORDER BY created DESC LIMIT 50').all();
  }
  remember(text: string) {
    const id = randomUUID(), created = new Date().toISOString();
    this.db.exec('BEGIN');
    try { this.db.prepare('INSERT INTO memories VALUES(?,?,?)').run(id,text,created); this.db.prepare('INSERT INTO memory_search VALUES(?,?)').run(id,text); this.db.exec('COMMIT'); } catch(e) { this.db.exec('ROLLBACK'); throw e; }
    return {id,text,created};
  }
  forget(id: string) { this.db.prepare('DELETE FROM memories WHERE id=?').run(id); this.db.prepare('DELETE FROM memory_search WHERE id=?').run(id);if(this.db.prepare("SELECT name FROM sqlite_master WHERE name='vectors'").get())this.db.prepare("DELETE FROM vectors WHERE source=? AND scope='memory'").run(id); }
  close() { this.db.close(); }
}
