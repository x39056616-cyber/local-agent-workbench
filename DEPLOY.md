# GitHub 发布与本机连接

网页入口：https://x39056616-cyber.github.io/local-agent-workbench/

源码仓库：https://github.com/x39056616-cyber/local-agent-workbench

GitHub Pages 托管 `main` 分支的 `docs/`。这是纯静态控制台；模型、SQLite、桌面账号、文件操作仍由自己的 Windows 电脑运行。

## 使用已发布网页

1. 克隆或下载源码，安装 Node.js 24 或更高版本。
2. 双击 `启动工作台.cmd`。首次会安装锁定依赖并构建网页。
3. 本机浏览器打开 http://127.0.0.1:4317 ，进入“运行设置”，点击“连接 GitHub 网页”。
4. 会打开已经配对的 GitHub 网页。若浏览器询问访问本地网络，请允许。
5. 在 GitHub 网页中正常提交任务、看执行记录、审批和下载成果。

每次配对生成随机令牌。令牌通过 URL fragment 传入，网页立即移除 fragment，只保存在当前标签页的 `sessionStorage`；fragment 不会随 HTTP 请求发送到 GitHub。不要复制或分享带 fragment 的配对链接。

本机服务只监听 `127.0.0.1`，仅允许主动配对的网页 Origin，远程 API 使用 Bearer 令牌。执行器认证与网页配对令牌分离。点击“关闭网页连接”、重新配对或重启服务会使旧连接失效。

浏览器/组织策略可能禁止 HTTPS 网页访问回环 HTTP；遇到该限制仍可使用完整本机工作台，不需要把本机 API 暴露到公网。异地电脑不能通过此网页访问你家里的模型；该设备需要自己的后端。没有自动创建公网隧道。

## 更新网页

```powershell
npm ci --ignore-scripts
npm run check
npm test
npm run build:pages
git add src web scripts tests docs package.json package-lock.json README.md DEPLOY.md .gitignore
git commit -m "Update workbench"
git push
```

GitHub 自动触发 Pages 部署。仓库设置为 Settings → Pages → Deploy from a branch → `main` / `/docs`。只发布 `docs/` 下的构建结果；后端源码不会在浏览器中执行。

`data/`、`acceptance/`、模型、密钥和依赖目录不提交。自动化验收产生的本机日志与截图也不发布。不要添加原应用的认证文件。

## 配置发布地址

换仓库时，在启动服务之前设置 `LA_PUBLISHED_URL=https://你的账号.github.io/你的仓库/`。本机配对只信任该地址的 Origin。共享同一 GitHub Pages Origin 的其他仓库没有令牌也无法使用本机 API。

当前网页与本机服务是同一套 React 源码。`npm run build` 构建本地版，`npm run build:pages` 额外更新 `docs/`。
