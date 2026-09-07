# English

## What's changed

<!-- app-update-notes:en:start -->
### Added

- **Subscription rotation advice:** Home and the menu bar share a current recommendation, a backup candidate, and a review time. Choose your current subscription and retain that preference across restarts. This is advice, not automatic switching; it never modifies keys or interrupts running tasks.
- **Optional quota alerts:** disabled by default. Enable alerts for low quota on the selected subscription or fresh confirmation that previously exhausted windows have recovered. Local quiet hours are 22:00–08:00, the cooldown is 10 minutes, and a one-hour mute is available. Startup and cached samples do not trigger recovery notices.

### Fixed

- **Trustworthy candidates:** require fresh, successful, attributable data. Exhausted weekly or monthly windows veto short-window headroom. Shared pools use the newest sample; conflicting latest samples are excluded. During the current app session, observed exhaustion remains blocking until fresh data explicitly confirms recovery—not when fields disappear or a countdown reaches zero.
- **Honest quota labels:** GLM billing/MCP allowance is not its model Coding Plan monthly allowance. Missing monthly coverage remains unknown. Missing reset timestamps do not create invented countdowns; rolling or unconfirmed resets are not promised as exact switch times.
- **Lightweight reviews:** scheduled quota reviews refresh limits without rescanning token logs. Home and the menu bar share the same blocked-pool state.
- **macOS status item:** retain the notched gauge template icon, native fallback for off-screen Electron items, localized context menu, and window restoration when reopening the app. Native helper startup recovery and closed-pipe handling protect the main process.
<!-- app-update-notes:en:end -->

## Download

- **macOS Apple Silicon** — [potluck-monitor-0.2.14-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.14/potluck-monitor-0.2.14-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.14-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.14/potluck-monitor-0.2.14-x64.dmg)
- **Windows installer** — [potluck-monitor-Setup-0.2.14.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.14/potluck-monitor-Setup-0.2.14.exe)
- **Windows portable** — [potluck-monitor-0.2.14.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.14/potluck-monitor-0.2.14.exe)
- **Linux** — [potluck-monitor-0.2.14.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.14/potluck-monitor-0.2.14.AppImage)

### First launch and limitations

**macOS:** drag the app from the DMG into Applications. macOS builds use an ad-hoc signature, not a Developer ID signature or Apple notarization. Gatekeeper may require approval. Verify that your download came from this repository's release and inspect system warnings; a “damaged” warning is not proof that quarantine is the only cause. Do not remove security attributes indiscriminately. Confirm **Settings → App Updates → Installed** shows `v0.2.14`.

Advice covers only returned quota windows, not guaranteed model availability or task completion. Missing Kimi/GLM monthly data is not an unlimited allowance. Task/model suitability and automatic routing are not implemented. Recovery history lasts for the current app session; preferences persist, but notification observation restarts silently after relaunch.

Tokscale is bundled. **Settings → Tokscale** shows its exact version and offers downloads from npm. Tokscale is [MIT-licensed and open source](https://github.com/junhoyeo/tokscale).

---

# 中文

## 更新内容

<!-- app-update-notes:zh:start -->
### 新增

- **套餐轮换建议：**主页和状态栏共用“当前建议、备用候选、复查时间”。可选择正在使用的套餐，并在重启后保留偏好。这是建议，不是自动切换，不修改 Key，也不打断正在执行的任务。
- **可选额度提醒：**默认关闭。开启后，提醒所选套餐额度偏低，或此前耗尽的窗口经新数据确认恢复。本地时间 22:00–08:00 免打扰，提醒间隔至少 10 分钟，并提供静音一小时。启动和旧缓存不会触发恢复提醒。

### 修复

- **候选更可信：**要求新鲜、成功且可归属的数据。周／月耗尽可以否决短周期余量；同一额度池采用最新样本，最新样本冲突时排除。本次应用运行期间，已观察到的耗尽状态会阻止推荐，直到新数据明确确认恢复；字段消失、倒计时归零都不算恢复。
- **额度标签不再混淆：**GLM 的 billing／MCP 额度不是模型 Coding Plan 总月额度。缺失月数据保持未知，缺少真实重置时间时不编造倒计时；滚动或未确认的重置不承诺精确切换时间。
- **轻量复查：**定时复查只刷新额度，不重新扫描 Token 日志。主页和状态栏使用同一份额度池阻塞状态。
- **macOS 状态栏：**保留带缺口的仪表模板图标、Electron 状态项越界时的原生兜底、本地化右键菜单，以及再次打开应用时恢复窗口。原生辅助进程启动恢复和断管处理保护主进程。
<!-- app-update-notes:zh:end -->

## 下载

- **macOS Apple Silicon** — [potluck-monitor-0.2.14-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.14/potluck-monitor-0.2.14-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.14-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.14/potluck-monitor-0.2.14-x64.dmg)
- **Windows 安装包** — [potluck-monitor-Setup-0.2.14.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.14/potluck-monitor-Setup-0.2.14.exe)
- **Windows 便携版** — [potluck-monitor-0.2.14.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.14/potluck-monitor-0.2.14.exe)
- **Linux** — [potluck-monitor-0.2.14.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.14/potluck-monitor-0.2.14.AppImage)

### 首次启动与限制

**macOS：**从 DMG 将应用拖入 Applications。macOS 包采用 ad-hoc 签名，不是 Developer ID 签名，也未经 Apple 公证，因此 Gatekeeper 可能要求用户批准。请确认来自本仓库的正式发布并检查系统警告；“已损坏”不代表一定只是隔离标记，不应无条件删除安全属性。启动后到 **设置 → App Updates → Installed** 确认是 `v0.2.14`。

建议只覆盖实际返回的额度窗口，不保证模型一定可调用或任务一定能完成。Kimi／GLM 缺少月数据不代表额度无限。任务／模型适配和自动路由尚未实现。恢复观察历史仅保留在本次应用运行期间；偏好会持久化，但重启后会静默建立提醒基线。

Tokscale 已内置，**设置 → Tokscale** 可查看版本并从 npm 下载更新。Tokscale 是 [MIT 开源项目](https://github.com/junhoyeo/tokscale)。
