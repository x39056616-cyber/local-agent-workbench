import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/store.ts';
const base='http://127.0.0.1:4323',dir=path.resolve('acceptance/conversation-data'),response=await fetch(base+'/api/session'),session:any=await response.json();
assert.equal(path.resolve(session.defaultWorkspace),path.join(dir,'tasks'));
const workspace=path.join(dir,'ui-fixture');await mkdir(workspace,{recursive:true});
await writeFile(path.join(workspace,'成果.md'),'# 成果预览\n\n中文、**粗体**与安全链接。\n\n<script>window.UNSAFE=true</script>\n\n```js\nconsole.log("完成")\n```');
await writeFile(path.join(workspace,'code.py'),'print("中文成果")');
await writeFile(path.join(workspace,'image.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'));
const store=new Store(dir),t=store.create('界面验收：对话与成果卡片 '+Date.now(),'auto',workspace);
store.update(t.id,{status:'succeeded',result:'文件已生成，查看 [成果](成果.md)。',options:JSON.stringify({intent:'task'})});
store.event(t.id,'attachment','user',{path:'attachments/界面测试.txt'});store.event(t.id,'user_message','user',{text:t.prompt,turnId:'fixture'});
store.event(t.id,'message','codex',{text:'这段执行过程不应覆盖最终回答。'});
for(const f of ['成果.md','code.py','image.png','.agent-reports/plan.json','agent-result.md'])store.event(t.id,'artifact','system',{path:f});
store.event(t.id,'final','system',{text:'文件已生成，查看 [成果](成果.md)。',turnId:'fixture'});store.close();
const browser=await chromium.launch({channel:'chrome',headless:true}),errors:string[]=[],badResponses:string[]=[],results:any={};
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=500)badResponses.push(r.url()+':'+r.status());});
 await page.addInitScript(()=>{(window as any).metrics={cls:0};try{new PerformanceObserver(list=>{for(const e of list.getEntries())(window as any).metrics.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(list=>{for(const e of list.getEntries())if(!(e as any).hadRecentInput)(window as any).metrics.cls+=(e as any).value;}).observe({type:'layout-shift',buffered:true});}catch{}});
 await page.goto(base);await page.getByText('本机服务已连接',{exact:true}).waitFor();
 await page.getByLabel('任务内容',{exact:true}).fill('你好，你是谁');await page.getByRole('button',{name:'提交任务',exact:true}).click();await page.locator('.assistant-answer .markdown-body').waitFor();await page.getByRole('button',{name:'复制回答',exact:true}).waitFor({timeout:30000});
 assert.equal(await page.locator('.conversation-files').count(),0);assert(!(await page.locator('.execution-records').getAttribute('open')));results.greeting=await page.locator('.assistant-answer .markdown-body').innerText();
 await page.getByLabel('任务内容',{exact:true}).fill('我刚才问了什么？简短回答。');await page.getByRole('button',{name:'提交任务',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.assistant-answer .copy-button').length===2);assert.equal(await page.locator('.conversation-turn').count(),2);
 await page.reload();await page.getByText('本机服务已连接',{exact:true}).waitFor();
 await page.locator('.history-open').filter({hasText:'你好，你是谁'}).first().click();await page.waitForFunction(()=>document.querySelectorAll('.conversation-turn').length===2);results.reload=true;
 await page.locator('.history-open').filter({hasText:t.title}).click();await page.locator('.artifact-card').first().waitFor();await page.getByRole('heading',{name:'成果预览'}).waitFor();assert.equal(await page.locator('.conversation-turn').count(),1,'附件事件不能导致重复用户消息');assert.equal(await page.locator('.artifact-card').count(),3);assert.equal(await page.evaluate(()=>(window as any).UNSAFE),undefined);assert.equal(await page.locator('.assistant-answer').innerText().then(s=>s.includes('覆盖最终回答')),false);
 await page.getByLabel('预览：code.py',{exact:true}).click();await page.locator('[data-file-path="code.py"] pre').waitFor();assert((await page.locator('[data-file-path="code.py"] pre').innerText()).includes('中文成果'));
 await page.getByLabel('预览：image.png',{exact:true}).click();await page.locator('.artifact-preview img').waitFor();
 const downloaded=page.waitForEvent('download');await page.getByLabel('下载：成果.md',{exact:true}).click();assert.equal((await downloaded).suggestedFilename(),'成果.md');results.files={inline:true,download:true,markdown:true,code:true,image:true,rawHtmlNotExecuted:true,internalReportsHidden:true};
 for(const width of [1440,768,375]){await page.setViewportSize({width,height:width===768?1024:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'横向溢出 '+width);await page.screenshot({path:'acceptance/conversation-'+width+'.png',fullPage:true,animations:'disabled'});}
 results.metrics=await page.evaluate(()=>(window as any).metrics);results.widths=[1440,768,375];
 const nav=async(name:string)=>{if(await page.getByLabel('打开导航',{exact:true}).isVisible())await page.getByLabel('打开导航',{exact:true}).click();await page.locator('nav').getByRole('button',{name,exact:true}).click();};
 for(const name of ['能力与工具','知识与记忆','基准评估','已归档','运行设置','任务工作台']){await nav(name);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' 手机横向溢出');}
 await page.keyboard.press('Tab');results.keyboardFocus=await page.evaluate(()=>document.activeElement!==document.body);assert(results.keyboardFocus);
 assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);await writeFile('acceptance/conversation-browser.json',JSON.stringify({...results,passed:true,pageErrors:errors,serverErrors:badResponses,visualBaseline:'INCONCLUSIVE：无已提交的本组件截图基线',verdict:'SHIP WITH FIXES：待独立终审'},null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
