# English

## What's changed

<!-- app-update-notes:en:start -->
### Added

- **Five new AI Tool Limits providers:** **Gemini CLI** reads the CLI's own local login (`~/.gemini`), auto-refreshes stale tokens, and shows per-model daily quota; **CommandCode** shows credits plus 5-hour/weekly rate windows; **CodeBuddy** shows Tencent credit packs with refill and one-shot bonus packs kept strictly separate; **Groq** shows request/token rate-limit windows read from response headers (polling the free models list, never costing tokens); **Vercel AI Gateway** shows the USD credit balance. CommandCode/CodeBuddy/Groq/Vercel credentials are env keys (`.env.example` lists them); Gemini CLI needs no extra sign-in.

### Fixed

- **Claude per-model weekly windows:** `seven_day_sonnet` / `seven_day_opus` / `seven_day_fable_*` tiers surfaced by Anthropic's usage payload now show their own bars, and new model tiers appear automatically without code changes.
- **Antigravity multi-account refreshes:** forced quota refreshes across running accounts now run serially with jittered pacing and stop at the first success, instead of a concurrent burst — the pattern that triggers Google's anti-abuse shadow restrictions.
<!-- app-update-notes:en:end -->

## Download

- **macOS Apple Silicon** — [potluck-monitor-0.2.16-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.16/potluck-monitor-0.2.16-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.16-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.16/potluck-monitor-0.2.16-x64.dmg)
- **Windows installer** — [potluck-monitor-Setup-0.2.16.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.16/potluck-monitor-Setup-0.2.16.exe)
- **Windows portable** — [potluck-monitor-0.2.16.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.16/potluck-monitor-0.2.16.exe)
- **Linux** — [potluck-monitor-0.2.16.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.16/potluck-monitor-0.2.16.AppImage)

### First launch and limitations

**macOS:** drag the app from the DMG into Applications. macOS builds use an ad-hoc signature, not a Developer ID signature or Apple notarization. Gatekeeper may require approval. Verify that your download came from this repository's release and inspect system warnings; a “damaged” warning is not proof that quarantine is the only cause. Do not remove security attributes indiscriminately. Confirm **Settings → App Updates → Installed** shows `v0.2.16`.

Advice covers only returned quota windows, not guaranteed model availability or task completion. Missing Kimi/GLM monthly data is not an unlimited allowance. Task/model suitability and automatic routing are not implemented. Recovery history lasts for the current app session; preferences persist, but notification observation restarts silently after relaunch.

Tokscale is bundled. **Settings → Tokscale** shows its exact version and offers downloads from npm. Tokscale is [MIT-licensed and open source](https://github.com/junhoyeo/tokscale).

---

# 中文

## 更新内容

<!-- app-update-notes:zh:start -->
### 新增

- **五个新的 AI 工具额度提供方：****Gemini CLI** 直接读取 CLI 本地登录（`~/.gemini`），自动刷新过期 token，显示按模型日配额；**CommandCode** 显示积分与 5 小时／每周限额；**CodeBuddy** 显示腾讯积分包，周期补充包与一次性赠送包严格分开；**Groq** 从响应头读取请求／Token 限流窗口（轮询免费 models 列表，不消耗 token）；**Vercel AI Gateway** 显示美元积分余额。CommandCode／CodeBuddy／Groq／Vercel 的凭据为 env key（见 `.env.example`）；Gemini CLI 无需额外登录。

### 修复

- **Claude 按模型周窗口：**Anthropic 用量载荷中的 `seven_day_sonnet`／`seven_day_opus`／`seven_day_fable_*` 档位现在各自显示进度条，新档位无需改代码即可自动出现。
- **Antigravity 多账号刷新：**跨运行中账号的强制配额刷新改为串行加抖动步进、首个成功即停，不再并发突发——正是触发 Google 反滥用影子限制的模式。
<!-- app-update-notes:zh:end -->

## 下载

- **macOS Apple Silicon** — [potluck-monitor-0.2.16-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.16/potluck-monitor-0.2.16-arm64.dmg)
- **macOS Intel** — [potluck-monitor-0.2.16-x64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.16/potluck-monitor-0.2.16-x64.dmg)
- **Windows 安装包** — [potluck-monitor-Setup-0.2.16.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.16/potluck-monitor-Setup-0.2.16.exe)
- **Windows 便携版** — [potluck-monitor-0.2.16.exe](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.16/potluck-monitor-0.2.16.exe)
- **Linux** — [potluck-monitor-0.2.16.AppImage](https://github.com/Ezero23/potluck-monitor/releases/download/v0.2.16/potluck-monitor-0.2.16.AppImage)

### 首次启动与限制

**macOS：**从 DMG 将应用拖入 Applications。macOS 包采用 ad-hoc 签名，不是 Developer ID 签名，也未经 Apple 公证，因此 Gatekeeper 可能要求用户批准。请确认来自本仓库的正式发布并检查系统警告；“已损坏”不代表一定只是隔离标记，不应无条件删除安全属性。启动后到 **设置 → App Updates → Installed** 确认是 `v0.2.16`。

建议只覆盖实际返回的额度窗口，不保证模型一定可调用或任务一定能完成。Kimi／GLM 缺少月数据不代表额度无限。任务／模型适配和自动路由尚未实现。恢复观察历史仅保留在本次应用运行期间；偏好会持久化，但重启后会静默建立提醒基线。

Tokscale 已内置，**设置 → Tokscale** 可查看版本并从 npm 下载更新。Tokscale 是 [MIT 开源项目](https://github.com/junhoyeo/tokscale)。
