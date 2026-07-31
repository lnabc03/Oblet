# Oblet

轻量、快速的独立 Markdown 编辑器（Windows）。双击任意 `.md` 文件即开即编辑，每个文件一个窗口——不需要库（vault）、不需要登录、不收集任何数据。

主题固化为 AnuPpuccin 深色定制版，视觉向 Obsidian 看齐；第一原则是**序列化保真**：保存不会对你的 Markdown 原文做任何侵入性修改，与 Obsidian 双向编辑同一文件无损。

<!-- 截图待补：深色主题编辑界面 / 属性栏（frontmatter）/ callout -->

## 特性

- **双击即编辑**：注册为 `.md` 处理程序后，双击文件直接打开；每文件一窗口，单实例（重复打开聚焦已有窗口）
- **所见即所得**：基于 Milkdown / Crepe；标题、列表、任务列表、表格、代码块（语法高亮）、块级公式（KaTeX）
- **笔记属性（frontmatter）**：`---` 元数据渲染为键值属性栏，可直接编辑
- **Callout**：`> [!note]` 等 Obsidian 风格提示块，30 种类型图标，右键菜单一键创建/切换/回退
- **高亮**：`==文本==` 语法，渲染时隐藏标记
- **检索与替换**：Ctrl+F 全文档高亮、循环跳转、逐个/全部替换
- **自动保存**：防抖自动保存 + Ctrl+S；原子写入（临时文件 + rename），换行符跟随原文件
- **外部变更监听**：文件被外部修改时自动重载（有未保存内容则提示，绝不静默覆盖）
- **绿色便携**：单 exe，设置存于 exe 同级 `data/settings.json`，可手改

## 下载与使用

1. 从 [Releases](https://github.com/lnabc03/Oblet/releases) 下载 `Oblet-x.y.z-win-x64.zip`，解压到任意位置
2. **注册双击打开**（可选）：右键 `register-md.bat` → 以管理员身份运行，将 `.md` 关联到 Oblet；`unregister-md.bat` 解除关联
3. 双击任意 `.md` 文件，或将文件拖入 Oblet 窗口

### SmartScreen 提示

首次运行 Windows 可能弹出"Windows 已保护你的电脑"（SmartScreen）：因为 exe 没有付费代码签名证书。点击"更多信息"→"仍要运行"即可。源码全部公开，可自行构建验证。

### 自行构建

```bash
npm install
npm run tauri build   # 产出 src-tauri/target/release/oblet.exe
```

需要 Node.js 18+ 与 Rust 工具链（Tauri 2 前置条件见官方文档）。

## 快捷键

| 快捷键 | 功能 |
|---|---|
| Ctrl+S | 立即保存 |
| Ctrl+F | 检索 / 替换 |
| Ctrl+/ | 设置 |

## 许可与致谢

- Oblet 源码：[GPL-3.0 License](LICENSE)（Copyright © 2026 弋鹓 | lnabc03）——因包含 GPL-3.0 许可的 AnuPpuccin 衍生样式，整体按 GPL-3.0 发布
- 编辑器主题基于 **[AnuPpuccin](https://github.com/AnubisNekhet/AnuPpuccin)**（GPL-3.0）修改定制，感谢作者 AnubisNekhet——如果你喜欢这个主题，可以[请作者喝杯咖啡](https://www.buymeacoffee.com/anubisnekhet)
- 构建于 [Milkdown](https://milkdown.dev/) / [Crepe](https://github.com/Milkdown/crepe)、[CodeMirror](https://codemirror.net/)、[KaTeX](https://katex.org/)、[Tauri](https://tauri.app/) 之上
- 发行包 `licenses/` 目录内含全部第三方许可文本

作者：弋鹓 | [lnabc03](https://github.com/lnabc03)
