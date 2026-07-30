# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Unsigned macOS auto-update:** builds without a Developer ID signature now download the release zip in the background (proxy-aware, with progress) and install it in place on restart — no manual DMG trip. Signed builds keep the native updater path.
- **Price audit:** models tokscale cannot price no longer show a misleading $0.00 — they read *Price unknown*, and the row expansion shows the pricing source and matched catalog key when a price exists.
- **Drag to reorder:** reorder Home modules, Settings groups, and the view switcher menu by dragging.
- **Home gateway card:** the Potluck Gateway card now lives with Multi-device Sync, shows the tunnel URL and gateway API key with one-tap copy, and can open the web console.

### Fixed
- **Settings page:** expanded sections scroll internally, so the next section header stays in view instead of being pushed off screen.
- **Day view:** activity and trends now distribute by hour instead of calendar date.
- **Interface languages:** reduced to English and 简体中文; removed Discord integration and stale version/links from Settings → General.
<!-- app-update-notes:en:end -->

## Download

- **macOS Apple Silicon** — [potluck-monitor-0.1.1-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.1.1/potluck-monitor-0.1.1-arm64.dmg)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**macOS:** the build is unsigned. Open the `.dmg`, drag Potluck Monitor to Applications, then either right-click → Open the first time, or run:

```bash
xattr -dr com.apple.quarantine "/Applications/Potluck Monitor.app"
```

### Other notes

Only macOS Apple Silicon is pre-built — run from source per the [README](https://github.com/Ezero23/potluck-monitor#readme) for anything else. The macOS `.zip` is the same app repackaged for the auto-updater; ignore it unless you need it.

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
- **未签名 macOS 自动更新：** 没有 Developer ID 签名的构建现在可以在后台下载 release zip（走代理、带进度），重启时自动替换安装，不用手动拖 DMG。已签名构建仍走原生更新通道。
- **价格审计：** tokscale 拿不到价格的模型不再显示误导性的 $0.00，而是显示「价格未知」；有价格时，展开行可以看到定价来源和匹配的目录键。
- **拖拽排序：** 主页模块、设置分组、视图切换菜单都可以直接拖动排序。
- **主页网关卡片：** Potluck 网关卡片与多设备同步放在一起，显示隧道地址和网关 API 密钥并可一键复制，还能直接打开 Web 控制台。

### 修复
- **设置页面：** 展开的分区改为内部滚动，下一个分区标题始终停留在视野内，不再被顶出屏幕。
- **Day 视图：** 活动和趋势按当天小时分布，不再按日期。
- **界面语言：** 只保留 English 和简体中文；移除 Discord 集成，清理设置 → 常规里过时的版本号与链接。
<!-- app-update-notes:zh:end -->

## 下载

- **macOS Apple Silicon** — [potluck-monitor-0.1.1-arm64.dmg](https://github.com/Ezero23/potluck-monitor/releases/download/v0.1.1/potluck-monitor-0.1.1-arm64.dmg)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**macOS：** 本构建未签名。打开 `.dmg`，把 Potluck Monitor 拖到 Applications，首次启动右键 → 打开，或者运行：

```bash
xattr -dr com.apple.quarantine "/Applications/Potluck Monitor.app"
```

### 其他说明

目前只提供 macOS Apple Silicon 预构建版本，其他平台请参考 [README](https://github.com/Ezero23/potluck-monitor#readme) 从源码运行。macOS 的 `.zip` 是给自动更新用的同一个 app，除非明确需要，否则可以忽略。

### tokscale 依赖

Tokscale 已随应用内置。你可以在 **设置 → Tokscale** 查看确切版本，
也可以直接从 npm 下载更新版本。Tokscale 是 MIT 开源项目：
https://github.com/junhoyeo/tokscale

</details>
