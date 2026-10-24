import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4332);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.getByText('本机服务已连接',{exact:true}).waitFor({state:'attached'});
 await page.locator('.history-open').filter({hasText:'使用 crawl_start 批量采集'}).first().click();await page.getByLabel('运行状态').waitFor();
 await page.getByText(/模型请求耗时 ·/).click();assert((await page.getByLabel('运行状态').innerText()).includes('首次输出'));
 await page.locator('.assistant-answer .markdown-body').waitFor();
 const details=await page.getByLabel('运行状态').innerText();
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`acceptance/progress-${width}.png`,fullPage:true,animations:'disabled'});}
 await page.reload();await page.getByText('本机服务已连接',{exact:true}).waitFor({state:'attached'});if(await page.getByLabel('打开导航',{exact:true}).isVisible())await page.getByLabel('打开导航',{exact:true}).click();await page.locator('.history-open').filter({hasText:'使用 crawl_start 批量采集'}).first().click();await page.getByText(/模型请求耗时 ·/).waitFor();assert.deepEqual(errors,[]);
 await writeFile('acceptance/progress-browser.json',JSON.stringify({passed:true,details,widths:[1440,768,390],reload:true,pageErrors:errors},null,2));console.log(details);
}finally{await browser.close();}
