# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **Blank Home after 0.2.0 / 0.2.1:** first paint no longer waits on settings, hub, tokscale, or app-update IPC. A thrown settings helper cannot skip `init()`. Home starts visible (not a hidden empty panel), and renderer script errors surface in the widget instead of leaving TOTAL TOKENS at `0`.
- **Startup hang / quota snapshot:** the first stats refresh no longer waits on quota-history snapshot IPC. Forecast modules load in the renderer without a Node `module` object.

### Added
- **Providers & Limits forecast:** Settings drill-down shows pace vs actual usage, confidence, Last Good age, optional exhaust timing, and sparklines when enough history exists — no routing advice.
- **Local quota history:** `quota-history.json` keeps raw, hourly, and cycle rollups (14 / 90 / 370 days, 25 MiB cap) for transparent forecast backtests.
- **Limits schema v2:** split `connectionStatus` / `quotaStatus`, Last Good timestamps, canonical provider ids, external/Potluck snapshot ingest, and hub quota-pool merge by `quotaPoolKey`.
- **Read-only limits export (optional):** hub `GET /api/limits/snapshot` when `TOKEN_MONITOR_LIMITS_SNAPSHOT_ENABLED=1`; widget IPC always exposes the local snapshot to the app.
<!-- app-update-notes:en:end -->

## Download

- **macOS Apple Silicon** — [potluck-monitor-0.2.2-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.2/potluck-monitor-0.2.2-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.2-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.2/potluck-monitor-0.2.2-x64.dmg)
- **Windows installer** — [potluck-monitor-Setup-0.2.2.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.2/potluck-monitor-Setup-0.2.2.exe)
- **Windows portable** — [potluck-monitor-0.2.2.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.2/potluck-monitor-0.2.2.exe)
- **Linux** — [potluck-monitor-0.2.2.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.2/potluck-monitor-0.2.2.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**macOS:** this release is unsigned. Open the `.dmg`, drag Potluck Monitor to Applications, then run:

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

If macOS says the app is damaged, that is Gatekeeper quarantine — the command above clears it. Right-click **Open** is often not enough on current macOS. Confirm **Settings → App Updates → Installed** shows `v0.2.2`. Windows may show a SmartScreen warning because no SignPath credential is configured for this repository.

### Other notes

The macOS `.zip` files are updater payloads for the same apps; most people should use the `.dmg` installers above.

Hub HTTP limits export stays **off by default** — set `TOKEN_MONITOR_LIMITS_SNAPSHOT_ENABLED=1` on the hub process only when an external consumer needs it.

### tokscale dependency

Tokscale is bundled with this app. See **Settings → Tokscale** for the exact version
and the option to download a newer version directly from npm. Tokscale is MIT,
open-source: https://github.com/junhoyeo/tokscale

</details>

---

# 中文

## 更新内容

<!-- app-update-notes:zh:start -->
### 修复
- **0.2.0 / 0.2.1 主页空白：** 首次绘制不再等待设置、hub、tokscale 或应用更新 IPC。设置页辅助函数抛错也不会跳过 `init()`。Home 一开始就是可见的（不再是隐藏空面板），渲染脚本出错会显示在窗口里，而不是把 TOTAL TOKENS 一直留在 `0`。
- **启动卡住 / 额度快照：** 首次刷新不再等待额度历史 IPC。预测模块在渲染进程里也不再依赖 Node 的 `module`。

### 新增
- **Providers & Limits 额度预测：** 设置页可展开每个连接，查看实际 vs 节奏、置信度、Last Good、可选的耗尽时间，以及有足够样本时的小折线图 —— 不提供切换/路由建议。
- **本地额度历史：** `quota-history.json` 保存原始/小时/周期三层数据（14 / 90 / 370 天，25 MiB 上限），供透明预测与回测。
- **Limits schema v2：** 拆分连接/额度状态、Last Good 时间戳、provider 规范 id、外部/Potluck snapshot 接入，以及 hub 按 `quotaPoolKey` 合并共享池。
- **只读额度导出（可选）：** hub 在 `TOKEN_MONITOR_LIMITS_SNAPSHOT_ENABLED=1` 时提供 `GET /api/limits/snapshot`；widget 本地 IPC 始终可供应用读取快照。
<!-- app-update-notes:zh:end -->

## 下载

- **macOS Apple Silicon** — [potluck-monitor-0.2.2-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.2/potluck-monitor-0.2.2-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.2-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.2/potluck-monitor-0.2.2-x64.dmg)
- **Windows 安装包** — [potluck-monitor-Setup-0.2.2.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.2/potluck-monitor-Setup-0.2.2.exe)
- **Windows 便携版** — [potluck-monitor-0.2.2.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.2/potluck-monitor-0.2.2.exe)
- **Linux** — [potluck-monitor-0.2.2.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.2/potluck-monitor-0.2.2.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**macOS：**本次发布包未签名。打开 `.dmg`，把 Potluck Monitor 拖到 Applications，然后在终端执行：

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

若系统提示「已损坏」，那是隔离标记，不是安装包坏了；上面这条命令会清掉它。较新的 macOS 上仅右键「打开」经常不够。打开后到 **设置 → App Updates → Installed** 确认是 `v0.2.2`。由于仓库尚未配置 SignPath 凭据，Windows 也可能显示 SmartScreen 提示。

### 其他说明

macOS 的 `.zip` 是同一应用的自动更新载荷；大多数用户应使用上方的 `.dmg` 安装包。

Hub 的 HTTP 额度导出**默认关闭** —— 只有外部程序需要读 hub 时才在 hub 进程上设置 `TOKEN_MONITOR_LIMITS_SNAPSHOT_ENABLED=1`。

### tokscale 依赖

Tokscale 已随应用内置。你可以在 **设置 → Tokscale** 查看确切版本，
也可以直接从 npm 下载更新版本。Tokscale 是 MIT 开源项目：
https://github.com/junhoyeo/tokscale

</details>
