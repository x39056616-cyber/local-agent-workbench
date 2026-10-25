# 本地 Agent 工作台

把自然语言任务交给 Codex、DeepSeek Harness 或本地 Qwen。普通问答直接回复；需要文件、联网或本机操作的任务，默认按任务、相对成本和本机反馈选择执行器：常规任务优先 DeepSeek，本地整理考虑 Qwen，复杂工程倾向 Codex。支持本地向量检索、桌面连接器、模型强度、API 接入、任务归档和 GitHub Pages 配对网页。选模理由与评价见 [智能选模](MODEL-ROUTING.md)；浏览器、按需子任务与长结果回看见 [四项目改进](FOUR-PROJECT-UPGRADE.md)。详见 [优化说明](OPTIMIZATION.md)、[聊天与性能验收](CHAT-PERFORMANCE.md) 和 [研究及执行链自查](RESEARCH-AUDIT.md)。

发布网页：[GitHub Pages](https://x39056616-cyber.github.io/local-agent-workbench/)；源码：[local-agent-workbench](https://github.com/x39056616-cyber/local-agent-workbench)。部署与配对步骤见 [DEPLOY.md](DEPLOY.md)。

新增基于 [CrewAI 与 Deep Agents 的角色任务](CREW-DEEPAGENTS-UPGRADE.md)：按需派发 writer 制作真实文件，再由独立 reviewer 完整读取验收。角色与模型分开选择，交接与失败由后端校验；常规问答仍直接回复。

[Crawlee 网页采集](CRAWLER.md) 已接入共享工具：批量 HTTP/Chrome 采集、站内跟随与去重、正文分段读取、SQLite 队列恢复，以及 JSON、Markdown、CSV 自动交付。三个引擎都能使用，采集调度本身不调用大模型。

## 使用

[模型等待与失败恢复](PROGRESS-RECOVERY.md)：流式工具请求、真实耗时、有限退避、超时诊断，以及已完成资料的受控接管。

[图片与爬取入口修复](VISION-CRAWL-FIX.md)：工作区图片通过本地 Qwen 多模态接口识别；没有起始网址的爬取请求先搜索来源，再实际采集。

[采集期间后端退出修复](CRAWL-CRASH-FIX.md)：异常响应流不再击穿服务，重启后保留队列并按原采集记录接续。

[完整文档与目标验收](DOCUMENT-DELIVERY.md)：实际下载PDF/DOC/DOCX并提取、去重；名称、奖项证据和全文分别计数，数量或材料类型不符时不能标记完成。

1. 双击 **启动工作台.cmd** 或原有桌面快捷方式，浏览器打开 <http://127.0.0.1:4317>；本地 Qwen 同时在后台准备。
2. 选择智能选模或一个执行器，描述任务，可附加最多 5 个文件（每个不超过 5 MB）。
3. 工作目录留空时，在 `data/tasks/` 创建独立目录；也可以明确选择一个已有目录。
4. 回复直接显示在对话中，继续输入可追问。生成文件在同一对话显示预览与下载；技术日志默认折叠，右侧保留任务概览。停止或失败后，检查已有文件，再补充要求或点击“继续任务”。
5. 双击 **停止工作台.cmd** 结束本项目进程。已有 LM Studio/Bionic 和其他桌面应用保持运行。

本机已安装 Node.js 24。依赖和网页已经构建；搬到其他位置后，启动脚本会在依赖缺失时运行 `npm ci`，需要访问 npm。

## 本地 Qwen

- 默认接口：`http://127.0.0.1:1234/v1`。
- 默认模型：`qwen3.8-27b-gsq-rco`。
- 打开工作台时自动检测应用、开启本地 API，并按需加载已安装的 Qwen。已加载时直接复用；首次载入较慢时，网页先打开并显示准备状态。
- 加载请求仅传模型名称，沿用本机已调好的 32768 上下文、并发 1、GPU 与推理设置。模型准备期间提交的 Qwen 任务可等待就绪，也可以停止等待。
- 顶栏显示“Qwen 已就绪”；准备失败时点击“Qwen 未就绪 · 重试”。高级机制、角色、模型与工作目录统一放在输入框下方的“执行设置”。
- 自动开关适配本机 Bionic 1.1.8 中文界面，通过正常 UI Automation 操作，不读取或迁移认证密钥。仍可单独双击 **连接本地Qwen.cmd**。
- 通过原生模型 API 加载，避免旧版 `lms` 误连另一实例。应用装在其他位置时可设置 `LA_QWEN_APP`；`LA_AUTO_START_QWEN=0` 可关闭此功能。模型准备状态保存在忽略的 `data/qwen-startup.json`。

Codex 和 Harness 可沿用各自已有账号。DeepSeek 也可在本机「运行设置 → DeepSeek 接入」配置开发者 API Key，使用 Windows 当前用户加密保存。登录失效时在原应用登录；密钥无需发到聊天中。

## 与参考思维导图的对应

| 图中的模块 | 当前实现 |
| --- | --- |
| 感知—行动—观察循环 | Qwen 原生 tool_calls 循环；Codex、Harness 复用原生 Agent Loop |
| 大脑与规划 | 系统指令、结构化工具、显式计划、任务选模与受限接管 |
| 工作记忆 | 引擎当前消息、工具结果、任务事件、继续任务时的检查点摘要 |
| 长期记忆 | 用户主动添加/删除的事实与偏好，768 维向量与全文混合检索 |
| 工具注册 | 统一工具目录、类型/枚举/范围校验、超时、预算、错误回传 |
| MCP | Codex 的项目专用 stdio MCP 桥；Harness 通过本机插件适配同一工具服务 |
| 观察与验证 | read_file 回读、实际文件检查、完成声明；工具失败不直接当作任务成功 |
| 循环和成本控制 | 一个顶层任务、Qwen 串行、任务时限、工具调用预算、使用量事件 |
| 可观测性 | SQLite 追加事件、SSE 实时推送和断线补发、界面执行记录 |
| 异常与停止 | 请求错误回传、只读模型请求有限重试、取消自有执行器进程、重启后标记中断 |

网页展示简洁计划、行动和证据，不要求模型披露内部思维链。

## 工具与执行边界

内置工具：`plan_update`、`list_files`、`read_file`、`write_file`、`search_files`、`fetch_url`、`run_command`、`tools_search`、`skill_read`、`memory_search`、`knowledge_search`、`knowledge_index`、`desktop_search`、`desktop_call`、`finish_task`。默认智能选模由后端直接派发，避免只有 Codex 拥有主控；显式协作机制仍按其角色分派。

所有文件工具检查规范化路径与 junction/symlink。命令经 Codex 的 `workspaceWrite` 沙箱执行，网页显示确认；拒绝后不执行，不降级为无沙箱命令。共享工具调用预算可以在设置中调整；Codex/Harness 内部原生操作遵守各自运行时限制。

公开网页工具拒绝内网和回环地址、校验每次重定向，限制文本大小。Windows 下可复用已配置的本机 HTTP 代理；HTTPS CONNECT 指向已校验的公网 IP，TLS 仍核对原始域名。

本地服务只监听回环地址，验证 Host、Origin、浏览器会话和执行器令牌。执行器令牌仅用于本项目进程通信，不发送到网页。Harness 的独立运行数据放在 `data/harness/`，通过原有凭据提供者复用账号，不复制用户凭据到项目。

## 向量检索

“知识与记忆”页面可以添加记忆，导入 UTF-8 文本/Markdown，使用自然语言查询并查看来源片段。默认复用本机已有的 `text-embedding-nomic-embed-text-v1.5`（768 维），不下载新模型。向量、分块文本与模型标识保存在 SQLite；使用余弦相似度与全文命中排名融合。

资料每块最多 900 个 Unicode 字符、重叠 120 字符。模型改变时不会混用维度；索引全部成功后原子替换。删除资料或记忆同时删除相应向量。已保存但向量索引失败的记忆仍可全文检索。模型离线时明确显示全文回退，不冒充语义检索。

任务启动时检索相关资料；执行器还可按需 `knowledge_search`。通过 `knowledge_index` 索引的文件仅对当前任务可见；用户主动导入的全局知识和记忆可供各任务使用。当前采用 SQLite 内扫描，适合个人规模，尚未采用 ANN。现有 Nomic 模型偏向英文，中文召回质量需结合全文与实际资料评估。

在本机 LM Studio 使用公开 `/api/v1/models/load` 单独加载小型 embedding，防止 JIT 模型互相淘汰；不修改 Qwen 的上下文、量化、并发或已保存推理设置。

## 桌面连接器

“能力与工具”→“检测桌面连接器”，通过 Codex App Server 的 `app/installed` 和 `mcpServerStatus/list` 读取已安装运行时状态。当前账号检测到 GitHub、Search Service、Sites 等连接器。实际工具 schema 按需提供给执行器，`desktop_call` 通过官方 `mcpServer/tool/call` 调用并返回结构化业务数据，账号认证仍由 Codex 管理，不导出 OAuth。

共享桥对非只读/权限不明工具逐次确认；拒绝后不会发起调用。未知工具或未启用的连接器被拒绝。Codex 原生连接器继续遵守自身运行时审批。Harness/Qwen 可通过共享桥调用同一批连接器。富媒体、宿主 UI、桌面交互组件不能通过 JSON 桥完整呈现，相关内容在 Codex 桌面查看。某个连接器运行时可调用不代表其所有工具都已完成业务实测。

## 模型与强度

任务输入区可选当前执行器的模型和强度；运行设置可分别配置三个执行者并保存默认值。自动模式的子任务使用各自配置，任务保存提交时配置快照。新任务默认沿用现有设置，不覆盖全局配置。不支持的模型或强度会报错，不静默切换。

- Codex：从真实 `model/list` 获取可选模型与支持的强度，通过 `thread/start.model` 和 `turn/start.effort` 生效。
- DeepSeek：桌面账号支持 Flash / Pro 和本机完整的 8 档强度；也可配置 API Key。后端存在档位映射，见 [OPTIMIZATION.md](OPTIMIZATION.md)。
- Qwen：当前服务实测 `reasoning_effort:none` 关闭思考，`low` 开启思考；界面分别标为“关闭思考/开启思考”。尚未确认多个深度档位生效，因此不提供虚构的高/中/低。开启沿用现有预算与上下文。

## 当前边界

- Skills 页面“已发现指令”不等于其外部依赖已安装或功能已验证。工具只按需要读取相关 Skill。
- 已接入 Codex 可发现的桌面连接器；不能据此承诺当前桌面会话的全部宿主工具都能迁移到独立网页。
- 当前附件会保存到任务目录；内置读取器支持 UTF-8 文本。PDF、Office、图像等二进制处理，需要使用已验证的相应工具/Skill，不能直接用文本读取器解码。
- 继续任务会给新执行器会话提供已有工具结果与检查点，并要求核对文件。尚未实现任意原生会话内部的精确恢复、步骤输入变化后的完整依赖图失效或外部系统“恰好一次”执行。
- 完成声明会验证所列文件存在；结论正确性还需任务相关的测试或来源核对。模型的自评不被描述为独立证明。
- 没有额外购买 API、引入第四个完整 Agent 框架或安装第三方 Skills。长期记忆只由用户显式添加。

## 开发与验收

```powershell
npm run check
npm test
npm run build
npm run probe
node scripts/acceptance.ts codex
node scripts/acceptance.ts harness
node scripts/acceptance.ts qwen
node scripts/acceptance.ts team
node scripts/system-check.ts
node scripts/browser-check.ts
node scripts/browser-task.ts
npm run test:upgrade
node scripts/model-check.ts
node scripts/connector-check.ts
node scripts/pages-check.ts
```

真实引擎验收会使用现有账号和本地模型。固定三引擎验收的监视器仅批准该验收明确要求的 Harness/Qwen 委派，其他未知审批仍交给网页。

`acceptance/` 包含实测 JSON 与截图；`data/` 是本机运行数据，可能包含用户任务与成果，不应随源代码公开。启动脚本需要正常用户环境：开发沙箱中的临时 HOME、网络隔离与子进程限制，不能代表本机应用运行环境。

## 配置

后端直接用 Node.js 24 运行 TypeScript，React 网页由 Vite 构建。SQLite 使用 Node 自带模块。可在启动前设置 `LA_PORT`、`LA_DATA_DIR`、`LA_CODEX_BIN`、`LA_HARNESS_EXE`、`LA_HARNESS_CLI`、`LA_QWEN_URL`、`LA_QWEN_MODEL`、`LA_EMBEDDING_MODEL`、`LA_PUBLISHED_URL`、`LA_WEB_PROXY`、`LA_DEEPSEEK_API_KEY`、`LA_CODEX_TRANSPORT`；不需要修改原有软件的全局配置。默认端口 4317。

核心文件：`src/agent.ts` 管理生命周期；`src/engines.ts` 管理三引擎；`src/tools.ts` 管理共享工具与边界；`src/store.ts` 持久化；`src/server.ts` 提供网页 API。

## 参考与出处

本项目没有复制以下项目的整套实现。参考其公开文档和相关代码的组织方式，具体适配按本机实测完成：

- [Hello-Agents](https://github.com/datawhalechina/hello-agents)：Agent Loop、记忆、工具与评估的教学结构。
- [AionUi](https://github.com/iOfficeAI/AionUi)：统一工作台、会话、成员与成果面板的组织方式。本轮按用户强调的思维导图先完成独立核心，未宣称已经完成 AionUi/AionCore 的本机适配验证。
- [hyspacex/harness-cli](https://github.com/hyspacex/harness-cli)：复用现成执行器、保存执行状态与检查证据。
- [revfactory/codex-harness](https://github.com/revfactory/codex-harness)：任务输入、文件归属和完成条件的约定。
- [nanobot](https://github.com/HKUDS/nanobot)：工具循环、会话与长期记忆的分离。
- [Deep Agents](https://github.com/langchain-ai/deepagents)、[Pi](https://github.com/earendil-works/pi)、[LangGraph](https://github.com/langchain-ai/langgraph)：独立子任务、协议生命周期与持久化的参考。
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[Qwen-Agent](https://github.com/QwenLM/Qwen-Agent)：实际接口与工具调用适配依据。

React、Vite、TypeScript、Undici 与其他依赖的许可证保留在对应 npm 包中，精确版本由 `package-lock.json` 固定。源码公开托管不等于已授予开源许可证，未替用户选择许可证。

## 执行机制与基准评估（0.3）

任务输入区可选 ReAct、规划求解、反思、角色协作，工作台自身负责状态迁移与工具反馈。侧栏「基准评估」可导入本地练习题、查看预测和下载报告。范围、成本、官方评估依赖与教程对应见 [MECHANISMS.md](MECHANISMS.md)。

## 快捷对话、均衡协作、API 与归档（0.4）

新任务现默认智能选模；固定三角色协作可在执行机制中选择，交付规划、成果与独立核验记录。任务输入区可切换快捷对话或工具任务；侧栏可管理归档；运行设置支持 DeepSeek 桌面账号与开发者 API。使用、延迟实测和验证边界见 [OPTIMIZATION.md](OPTIMIZATION.md)。
