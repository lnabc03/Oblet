# Oblet 技术设计文档

> 一个轻量、快速的独立 Markdown 编辑器：双击任意位置的 .md 即可打开编辑，外观兼容 Obsidian 主题，快捷键可继承 Obsidian 用户配置。
>
> - 平台：Windows（第一版）
> - 定位：GitHub 开源，MIT 许可
> - 版本：v1 设计基线

---

## 1. 总体架构

```
┌─────────────────────────────────────────────┐
│  Tauri Shell (Rust)                         │
│  - 窗口管理（每文件一窗口）                  │
│  - 文件读写 / 自动保存落盘                   │
│  - 配置存储 ./data                           │
│  - vault 扫描（主题、hotkeys.json）          │
│  - 跨窗口事件广播（主题/设置变更）           │
├─────────────────────────────────────────────┤
│  Frontend (TypeScript + Vite)               │
│  - Milkdown 编辑器（ProseMirror 内核）       │
│  - 主题兼容层（类名对齐 + CSS 变量桥接）     │
│  - 快捷键映射层（hotkeys.json → keymap）     │
│  - 设置界面                                  │
└─────────────────────────────────────────────┘
```

**关键原则：前端不直接碰文件系统。** 所有 IO 通过 Tauri command 走 Rust 侧，便于统一处理编码、换行符、原子写入。

## 2. 技术栈选型

| 层 | 选型 | 理由 |
|---|---|---|
| 外壳 | Tauri 2.x | 体积小（<10MB）、启动快、绿色版友好 |
| 前端构建 | Vite + TypeScript | 标配 |
| 编辑器 | Milkdown 7 | headless、全插件架构，所见即所得开箱即用 |
| UI 框架 | 无（原生 DOM）或 Preact | 设置界面很小，避免引入重型框架 |
| 数学 | KaTeX（@milkdown/plugin-math） | 决策已定 |
| 代码高亮 | Shiki 或 Prism（Milkdown 插件） | Shiki 还原度更好，体积略大；建议 Shiki |
| CSS 策略 | 一份「Ob 兼容基座」+ 主题注入 | 见第 4 节 |

## 3. 目录结构（仓库）

```
oblet/
├─ src-tauri/            # Rust 侧
│  ├─ src/
│  │  ├─ main.rs
│  │  ├─ commands.rs     # 文件 IO、配置、vault 扫描
│  │  ├─ watcher.rs      # ./data 配置文件变更监听（多窗口同步）
│  │  └─ state.rs
│  └─ tauri.conf.json
├─ src/                  # 前端
│  ├─ main.ts
│  ├─ editor/
│  │  ├─ setup.ts        # Milkdown 实例装配
│  │  ├─ plugins.ts      # GFM / math / shiki / history
│  │  └─ keymap.ts       # 快捷键映射层
│  ├─ theme/
│  │  ├─ bridge.ts       # CSS 变量桥接
│  │  ├─ loader.ts       # theme.css 导入/注入/卸载
│  │  ├─ vault.ts        # vault 主题读取
│  │  └─ fallback.css    # 内置默认主题（仿 Ob 默认）
│  ├─ settings/
│  │  ├─ schema.ts       # settings.json 类型定义
│  │  └─ ui.ts           # 设置窗口
│  └─ styles/
│     └─ obsidian-base.css  # Ob 类名结构基座
├─ scripts/
│  └─ register-md.reg    # 可选：.md 默认打开方式注册脚本
├─ data/                 # 运行时生成（绿色版数据目录）
└─ package.json
```

## 4. 主题兼容层（核心模块）

目标：拿一份 Obsidian 社区主题的 `theme.css`，不做修改就能获得 85–95% 的观感还原。

### 4.1 双轨策略

**轨道 A：CSS 变量桥接（兜底，保证任何主题"不崩"）**

维护一张映射表，把 Obsidian 的核心变量映射到编辑器自己的样式变量：

```css
:root {
  --ob-bg:        var(--background-primary, #fff);
  --ob-bg-alt:    var(--background-secondary, #f5f5f5);
  --ob-text:      var(--text-normal, #222);
  --ob-text-mut:  var(--text-muted, #888);
  --ob-accent:    var(--interactive-accent, #7b6cd9);
  --ob-font:      var(--font-text, var(--font-interface, sans-serif));
  --ob-font-mono: var(--font-monospace, monospace);
  /* 标题色 */
  --ob-h1: var(--h1-color, var(--text-normal));
  /* … 约 30~50 个核心变量 */
}
```

编辑器基座样式全部使用 `--ob-*` 变量。即使主题只定义了变量（很多主题如此），换肤也能生效。

**轨道 B：DOM 类名对齐（主力，提升还原度）**

Milkdown 是 headless 的，DOM 结构可自定义。为每个节点渲染器套上 Obsidian 的类名约定：

| 元素 | Ob 类名 |
|---|---|
| 编辑容器 | `.markdown-source-view.mod-cm6` |
| 行 | `.cm-line` |
| 标题 | `.cm-header-1` … `.cm-header-6` |
| 加粗/斜体 | `.cm-strong` / `.cm-em` |
| 链接 | `.cm-link` / `.cm-url` |
| 代码块 | `.HyperMD-codeblock` 或 `.cm-line.code`（调研后定） |
| 引用块 | `.HyperMD-quote` |
| 预览渲染容器（如有纯预览态） | `.markdown-rendered` |

模式切换时在 `document.body` 上挂 `.theme-dark` / `.theme-light`，主题 CSS 中对应的变量块自然生效。

### 4.2 主题加载流程

1. **手动导入**：选择/拖入 `theme.css`（可选同目录 `manifest.json` 读取主题名、作者）→ 复制到 `./data/themes/<name>/` → 写入 settings 的主题列表 → 注入 `<style data-theme="name">`。
2. **vault 读取**：设置中配置 vault 路径 → 扫描 `<vault>/.obsidian/themes/*/theme.css` → 与手动导入的主题合并列表，标记来源。
3. **切换**：替换 `<style>` 内容 + 切换 body 类。Tauri 侧发 `theme-changed` 事件，其余窗口监听后同步换肤。
4. **清理**：对 theme.css 做一次轻量 sanitize——剔除 `@import url(http…)` 远程引用和 `url(javascript:…)`，其余原样保留。

### 4.3 验收标准（M2 出口）

用 3 个热门主题实测：**Minimal**、**Things**、**AnuPpuccin**。要求：背景/正文/标题/引用/代码块/链接六类元素观感正确；暗亮切换正常；无明显对比度事故。边角细节（如某主题特有的 callout 样式）允许缺失。

## 5. 快捷键映射层

1. 读取 `<vault>/.obsidian/hotkeys.json`（JSON：命令 ID → 修饰键+键位数组）。
2. 维护**白名单映射表**，仅覆盖编辑器内可实现的命令：

| Ob 命令 ID | Milkdown 动作 |
|---|---|
| `editor:bold` / `editor:italic` / `editor:code` | 对应 mark 切换 |
| `editor:insert-link` | 链接输入 |
| `editor:toggle-checklist-status` | task item 切换 |
| `app:toggle-dark-mode`（如存在） | 暗/亮切换 |

3. 未在白名单内的 Ob 命令静默忽略；未被用户自定义的键位回退到 Milkdown 默认（其默认与 Ob 大部分一致）。
4. 映射冲突时：hotkeys.json 优先。

## 6. 文件与保存

- **打开**：双击 .md → 系统以文件路径为参数启动（或唤醒）Oblet → Rust 侧读文件（UTF-8，自动探测 BOM；GBK 等非 UTF-8 第一版弹提示并只读）→ 每文件一个窗口。
- **自动保存**：输入停止 1s 防抖 → Tauri command 原子写入（写临时文件 + rename）。`Ctrl+S` 立即保存。设置项可关闭自动保存。
- **外部变更**：文件被外部修改时，若当前无未落盘内容则自动重载；有则弹提示（v1 不做三方合并）。
- **本地图片**：按 md 文件所在目录解析相对路径，Tauri asset 协议映射加载。暂不支持粘贴图片落盘（v2 候选）。

## 7. 配置方案 `./data`

```
data/
├─ settings.json
└─ themes/<name>/theme.css (+manifest.json)
```

`settings.json` 草案：

```json
{
  "version": 1,
  "theme": { "active": "Minimal", "mode": "dark", "followSystem": false },
  "vault": { "path": "D:/notes/main", "importThemes": true, "importHotkeys": true },
  "editor": { "autoSave": true, "autoSaveDelayMs": 1000, "fontSize": 16 },
  "window": { "width": 960, "height": 720 }
}
```

配置变更由 Rust 侧 watcher 监听并向所有窗口广播，保证多窗口一致。

## 8. 分发

- Tauri 构建产出 `oblet.exe` + 依赖，打 zip 绿色包。
- 附 `scripts/register-md.reg`：可选双击导入，将 .md 默认打开方式指向 exe（含卸载脚本 unregister.reg）。
- GitHub Actions：tag 触发 Windows 构建并发布 Release（v1 不签名，README 说明 SmartScreen 提示）。

## 9. 里程碑

| 里程碑 | 内容 | 出口标准 |
|---|---|---|
| **M1 骨架** | Tauri 工程、Milkdown 装配、打开/编辑/自动保存、单文件窗口 | 双击 md 可编辑并保存，GFM+数学+代码高亮可用 |
| **M2 主题兼容层** | 变量桥接 + 类名对齐 + 手动导入 + 暗亮切换 + fallback 主题 | 通过 4.3 验收 |
| **M3 vault 集成** | vault 主题扫描、hotkeys.json 白名单映射 | 导入真实 vault 后主题/快捷键继承生效 |
| **M4 打磨发布** | 设置界面、多窗口广播、打包、Actions、README | Release v0.1.0 发布 |

## 10. 风险清单

| 风险 | 等级 | 应对 |
|---|---|---|
| Ob 主题类名覆盖面大，个别主题细节错位 | 中 | M2 用真实主题早验证；变量桥接兜底 |
| Milkdown 对 Ob 特有语法（[[wikilink]]、callout）无支持 | 低 | v1 明确不支持，按普通文本/引用渲染即可；v2 可写插件 |
| 非 UTF-8 编码文件 | 低 | v1 只读提示，v2 做转码 |
| 大文件性能 | 低 | v1 目标 <1MB md；超出时降级为纯文本模式（v2） |
| Tauri 单实例/多窗口参数传递细节 | 中 | M1 早期用 tauri-plugin-single-instance 验证 |

## 11. 明确不做的（v1）

- 不做库/文件树/双链/图谱/插件系统/同步
- 不做移动端、macOS、Linux
- 不做安装器（绿色版 + 可选 reg 脚本）
- 不做 Markdown 导出（PDF/HTML）
