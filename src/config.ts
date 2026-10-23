import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const user = os.homedir();
function localWebProxy(){
  if(process.env.LA_WEB_PROXY)return process.env.LA_WEB_PROXY;
  if(process.platform!=='win32')return '';
  try{const value=execFileSync('powershell.exe',['-NoProfile','-Command',"$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue; if($p.ProxyEnable -eq 1){$p.ProxyServer}"],{encoding:'utf8',timeout:2500,windowsHide:true}).trim();const match=value.match(/(?:https?=)?(127\.0\.0\.1:\d+)/);return match?'http://'+match[1]:'';}catch{return '';}
}
function codexPath() {
  if (process.env.LA_CODEX_BIN) return process.env.LA_CODEX_BIN;
  const dir = path.join(user, 'AppData/Local/OpenAI/Codex/bin');
  if (existsSync(dir)) {
    const versions = readdirSync(dir).map(x => path.join(dir, x, 'codex.exe')).filter(existsSync);
    if (versions.length) return versions.at(-1)!;
  }
  return 'codex';
}
export const config = {
  root: ROOT, data: path.resolve(process.env.LA_DATA_DIR || path.join(ROOT, 'data')),
  port: Number(process.env.LA_PORT || 4317), codex: codexPath(),
  qwenBase: process.env.LA_QWEN_URL || 'http://127.0.0.1:1234/v1',
  qwenModel: process.env.LA_QWEN_MODEL || 'qwen3.8-27b-gsq-rco',
  embeddingModel: process.env.LA_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5',
  publishedUrl: process.env.LA_PUBLISHED_URL || 'https://x39056616-cyber.github.io/local-agent-workbench/',
  webProxy:localWebProxy(),
  harnessExe: process.env.LA_HARNESS_EXE || path.join(user, 'AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe'),
  harnessCli: process.env.LA_HARNESS_CLI || path.join(user, 'AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  skillRoots: [path.join(user, '.codex/skills'), path.join(user, '.agents/skills')],
};
export type Engine = 'auto' | 'codex' | 'harness' | 'qwen';
export type Status = 'queued' | 'running' | 'waiting' | 'cancelling' | 'cancelled' | 'interrupted' | 'succeeded' | 'failed';
export interface Task {
  id: string; title: string; prompt: string; engine: Engine; workspace: string; status: Status;
  created: string; updated: string; result: string; error: string; session: string; options?: string; archived?: number;
}
export interface EventRecord { id: number; taskId: string; type: string; engine: string; data: any; created: string }
export interface RunContext {
  navigationOrigins?:string[];
  navigationAllowed?:(url:string)=>boolean;
  onCompleted?:()=>void;
  chat?: boolean;
  stage?: {id:string;readOnly:boolean;onSubmitted?:()=>void}; specs?: any[];
  task: Task; signal: AbortSignal; emit: (type: string, engine: string, data: any) => void;
  tool: (name: string, args: any, engine: string) => Promise<any>;
}
export function errorText(e: unknown): string { return e instanceof Error ? e.message : String(e); }

// 仅覆盖本应用子进程，保留用户全局 Codex 配置与登录。设 LA_CODEX_TRANSPORT=inherit 可沿用自定义供应商。
export const codexHttpArgs=process.env.LA_CODEX_TRANSPORT==='inherit'?[]:['-c','model_provider="workbench-http"','-c','model_providers.workbench-http={name="Workbench HTTP",wire_api="responses",requires_openai_auth=true,supports_websockets=false}'];
