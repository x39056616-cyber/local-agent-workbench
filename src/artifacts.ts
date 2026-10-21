import {open,stat} from 'node:fs/promises';
import path from 'node:path';
import {safePath} from './tools.ts';

export async function previewArtifact(workspace:string,name:string){
 const file=await safePath(workspace,name),info=await stat(file);if(!info.isFile())throw new Error('此路径不是文件');
 const ext=path.extname(file).toLowerCase();
 if(!['.md','.txt','.json','.jsonl','.csv','.ts','.tsx','.js','.jsx','.py','.html','.css','.yml','.yaml','.toml','.xml','.log','.sh','.ps1','.sql','.rs','.go','.java','.c','.cpp'].includes(ext))return {kind:'download',path:name,bytes:info.size};
 const handle=await open(file,'r');
 try{
   const buffer=Buffer.alloc(Math.min(info.size,262144)),{bytesRead}=await handle.read(buffer,0,buffer.length,0),truncated=info.size>bytesRead;
   if(buffer.subarray(0,bytesRead).includes(0))return {kind:'download',path:name,bytes:info.size};
   const text=new TextDecoder().decode(buffer.subarray(0,bytesRead),{stream:truncated});
   return {kind:ext==='.md'?'markdown':'text',path:name,bytes:info.size,text,truncated,language:ext.slice(1)};
 }finally{await handle.close();}
}
