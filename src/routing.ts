// 路由不额外请求模型。问答直接回复，外部操作才进入工具循环。
export function isGreeting(prompt:string){
 const p=prompt.replace(/[\s\p{P}\p{S}]/gu,'').replace(/请问|请|以及|还有|并且/gu,'');
 return /^(?:(?:你好|您好|嗨|哈喽|hello|hi|hey|你是谁|你叫什么名字|你叫什么|介绍一下你自己|介绍下你自己|自我介绍|你能做什么|你可以做什么|谢谢你|谢谢|早上好|晚上好|在吗))+$/i.test(p);
}
export function requiresTools(prompt:string){
 const text=prompt.replace(/```[\s\S]*?```/g,'').trim();
 if(/^(?:请问[，,\s]*)?(?:请|帮我)?(?:解释|讲解|介绍|比较|分析这段|什么是|为什么|如何|怎么|what\b|why\b|how\b|explain\b|compare\b)/i.test(text)&&!/(?:请|帮我|替我|现在|实际|直接|然后|并且?|同时)(?:在本机)?(?:运行|执行|修改|读取|创建|保存|部署|联网|搜索)/.test(text))return false;
 if(/https?:\/\//i.test(text))return true;
 if(/(?:联网|上网|搜索一下|搜一下|查一下|调研|搜集资料|查询最新|核实最新|实时(?:数据|天气|价格)|今天的(?:天气|新闻|行情))/.test(text))return true;
 if(/(?:读取|打开|检查|修改|编辑|删除|移动|重命名|列出|扫描|整理|搜索|检索)[\s\S]{0,100}(?:文件|目录|文件夹|附件|工作区|代码库|仓库|本机|项目|[\w-]+\.(?:md|txt|csv|json|py|ts|js|html|pdf|docx|xlsx))/i.test(text))return true;
 if(/(?:创建|新建|生成|写入|保存|导出)[\s\S]{0,100}(?:文件|目录|文件夹|PDF|Word|PPT|Excel|表格|报告|文档|网页|网站|程序|应用|脚本|[\w-]+\.[a-z0-9]{1,8})/i.test(text))return true;
 if(/(?:^|[，。；\s]|帮我|请|替我|直接|并)(?:运行|执行|部署|发布|提交|安装|下载|上传|克隆|构建|编译|打包|修复|启动|停止|测试)(?!时间|速度|原理|方式|方法|机制|结果是什么)/.test(text))return true;
 if(/^(?:read|write|create|delete|edit|run|execute|deploy|install|download|clone|build|fix|test)\b/i.test(text))return true;
 return false;
}
export function taskRoute(task:{prompt:string;engine:string;options?:string;hasAttachments?:boolean}){
 const options=JSON.parse(task.options||'{}'),mode=options.workflow?.mode||'balanced',prompt=options.currentPrompt||task.prompt;
 const chat=options.intent==='chat'||options.intent!=='task'&&!task.hasAttachments&&!['react','plan','reflection','team'].includes(mode)&&!requiresTools(prompt);
 if(chat)return {kind:'chat',engine:task.engine==='auto'?'qwen':task.engine,reason:'普通对话直接请求所选模型，不规划、不检索、不生成文件'};
 return {kind:'task',engine:task.engine==='auto'?'codex':task.engine,reason:mode==='balanced'?'工具任务：Qwen 研究 → DeepSeek 执行 → Codex 核验':'按所选引擎和机制执行工具任务'};
}
