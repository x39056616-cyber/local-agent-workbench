export function toolResponse(data:any){
 const message=data.choices[0].message;
 const delta={...message,...(message.tool_calls?{tool_calls:message.tool_calls.map((t:any,index:number)=>({...t,index}))}:{})};
 return 'data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:message.tool_calls?.length?'tool_calls':'stop'}],usage:data.usage})+'\n\ndata: [DONE]\n\n';
}
