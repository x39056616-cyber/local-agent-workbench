// 维护沙箱禁止派生进程，使用 TypeScript 内存转换与 Vite/Rollup JS 构建，不关闭沙箱。
import path from 'node:path';
import ts from 'typescript';
import {build} from 'vite';
const stage=process.cwd();
const production:ts.TransformerFactory<ts.SourceFile>=context=>source=>{
 const visit:ts.Visitor=node=>{if(ts.isPropertyAccessExpression(node)&&node.name.text==='NODE_ENV'&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='env'&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='process')return context.factory.createStringLiteral('production');return ts.visitEachChild(node,visit,context);};
 return ts.visitNode(source,visit) as ts.SourceFile;
};
await build({configFile:false,root:path.join(stage,'web'),base:'./',esbuild:false,resolve:{preserveSymlinks:true},plugins:[{name:'maintenance-typescript',enforce:'pre',transform(code,id){if(!/\.[cm]?[jt]sx?$/.test(id.split('?')[0]))return null;return {code:ts.transpileModule(code,{fileName:id.split('?')[0],compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX},transformers:{before:[production]}}).outputText,map:null};}}],build:{outDir:path.join(stage,'dist'),emptyOutDir:true,minify:false,cssMinify:false}});
