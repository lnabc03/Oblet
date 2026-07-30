# Oblet 技术设计文档

> 一个轻量、快速、基于 Obsidian 和 AnuPpuccin 深度定制的独立 Markdown 编辑器：双击任意位置的 .md 即可打开编辑，开箱即是打磨到位的 AnuPpuccin 深色外观。
>
> - 平台：Windows（第一版）
> - 定位：GitHub 开源，MIT 许可
> - 版本：v2 设计基线
> - 修订：v1.1（2026-07-30 设计评审）——类名对齐改阅读视图体系、设置改窗口内浮层、图片收紧为绝对路径、换行符跟随原文件、时间盒聚焦 M1+M2 核心
> - 修订：v1.2（2026-07-30 实装后）——编辑器改 Crepe 底座（数学/代码块/表格/工具栏成品化），主题兼容增加 --crepe-\* 变量桥接
> - 修订：**v2.0（2026-07-30 定位调整）——放弃 Obsidian 主题兼容层。** Milkdown（ProseMirror）与基于 CodeMirror 6 的 Obsidian 主题体系架构性不合，逐一手动适配不现实。主题兼容层代码彻底删除，当前定制版 AnuPpuccin 深色主题固化为唯一默认主题（仅维护深色；浅色未来将单独定制一套，再加深浅切换）。后续迭代只做三件事：修复已知问题、打磨操作体验、保障性能，保持轻量快速定位。

---

## 1. 总体架构

```
┌─────────────────────────────────────────────┐
│  Tauri Shell (Rust)                         │
│  - 窗口管理（每文件一窗口）                  │
│  - 文件读写 / 自动保存落盘                   │
│  - 外部文件变更监听（notify）                │
│  - 配置存储 ./data/settings.json             │
│  - 跨窗口事件广播（排版设置变更）            │
├─────────────────────────────────────────────┤
│  Frontend (TypeScript + Vite)               │
│  - Milkdown/Crepe 编辑器（ProseMirror 内核） │
│  - 内置主题：AnuPpuccin 深色定制（静态打包） │
│  - 序列化保真层（保存不侵入原文）            │
│  - 设置浮层（排版覆盖）                      │
└─────────────────────────────────────────────┘
```

**关键原则：前端不直接碰文件系统。** 所有 IO 通过 Tauri command 走 Rust 侧，便于统一处理编码、换行符、原子写入。

**第一原则：序列化保真。** 编辑器保存时不得对 Markdown 原文做任何侵入性修改——不改写未编辑区域的任何字符（不加 `\` 行尾、不把 `---` 写成 `***`、不插入 `<br />`、不注入转义实体、不擅增删空行）。任何与 Obsidian 双向编辑同一文件时会导致渲染异常或 git diff 噪音的输出都视为 bug。见第 5 节。

## 2. 技术栈选型

| 层     | 选型                                    | 理由                                                                                     |
| ----- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| 外壳    | Tauri 2.x                             | 体积小（<10MB）、启动快、绿色版友好                                                                   |
| 前端构建  | Vite + TypeScript                     | 标配                                                                                     |
| 编辑器   | Milkdown 7（锁定 ≥7.21.3）+ Crepe 成品编辑器底座 | 斜杠菜单/工具栏/表格 UI/链接提示/图片块开箱即用；latex 功能以真节点实现数学公式（同时解决序列化转义问题）；7.21.3 修复两个 XSS CVE，作为安全基线 |
| UI 框架 | 无（原生 DOM）                             | 设置界面很小，避免引入重型框架                                                                        |
| 数学    | KaTeX（Crepe latex 功能）                 | 决策已定                                                                                   |
| 代码高亮  | Crepe code-mirror 功能（CodeMirror 6 内核） | 代码块为 CM6 编辑器（缩进/括号匹配/语言选择），高亮走 CM 体系                                                   |
| 主题    | 内置 AnuPpuccin 深色定制（静态打包）+ Ob 变量桥接基座   | 见第 4 节                                                                                 |

## 3. 目录结构（仓库）

```
oblet/
├─ src-tauri/            # Rust 侧
│  ├─ src/
│  │  ├─ main.rs
│  │  ├─ lib.rs          # 窗口管理、单实例、文件监听
│  │  ├─ commands.rs     # 文件 IO（读写、换行符、内容哈希）
│  │  ├─ settings.rs     # settings.json 读写
│  │  └─ state.rs        # 窗口↔路径映射、哈希缓存
│  └─ tauri.conf.json
├─ src/                  # 前端
│  ├─ main.ts            # 入口（CSS 顺序敏感）
│  ├─ editor/
│  │  ├─ setup.ts        # Crepe 实例装配 + 文件生命周期
│  │  ├─ plugins.ts      # 编辑器内插件集
│  │  └─ frontmatter.ts  # frontmatter 节点/属性栏 + 序列化保真层
│  ├─ settings/
│  │  ├─ typography.ts   # 排版覆盖 + 持久化 + 跨窗口广播
│  │  └─ ui.ts           # 设置浮层（Ctrl+, 唤起）
│  └─ styles/
│     ├─ obsidian-base.css      # Ob 结构基座 + --ob-* 变量桥接
│     └─ anuppuccin-custom.css  # 内置主题：AnuPpuccin 深色定制
├─ scripts/
│  └─ register-md.reg    # 可选：.md 默认打开方式注册脚本
├─ data/                 # 运行时生成（绿色版数据目录）
└─ package.json
```

## 4. 主题：内置 AnuPpuccin 深色定制

**v2.0 决策：不做主题系统。** 主题 CSS 不经运行时加载，直接静态打包进应用：

1. **主题文件**：`src/styles/anuppuccin-custom.css`，源自 AnuPpuccin（GPL-3.0，保留版权头与 attribution）+ Style Settings 定制。
2. **Style Settings 定制固化**：原 `oblet-theme.json` 的 34 个定制类（mocha-old flavor、彩虹标题色、强调色 mauve 等）写死在 `index.html` 的 `<body class="theme-dark …">`；扩展 CSS 变量并入基座。
3. **变量桥接基座保留**：`obsidian-base.css` 的 `--ob-*` 变量层继续承担两个职责——(a) 把 Ob 主题变量（`--background-primary` 等）桥接到编辑器自有样式与 Crepe 组件变量（`--crepe-*`），(b) 提供深色 fallback。这是静态桥，不再支持换主题。
4. **排版覆盖保留**：用户可在设置中覆盖正文/等宽/界面字体与基础字号（对齐 Obsidian appearance.json 语义，内联样式优先级高于主题）。
5. **浅色主题**：当前仅维护深色。未来单独定制一套浅色后，再加固化的深/浅切换（不涉及主题系统复活）。

GPL-3.0 合规：AnuPpuccin 要求再分发时保留版权与许可声明、注明出处；theme.css 文件头已保留，README 需保留 Buy Me a Coffee 链接。

## 5. 序列化保真层（核心模块）

目标：**Oblet 与 Obsidian 可以无损地双向编辑同一文件。** 保存输出与原文字节级接近，差异仅限用户实际编辑的区域。

已实现机制（`src/editor/frontmatter.ts`）：

| 机制                                          | 解决的问题                                                     |
| ------------------------------------------- | --------------------------------------------------------- |
| `remark-frontmatter` + 自定义 `frontmatter` 节点 | YAML 头不被误解析为 hr/标题；属性栏 NodeView（键值表格编辑，回写 `key: value` 行） |
| `rule: '-'`、`bullet: '-'`                   | hr 写 `---` 不写 `***`（否则毁掉 frontmatter 围栏）；列表符号对齐 Ob 习惯     |
| 自定义 `text` 处理器                              | 撤销 `\[!`→`[!`（callout）、`\==`→`==`（高亮）两类破坏 Ob 语义的转义        |
| 自定义 `break` 处理器                             | Shift+Enter 硬换行写普通换行，不写行尾 `\`（往返字节级稳定）                    |
| 自定义 `join` 处理器                              | 容忍 Milkdown 把列表 spread 存成字符串的缺陷，紧凑列表不再被序列化成宽松（项间不乱插空行）    |
| 解析侧任务项空格修剪（remark 插件）                       | 消除 `[x]  文字` 残留前导空格被转义成 `&#x20;` 的污染                      |
| 移除 `remark-preserve-empty-line` 选项切片        | 空段落写回普通空行，不注入 `<br />`                                    |
| 内容哈希过滤（Rust 侧）                              | 自身写入不触发"外部变更"重载（Windows rename 覆盖保存会发 Remove 事件）          |

已知合理规范化（渲染等价，首次保存即稳定，之后往返字节级不变）：勾选框后双空格→单空格；段落与列表间保持一个空行；宽松列表保持项间空行。

回归测试：`test-break-roundtrip.mjs`（换行）、`test-list-roundtrip.mjs`（列表/任务）在仓库根，改序列化逻辑后必跑。

## 6. 快捷键

使用 Milkdown/Crepe 默认键位（与 Obsidian 大部分一致）。v1.x 不做用户自定义键位；个别高频诉求（如回车=软换行、Shift+Enter=新段落）作为内置可选项在打磨期按需加入，不依赖 vault/hotkeys.json。

## 7. 文件与保存

- **打开**：双击 .md → 系统以文件路径为参数启动（或唤醒）Oblet → Rust 侧读文件（UTF-8，自动探测 BOM；GBK 等非 UTF-8 第一版弹提示并只读）→ 每文件一个窗口。实例内维护 路径→窗口 映射：**重复打开同一文件时聚焦已有窗口**，防止两个窗口自动保存互相覆盖丢内容。也支持把 .md 直接拖入窗口就地渲染。
- **自动保存**：输入停止 1s 防抖 → Tauri command 原子写入（写临时文件 + rename）。`Ctrl+S` 立即保存。**换行符跟随原文件**：打开时探测 CRLF/LF，保存时 Rust 侧把 Milkdown 输出的 LF 转换回原样，避免 git 管理的笔记出现全文件换行 diff。内容与磁盘一致时不写回（未编辑零改动）。
- **外部变更**：notify 监听文件；外部修改时若当前无未落盘内容则自动重载，有则弹提示（不做三方合并）。自身保存通过内容哈希过滤，不触发重载。
- **本地图片**：v1 仅支持绝对路径图片（`![](绝对路径)`），asset 协议 scope 放开；按 md 所在目录解析相对路径留 v2。暂不支持粘贴图片落盘（v2 候选）。

## 8. 配置方案 `./data`

运行时只保留排版设置：

```json
{
  "version": 1,
  "editor": {
    "auto_save": true,
    "auto_save_delay_ms": 1000,
    "text_font": null,
    "mono_font": null,
    "interface_font": null,
    "base_font_size": null
  }
}
```

排版变更通过 Tauri 事件向所有窗口广播，多窗口即时一致。`null` = 跟随主题。

## 9. 分发

- Tauri 构建产出 `oblet.exe` + 依赖，打 zip 绿色包。
- 附 `scripts/register-md.bat`：可选双击运行（自定位同目录 exe，HKCU 免管理员），将 Oblet 注册进 .md 的打开方式列表，默认应用由用户手动选择（Windows 11 不允许程序自封默认）；含卸载脚本 unregister-md.bat。
- GitHub Actions：tag 触发 Windows 构建并发布 Release（v1 不签名，README 说明 SmartScreen 提示）。

## 10. 里程碑

> 定位调整后不再设功能型里程碑。主线只有一条：**把现有体验打磨到可以发布**。以下按优先级排列，不设时间盒。

| 阶段               | 内容                                                                   | 出口标准                 |
| ---------------- | -------------------------------------------------------------------- | -------------------- |
| **P1 修复与打磨**（当前） | 修复已知问题；操作体验打磨（键位细节、属性栏交互、列表/表格编辑手感）；大文档性能检查                          | 日常自用无阻塞性问题，序列化回归测试全过 |
| **P2 发布**        | 绿色打包、register-md.reg、README（含 AnuPpuccin attribution）、GitHub Actions | Release v0.1.0 发布    |
| **P3 候选**（按需启）   | 单独定制浅色主题 + 深浅切换；相对路径图片；粘贴图片落盘；源码模式                                   | 逐项单独立项               |

## 11. 风险清单

| 风险                                            | 等级 | 应对                                               |
| --------------------------------------------- | -- | ------------------------------------------------ |
| Milkdown 序列化引入新的侵入性改写（升级依赖后回归）                | 中  | 保真层集中在 frontmatter.ts 一处；回归测试必跑；依赖升级前审 changelog |
| Milkdown 对 Ob 特有语法（\[\[wikilink]]、callout）无支持 | 低  | 按普通文本/引用渲染即可，v2 可写插件                             |
| 非 UTF-8 编码文件                                  | 低  | 只读提示，v2 做转码                                      |
| 大文件性能                                         | 低  | 目标 <1MB md；P1 阶段实测，必要时降级纯文本模式（v2）                |

## 12. 明确不做的

- 不做主题系统、不兼容 Obsidian 社区主题、不做运行时主题导入（v2.0 决策；浅色仅未来单独定制一套）
- 不做 vault 概念：不扫描 vault、不读取 .obsidian 配置、不继承 hotkeys.json
- 不做库/文件树/双链/图谱/插件系统/同步
- 不做移动端、macOS、Linux
- 不做安装器（绿色版 + 可选 reg 脚本）
- 不做 Markdown 导出（PDF/HTML）
- 不做源码模式：仅所见即所得（Milkdown 无双模式），源码视图 v2 候选
- 不做相对路径图片解析：v1 仅绝对路径图片

