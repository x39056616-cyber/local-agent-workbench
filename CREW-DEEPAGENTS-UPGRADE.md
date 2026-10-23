# CrewAI 与 Deep Agents：角色任务和成果交接

本次继续改进原工作台，参考两个项目的具体设计，未安装或包裹整套 Python 框架。保留 TypeScript、SQLite、现有三引擎、任务选模和审批。

## 源码到实现

| 参考源码 | 工作台的实现 |
| --- | --- |
| [CrewAI Task](https://github.com/crewAIInc/crewAI/blob/2a5548a233d3a673ca73ff74d3bf98ea5f57ea67/lib/crewai/src/crewai/task.py)：description、expected_output、context、tools 与 guardrail | 新增 `agent_task`，每个角色必须指定任务和交付验收要求；显式交接输入与输出。后端检查实际文件、格式和完整读取，不接受只有承诺的阶段提交 |
| [Deep Agents 子任务中间件](https://github.com/langchain-ai/deepagents/blob/c89da392fbfdea1df7b6ff1ea8bad030efab090d/libs/deepagents/deepagents/middleware/subagents.py)：明确角色、任务描述和上下文边界 | writer 与 reviewer 使用独立请求，只取得本次目标、必要材料和明确复制的输入文件；不传父任务完整对话。主执行者整合结构化结果 |
| [Deep Agents 文件后端](https://github.com/langchain-ai/deepagents/blob/c89da392fbfdea1df7b6ff1ea8bad030efab090d/libs/deepagents/deepagents/backends/filesystem.py)：路径边界与后端抽象 | 子任务在专用目录工作。允许的共享文件工具继续检查路径；关闭原生写入、命令、连接器和递归入口。专用目录不是操作系统进程沙箱 |

## 新能力

`research_subtask` 继续负责只读研究；`agent_task` 补上两个角色：

- **writer**：在应用私有 `data/role-tasks/` 暂存目录把输入文件复制到 `input/`，避免向用户选择的源码仓库散落输入副本；只能写声明的 `output/` 文本路径，不能改输入或主任务目录。完整读取输入、实际生成全部成果、完整回读后才能提交；JSON 额外检查解析。成功后复制到主任务的唯一 `delegated/` 目录，登记为可预览、下载的文件。
- **reviewer**：只能读取显式交接的文件；必须完整读取所有输入，再提交 `passed`、`summary`、`issues`。后端排除已知作者与当前主模型，不能自评；没有独立候选时明确失败。最新审查未通过时，顶层 `finish_task(completed)` 被拒绝；交付文件在通过审查后又变动，也必须重验。

角色不绑定某一个模型。每次按任务类型、偏好、在线状态和既有选模策略决定；简单工作不强制凑齐三模型。父 Qwen 正占单并发队列时排除 Qwen 子模型，避免等待自己。子路由用独立事件记录，不覆盖主执行者的选模与用户评价归因。

工具示例：

```json
{
  "role": "writer",
  "task": "根据给定材料，整理两人的去重职责：张三开发、测试，李四设计，张三再次测试。",
  "expected_output": "result.json 含 people 数组，恰好两人；每人有 name 与去重 duties 数组",
  "input_files": [],
  "output_files": ["result.json"]
}
```

后续 reviewer 的 `input_files` 使用返回的 `files[].path`，`output_files` 为空。修订时把问题与旧成果作为新 writer 的输入，生成新成果后重验；不会覆盖用户原文件。也可以给独立的文本成果分配多个 writer，再交给主模型综合。

可以直接在网页输入：

> 把附件整理成调研报告：先核实资料，再派写作者生成报告，交给独立审查者检查是否遗漏事实和来源；根据具体问题修订，通过后在对话中交付报告。

默认“智能选模”与“按需执行”可动态使用上述工具。手动指定单引擎、快捷对话或基准评估不自动跨模型派发。已有 ReAct、规划、反思和团队依赖机制继续保留。

## 有界执行与恢复

- 每轮研究与角色子任务合计最多四次实际派发。角色内部最多十六次调用，失败与提交也计入；文件读写同时占用原每引擎共享预算。任务总时限不变。
- 每次最多六个输入与六个输出，每份不超过 100 KB；当前仅支持 UTF-8 文本成果。不支持子任务运行程序、部署或任意外部操作。长材料可能因预算不能完整处理，应拆小或交回主任务。
- 实际读取按工具返回的字符范围记录，预览截断不会冒充读完；`nextOffset` 指向实际返回位置。修改后旧读取记录失效。
- 以本轮目标、验收要求、输入内容哈希与成果声明生成复用键。输入变动重新执行，已交接成果被外部改动时拒绝复用。
- `agent_task_start`、`agent_task_publish`、`agent_task_done` 与错误事件记录全过程；复制中断的文件不算成功交接。暂存目录保留供检查，取消不继续启动模型或发布成果。
- 验收要求中的内容正确性由独立模型检查，文件存在、完整读取和 JSON 格式由程序检查。独立模型审查仍可能出错，不能视为客观正确性证明。没有承诺所有任务都有 90% 的原生聊天速度。

## 验收记录（2026-10-23）

- `npm run check` 通过；全套 **88 项测试通过**。新增七项覆盖文件交接、路径与工具权限、独立作者排除、格式错误修正、未提交和取消、共享派发与工具预算、长文件真实阅读、验收拒绝与变更失效。
- 两次真实请求均完成 **Qwen → DeepSeek writer → Codex reviewer → Qwen 最终交付**。DeepSeek 实际写入并回读 JSON；Codex 实际读取交接副本并审查通过。程序独立核对两人姓名与去重职责，确认结果正确；两次分别约 **64 秒、49 秒**。第二次覆盖最终的私有暂存目录实现。
- 复验入口：`scripts/role-task-check.ts`，默认连接独立验收端口 4331。完整本机验收数据保存在忽略的 `acceptance/`，不上传任务数据库、账号配置或会话原文。
- 没有进行广泛任务集的协作质量或性能基准；不能据此声称完整复现 CrewAI 或 Deep Agents。新功能是融合到原服务的受控角色任务，不是无限自主智能体池。

主要源码：`src/role-tasks.ts`、`src/tools.ts`、`src/agent.ts`、`src/engines.ts`；回归测试：`tests/role-tasks.test.ts`。
