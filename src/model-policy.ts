// 前后端共用的初始策略；数值是偏好先验，不是基准成绩或 API 报价。
export const modelNames:Record<string,string>={qwen:'本地 Qwen',harness:'DeepSeek',codex:'Codex'};
export type ModelEngine='qwen'|'harness'|'codex';
export type Preference='balanced'|'quality'|'economy';
export const preferences={balanced:'质量与成本均衡',quality:'质量优先',economy:'节省额度'};
export const categories={chat:'日常问答',extract:'提取与整理',research:'联网研究',writing:'写作与分析',code:'常规代码',complex_code:'复杂工程',reasoning:'深入推理'};
export type Category=keyof typeof categories;
export function preference(value:unknown):Preference{if(value===undefined)return 'balanced';if(typeof value!=='string'||!Object.hasOwn(preferences,value))throw new Error('选模偏好无效');return value as Preference;}
export function classifyTask(text:string):Category{
 const p=text.replace(/```[\s\S]*?```/g,' [代码] ');
 const engineering=/(?:修改|修复|实现|构建|开发|重构|调试|排查|优化|迁移|部署|编写|fix|implement|refactor|debug|build|write)/i.test(p);
 if(engineering&&/(?:跨文件|多文件|架构|并发|竞态|死锁|事务|数据迁移|鉴权|认证漏洞|安全漏洞|生产故障|整个项目|大型|分布式|回归|race condition|multi.file|deadlock)/i.test(p))return 'complex_code';
 if(engineering&&/(?:代码|程序|脚本|网站|网页|应用|界面|组件|接口|前端|后端|bug|python|typescript|javascript|react|\.tsx?\b|\.py\b)/i.test(p))return 'code';
 if(/(?:联网|调研|搜集|搜索|查找|查阅|采集|抓取|爬取|帮我找|查一下|最新|本月|这一个月|近[一\d]+[天月周])/.test(p)&&/(?:github|项目|资料|新闻|文献|论文|来源|网站|网页|趋势|热榜|资讯)/i.test(p)||/https?:\/\//i.test(p))return 'research';
 if(/(?:严格证明|数学证明|复杂推理|深入推理|形式化证明|证明定理|prove.*theorem)/i.test(p))return 'reasoning';
 if(/(?:提取|分类|去重|格式转换|转成|转换为|总结以下|总结这段|摘要|整理附件|读取附件|文本词频)/.test(p))return 'extract';
 if(/(?:撰写|写一|报告|文章|文案|分析|比较|方案|建议|翻译|总结)/.test(p)||p.length>600)return 'writing';
 return 'chat';
}
const priors:Record<Category,Record<ModelEngine,number>>={
 chat:{qwen:.96,harness:.94,codex:.97},extract:{qwen:.94,harness:.94,codex:.97},
 research:{qwen:.74,harness:.92,codex:.96},writing:{qwen:.78,harness:.94,codex:.97},
 code:{qwen:.70,harness:.90,codex:.97},complex_code:{qwen:.55,harness:.73,codex:.97},reasoning:{qwen:.60,harness:.79,codex:.97}
};
export type Observation={rating?:number|null;status:string;durationMs:number};
export type Candidate={engine:ModelEngine;profile:string;available:boolean;unavailableReason?:string;observations?:Observation[]};
export function rankModels(category:Category,policy:Preference,candidates:Candidate[]){
 const costWeight={balanced:.12,quality:.02,economy:.22}[policy],relativeCost={qwen:0,harness:.3,codex:1};
 return candidates.map(c=>{
  const samples=c.observations||[],rated=samples.filter(s=>s.rating===1||s.rating===-1),failures=samples.filter(s=>s.status==='engine_error').length;
  // 少量样本向先验收缩；完成任务只证明运行成功，不自动算作高质量评价。
  const feedbackAdjustment=.20*rated.reduce((n,s)=>n+s.rating!,0)/(rated.length+4);
  const quality=Math.max(0,Math.min(1,priors[category][c.engine]+feedbackAdjustment));
  const reliabilityPenalty=.20*failures/(samples.length+4);
  const completed=samples.filter(s=>s.status==='completed'),durationMs=completed.length?completed.reduce((n,s)=>n+s.durationMs,0)/completed.length:null;
  const latencyPenalty=durationMs===null?0:Math.min(.025,durationMs/6_000_000);
  const score=quality-costWeight*relativeCost[c.engine]-reliabilityPenalty-latencyPenalty;
  return {...c,observations:undefined,score,quality,relativeCost:relativeCost[c.engine],samples:samples.length,ratings:rated.length,durationMs,reliabilityPenalty};
 }).sort((a,b)=>Number(b.available)-Number(a.available)||b.score-a.score);
}
export function initialModel(text:string,policy:Preference='balanced'):ModelEngine{return rankModels(classifyTask(text),policy,(['qwen','harness','codex'] as ModelEngine[]).map(engine=>({engine,profile:'preview',available:true})))[0].engine;}
