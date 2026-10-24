import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {RunContext} from './config.ts';

// Resolve with the caller's workspace policy; never persist the data URL in task events.
export async function imageInput(ctx:RunContext,file:string,resolve:(workspace:string,file:string)=>Promise<string>){
 ctx.signal.throwIfAborted();const p=await resolve(ctx.task.workspace,file),s=await fs.stat(p);
 if(!s.isFile()||s.size===0||s.size>5_000_000)throw new Error('图片必须是小于 5 MB 的 PNG、JPEG 或 WebP 文件');
 const bytes=await fs.readFile(p,{signal:ctx.signal});
 const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':'';
 if(!mime)throw new Error('图片格式无效；请使用 PNG、JPEG 或 WebP，不能用文本或改扩展名冒充图片');
 return {path:path.relative(ctx.task.workspace,p),mime,bytes:bytes.length,hash:createHash('sha256').update(bytes).digest('hex'),dataUrl:'data:'+mime+';base64,'+bytes.toString('base64')};
}
