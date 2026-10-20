import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
import {config} from '../src/config.ts';
import path from 'node:path';
const dest=path.resolve(config.root,'docs');
if(path.dirname(dest)!==config.root||path.basename(dest)!=='docs')throw new Error('无效网页输出路径');
await rm(dest,{recursive:true,force:true});await mkdir(dest,{recursive:true});
await cp(path.join(config.root,'dist'),dest,{recursive:true});await writeFile(path.join(dest,'.nojekyll'),'');
console.log('已将纯静态网页复制到 docs；不包含后端、模型、账号或任务数据。');
