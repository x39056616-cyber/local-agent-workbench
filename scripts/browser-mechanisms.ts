import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true}),errors:string[]=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+(process.env.LA_TEST_PORT||4319));
 await page.getByText('本机服务已连接',{exact:true}).waitFor({timeout:30000});
 await page.locator('.workflow-editor summary').click();await page.getByLabel('执行机制',{exact:true}).selectOption('team');
 await page.getByLabel('角色名称 researcher').fill('资料核验员');await page.getByLabel('角色引擎 researcher').selectOption('qwen');
 await page.screenshot({path:'acceptance/mechanisms-roles.png',fullPage:true});
 await page.getByRole('button',{name:'基准评估'}).click();await page.getByLabel('评估方法').selectOption('bfcl');
 await page.getByRole('button',{name:'载入自编示例'}).click();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('[aria-label="评估题目 JSON"]')?.value.includes('get_weather'));
 const created=page.waitForResponse(r=>r.url().endsWith('/api/evaluations')&&r.request().method()==='POST');await page.getByRole('button',{name:'开始本地评估'}).click();const createdRun=await(await created).json();
 const run=page.locator(`[data-run-id="${createdRun.id}"]`);await run.getByText(/准确率 100.0%/).waitFor({timeout:120000});
 const download=page.waitForEvent('download');await run.getByRole('button',{name:'下载本地报告'}).click();const file=await download;assert(file.suggestedFilename().startsWith('bfcl-'));
 for(const width of [1440,820,390]){await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'评估页溢出 '+width);await page.screenshot({path:'acceptance/mechanisms-eval-'+width+'.png',fullPage:true});}
 await page.getByRole('button',{name:'新建任务'}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'角色配置页溢出');
 assert.deepEqual(errors,[]);await writeFile('acceptance/browser-mechanisms.json',JSON.stringify({passed:true,pageErrors:errors,roleEditor:true,liveBfcl:true,download:true,responsive:[1440,820,390]},null,2));console.log('网页角色配置、真实 BFCL 练习、报告下载与三尺寸布局通过');
}finally{await browser.close();}
