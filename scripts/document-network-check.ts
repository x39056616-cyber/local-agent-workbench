import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Store} from '../src/store.ts';
import {Tools} from '../src/tools.ts';
const dir=path.resolve('acceptance/document-network-'+Date.now());await mkdir(dir,{recursive:true});const store=new Store(dir),tools=new Tools(store),task=store.create('下载3份PDF和Word文档','harness',path.join(dir,'work'));
await mkdir(task.workspace,{recursive:true});const ctx:any={task,signal:AbortSignal.timeout(180000),emit:(type:string,engine:string,data:any)=>{store.event(task.id,type,engine,data);if(type==='document_progress')console.log(data.state,data.url||data.id);}};
const urls=['https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf','https://raw.githubusercontent.com/morungos/node-word-extractor/develop/__tests__/data/test01.doc','https://raw.githubusercontent.com/morungos/node-word-extractor/develop/__tests__/data/test02.docx'];
let result:any;try{const start=performance.now(),r=await tools.call(ctx,'document_collect',{urls},'harness');assert.equal(r.items.length,3);const items=[];
 for(const d of r.items){assert.equal(d.state,'parsed',d.error);assert(d.complete);const body=await tools.call(ctx,'document_read',{id:d.id},'harness');const text=body.text.replace(/^\s*\[第 \d+ 页\]\s*/,''),quote=text.slice(0,200).trim(),title=quote.split(/\r?\n/)[0].trim().slice(0,60);items.push({documentId:d.id,kind:'fulltext',title,quote});}
 const recorded=await tools.call(ctx,'material_record',{items},'harness');assert(recorded.items.every((i:any)=>i.recorded),JSON.stringify(recorded));assert.equal(recorded.progress.fulltexts,3);
 await tools.call(ctx,'finish_task',{outcome:'completed',summary:'已下载三份不同文档并提取正文',files:['documents/manifest.json']},'harness');
 result={passed:true,durationMs:Math.round(performance.now()-start),items:r.items,progress:recorded.progress};
}catch(error){result={passed:false,error:String(error)};process.exitCode=1;}finally{await writeFile('acceptance/document-network-live.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));store.close();}
