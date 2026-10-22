import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4329);
const report=JSON.parse(await readFile('acceptance/model-routing-live-first.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors:string[]=[],badResponses:string[]=[],result:any={};
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&r.url().startsWith(base))badResponses.push(r.status()+' '+r.url());});
 await page.addInitScript(()=>{(window as any).metrics={cls:0};try{new PerformanceObserver(list=>{for(const e of list.getEntries())(window as any).metrics.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(list=>{for(const e of list.getEntries())if(!(e as any).hadRecentInput)(window as any).metrics.cls+=(e as any).value;}).observe({type:'layout-shift',buffered:true});}catch{}});
 await page.goto(base);await page.getByText('本机服务已连接',{exact:true}).waitFor();
 const open=async()=>{await page.locator('.history-open').filter({hasText:'提取以下文本中的姓名'}).first().click();await page.locator('.model-routing').waitFor();};
 await open();assert((await page.locator('.model-routing-heading').innerText()).includes('本地 Qwen'));
 await page.getByRole('button',{name:'需要改进',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.routing-feedback button[aria-pressed=true]')?.textContent==='需要改进');
 await page.reload();await page.getByText('本机服务已连接',{exact:true}).waitFor();await open();assert.equal(await page.getByRole('button',{name:'需要改进',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'符合预期',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.routing-feedback button[aria-pressed=true]')?.textContent==='符合预期');result.feedback={negative:true,changedToPositive:true,persistedOnReload:true,keyboard:true,taskId:report[0].taskId};
 await page.getByText('查看选择依据',{exact:true}).click();assert((await page.locator('.model-routing').innerText()).includes('相对成本不是 API 报价'));
 const axe=await readFile('acceptance/axe/package/axe.min.js','utf8');await page.evaluate(axe);
 result.axe=await page.evaluate(async()=>{const r=await (window as any).axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return {violations:r.violations.map((v:any)=>({id:v.id,impact:v.impact,nodes:v.nodes.map((n:any)=>n.target)})),incomplete:r.incomplete.length};});
 for(const width of [1440,768,375]){await page.setViewportSize({width,height:width===768?1024:960});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'横向溢出 '+width);await page.screenshot({path:'acceptance/model-routing-'+width+'.png',fullPage:true,animations:'disabled'});}
 if(await page.getByLabel('打开导航',{exact:true}).isVisible())await page.getByLabel('打开导航',{exact:true}).click();await page.getByRole('button',{name:/新建任务/}).click();await page.locator('.task-options>summary').click();await page.locator('.workflow-editor>summary').click();assert.equal(await page.getByLabel('执行机制',{exact:true}).inputValue(),'adaptive');
 await page.getByLabel('自动选模偏好',{exact:true}).selectOption('quality');assert.equal(await page.getByLabel('自动选模偏好',{exact:true}).inputValue(),'quality');result.newTask={adaptiveDefault:true,preferenceSelectable:true};
 result.metrics=await page.evaluate(()=>(window as any).metrics);result.metrics.inp='未测量；一次键盘操作不能代表真实 INP';result.widths=[1440,768,375];result.pageErrors=errors;result.badResponses=badResponses;
 assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);assert.deepEqual(result.axe.violations,[]);
 result.visualBaseline='INCONCLUSIVE：新选模区域无已提交截图基线';result.verdict='SHIP：交互与响应式验收通过；视觉回归无基线，自动检查不替代读屏人工检查';
 await writeFile('acceptance/model-routing-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
