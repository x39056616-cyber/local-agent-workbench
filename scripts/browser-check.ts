import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { config } from '../src/config.ts';

const dir=path.join(config.root,'acceptance');await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors:string[]=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${config.port}`,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:/把目标交给它/}).waitFor();
  await page.screenshot({path:path.join(dir,'desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'能力与工具'}).click();await page.getByRole('heading',{name:'让工具各司其职。'}).waitFor();
  await page.getByRole('button',{name:'知识与记忆'}).click();await page.getByRole('heading',{name:'让资料成为可检索的记忆。'}).waitFor();
  await page.getByRole('button',{name:/新建任务/}).click();
  const screenshots:any[]=[];
  for(const [width,height] of [[1440,1000],[820,1180],[390,844]]){
    await page.setViewportSize({width,height});await page.screenshot({path:path.join(dir,`viewport-${width}.png`),fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
    assert.equal(overflow,false,'页面不能横向溢出 '+width);screenshots.push({width,height,overflow});
  }
  assert.deepEqual(errors,[]);
  await writeFile(path.join(dir,'browser.json'),JSON.stringify({passed:true,pageErrors:errors,screenshots,checkedAt:new Date().toISOString()},null,2));
  console.log('浏览器导航、3 个尺寸、无脚本错误检查通过');
}finally{await browser.close();}
