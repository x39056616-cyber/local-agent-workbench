import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import path from 'node:path';
import {config} from '../src/config.ts';
// 独立后端只放固定验收文本，不把原工作台历史或账号信息带入网页验收。
const testPort=4318,local='http://127.0.0.1:'+testPort,published=config.publishedUrl;
const service=spawn(process.execPath,[path.join(config.root,'src/server.ts')],{cwd:config.root,env:{...process.env,LA_PORT:String(testPort),LA_DATA_DIR:path.join(config.root,'acceptance/pages-data')},windowsHide:true,stdio:'ignore'});
const browser=await chromium.launch({channel:'chrome',headless:true,...(config.webProxy?{proxy:{server:config.webProxy,bypass:'127.0.0.1,localhost'}}:{})});
const report:any={published,checkedAt:new Date().toISOString()},errors:string[]=[];
try{
 for(let i=0;i<40;i++){try{if((await fetch(local+'/api/session')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 // 对应真实用户允许浏览器的“本地网络访问”提示，不关闭浏览器安全检查。
 await context.grantPermissions(['local-network-access'],{origin:new URL(published).origin});
 const session=await context.request.get(local+'/api/session');assert(session.ok());
 const pair=await context.request.post(local+'/api/pair',{data:{}});assert(pair.ok());const {url}=await pair.json();
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});await page.getByRole('heading',{name:'今天要完成什么？'}).waitFor({timeout:60000});assert.equal(new URL(page.url()).hash,'#tasks');
 report.connection={realHttps:true,paired:true,fragmentRemoved:true};
 await page.getByRole('combobox',{name:'选择执行器'}).selectOption('qwen');await page.locator('.task-options>summary').click();await page.getByLabel('本地 Qwen 强度').selectOption('none');
 await page.getByLabel('任务内容').fill('这是 GitHub 网页的固定文本验收。只调用 write_file 写入 pages-check.txt，内容精确为 PUBLIC_PAGE_OK。最后调用 finish_task，outcome=completed，files=[pages-check.txt]。不要读取账号信息、调用连接器或运行命令。');
 const created=page.waitForResponse(r=>r.url()===local+'/api/tasks'&&r.request().method()==='POST');await page.getByRole('button',{name:'提交任务'}).click();const task=await(await created).json();assert(task.id);report.taskId=task.id;
 const deadline=Date.now()+300000;let detail:any;
 while(Date.now()<deadline){const response=await context.request.get(local+'/api/tasks/'+task.id);detail=await response.json();if(['succeeded','failed','cancelled'].includes(detail.task.status))break;await new Promise(r=>setTimeout(r,1500));}
 assert.equal(detail.task.status,'succeeded',detail.task.error);assert(detail.events.some((e:any)=>e.engine==='qwen'&&e.type==='tool_done'&&e.data.name==='write_file'));
 await page.locator('.task-heading .status-tag').filter({hasText:'已完成'}).waitFor({timeout:10000});const downloaded=page.waitForEvent('download');await page.getByRole('link',{name:/pages-check.txt/}).click();const file=await downloaded;assert.equal((await readFile((await file.path())!,'utf8')).trim(),'PUBLIC_PAGE_OK');
 report.execution={engine:'qwen',effort:'none',fixture:'PUBLIC_PAGE_OK',isolatedData:true,sse:true,download:true};await page.screenshot({path:'acceptance/pages-task.png',fullPage:true});
 await page.getByRole('button',{name:'知识与记忆'}).click();await page.getByRole('heading',{name:'让资料成为可检索的记忆。'}).waitFor();
 assert.deepEqual(errors,[]);report.passed=true;report.pageErrors=errors;await context.request.delete(local+'/api/pair');console.log('真实 GitHub Pages → 独立本机后端 → Qwen → SSE → 固定文本下载验收通过');
}catch(e:any){report.error=e.message;throw e;}finally{await writeFile('acceptance/pages.json',JSON.stringify(report,null,2));await browser.close();if(service.pid){if(process.platform==='win32')try{execFileSync('taskkill',['/PID',String(service.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}else service.kill();}}
