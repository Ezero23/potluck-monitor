# English

## What's changed

<!-- app-update-notes:en:start -->
### Changed
- **One credential owner per Connection:** credentials created in Potluck Web are now managed only in Web, while Monitor-local credentials open directly inside the matching **Settings → Accounts & Connections** entry. The same Key no longer needs to be configured in both places.

### Improved
- **Multi-key connections:** each enabled Web Key remains a separate Connection in Monitor. Connections share an allowance only when they explicitly carry the same `quotaPoolKey`; matching provider names, account labels, percentages, or reset times never trigger an inferred merge.
- **Clear account summary:** **Accounts & Connections** now reports `Local credentials configured/supported · total connections` instead of combining both concepts into an ambiguous “linked” count.

### Fixed
- **Credential status counts:** missing provider configuration counts now render as zero instead of `NaN`.
<!-- app-update-notes:en:end -->

## Download

- **macOS Apple Silicon** — [potluck-monitor-0.2.8-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.8/potluck-monitor-0.2.8-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.8-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.8/potluck-monitor-0.2.8-x64.dmg)
- **Windows installer** — [potluck-monitor-Setup-0.2.8.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.8/potluck-monitor-Setup-0.2.8.exe)
- **Windows portable** — [potluck-monitor-0.2.8.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.8/potluck-monitor-0.2.8.exe)
- **Linux** — [potluck-monitor-0.2.8.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.8/potluck-monitor-0.2.8.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**macOS:** this release is unsigned. Open the `.dmg`, drag Potluck Monitor to Applications, then run:

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

If macOS says the app is damaged, that is Gatekeeper quarantine — the command above clears it. Confirm **Settings → App Updates → Installed** shows `v0.2.8`.

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
- **每条 Connection 只有一个凭据管理方：**在 Potluck Web 创建的凭据只需在 Web 管理；Monitor 本机凭据会直接展开在对应的**设置 → 账号与连接**条目内。同一个 Key 不再需要在两边重复配置。

### 改进
- **多 Key 连接：**Web 中每个已启用的 Key 都会在 Monitor 中保持为独立 Connection。只有多条 Connection 明确携带相同 `quotaPoolKey` 时才共享额度；Provider 名称、账号标签、百分比或重置时间相同都不会触发推测合并。
- **账号摘要更清楚：**“账号与连接”现在分别显示“本机凭据 已配置/支持 · 总连接”，不再用含义模糊的“已连接”数字混合两个概念。

### 修复
- **凭据状态计数：**Provider 配置数量缺失时显示为 0，不再出现 `NaN`。
<!-- app-update-notes:zh:end -->

## 下载

- **macOS Apple Silicon** — [potluck-monitor-0.2.8-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.8/potluck-monitor-0.2.8-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.8-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.8/potluck-monitor-0.2.8-x64.dmg)
- **Windows 安装包** — [potluck-monitor-Setup-0.2.8.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.8/potluck-monitor-Setup-0.2.8.exe)
- **Windows 便携版** — [potluck-monitor-0.2.8.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.8/potluck-monitor-0.2.8.exe)
- **Linux** — [potluck-monitor-0.2.8.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.8/potluck-monitor-0.2.8.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**macOS：**本次发布包未签名。打开 `.dmg`，把 Potluck Monitor 拖到 Applications，然后在终端执行：

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

若提示「已损坏」，那是隔离标记；上面命令会清掉。打开后到 **设置 → App Updates → Installed** 确认是 `v0.2.8`。

### tokscale 依赖

Tokscale 已随应用内置。你可以在 **设置 → Tokscale** 查看确切版本，
也可以直接从 npm 下载更新版本。Tokscale 是 MIT 开源项目：
https://github.com/junhoyeo/tokscale

</details>
