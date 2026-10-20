import { Rpc } from '../src/rpc.ts';
import { config } from '../src/config.ts';
import { toolSpecs } from '../src/tools.ts';
import path from 'node:path';
const env={...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:path.join(config.data,'harness/home'),LA_PORT:String(config.port),LA_TASK_ID:'probe',LA_WORKER_TOKEN:'probe-not-a-real-token',LA_TOOLS_SPEC:JSON.stringify(toolSpecs(false)),LA_DSH_TOOLS_URL:'file:///'+path.join(path.dirname(config.harnessExe),'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js').replaceAll('\\','/')};
const rpc=new Rpc(config.harnessExe,['--expose-internals',config.harnessCli,'--profile','sdk','--patch',path.join(config.data,'harness/bridge.patch.yml')],{cwd:config.root,env});
try{console.log('握手',await rpc.request('initialize',{cwd:config.root,provider:'deepseek-account',model:'deepseek-flash'},30000));}
catch(e:any){console.log(e.message);}
finally{console.log('启动诊断',rpc.stderr.replace(/(Bearer\s+|sk-)[A-Za-z0-9._-]+/g,'[redacted]'));try{await rpc.request('shutdown',{},2000);}catch{}await rpc.close();}
