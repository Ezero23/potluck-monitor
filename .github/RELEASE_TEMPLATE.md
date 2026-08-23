# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **Dependency security updates:** the bundled `undici` HTTP stack is updated to 7.29.0 and `js-yaml` to 4.3.1, resolving every known High-severity advisory in production dependencies. These libraries carry provider, Hub, and update-server requests and parse the updater's YAML feed.
- **CI supply-chain hardening:** CI now fails when `npm audit` reports a High or Critical production-dependency advisory, and pins its GitHub Actions to immutable commit hashes like the release workflow does.
<!-- app-update-notes:en:end -->

## Download

- **macOS Apple Silicon** — [potluck-monitor-0.2.9-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.9/potluck-monitor-0.2.9-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.9-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.9/potluck-monitor-0.2.9-x64.dmg)
- **Windows installer** — [potluck-monitor-Setup-0.2.9.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.9/potluck-monitor-Setup-0.2.9.exe)
- **Windows portable** — [potluck-monitor-0.2.9.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.9/potluck-monitor-0.2.9.exe)
- **Linux** — [potluck-monitor-0.2.9.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.9/potluck-monitor-0.2.9.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**macOS:** this release is unsigned. Open the `.dmg`, drag Potluck Monitor to Applications, then run:

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

If macOS says the app is damaged, that is Gatekeeper quarantine — the command above clears it. Confirm **Settings → App Updates → Installed** shows `v0.2.9`.

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
- **依赖安全更新：**内置的 `undici` 网络栈升级到 7.29.0、`js-yaml` 固定到 4.3.1，清零生产依赖中全部已知 High 级安全告警。这两个库承载 Provider、Hub 与更新服务的网络请求，并负责解析更新器的 YAML 数据。
- **CI 供应链加固：**CI 现在会在生产依赖审计出现 High 或 Critical 告警时直接失败，并像发布工作流一样把 GitHub Actions 固定为不可变 commit。
<!-- app-update-notes:zh:end -->

## 下载

- **macOS Apple Silicon** — [potluck-monitor-0.2.9-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.9/potluck-monitor-0.2.9-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.9-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.9/potluck-monitor-0.2.9-x64.dmg)
- **Windows 安装包** — [potluck-monitor-Setup-0.2.9.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.9/potluck-monitor-Setup-0.2.9.exe)
- **Windows 便携版** — [potluck-monitor-0.2.9.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.9/potluck-monitor-0.2.9.exe)
- **Linux** — [potluck-monitor-0.2.9.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.9/potluck-monitor-0.2.9.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**macOS：**本次发布包未签名。打开 `.dmg`，把 Potluck Monitor 拖到 Applications，然后在终端执行：

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

若提示「已损坏」，那是隔离标记；上面命令会清掉。打开后到 **设置 → App Updates → Installed** 确认是 `v0.2.9`。

### tokscale 依赖

Tokscale 已随应用内置。你可以在 **设置 → Tokscale** 查看确切版本，
也可以直接从 npm 下载更新版本。Tokscale 是 MIT 开源项目：
https://github.com/junhoyeo/tokscale

</details>
