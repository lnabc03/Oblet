# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

Oblet：轻量、快速的独立 Markdown 编辑器（Windows），双击 .md 即编辑，每文件一窗口。技术栈 Tauri 2 (Rust) + Vite + TypeScript + Milkdown 7.21.3（Crepe 底座）。主题为固化的 AnuPpuccin 深色定制（静态打包，不做主题系统，仅维护深色）。详见《Oblet-技术设计文档.md》（v2.0 基线，权威定位与边界）。

**第一原则：序列化保真。** 保存不得对 md 原文做任何侵入性修改（不改写未编辑区域：不加行尾 `\`、不把 `---` 写成 `***`、不插 `<br />`、不注入转义实体、不擅增删空行）。与 Obsidian 双向编辑同一文件时必须无损。任何违反都视为 bug。

## 常用命令

```bash
npm run tauri dev        # 开发（自动起 vite :1420 + cargo run）
npm run build            # 前端构建（tsc && vite build，含类型检查）
npm run tauri build      # 产出绿色版 exe
cd src-tauri && cargo check   # Rust 快速检查

# 序列化回归测试（独立脚本，非测试框架；改序列化逻辑后必跑，需全部 PASS）
node test-break-roundtrip.mjs   # 换行/hr/转义/frontmatter 往返
node test-list-roundtrip.mjs    # 列表/任务列表污染回归

# 发布组包与出口审计（zip 只从 pack-zip 出，绝不手动对 release/Oblet/ 打包——
# 那是冒烟运行目录，exe 一跑就自建 data/ 个人设置；审计任一 FAIL 即退出码 1）
npm run pack     # 干净暂存 → release/Oblet-<版本>-win-x64.zip
npm run audit    # MD5 + 许可份数 + bat + 无 data/ 泄漏

# 组件配置冒烟（jsdom，改 Crepe featureConfig 后跑）
node scripts/verify-languages.mjs   # 代码块语言列表注入 + 浮层弹出交互
```

## 架构

**Rust 侧（src-tauri/src/）**——所有文件 IO 只走这里，前端不碰文件系统：

- `lib.rs`：窗口管理（每文件一窗口，label = 路径 FNV-1a 哈希）、单实例（重复打开聚焦已有窗口）、notify 文件监听
- `commands.rs`：`read_file`（BOM 剥离、CRLF/LF 探测、非 UTF-8 只读）、`write_file`（临时文件 + rename 原子写入，换行符跟随原文件）、`watch_file`（监听父目录按文件名过滤，兼容 rename 式保存）
- `state.rs`：AppState（窗口↔路径映射、内容哈希缓存）。**自写过滤靠 FNV-1a 哈希**：读写都记哈希，监听事件哈希一致即忽略——Windows 下 rename 覆盖保存会对目标发 Remove 事件，绝不能见 Remove 就通知重载
- `settings.rs`：`./data/settings.json`（exe 同级，绿色版），仅存排版覆盖

**前端（src/）**：

- `main.ts`：CSS 顺序敏感——Crepe → obsidian-base.css → anuppuccin-custom.css（后者覆盖前者 fallback）
- `editor/setup.ts`：Crepe 装配 + 文件生命周期（防抖自动保存、Ctrl+S、外部变更重载、拖入换文件）
- `editor/frontmatter.ts`：**序列化保真层收口于此**——frontmatter 节点 + 属性栏 NodeView（键值表格编辑）、`tuneSerialization`（mdast-util-to-markdown 的 rule/bullet/join/handlers 定制）、任务项空格修剪 remark 插件、`disableEmptyLineBr`
- `editor/plugins.ts`：==高亮== 与 callout 的**装饰器方案**（文档保持原文，渲染时隐藏标记——保真原则的渲染侧体现）
- `styles/obsidian-base.css`：Ob 结构基座 + `--ob-*` 变量桥（把 Ob 主题变量桥到自有样式与 `--crepe-*`）
- `settings/typography.ts`：字体/字号覆盖（内联样式，优先级高于主题）+ 跨窗口广播

## 容易踩的坑（都实际踩过）

- **Milkdown `$remark` 插件时序**：插件体若在 commonmark 读取 options 切片前 `ctx.remove` 切片，会报 `Context "..." not found`。解法：先 `await ctx.wait(InitReady)` 再操作。
- **Milkdown 把列表 spread 存成字符串**（`'true'/'false'`），导致 mdast-util-to-markdown 的 joinDefaults 失效、紧凑列表被序列化成宽松。已在 `joinTightLists` 自定义 join 容忍；动列表序列化时注意。
- **任务列表 `&#x20;` 污染**：GFM 解析勾选框只消耗一个空格，残留前导空格会被 text safe() 转义。该空格在所见即所得模型中无法稳定保留，只能在解析侧修剪（`trimTaskItemLeadingSpace`），不要试图在序列化侧保留它。
- **ProseMirror 全局 `.ProseMirror table { table-layout: fixed }`** 会压垮自管理表格（属性栏曾因 `width:1%` 被按字面执行而列重叠），需局部覆盖 `table-layout: auto`。
- **NodeView 无 contentDOM 时**，点击会产生 NodeSelection，节点选中态下按键会被 PM 用输入替换整个节点。属性栏的防线：`stopEvent` 全拦截 + `dom.contentEditable='false'` + 事务用 `doc.nodeAt(getPos())` 取新鲜节点（不用闭包缓存的 nodeSize）。
- **`$view()` 传 `schema.node` 而非整个 `$NodeSchema`**。
- **换图标后 exe 图标不更新**：tauri-build 不会因 `icons/` 变化重嵌资源，需 `touch src-tauri/build.rs`（或 `cargo clean -p oblet`）再 build。验证：`ExtractAssociatedIcon` 提取 exe 图标与 `icons/32x32.png` 比对。Explorer 另有一层按路径的图标缓存，验证时先看复制/重命名的副本。

## 已知合理规范化（不是 bug）

勾选框后双空格→单空格；段落与列表间保持一个空行；宽松列表保持项间空行。三者渲染等价且首次保存即稳定，之后往返字节级不变。

## 环境备忘

- `src-tauri/target/` 约 3.6G 属 Rust 调试编译产物常态，已 gitignore，清理用 `cargo clean`（需先关闭运行中的 oblet.exe，否则文件锁导致拒绝访问）。
- `ref/` 是参考素材（历史主题、测试文档），不参与运行时。
- 回复与文档一律使用简体中文。



