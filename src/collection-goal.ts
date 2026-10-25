export type CollectionGoal={target:number;fulltext:boolean;report:boolean;award:boolean;years:number[]};
const cn:Record<string,number>={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'二十':20,'三十':30};
export function inferCollectionGoal(prompt:string):CollectionGoal|null{
 const p=prompt.replace(/```[\s\S]*?```/g,'').replace(/(?:生成|撰写|整理成|输出|制作|导出)[^。！？；;\n]{0,60}(?:报告|文档)[^。！？；;\n]*/g,'').replace(/(?:不要|不用|禁止|无需)(?:再)?(?:下载|收集|爬取)[^。！？；;，,\n但]*/g,'');
 if(/^(?:请|帮我)?(?:解释|如何|怎么|什么是)/.test(p)&&!/(?:实际|直接|然后|替我)(?:下载|收集|爬取)/.test(p))return null;
 if(/(?:编写|写一个|写一份|生成)[^。\n]{0,80}(?:脚本|程序|示例代码)/.test(p)&&!/实际下载|并运行|然后下载|直接下载/.test(p))return null;
 const action=/爬取|抓取|收集|搜集|采集|下载|获取|找.*(?:作品|报告|论文|全文|文档)/.test(p),material=/作品|报告|论文|全文|文档|获奖信息|名单|PDF|Word|\.pdf|\.docx?\b/i.test(p);
 if(!action||!material)return null;
 const counts=[...p.matchAll(/(\d{1,5}|[二三四五六七八九]?十[一二三四五六七八九]?|[一二两三四五六七八九])\s*(?:份|篇|个|项|本|条)/g)],value=counts.at(-1)?.[1];
 const target=value?(cn[value]||(value.includes('十')?(cn[value.split('十')[0]]||1)*10+(cn[value.split('十')[1]]||0):Number(value))):1;if(!Number.isInteger(target)||target<1||target>10000)return null;
 const metadata=/只(?:要|需|收集|整理)[^。\n]{0,12}(?:名称|名单|目录|题名|信息)|不(?:需要|要|用)[^。\n]{0,8}(?:全文|报告原文)/.test(p)||!/下载|PDF|Word|全文/i.test(p)&&/作品(?:名称|目录|信息|名单)|获奖(?:名单|信息)|报告(?:目录|题名)/.test(p);
 let years:number[]=[];const range=p.match(/(?:20)?(2\d)\s*[-–—~至到]\s*(?:20)?(2\d)/);if(range){const a=2000+Number(range[1]),b=2000+Number(range[2]);if(b>=a&&b-a<=10)years=Array.from({length:b-a+1},(_,i)=>a+i);}
 return {target,fulltext:!metadata,report:/作品|报告|论文/.test(p),award:/获奖|一等奖|二等奖|award/i.test(p),years};
}
export const evidenceText=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
export function reportSignals(text:string){return [/摘要|abstract/i,/目录|table\s+of\s+contents/i,/研究背景|引言|introduction/i,/调查设计|研究方法|调研方法|methodology|methods/i,/样本|问卷|sample|questionnaire/i,/数据分析|实证分析|data\s+analysis|results/i,/结论|建议|conclusion/i,/参考文献|references/i].filter(p=>p.test(text)).length;}
