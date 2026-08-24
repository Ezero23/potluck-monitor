# English

## What's changed

<!-- app-update-notes:en:start -->
### Changed
- **Safer macOS updates:** unsigned and ad-hoc builds now use a verified custom update path with resumable downloads, persistent ready-to-install state, staged bundle validation, and automatic rollback to the previous app if the replacement cannot launch.

### Fixed
- **Automatic update installation on macOS:** ad-hoc packages are no longer mistaken for Developer ID builds and sent through an incompatible native updater. Release archives must pass GitHub SHA-256 and size verification before installation.
- **Settings clicks and dropdowns:** provider changes and ordinary setting saves are serialized and reconciled without rebuilding the entire Settings page, preventing stale responses from reversing newer choices.
- **Provider-list churn and layout:** unchanged live-data pushes no longer recreate all provider rows, and the text-only **Enable all** action no longer wraps vertically in the icon-button width.
<!-- app-update-notes:en:end -->

## Download

- **macOS Apple Silicon** — [potluck-monitor-0.2.12-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.12/potluck-monitor-0.2.12-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.12-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.12/potluck-monitor-0.2.12-x64.dmg)
- **Windows installer** — [potluck-monitor-Setup-0.2.12.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.12/potluck-monitor-Setup-0.2.12.exe)
- **Windows portable** — [potluck-monitor-0.2.12.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.12/potluck-monitor-0.2.12.exe)
- **Linux** — [potluck-monitor-0.2.12.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.12/potluck-monitor-0.2.12.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**macOS:** this release is unsigned. Open the `.dmg`, drag Potluck Monitor to Applications, then run:

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

If macOS says the app is damaged, that is Gatekeeper quarantine — the command above clears it. Confirm **Settings → App Updates → Installed** shows `v0.2.12`.

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
- **macOS 更新更安全：**未签名和 ad-hoc 签名的构建现在走经过校验的自定义更新通道，支持断点续传、重启后恢复“等待安装”状态、staging 包验证，并在新版本无法启动时自动回滚旧 App。

### 修复
- **macOS 自动安装失败：**ad-hoc 安装包不再被误判成 Developer ID 构建并进入不兼容的原生更新器；发布压缩包必须通过 GitHub SHA-256 和文件大小校验才允许安装。
- **设置单击和下拉框卡顿：**提供商选择和普通设置保存改为串行执行与轻量同步，旧保存结果不会再覆盖较新的选择，也不会整页重建设置。
- **提供商列表重复重绘与排版：**额度数据没有变化时不再重建全部提供商行；纯文字的**全部启用**按钮也不会再被图标按钮宽度挤成竖排。
<!-- app-update-notes:zh:end -->

## 下载

- **macOS Apple Silicon** — [potluck-monitor-0.2.12-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.12/potluck-monitor-0.2.12-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.12-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.12/potluck-monitor-0.2.12-x64.dmg)
- **Windows 安装包** — [potluck-monitor-Setup-0.2.12.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.12/potluck-monitor-Setup-0.2.12.exe)
- **Windows 便携版** — [potluck-monitor-0.2.12.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.12/potluck-monitor-0.2.12.exe)
- **Linux** — [potluck-monitor-0.2.12.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.12/potluck-monitor-0.2.12.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**macOS：**本次发布包未签名。打开 `.dmg`，把 Potluck Monitor 拖到 Applications，然后在终端执行：

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

若提示「已损坏」，那是隔离标记；上面命令会清掉。打开后到 **设置 → App Updates → Installed** 确认是 `v0.2.12`。

### tokscale 依赖

Tokscale 已随应用内置。你可以在 **设置 → Tokscale** 查看确切版本，
也可以直接从 npm 下载更新版本。Tokscale 是 MIT 开源项目：
https://github.com/junhoyeo/tokscale

</details>
