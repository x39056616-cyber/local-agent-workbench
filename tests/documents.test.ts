import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.ts';
import {Tools} from '../src/tools.ts';
import {parseDocument,documentKind} from '../src/documents.ts';
import {inferCollectionGoal} from '../src/collection-goal.ts';
import {docx,pdf} from './document-fixture.ts';
import {taskRoute,researchKinds} from '../src/routing.ts';
import {selectTools} from '../src/tool-selection.ts';
import {toolSpecs} from '../src/tools.ts';
import {Workflows,validateWorkflow} from '../src/workflows.ts';
const report='测试研究报告\n2024年获得一等奖，测试研究报告。\n摘要\n研究背景\n调查设计\n样本分析\n结论与建议\n'+('本研究使用问卷调查与访谈方法收集数据，对样本进行分析并给出研究结论。'.repeat(70));
async function fixture(fn:(t:Tools,c:any,s:Store)=>Promise<void>,prompt='帮我下载2份2023-2026正大杯获奖作品'){
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-documents-')),s=new Store(dir),t=new Tools(s),task=s.create(prompt,'auto',dir);task.options='{}';const c:any={task,signal:new AbortController().signal,emit:(type:string,engine:string,data:any)=>s.event(task.id,type,engine,data),tool:(name:string,args:any,engine:string)=>t.call(c,name,args,engine)};
 t.documents.download=async(url)=>{if(url.endsWith('robots.txt'))return {url,type:'text/plain',bytes:Buffer.from('User-agent: *\nAllow: /')};if(url.endsWith('page'))return {url,type:'text/html',bytes:Buffer.from('<body>获奖作品通知<a href="/one.docx">完整报告下载</a></body>')};return {url,type:'application/octet-stream',bytes:docx(report)};};
 try{await fn(t,c,s);}finally{s.close();await rm(dir,{recursive:true,force:true});}
}
test('目标从原话固定数量、全文及年份，不把目录或爬虫脚本当全文任务',()=>{
 assert.deepEqual(inferCollectionGoal('帮我爬取一下23-26正大杯的获奖作品，爬取20份就可以'),{target:20,fulltext:true,report:true,award:true,years:[2023,2024,2025,2026]});
 assert.equal(inferCollectionGoal('收集20项获奖作品，只要名称目录，不要全文')?.fulltext,false);assert.equal(inferCollectionGoal('编写一个下载20份报告的脚本'),null);assert.equal(inferCollectionGoal('解释如何下载PDF'),null);
 assert.equal(inferCollectionGoal('爬取网页并生成报告'),null);assert.equal(inferCollectionGoal('下载四十份报告')?.target,40);assert.equal(inferCollectionGoal('下载100份报告')?.target,100);
 for(const prompt of ['帮我收集20份获奖作品','帮我找20份论文全文']){assert.equal(taskRoute({prompt,engine:'auto'}).kind,'task');assert(researchKinds(prompt).includes('web'));const tools=selectTools(toolSpecs(false),prompt);assert(tools.some(s=>s.name==='web_search'));assert(tools.some(s=>s.name==='document_collect'));}
});
test('隔离解析实际DOCX与PDF，空白扫描页不能声明完整提取',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-parse-'));try{const p=path.join(dir,'test.docx');await writeFile(p,docx(report));const word=await parseDocument(p,'docx',AbortSignal.timeout(10000));assert(word.text.includes('测试研究报告'));const f=path.join(dir,'test.pdf');await writeFile(f,pdf('Research report\nAbstract\nIntroduction\nMethods\nConclusion'));const data=await parseDocument(f,'pdf',AbortSignal.timeout(10000));assert(data.text.includes('Research report'));assert.equal(data.pages,1);assert.deepEqual(data.emptyPages,[]);await writeFile(f,pdf(''));const empty=await parseDocument(f,'pdf',AbortSignal.timeout(10000));assert.deepEqual(empty.emptyPages,[1]);assert.equal(documentKind(Buffer.from('<html>not pdf</html>')),'');}finally{await rm(dir,{recursive:true,force:true});}
});
test('真实下载、提取、文件及正文去重；名称和获奖信息不能充当2份全文',async()=>fixture(async(t,c)=>{
 const discovered=await t.call(c,'document_discover',{url:'https://example.com/page'},'harness');assert.equal(discovered.links[0].url,'https://example.com/one.docx');
 const r=await t.call(c,'document_collect',{urls:['https://example.com/one.docx','https://example.com/two.docx']},'harness');assert.equal(r.items[0].state,'parsed');assert(r.items[0].complete);assert.equal(r.items[1].state,'duplicate');
 const id=r.items[0].id,body=await t.call(c,'document_read',{id},'harness');assert(body.text.includes('测试研究报告'));
 const record=await t.call(c,'material_record',{items:[{documentId:id,title:'测试研究报告',kind:'fulltext',year:2024,yearQuote:'2024年获得一等奖',quote:'2024年获得一等奖，测试研究报告。',awardQuote:'2024年获得一等奖，测试研究报告。'}]},'harness');assert(record.items[0].recorded);assert.equal(record.progress.fulltexts,1);assert.equal(record.progress.awards,1);assert.equal(record.progress.remaining,1);
 await assert.rejects(t.call(c,'finish_task',{outcome:'completed',summary:'拿到两份全文',files:['documents/manifest.json']},'harness'),/目标尚未满足/);
 assert((await t.call(c,'finish_task',{outcome:'blocked',summary:'已取得1/2份独立全文',files:['documents/manifest.json']},'harness')).recorded);
 await writeFile(path.join(c.task.workspace,r.items[0].path),'changed');assert.equal((await t.documents.status(c)).fulltexts,0);
}));
test('新闻页面、伪造摘录、错误年份、获奖名单和短PDF均不能冒充报告',async()=>fixture(async(t,c,s)=>{
 const page=await t.documents.collect(c,['https://example.com/page']);assert.equal(page.items[0].state,'webpage');
 const r=await t.documents.collect(c,['https://example.com/report.docx']),id=r.items[0].id;
 for(const item of [{title:'假的作品名',kind:'fulltext',documentId:id,quote:'这个摘录不存在',year:2024,yearQuote:'2024'},{title:'测试研究报告',kind:'fulltext',documentId:id,quote:'2024年获得一等奖，测试研究报告。',year:2022,yearQuote:'2022'}])assert.equal((await t.documents.record(c,[item],'harness')).items[0].recorded,false);
 s.db.prepare("UPDATE documents SET complete=0 WHERE id=?").run(id);assert.equal((await t.documents.record(c,[{title:'测试研究报告',kind:'fulltext',documentId:id,quote:'2024年获得一等奖，测试研究报告。',awardQuote:'2024年获得一等奖，测试研究报告。',year:2024,yearQuote:'2024年获得一等奖'}],'harness')).items[0].recorded,false);
}));
test('同任务已下载文件可重用，其他任务不能读取；取消不启动解析',async()=>fixture(async(t,c,s)=>{
 const r=await t.documents.collect(c,['https://example.com/report.docx']),id=r.items[0].id;let requests=0;t.documents.download=async()=>{requests++;throw Error('不应重新下载');};const again=await t.documents.collect(c,['https://example.com/report.docx']);assert.equal(again.items[0].id,id);assert.equal(requests,0);
 const other=s.create('另一个任务','auto',c.task.workspace);await assert.rejects(t.documents.read({...c,task:other},id),/本任务没有/);
 await assert.rejects(parseDocument('/missing','pdf',AbortSignal.abort(new Error('用户停止'))),/用户停止/);
}));

test('目标满足后才能completed，交付清单被篡改仍拒绝',async()=>fixture(async(t,c)=>{
 const r=await t.call(c,'document_collect',{urls:['https://example.com/report.docx']},'harness'),id=r.items[0].id;
 await t.call(c,'document_read',{id},'harness');await t.call(c,'material_record',{items:[{title:'测试研究报告',kind:'fulltext',documentId:id,quote:'2024年获得一等奖，测试研究报告。',year:2024,yearQuote:'2024年获得一等奖',awardQuote:'2024年获得一等奖，测试研究报告。'}]},'harness');
 assert.equal((await t.call(c,'finish_task',{outcome:'completed',summary:'已交付1份真实报告',files:['documents/manifest.json']},'harness')).recorded,true);
 await writeFile(path.join(c.task.workspace,'documents/manifest.json'),'{}');await assert.rejects(t.call(c,'finish_task',{outcome:'completed',summary:'伪造清单',files:['documents/manifest.json']},'harness'),/清单被修改/);
},'下载一份2023-2026获奖作品'));

test('正文相同但二进制不同仍识别为重复文档',async()=>fixture(async(t,c)=>{
 const r=await t.documents.collect(c,['https://example.com/report.docx']);let n=0;
 t.documents.download=async(url)=>{if(url.endsWith('robots.txt'))return {url,type:'text/plain',bytes:Buffer.from('User-agent: *\nAllow: /')};n++;return {url,type:'application/octet-stream',bytes:docx(report,'binary metadata changed')};};
 const second=await t.documents.collect(c,['https://example.com/second.docx']);assert.equal(second.items[0].duplicateOf,r.items[0].id);assert.equal(n,1);
}));

test('继续任务不丢原目标；用户明确只要目录时才改变交付类型',async()=>fixture(async(t,c)=>{
 c.task.options=JSON.stringify({currentPrompt:'继续，补齐剩余材料'});assert.equal(t.documents.goal(c)?.target,2);assert(t.documents.goal(c)?.fulltext);assert(t.specsFor(c).some(s=>s.name==='document_collect'));
 c.task.options=JSON.stringify({currentPrompt:'不需要全文了，只要名称目录'});assert.equal(t.documents.goal(c)?.fulltext,false);assert.equal(t.documents.goal(c)?.target,2);
}));

test('正文解析中断可用原文件重试，不重新下载已保存的文件',async()=>fixture(async(t,c)=>{
 const real=t.documents.parse;t.documents.parse=async()=>{throw Error('模拟解析中断');};const first=await t.documents.collect(c,['https://example.com/report.docx']);assert.equal(first.items[0].state,'failed');assert(first.items[0].path);
 t.documents.parse=real;t.documents.download=async()=>{throw Error('不应重新下载');};const retry=await t.documents.collect(c,['https://example.com/report.docx']);assert.equal(retry.items[0].id,first.items[0].id);assert.equal(retry.items[0].state,'parsed');
}));

test('真实可读的获奖通知PDF仍不能充当获奖作品报告全文',async()=>fixture(async(t,c)=>{
 t.documents.download=async(url)=>({url,type:url.endsWith('robots.txt')?'text/plain':'application/pdf',bytes:url.endsWith('robots.txt')?Buffer.from('User-agent: *\nAllow: /'):pdf('2024 award winner Test award notice')});
 const r=await t.documents.collect(c,['https://example.com/notice.pdf']);assert(r.items[0].complete);
 const result=await t.documents.record(c,[{title:'Test award notice',kind:'fulltext',documentId:r.items[0].id,year:2024,yearQuote:'2024 award winner',quote:'2024 award winner Test award notice',awardQuote:'2024 award winner Test award notice'}],'harness');assert.equal(result.items[0].recorded,false);assert.match(result.items[0].error,/足够正文/);assert.equal(result.progress.fulltexts,0);
}));

test('均衡协作审查可通过document_read完整核验Word原文件，不把二进制当UTF-8读取',async()=>fixture(async(t,c,s)=>{
 t.documents.download=async(url)=>({url,type:'application/octet-stream',bytes:url.endsWith('robots.txt')?Buffer.from('User-agent: *\nAllow: /'):docx(report.repeat(5))});
 const got=await t.call(c,'document_collect',{urls:['https://example.com/report.docx']},'harness'),id=got.items[0].id,files=[got.items[0].path,'documents/manifest.json'];
 await t.call(c,'material_record',{items:[{title:'测试研究报告',kind:'fulltext',documentId:id,quote:'2024年获得一等奖，测试研究报告。'}]},'harness');let reviewed=false;
 const engines:any={run:async(e:string,_p:string,ctx:any)=>{if(ctx.stage?.id==='balanced.plan'){await ctx.tool('document_read',{id},e);await ctx.tool('submit_stage',{payload:JSON.stringify({summary:'正文来源已核对',steps:['交付原文']})},e);}else if(ctx.stage){let body=await ctx.tool('document_read',{id},e);await ctx.tool('read_file',{path:'documents/manifest.json'},e);await assert.rejects(ctx.tool('submit_stage',{payload:JSON.stringify({passed:true,summary:'只读了一部分不能通过',issues:[],files})},e),/全部声明成果/);while(body.nextOffset!==null)body=await ctx.tool('document_read',{id,offset:body.nextOffset},e);reviewed=true;await ctx.tool('submit_stage',{payload:JSON.stringify({passed:true,summary:'已独立核对全文及清单',issues:[],files})},e);}else await ctx.tool('finish_task',{outcome:'completed',summary:'已交付真实文档',files},e);return '';}};
 await new Workflows(engines,s,()=>{}).run('下载一份文档',c,validateWorkflow({mode:'balanced'},'auto'));assert(reviewed);
},'下载一份文档'));
