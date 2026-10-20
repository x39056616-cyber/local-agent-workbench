import { spawn, execFile } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

export class Rpc extends EventEmitter {
  child: ChildProcessWithoutNullStreams; pending = new Map<number, {resolve: (v:any)=>void; reject:(e:Error)=>void; timer:NodeJS.Timeout}>();
  seq = 0; buffer = ''; stderr = ''; ended = false;
  constructor(command: string, args: string[], options: {cwd?: string;env?: NodeJS.ProcessEnv} = {}) {
    super(); this.child = spawn(command,args,{cwd:options.cwd,env:options.env || process.env,stdio:'pipe',windowsHide:true});
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      for (;;) { const i=this.buffer.indexOf('\n'); if(i<0)break; const line=this.buffer.slice(0,i).replace(/\r$/,''); this.buffer=this.buffer.slice(i+1);
        try { const m=JSON.parse(line); if(m.id!==undefined && !m.method) { const p=this.pending.get(m.id); if(p){clearTimeout(p.timer); this.pending.delete(m.id); m.error?p.reject(new Error(m.error.message || JSON.stringify(m.error))):p.resolve(m.result);} }
          else this.emit('message',m);
        } catch { /* 诊断不作为协议 */ }
      }
      if(this.buffer.length>8_000_000){this.buffer='';this.fail(new Error('引擎协议帧过大'));this.kill();}
    });
    this.child.stderr.on('data', c=>{this.stderr=(this.stderr+c.toString()).slice(-3000);});
    this.child.on('error', e=>this.fail(e));
    this.child.on('close', code=>{this.ended=true;this.fail(new Error('引擎进程已退出，代码 '+code));this.emit('closed',code);});
  }
  fail(e:Error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();}
  send(m:any){if(this.ended)throw new Error('引擎已关闭');this.child.stdin.write(JSON.stringify(m)+'\n');}
  request(method:string,params:any={},timeout=30_000):Promise<any>{const id=++this.seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(method+' 请求超时'));},timeout);this.pending.set(id,{resolve,reject,timer});this.send({jsonrpc:'2.0',id,method,params});});}
  notify(method:string,params:any={}){this.send({jsonrpc:'2.0',method,params});}
  respond(id:any,result:any){this.send({jsonrpc:'2.0',id,result});}
  async close(){if(this.ended)return;this.child.stdin.end();await Promise.race([new Promise<void>(r=>this.child.once('close',()=>r())),new Promise<void>(r=>setTimeout(r,2000))]);if(!this.ended)this.kill();}
  kill(){if(this.ended)return;if(process.platform==='win32' && this.child.pid)execFile('taskkill',['/PID',String(this.child.pid),'/T','/F'],{windowsHide:true},()=>{});else this.child.kill('SIGTERM');}
}
