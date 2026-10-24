import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';

test('代理的404、PDF、重定向和超大正文错误只使请求失败，不能击穿Node进程',async()=>{
 const sockets=new Set<any>();
 const proxy=http.createServer((req,res)=>{
  const url=req.url||'';
  if(url.includes('/ok')){res.setHeader('content-type','text/html');res.end('<p>service alive</p>');return;}
  res.statusCode=url.includes('/redirect')?302:url.includes('/pdf')||url.includes('/large')?200:404;
  if(res.statusCode===302)res.setHeader('location','/ok');
  res.setHeader('content-type',url.includes('/pdf')?'application/pdf':'text/html');res.setHeader('content-length','2000000');res.flushHeaders();res.write(url.includes('/large')?'x'.repeat(1_100_000):'pending body');
 });proxy.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});proxy.on('connect',(_req,socket)=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  socket.once('data',data=>{const url=data.toString().split(' ')[1];
   if(url.includes('/ok'))return socket.end('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 20\r\n\r\n<p>service alive</p>');
   const status=url.includes('/redirect')?'302 Found':'404 Not Found',headers=url.includes('/pdf')?'200 OK\r\nContent-Type: application/pdf':url.includes('/large')?'200 OK\r\nContent-Type: text/html':status+'\r\nContent-Type: text/html';
   socket.write('HTTP/1.1 '+headers+'\r\n'+(url.includes('/redirect')?'Location: /ok\r\n':'')+'Content-Length: 2000000\r\n\r\n');
   socket.write(url.includes('/large')?'x'.repeat(1_100_000):'pending body');
  });
 });await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 const code=`import assert from 'node:assert/strict';import {publicFetch} from './src/tools.ts';
 for(const p of ['missing','pdf','large'])await assert.rejects(publicFetch('http://93.184.216.34/'+p,AbortSignal.timeout(4000)));
 const r=await publicFetch('http://93.184.216.34/redirect',AbortSignal.timeout(4000));assert(r.text.includes('service alive'));
 await new Promise(r=>setTimeout(r,30));console.log('survived');`;
 try{const result=await new Promise<{code:number|null;out:string}>((resolve,reject)=>{const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',code],{cwd:process.cwd(),env:{...process.env,LA_WEB_PROXY:'http://127.0.0.1:'+(proxy.address() as any).port},windowsHide:true});let out='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>out+=x);child.on('error',reject);child.on('close',code=>resolve({code,out}));});assert.equal(result.code,0,result.out);assert(result.out.includes('survived'));}
 finally{for(const s of sockets)s.destroy();await new Promise<void>(r=>proxy.close(()=>r()));}
});
