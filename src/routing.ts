// 路由不额外请求模型。问答直接回复，外部操作才进入工具循环。
import {requestsWorkbenchChange} from './maintenance-intent.ts';
import {initialModel} from './model-policy.ts';
import {requestsCrawl} from './crawl-intent.ts';
export function isGreeting(prompt:string){
 const p=prompt.replace(/[\s\p{P}\p{S}]/gu,'').replace(/请问|请|以及|还有|并且/gu,'');
 return /^(?:(?:你好|您好|嗨|哈喽|hello|hi|hey|你是谁|你叫什么名字|你叫什么|介绍一下你自己|介绍下你自己|自我介绍|你能做什么|你可以做什么|谢谢你|谢谢|早上好|晚上好|在吗))+$/i.test(p);
}
// 只约束明确要求查阅外部资料的任务，普通解释与自包含计算不强制检索。
export function researchKinds(prompt:string):('web'|'local')[]{
 if(requestsWorkbenchChange(prompt))return [];
 const text=prompt.replace(/```[\s\S]*?```/g,'').replace(/(?:不(?:需要|要|用)?|无需|禁止|不得|不允许)(?:(?:运行|执行)命令[或和、])?(?:联网|上网|搜索)/g,'').replace(/(?:不需要|不要|不用|无需|禁止|不得|不允许)(?:再|额外)?(?:生成|创建|读写|读取|写入|修改|保存|导出|运行|执行)[^。！？；;，,\n但]*/g,'');
 const explain=/^(?:请问[，,\s]*)?(?:请|帮我)?(?:解释|讲解|介绍|比较|什么是|为什么|如何|怎么|what\b|why\b|how\b|explain\b|compare\b)/i.test(text)&&!/(?:帮我|替我|现在|实际|直接|然后|并且?|同时)(?:去)?(?:查找|查阅|查|搜|检索|读取|联网)/.test(text);
 const urls=/https?:\/\//i.test(text),local=/(?:读取|查找|查阅|查询|检索|搜索|分析|总结|根据|从)[^。！？；;，,\n]{0,100}(?:本地|知识库|资料库|附件|文件|目录|仓库)|(?:知识库|资料库|附件)[^。！？；;，,\n]{0,40}(?:查|搜|检索|总结)|附件文件：/.test(text);
 if(explain&&!urls&&!requestsCrawl(text))return [];
 const platformLookup=/(?:github|bilibili|youtube|reddit|twitter|小红书|微博|B站|知乎)/i.test(text)&&/(?:找|搜|查|热门|热榜|趋势|最新|本月|这一个月|近[一\d]+[天月周])/i.test(text);
 const web=urls||platformLookup||requestsCrawl(text)||!local&&/(?:联网|上网|调研|搜集资料|查资料|查找资料|搜索|搜一下|查一下|找[\s\S]{0,40}(?:资料|来源|文献|论文)|查[\s\S]{0,40}(?:最新|资料|来源|文献|论文)|今天的(?:天气|新闻|行情)|实时(?:数据|天气|价格))/.test(text);
 return [...(web?['web' as const]:[]),...(local?['local' as const]:[])];
}
export function requiresFileDelivery(prompt:string){
 const text=prompt.replace(/```[\s\S]*?```/g,'');
 if(/^(?:请|帮我)?(?:解释|介绍|如何|怎么)/.test(text)&&!/(?:然后|并且?|直接|实际|替我)(?:创建|保存|修改|生成|导出)/.test(text))return false;
 for(const match of text.matchAll(/(?:创建|新建|生成|写入|保存|导出|制作|修改|编辑)[^。！？\n]{0,70}(?:文件|PDF|Word|PPT|Excel|[a-z0-9_-]+\.(?:md|txt|json|csv|py|ts|js|html|pdf|docx|pptx|xlsx))/gi))if(!/(?:不需要|不要|不用|无需)(?:再|额外)?$/.test(text.slice(Math.max(0,match.index!-8),match.index)))return true;
 return false;
}
export function requiresTools(prompt:string){
 if(requestsWorkbenchChange(prompt))return true;
 const text=prompt.replace(/```[\s\S]*?```/g,'').trim();
 if(researchKinds(prompt).length)return true;
 if(requestsCrawl(text))return true;
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
 const chat=options.intent==='chat'||options.intent!=='task'&&!options.maintenance&&!task.hasAttachments&&!['react','plan','reflection','team'].includes(mode)&&!requiresTools(prompt);
 const selected=task.engine==='auto'?initialModel(prompt,options.routingPreference):task.engine;
 if(chat)return {kind:'chat',engine:selected,reason:'普通对话直接请求所选模型，不规划、不检索、不生成文件'};
 return {kind:'task',engine:selected,reason:mode==='balanced'?'工具任务：按已指定的三个协作角色执行':'按任务与偏好选择引擎；实际选择还会检查连接和本机反馈'};
}
