// 先按任务选择工具组；完整目录仍可由 tools_search 发现。权限校验不依赖此提示层。
import {requestsCrawl} from './crawl-intent.ts';
import {inferCollectionGoal} from './collection-goal.ts';
export function selectTools(specs:any[],prompt:string){
 const names=new Set(['finish_task','plan_update','list_files','read_file','write_file','search_files','tools_search','tool_invoke','skill_read','tool_result_read','research_subtask','agent_task']);
 if(/图片|照片|截图|识图|看图|附件|\.(?:png|jpe?g|webp)\b|image/i.test(prompt))names.add('image_analyze');
 const crawling=requestsCrawl(prompt);
 if(inferCollectionGoal(prompt)||/下载|全文|PDF|Word|\.(?:pdf|docx?)\b/i.test(prompt))for(const n of ['document_discover','document_collect','document_read','document_status','material_record'])names.add(n);
 if(crawling)for(const n of ['crawl_start','crawl_status','crawl_read','crawl_resume','crawl_stop'])names.add(n);
 if(!crawling&&(inferCollectionGoal(prompt)||/联网|搜索|资料|调研|查找|网页|网站|github|https?:\/\//i.test(prompt)))for(const n of ['web_search','web_read','fetch_url','desktop_search','desktop_read','browser_open','browser_read','browser_action'])names.add(n);
 if(crawling&&(!/https?:\/\//i.test(prompt)||/搜索|查找|调研|搜集/.test(prompt)))for(const n of ['web_search','web_read','desktop_search','desktop_read'])names.add(n);
 if(/运行|执行|测试|代码|程序|脚本|构建|部署|安装|python|typescript/i.test(prompt))names.add('run_command');
 if(/知识库|记忆|资料库|索引/.test(prompt))for(const n of ['knowledge_search','memory_search','knowledge_index'])names.add(n);
 if(/连接器|日历|邮箱|邮件|桌面|发布/.test(prompt))for(const n of ['desktop_search','desktop_call','desktop_read'])names.add(n);
 if(/工作台|自身|你自己|你的网页/.test(prompt))for(const n of ['workbench_read','workbench_propose_change'])names.add(n);
 // Harness 的工具集合在进程初始化时固定；保留操作入口以免中途发现能力却不可调用。
 return specs.filter(s=>names.has(s.name));
}
