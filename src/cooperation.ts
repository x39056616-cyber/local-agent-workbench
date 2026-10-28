import {classifyTask,rankModels,modelNames,chooseModel} from './model-policy.ts';
import type {Category,ModelEngine,Preference,Candidate} from './model-policy.ts';
import type {Role,Workflow} from './workflows.ts';

export type Duty={id:string;name:string;category:Category;instructions:string};
export type Cooperation={reason:string;duties:Duty[];documents:boolean;sourceReview:boolean};
// 可解释的任务启发式，不将它称为已经训练出的模型能力评测。
export function cooperationBlueprint(prompt:string):Cooperation|null{
 const text=prompt.replace(/```[\s\S]*?```/g,' [代码] '),category=classifyTask(text);
 const documents=/(?:pdf|docx?|annual reports?|10-k|年报|文档|附件)/i.test(text)&&/(?:compar(?:e|ison)|analy[sz]|对比|比较|分析|字段|field|revenue|net income|营收|净利润|extract[\s\S]{0,80}(?:csv|financial)|提取(?!正文|全文)[\s\S]{0,40}(?:信息|数据|姓名|日期))/i.test(text);
 const compound=documents||category==='complex_code'||/(?:独立(?:核验|审查)|分工|分配.*模型|多模型协作|independent(?:ly)? (?:review|verif)|deliverables|field.level evidence)/i.test(text)||
  category==='research'&&(/(?:对比|比较|核验|交付|导出|生成|保存|compar(?:e|ison)|verif|deliver|export|creat|save)/i.test(text)&&(text.match(/https?:\/\/[^\s]+/g)?.length||0)>=2||/(?:调研|研究|搜集|搜索|查找)[\s\S]{0,120}(?:并|然后)[\s\S]{0,80}(?:分析|报告|整理|总结)/.test(text));
 if(!compound)return null;
 const sourceReview=category==='research'||documents;
 const rigorous=category==='complex_code'||/(?:financial|annual report|revenue|net income|fiscal|财务|年报|营收|净利润|增长率|审计|鉴权|安全漏洞)/i.test(text);
 const duties:Duty[]=[{
  id:'researcher',name:documents?'来源获取':sourceReview?'资料研究':'任务分析',category:sourceReview?'research':'extract',
  instructions:documents?'实际获取原PDF/Word并确认正文已解析，记录文档ID、来源URL、提取路径、重复行为和失败原因。只读取少量正文确认内容，将具体字段提取留给下一阶段；不要整份逐页翻读或提前写最终文件。':sourceReview?'实际查阅相关原始来源，记录事实、来源与缺口，交给成果制作阶段。':'分析现有输入、代码与验收条件，只读核对关键边界，交给执行者。'
 }];
 if(documents)duties.push({id:'extractor',name:'字段提取',category:'extract',instructions:'根据已取得的文档ID，用 document_search 定位用户所需字段，再按需 document_read 核对上下文、单位和物理页码。输出字段、原文摘录、来源、口径与缺失项，不从记忆填值，不重复下载，不创建最终文件。'});
 duties.push({id:'builder',name:category==='complex_code'?'实现与测试':'成果整理',category:category==='complex_code'?'complex_code':category==='code'?'code':'writing',instructions:'消费上游实际取得的事实与证据，完成用户要求的分析、计算和真实成果文件，并回读检查。不要重做上游下载与提取，缺失项如实标注。'});
 duties.push({id:'reviewer',name:'独立核验',category:rigorous?'reasoning':'extract',instructions:'独立读取用户成果，核对目标、字段、来源和计算。只检查与指出有证据的问题，不重做整个任务，不把全部来源全文阅读当作必要前提；需要时定位原文核实。'});
 return {reason:documents?'文档获取、字段提取、成果整理与核验是不同工作，分别派发；每阶段使用独立上下文。':category==='complex_code'?'拆开任务分析、工程实现与独立审查，按阶段能力与成本选模。':'任务包含可交接的多个阶段，按依赖传递事实与成果，不让一个模型包办。',duties,documents,sourceReview};
}

export function assignCooperation(blueprint:Cooperation,policy:Preference,candidates:Candidate[]|Partial<Record<Category,Candidate[]>>){
 const choices:any[]=[],roles:Role[]=[];
 for(const duty of blueprint.duties){
  const ranked=rankModels(duty.category,policy,Array.isArray(candidates)?candidates:candidates[duty.category]||[]),author=roles.find(r=>r.id==='builder')?.engine;
  const eligible=ranked.filter(c=>c.available&&(duty.id!=='reviewer'||c.engine!==author));
  const chosen=chooseModel(eligible,policy);
  if(!chosen)throw new Error(duty.id==='reviewer'?'没有可用的独立核验模型；不能让作者自评冒充协作':'此阶段没有可用模型：'+duty.name);
  roles.push({id:duty.id,name:duty.name,engine:chosen.engine,instructions:duty.instructions});
  choices.push({id:duty.id,engine:chosen.engine,category:duty.category,reason:`${duty.name}交给${modelNames[chosen.engine]}：比较本阶段的适配度、相对成本和同类记录${duty.id==='reviewer'?'，排除成果作者':''}`,candidates:ranked});
 }
 return {roles,choices};
}

export function previewCooperation(prompt:string,policy:Preference='balanced'){
 const b=cooperationBlueprint(prompt);if(!b)return null;
 return assignCooperation(b,policy,(['qwen','harness','codex'] as ModelEngine[]).map(engine=>({engine,profile:'preview',available:true}))).roles;
}
