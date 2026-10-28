import {DatabaseSync} from 'node:sqlite';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/store.ts';
import {Tools} from '../src/tools.ts';
const dir=path.resolve('acceptance/naming-runtime'),workspace=path.join(dir,'workspace');await mkdir(workspace,{recursive:true});const source=new DatabaseSync('data/agent.sqlite',{readOnly:true}),store=new Store(dir);new Tools(store);
try{
 const original=source.prepare('SELECT id,workspace FROM tasks ORDER BY created DESC LIMIT 1').get() as any;
 const task=store.create('Task: Microsoft and Apple — Annual Report Data Extraction Demo\nCompare FY2025 reports.','auto',workspace);
 store.update(task.id,{status:'succeeded',result:'命名界面验收：这是已有文件副本，用于检查名称、下载和重命名，未调用模型。'});
 for(const name of ['company_comparison.csv','research_brief.md','execution_notes.md'])await copyFile(path.join(original.workspace,name),path.join(workspace,name));
 const docs=source.prepare("SELECT * FROM documents WHERE taskId=? AND state='parsed'").all(original.id) as any[];
 for(const doc of docs){for(const name of [doc.path,doc.textPath]){await mkdir(path.dirname(path.join(workspace,name)),{recursive:true});await copyFile(path.join(original.workspace,name),path.join(workspace,name));}doc.taskId=task.id;const keys=Object.keys(doc);store.db.prepare(`INSERT INTO documents(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>doc[k]));}
 await writeFile('acceptance/naming-seed.json',JSON.stringify({taskId:task.id,workspace}));console.log('已准备命名验收副本，不修改正式任务');
}finally{source.close();store.close();}
