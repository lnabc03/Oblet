# Acrylic 窗口效果适配方案

> window-vibrancy 0.8.0 | Windows 10 v1809+ / Windows 11
> 统计日期：2026-08-03

## 一、API 参数

```rust
// window-vibrancy 0.8.0
pub fn apply_acrylic(window, color: Option<Color>) -> Result<(), Error>
pub type Color = (u8, u8, u8, u8);  // (R, G, B, A) 各分量 0-255
```

**`color`** — 模糊层之上的着色叠加：

| 值 | 效果 |
|----|------|
| `None` | 默认黑色底色 |
| `Some((r, g, b, a))` | RGBA 着色，alpha=0 会被内部强制改为 1（Acrylic 不允许全透明） |

**内部实现双路径**（crate 自动选择）：

1. Win11 build 22621+：`DwmSetWindowAttribute` + `DWMSBT_TRANSIENTWINDOW`（公开 DWM）
2. Win10 v1809+ / 旧版 Win11：`SetWindowCompositionAttribute` + `ACCENT_ENABLE_ACRYLICBLURBEHIND`（传统 API）

**与 Mica 的本质区别**：

| | Mica | Acrylic |
|----|------|------|
| 采样源 | 仅桌面壁纸 | 窗口背后的**实时内容** |
| 视觉效果 | 淡彩磨砂 | 毛玻璃模糊 + 着色 |
| 性能 | 好 | 拖拽/缩放时差（已知问题） |
| 平台 | Win11 only | Win10 1809+ / Win11 |
| 参数 | `dark: Option<bool>` | `color: Option<(u8,u8,u8,u8)>` |

## 二、Rust 侧改动

```
src-tauri/src/commands.rs:
  - set_window_effect: 支持 "acrylic" → apply_acrylic(&window, color)
  - 新增可选的 acrylic_color 设置字段（或在 set_window_effect 中硬编码暗色着色）
  - 关闭时 clear_acrylic（已存在）

src-tauri/src/settings.rs:
  - EditorSetting: window_effect 已有 "mica"，新增 "acrylic" 值
  - 可选新增 acrylic_color: Option<[u8;4]> 字段

src-tauri/src/lib.rs:
  - 无需改动（set_window_effect 命令已注册）
```

## 三、前端元素适配清单

### 3.1 已适配（Mica 透明链，Acrylic 直接复用）

`body.ob-vibrancy` 规则覆盖以下元素，Acrylic 开启时同样生效：

| # | 选择器 | 当前值 | 文件:行 |
|---|--------|--------|---------|
| 1 | `html:has(body.ob-vibrancy)`, `body.ob-vibrancy` | `background: transparent` | obsidian-base.css:116-118 |
| 2 | `body.ob-vibrancy .milkdown` | `background: transparent` | obsidian-base.css:121-123 |
| 3 | `body.ob-vibrancy .pin-btn, .settings-btn` | `rgba(ctp-surface0, 0.5)` | obsidian-base.css:125-128 |
| 4 | `body.ob-vibrancy .settings-panel` | `rgba(ctp-base, 0.8)` + blur(1px) saturate(2) | obsidian-base.css:132-139 |
| 5 | `body.ob-vibrancy .toast` | 同上（合并在同一条规则） | obsidian-base.css:132-139 |
| 6 | `body.ob-vibrancy .ob-confirm` | 同上 | obsidian-base.css:132-139 |
| 7 | `body.ob-vibrancy .context-menu` | 同上 | obsidian-base.css:132-139 |
| 8 | `body.ob-vibrancy .search-bar` | 同上 | obsidian-base.css:132-139 |
| 9 | `body.ob-vibrancy .search-bar input` | `rgba(ctp-base, 0.45)` | obsidian-base.css:142-144 |

### 3.2 待适配（建议加入 Acrylic 透明链）

| # | 选择器 | 当前背景 | 优先级 | 说明 |
|---|--------|----------|--------|------|
| 10 | `.milkdown-code-block` | `var(--ob-bg-alt)` 实色 | **高** | 代码块面积大，实色会完全遮挡 Acrylic |
| 11 | `table`（编辑器内） | `var(--ob-bg)` 实色 | **高** | 表格也是大面积色块 |
| 12 | `.ob-frontmatter` | `var(--ob-bg-alt)` 实色 | **高** | 属性栏在文档顶部，视觉焦点 |
| 13 | `.callout` | `rgba(callout-color, 0.1)` | 中 | 已半透明，可微调 alpha |
| 14 | `blockquote` | `var(--ob-quote-bg)` | 中 | 侧边引用区条状色块 |
| 15 | `.readonly-banner` | `var(--ob-bg-alt)` 实色 | 低 | 顶部窄条，影响小 |

**适配原则**：
- 容器半透明化（露出 Acrylic 模糊），内部文字/高亮保持不透明保可读
- 代码块：行号区/折叠按钮跟随父容器半透明，代码 token 保持当前颜色
- 表格：`<td>` 内部不设背景，仅 `<table>` 整体半透明
- 属性栏：`<input>` 编辑态已有透明处理，外层容器加半透明即可

### 3.3 保持不透明（无需修改）

| # | 元素 | 原因 |
|---|------|------|
| 16 | `code`（行内） | 元素太小，透明后不可读 |
| 17 | `.ob-highlight`（==高亮==） | 语义叠加色，透明无意义 |
| 18 | `.ob-active-block`（当前行底色） | alpha 0.045 已极淡 |
| 19 | `.ob-confirm-overlay`, `.settings-overlay` | 遮罩层，0.35 黑已是最优值 |
| 20 | `.ob-confirm-primary`（确认按钮） | 强调色，需保持醒目 |
| 21 | `::selection`（选区） | 系统行为，不干预 |
| 22 | `.tab-arrow-left/right` | 纯 SVG 灰色箭头，半透明已合适 |
| 23 | `.empty-new-note:hover` | 仅 hover 态微亮 |

### 3.4 CSS 新增规则模板

```css
/* Acrylic 毛玻璃链路：在现有 body.ob-vibrancy 基础上追加以下覆盖 */

/* 代码块：容器半透明，token 前景保持不变 */
body.ob-vibrancy .milkdown-code-block {
  background: rgba(var(--ctp-crust, 30, 30, 46), var(--mica-float-opacity, 0.8));
  backdrop-filter: blur(1px) saturate(2);
  -webkit-backdrop-filter: blur(1px) saturate(2);
}

/* 表格 */
body.ob-vibrancy .markdown-rendered table {
  background: rgba(var(--ctp-base, 30, 30, 46), var(--mica-float-opacity, 0.8));
}

/* 属性栏 */
body.ob-vibrancy .ob-frontmatter {
  background: rgba(var(--ctp-base, 30, 30, 46), var(--mica-float-opacity, 0.8));
}

/* callout：微调 alpha（当前 0.1 已半透明，可增大） */
body.ob-vibrancy .markdown-rendered .callout {
  background: rgba(var(--callout-color), 0.15);
}

/* 引用块 */
body.ob-vibrancy .markdown-rendered blockquote {
  background: rgba(var(--ctp-crust, 30, 30, 46), 0.5);
}

/* 只读横幅 */
body.ob-vibrancy .readonly-banner {
  background: rgba(var(--ctp-base, 30, 30, 46), 0.5);
}
```

## 四、设置面板改动

```
src/settings/ui.ts:
  - Mica 复选框改为或新增下拉/单选：关闭 | Mica | Acrylic
  - Acrylic 选中时可选暴露着色选择器（RGBA 四滑块），也可先硬编码默认暗色着色

src/settings/typography.ts:
  - window_effect 字段值扩展："mica" | "acrylic" | null
  - 可选新增 acrylic_color 字段
  - applyTypography 中 set_window_effect 调用按 effect 值分发
```

## 五、导出 PDF 兼容

`src/editor/setup.ts` 打印逻辑已处理 Mica 关闭（`afterprint` 恢复）。Acrylic 与 Mica 使用同一套开/关机制（`window_effect`），当前代码无需改动——打印前关闭、打印后恢复的逻辑对 Acrylic 同样适用。

## 六、验证清单

- [ ] Acrylic 开启后 html/body/milkdown 透出毛玻璃效果
- [ ] 代码块半透明但代码可读
- [ ] 表格半透明但文字可读
- [ ] 属性栏半透明但键值可编辑
- [ ] 浮层（设置/toast/菜单/确认框）显示正常
- [ ] 打印 PDF 自动关闭/恢复 Acrylic
- [ ] Win10 环境下回退到传统 API（`is_swca_supported` 分支）
- [ ] 拖拽/缩放窗口无明显卡顿
- [ ] 序列化回归测试全 PASS（Acrylic 不影响 md 内容）
