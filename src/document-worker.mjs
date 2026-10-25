// A short-lived parser process, launched only with a validated local file. No macros or external URLs execute.
import {readFile} from 'node:fs/promises';
const [file,kind]=process.argv.slice(2),bytes=await readFile(file);
console.log=(...args)=>process.stderr.write(args.join(' ')+'\n');
try{
 let text='',pages=null,emptyPages=[],truncated=false;
 if(kind==='pdf'){
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,stopAtErrors:true,verbosity:0});
  try{const pdf=await task.promise;pages=pdf.numPages;if(pages>200)throw Error('PDF 超过 200 页解析上限，原文件已保留');
   for(let i=1;i<=pages;i++){const p=await pdf.getPage(i),content=await p.getTextContent();const part=content.items.map(x=>x.str+(x.hasEOL?'\n':' ')).join('').trim();if(!part.trim())emptyPages.push(i);text+='\n\n[第 '+i+' 页]\n'+part;if(text.length>500000){truncated=true;text=text.slice(0,500000);break;}p.cleanup();}
  }finally{await task.destroy();}
 }else{
  const {default:WordExtractor}=await import('word-extractor');const doc=await new WordExtractor().extract(bytes);text=[doc.getBody(),doc.getFootnotes(),doc.getEndnotes(),doc.getTextboxes()].filter(Boolean).join('\n');if(text.length>500000){truncated=true;text=text.slice(0,500000);}
 }
 process.stdout.write(JSON.stringify({text,pages,emptyPages,truncated}));
}catch(error){process.stderr.write(String(error));process.exitCode=1;}
