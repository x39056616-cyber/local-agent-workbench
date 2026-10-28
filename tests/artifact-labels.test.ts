import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {describeArtifact} from '../src/artifact-labels.ts';
import {taskTitle,displayTaskTitle} from '../src/task-name.ts';
import {Store} from '../src/store.ts';

test('来源名称依据封面注册人而非竞争对手，区分原件与提取文本，安全读取不越界',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-labels-'));try{
 await writeFile(path.join(dir,'raw.txt'),'UNITED STATES\nFORM 10-K\nFor the fiscal year ended September 27, 2025\nApple Inc.\nCompetitors include Microsoft Corporation.');
 const doc={id:'12345678-abcd',path:'raw.pdf',textPath:'raw.txt',complete:1,pages:80,finalUrl:'https://example.com/report.pdf'};
 const pdf=await describeArtifact(dir,'raw.pdf',doc),txt=await describeArtifact(dir,'raw.txt',doc);assert.equal(pdf.displayName,'苹果 FY2025 年报');assert.equal(txt.displayName,'苹果 FY2025 年报 · 提取文本');assert(pdf.downloadName.endsWith('.pdf'));assert(!pdf.downloadName.includes('/'));
 const bad=await describeArtifact(dir,'raw.pdf',{...doc,textPath:'../private.txt'});assert(!bad.displayName.includes('PRIVATE'));
 await writeFile(path.join(dir,'unsafe.md'),'# ../../data:<script>\ntext');const result=await describeArtifact(dir,'unsafe.md');assert(!/[<>:"/\\|?*\x00-\x1f]/.test(result.downloadName));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('任务默认名去掉模板前缀，旧名称兼容显示，用户重命名可持久保存',async()=>{
 const prompt='Task: Microsoft and Apple — Annual Report Data Extraction Demo\nCompare FY2025 reports.';
 assert.equal(taskTitle(prompt),'微软与苹果 FY2025 年报对比');assert.equal(displayTaskTitle({title:prompt.slice(0,48),prompt}),taskTitle(prompt));assert.equal(displayTaskTitle({title:'我的报告',prompt}),'我的报告');
 const dir=await mkdtemp(path.join(os.tmpdir(),'la-task-name-'));let s=new Store(dir);try{const task=s.create(prompt,'auto',dir);s.update(task.id,{title:'年报对比第三轮'});s.close();s=new Store(dir);assert.equal(s.get(task.id)?.title,'年报对比第三轮');}finally{s.close();await rm(dir,{recursive:true,force:true});}
});
