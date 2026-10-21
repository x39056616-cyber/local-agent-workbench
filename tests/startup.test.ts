import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('Qwen 自动准备只传模型名称，复用已有实例，并发启动不重复加载',{skip:process.platform!=='win32'},async()=>{
 let loaded=false,loads=0;const requests:any[]=[];
 const server=http.createServer(async(req,res)=>{
   res.setHeader('content-type','application/json');
   if(req.url==='/api/v1/models'){res.end(JSON.stringify({models:[{key:'existing-qwen',loaded_instances:loaded?[{id:'existing'}]:[]}]}));return;}
   if(req.url==='/api/v1/models/load'){let body='';for await(const c of req)body+=c;requests.push(JSON.parse(body));loads++;await new Promise(r=>setTimeout(r,600));loaded=true;res.end(JSON.stringify({status:'loaded'}));return;}
   res.writeHead(404).end('{}');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const dir=await mkdtemp(path.join(tmpdir(),'agent-startup-')),port=(server.address() as any).port;
 const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/start-qwen-api.ps1'),'-DataDirectory',dir,'-BaseUrl',`http://127.0.0.1:${port}/v1`,'-Model','existing-qwen'];
 try{
   await Promise.all([exec('powershell.exe',args,{timeout:15000,windowsHide:true}),exec('powershell.exe',args,{timeout:15000,windowsHide:true})]);
   assert.equal(loads,1);assert.deepEqual(requests,[{model:'existing-qwen'}]);
   assert.equal(JSON.parse(await readFile(path.join(dir,'qwen-startup.json'),'utf8')).status,'ready');
   await exec('powershell.exe',args,{timeout:10000,windowsHide:true});assert.equal(loads,1);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
test('Qwen 加载失败明确保存失败状态，不自动重放加载',{skip:process.platform!=='win32'},async()=>{
 let loads=0;
 const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/api/v1/models')return void res.end(JSON.stringify({models:[{key:'existing-qwen',loaded_instances:[]}]}));loads++;res.writeHead(503).end(JSON.stringify({error:'test load unavailable'}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port,dir=await mkdtemp(path.join(tmpdir(),'agent-startup-failure-'));
 try{
   await assert.rejects(exec('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/start-qwen-api.ps1'),'-DataDirectory',dir,'-BaseUrl',`http://127.0.0.1:${port}/v1`,'-Model','existing-qwen'],{timeout:10000,windowsHide:true}));
   assert.equal(loads,1);assert.equal(JSON.parse(await readFile(path.join(dir,'qwen-startup.json'),'utf8')).status,'failed');
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
