import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {config} from '../src/config.ts';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({baseURL:`http://127.0.0.1:${config.port}`,viewport:{width:1440,height:1000}});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${config.port}`,{waitUntil:'networkidle'});
  await page.getByLabel('选择执行器').selectOption('qwen');
  await page.getByLabel('任务内容').fill('使用 write_file 创建 browser-check.txt，完整内容为 WEB_OK，随后使用 read_file 读取核对，最后调用 finish_task，files 中包含 browser-check.txt。');
  const created=page.waitForResponse(r=>r.url().endsWith('/api/tasks')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'提交任务',exact:true}).click();
  const task=await(await created).json();
  const report:any={taskId:task.id,submittedFromBrowser:true,checkedAt:new Date().toISOString()};
  const start=Date.now();
  for(;;){const detail=await page.request.get(`/api/tasks/${task.id}`);const d=await detail.json();if(['succeeded','failed','cancelled'].includes(d.task.status)){report.status=d.task.status;report.error=d.task.error;break;}if(Date.now()-start>240000)throw new Error('网页任务验收超时');await page.waitForTimeout(1000);}
  assert.equal(report.status,'succeeded');
  await page.reload({waitUntil:'networkidle'});
  await page.locator('.history button').filter({hasText:'browser-check.txt'}).first().click();
  await page.getByRole('link',{name:/browser-check.txt/}).waitFor();
  const response=await page.request.get(`/api/tasks/${task.id}/file?path=browser-check.txt`);assert.equal((await response.text()).trim(),'WEB_OK');
  report.downloadVerified=true;report.pageErrors=errors;assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(config.root,'acceptance/browser-task.png'),fullPage:true});
  await writeFile(path.join(config.root,'acceptance/browser-task.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
