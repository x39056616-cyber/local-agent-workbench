---
name: "本地 Agent"
description: "本机多模型协作工作台的现行视觉系统"
colors:
  primary: "#2855d9"
  primary-hover: "#1f43af"
  ground: "#f5f5f3"
  paper: "#fff"
  text: "#202128"
  muted: "#60636d"
  line: "#e7e7eb"
  control: "#cdd0d8"
  inspector: "#fafbfc"
  action-dark: "#272b36"
  action-dark-hover: "#3c4353"
  nav-active: "#e8e9ec"
  success: "#25825a"
  warning: "#a86f0c"
  danger: "#bb3440"
  tag-success-text: "#255239"
  tag-success-bg: "#e7f3eb"
  tag-warning-text: "#855300"
  tag-warning-bg: "#fff4da"
  tag-danger-text: "#982b37"
  tag-danger-bg: "#ffedf0"
typography:
  headline:
    fontFamily: "IBM Plex Sans, Microsoft YaHei, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "-0.6px"
  page-title:
    fontFamily: "IBM Plex Sans, Microsoft YaHei, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.4px"
  title:
    fontFamily: "IBM Plex Sans, Microsoft YaHei, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "IBM Plex Sans, Microsoft YaHei, Segoe UI, sans-serif"
    fontSize: "14px"
  composer:
    fontFamily: "IBM Plex Sans, Microsoft YaHei, Segoe UI, sans-serif"
    fontSize: "15px"
    lineHeight: 1.8
  label:
    fontFamily: "IBM Plex Sans, Microsoft YaHei, Segoe UI, sans-serif"
    fontSize: "13px"
  caption:
    fontFamily: "IBM Plex Sans, Microsoft YaHei, Segoe UI, sans-serif"
    fontSize: "12px"
rounded:
  tag: "5px"
  control: "6px"
  md: "8px"
  lg: "12px"
  composer: "14px"
spacing:
  step-4: "4px"
  step-6: "6px"
  step-8: "8px"
  step-10: "10px"
  step-12: "12px"
  step-16: "16px"
  step-18: "18px"
  step-20: "20px"
  step-24: "24px"
  step-28: "28px"
  step-32: "32px"
  step-40: "40px"
  step-44: "44px"
  step-48: "48px"
  step-64: "64px"
components:
  button-submit:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "0 15px"
    height: "38px"
  button-submit-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary:
    backgroundColor: "{colors.action-dark}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.action-dark-hover}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  nav-active:
    backgroundColor: "{colors.nav-active}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  status-success:
    backgroundColor: "{colors.tag-success-bg}"
    textColor: "{colors.tag-success-text}"
    rounded: "{rounded.tag}"
    padding: "3px 7px"
    typography: "{typography.caption}"
  engine-card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "20px"
  composer:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.composer}"
    padding: "20px"
---
# Design System: 本地 Agent

## Overview

**Creative North Star: "现代编辑室的多人会签"**

近白工作区与浅石灰导航形成稳定的区域关系，墨色正文承载主要信息，钴蓝标识提交与键盘焦点。界面依靠边缘对齐、细分隔线和有限圆角组织密集信息。这里的“清晰、克制”是对当前实现的描述，不是额外取得的品牌承诺。

本文件按 web/style.css 的最终级联与现有 React 组件提取。方向来源为 seed:faeb325d81835ddd；对应页面策略保存在 .impeccable/surfaces/web-main-tsx.md。没有图像 comp 或 shipping raster，亦没有把旧 Framed sheet 方向延续为规则。

**Key Characteristics:**
- 浅石灰导航、白色主区与浅灰详情区。
- 本地字体、紧凑标签、较宽任务输入。
- 用文字、图标和颜色共同表达状态。

## Colors

### Primary

钴蓝是提交、焦点与执行强调色，悬停使用更深的同色变体。其原始来源是最终 `--accent`；兼容变量 `--green` 当前同样指向钴蓝，不能据变量名推断为成功色。深墨色按钮用于设置保存等操作。

### Neutral

`ground` 用于导航底层，`paper` 用于主区，`inspector` 用于详情栏。`text`、`muted`、`line` 与 `control` 分别承担正文、辅助信息、结构线与表单边线。导航选中使用中性填充。

状态绿、琥珀与红保留给执行结果；状态标签还使用各自浅底与深色文字。协作身份圆标的低饱和色只是识别辅助，不代表任务成功。

**The Action Accent Rule.** 钴蓝用于提交、焦点和进行中的执行标记；设置页保存按钮沿用深墨色变体。

## Typography

**Display Font / Body Font:** 本地 IBM Plex Sans；回退依次为 Microsoft YaHei、Segoe UI、sans-serif。两份 TTF 分别声明常规与半粗字重区间；中文字符可能使用回退字体。关闭字体合成，数字使用 tabular-nums。

### Hierarchy

- **Headline**：首页任务标题；手机收至 (25px)。
- **Page title**：管理页面标题；手机收至 (23px)。当前任务标题另用 (23px)，手机为 (20px)。
- **Title**：章节标题；协作模型名称使用 (16px / 500 / 1.6)。
- **Body**：全局基准 (14px)，段落行高 (1.8)；首页说明与任务输入使用 composer 层级。
- **Label / Caption**：操作标签与辅助状态；个别紧凑执行状态使用 (11px)，不扩展为正文规范。

**The Text Evidence Rule.** 状态同时保留明确文字；模型参与、派发与耗时必须跟随实际配置或事件。

## Layout

桌面为固定侧栏 (240px) 与弹性主区；任务详情为弹性会话与右栏 (292px)。页头高度 (64px)。新任务主区不显示右栏，输入、标题与协作带对齐于最大宽度 (800px)，常规左右总预留 (96px)。任务输入在标题之后；执行设置统一折叠，协作带位于其下。这是当前工作台表面的表达，并不要求所有未来页面复制首页构图。

管理页最大宽度 (1200px)，内边距 (40px 44px)；设置页最大宽度 (1030px)。节奏主要为前置 spacing 标尺上的间隔，而非等宽卡片堆叠。

- (1600px) 以上：首页顶部留白增至 (80px)。
- (1200px) 以下：详情栏收至 (250px)，首页总预留收至 (64px)。
- (1100px) 以下：侧栏成为 (260px) 抽屉，页头 (60px)，配遮罩、关闭、Escape 与焦点约束。
- (800px) 以下：详情改为底部可折叠区域，首页总预留 (48px)，管理内容单列。
- (480px) 以下：页头 (56px)，首页两侧各 (20px)，三方协作改为竖排，输入容器内距 (15px)，提交至少高 (44px)。其他控件保留源码中的各自触达尺寸；不能宣称全部控件均为 (44px)。

## Elevation & Depth

当前主界面无投影层级；通过白、浅石灰、浅灰详情底与细边线建立空间关系。旧输入框的微投影已被最终声明覆盖为 none。抽屉通过半透明遮罩与层级定位表达覆盖关系，不把遮罩升级为卡片装饰。

**The Flat Surface Rule.** 工作区依靠背景与边线区分层级，现行输入容器不使用投影。

状态切换通常 (0.15s)，输入边线与抽屉/折叠箭头 (0.18s)。准备和执行圆点使用 (1.5s ease-in-out infinite) 透明度脉冲；prefers-reduced-motion 下关闭过渡与相关动画。

## Shapes

工作区整体直角，无旧版外框留白。按钮和普通输入轻圆角；容器更宽缓：卡片使用 lg，任务输入使用 composer，手机任务输入降为 lg。状态标签使用 tag；身份与状态点为圆形。边线通常 (1px)，运行标记使用 (2px) 底线，键盘焦点使用 (2px) 轮廓与 (3px) 外偏移。

## Components

### Buttons

提交为钴蓝填充、白字、文字与 SVG 箭头并列；默认最小宽度 (92px)，手机 (68px)。空输入或忙碌时禁用，禁用填充为浅灰并保留可辨文字。深墨色主按钮使用 primary 变体；次级按钮为白底细边框；文字按钮保留轻微中性悬停底。

### Chips

执行状态标签以文字配浅色底区分成功、等待、失败与中断。连接状态点旁保留“已连接”“准备中”等文字，不以颜色替代文本。

### Cards / Containers

引擎卡片为白底、细分隔边、宽缓圆角与 (20px) 内距。工具事件为浅灰蓝底与 md 圆角；任务详情区保持平面分组。协作带使用上下边线，不恢复厚重独立卡片。

### Inputs / Fields

通用输入使用 control 圆角与边线，内距 (9px 12px)。任务输入嵌入 composer，textarea 自身无边线，容器 focus-within 显示钴蓝边线。新任务 textarea 最小高 (116px)，手机 (104px)，执行中补充输入为 (64px)。原生 select 保留；禁用、错误及接入提示必须反映真实状态。

### Navigation

中性选中底与较重文字表达当前位置，SVG 为线条图标。最近任务保留状态、时间与归档动作；手机导航变抽屉，页面本身保持可读。

### 执行设置与协作信息

执行设置由 details/summary 承载，摘要含设置 SVG、文字和旋转箭头；展开后集中显示机制、角色、模型与工作目录。协作预览由当前配置计算，不固定展示默认分工。执行参与次数、工具数和耗时来自事件；右栏已派发模型通过 engine_start 过滤。准备状态可重试，运行脉冲为辅助反馈。

## Do's and Don'ts

### Do:
- Do 使用现有正文、标签与标题层级组织信息，并保留简体中文与真实模型名称。
- Do 复用钴蓝提交、深墨色保存及中性次级按钮的实际分工。
- Do 保留键盘焦点、折叠摘要、状态文字与减少动态效果设置。
- Do 在更改视觉时检查最终 CSS 级联及桌面、抽屉导航与手机布局。

### Don't:
- Don't 将模型已连接等同于本任务已经派发或已经执行。
- Don't 把计划、测试通过或设计描述写成尚未完成的终审结论。
- Don't 把旧方向的纸张纹理、器材装饰或 Framed sheet 容器重新当作现行系统依据。

未纳入规范的事项：旧 CSS 仍保留被覆盖的颜色、布局与输入阴影，提取以最终级联为准；源码内仍有少量局部字号、色值与控件尺寸差异，未据此强行造出统一标尺。已有 27 项测试与最终六页面三宽度交互回归通过。独立终审对分工真实性、持久文档与图标统一三项修复均给出 resolved，disposition 为 ship；该复核范围不等同于额外的全功能认证。真实网页已验证自动准备 Qwen、复用模型实例及 32K/单并发配置保持。
