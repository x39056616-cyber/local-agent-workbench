import http from 'node:http';
import https from 'node:https';
import {ProxyAgent,request} from 'undici';
import {config} from './config.ts';
import {publicAddress} from './tools.ts';
import {gunzip,inflate,brotliDecompress} from 'node:zlib';
import {promisify} from 'node:util';

export type Resource={url:string;type:string;bytes:Buffer};
export async function publicResource(url:string,parent:AbortSignal,maxBytes=20_000_000,guard?:(url:string)=>Promise<void>,redirects=0):Promise<Resource>{
 const signal=AbortSignal.any([parent,AbortSignal.timeout(60000)]);signal.throwIfAborted();
 const {u,address}=await publicAddress(url);signal.throwIfAborted();await guard?.(u.href);signal.throwIfAborted();
 let result:{status:number;location?:string;type:string;bytes:Buffer;encoding?:string};
 if(config.webProxy){
  const target=new URL(u);target.hostname=address;const dispatcher=new ProxyAgent({uri:config.webProxy,requestTls:{servername:u.hostname}});
  try{const r=await request(target,{dispatcher,method:'GET',signal,headers:{host:u.host,'user-agent':'LocalAgent/0.1',accept:'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html,text/plain','accept-encoding':'identity'},headersTimeout:20000,bodyTimeout:20000});
   r.body.on('error',()=>{});const status=r.statusCode,type=String(r.headers['content-type']||''),location=typeof r.headers.location==='string'?r.headers.location:undefined;
   if(status>=300||status===206||Number(r.headers['content-length']||0)>maxBytes){r.body.destroy();if(status<300&&status!==206)throw new Error('文件超过大小上限');result={status,type,location,bytes:Buffer.alloc(0)};}
   else{let size=0;const chunks:Buffer[]=[];for await(const c of r.body){size+=c.length;if(size>maxBytes){r.body.destroy();throw new Error('文件超过大小上限');}chunks.push(Buffer.from(c));}result={status,type,bytes:Buffer.concat(chunks),encoding:String(r.headers['content-encoding']||'')};}
  }finally{await dispatcher.close();}
 }else result=await new Promise((resolve,reject)=>{
  const req=(u.protocol==='https:'?https:http).get(u,{signal,timeout:20000,headers:{'user-agent':'LocalAgent/0.1','accept-encoding':'identity'},lookup:(_h:any,opts:any,cb:any)=>opts?.all?cb(null,[{address,family:4}]):cb(null,address,4)},r=>{
   r.on('error',reject);const status=r.statusCode||500,type=String(r.headers['content-type']||''),location=r.headers.location;
   if(status>=300||status===206){r.destroy();resolve({status,type,location,bytes:Buffer.alloc(0)});return;}
   if(Number(r.headers['content-length']||0)>maxBytes){r.destroy();reject(new Error('文件超过大小上限'));return;}
   let size=0;const chunks:Buffer[]=[];r.on('data',c=>{size+=c.length;if(size>maxBytes){req.destroy(new Error('文件超过大小上限'));return;}chunks.push(Buffer.from(c));});r.on('end',()=>resolve({status,type,bytes:Buffer.concat(chunks),encoding:String(r.headers['content-encoding']||'')}));
  });req.on('timeout',()=>req.destroy(new Error('文件下载超时')));req.on('error',reject);
 });
 signal.throwIfAborted();
 if(result.status>=300&&result.status<400&&result.location){if(redirects>=3)throw new Error('文件重定向超过三次');return publicResource(new URL(result.location,u).href,signal,maxBytes,guard,redirects+1);}
 if(result.status>=300)throw new Error('文件返回 HTTP '+result.status);
 if(result.status===206)throw new Error('服务器只返回部分文件，不能计为完整下载');
 const decompress=new Map<string,any>([['gzip',gunzip],['deflate',inflate],['br',brotliDecompress]]).get(result.encoding||'');
 if(result.encoding&&result.encoding!=='identity'){if(!decompress)throw new Error('不支持此压缩编码');result.bytes=await (promisify(decompress) as any)(result.bytes,{maxOutputLength:maxBytes});signal.throwIfAborted();}
 return {url:u.href,type:result.type,bytes:result.bytes};
}
