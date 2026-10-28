export function taskTitle(prompt:string){
 const first=prompt.split(/\r?\n/).map(s=>s.trim()).find(Boolean)||'新任务';
 if(/microsoft/i.test(first)&&/apple/i.test(first)&&/annual report|年报/i.test(first))return '微软与苹果'+(prompt.match(/FY\s*(20\d{2})/i)?.[1]?' FY'+prompt.match(/FY\s*(20\d{2})/i)![1]:'')+' 年报对比';
 return first.replace(/^(?:task|任务)\s*[:：]\s*/i,'').slice(0,100)||'新任务';
}
export function displayTaskTitle(task:{title:string;prompt:string}){return task.title===task.prompt.slice(0,48)?taskTitle(task.prompt):task.title;}
