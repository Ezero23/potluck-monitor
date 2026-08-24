# English

## What's changed

<!-- app-update-notes:en:start -->
### Changed
- **Provider lists show existing quota by default:** Home and Limits keep any provider that already has quota data, even if its local-probe checkbox is off. Settings has **Enable all**, and Home shows up to 50 accounts by default.

### Fixed
- **Laggy provider checkboxes:** toggling a provider no longer rebuilds the whole Settings page or force-refreshes stats, which made a single click feel like it cancelled itself and froze dropdowns.
- **Automatic updates could fail silently:** enabling **Download updates automatically** now force-checks immediately, uses the proxy-aware GitHub request, and waits 20 seconds so a failed check appears in the update row.
<!-- app-update-notes:en:end -->

## Download

- **macOS Apple Silicon** — [potluck-monitor-0.2.11-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.11/potluck-monitor-0.2.11-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.11-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.11/potluck-monitor-0.2.11-x64.dmg)
- **Windows installer** — [potluck-monitor-Setup-0.2.11.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.11/potluck-monitor-Setup-0.2.11.exe)
- **Windows portable** — [potluck-monitor-0.2.11.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.11/potluck-monitor-0.2.11.exe)
- **Linux** — [potluck-monitor-0.2.11.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.11/potluck-monitor-0.2.11.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**macOS:** this release is unsigned. Open the `.dmg`, drag Potluck Monitor to Applications, then run:

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

If macOS says the app is damaged, that is Gatekeeper quarantine — the command above clears it. Confirm **Settings → App Updates → Installed** shows `v0.2.11`.

### tokscale dependency

Tokscale is bundled with this app. See **Settings → Tokscale** for the exact version
and the option to download a newer version directly from npm. Tokscale is MIT,
open-source: https://github.com/junhoyeo/tokscale

</details>

---

# 中文

## 更新内容

<!-- app-update-notes:zh:start -->
### 变更
- **有额度数据的提供者默认显示：**主页和额度页会保留已经有额度数据的提供者，即使本机探测勾选是关的。设置里有**全部启用**，主页默认最多显示 50 个账号。

### 修复
- **勾选提供者卡顿、像点了两下：**勾选不再整页重绘设置或强制刷新用量，避免点一下被当成取消，下拉框也不再跟着卡住。
- **打开自动更新没有反应：**勾选**自动下载更新**后会立刻强制检查，走代理友好的 GitHub 请求，超时 20 秒，失败会显示在更新那一行。
<!-- app-update-notes:zh:end -->

## 下载

- **macOS Apple Silicon** — [potluck-monitor-0.2.11-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.11/potluck-monitor-0.2.11-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.11-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.11/potluck-monitor-0.2.11-x64.dmg)
- **Windows 安装包** — [potluck-monitor-Setup-0.2.11.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.11/potluck-monitor-Setup-0.2.11.exe)
- **Windows 便携版** — [potluck-monitor-0.2.11.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.11/potluck-monitor-0.2.11.exe)
- **Linux** — [potluck-monitor-0.2.11.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.11/potluck-monitor-0.2.11.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**macOS：**本次发布包未签名。打开 `.dmg`，把 Potluck Monitor 拖到 Applications，然后在终端执行：

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

若提示「已损坏」，那是隔离标记；上面命令会清掉。打开后到 **设置 → App Updates → Installed** 确认是 `v0.2.11`。

### tokscale 依赖

Tokscale 已随应用内置。你可以在 **设置 → Tokscale** 查看确切版本，
也可以直接从 npm 下载更新版本。Tokscale 是 MIT 开源项目：
https://github.com/junhoyeo/tokscale

</details>
