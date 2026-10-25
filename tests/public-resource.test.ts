import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {publicResource} from '../src/public-resource.ts';
import {config} from '../src/config.ts';
import {pdf} from './document-fixture.ts';
import {gzipSync} from 'node:zlib';
test('二进制下载保持原字节，重定向逐跳检查；截断、大小和取消不交付半个文件',async()=>{
 const bytes=pdf('Actual bytes'),seen:string[]=[],sockets=new Set<any>(),server=http.createServer((req,res)=>{
  const url=req.url||'';seen.push(url);if(url.includes('/redirect')){res.writeHead(302,{location:'/binary'});res.end();return;}
  if(url.includes('/private')){res.writeHead(302,{location:'http://127.0.0.1/secret'});res.end();return;}
  if(url.includes('/large')){res.writeHead(200,{'content-length':'21000000'});res.end();return;}
  if(url.includes('/partial')){res.writeHead(206,{'content-type':'application/pdf'});res.end(bytes);return;}
  if(url.includes('/gzip')){res.writeHead(200,{'content-type':'application/pdf','content-encoding':'gzip'});res.end(gzipSync(bytes));return;}
  if(url.includes('/encoding')){res.writeHead(200,{'content-type':'application/pdf','content-encoding':'constructor'});res.end(bytes);return;}
  if(url.includes('/slow'))return;
  if(url.includes('/broken')){res.writeHead(200,{'content-length':'20000'});res.write('partial');setTimeout(()=>res.destroy(),10);return;}
  res.writeHead(200,{'content-type':'application/pdf'});res.end(bytes);
 });server.on('connection',s=>{sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const original=config.webProxy;config.webProxy='http://127.0.0.1:'+(server.address() as any).port;
 try{const r=await publicResource('http://93.184.216.34/redirect',AbortSignal.timeout(5000));assert(r.bytes.equals(bytes));assert.equal(r.url,'http://93.184.216.34/binary');
  await assert.rejects(publicResource('http://93.184.216.34/private',AbortSignal.timeout(5000)),/内网|本机/);assert(!seen.some(s=>s.includes('secret')));
  assert((await publicResource('http://93.184.216.34/gzip',AbortSignal.timeout(5000))).bytes.equals(bytes));await assert.rejects(publicResource('http://93.184.216.34/partial',AbortSignal.timeout(5000)),/部分文件/);
  await assert.rejects(publicResource('http://93.184.216.34/encoding',AbortSignal.timeout(5000)),/压缩编码/);
  await assert.rejects(publicResource('http://93.184.216.34/large',AbortSignal.timeout(5000)),/大小上限/);await assert.rejects(publicResource('http://93.184.216.34/broken',AbortSignal.timeout(5000)));await assert.rejects(publicResource('http://93.184.216.34/slow',AbortSignal.timeout(30)));
 }finally{config.webProxy=original;for(const s of sockets)s.destroy();await new Promise<void>(r=>server.close(()=>r()));}
});
