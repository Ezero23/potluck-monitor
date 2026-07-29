# Potluck Monitor 深层操作盘点（迁移 Web 候选清单）

> 生成日期：2026-07-28。基于 v0.35.0 源码静态分析。
> 用途：评估哪些"深层操作"（设置/维护动作，区别于被动看数据）可以迁移到 Potluck Web 端。
> 结论分两类：**must-stay-desktop**（本质上依赖本机能力）/ **could-move-to-web**（纯配置/数据）。

## 迁移的技术前提

当前 hub API（`src/hub/server.js:104-152`）是只读数据面（stats/devices/history/stream/ingest）。
迁配置到 Web 的最干净路径：hub 增加 secret 守卫的 `GET/PATCH /api/settings` 端点，
对接 main.js 唯一的配置写入点 `settings:get`/`settings:update`（`main.js:4177/4199`）——
单写者不变，可覆盖约 80% 的可迁面。不建议 Web 直接读写 settings.json（双写风险，
且 hubMode=local 时根本没有服务在监听）。

## 1. Widget 设置面板（renderer/index.html）

### could-move-to-web（纯配置数据）

| 项 | 位置 | 备注 |
|---|---|---|
| 界面语言 | index.html:42 | Web 端需自己的一份偏好 |
| 主视图可见性+排序（home/project/session/limits/trends/status） | :130-138 | 纯 JSON 偏好 |
| 货币与汇率 | :139-160 | |
| 主题预设/主题代码导入导出/颜色网格 | :285-330 | 仅当 Web 复用同一主题体系才有意义 |
| 工具"显示"勾选与排序 | :341-349 | "采集"勾选见下行 |
| 自定义模型定价 | :428-464 | 纯 JSON |
| Limits 提供方启用/排序/刷新间隔/显示选项 | :475-492 | 刷新间隔只是个数字 |
| 账号类（字符串凭据）：Claude/Cursor/Qoder/Ollama cookie 粘贴；DeepSeek/Minimax/Z.ai/Z.ai Team/Kimi/Volcengine/OpenRouter/Brave/Tavily/NVIDIA/第三方 key；MiMo 账号；OpenCode profile | :502-1129 | 存 settings 的字符串 |
| GitHub Copilot device-flow 登录 | :983-1017 | 浏览器+API 流程，无本地进程 |
| Sync/Hub 全部设置：模式、URL+secret、上传频率、host 端口、secret 重新生成、设备 ID | :1246-1303 | regenerate 就是一次 settings 变更+重启监听 |

### must-stay-desktop（本机能力）

| 项 | 位置 | 原因 |
|---|---|---|
| 开机自启 | :57 | OS login item |
| App 自更新（检查/下载/安装） | :68-89 | 替换本机二进制 |
| tokscale CLI 更新/重置 | :91-104 | spawn npm、换二进制 |
| Open Config 目录 | :110 | shell.openPath |
| 窗口行为（悬浮/普通/钉桌面）、全局快捷键 | :172-190 | 原生窗口/快捷键 |
| 悬浮气泡与托盘的所有开关与内容编排 | :194-250 | 气泡/托盘本身就是桌面窗口 |
| 玻璃/透明/缩放/动效 | :263-283 | 原生窗口渲染 |
| 工具"采集"勾选、采集频率、WSL 扫描 | :341-388 | 控制本机文件监听与扫描 |
| 会话归档清理 | :365-377 | 删本地数据 |
| 数据导出（自动/手动、目录选择） | :389-426 | 写本地磁盘+原生对话框 |
| Codex 托管多账号（codex login 子进程、managed CODEX_HOME、切换系统账号改写 ~/.codex/auth.json） | :532-565 | 子进程+凭据文件 |
| 本地会话自动探测（Claude Code/opencode/grok/kiro/gemini-cli） | — | 本质就是本地探测 |

## 2. Dashboard 窗口（dashboard.html/dashboard.js）

**整个窗口 could-move-to-web**：纯只读分析页（Overview/Trends/heatmap/breakdown），
数据来自 `dashboard:getHistory`，hub 已有 `/api/history`。这正是 Web UI 的本职。

## 3. 托盘菜单（tray.js:100-172）

全部 **must-stay-desktop**（触发本地重采、聚焦窗口、Codex 快速切号、窗口形态、退出）。
其中"托盘显示内容"偏好本身是数据，可远程写。

## 4. IPC 维护操作（main.js:4177-5283）

- could-move-to-web：`settings:get/update`（核心配置面）、`pricing:lookup`、`stats:get`、
  `session:getDetail`、`serviceStatus:get`、`hub:getInfo/regenerateSecret`、
  各 cookie/key 登录与 profile CRUD、`copilot:signIn`、`dashboard:getHistory`。
- must-stay-desktop：`sessionUsageArchive:clear`、`appearance:preview`、窗口/气泡/托盘
  全家、`export:*`、`clipboard:write`（小组件快捷复制）、`app:openExternal/openUserData`、
  `tokscale:*`、`appUpdate:*`、`codex:accounts/*` 与 `codex:switchSystemAccount`。

## 5. 建议的迁移优先级（供讨论）

1. **dashboard 分析页** —— 零风险，hub 已有数据端点，Web 直接复刻。
2. **账号凭据管理**（cookie/key 粘贴类）—— 用户操作最频繁的深路径，Web 大表单体验远好于小组件。
3. **Sync/Hub 设置** —— 配合自动配对，大部分场景已被零配置覆盖，迁移优先级反而降低。
4. **主题/视图/定价等偏好** —— 价值低，最后做或不做了。

## 6. 已随一体化完成/进行中的项（2026-07-28）

- [x] 隧道 URL + 控制台密码复制：小组件隧道卡片（Potluck 推送 payload 新增 `tunnel` 与
      `dashboardPassword` 字段，仅回环推送）——Phase 1/2 实施。
- [x] "打开 Web 配置"入口：小组件设置页按钮 `shell.openExternal(http://127.0.0.1:<port>)`——Phase 2。
- [ ] 其余项：待逐条讨论后另立任务。
