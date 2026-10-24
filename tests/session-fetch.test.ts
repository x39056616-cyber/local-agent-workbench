import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionFetch} from '../web/session-fetch.ts';
test('本机重启后401只续会话一次，网络错误与远程配对不重放',async()=>{
 const calls:string[]=[];const request:any=async(url:string)=>{calls.push(url);return new Response('{}',{status:calls.length===1?401:200});};
 const r=await sessionFetch('/api/tasks',{method:'POST',body:'{}'},true,'/api/session',request);assert.equal(r.status,200);assert.deepEqual(calls,['/api/tasks','/api/session','/api/tasks']);
 calls.length=0;const remote=await sessionFetch('/api/tasks',{},false,'/api/session',request);assert.equal(remote.status,401);assert.equal(calls.length,1);
 let attempts=0;await assert.rejects(sessionFetch('/api/tasks',{method:'POST'},true,'/api/session',(async()=>{attempts++;throw new Error('connection reset');}) as any));assert.equal(attempts,1);
});
