# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Sign in to Kimi:** Settings can open an isolated Kimi login window so monthly quota is collected without pasting a cookie. The session stays on this device; the manual cookie and API key remain as advanced fallbacks.

### Changed
- **Same-subscription keys:** extra credentials for one provider account now share that subscription's quota pool when the provider confirms the identity, instead of showing as separate accounts. Unconfirmed connections are labeled **Subscription identity unverified**.

### Fixed
- **Exhausted monthly looking healthy:** Home, Limits, and **Lowest remaining quota** no longer hide a missing or used-up monthly cap (Kimi, GLM, GLM Team) behind a green 5-hour 0% bar. The real monthly window wins, or the row is marked **Unavailable**.
- **Unknown usage shown as 0% or 100%:** Cursor Total and on-demand, Qoder, OpenRouter, and Kiro no longer invent a healthy zero or a fake 50-credit total when the API omitted the numbers. Missing values stay unknown.
- **Menu bar icons:** generated tray icons register again instead of throwing on every icon update, which left tray-only mode with no visible surface.
- **MiniMax plan name:** the live subscribe title is shown instead of a hardcoded Token Plan label.
<!-- app-update-notes:en:end -->

## Download

- **macOS Apple Silicon** — [potluck-monitor-0.2.13-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.13/potluck-monitor-0.2.13-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.13-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.13/potluck-monitor-0.2.13-x64.dmg)
- **Windows installer** — [potluck-monitor-Setup-0.2.13.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.13/potluck-monitor-Setup-0.2.13.exe)
- **Windows portable** — [potluck-monitor-0.2.13.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.13/potluck-monitor-0.2.13.exe)
- **Linux** — [potluck-monitor-0.2.13.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.13/potluck-monitor-0.2.13.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**macOS:** this release is unsigned. Open the `.dmg`, drag Potluck Monitor to Applications, then run:

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

If macOS says the app is damaged, that is Gatekeeper quarantine — the command above clears it. Confirm **Settings → App Updates → Installed** shows `v0.2.13`.

### tokscale dependency

Tokscale is bundled with this app. See **Settings → Tokscale** for the exact version
and the option to download a newer version directly from npm. Tokscale is MIT,
open-source: https://github.com/junhoyeo/tokscale

</details>

---

# 中文

## 更新内容

<!-- app-update-notes:zh:start -->
### 新增
- **登录 Kimi：**设置里可以用隔离窗口登录 Kimi，无需再粘贴 cookie 即可采集每月额度。会话只留在本机；手动 cookie 和 API key 仍可作为高级备选。

### 变更
- **同一订阅的多把密钥：**当提供商确认身份后，同一账号下的多份凭证会共用额度池，不再显示成多个账号。未确认的连接会标为**订阅身份未确认**。

### 修复
- **月额度用尽却显示健康：**首页、额度页和**剩余额度最低**不再把缺失或已用尽的每月额度（Kimi、GLM、GLM Team）藏在绿色的 5 小时 0% 进度条后面。真正的每月窗口会排在前面，或标为**暂不可用**。
- **未知用量显示成 0% 或 100%：**Cursor Total / on-demand、Qoder、OpenRouter、Kiro 在接口没返回数字时不再捏造健康的 0 或假的 50 积分总量。缺失值保持未知。
- **菜单栏图标：**生成的托盘图标会再次注册，不再在每次更新时抛错，避免仅托盘模式下完全看不见应用。
- **MiniMax 套餐名：**显示接口返回的订阅标题，而不再写死 Token Plan。
<!-- app-update-notes:zh:end -->

## 下载

- **macOS Apple Silicon** — [potluck-monitor-0.2.13-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.13/potluck-monitor-0.2.13-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.13-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.13/potluck-monitor-0.2.13-x64.dmg)
- **Windows 安装包** — [potluck-monitor-Setup-0.2.13.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.13/potluck-monitor-Setup-0.2.13.exe)
- **Windows 便携版** — [potluck-monitor-0.2.13.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.13/potluck-monitor-0.2.13.exe)
- **Linux** — [potluck-monitor-0.2.13.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.13/potluck-monitor-0.2.13.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**macOS：**本次发布包未签名。打开 `.dmg`，把 Potluck Monitor 拖到 Applications，然后在终端执行：

```bash
xattr -cr "/Applications/Potluck Monitor.app"
open "/Applications/Potluck Monitor.app"
```

若提示「已损坏」，那是隔离标记；上面命令会清掉。打开后到 **设置 → App Updates → Installed** 确认是 `v0.2.13`。

### tokscale 依赖

Tokscale 已随应用内置。你可以在 **设置 → Tokscale** 查看确切版本，
也可以直接从 npm 下载更新版本。Tokscale 是 MIT 开源项目：
https://github.com/junhoyeo/tokscale

</details>
