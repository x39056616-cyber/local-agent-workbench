// 此模块同时被前后端路由使用，不能依赖 Node.js 或后端维护实现。
export function requestsWorkbenchChange(prompt:string){
 const p=prompt.replace(/```[\s\S]*?```/g,'');
 return /(?:修改|修复|改进|优化|调整|美化|改一下|改一改|改造)/.test(p)&&/(?:你自己|自己修改自己|本工作台|工作台自身|这个\s*agent|本应用|你的(?:界面|网页|链接|功能|代码)|聊天界面|对话界面)/i.test(p)&&!/(?:不要|禁止|不得)(?:修改|修复|调整)(?:你自己|本工作台|本应用)/.test(p);
}
export function maintenanceScope(current:string,previous=false){
 return requestsWorkbenchChange(current)||previous&&/^(?:继续(?:改|修|调整|优化)?[。！!\s]*$|继续(?:修改|修复|调整|优化)|再(?:改|修|调整)|改成|还是不行|没有生效|为什么.*(?:失败|没生效))/.test(current.trim());
}
export function workbenchApplicationRequired(current:string,scope=false){
 return requestsWorkbenchChange(current)||scope&&/^(?:继续|再改|再修|改成|还是不行|没有生效)/.test(current.trim());
}
