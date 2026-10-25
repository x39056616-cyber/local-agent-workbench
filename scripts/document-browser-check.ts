import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4332),live=JSON.parse(await readFile('acceptance/document-live.json','utf8'));
assert(live.passed);const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors:string[]=[],network:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)network.push(r.status()+':'+r.url());});
 await page.addInitScript(()=>{(window as any).quality={cls:0};try{new PerformanceObserver(l=>{for(const e of l.getEntries())(window as any).quality.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!(e as any).hadRecentInput)(window as any).quality.cls+=(e as any).value;}).observe({type:'layout-shift',buffered:true});}catch{}});
 await page.goto(base);await page.getByText('本机服务已连接',{exact:true}).waitFor();await page.locator('.history-open').filter({hasText:'下载2份公开文档'}).first().click();
 const panel=page.getByLabel('材料交付进度');await panel.waitFor();assert((await panel.innerText()).includes('去重全文 2/2'));
 const cards=page.locator('.artifact-card'),count=await cards.count();assert(count>=4);
 const pdf=cards.filter({has:page.getByText(/\.pdf$/)}).first();
 const button=page.locator('button.artifact-download').filter({hasText:'下载'});let pdfButton:any;
 for(let i=0;i<await button.count();i++)if((await button.nth(i).getAttribute('aria-label'))?.endsWith('.pdf')){pdfButton=button.nth(i);break;}
 assert(pdfButton);const pending=page.waitForEvent('download');await pdfButton.click();const download=await pending;assert(download.suggestedFilename().endsWith('.pdf'));
 await page.getByLabel('预览：manifest.json',{exact:true}).click();await page.locator('[data-file-path="documents/manifest.json"] pre').waitFor();assert((await page.locator('[data-file-path="documents/manifest.json"] pre').innerText()).includes('textFileHash'));
 await page.getByLabel('收起预览：manifest.json',{exact:true}).click();
 const screenshots=[];for(const width of [1440,768,375]){await page.setViewportSize({width,height:1000});await page.locator('.feed').evaluate(el=>el.scrollTop=0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const file='acceptance/document-ui-'+width+'.png';await page.screenshot({path:file,fullPage:true,animations:'disabled'});screenshots.push(file);}
 await page.setViewportSize({width:1440,height:1000});await page.route(base+'/__test_axe.js',async route=>route.fulfill({contentType:'application/javascript',body:await readFile(require.resolve('axe-core/axe.min.js'),'utf8')}));await page.addScriptTag({url:base+'/__test_axe.js'});const accessibility=await page.evaluate(async()=>{const r=await (window as any).axe.run(document.querySelector('[aria-label="材料交付进度"]'));return r.violations.map((v:any)=>({id:v.id,impact:v.impact}));});assert.deepEqual(accessibility,[]);
 await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement!==document.body));assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 await writeFile('acceptance/document-browser.json',JSON.stringify({passed:true,panel:await panel.innerText(),fileCards:count,pdfDownload:true,manifestPreview:true,widths:[1440,768,375],pageErrors:errors,networkErrors:network,axe:accessibility,metrics:await page.evaluate(()=>(window as any).quality),visualRegression:'INCONCLUSIVE：无已提交的材料进度截图基线',verdict:'SHIP：新增流程与组件检查通过，非全站可访问性认证'},null,2));console.log('文档进度、下载、预览与三宽度检查通过');
}finally{await browser.close();}
