# 四个项目到工作台的实际改进

本次参考设计与源码，保留已有 TypeScript、SQLite、Codex、DeepSeek Harness 和 Qwen 接口。没有把四套框架叠加安装；新增的运行依赖只有 Playwright，使用本机已安装的 Chrome。

| 参考项目与源码 | 实际改动 |
| --- | --- |
| [Browser Use 页面状态](https://github.com/browser-use/browser-use/blob/3df5806a0d097a1546d92c49bcf1b28c9972c3bd/browser_use/browser/views.py) | 隔离浏览器分段返回正文、链接、可见控件编号与快照 ID；操作后刷新快照，过期快照拒绝执行 |
| [DeerFlow 子任务限额](https://github.com/bytedance/deer-flow/blob/cc013c96808e68ca99338841dd2ba997076e826d/backend/packages/harness/deerflow/agents/middlewares/subagent_limit_middleware.py) | 后端控制只读子任务，持久化每轮最多四个、每个最多十二次读取；相同目标复用结果，不允许递归或提前完成顶层任务 |
| [AnythingLLM 路由决策](https://github.com/Mintplex-Labs/anything-llm/blob/8239cd85a22d847337215988c69a8d1c0fba3c94/server/utils/AiProviders/modelRouter/index.js) | 延续按任务选模型，先用本地规则选择需要的工具组，减少无关 schema；遗漏的工具可先发现真实参数再经统一入口调用，不新增一次模型分类开销 |
| [Pi 执行循环](https://github.com/earendil-works/pi/blob/936e5f40aede9327b9142b63506ed2b68bc6b4ac/packages/agent/src/agent-loop.ts)与[上下文压缩](https://github.com/earendil-works/pi/blob/936e5f40aede9327b9142b63506ed2b68bc6b4ac/packages/coding-agent/src/core/compaction/compaction.ts) | Qwen 与 DeepSeek API 在完整工具调用组之间压缩旧记录，保留原始目标与最近调用；长工具输出用本任务 operationId 分段回看，不再只保留六万字符 |

## 可以怎样使用

- 动态网页：要求 Agent 实际打开网页、读取正文与链接；普通资料优先用成本较低的 `web_read`，必要时 `browser_open`，再用控件编号操作。
- 独立核对：自动模式可以要求先派发 `research_subtask` 核对某份材料，再由主执行者制作最终报告。任何顶层模型都可请求，后端按子任务选模，不再只有 Codex 能委派。
- 大段材料：长结果返回 `operationId` 和预览，模型可用 `tool_result_read` 指定偏移回看后半部分。全文存于本机该任务的工具记录，其他任务不能越权读取。
- 工具未直接显示：先 `tools_search` 获取真实 schema，再 `tool_invoke`。此入口继续经过原有路径、审批、预算、评估隔离检查，不是任意代码执行。

简单问题仍走快捷对话，不强制浏览器、规划或子任务。派发不是免费加速：真实 Qwen→DeepSeek 核对案例约 44 秒，只在独立核对值得额外请求时使用。

## 当前执行边界

浏览器是临时独立会话，不接管日常已登录浏览器，不自动填写密码、上传文件或接收下载。填写与按钮点击由当前网页确认；普通公开链接可以直接导航。网络请求逐个验证公网地址、固定解析 IP，通过已有 HTTP 代理保留正确 TLS 主机名；没有配置代理时浏览器网络拒绝执行，常规网页读取仍可使用。禁止 Service Worker、WebSocket、私网访问和未确认的非 GET 请求；确认后的非 GET 仅限当前页面同源。

`research_subtask` 只读、串行；后续已新增 [角色写作与独立验收](CREW-DEEPAGENTS-UPGRADE.md)，可在专用目录生成声明的文本成果，仍不是任意执行代码或外部操作的后台智能体池。父 Qwen 占用单并发队列时不会再委派给 Qwen，避免自等待；仍保留原模型配置、总工具预算与任务时限。手动指定单一引擎或运行评估时不自动派发其他模型。

上下文压缩采用本地有界摘要，不额外调用模型；字符阈值不等于精确 token 计量。Codex 和 Harness CLI 内部上下文仍由各自原生运行时管理；本次改进其共享工具输出大小，未替换其内部压缩器。

## 验收记录

- 类型检查通过；新增六项测试覆盖完整调用组、工具发现调用、长结果跨任务隔离、子任务边界和真实 Chrome 控件审批。全套 81 项回归通过。
- 真实 Qwen 请求 DeepSeek 核对给定材料，取回结论后写入 `result.md`，两个模型均有真实启动、工具与交付事件。
- 真实 DeepSeek 使用 `browser_open` 打开公开网页，获取正文、标题与真实链接，写入 `browser-report.md`；浏览器随任务结束关闭。
- 初次验收把网页标题误当成正文的一部分，断言失败；依据实际标题与链接修正验收后，复核原任务通过，没有重跑模型掩盖失败。初次记录和复核记录均保留在忽略的 `acceptance/`。
- 审批拒绝、过期快照、内网地址、未取得实际研究来源、递归委派和其他任务结果读取均被拒绝。尚未验证所有网站、登录业务流程或广泛浏览器基准，不能据此宣称与四个参考项目功能完全等同。

代码位于 `src/browser.ts`、`src/subtasks.ts`、`src/context.ts`、`src/tool-selection.ts`，接入现有共享工具服务。复验入口：`scripts/four-project-check.ts`，默认连接隔离测试端口 4330。
