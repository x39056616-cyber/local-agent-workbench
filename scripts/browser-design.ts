// 仅针对隔离的 LA_DATA_DIR 运行：写入明确标注的界面测试任务，不请求模型。
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/store.ts';
const base='http://127.0.0.1:4319',dir=path.resolve('acceptance/design-data');
const session=await(await fetch(base+'/api/session')).json();
assert.equal(path.resolve(session.defaultWorkspace),path.join(dir,'tasks'),'只允许连接隔离的设计验收服务');
const workspace=path.join(dir,'ui-fixture');await mkdir(workspace,{recursive:true});
await writeFile(path.join(workspace,'界面测试摘要.md'),'# 界面测试资料摘要\n\n此文件仅供视觉与下载回归测试，不是模型执行成果。\n');
const store=new Store(dir),t=store.create('界面测试 · 整理资料并核对成果 '+Date.now(),'auto',workspace);
store.update(t.id,{status:'succeeded',result:'界面测试摘要已准备。'});
store.event(t.id,'plan','system',{steps:[{title:'提取资料事实与出处',status:'completed'},{title:'制作可交付摘要',status:'completed'},{title:'核对文件与任务要求',status:'completed'}]});
for(const id of ['qwen','harness','codex']){
 store.event(t.id,'engine_start',id,{});
 store.event(t.id,'tool_start',id,{name:'read_file',args:{path:'界面测试摘要.md'}});
 store.event(t.id,'tool_done',id,{name:'read_file',result:{ok:true}});
 store.event(t.id,'engine_done',id,{result:'此为界面测试记录，未请求模型。'});
}
store.event(t.id,'message','system',{text:'摘要及来源已整理到文件中。这是一条界面测试记录，用于检查执行过程与成果下载的显示。'});
store.close();
const browser=await chromium.launch({channel:'chrome',headless:true}),errors:string[]=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#settings');await page.getByLabel('DeepSeek 接入方式').waitFor();assert.equal(await page.getByText('本地会话或网页配对已失效',{exact:false}).count(),0);await page.goto(base);await page.getByText('本机服务已连接',{exact:true}).waitFor();
 const nav=async(name:string)=>{if(await page.getByLabel('打开导航',{exact:true}).isVisible())await page.getByLabel('打开导航',{exact:true}).click();await page.locator('nav').getByRole('button',{name}).click();};
 const shot=async(name:string)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' 横向溢出');await page.screenshot({path:'acceptance/design-'+name+'.png',fullPage:true,animations:'disabled'});};
 for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:width===768?1024:width===390?844:900});
   await shot('home-'+width);
   if(width===390){const box=await page.getByRole('button',{name:'提交任务'}).boundingBox();assert(box&&box.y+box.height<=844,'手机首屏应能看到提交按钮');await page.getByLabel('打开导航',{exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.getByLabel('打开导航',{exact:true}).getAttribute('aria-expanded'),'false');}
   for(const name of ['能力与工具','知识与记忆','基准评估','已归档','运行设置']){await nav(name);await shot(name+'-'+width);}
   await nav('任务工作台');
 }
 await page.setViewportSize({width:1440,height:900});
 await page.locator('.history-open').filter({hasText:t.title}).click();await page.getByRole('heading',{name:t.title}).waitFor();await page.locator('.file-link').filter({hasText:'界面测试摘要.md'}).waitFor();await shot('task-1440');
 const dl=page.waitForEvent('download');await page.locator('.file-link').filter({hasText:'界面测试摘要.md'}).click();assert((await dl).suggestedFilename().endsWith('.md'));
 await page.locator('.history-row').filter({hasText:t.title}).getByLabel('归档：'+t.title,{exact:true}).click();await nav('已归档');const row=page.locator(`[data-task-id="${t.id}"]`);await row.waitFor();await row.getByRole('button',{name:'取消归档',exact:true}).click();await row.waitFor({state:'detached'});
 await nav('运行设置');await page.getByLabel('DeepSeek 接入方式').selectOption('api');assert.equal(await page.getByLabel('DeepSeek API Key',{exact:true}).getAttribute('type'),'password');await shot('api-settings');
 await nav('任务工作台');await page.getByRole('button',{name:'新建任务'}).click();await page.locator('.task-options>summary').click();await page.locator('.workflow-editor summary').click();assert.equal(await page.getByLabel('执行机制',{exact:true}).inputValue(),'balanced');await page.locator('.model-config summary').click();await shot('expanded-1440');
 await page.getByLabel('执行机制',{exact:true}).selectOption('team');await page.getByLabel('角色引擎 researcher').selectOption('harness');assert.equal(await page.locator('.flow-member strong').first().innerText(),'DeepSeek');await page.getByLabel('选择执行器').selectOption('qwen');await page.getByLabel('任务内容').fill('界面测试：整理附件');await page.locator('.attach-button input[type=file]').setInputFiles({name:'ui-check.txt',mimeType:'text/plain',buffer:Buffer.from('测试附件')});
 let submitted:any;await page.route('**/api/tasks',async route=>{if(route.request().method()!=='POST')return route.continue();submitted=route.request().postDataJSON();await route.fulfill({json:{id:t.id}});});await page.getByRole('button',{name:'提交任务'}).click();await page.waitForFunction(()=>!document.querySelector<HTMLTextAreaElement>('#prompt')?.value);assert.equal(submitted.engine,'qwen');assert.equal(submitted.workflow.mode,'team');assert.equal(submitted.workflow.roles[0].engine,'harness');assert.equal(submitted.files[0].name,'ui-check.txt');
 for(const width of [768,390]){await page.setViewportSize({width,height:width===768?1024:844});await shot('task-'+width);await page.locator('.inspector-toggle').click();assert(await page.locator('.file-link').filter({hasText:'界面测试摘要.md'}).isVisible());await page.locator('.inspector-toggle').click();}
 assert.deepEqual(errors,[]);await writeFile('acceptance/design-browser.json',JSON.stringify({passed:true,widths:[1440,768,390],pages:6,archiveRestore:true,download:true,attachmentPayload:true,roleSelection:true,apiKeyMasked:true,mobileMenuEscape:true,mobileSubmitVisible:true,modelRequests:false,pageErrors:errors},null,2));console.log('设计回归通过：六页面、三种宽度、附件提交参数、角色选择、归档恢复、下载、手机导航和概览。');
}finally{await browser.close();}
