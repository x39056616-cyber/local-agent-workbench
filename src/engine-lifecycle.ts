export function engineLifecycle(events:any[],engine:string,now=Date.now()){
 const open:number[]=[];let starts=0,success=0,failed=0,duration=0;
 const close=(at:number,error:boolean)=>{const start=open.pop();if(start===undefined)return;duration+=Math.max(0,at-start);if(error)failed++;else success++;};
 for(const e of events){const at=Date.parse(e.created);if(e.engine===engine){if(e.type==='engine_start'){starts++;open.push(at);}else if(e.type==='engine_done')close(at,false);else if(e.type==='engine_error')close(at,true);}
  if(e.type==='auto_recovery'&&e.data.from===engine)close(at,true);
  if(e.type==='status'&&['failed','cancelled','succeeded','interrupted'].includes(e.data.status))while(open.length)close(at,true);
 }
 return {starts,success,failed,open:open.length,duration:duration+open.reduce((n,t)=>n+Math.max(0,now-t),0)};
}
