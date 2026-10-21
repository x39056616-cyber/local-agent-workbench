// 配对信息只留在当前浏览器标签页，不发送给 GitHub 服务器。
const hash=new URLSearchParams(location.hash.slice(1));
if(hash.has('token')&&hash.has('backend')){
  const backend=new URL(hash.get('backend')!);if(backend.protocol==='http:'&&backend.hostname==='127.0.0.1'&&/^\d{2,5}$/.test(backend.port)){
    sessionStorage.setItem('la_backend',backend.origin);sessionStorage.setItem('la_pair',hash.get('token')!);
  }
  history.replaceState(null,'',location.pathname+location.search);
}
export const remote=location.protocol==='https:'||!['localhost','127.0.0.1'].includes(location.hostname);
const base=remote?(sessionStorage.getItem('la_backend')||'http://127.0.0.1:4317'):'';
function headers(json=false){return {...(json?{'Content-Type':'application/json'}:{}),...(remote?{Authorization:'Bearer '+(sessionStorage.getItem('la_pair')||'')}:{})};}
export async function api(url:string,method='GET',body?:any){const r=await fetch(base+'/api'+url,{method,headers:headers(body!==undefined),credentials:remote?'omit':'same-origin',body:body!==undefined?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error||'请求失败');return data;}
export function subscribe(url:string,receive:(e:any)=>void){
  const controller=new AbortController(),endpoint=new URL((base||location.origin)+'/api'+url);let cursor=Number(endpoint.searchParams.get('after')||0);
  const loop=async()=>{while(!controller.signal.aborted){try{endpoint.searchParams.set('after',String(cursor));const response=await fetch(endpoint,{headers:headers(),credentials:remote?'omit':'same-origin',signal:controller.signal});if(!response.ok)throw new Error('事件连接失败');const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='';while(!controller.signal.aborted){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});for(;;){const end=buffer.indexOf('\n\n');if(end<0)break;const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split('\n').find(l=>l.startsWith('data: '));if(data){const event=JSON.parse(data.slice(6));cursor=event.id;receive(event);}}}}catch{if(controller.signal.aborted)return;}await new Promise(r=>setTimeout(r,1500));}};
  void loop();return {close:()=>controller.abort()};
}
export async function download(taskId:string,name:string){const r=await fetch(base+'/api/tasks/'+taskId+'/file?path='+encodeURIComponent(name),{headers:headers(),credentials:remote?'omit':'same-origin'});if(!r.ok)throw new Error('下载失败');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=name.split(/[\\/]/).at(-1)!;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function imagePreview(taskId:string,name:string){const r=await fetch(base+'/api/tasks/'+taskId+'/file?path='+encodeURIComponent(name),{headers:headers(),credentials:remote?'omit':'same-origin'});if(!r.ok)throw new Error('图片预览失败');const blob=await r.blob();if(blob.size>10_000_000)throw new Error('图片超过10 MB，请下载查看');const ext=name.split('.').at(-1)?.toLowerCase(),mime=({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'} as any)[ext||''];if(!mime)throw new Error('此图片格式请下载查看');return URL.createObjectURL(new Blob([blob],{type:mime}));}
