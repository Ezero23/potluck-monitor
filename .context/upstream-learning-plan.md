# 上游生态学习方案（potluck-monitor）

> 建立于 2026-10-02。目标：持续从 tokscale 上游与同类 AI 用量监控项目中吸取可落地的改进，避免闭门造车。
> 执行载体：Proma 定时任务「potluck 上游生态周报」（每周一 10:00），滚动记忆在 `.context/automation/upstream-ecosystem-watch/notes.md`。

## 跟踪信息源

| 源 | 看什么 | 为什么 |
|---|---|---|
| `junhoyeo/tokscale` releases | 新客户端解析、定价修复、安全相关修复 | 本项目核心采集依赖，落后会直接影响数据正确性（2026-10 曾落后 10 个版本） |
| `Ezero23/potluck-monitor` 自身 | Dependabot PR/告警、CI 状态、open issues | 修复前置依赖 |
| `Maciek-roboblog/Claude-Code-Usage-Monitor` | v4 方向：usage warehouse 持久化、多数据源、团队 plan、pace 预测 | 品类头部（8.7k★），pace 预测本项目已有（`quotaForecast.js`），warehouse/报表是差异化参考 |
| `ccusage/ccusage` | 定价快照自动同步（bot 定时更新 models.dev/LiteLLM） | 定价数据保鲜机制参考；本项目经 tokscale 间接受益 |
| `CodeZeno/Claude-Code-Usage-Monitor` | Windows widget 形态、Grok 账单周期边界处理 | 与本项目形态最接近的竞品 |
| `Iamshankhadeep/ccseva` | Electron → 原生 Swift 迁移路线 | 长期平台选型参考 |
| 其他观察名单 | `richhickson/claudecodeusage`、`foyzulkarim/claude-lens`、`leeguooooo/claude-code-usage-bar` | 菜单栏/仪表盘 UX 参考 |

## 评估标准（什么值得跟进）

1. **正确性优先**：会导致本项目数据错误/凭据风险的上游修复（如 tokscale v4.9.0 改写 Claude 凭据的 bug）→ 立即升级。
2. **用户可见价值**：新客户端支持、新的 limits 提供商、UI/UX 明显改进 → 评估后纳入 backlog。
3. **工程健康**：CI/发布流程、依赖更新机制、跨平台兼容性 → 随手吸收。
4. **不追**：与 local-first 定位冲突的方向（如强制云端账号体系）、重营销向改动。

## 第一轮成果（2026-10-02 已落地）

- tokscale 4.7.0 → 4.17.0（吃到凭据改写修复、CLAUDE_CONFIG_DIR 会话发现、Windows 路径分隔符修复、OpenClaw/Unsloth/dsh 新客户端、大量定价修复）。
- 依赖漏洞清零（undici/electron/js-yaml/xmldom/brace-expansion 共 13 个高危），新增 Dependabot 周更新 + 漏洞告警 + 自动安全修复。
- 修复 Windows CI 失败测试（geminiCredentialsPath 平台路径断言）。
- 对照 CodeZeno 的 Grok 账单周期边界修复审计 `grokLimits.js`：**确认存在同样 bug 并已修复**（d1cddd4）——protobuf JSON 省略零值导致重置后 `creditUsagePercent` 缺失时报 unavailable，现读取为 0%；无可解析 period end 时仍拒绝。新增 2 个回归测试。
