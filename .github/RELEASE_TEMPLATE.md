# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **Renderer crash on launch:** `quotaForecast.js` / `quotaRisk.js` no longer declare global `quotaForecastApi` / `quotaRiskApi` names that collided with `app.js` when loaded as classic scripts — the widget showed `SyntaxError: Identifier 'quotaForecastApi' has already been declared` and stayed at TOTAL TOKENS 0.
- **Blank Home boot:** first paint no longer waits on settings, hub, tokscale, or app-update IPC; Home starts visible and renderer errors surface in the widget.
<!-- app-update-notes:en:end -->

## Download

- **macOS Apple Silicon** — [potluck-monitor-0.2.3-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.3/potluck-monitor-0.2.3-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.3-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.3/potluck-monitor-0.2.3-x64.dmg)
- **Windows installer** — [potluck-monitor-Setup-0.2.3.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.3/potluck-monitor-Setup-0.2.3.exe)
- **Windows portable** — [potluck-monitor-0.2.3.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.3/potluck-monitor-0.2.3.exe)
- **Linux** — [potluck-monitor-0.2.3.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.3/potluck-monitor-0.2.3.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**macOS:** this release is unsigned. Open the `.dmg`, drag Potluck Monitor to Applications, then run:

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

If macOS says the app is damaged, that is Gatekeeper quarantine — the command above clears it. Confirm **Settings → App Updates → Installed** shows `v0.2.3`.

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
- **启动即崩溃：** `quotaForecast.js` / `quotaRisk.js` 不再在全局声明与 `app.js` 冲突的 `quotaForecastApi` / `quotaRiskApi`，避免经典 script 加载时报 `SyntaxError: Identifier 'quotaForecastApi' has already been declared`，窗口一直停在 TOTAL TOKENS 0。
- **主页空白启动：** 首次绘制不再等待设置、hub、tokscale 或应用更新 IPC；Home 一开始可见，渲染错误会显示在窗口里。
<!-- app-update-notes:zh:end -->

## 下载

- **macOS Apple Silicon** — [potluck-monitor-0.2.3-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.3/potluck-monitor-0.2.3-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.3-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.3/potluck-monitor-0.2.3-x64.dmg)
- **Windows 安装包** — [potluck-monitor-Setup-0.2.3.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.3/potluck-monitor-Setup-0.2.3.exe)
- **Windows 便携版** — [potluck-monitor-0.2.3.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.3/potluck-monitor-0.2.3.exe)
- **Linux** — [potluck-monitor-0.2.3.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.3/potluck-monitor-0.2.3.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**macOS：**本次发布包未签名。打开 `.dmg`，把 Potluck Monitor 拖到 Applications，然后在终端执行：

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

若提示「已损坏」，那是隔离标记；上面命令会清掉。打开后到 **设置 → App Updates → Installed** 确认是 `v0.2.3`。

### tokscale 依赖

Tokscale 已随应用内置。你可以在 **设置 → Tokscale** 查看确切版本，
也可以直接从 npm 下载更新版本。Tokscale 是 MIT 开源项目：
https://github.com/junhoyeo/tokscale

</details>
