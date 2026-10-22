// 仅识别 HTTP(S) 裸网址；代码片段、HTML 和其他协议不由此函数生成链接。
export function trimUrlToken(token:string){
 let url=token;
 while(/[.,;:!?]$/.test(url))url=url.slice(0,-1);
 for(const [open,close] of [['(',')'],['[',']'],['{','}']])while(url.endsWith(close)&&url.split(close).length>url.split(open).length)url=url.slice(0,-1);
 return {url,trailing:token.slice(url.length)};
}
