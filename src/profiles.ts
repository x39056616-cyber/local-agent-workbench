import { config } from './config.ts';
import type { Desktop } from './desktop.ts';

export type Profiles=Record<string,{model?:string;effort?:string}>;
export async function modelCatalog(desktop:Desktop){const state=await desktop.status();return {
  codex:{models:state.models,currentModel:state.currentModel,currentEffort:state.currentEffort,error:state.error},
  harness:{models:[{id:'deepseek-flash',name:'deepseek-account / deepseek-flash',efforts:['off','low','high','max']}],currentModel:'deepseek-flash',error:''},
  qwen:{models:[{id:config.qwenModel,name:config.qwenModel,efforts:['none','on']}],currentModel:config.qwenModel,error:'',note:'当前 LM Studio 的接口仅验证了关闭/开启思考。开启沿用已有预算；不宣称支持多个思考深度。'}
};}
export async function validateProfiles(input:any,desktop:Desktop):Promise<Profiles>{
  if(input===undefined)return {};
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('模型配置必须是对象');
  const result:Profiles={};let catalog:Awaited<ReturnType<typeof modelCatalog>>|undefined;
  for(const [engine,p] of Object.entries(input) as [string,any][]){
    if(!['codex','harness','qwen'].includes(engine)||!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['model','effort'].includes(k)))throw new Error('模型配置字段无效');
    if(p.model!==undefined&&typeof p.model!=='string'||p.effort!==undefined&&typeof p.effort!=='string')throw new Error('模型和强度必须是字符串');
    const model=p.model||'',effort=p.effort||'';if(!model&&!effort)continue;
    catalog ||= await modelCatalog(desktop);const group=catalog[engine as keyof typeof catalog],list=group.models;
    const selected=list.find((m:any)=>m.id===(model||group.currentModel||list.find((m:any)=>m.isDefault)?.id));
    if(!selected)throw new Error(engine+' 模型不可用，请刷新能力列表');
    if(effort&&!selected.efforts.includes(effort))throw new Error(engine+' 不支持所选强度：'+effort);
    // 指定强度时也固定它所属的模型，避免全局默认模型改变导致选项无效。
    result[engine]={model:selected.id,...(effort?{effort}:{})};
  }
  return result;
}
