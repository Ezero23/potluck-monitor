# 套餐轮换助手：实现范围与验收

## 目标

根据实际额度提供“现在建议用谁、谁可备用、何时重新评估”的条件式建议。不按闹钟强制切换，不修改账号、Key 或正在执行的任务。到达重置时间不等于确认额度恢复。

## v0.2.14 实现范围

- `src/shared/quotaRotation.js` 为主页和状态栏提供共用建议。候选要求成功、可归属账号／额度池且采集时间新鲜；默认超过 15 分钟、明显未来、缺少时间、错误或过期样本均不推荐。
- 周／月／短周期耗尽均可阻止推荐。主进程在本次运行中保留 `blockedPoolKeys`，主页和状态栏共用；字段消失不算恢复，需同池新鲜数据明确确认。观察历史不跨重启持久化。
- 同一明确额度池只占一个候选位置，采用最新样本；最新样本冲突时排除。未确认同属一份订阅的 Key 不推断合并。
- 仅 `resetPolicy=fixed` 且 `resetConfidence>=0.6` 时利用重置先后排序；滚动或未确认时间不承诺固定重置。缺少真实重置时间不编造倒计时。
- 通常避免优先使用不足 10% 的套餐，这不是任务完成量预测。可在主页选择当前套餐并持久化偏好，减少无必要切换。
- 备用是候选，不是预定下一站。在下一刻钟或可信重置边界附近复查；主进程调度额度刷新，不扫描 Token 日志。界面重绘不能不断把复查时刻向后推。
- 通知默认关闭；启用后观察所选套餐低额度及已耗尽窗口真实恢复。启动静默建立基线，拒绝缓存／缺失时间样本；本地时间 22:00–08:00 免打扰，至少 10 分钟冷却，可静音一小时。倒计时归零、新账号、字段消失均不算恢复。
- 候选不可用、数据不完整时提供解释性空状态，不把未知额度显示成健康的零用量。

## 数据边界

GLM 的 billing／MCP 额度不是模型 Coding Plan 总月额度，不能互相替代。Kimi／GLM 只有接口真实返回月额度时才按该窗口判断；缺失月数据不代表无限，也不能仅凭小时余量确认整份订阅可用。恢复提示证明已观察窗口的数据变化，不保证模型调用成功。

任务适用范围、模型能力匹配、任务完成量预测和自动路由不在本次实现范围内。工具帮助比较已有套餐与判断复查时机，不后台消耗模型额度作探测。

## 发布验收门槛

代码实现不等于发布和本地验收完成。发布前需取得以下证据，不能用历史截图或旧测试计数代替：

1. `node --test tests/shared/quotaRotation.test.js` 与 `npm run verify`：覆盖新鲜度、耗尽否决、同池冲突、恢复确认、冷却／免打扰、边界复查、缺失数据。
2. 实际包版本与锁文件一致；macOS 严格验签通过。ad-hoc 签名是完整性检查，不代表 Developer ID 签名或 Apple 公证。
3. `/Applications/Potluck Monitor.app` 运行本次构建；真实顶部状态栏截图可见带缺口仪表图标，辅助功能坐标在屏幕内，左键打开窗口，右键出现菜单。设置页截图不是状态栏验收。
4. 实际界面当前套餐选择保存／重启恢复、提醒开关和静音控制可用；中英文不承诺自动切换。
5. Git 提交、版本标签、发行页与更新元数据对应同一版本，产物完整后才宣称发布完成。

本文描述实现和验收门槛，不将尚未完成的 GUI、构建或发布记为“已通过”。真实账号月额度覆盖仍取决于提供商返回值。

## English summary

The advisor recommends a current subscription, a backup and a review time; it never automatically switches providers or modifies keys. Eligibility requires fresh, successful and attributable data. Exhausted longer windows veto short-window headroom; conflicting latest pool samples are excluded. Observed exhaustion stays blocking during the current app session until fresh data explicitly confirms recovery.

Current-subscription preferences persist. Notifications are opt-in, start with a silent baseline, respect local 22:00–08:00 quiet hours and a 10-minute cooldown, and support a one-hour mute. Scheduled reviews refresh quotas without scanning token logs. Missing monthly coverage is unknown; GLM billing/MCP is not model Coding Plan monthly allowance. Missing reset timestamps never create synthetic countdowns.

Task suitability, completion estimates and automatic routing are out of scope. Tests, package integrity, the installed app, the actual macOS menu bar and release artifacts must each be verified before delivery; this document does not claim these release gates have passed.
