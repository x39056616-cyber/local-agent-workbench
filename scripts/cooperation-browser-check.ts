import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),base='http://127.0.0.1:'+(process.env.LA_TEST_PORT||4333),browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors:string[]=[],network:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)network.push(r.status()+':'+r.url());});
 await page.goto(base);await page.getByText('本机服务已连接',{exact:true}).waitFor();await page.locator('.history-open').filter({hasText:'Download https://www.w3.org'}).first().click();
 const panel=page.getByLabel('本次自动分工');await panel.waitFor();const text=await panel.innerText();for(const name of ['来源获取','字段提取','成果整理','独立核验','Qwen','DeepSeek','Codex'])assert(text.includes(name),name);
 await panel.getByText('查看分工依据',{exact:true}).click();assert((await panel.innerText()).includes('启发式'));await panel.getByText('查看分工依据',{exact:true}).click();
 const shots=[];for(const width of [1440,768,375]){await page.setViewportSize({width,height:1000});await page.locator('.feed').evaluate(el=>el.scrollTop=0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const file='acceptance/cooperation-ui-'+width+'.png';await page.screenshot({path:file,fullPage:true,animations:'disabled'});shots.push(file);}
 await page.setViewportSize({width:1440,height:1000});await page.route(base+'/__test_axe.js',async route=>route.fulfill({contentType:'application/javascript',body:await readFile(require.resolve('axe-core/axe.min.js'),'utf8')}));await page.addScriptTag({url:base+'/__test_axe.js'});const axe=await page.evaluate(async()=>{const r=await (window as any).axe.run(document.querySelector('[aria-label="本次自动分工"]'));return r.violations.map((v:any)=>({id:v.id,impact:v.impact}));});assert.deepEqual(axe,[]);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 await writeFile('acceptance/cooperation-browser.json',JSON.stringify({passed:true,panel:text,widths:[1440,768,375],screenshots:shots,pageErrors:errors,networkErrors:network,axe,visualRegression:'INCONCLUSIVE：无已提交的分工面板截图基线',metrics:'未测量稳定LCP/INP，不宣称性能基准通过',verdict:'SHIP：新增分工面板功能与自动检查通过，非全站可访问性认证'},null,2));console.log('自动分工面板、三宽度与axe通过');
}finally{await browser.close();}
