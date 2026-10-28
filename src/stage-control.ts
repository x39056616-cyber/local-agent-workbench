import {createHash} from 'node:crypto';
import {ModelRequestError} from './model-request.ts';

// Only read phases use this guard. Aborting never replays an unfinished write.
export class StageControl {
 controller=new AbortController();signal:AbortSignal;calls=0;timer:ReturnType<typeof setTimeout>;
 repeated=new Map<string,number>();
 id:string;maxCalls:number;remaining:()=>number;reserve:number;
 constructor(parent:AbortSignal,id:string,maxCalls:number,ms:number,remaining:()=>number,reserve=0){
  this.id=id;this.maxCalls=maxCalls;this.remaining=remaining;this.reserve=reserve;
  this.signal=AbortSignal.any([parent,this.controller.signal]);
  this.timer=setTimeout(()=>this.controller.abort(this.error('时间上限')),ms);this.timer.unref?.();
 }
 error(reason:string){return new ModelRequestError(`阶段 ${this.id} 达到${reason}，停止继续检索，保留已取得来源并交接`,'timeout');}
 stop(reason:string):never{const error=this.error(reason);this.controller.abort(error);throw error;}
 before(name:string,args:any){
  this.signal.throwIfAborted();if(name==='submit_stage')return;
  if(this.calls>=this.maxCalls)this.stop('调用上限');
  if(this.remaining()<=this.reserve)this.stop('检索额度上限（已为后续成果制作保留额度）');
  const key=name+':'+JSON.stringify(Object.fromEntries(Object.entries(args||{}).sort(([a],[b])=>a.localeCompare(b))));
  const n=(this.repeated.get(key)||0)+1;this.repeated.set(key,n);if(n>2)this.stop('重复读取上限');this.calls++;
 }
 after(name:string,result:any){
  if(!['web_read','fetch_url','document_search','document_read'].includes(name)||!result)return;
  const text=result.text||(result.hits||[]).map((h:any)=>h.text).join('\n');if(!text)return;
  const key='body:'+name+':'+(result.url||result.path||'')+':'+createHash('sha256').update(text.replace(/【[^】]+】/g,'').replace(/\s+/g,' ')).digest('hex');
  const n=(this.repeated.get(key)||0)+1;this.repeated.set(key,n);if(n>2)this.stop('无新增资料上限');
 }
 close(){clearTimeout(this.timer);}
}
