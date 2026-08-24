# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **Renderer lag on long-running installations:** the quota forecast's shadow backtest re-filtered and re-sorted the entire raw sample history for every historical cycle, which could pin a full CPU core and make every click feel sluggish. Samples are now sorted once per backtest, cutting the forecast cost by roughly an order of magnitude on large histories.

### Changed
- **Tray provider badge removed:** the small provider mark drawn onto the tray icon and its **Settings** toggle are gone. Tray icons now always use the clean template styling.
<!-- app-update-notes:en:end -->

## Download

- **macOS Apple Silicon** — [potluck-monitor-0.2.10-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.10/potluck-monitor-0.2.10-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.10-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.10/potluck-monitor-0.2.10-x64.dmg)
- **Windows installer** — [potluck-monitor-Setup-0.2.10.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.10/potluck-monitor-Setup-0.2.10.exe)
- **Windows portable** — [potluck-monitor-0.2.10.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.10/potluck-monitor-0.2.10.exe)
- **Linux** — [potluck-monitor-0.2.10.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.10/potluck-monitor-0.2.10.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**macOS:** this release is unsigned. Open the `.dmg`, drag Potluck Monitor to Applications, then run:

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

If macOS says the app is damaged, that is Gatekeeper quarantine — the command above clears it. Confirm **Settings → App Updates → Installed** shows `v0.2.10`.

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
- **长时间使用后的界面卡顿：**额度预测的 shadow backtest 会对每个历史周期重新过滤并排序整份原始样本历史，可能占满一个 CPU 核，导致每次点击都明显发卡。现在整个回测只排序一次，在大体量历史数据上把预测开销降低约一个数量级。

### 变更
- **移除托盘 Provider 徽章：**不再在托盘图标上叠加 Provider 小标记，**设置**里的对应开关也一并移除。托盘图标统一使用干净的模板样式。
<!-- app-update-notes:zh:end -->

## 下载

- **macOS Apple Silicon** — [potluck-monitor-0.2.10-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.10/potluck-monitor-0.2.10-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.10-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.10/potluck-monitor-0.2.10-x64.dmg)
- **Windows 安装包** — [potluck-monitor-Setup-0.2.10.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.10/potluck-monitor-Setup-0.2.10.exe)
- **Windows 便携版** — [potluck-monitor-0.2.10.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.10/potluck-monitor-0.2.10.exe)
- **Linux** — [potluck-monitor-0.2.10.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.10/potluck-monitor-0.2.10.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**macOS：**本次发布包未签名。打开 `.dmg`，把 Potluck Monitor 拖到 Applications，然后在终端执行：

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

若提示「已损坏」，那是隔离标记；上面命令会清掉。打开后到 **设置 → App Updates → Installed** 确认是 `v0.2.10`。

### tokscale 依赖

Tokscale 已随应用内置。你可以在 **设置 → Tokscale** 查看确切版本，
也可以直接从 npm 下载更新版本。Tokscale 是 MIT 开源项目：
https://github.com/junhoyeo/tokscale

</details>
