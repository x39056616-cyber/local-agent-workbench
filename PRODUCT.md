# 本地 Agent 工作台

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

用户在自己的 Windows 电脑使用 Codex、DeepSeek Harness 和本地 Qwen，希望从一个中文网页提交任务并查看真实执行记录。

## Product Purpose

输入目标、提供附件，选择协作机制与模型，执行工具并交付可下载文件。此次用户确认同时改善操作直接性和模型协作的可读性，并要求打开工作台时自动启动本地 Qwen。

## Positioning

把三个实际运行的模型接入同一个本机任务服务。普通问答直接请求所选模型，自动模式使用 Qwen；真正的工具任务默认由 Qwen 研究、DeepSeek 执行、Codex 核验。答案和用户成果呈现在对话中。

## Operating Context

桌面快捷方式启动本机服务并打开网页，同时在后台准备 Bionic 中已有的 Qwen。任务历史、知识、长期记忆和成果保存在本机。普通聊天应避免规划与文件核验开销，工具任务继续保留真实协作和权限边界。

## Capabilities and Constraints

现有任务、附件、模型与强度、执行机制、审批、停止、归档恢复、向量检索、Skills、桌面连接器及本地评估均需保留。网页发布在 GitHub Pages，通过配对使用本机后端。不得上传凭据和任务数据库。Qwen 沿用已调好的上下文与推理参数；不得重新安装模型或擅自卸载已有模型。

## Brand Commitments

名称为“本地 Agent”，使用简体中文。上一版视觉可替换，真实功能和模型状态不能虚构。

## Evidence on Hand

已有源码、使用说明、上一版设计说明、隔离的浏览器回归脚本，以及三模型执行和安全边界测试。
