import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),base='http://127.0.0.1:4334',seed=JSON.parse(await readFile('acceptance/naming-seed.json','utf8')),browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors:string[]=[],network:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)network.push(r.status()+':'+r.url());});
 await page.goto(base);await page.getByText('本机服务已连接',{exact:true}).waitFor();await page.locator('.history-open').first().click();await page.locator('.artifact-card').first().waitFor();
 const labels=await page.locator('.artifact-heading strong').allTextContents();for(const name of ['公司财务对比表','研究简报','执行记录','微软 FY2025 年报','苹果 FY2025 年报','苹果 FY2025 年报 · 提取文本'])assert(labels.includes(name),name);
 const files=await page.evaluate(async id=>(await fetch('/api/tasks/'+id+'/files')).json(),seed.taskId),pdf=files.find((f:any)=>f.format==='PDF'&&f.displayName.startsWith('微软'));
 const pending=page.waitForEvent('download');await page.getByLabel('下载：'+pdf.originalName,{exact:true}).click();const download=await pending;assert.equal(download.suggestedFilename(),pdf.downloadName);assert(download.suggestedFilename().startsWith('微软 FY2025 年报'));
 const card=page.locator('[data-file-path="'+pdf.path.replaceAll('\\','/')+'"]');await card.getByText('原文件名',{exact:true}).click();assert((await card.innerText()).includes(pdf.originalName));await card.getByText('原文件名',{exact:true}).click();
 await page.getByRole('button',{name:'重命名',exact:true}).click();await page.getByLabel('任务名称',{exact:true}).fill('');assert(await page.getByRole('button',{name:'保存名称'}).isDisabled());await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'重命名',exact:true}).click();await page.getByLabel('任务名称',{exact:true}).fill('年报对比 · 命名检查');await page.getByRole('button',{name:'保存名称'}).click();await page.locator('.task-heading h1').filter({hasText:'年报对比 · 命名检查'}).waitFor();
 await page.reload();await page.locator('.history-open').filter({hasText:'年报对比 · 命名检查'}).click();assert((await page.locator('.history-open').first().innerText()).includes(seed.taskId.slice(0,6)));
 const shots=[];for(const width of [1440,768,375]){await page.setViewportSize({width,height:1000});await page.locator('.feed').evaluate(el=>el.scrollTop=0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const file='acceptance/naming-ui-'+width+'.png';await page.screenshot({path:file,fullPage:true,animations:'disabled'});shots.push(file);}
 await page.setViewportSize({width:1440,height:1000});await page.route(base+'/__test_axe.js',async route=>route.fulfill({contentType:'application/javascript',body:await readFile(require.resolve('axe-core/axe.min.js'),'utf8')}));await page.addScriptTag({url:base+'/__test_axe.js'});const axe=await page.evaluate(async()=>{const r=await (window as any).axe.run(document.querySelector('.conversation-files'));return r.violations.map((v:any)=>({id:v.id,impact:v.impact}));});assert.deepEqual(axe,[]);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 await writeFile('acceptance/naming-browser.json',JSON.stringify({passed:true,labels,downloadName:download.suggestedFilename(),originalFilenameVisibleOnExpand:true,renamePersists:true,historyDiscriminator:true,widths:[1440,768,375],screenshots:shots,axe,pageErrors:errors,networkErrors:network,visualRegression:'INCONCLUSIVE：无已提交命名截图基线',performance:'未测稳定LCP/INP',verdict:'SHIP：文件命名与任务重命名流程通过，非全站认证'},null,2));console.log('可读名称、下载名、重命名持久化与三宽度检查通过');
}finally{await browser.close();}
