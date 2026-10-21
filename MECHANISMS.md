# 工作台自己的执行机制与评估

## 使用

新建任务 → 展开输入区上方「执行机制」。旧任务默认保留「原生引擎」。选择机制后可以调整阶段上限；角色协作可以编辑角色名称、职责和引擎。自动模式主控为 Codex，默认角色使用 Qwen、Harness、Codex；选择单一引擎时默认所有角色使用该引擎，也可手动修改。

| 模式 | 工作台负责的状态迁移 | 适用情况 |
| --- | --- | --- |
| 原生引擎 | 原有 Codex / Harness 循环、Qwen 工具循环 | 日常任务、成本较低 |
| ReAct | 结构化动作 → 后端工具执行 → 观察反馈 → 下一次决定 | 调试工具使用和逐步求解 |
| 规划求解 | 生成计划 → 校验依赖 → 按步骤求解 → 汇总检查 | 目标与步骤较明确的任务 |
| 反思 | 初稿 → 只读审查 → 按问题修订 → 再审查 | 需要校对的文案、分析和成果 |
| 角色协作 | 主控规划 → 按角色/依赖派发 → 汇总 | 研究、制作、检查分工 |

这些不是单纯更换系统提示。`src/workflows.ts` 决定状态转换、选择执行者、校验计划与结构化返回、执行真实工具、停止与续接。每个阶段通过 `submit_stage` 提交 JSON；阶段内不能自行调用共享写工具。动作由控制器交给原有带权限检查的执行服务。Codex 决策阶段使用只读沙箱、关闭应用连接器并隔离 MCP 配置；Harness 只注册阶段工具；Qwen 用原生 function calling。原生引擎模式保持原有行为。

每个阶段是一次独立引擎运行；角色独立获得职责与依赖结果，共享授权成果目录。当前按依赖顺序串行，没有并发 DAG 调度、消息总线或自主产生无限层级的子智能体。默认三位角色可编辑，规划者根据案例选择角色与步骤；不会强制每个任务使用全部角色。Qwen 保持单请求并发。

默认最多 20 个决策阶段、1 次修订，最多可设 30 个阶段、3 次修订，另受原有时间和共享工具预算约束。反思审查未通过时任务失败，不能冒充完成；审查是模型判断，不能替代实际测试。没有要求模型公开内部思维链，网页只展示计划、结构化决定、工具结果与审查意见。

继续相同任务复用已经完成的阶段和动作观察。若动作开始后中断、尚未记录结果，停止并要求核对，避免重放副作用。补充新指令会建立新检查点序列。仍应先检查已有文件。

**用量**：受控模式每一步都向模型发送任务与有限上下文，通常比原生模式消耗更多 token，Codex/Harness 启动也有额外延迟。需要省成本时选择 Qwen 或原生模式；没有硬性 token/金额上限，阶段预算不是 token 预算。模型离线会报错，不自动替换指定引擎。

## 本地评估实验室

侧栏「基准评估」：选择方法与引擎，导入 JSON 数组或 JSONL（每批 1–20 题），指定来源版本，开始评估。也可以载入自编示例。每题创建独立工作区，标准答案留在评估存储中，不进入模型提示、任务配置或工具定义；评估禁用私人记忆与知识检索。记录数据哈希、配置、阶段数、用量原始字段、耗时、工具次数、预测和错误。失败与停止计入失败，待运行题不提前算准确率。

### GAIA 方法

输入接受 `task_id / Question / Final answer / Level` 或 `id / question / answer / level`。要求最终纯答案写入 `answer.txt`。本地 scorer 处理数字、文本空白大小写标点和有序列表。当前仅支持纯文本题；带 `file_name` 的题明确拒绝，不能偷偷丢弃附件后评分。

[GAIA 数据集](https://huggingface.co/datasets/gaia-benchmark/GAIA) 当前需要用户自行接受访问条件。题库不得公开再分发，本项目没有捆绑或上传题目。正式成绩还需要固定数据版本、完整题目支持和官方评分/提交流程；网页的少量练习成绩不是官方 GAIA 分数。

### BFCL 方法与官方入口

网页当前提供**单轮函数调用练习**：只调用本地 Qwen 一次，提供题目的 JSON Schema 函数，通过原生 `tool_calls` 获得预测，不实际执行题目函数。按函数名、参数类型和值以及调用顺序严格比较。没有用字符串搜索代替工具调用。输入格式见网页的自编示例。

本地比较器不是 BFCL 官方 AST/执行/多轮评分器，尤其并行调用的可交换顺序与参数等价规则不同。因此报告始终 `official:false`。

另附 `scripts/bfcl-official.py` 可选入口，对照 [官方 BFCL](https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard) 的 `ModelConfig`、`OpenAICompletionsHandler` 和 CLI 接口，在当前进程注册本地 Qwen，不修改上游源码。需要在独立 Python 3.11 环境安装 **bfcl-eval**（不是同名 bfcl 包），并记录实际上游版本/commit。官方依赖含多个模型 SDK 与科学计算包，不是网页运行依赖。本次未安装整套官方依赖，也未宣称完成官方评分器联调。

```powershell
python scripts/bfcl-official.py doctor
# 在已安装官方 bfcl-eval 的独立环境中：
python scripts/bfcl-official.py generate --category simple_python --ids simple_python_0
python scripts/bfcl-official.py evaluate --category simple_python
```

官方入口默认串行、每次显式指定至多 20 题，只允许单轮无外部业务副作用类别。输出留在忽略的 `data/official-bfcl`。这是对**本地模型工具调用能力**的评估，不代表 Codex 主控的整个 Agent 的能力。多轮、附件、网页搜索等完整评测仍需另外的隔离环境与适配验证。

## 教程到实现

- [Hello-Agents 第七章](https://github.com/datawhalechina/hello-agents/tree/main/code/chapter7)：ReAct、Plan-and-Solve、Reflection 的分离 → `src/workflows.ts` 的受控状态迁移。
- 多角色按职责协作 → 结构化计划的 `role` / `dependsOn`，角色输入校验、独立阶段记录与串行调度。
- [Hello-Agents 第十二章](https://github.com/datawhalechina/hello-agents/tree/main/docs/chapter12)：可复现实验与基准方法 → `src/evaluation.ts` 的隔离任务、数据哈希、预测与评分记录。
- 不直接复制整套框架；现有 Node/React/SQLite、三引擎与权限服务继续复用。

单测：`npm test`。真实模型回归：先以隔离数据目录启动 4319 后执行 `node scripts/mechanisms-check.ts`；网页回归：`node scripts/browser-mechanisms.ts`。验收资料全部留在忽略的 `acceptance/`，不提交公开题目与用户历史。
