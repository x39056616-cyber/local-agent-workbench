// A local server restart changes the cookie token. A rejected 401 has not executed the action.
// Renew once, then retry the same request; never replay a transport failure or a paired remote request.
export async function sessionFetch(url:string,options:RequestInit,local:boolean,sessionUrl:string,request:typeof fetch=fetch){
 let response=await request(url,options);
 if(response.status===401&&local){await response.body?.cancel();const session=await request(sessionUrl,{credentials:'same-origin',signal:options.signal});if(!session.ok)return session;await session.body?.cancel();response=await request(url,options);}
 return response;
}
