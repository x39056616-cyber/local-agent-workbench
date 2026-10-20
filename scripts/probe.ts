import { Engines } from '../src/engines.ts';
import { toolSpecs } from '../src/tools.ts';
import { config } from '../src/config.ts';
import { Rpc } from '../src/rpc.ts';
console.log(JSON.stringify(await new Engines('',toolSpecs).health(),null,2));
const rpc=new Rpc(config.codex,['app-server']);
try{console.log('Codex 握手：',await rpc.request('initialize',{clientInfo:{name:'local_agent_probe',version:'0.1.0'}},15000));rpc.notify('initialized');const account=await rpc.request('account/read',{refreshToken:false},10000);console.log('Codex 认证：',account.account?account.account.type:'未登录');}catch(e:any){console.log('Codex 不可用：',e.message);}finally{await rpc.close();}
