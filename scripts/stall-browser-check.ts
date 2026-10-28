import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4317),browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors:string[]=[],network:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)network.push(r.status()+':'+r.url());});
 await page.goto(base);await page.getByText('本机服务已连接',{exact:true}).waitFor();await page.locator('.history-open').filter({hasText:'Task: Microsoft and Apple'}).first().click();await page.getByText('部分完成 · 有缺口',{exact:true}).waitFor();
 assert.equal(await page.locator('.participant-working').count(),0);for(const file of ['company_comparison.csv','research_brief.md','execution_notes.md'])await page.getByLabel('下载：'+file,{exact:true}).waitFor();
 const pending=page.waitForEvent('download');await page.getByLabel('下载：company_comparison.csv',{exact:true}).click();const download=await pending;assert.equal(download.suggestedFilename(),'company_comparison.csv');
 await page.getByLabel('预览：execution_notes.md',{exact:true}).click();const preview=page.locator('[data-file-path="execution_notes.md"]');await preview.locator('.artifact-preview').getByText(/second alternative/).first().waitFor();assert((await preview.innerText()).includes('second alternative'));await page.getByLabel('收起预览：execution_notes.md',{exact:true}).click();
 const shots=[];for(const width of [1440,768,375]){await page.setViewportSize({width,height:1000});await page.locator('.feed').evaluate(el=>el.scrollTop=0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const file='acceptance/stall-ui-'+width+'.png';await page.screenshot({path:file,fullPage:true,animations:'disabled'});shots.push(file);}
 await page.setViewportSize({width:1440,height:1000});await page.route(base+'/__test_axe.js',async route=>route.fulfill({contentType:'application/javascript',body:await readFile(require.resolve('axe-core/axe.min.js'),'utf8')}));await page.addScriptTag({url:base+'/__test_axe.js'});const axe=await page.evaluate(async()=>{const r=await (window as any).axe.run(document.querySelector('[aria-label="运行状态"]'));return r.violations.map((v:any)=>({id:v.id,impact:v.impact}));});assert.deepEqual(axe,[]);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 await writeFile('acceptance/stall-browser.json',JSON.stringify({passed:true,partialStatus:true,modelNoLongerBusy:true,threeFileDownloadsVisible:true,csvDownload:true,notesPreview:true,widths:[1440,768,375],screenshots:shots,axe,pageErrors:errors,networkErrors:network,visualRegression:'INCONCLUSIVE：无已提交截图基线',performance:'未测稳定LCP/INP',verdict:'SHIP：部分完成与文件下载路径验证通过，非全部资料目标完成或全站认证'},null,2));console.log('部分完成、文件下载、预览和三宽度页面验证通过');
}finally{await browser.close();}
