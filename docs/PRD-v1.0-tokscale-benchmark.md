# Potluck Monitor Next PRD

**版本：** 1.0  
**状态：** Draft for review  
**日期：** 2026-07-29  
**项目：** Potluck Monitor  
**工作名：** Personal AI Operations Cockpit  
**对照产品：** [junhoyeo/tokscale](https://github.com/junhoyeo/tokscale)  
**产品负责人：** 待定  
**技术负责人：** 待定

---

## 0. 一页结论

Potluck Monitor 不应该把下一阶段定义成“做一个图形化 tokScale”，也不应该跟随 tokScale 重做解析器、TUI 或公开排行榜。

Potluck Monitor 已经拥有 tokScale 不具备或并不擅长的产品资产：

- 常驻桌面、菜单栏、托盘和悬浮小窗；
- 秒级刷新；
- AI 工具额度、余额、重置窗口和多账号；
- 多设备实时同步；
- Windows WSL、macOS、Windows、Linux 的桌面交付；
- session、项目、工具、模型、设备等多种视图；
- 本地历史归档、数据导出和隐私边界；
- 可自托管 hub、Cloudflare Worker 和 iOS 小部件接口。

tokScale 真正领先的地方，是把底层使用数据做成了一条完整价值链：

> 统一扫描 → 任意筛选与分组 → 精确时间分析 → 任务归因 → 自动总结 → 可导出 → 可分享 → 公开身份与社区传播

Potluck Monitor 的下一阶段应建立在 tokScale 之上，而不是与它竞争底层解析能力：

> **从“实时显示用了多少”升级为“告诉用户钱和额度花在哪里、是否异常、下一步该做什么”的本地优先 AI 开发运营台。**

本 PRD 建议按以下顺序推进：

1. **P0：统一分析查询层**  
   让所有图表、列表、导出和 API 使用同一个时间范围、筛选、分组和钻取契约。
2. **P0：价格正确性与可审计性**  
   使用 LiteLLM 实时价格目录，完整处理 cache 折扣和长上下文分层价格，并明确区分未知、免费、估算、自定义和 provider 实报成本。
3. **P0：额度与成本行动中心**  
   将额度、余额、成本和重置时间转化为风险、预测和可执行提醒。
4. **P1：工作归因与复盘**  
   在默认不上传提示词的前提下，把 session 聚合成项目、任务和工作类型。
5. **P1：周报、月报与私密分享**  
   生成真正有用的 Wrapped/Review，而不是只做一张漂亮海报。
6. **P2：可选公开身份与团队比较**  
   只有在用户明确选择公开、隐私和反作弊机制成熟后，才试验 profile、group 和 leaderboard。

---

## 1. 文档目的

本 PRD 回答五个问题：

1. Potluck Monitor 与 tokScale 当前分别强在哪里？
2. 哪些 tokScale 能力值得学习，哪些不应照搬？
3. Potluck Monitor 下一阶段的产品定位是什么？
4. 新能力应该以什么顺序、数据契约和质量门槛落地？
5. 如何在增加分析深度的同时，保持本地优先、低打扰和多设备优势？

本 PRD 是产品合同，不是实现计划的替代品。进入编码前，每个阶段仍需单独技术设计、文件影响清单和验收计划。

---

## 2. 调研基线与证据边界

### 2.1 Potluck Monitor 基线

本地基线：

- 仓库：`/Users/zhuxiaolin/potluck-monitor`
- HEAD：`65bac65d909d61953fedd1b081b5bffb11b4ff31`
- 本地包版本：`0.35.0`
- 基线日期：2026-07-29
- 当前工作区存在用户未提交修改；本 PRD 不评价这些修改是否已完成，也不把它们覆盖为正式基线。

主要证据：

- `README.zh-CN.md`
- `AGENTS.md`
- `docs/API.md`
- `docs/configuration.md`
- `docs/deep-operations-inventory.md`
- `docs/export.md`
- `docs/privacy.md`
- `src/shared/collector.js`
- `src/shared/usage.js`
- `src/shared/history.js`
- `src/electron/main.js`
- Electron renderer 与 dashboard 相关源码
- 当前测试、构建和发布配置

### 2.2 tokScale 基线

在线基线：

- 仓库：[junhoyeo/tokscale](https://github.com/junhoyeo/tokscale)
- commit：`3ce29f97bce803eb64f94db55c03464242815612`
- commit 时间：2026-07-29T05:17:49Z
- Rust workspace 版本：`4.7.0`
- 基线日期：2026-07-29

主要证据：

- [tokScale README](https://github.com/junhoyeo/tokscale/blob/main/README.md)
- [tokScale DESIGN.md](https://github.com/junhoyeo/tokscale/blob/main/DESIGN.md)
- `Cargo.toml`
- `package.json`
- GitHub 当前文件树和产品页面

调研时 tokScale 仓库约有：

- 622 个被 Git 跟踪的文件；
- 144 个 Rust 文件；
- 253 个 TypeScript/JavaScript 文件；
- 84 个测试相关文件；
- Rust core、Rust CLI/TUI、npm 平台启动包、Next.js 前端、认证、提交、设备、公开 profile、groups 和 leaderboard 等多个产品面。

这些数量只用于说明工程规模，不作为产品优劣指标，也不作为长期不变事实。

### 2.3 关键依赖事实

Potluck Monitor 当前把 tokScale 作为采集引擎：

```text
Potluck Monitor UI / Hub / Agent
              │
              ▼
   Potluck collector adapter
              │
              ▼
           tokScale
              │
              ▼
AI coding clients' local logs / databases / APIs
```

因此：

- tokScale 新增解析器时，Potluck Monitor 应通过升级和兼容适配获得收益；
- Potluck Monitor 不应复制 tokScale 的每个 client parser；
- Potluck Monitor 必须对 tokScale JSON 输出、版本和能力建立显式兼容层；
- Potluck Monitor 的差异化应集中在常驻体验、额度健康、多设备、操作建议和复盘。

---

## 3. 产品对比

### 3.1 战略对比

| 维度 | tokScale | Potluck Monitor | 判断 |
|---|---|---|---|
| 核心定位 | 高性能终端统计工具 + 社交平台 | 常驻桌面用量与额度监控器 | 不同赛道，不应互相复制外壳 |
| 采集覆盖 | 上游主能力，支持大量 client 和数据路径 | 主要通过 tokScale 获得使用数据，另有额度采集器 | 继续依赖上游更合理 |
| 数据处理 | Rust 原生扫描、解析、聚合、缓存 | Node/Electron 消费 tokScale 输出并做归一化、历史、多设备 | 需要稳定 adapter 和能力协商 |
| 查询能力 | 丰富 date/client/group-by/JSON/TUI 查询 | UI 有多个固定视图，查询组合度较低 | Potluck 的首要学习点 |
| 时间粒度 | minutely/hourly/daily 等交互面 | 以 today/month/all-time 和 daily history 为主；部分小时数据由 session 近似 | 需要精确、统一的时间查询 |
| 归因深度 | client/provider/model/workspace/session/task | tool/model/device/session/project 已有，但跨维组合与任务归因不足 | 可在现有基础上升级 |
| 额度与余额 | 有 subscription usage，但不是完整主轴 | 18+ 提供方、多个窗口、余额、账号切换 | Potluck 明显优势 |
| 常驻体验 | TUI/CLI，需要主动打开 | 菜单栏、托盘、悬浮窗、快捷键、开机启动 | Potluck 明显优势 |
| 多设备 | 公开提交设备和 profile 数据 | 自托管 hub、SSE、设备聚合、无头 agent | Potluck 明显优势 |
| 社交传播 | public profile、embed、badge、leaderboard、groups、Wrapped | README、Discord RPC、导出；无完整分享闭环 | 值得学习，但不应先做 |
| 自动复盘 | task-attributed report、Wrapped、autosubmit | 趋势和导出为主 | 高价值缺口 |
| 隐私模式 | 本地分析 + 用户主动提交公开数据 | 本地优先、默认无遥测、自托管 | Potluck 的品牌底线 |
| API/自动化 | CLI JSON、headless、export、submit | hub API、CSV/JSON 导出、agent | 两边可互补 |
| 性能架构 | Rust + rayon + simd-json + 缓存 | 每次通过子进程调用 tokScale，已做 watch delta 优化 | 不重写 Rust；减少重复扫描和复制 |
| 产品增长 | GitHub 身份、榜单、groups、embed 带来传播 | 下载型桌面工具，传播面弱 | 后期建立隐私友好的分享闭环 |

### 3.2 Potluck Monitor 已经做得更好的部分

以下能力不是“以后可以有”，而是必须保护的现有优势：

1. **一眼看到风险**  
   托盘、菜单栏和悬浮窗可以持续显示最紧张的额度窗口。
2. **额度与使用数据在同一产品**  
   用户不仅知道花了多少 token，还知道剩余多少、何时重置、哪个账号有风险。
3. **多设备是真实工作流，不是公开资料附属物**  
   台式机、笔记本、WSL、无头服务器可以汇总到同一视图。
4. **本地优先默认成立**  
   单机使用不需要账号、不需要云服务、不需要上传 transcript。
5. **桌面操作能力**  
   Codex 多账号切换、登录、快捷键、自更新、开机启动、托盘编排等无法由纯 Web/TUI 完整替代。
6. **面向非终端用户**  
   安装即用的签名桌面应用降低了 tokScale CLI 的使用门槛。

### 3.3 最值得向 tokScale 学习的部分

#### A. 查询模型，而不是继续加固定页面

tokScale 的强项不是“页面多”，而是同一份数据可以按以下维度自由组合：

- 时间范围；
- client；
- provider；
- model；
- workspace；
- session；
- client + model；
- client + provider + model；
- session + model；
- client + session + model。

Potluck Monitor 当前已有许多页面，但页面之间的筛选、范围和钻取不够统一。继续加新页面会让信息架构和维护成本越来越高。

应学习：

- 一个统一查询状态；
- 一套可组合维度；
- 所有图表和表格共享相同 scope；
- scope 可保存、复制、导出和通过 URL/深链恢复；
- 每个数字都能回答“从哪里来”。

#### B. 时间粒度与交互密度

tokScale 将 overview、daily、hourly、minutely、stats 和 agents 组织成连续分析路径，并支持键盘、鼠标、排序、复制、刷新、自动刷新、source picker 和 group-by picker。

应学习：

- 按阅读任务设计粒度，而不是只提供 today/month/all-time；
- 图表点击后进入同一 scope 的明细；
- 空间有限时仍保留决定性指标；
- 快捷操作有清晰、稳定的键盘路径；
- 视图偏好可持久化。

不应照搬：

- TUI 键位本身；
- 为展示丰富度而增加低价值标签页；
- 把终端密度原样搬进小组件。

#### C. 从数据到任务

tokScale 的 task-attributed report 会：

- 从 session 提取标题；
- 归类任务类型；
- 聚合相关 session；
- 生成工作分布；
- 支持不同总结后端；
- 缓存总结结果；
- 支持原始数据模式和 JSON。

这是 Potluck Monitor 当前最有价值的功能缺口之一。用户最终关心的不是“Claude 花了 8 亿 token”，而是：

- 这些 token 在做什么？
- 哪个项目最贵？
- 哪类工作最容易失控？
- 哪些 session 反复试错？
- 哪些模型在同类任务上性价比更好？

#### D. 分享与增长闭环

tokScale 将本地统计连接到：

- public profile；
- leaderboard；
- groups；
- GitHub badge；
- embed；
- Wrapped；
- autosubmit。

这形成自然传播，但公开排名不是 Potluck Monitor 的第一优先级。Potluck 应先学习“生成值得保存和分享的成果”，再决定是否建立公开网络。

#### E. 产品设计纪律

tokScale 的 `DESIGN.md` 明确强调：

- data before decoration；
- one fact, one home；
- compact, not cramped；
- ranking before promotion；
- 保留移动端的比较上下文；
- 无障碍、键盘、响应式和 reduced motion；
- 图表、贡献图、embed 都有明确的数据与交互合同。

Potluck Monitor 应把这些原则引入桌面端和未来 Web 控制台，尤其是：

- 一个事实只有一个主位置；
- 避免重复卡片；
- 数据来源、新鲜度和范围必须可见；
- 图表点击、键盘和屏幕阅读器得到等价信息；
- 视觉效果不应掩盖数据。

#### F. 工程边界和性能意识

tokScale 的 Rust core、扫描缓存、并行处理、原生平台包和明确的数据源文档，说明它把解析层当作独立产品。

Potluck Monitor 不需要复制 Rust core，但应学习：

- 把上游能力视为版本化依赖；
- 保存 capabilities，而不是假设某版本一定支持某字段；
- 把 scan、normalize、archive、sync、query、presentation 分层；
- 精确记录数据来源、估算和缺失；
- 对大数据集建立性能预算和回归测试；
- 避免每个 UI 页面自行聚合。

### 3.4 不应照搬的部分

1. **不重写 tokScale parser/core**  
   除非出现明确、量化、无法通过上游合作解决的阻塞。
2. **不优先做公开全球排行榜**  
   token 量不是生产力，容易激励浪费，也会引入作弊、隐私、内容审核和运维成本。
3. **不把 3D 图当核心价值**  
   3D 可以是分享或探索视图，但不是决策工具的默认表现。
4. **不把更多 client 数量当唯一北极星**  
   Potluck 的价值是跨使用、额度、设备和工作归因形成决策。
5. **不强制创建账号或云同步**  
   本地模式必须保持完整、可长期使用。
6. **不默认读取或上传提示词正文**  
   任务归因必须有本地、最小化、可预览、可撤销的隐私合同。
7. **不增加另一个平行设置系统**  
   GUI、agent、hub、未来 Web 控制台必须有清晰的单写者和配置权限。

---

## 4. 新产品定位

### 4.1 产品承诺

> Potluck Monitor 是本地优先的 AI 开发运营台：它把所有 AI 编程工具、账号和设备的使用、成本与额度放在一个常驻界面里，并告诉你风险在哪里、工作花费在哪里、下一步该采取什么行动。

### 4.2 一句话区别

- tokScale：**你用了多少 token，以及你在社区中的位置。**
- Potluck Monitor：**你的 AI 开发系统现在是否健康，以及该怎么调整。**

### 4.3 核心价值支柱

#### 1. Observe — 看见

- 实时用量；
- 成本；
- 额度；
- 余额；
- 设备；
- 工具；
- 模型；
- session；
- 项目；
- 数据新鲜度。

#### 2. Explain — 解释

- 为什么今天成本上升；
- 哪个项目、任务、工具、模型或设备贡献最大；
- 哪一类 token 增长；
- 哪些数据是精确值、估算值或缺失值；
- 哪个账号或额度窗口即将触顶。

#### 3. Act — 行动

- 切换账号；
- 调整默认模型；
- 设置预算和提醒；
- 查看异常 session；
- 导出证据；
- 打开对应工具或设置；
- 修复失效连接；
- 延长历史保留或完成同步。

#### 4. Review — 复盘

- 每日摘要；
- 每周回顾；
- 每月复盘；
- 项目成本；
- 任务组合；
- 模型性价比；
- 多设备工作分布；
- 可保存、可导出、可选择分享的报告。

---

## 5. 目标、非目标和成功指标

### 5.1 目标

#### G1. 将“查看数字”升级为“做出行动”

用户在发现额度、成本或数据异常后，可以在 30 秒内理解原因并找到下一步。

#### G2. 建立统一查询与钻取体验

同一时间范围和筛选条件可以在 Overview、Trends、Tools、Models、Projects、Sessions、Devices、Limits 和 Export 之间保持一致。

#### G3. 让跨设备数据可解释

每个聚合数字都能追溯到设备、client、model、project/session 和数据来源。

#### G4. 建立复盘习惯

用户不必手工整理 CSV，也能获得可信、简洁、可操作的周报和月报。

#### G5. 保持本地优先

不登录、不上传、不启用公共服务时，P0 和 P1 的核心能力仍然成立。

#### G6. 降低上游变更风险

tokScale 输出变化、部分 client 不支持某粒度、扫描失败或数据被清理时，Potluck Monitor 能明确降级，而不是静默显示错误数据。

### 5.2 非目标

- 不在本 PRD 中重写 tokScale；
- 不在 P0/P1 建立全球公开排行榜；
- 不把 token 消耗等同于生产力；
- 不自动修改用户的 AI 工具配置或模型选择；
- 不默认上传 session 内容；
- 不成为通用 LLM 网关或账单系统；
- 不承诺对所有 provider 获得完全一致的额度语义；
- 不在一个阶段重写整个 Electron renderer；
- 不在未验证用户需求前迁移到新的 UI 框架；
- 不把现有 desktop-only 操作强行迁到 Web。

### 5.3 北极星指标

**Weekly Actionable Review Completion**

定义：

> 每周至少一次打开周报，并完成至少一个后续动作的活跃本地安装比例。

后续动作包括：

- 打开异常明细；
- 创建或调整预算；
- 切换账号；
- 导出报告；
- 保存 scope；
- 标记任务；
- 查看模型比较；
- 修复数据源；
- 主动忽略一条建议并给出原因。

该指标默认仅保存在本机。若未来需要聚合产品分析，必须单独设计明确 opt-in 遥测，不属于本 PRD 默认范围。

### 5.4 质量和效果指标

| 指标 | P0 目标 | P1 目标 |
|---|---:|---:|
| 首屏可用数据时间 | 本地缓存 < 500ms；冷扫描明确显示进度 | 保持 |
| scope 切换反馈 | < 100ms 显示 loading 状态；常见本地查询 p95 < 500ms | 保持 |
| 关键数字可追溯率 | 100% 关键卡片可查看来源和范围 | 保持 |
| 数据新鲜度可见率 | 100% 设备与 provider 有状态 | 保持 |
| 额度风险误报 | 可解释并可关闭；不得静默重复骚扰 | 低于 5% 的用户手动判定误报 |
| 周报生成成功率 | — | 有完整数据时 > 99% |
| 任务归因覆盖 | — | 支持 session 的用量中 > 80% 可归入项目或任务 |
| 默认外发数据 | 0 | 0 |
| 无障碍 | 关键流程键盘可用，状态不用颜色单独表达 | WCAG 2.2 AA 对齐 |

---

## 6. 用户与核心任务

### 6.1 Persona A：多工具独立开发者

使用 Claude Code、Codex、Cursor、OpenCode 等多个工具，关心：

- 今天哪个工具最贵；
- 订阅额度何时耗尽；
- 某个项目为什么突然烧 token；
- 哪个模型在相似工作上更划算；
- 每周实际把 AI 用在什么事情上。

### 6.2 Persona B：多设备重度用户

在 Mac、Windows、WSL、服务器之间工作，关心：

- 数据是否都在线；
- 哪台设备没有更新；
- 是否重复采集；
- 同一个项目分布在哪些设备；
- 总成本和额度是否被单机视角误导。

### 6.3 Persona C：成本敏感的 API/订阅混合用户

同时使用订阅、预付余额和第三方 API，关心：

- 哪个账号最接近风险线；
- 余额按当前速度还能用多久；
- 月末是否超预算；
- 缓存是否真正节约了成本；
- 该切账号、切模型还是减少某类任务。

### 6.4 Persona D：隐私敏感用户

不愿上传提示词、项目名或设备身份，关心：

- 哪些数据被读取；
- 哪些数据离开设备；
- 任务归因是否会把正文交给云模型；
- 分享报告是否泄露客户和项目；
- 是否可以彻底删除摘要、缓存和历史。

### 6.5 Persona E：自托管维护者

运行 hub、agent、Worker 或未来 Web console，关心：

- 设备健康；
- ingest 状态；
- schema 兼容；
- 失败和重试；
- 配置单写者；
- 备份、恢复和升级。

---

## 7. 产品原则

### P1. Data before decoration

先显示数值、范围、来源、变化和风险，再考虑视觉效果。

### P2. One fact, one home

同一个事实只有一个主位置。其他页面通过链接、摘要或引用访问，不复制另一套逻辑。

### P3. Scope is a product primitive

时间、设备、client、provider、model、project、session、account 共同构成 scope。scope 必须可见、可保存、可复制、可恢复。

### P4. Every aggregate is drillable

总数必须能够钻取到构成它的记录。无法钻取时要解释数据源限制。

### P5. Exact, estimated, unavailable are different states

精确、推导、估算、缓存、过期、不可用必须在数据合同和 UI 中明确区分。

### P6. Local first, sharing second

报告先服务用户本人；分享是显式导出行为；公开身份是更晚的可选层。

### P7. Quiet by default

常驻工具不能制造持续焦虑。提醒要合并、冷却、可解释、可关闭。

### P8. Action beats alarm

每个警告至少给出一个合理动作；没有动作的告警只进入状态页，不主动打扰。

### P9. Upstream is a capability, not an implementation detail

tokScale 版本和 capability 必须被检测、记录和兼容处理。

### P10. Compact, not cramped

桌面小组件保持轻量；深度分析进入 dashboard/Web console，不把所有信息塞进一个窄窗口。

---

## 8. 信息架构

### 8.1 一级导航

建议收敛为五个任务域：

1. **Home**
   - 当前健康；
   - 今日成本/用量；
   - 最近风险；
   - 建议动作；
   - 数据新鲜度。
2. **Explore**
   - Trends；
   - Tools；
   - Models；
   - Projects；
   - Sessions；
   - Devices；
   - 统一 scope 和 group-by。
3. **Limits**
   - 账号；
   - 额度窗口；
   - 余额；
   - 预测；
   - 风险；
   - 切换与修复动作。
4. **Reviews**
   - Daily；
   - Weekly；
   - Monthly；
   - Saved reports；
   - Export/share。
5. **Settings**
   - Collection；
   - Accounts；
   - Sync；
   - Appearance；
   - Privacy；
   - Updates；
   - Advanced diagnostics。

当前独立视图不需要一次性删除。迁移期可保留旧导航，通过统一 scope 和 Explore shell 逐步收敛。

### 8.2 全局 scope bar

在深度分析面固定提供：

- 时间：
  - Today；
  - Yesterday；
  - Last 7 days；
  - This week；
  - This month；
  - Last 30 days；
  - Year；
  - All available；
  - Custom range；
- 设备；
- client/tool；
- provider；
- model；
- project/workspace；
- session；
- account（仅额度或可安全归因的使用数据）；
- group by；
- compare with previous period；
- 保存 scope；
- 清除 scope。

窄窗口只显示 scope 摘要和“在 Dashboard 中查看”入口，不展开完整筛选器。

### 8.3 Drill-down 路径

```text
Home risk / metric
  → scoped Explore view
    → grouped row or chart segment
      → session / device / account detail
        → source, freshness, token buckets, cost, related action
```

上下文不得在层级跳转时丢失。

---

## 9. 核心用户流程

### 9.1 “为什么今天这么贵？”

1. Home 显示今日成本较近 7 个同星期日基线上升 85%。
2. 用户点击异常卡片。
3. Explore 自动带入：
   - Today；
   - compare baseline；
   - group by project + model。
4. 用户看到项目 A 占增量的 72%，其中模型 X 输出 token 异常。
5. 点击项目 A，进入 sessions。
6. 找到两个高成本 session，并查看 token bucket、消息数、持续时间和任务标签。
7. 用户可：
   - 标记为预期；
   - 创建项目预算；
   - 导出明细；
   - 打开 session 来源；
   - 在周报中添加备注。

### 9.2 “我的额度还能撑多久？”

1. 托盘显示最紧张窗口。
2. 用户打开 Limits。
3. 顶部按风险排序展示：
   - 剩余；
   - 重置时间；
   - 当前消耗速度；
   - 预计耗尽时间；
   - 数据更新时间；
   - 置信度。
4. 若预计在重置前耗尽，显示原因和可执行动作。
5. 用户可以切换 Codex 账号、打开 provider 设置或静音该窗口提醒。

### 9.3 “这周 AI 帮我做了什么？”

1. Reviews 自动准备上周报告。
2. 报告显示：
   - 总 token/成本；
   - 活跃时间和天数；
   - 项目分布；
   - 任务类型；
   - 最大异常；
   - 缓存节省；
   - 额度风险；
   - 模型组合变化；
   - 数据缺口。
3. 用户可在生成任务归因前预览将被处理的元数据。
4. 若选择本地归因，不向网络发送正文。
5. 用户编辑标题、合并/拆分任务、隐藏敏感项目。
6. 导出 Markdown、JSON、PNG 或复制摘要。

### 9.4 “哪台设备掉线了？”

1. Home 显示一个设备数据过期。
2. 点击进入 Devices。
3. 显示：
   - 最后 ingest；
   - 最后完整扫描；
   - 最后 watch delta；
   - agent/app 版本；
   - tokScale 版本；
   - schema 版本；
   - 支持的 capabilities；
   - 最近错误；
   - 是否与另一采集器重复。
4. 给出对应修复说明，不把“无活动”和“采集失败”混为一谈。

---

## 10. 功能需求

优先级定义：

- **P0：** 下一阶段成立所必需；
- **P1：** 在 P0 数据基础稳定后提供核心差异化；
- **P2：** 经验证后扩展；
- **P3：** 不进入当前路线图，仅保留方向。

### 10.1 Epic A — Unified Analytics Query

#### UAQ-001：统一 scope 数据结构 — P0

系统必须定义单一 scope：

```json
{
  "range": {
    "preset": "last_7_days",
    "since": "2026-07-23",
    "until": "2026-07-29",
    "timezone": "Asia/Shanghai"
  },
  "filters": {
    "deviceIds": [],
    "clients": [],
    "providers": [],
    "models": [],
    "projects": [],
    "sessionIds": [],
    "accountIds": []
  },
  "groupBy": ["project", "model"],
  "compare": {
    "mode": "previous_period"
  }
}
```

验收：

- UI、导出和 API 使用同一规范化逻辑；
- 空数组表示不过滤；
- 日期边界和 timezone 明确；
- scope 可序列化；
- scope 版本化；
- 未支持的维度返回 capability 信息，不静默忽略。

#### UAQ-002：统一查询结果 — P0

查询结果至少包含：

- scope；
- totals；
- grouped rows；
- time series；
- token buckets；
- cost；
- message/session/active-time 指标；
- freshness；
- provenance；
- precision；
- warnings；
- capabilities；
- query duration。

#### UAQ-003：精确时间范围 — P0

支持：

- today；
- yesterday；
- week；
- month；
- rolling 7/30/90 days；
- year；
- custom inclusive range；
- all available。

验收：

- 所有范围使用 scope timezone；
- 显示自然语言范围；
- custom range 跨 DST 时保持日历语义；
- 不用 all-time 减法伪造任意历史范围；
- 若数据源无法提供精确历史，要标记 unavailable 或 estimated。

#### UAQ-004：时间粒度 — P0/P1

- P0：daily；
- P0：hourly，在有真实 session 时间或上游 hourly 数据时标记 exact；
- P0：当前由 session 活动近似的小时桶必须标记 estimated；
- P1：minutely 仅在真实数据和性能允许时提供；
- P1：自动选择合适粒度；
- P1：用户可手动切换可用粒度。

#### UAQ-005：组合分组 — P0

首批支持：

- client；
- provider；
- model；
- device；
- project；
- session；
- client + model；
- provider + model；
- project + model；
- device + client；
- session + model。

验收：

- 分组顺序有语义；
- 不同 provider 的同名模型是否合并必须可解释；
- 结果显示 canonical key 和 display label；
- unknown 不得被无声丢弃；
- 行可展开到下一层。

#### UAQ-006：保存和恢复 scope — P1

用户可以：

- 保存命名 scope；
- 设为默认 Explore scope；
- 复制深链；
- 在导出中包含 scope；
- 删除保存项；
- 在不兼容升级后看到迁移提示。

#### UAQ-007：查询缓存 — P0

- 缓存 key 包含 scope、data revision、schema version；
- 新 ingest 只失效相关查询；
- 冷启动先展示最后缓存结果及其时间；
- 不允许旧缓存伪装成实时结果；
- 大范围查询不能阻塞小组件主线程。

### 10.2 Epic B — Provenance and Data Health

#### PDH-001：数据来源标签 — P0

关键指标必须能显示：

- 来源 client；
- 来源设备；
- 来源类型：
  - local file；
  - SQLite；
  - provider API；
  - tokScale cache；
  - Potluck local archive；
  - hub aggregate；
- 最后更新时间；
- 最后完整扫描；
- 是否归档补全；
- precision：
  - exact；
  - derived；
  - estimated；
  - stale；
  - unavailable。

#### PDH-002：Capability negotiation — P0

每个设备上报：

- Potluck app/agent version；
- wire schema version；
- tokScale version；
- supported clients；
- supported dimensions；
- supported granularities；
- limits providers；
- session detail availability；
- project attribution availability；
- archive coverage。

hub 聚合不得假设所有设备能力一致。

#### PDH-003：数据健康中心 — P0

状态至少区分：

- 正常且有活动；
- 正常但无活动；
- 正在扫描；
- 数据过期；
- 认证过期；
- 数据源缺失；
- parser/adapter 不兼容；
- 网络失败；
- rate limited；
- 重复采集；
- 部分成功；
- archive gap。

#### PDH-004：兼容性降级 — P0

当 tokScale 输出变化时：

- 保留原始错误上下文的安全摘要；
- 不向 renderer 暴露凭据；
- UI 显示部分数据不可用；
- 其他 provider/client 继续工作；
- 记录 last good；
- 可导出 diagnostics；
- 自动更新不得在同一失败版本中无限循环。

### 10.3 Epic C — Cost and Limit Action Center

#### CLA-001：统一风险分数 — P0

每个额度窗口计算可解释的风险，而不是只按剩余百分比排序。

输入：

- remaining；
- total；
- resetAt；
- recent velocity；
- coverage；
- data freshness；
- provider semantics；
- user budget；
- manual threshold。

输出：

- normal；
- watch；
- likely_to_exhaust；
- exhausted；
- stale/unknown；
- reason codes；
- confidence。

不允许：

- 对余额型、固定窗口型和请求计数型使用同一错误公式；
- 在数据过期时继续给高置信度预测；
- 把零值默认解释为耗尽。

#### CLA-002：耗尽预测 — P0

在数据足够时显示：

- 预计耗尽时间；
- 重置前预计剩余；
- 速度基线；
- 置信度；
- 数据不足原因。

至少使用：

- 最近 24 小时；
- 最近 7 天同时间段；
- 用户本地 timezone；
- provider reset boundary。

首版可以使用透明的稳健统计，不需要复杂机器学习。

#### CLA-003：预算 — P0

预算可以绑定：

- 全局；
- provider；
- account；
- project；
- model；
- device；
- 自定义 scope。

周期：

- daily；
- weekly；
- monthly；
- custom date range。

预算动作：

- 仅显示；
- 托盘提醒；
- 系统通知；
- 加入周报；
- 静音；
- 延后提醒。

系统不得自动阻断请求或修改外部工具设置。

#### CLA-004：异常检测 — P1

检测：

- 成本突增；
- token 突增；
- cache hit rate 突降；
- output/input 比异常；
- 单 session 过大；
- 某模型占比突变；
- 重复采集迹象；
- 设备长期不更新；
- provider 额度数据异常跳变。

每个异常必须显示：

- 相比什么基线；
- 增量是多少；
- 主要贡献者；
- 是否可能由数据回填导致；
- 建议动作；
- 忽略/标记预期。

#### CLA-005：动作卡片 — P0

Home 最多显示 3 个高价值动作：

- 修复失效认证；
- 查看高成本 session；
- 切换有余量账号；
- 设置预算；
- 检查离线设备；
- 完成历史归档；
- 更新不兼容 tokScale；
- 打开周报。

禁止：

- 重复展示同一根因；
- 每次刷新重新出现已忽略动作；
- 无操作入口的泛化建议；
- 用红色制造无依据紧迫感。

### 10.4 Epic D — Pricing Accuracy and Auditability

#### PRC-001：实时价格目录 — P0

Potluck Monitor 必须明确使用 tokScale 的价格服务，并将
[LiteLLM `model_prices_and_context_window.json`](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
作为默认实时价格目录。

要求：

- 默认从 LiteLLM 获取最新模型价格；
- 使用 tokScale 当前的一小时本地缓存策略，避免每次扫描都访问网络；
- LiteLLM 不可用时，可以使用仍有明确时间戳的 stale cache；
- 保留 tokScale 的 OpenRouter、models.dev 和受控内置价格 fallback；
- 价格目录刷新失败不能阻塞 token 用量采集；
- UI 和 diagnostics 必须显示价格目录的来源、获取时间、缓存年龄和刷新错误；
- 不能把“实时价格”描述为 provider 账单；除非来源明确标记为 provider-reported，
  它只是按公开目录计算的估算成本。

#### PRC-002：完整 token bucket 与分层定价 — P0

成本计算必须分别处理：

- input；
- output；
- cache read；
- cache creation/cache write；
- reasoning（遵守上游模型的计费语义）；
- 128k、200k、256k、272k 等上游声明的长上下文价格档位。

验收：

- 不允许把 cache read 按普通 input 价格计算；
- 不允许忽略 cache write；
- 不允许把 reasoning 重复计入 output；
- 分层阈值必须按 tokScale 的原始 message/request 粒度计算，再聚合到 session、项目和周期；
- 不得在已经聚合的日/月总 token 上重新应用单请求长上下文阈值；
- provider 特有的“整次请求进入高价档”语义必须由 provider-aware 规则处理；
- 每种 bucket 和阈值边界都有精确测试。

#### PRC-003：价格来源和成本来源 — P0

每条可计价 observation 至少记录：

```json
{
  "costUsd": 0,
  "costKind": "estimated",
  "pricingSource": "LiteLLM",
  "matchedPricingKey": "openai/gpt-5.6-sol",
  "pricingFetchedAt": "",
  "pricingEffectiveAt": "",
  "pricingSchemaVersion": 1,
  "pricingConfidence": "exact_model_match"
}
```

`costKind` 至少区分：

- `provider_reported`；
- `estimated`；
- `custom`；
- `subscription_zero`；
- `unavailable`。

`pricingConfidence` 至少区分：

- exact provider + model；
- exact model；
- normalized alias；
- controlled fallback；
- fuzzy match；
- unavailable。

Potluck 不得丢弃 tokScale 已知的价格来源，也不得只保留一个无法解释的 `cost` 数字。

#### PRC-004：未知价格不等于免费 — P0

当模型没有可用价格时：

- `costUsd` 使用 `null`，不能默认为 `0`；
- UI 显示“价格未知”，不能显示 `$0.00`；
- period 总成本同时显示：
  - 已计价成本；
  - 未计价 token；
  - 未计价模型数量；
  - 成本覆盖率；
- 未知价格不得参与“最便宜模型”“节省金额”或预算安全结论；
- 只有明确的免费模型、订阅内零边际成本或 provider-reported zero，
  才能使用 `subscription_zero`/零成本语义；
- 导出必须保留 unknown 与 zero 的区别。

#### PRC-005：自定义价格不得静默降级 — P0

当前 Potluck 自定义价格 UI 只覆盖 input、output 和 cache read，而 tokScale
自定义价格模型支持 cache creation/cache write 和多个长上下文档位。自定义条目优先于
LiteLLM，因此不完整 override 可能把原本存在的 cache-write 或 tier price 变成缺失。

新合同必须二选一并明确展示：

1. **Complete override**：用户填写完整价格表，未填字段明确视为不计价；
2. **Layered override**：只覆盖用户填写字段，其余字段继承指定的上游精确匹配条目。

要求：

- UI 支持 cache write；
- UI 支持上游已有的 tier fields；
- 保存前显示将覆盖或继承哪些字段；
- 显示 override 的匹配范围和优先级；
- 删除 override 后恢复上游价格；
- 不允许 model alias 意外覆盖另一个模型；
- 自定义价格变更触发重算时，必须标记新的 pricing revision。

#### PRC-006：历史价格快照 — P0

历史成本必须区分：

- `cost_at_event`：发生时使用的价格或 provider-reported cost；
- `cost_at_current_price`：按当前目录重算，仅作为可选比较；
- `provider_reported_cost`：上游实际报告的金额。

要求：

- 默认历史报告使用 `cost_at_event`；
- 价格目录更新不得悄悄改写过去的周报、月报或预算结果；
- 用户主动选择“按当前价格重算”时必须显示说明；
- report snapshot 保存价格来源、版本和有效时间；
- provider-reported cost 优先于估算值，但两者可在 diagnostics 中对照；
- 汇率变化与模型美元单价变化分别记录。

#### PRC-007：价格审计与覆盖率 — P0

提供 Price Audit：

- 当前使用过的所有 model ID；
- provider/client；
- matched pricing key；
- source；
- base/tier/cache prices；
- 最近刷新时间；
- 本周期 token；
- 本周期已计价成本；
- 未知/零价/模糊匹配状态；
- custom override；
- 一键复制 diagnostics。

质量门槛：

- 发布前使用真实模型 ID fixture 审计；
- fuzzy match 不能静默进入高置信成本；
- 新出现且有 token 的未知模型进入数据健康中心；
- 成本覆盖率低于用户阈值时，预算和异常结论显示低置信度；
- LiteLLM、OpenRouter、models.dev 与 custom 的冲突选择有确定性测试。

### 10.5 Epic E — Work Attribution

#### WAT-001：确定性归因优先 — P1

在使用任何 LLM 前，先使用：

- workspace/project 路径；
- session metadata；
- git repository；
- client 提供的 title；
- cwd；
- branch；
- user-defined mapping；
- 现有 project rollup。

确定性结果必须可查看来源。

#### WAT-002：任务摘要隐私门 — P1

提供四种模式：

1. **Off**
2. **Metadata only**
3. **Local summarizer**
4. **External summarizer**

External summarizer 必须：

- 默认关闭；
- 先展示将发送的数据类别；
- 允许去除路径、项目名、文件名和正文；
- 明确 provider；
- 明确是否产生费用；
- 明确缓存位置和删除方法；
- 每个报告可单独选择。

#### WAT-003：任务数据结构 — P1

```json
{
  "taskId": "local-stable-id",
  "title": "修复同步网关鉴权",
  "category": "debugging",
  "projectId": "potluck-monitor",
  "sessionIds": [],
  "startedAt": "",
  "endedAt": "",
  "tokens": 0,
  "costUsd": 0,
  "activeMinutes": 0,
  "clients": [],
  "models": [],
  "summaryMode": "metadata_only",
  "confidence": 0.0,
  "userEdited": false
}
```

#### WAT-004：人工修正 — P1

用户可以：

- 重命名任务；
- 合并任务；
- 拆分任务；
- 更改类别；
- 移动到项目；
- 隐藏敏感任务；
- 锁定人工结果；
- 撤销；
- 删除所有自动摘要。

人工修改优先于后续自动归因。

#### WAT-005：任务比较 — P1

支持查看：

- 同类任务常用模型；
- token 和成本分布；
- session 数；
- 活跃时间；
- cache hit；
- 高成本异常；
- 数据覆盖和置信度。

不得把 token/成本直接解释为生产力或质量。

### 10.6 Epic F — Reviews and Shareables

#### REV-001：每日摘要 — P1

内容：

- 今日使用和成本；
- 与合理基线比较；
- 额度风险；
- 最大项目/任务；
- 数据健康；
- 最多一个建议动作。

默认不弹通知；由用户选择每日提醒。

#### REV-002：每周回顾 — P1

必须包含：

- 范围和 timezone；
- 数据覆盖；
- tokens/cost/active time/messages/sessions；
- 项目和任务分布；
- client/model 组合；
- cache 行为；
- 额度和预算事件；
- 主要变化；
- 异常；
- 用户备注；
- 建议动作；
- 数据缺口。

#### REV-003：月度复盘 — P1

在周报基础上增加：

- 月预算；
- provider/account 花费；
- 模型迁移趋势；
- 设备分布；
- 归档覆盖；
- 前月比较；
- 自定义目标进展。

#### REV-004：Wrapped — P1

Wrapped 是周/月报告的视觉摘要，不是独立数据管线。

要求：

- 所有数字来自同一个 report snapshot；
- 可选择隐藏成本、项目、设备和账号；
- 提供适合社交分享的 PNG；
- 提供适合归档的 Markdown/JSON；
- 分享前有隐私预览；
- 图片包含范围和生成时间；
- 不使用误导性生产力排名。

#### REV-005：可复现报告 — P1

报告保存：

- report schema version；
- scope；
- data revision；
- source coverage；
- generatedAt；
- app/tokScale version；
- user edits；
- privacy redactions。

同一 snapshot 的不同格式必须数值一致。

#### REV-006：公开 profile 实验 — P2

只有满足以下前置条件才进入：

- 用户研究证明存在持续需求；
- 隐私预览和删除流程完成；
- 反作弊和数据验证设计完成；
- 服务成本、滥用和内容审核责任明确；
- 本地产品不依赖账号；
- 公开指标不鼓励单纯烧 token。

首版可考虑：

- 私密链接；
- 到期链接；
- 匿名团队空间；
- 自托管 profile；

而不是直接建立全球榜单。

### 10.7 Epic G — Desktop and Headless Surfaces

#### DHS-001：小组件职责 — P0

小组件只承担：

- 当前健康；
- 今日核心指标；
- 最紧张额度；
- 最多 3 个动作；
- 快速刷新；
- 快速切号；
- 打开深度分析。

复杂筛选、长表格、任务编辑和报告配置进入 dashboard/Web console。

#### DHS-002：Dashboard/Web console — P0/P1

作为统一 Explore、Reviews 和深度设置的主要载体。

要求：

- 复用 hub/query contract；
- 本地 loopback 默认；
- 写设置时保持单写者；
- 权限和 secret 分层；
- browser refresh 不丢 scope；
- 支持键盘和窄屏；
- 不复制另一套聚合逻辑。

#### DHS-003：CLI/JSON 查询 — P1

Potluck 不需要复制 tokScale TUI，但应提供面向自动化的稳定查询入口：

```text
potluck-monitor query --scope <json> --format json
potluck-monitor review --week --format markdown
potluck-monitor health --json
```

具体命令名可在技术设计中调整。

目标：

- CI/脚本可用；
- 复用同一 query service；
- headless 用户无需 Electron；
- 输出 schema 版本化；
- 错误为机器可读。

#### DHS-004：命令面板和快捷键 — P1

深度界面提供：

- 搜索 view；
- 跳转项目/session/provider；
- 切换 scope；
- 导出；
- 刷新；
- 打开数据健康；
- 创建预算。

所有操作仍需有可发现的可点击入口。

### 10.8 Epic H — Optional Community

#### COM-001：团队共享报告 — P2

支持显式选择字段的团队报告，不上传 prompt/response。

#### COM-002：Group scopes — P2

团队可以定义：

- 成员；
- 项目；
- 时间范围；
- 可见指标；
- 预算；
- 角色；
- 数据保留。

#### COM-003：比较原则 — P2

团队比较默认使用：

- 预算健康；
- 额度风险；
- cache efficiency；
- 数据完整性；
- 模型组合；
- 周期变化。

不得默认以 token 总量排名个人。

#### COM-004：Embed/badge — P2

若实现：

- 一个模板一个信息任务；
- 数字可验证；
- 明确范围；
- 可撤销 token；
- 可关闭公开访问；
- SVG/PNG 输出经过转义和 CSP 检查；
- 不泄露设备、账号、项目或 session。

---

## 11. 数据模型

### 11.1 分层

```text
Source artifacts / provider APIs
            │
            ▼
tokScale raw report + limits collectors
            │
            ▼
Normalized observation
            │
            ├── local archive
            ├── device snapshot
            └── sync payload
                    │
                    ▼
              hub aggregation
                    │
                    ▼
            unified query service
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
      UI/API      export      reviews
```

### 11.2 Normalized observation

目标不是立即改写现有 wire shape，而是定义查询层需要的规范记录。

最小字段：

```json
{
  "schemaVersion": 1,
  "observedAt": "",
  "occurredAt": "",
  "timezone": "",
  "deviceId": "",
  "client": "",
  "provider": "",
  "model": "",
  "projectId": "",
  "sessionId": "",
  "accountId": "",
  "tokens": {
    "input": 0,
    "output": 0,
    "cacheRead": 0,
    "cacheWrite": 0,
    "reasoning": 0,
    "total": 0
  },
  "costUsd": 0,
  "messageCount": 0,
  "activeSeconds": 0,
  "source": {
    "kind": "local_file",
    "adapter": "tokscale",
    "adapterVersion": "4.7.0"
  },
  "precision": "exact"
}
```

不要求所有来源填满所有字段。缺失值使用 `null` 或明确 capability，不用零值伪装。

### 11.3 身份与稳定键

- display name 与 canonical ID 分离；
- provider + model 不应只靠显示名连接；
- project 路径默认不得跨设备原样同步；
- project 使用本地映射后的稳定、可撤销 ID；
- accountId 不能等于邮箱或凭据；
- sessionId 在同步前遵守现有隐私和 payload 限制；
- 用户可重命名但不改变内部稳定键。

### 11.4 历史和修订

每次 query 绑定 `dataRevision`。

触发修订：

- 新设备 ingest；
- 本地完整扫描；
- watch delta；
- archive 回填；
- 用户任务编辑；
- pricing 变化；
- 设备删除；
- 数据修复。

pricing 变化必须区分：

- 按发生时定价；
- 按当前定价重算；
- provider reported cost。

UI 不得把三者混为一个无标签的 cost。

---

## 12. 隐私与安全合同

### 12.1 默认规则

- 不需要账号；
- 不向项目维护者发送遥测；
- 不上传 prompt；
- 不上传 response；
- 不上传源代码；
- 不上传原始文件路径；
- 不公开设备、账号和项目；
- 分享和外部总结均为明确 opt-in。

### 12.2 数据分类

| 类别 | 示例 | 默认位置 | 默认可同步 |
|---|---|---|---|
| Usage aggregate | token、cost、model | 本地；用户配置的 hub | 是，遵守现有 sync |
| Limit aggregate | remaining、resetAt | 本地；用户配置的 hub | 是，不能带原始凭据 |
| Device metadata | OS、version、freshness | 本地；hub | 是，最小化 |
| Project identity | 路径、repo 名 | 本地 | 否；需映射 |
| Session metadata | session ID、时间、client | 本地 | 受限 |
| Prompt/response | 对话正文 | 本地来源 | 否 |
| Credentials | cookie、token、key | credential store | 否 |
| Task summary | 标题、类别 | 本地 | 否，除非显式报告 |
| Public profile | 用户选择的统计 | 可选服务 | 仅显式提交 |

### 12.3 外部总结预览

发送前必须展示：

- provider；
- 模型；
- 将发送的字段类别；
- 字符/记录数量；
- 是否包含路径；
- 是否包含项目名；
- 是否包含 prompt 摘要；
- 预计费用（可得时）；
- 保留政策链接；
- 本次允许按钮。

### 12.4 删除

用户可独立删除：

- task summaries；
- report snapshots；
- saved scopes；
- usage archive；
- local caches；
- provider credentials；
- synced device；
- public share；
- public account。

删除前说明后果和可恢复性。

---

## 13. UX 规格

### 13.1 Home

首屏只保留：

- Overall health；
- Today tokens/cost；
- 最紧张额度；
- 数据新鲜度；
- 最多 3 个动作；
- 简短趋势。

不应：

- 重复展示同一总数；
- 同时放多个视觉权重相同的大卡片；
- 把所有 provider 展开；
- 把设置表单放在 Home。

### 13.2 Explore

桌面宽屏：

- 顶部 scope bar；
- 左侧或顶部 view/group selector；
- 主图；
- 对应明细表；
- 点击后的 detail panel；
- provenance drawer。

窄屏：

- scope 摘要；
- 单列图表；
- 信息完整的列表；
- 不要求水平滚动；
- 关键字段不能因为空间不足被隐藏。

### 13.3 Limits

默认按 actionability 排序，而不是 provider 固定顺序：

1. exhausted；
2. likely to exhaust before reset；
3. stale/auth failure；
4. watch；
5. healthy。

用户保存的自定义顺序仍可作为第二视图。

### 13.4 Reviews

报告以结论开头：

1. 本周期发生了什么；
2. 最大变化；
3. 风险；
4. 建议动作；
5. 证据和明细。

避免把报告做成连续的指标卡墙。

### 13.5 状态表达

- 颜色不是唯一信号；
- stale 与 error 不同；
- exact 与 estimated 有文本/图标；
- loading 不清空 last good；
- 空状态解释为什么为空；
- 错误给出可执行恢复路径；
- reduced motion 下关闭非必要动效。

---

## 14. 技术策略

### 14.1 明确所有权

| 层 | 所有者 |
|---|---|
| Client 数据定位与解析 | tokScale |
| tokScale 调用、版本、capability、兼容 | Potluck collector adapter |
| Limits API 与账号 | Potluck limits runtime |
| 规范化与聚合 | Potluck shared/query layer |
| 多设备传输 | Potluck sync/hub/Worker |
| 历史归档 | Potluck archive |
| 查询、预算、异常、报告 | Potluck product layer |
| 桌面操作 | Electron main |
| 可视化与交互 | renderer/dashboard/Web console |

### 14.2 不直接重写现有 wire contract

首阶段通过适配方式扩展：

- 明确 schema version；
- 增加 capabilities；
- 增加 provenance/freshness；
- 保持旧 client 可降级读取；
- Worker 与 Node hub 同步兼容；
- 对 payload 体积设置预算。

### 14.3 Query service

所有消费面通过 query service：

- Electron IPC；
- hub HTTP；
- dashboard；
- export；
- review generator；
- 未来 CLI。

不得让每个 renderer view 再实现一遍：

- 时间过滤；
- model 合并；
- project rollup；
- cost 汇总；
- previous period；
- freshness。

### 14.4 tokScale adapter

要求：

- 检测实际版本；
- 能力表；
- 输出 fixture；
- tolerant reader；
- 版本兼容测试；
- last-good fallback；
- 原始错误安全摘要；
- update rollback/重试边界；
- 上游新增字段不导致失败；
- 上游缺失字段不被解释为零。

### 14.5 性能预算

P0 目标：

- app 启动先显示缓存，不等待全量扫描；
- renderer 不解析大型原始 tokScale JSON；
- watch tick 不触发三次等价全盘扫描；
- query 在 worker thread/独立进程或非阻塞路径执行；
- 大范围数据按日预聚合；
- session 明细按需读取；
- hub payload 有硬上限和字段预算；
- 100 万 observation 的常见 daily query p95 < 1 秒，具体基准在 Phase 0 用真实数据校准；
- 内存峰值和 scan duration 写入 diagnostics。

### 14.6 Web 设置单写者

遵循现有 deep operations inventory：

- Web 不直接写 `settings.json`；
- Electron main 或明确的 config service 是单写者；
- desktop-only 操作留在 desktop；
- Web 使用受保护的 settings API；
- 读权限和写权限分开；
- hubMode=local 时仍有明确可用路径；
- 凭据永不回显原文。

---

## 15. 发布阶段

每个阶段进入代码前需要：

- 用户/产品确认；
- 技术设计；
- 影响文件列表；
- 迁移与回滚；
- 测试计划；
- 性能预算；
- 隐私评审。

遵循项目规则：每个实施阶段最多触碰 5 个文件；更大的改动必须拆分并逐阶段验证。

### Phase 0 — Measurement and Contract

**目标：** 在不改产品体验前，建立真实基线和数据合同。

交付：

- 当前所有 view → 数据来源映射；
- tokScale 版本/输出 fixture 矩阵；
- 当前使用模型的 Price Audit；
- LiteLLM/cache/fallback/custom 价格来源矩阵；
- unknown、zero、estimated 和 provider-reported 成本清单；
- exact/derived/estimated 清单；
- scope schema v1；
- query result schema v1；
- capability schema；
- 性能基准；
- payload 体积基准；
- 现有数据缺口列表；
- UX 原型。

退出门槛：

- 不存在未定义的关键指标；
- 未知价格不会被当作免费；
- 当前成本覆盖率和未计价 token 已量化；
- today/month/all-time 的来源和边界明确；
- hourly 近似被识别；
- Node hub 与 Worker 兼容策略明确；
- 用户批准 Phase 1。

### Phase 1 — Query Foundation

**目标：** 一个 scope、一个 query layer、一个 provenance 模型。

交付：

- scope normalization；
- query service；
- pricing provenance、costKind 和 coverage；
- event-time pricing snapshot；
- 完整 token bucket 与 tier pricing contract；
- daily/custom range；
- 首批组合 group-by；
- provenance/freshness；
- capability negotiation；
- 缓存和 dataRevision；
- API/IPC adapter；
- 旧 UI 兼容。

退出门槛：

- 旧页面数字与新 query 在同 scope 下对账；
- 标准价格、cache 折扣、长上下文档位和未知价格 fixture 对账；
- Node/Worker/local 三模式一致；
- 新查询不阻塞 renderer；
- lint、完整 tests、打包 smoke 全通过；
- 真实大数据集性能通过。

### Phase 2 — Health and Action

**目标：** 从数字到风险和动作。

交付：

- 数据健康中心；
- Price Audit；
- unknown-price health event；
- limit risk；
- exhaustion forecast；
- budgets；
- Home action cards；
- 提醒冷却与忽略；
- diagnostics export。

退出门槛：

- 所有告警有 reason code；
- stale 不触发高置信耗尽；
- 余额/百分比/请求型窗口分别测试；
- 多账号和多设备测试；
- 通知不会重复轰炸。

### Phase 3 — Explore UX

**目标：** 统一深度分析体验。

交付：

- global scope bar；
- Explore shell；
- Trends/Tools/Models/Projects/Sessions/Devices 迁移；
- exact/estimated hourly；
- drill-down；
- compare period；
- saved scope；
- keyboard/accessibility。

退出门槛：

- 所有关键聚合可钻取；
- scope 跨 view 保留；
- 320px 至宽屏无关键数据丢失；
- 无水平页面滚动；
- reduced motion、键盘和屏幕阅读器关键流程通过。

### Phase 4 — Work Attribution

**目标：** 解释 token 花在什么工作上。

交付：

- deterministic attribution；
- privacy mode；
- local/metadata summarization；
- 可选 external summarizer；
- task editor；
- task comparison；
- summary cache/delete。

退出门槛：

- 默认不外发；
- external 模式有完整预览；
- 人工修改稳定保留；
- 归因错误可纠正；
- 任务数据不进入现有 sync payload，除非单独显式设计。

### Phase 5 — Reviews and Wrapped

**目标：** 建立复盘和分享闭环。

交付：

- daily/weekly/monthly report；
- Markdown/JSON/PNG；
- privacy redaction；
- report snapshot；
- Wrapped；
- CLI/API report。

退出门槛：

- 三种格式数字一致；
- 报告可复现；
- 隐私预览通过；
- 空数据、部分数据、多设备和 archive 回填场景通过。

### Phase 6 — Optional Community Discovery

**目标：** 验证是否需要公开/团队网络。

先研究，不默认编码：

- 访谈；
- 私密分享链接；
- 自托管 profile；
- 团队报告；
- group scope；
- 反作弊；
- 删除和导出；
- 服务成本。

只有明确证据支持时才进入公开 profile 或 leaderboard。

---

## 16. 验收与测试矩阵

### 16.1 数据正确性

- 单设备、本地模式；
- 多设备、相同时区；
- 多设备、不同时区；
- hub host/client；
- Node hub；
- Cloudflare Worker；
- WSL；
- archive 开/关；
- session 被删除后的历史；
- provider reported cost；
- custom pricing；
- pricing 更新；
- 同名 model、多 provider；
- unknown client/model；
- partial token buckets；
- all-zero 正常数据；
- stale last good；
- tokScale 输出字段新增/缺失/改名 fixture。

### 16.2 时间

- 日界线；
- 月界线；
- 年界线；
- inclusive since/until；
- DST；
- leap day；
- reset boundary；
- 跨时区设备；
- 当前日未结束；
- custom range；
- previous period；
- rolling range。

### 16.3 Limits

- 百分比窗口；
- credits/余额；
- requests；
- unlimited；
- missing total；
- missing reset；
- reset 已过；
- authentication failure；
- rate limit；
- 多账号；
- account switch；
- amount jump；
- stale；
- provider 部分成功。

### 16.4 Pricing

- LiteLLM fresh cache；
- LiteLLM stale cache；
- LiteLLM 无网络且无 cache；
- OpenRouter fallback；
- models.dev fallback；
- exact provider + model；
- exact model；
- normalized alias；
- fuzzy match；
- unknown model；
- explicit subscription zero；
- provider-reported cost；
- input/output/cache read/cache write/reasoning；
- 128k/200k/256k/272k 阈值边界；
- 单请求 tier 后再聚合；
- custom complete override；
- custom layered override；
- override 删除恢复上游；
- event-time cost；
- current-price revaluation；
- 汇率变化；
- 成本覆盖率；
- 未计价 token 导出。

### 16.5 UX

- 首次运行无数据；
- 大数据；
- 超长 model/project 名；
- 5 种语言；
- dark/light；
- reduced motion；
- keyboard only；
- screen reader；
- 320/390/768/1024/1440 宽度；
- 离线；
- 慢查询；
- 刷新中；
- 查询失败；
- scope 深链；
- 返回导航。

### 16.6 隐私

- renderer 无 credential；
- export 无 account email/hostname；
- task summary 默认不外发；
- external preview 字段准确；
- redaction；
- 删除；
- share revoke；
- loopback 绑定；
- API auth；
- settings read/write permission；
- malicious project/model label 转义；
- SVG/Markdown/CSV injection。

### 16.7 发布验证

每个阶段至少：

```bash
npm run lint
npm test
npm run verify
```

涉及发布面时还需要：

- macOS arm64 package smoke；
- macOS x64 package smoke；
- Windows installer/portable smoke；
- Linux AppImage smoke；
- auto-update metadata；
- Node hub；
- Worker drift check；
- 真实数据 fresh-eyes walkthrough；
- 日志中无未处理异常和凭据。

若项目未来增加 type-checker，必须将 strict type-check 纳入门禁。

---

## 17. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| tokScale 输出变化 | 数据中断或误算 | version/capability、fixture、tolerant adapter、last good |
| 页面继续各自聚合 | 数字不一致 | query service 单一事实源 |
| scope 组合爆炸 | 性能和 UX 复杂 | 首批限制维度组合、保存 scope、查询预算 |
| 多设备重复采集 | 成本虚高 | collector identity、重复检测、diagnostics |
| 小时数据是近似 | 用户误判 | exact/estimated 标记，优先上游真实数据 |
| 任务摘要泄密 | 严重信任损失 | 默认关闭、metadata/local first、预览、删除 |
| 告警焦虑 | 用户关闭产品 | quiet default、冷却、合并、可解释、可忽略 |
| token 排名诱导浪费 | 品牌和行为偏差 | 不以 token 量作为个人生产力排名 |
| 公共服务成本 | 运维负担 | P2 后置，先私密/自托管实验 |
| Electron renderer 继续膨胀 | 可维护性下降 | 分阶段迁移、删除死代码、每阶段 ≤5 文件 |
| payload 变大 | Worker/网络问题 | 字段预算、预聚合、capability、按需明细 |
| pricing 回溯变化 | 报告不一致 | 区分 occurred/current/provider-reported cost |
| 多套设置写入 | 配置损坏 | 单写者、受保护 API、事务和迁移 |

---

## 18. 产品决策记录

### D1. 不重写 tokScale

**决定：** 继续将 tokScale 视为解析和基础聚合引擎。  
**原因：** 上游覆盖面、Rust 性能、更新速度和维护规模远高于重复实现的合理收益。  
**复审条件：** 出现持续、量化、上游无法解决的兼容性、隐私或性能阻塞。

### D2. 先做统一查询，再做新图表

**决定：** P0 不以增加页面数量为目标。  
**原因：** 没有统一 scope 和 query，新页面会继续复制聚合逻辑并产生数字漂移。

### D3. 先做行动与复盘，后做社交

**决定：** 公共 profile、group、leaderboard 放到 P2。  
**原因：** Potluck 的差异化是本地运营和额度健康，社交会引入新的信任与运维问题。

### D4. 不以 token 总量评价生产力

**决定：** token 是资源指标，不是产出质量指标。  
**原因：** 排名会激励浪费，并对模型、缓存、任务复杂度和订阅结构产生错误解释。

### D5. 任务归因默认不外发

**决定：** 先确定性和本地归因，再提供显式外部总结。  
**原因：** session 内容和项目身份具有最高隐私风险。

### D6. 小组件保持轻量

**决定：** 深度分析主要进入 dashboard/Web console。  
**原因：** 常驻窗口的核心任务是快速感知和行动，不是承载完整 BI。

---

## 19. 待确认问题

进入 Phase 0 时需要产品负责人明确：

1. 下一阶段最优先服务：
   - 重度个人用户；
   - 多设备用户；
   - 成本敏感用户；
   - 小团队；
   - 自托管用户；
   哪一个是第一 persona？
2. 深度分析的主载体：
   - 独立 Electron dashboard；
   - Potluck Web console；
   - 两者共享前端；
   哪个作为正式主路径？
3. 是否接受在本地保存规范化 observation，还是继续只保存日聚合和有限 session？
4. project ID 跨设备如何映射，是否允许用户建立显式 project alias？
5. P0 是否需要精确 hourly，还是先把现有近似明确标记？
6. 预算是否先支持 cost，还是同时支持 token、额度百分比和 credits？
7. 本地总结后端的最低平台要求是什么？
8. 外部总结首批允许哪些 provider？
9. 是否需要 Potluck CLI，还是优先扩展 hub API？
10. Wrapped 的第一目标是私人复盘还是社交传播？
11. 是否完全排除官方托管服务，还是保留私密分享链接实验？
12. 现有未发布的 Potluck gateway/Web console 如何纳入本 PRD 的主路径？

这些问题不阻止 PRD 评审，但会影响 Phase 0 的技术和 UX 选择。未确认前，不应直接进入大规模实现。

---

## 20. 建议的首个实施切片

如果本 PRD 获得批准，第一段代码不应是排行榜、Wrapped 或任务总结。

建议首个切片：

> **Scope + Query Contract Spike**

范围：

- 只读；
- 不改 wire payload；
- 不改现有 UI 主流程；
- 用现有本地数据实现：
  - custom date range；
  - client/model/device 三类 filter；
  - client + model group-by；
  - provenance；
  - exact/estimated；
- 输出 JSON fixture 和一个内部调试视图；
- 与当前 today/month/all-time 对账；
- 建立性能基线。

成功后再决定正式迁移哪个页面。

---

## 21. 最终产品判断

tokScale 证明了 token usage 产品可以从“命令行统计”成长为：

- 数据引擎；
- 分析工具；
- 个人身份；
- 社区；
- 分享媒介。

Potluck Monitor 已经证明了另一件更重要的事：

- 使用数据可以常驻；
- 额度和成本可以统一；
- 多设备可以实时；
- 本地优先可以做到无需账号；
- 桌面端可以把数据变成随手可用的操作界面。

下一阶段最优路线不是在 tokScale 的每条赛道上追赶，而是利用两者的组合优势：

```text
tokScale 的广度、解析和查询能力
                 +
Potluck 的常驻、额度、多设备和操作能力
                 =
本地优先的 AI 开发运营台
```

真正的成功标准不是“新增了多少张图”，而是用户能否更快回答并处理以下问题：

- 我的 AI 开发系统现在健康吗？
- 哪个额度或预算最危险？
- 今天的成本为什么变化？
- token 花在了什么工作上？
- 哪个模型或账号应该调整？
- 哪台设备或数据源出了问题？
- 这周值得保留的结论是什么？

当 Potluck Monitor 能稳定回答这些问题时，它就不再只是 tokScale 的桌面显示层，而会成为 tokScale 之上的完整个人 AI Operations 产品。
