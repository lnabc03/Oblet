# Oblet

![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011%20%C2%B7%20Android-0078D4)
![License](https://img.shields.io/badge/license-GPL--3.0-green)

轻量、快速的独立 Markdown 编辑器（Windows / Android）。双击 `.md` 即开即编辑，支持单窗口多标签页，不需要库（vault）、登录或联网，不收集任何数据。

内置 6 款白名单复刻主题，均支持深色 / 浅色 / 跟随系统。第一原则是**序列化保真**：保存不对 Markdown 原文做侵入性修改，与 Obsidian 双向编辑同一文件无损。

## 主题

每张截图左半为深色模式，右半为浅色模式。

| AnuPpuccin | Minimal |
| --- | --- |
| ![AnuPpuccin](https://picgo-rainote.oss-cn-guangzhou.aliyuncs.com/obsidian/20261105162344155.png) | ![Minimal](https://picgo-rainote.oss-cn-guangzhou.aliyuncs.com/obsidian/20261105162513552.png) |
| **Things** | **GitHub** |
| ![Things](https://picgo-rainote.oss-cn-guangzhou.aliyuncs.com/obsidian/20261105162550038.png) | ![GitHub](https://picgo-rainote.oss-cn-guangzhou.aliyuncs.com/obsidian/20261105162447859.png) |
| **Atom** | **Nord** |
| ![Atom](https://picgo-rainote.oss-cn-guangzhou.aliyuncs.com/obsidian/20261105162418619.png) | ![Nord](https://picgo-rainote.oss-cn-guangzhou.aliyuncs.com/obsidian/20261105162529844.png) |

## 特性

### 编辑

- 所见即所得：标题、列表、任务列表、表格、代码块高亮与 KaTeX 公式，支持选区拖动
- Mermaid 图表：` ```mermaid ` 代码块直接渲染流程图、时序图、甘特图等 20+ 种图，配色跟随主题
- 笔记结构：frontmatter 键值属性栏、13 类 Obsidian 风格 Callout、`==高亮==`
- 图片：alt 与路径可编辑，加载失败分级诊断，本地绝对路径可一键转为 `assets/` 相对路径
- 检索替换：全文档高亮、循环跳转、逐个或全部替换
- 安全 HTML：常见块级与行内 HTML、表格、details/summary 及其中的 Markdown 直接渲染；原文可编辑，脚本与危险协议被阻断

### 文件与窗口

- 打开与标签：双击或拖入文件，单窗口多标签切换并缓存内容与光标位置
- 欢迎页：新建 / 打开 / 最近打开；历史文件失效时提示并自动剔除
- 文件管理：Windows 右键新建，支持重命名；目标目录不存在时自动创建
- 自动保存：500ms 防抖、原子写入，换行符跟随原文件
- 外部变更：自动重载；有未保存内容时提示，绝不静默覆盖
- 只读保护：非 UTF-8 文件只读打开，不乱码写回
- 导出：保存至 Obsidian Vault，或导出为 PDF（桌面端）
- 绿色便携：ZIP 解压即用或单 exe 运行，设置存于 exe 同级 `data/settings.json`

### Android 端

- 完整编辑器：共用渲染与序列化保真管线，适配长按菜单、选区工具栏与触屏目录
- 系统集成：`.md`「打开方式」、返回键逐级关闭弹层、沉浸式全屏、物理键盘快捷键
- 文件链路：系统文件选择器打开，新建默认落 `/sdcard/Documents`，目录不存在自动创建

### 外观

- 6 款主题 × 深浅双模，Ctrl+T 切换深浅
- 悬浮目录：进度球与层级指示条收起，悬停展开，点击跳转并跟随光标高亮
- 个性化与窄屏：字体字号、当前行底色、代码换行、自定义快捷键；窄窗口自动释放留白并精简悬浮操作

## 下载与使用

最新安装包见 [Releases](https://github.com/lnabc03/Oblet/releases)，历史变更见 [CHANGELOG](CHANGELOG.md)。

### Windows

系统要求：Windows 10 / 11。

1. 下载 `Oblet-x.y.z-win-x64.zip` 并解压到任意位置，或使用单文件 `Oblet-x.y.z-win-x64.exe`
2. 可选：以管理员身份运行 `register-md.bat`，关联 `.md` 并注册右键新建；`unregister-md.bat` 用于撤销
3. 双击 `.md` 文件，或将其拖入 Oblet 窗口

首次运行若出现 SmartScreen 提示，点击「更多信息」→「仍要运行」。这是因为 exe 没有付费代码签名证书，也可自行构建验证。

### Android

系统要求：Android 11+（arm64）。

1. 下载 `Oblet-x.y.z-android-arm64.apk` 并侧载安装
2. 首次启动按引导授予「所有文件访问」权限，用于读取 `/sdcard` 上的文档
3. 从文件管理器选择 Oblet 打开 `.md`，或使用欢迎页的新建 / 打开 / 最近打开

APK 使用 CI 现场生成的 debug 密钥签名。覆盖安装若提示签名不一致，请先卸载旧版；文档内容不受影响。

### 自行构建

```bash
npm install
npm run tauri dev     # 桌面开发模式（热重载）
npm run tauri build   # 产出 src-tauri/target/release/oblet.exe
```

Android 端（需要 Android SDK + NDK，不锁版本、装最新即可，详见 `docs/android-dev-setup.md`）：

```bash
npm run tauri android dev                          # 模拟器/真机热重载
npm run tauri android build -- --apk --target aarch64   # 产出 arm64 APK
```

需要 Node.js 24（与 CI 一致）及 Rust 工具链，Tauri 2 前置条件见官方文档。

## 快捷键（桌面端）

| 快捷键        | 功能           |
| ---------- | ------------ |
| Ctrl+S     | 立即保存         |
| Ctrl+P     | 导出为 PDF      |
| Ctrl+O     | 保存至 Obsidian |
| Ctrl+F     | 检索 / 替换      |
| Ctrl+D     | 选中当前行        |
| Ctrl+T     | 切换深浅模式       |
| Ctrl+/     | 设置           |
| Alt+P      | 窗口置顶         |
| Alt+Left   | 上一个标签页       |
| Alt+Right  | 下一个标签页       |
| Ctrl+B     | 加粗           |
| Ctrl+I     | 斜体           |
| Ctrl+K     | 删除线          |
| Ctrl+\`    | 行内代码         |
| Ctrl+H     | 高亮           |
| Alt+A      | Callout 包裹   |
| Alt+1 \~ 6 | 一至六级标题       |

标题键位固定为 Alt+1\~6，其余组合均可在设置中自定义：点击组合键后按新键位，Esc 取消，双击恢复默认。

## 许可与致谢

- Oblet 源码以 [GPL-3.0](LICENSE) 发布（Copyright © 2026 弋鹓 | lnabc03）：因包含 GPL-3.0 许可的 AnuPpuccin 衍生样式，整体按 GPL-3.0 授权
- 内置主题（白名单复刻，均保留版权头与出处声明）：
  - [AnuPpuccin](https://github.com/AnubisNekhet/AnuPpuccin)，GPL-3.0，作者 AnubisNekhet
  - [Minimal](https://github.com/kepano/obsidian-minimal)，MIT，作者 Steph Ango (@kepano)
  - [Things](https://github.com/colineckert/obsidian-things)，MIT，作者 @colineckert
  - [GitHub Theme](https://github.com/krios2146/obsidian-github)，MIT，作者 @krios2146
  - [Atom](https://github.com/kognise/obsidian-atom)，MIT，作者 kognise
  - [Obsidian Nord](https://github.com/insanum/obsidian_nord)，MIT，作者 insanum
- 悬浮目录外观参考自 Obsidian 插件 [Next TOC](https://github.com/Raven-Pensieve/obsidian-next-toc)（GPL-3.0），作者 RavenHogWarts
- 构建于 [Milkdown](https://milkdown.dev/)、[CodeMirror](https://codemirror.net/)、[KaTeX](https://katex.org/)、[Tauri](https://tauri.app/) 之上
- 发行包 `licenses/` 目录内含全部第三方许可文本

作者：弋鹓 | [lnabc03](https://github.com/lnabc03)
