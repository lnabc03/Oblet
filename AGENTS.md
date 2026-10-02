# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

Oblet：轻量、快速的独立 Markdown 编辑器（Windows），双击 .md 即编辑，默认单窗口多 Tab。技术栈 Tauri 2 (Rust) + Vite 8 + TypeScript 7 + Milkdown 7.22.1（Crepe 底座）。主题为原生多主题（白名单固化 6 款，各深/浅双模）：AnuPpuccin（默认）/ Atom / GitHub / Minimal / Nord / Things，全部由蒸馏器从 Obsidian 主题生成（`src/styles/theme-*.css`），不做运行时主题导入、不兼容任意 Obsidian 主题。详见《Oblet-技术设计文档.md》与《多主题支持调研报告.md》。

**第一原则：序列化保真。** 保存不得对 md 原文做任何侵入性修改（不改写未编辑区域：不加行尾 `\`、不把 `---` 写成 `***`、不插 `<br />`、不注入转义实体、不擅增删空行）。与 Obsidian 双向编辑同一文件时必须无损。任何违反都视为 bug。

## 常用命令

```bash
npm run tauri dev        # 开发（自动起 vite :1420 + cargo run）
npm run build            # 前端构建（tsc && vite build，含类型检查）
npm run tauri build      # 产出绿色版 exe
cd src-tauri && cargo check   # Rust 快速检查

# 序列化回归测试（独立脚本，非测试框架；改序列化逻辑后必跑，需全部 PASS）
node scripts/test-break-roundtrip.mjs   # 换行/hr/转义/frontmatter 往返
node scripts/test-list-roundtrip.mjs    # 列表/任务列表污染回归

# 发布组包与出口审计
npm run pack     # 干净暂存 → release/Oblet-<版本>-win-x64.zip
npm run audit    # MD5 + 许可份数 + bat + 无 data/ 泄漏
node .github/extract-release-notes.mjs   # 从 CHANGELOG 提取当前版本段 → release/release-notes.md（CI 发版正文用）

# 发版前检查清单（漏一项 = 旧版本号 / CI 发版正文报错）
#   ① 版本号 5 处全改：Cargo.toml + Cargo.lock(oblet) + tauri.conf.json + package.json + package-lock.json（顶部两处）
#   ② CHANGELOG.md 顶部加 "## [x.y.z] - 日期" 段（extract-release-notes 找不到标题会退出）
#   ③ 提交拆两个 commit：feat 代码 + "chore: 版本号升至 vX.Y.Z"
#   ④ git tag vX.Y.Z && git push origin vX.Y.Z  → 触发 CI 自动发版（正文自动带 changelog）

# 组件配置冒烟（jsdom，改 Crepe featureConfig 后跑）
node scripts/verify-languages.mjs   # 代码块语言列表注入 + 浮层弹出交互

# 主题蒸馏流水线（多主题；跑前必须无 oblet.exe 在运行 + target/release 为最新构建）
node scripts/theme-distill.mjs --all                 # 全部主题；或跟主题 id（anuppuccin/atom/github/minimal/nord/things）
node scripts/theme-distill.mjs atom                  # 单主题蒸馏；配置表 scripts/themes.config.mjs（hl 高亮色/bridgeOverrides 微调）
node scripts/theme-visual-snapshot.mjs capture [f.json] [--theme <id>]   # 基线快照（CDP computed styles，深浅双模式）
node scripts/theme-visual-snapshot.mjs compare <基线.json> [--theme <id>] # 蒸馏后对比基线，AnuPpuccin 必须零差异

# 主题截图流水线（README 图库；跑前必须无 oblet.exe 在运行 + target/release 为最新构建）
node scripts/theme-screenshot.mjs [主题id...]   # 缺省六主题全跑：CDP 截深/浅 → sharp SVG 斜切拼接（左深右浅）→ assets/theme-<id>.png；策展文档 scripts/screenshot-doc.md（一屏核心特性，改它即改图）

# 启动耗时基线（CDP 连真实 exe 读 __obletBootTiming；跑前必须无 oblet.exe 在运行）
node scripts/measure-startup.mjs    # 默认 5 轮采样
```

**启动性能基线（2026-08-04，5 轮均值）**：双击→完全就绪 ≈1.5s = WebView2 冷启动黑盒 956ms（62%，系统级硬地板）+ bundle 解析 320ms + 其余 <90ms。决策：**接受现状，不做关窗常驻**（常驻拿"退出即干净"换二次启动 1.2s，不划算）。遮罩链路：index.html 内联 `#ob-splash`（首帧遮盖）→ lib.rs `visible(false)` 建窗（根治遮罩前白屏/透屏，Rust 3s 兜底强制 show）→ main.ts 双 rAF `show()` 揭窗 → boot 完双 rAF 淡出。计时钩子 `window.__obletBootTiming`（编辑器路径并入 `__oblet.bootTiming`），Rust 侧 epoch 打点经 `get_boot_marks` 命令对齐。

## 架构

**Rust 侧（src-tauri/src/）**——所有文件 IO 只走这里，前端不碰文件系统：

- `lib.rs`：窗口管理（label = 路径 FNV-1a 哈希）、单实例（重复打开聚焦已有窗口/追加 Tab）、notify 文件监听（目录引用计数：同目录多 tab 只 watch 一次）
- `commands.rs`：`read_file`（BOM 剥离、CRLF/LF 探测、非 UTF-8 只读）、`write_file`（临时文件 + rename 原子写入，换行符跟随原文件）、`watch_file`（监听父目录按文件名过滤，兼容 rename 式保存）、`export_to_vault`（复制到 Vault 目标目录：file_name 拒收路径分隔符防逃逸、同名返回约定错误码 `EXISTS` 由前端弹确认、原子写）、`save_image_asset`（粘贴/拖入图片落盘 assets/，同名 -1 后缀）、`probe_image_path`（图片加载失败原因分级：魔数判别格式）、`localize_image_assets`（批量转相对路径：同名同内容复用、异内容后缀、逐源去重）、`add_tab`/`remove_tab`/`switch_tab`（Tab 切换系统：追加/移除/切换标签页，返回 TabsPayload 同步前端）
- `state.rs`：AppState（`windows: HashMap<label, (Vec<String>, usize)>` 窗口→(路径列表, 活跃索引)、内容哈希缓存）。**自写过滤靠 FNV-1a 哈希**：读写都记哈希，监听事件哈希一致即忽略——Windows 下 rename 覆盖保存会对目标发 Remove 事件，绝不能见 Remove 就通知重载。`add_tab` 去重：路径已在列表中则返回已有索引。
- `settings.rs`：`./data/settings.json`（exe 同级，绿色版），存排版/编辑器覆盖 + Obsidian `vault_dir`

**前端（src/）**：

- `main.ts`：CSS 顺序敏感——Crepe → obsidian-base.css → theme-*.css ×6（全部带 `body.ob-t-<id>` 门控前缀，共存互不泄漏）→ toc.css（后者覆盖前者 fallback）
- `editor/setup.ts`：Crepe 装配 + 文件生命周期（防抖自动保存、外部变更重载、拖入换文件）+ 导出动作装配（`setExportHandlers` 注入右键菜单；导出 PDF 跟随当前深浅模式 + 打印前全量挂载代码块）+ `window.__oblet` 自动化验证钩子（含 testSetTheme）+ Tab 切换集成（`tabCallbacks` 桥接 setup 闭包到 tabs.ts）
- `editor/cm-theme.ts`：**代码块高亮主题**——自绘 CM theme 全 CSS 变量驱动，二期改为 `--ob-hl-*` 语义变量链（`var(--ob-hl-keyword, rgb(var(--ctp-mauve, …)))`：主题文件直供字面值 → AnuPpuccin 走 ctp fallback → mocha 三元组兜底），替代 Crepe 默认 oneDark，深浅/换主题零重配置自动跟随
- `editor/mermaid.ts`：**Mermaid 图表预览**——code_block(language=mermaid) 经 Crepe 代码块 `renderPreview` 钩子出 SVG（KaTeX 同通道，latex 特性 wrap 后非 latex 语言落此；crepe 加载顺序 code-mirror 先于 latex，互不顶掉）。mermaid 懒加载（rolldown 分包，无 mermaid 块零开销）；themeVariables 每次渲染读 body computed `--ob-*` → 6 主题×深浅自动跟随；body 类 MutationObserver 触发全量重渲染（注册表 content→applies，封顶 120）；`securityLevel: 'strict'` + 面板 SVG 感知 DOMPurify 双保险；语法错误画兜底框；打印前 `whenMermaidIdle()` 防 Loading 占位。验证 `node scripts/repro-mermaid.mjs`（出图/变色/保真）；全图类型扫描 `node scripts/verify-diagrams.mjs`（对 ref/图表验收文档.md 逐块断言）
- `editor/tabs.ts`：**Tab 切换系统核心**——`TabState` 缓存（Map<路径, 内容/光标/滚动>）、箭头 UI（`createTabArrows`）、`switchToTab` 核心流程（路径比较 guard + updatePaths 前保存所有当前状态 + PM 原生 scrollIntoView 恢复光标）。关键规则：所有"保存当前状态"操作必须用 `model.get(oldActivePath)` 路径键访问且在 `updatePaths` 之前完成
- `commands.ts`：命令注册表——快捷键统一入口（settings.json `editor.keymap` 覆盖、window 捕获阶段派发、设置面板改键）
- `editor/frontmatter.ts`：**序列化保真层收口于此**——frontmatter 节点 + 属性栏 NodeView（键值表格编辑）、`tuneSerialization`（mdast-util-to-markdown 的 rule/bullet/join/handlers 定制 + 表格紧凑输出 + GFM singleTilde 关闭）、任务项空格修剪 remark 插件、`disableEmptyLineBr`
- `editor/image-block.ts`：**图片块 alt 保真**——`extendSchema` 覆盖上游 image-block schema，alt 独立 attr 原样往返（上游把 ratio 偷渡在 alt 槽位，alt 全灭变 `1.00`）
- `editor/image-paths.ts`：**图片路径判定共享层**（v0.7.0）——REMOTE/ABS 正则、decodeMaybe、joinResolve、resolveLocalAbs、isAbsoluteLocalSrc、docHasAbsoluteImages；渲染转换（setup.ts toDomUrl）、路径编辑/失败占位（image-edit.ts）、批量转换（localizeImages + contextmenu 置灰）三处共用，避免口径漂移。**D12（安卓适配）起兼作前端路径共享层**：`pathKey`（分隔符统一 `/`，仅 Windows 小写归一）供 tabs.ts 缓存键与 setup.ts samePath 共用；`joinResolve` 输出 POSIX `/` 分隔（Windows API 与 Rust Path 均接受正斜杠）
- `editor/image-edit.ts`：**块级图片自绘 node view**（v0.7.0，`$view` 按节点 id 追加、后注册者胜，addFeature 晚于 Crepe 特性加载即生效）——三态：空 src 占位框（「设置图片」按钮）/ 正常（operation 编辑按钮 + img + 缩放手柄，类名沿用上游吃 Crepe 主题 CSS）/ 失败占位框（Rust `probe_image_path` 分级原因，「编辑路径」进面板）。编辑面板 = caption 风格双输入条绑 alt（[] 槽位）+ src（() 槽位），Enter/失焦提交、Esc 取消、单事务可撤销，提交时剥包裹引号；caption（title 槽位）只读展示不编辑。行内图刻意不覆盖
- `editor/plugins.ts`：==高亮== 与 callout 的**装饰器方案**（文档保持原文，渲染时隐藏标记——保真原则的渲染侧体现）
- `editor/vault.ts`：保存至 Obsidian（复制语义）——`sanitizePathInput` 规整容错（引号/正反斜杠/末尾分隔符随手输入均可）、`EXISTS` → 自绘确认弹窗覆盖
- `editor/contextmenu.ts`：自绘右键菜单；导出项动作靠 `setExportHandlers` 注入（菜单插件拿不到 setup 的 path/crepe 闭包）
- `editor/toc.ts`：**悬浮 TOC**（外观移植 obsidian-next-toc，GPL-3.0 同源）——`$prose` 插件自渲染浮层 DOM 挂 body：收起态 = bar 指示条 + 进度球（单击回顶，已在顶部则回光标行），hover 500ms 展开面板（H1–H4），移开 300ms 缓冲关闭。active 判定光标优先（selection 所在区间）；docChanged 驱动重建（切 tab 的 replaceAll 自然触发，无需 tab 钩子）；开关 `editor.toc` 走 `body.ob-toc-hidden` CSS 门控（applyTypography 维护，跨窗口广播白得）
- `notify.ts`：统一 toast（三级）+ `confirmDialog` 自绘确认弹窗（**禁用原生 window\.confirm**，样式与设计语言不符）
- `styles/obsidian-base.css`：Ob 结构基座 + `--crepe-* ← --ob-*` 静态映射（Crepe 消费适配层）+ `@media print` 打印收口。`--ob-*` 字面值由主题文件直供（桥接层 1D 已废弃）
- `styles/theme-*.css`：原生主题 ×6（蒸馏器产物：`--ob-*` 按 `body.ob-t-<id>.theme-dark/light` 字面值分叉 + 调色板变量 + 活规则 + `--ob-hl-*` CM 高亮色）。**改配色改它或改 `scripts/themes.config.mjs` 重跑蒸馏器**；标题字号是例外——蒸馏器内置 `CANONICAL_HEADING_SIZES` 跨主题强制 1.8/1.6/1.4/1.25/1.1/1em（以 AnuPpuccin 为准），bridgeOverrides 调不动
- `settings/theme-classes.ts`：**主题注册表**（二期重构）——6 主题 × 深浅模式的 body 类集（含 ob-t-<id> 门控类）、splash 底色、localStorage 双镜像 `oblet.theme` + `oblet.themeId`（splash-early.js/main.ts 首帧防闪共用）
- `settings/typography.ts`：字体/字号覆盖 + **主题模式**（theme_mode: dark/light/system，matchMedia 跟随，Ctrl+T 切换）+ 跨窗口广播（oblet-typography-changed，主题与排版共用）

## 容易踩的坑（都实际踩过）

- **Crepe 默认装配的 `@milkdown/plugin-trailing`** 会在文末非标题/段落（列表/表格/代码块结尾）后自动补空段落，序列化多出 EOF 空行，击穿"与磁盘一致不写回"防线（仅打开就改写文件）。修复：setup.ts 在 create 后包装 `serializerCtx` 出口统一剥除末尾空段落贡献的换行（解析侧本就不为尾部空行生成节点，往返字节级稳定），并 `clearTimeout(saveTimer)` 清掉 create 期误排上的自动保存。
- **CRLF 文件的 frontmatter 残留 `\r`**：micromark 的 yaml value 是原文切片不做行尾归一（正文是归一的），一个 `\r` 三连炸——① JS 的 `.` 不匹配 `\r`，`parseFmRows` 正则对值非空行全部失配、键值行降级 fm-raw 单列（"键值挤一格"）；② input value 归一化吃 `\r` 让 commit 误判有改动 → 假保存；③ `getMarkdown()` 混排 `\r\n` 击穿与磁盘一致的比较。修复：parseMarkdown runner 把 value 的 `\r\n?` 归一为 `\n` 再入文档（文档内全 LF，落盘由 Rust 侧按原文件换行符还原），`parseFmRows` 另加防御性剥离。
- **Milkdown `$remark` 插件时序**：插件体若在 commonmark 读取 options 切片前 `ctx.remove` 切片，会报 `Context "..." not found`。解法：先 `await ctx.wait(InitReady)` 再操作。
- **Milkdown 把列表 spread 存成字符串**（`'true'/'false'`），导致 mdast-util-to-markdown 的 joinDefaults 失效、紧凑列表被序列化成宽松。已在 `joinTightLists` 自定义 join 容忍；动列表序列化时注意。
- **任务列表 `&#x20;` 污染**：GFM 解析勾选框只消耗一个空格，残留前导空格会被 text safe() 转义。该空格在所见即所得模型中无法稳定保留，只能在解析侧修剪（`trimTaskItemLeadingSpace`），不要试图在序列化侧保留它。
- **ProseMirror 全局 `.ProseMirror table { table-layout: fixed }`** 会压垮自管理表格（属性栏曾因 `width:1%` 被按字面执行而列重叠），需局部覆盖 `table-layout: auto`。
- **NodeView 无 contentDOM 时**，点击会产生 NodeSelection，节点选中态下按键会被 PM 用输入替换整个节点。属性栏的防线：`stopEvent` 全拦截 + `dom.contentEditable='false'` + 事务用 `doc.nodeAt(getPos())` 取新鲜节点（不用闭包缓存的 nodeSize）。
- **`$view()` 传 `schema.node` 而非整个 `$NodeSchema`**。
- **换图标后 exe 图标不更新**：tauri-build 不会因 `icons/` 变化重嵌资源，需 `touch src-tauri/build.rs`（或 `cargo clean -p oblet`）再 build。验证：`ExtractAssociatedIcon` 提取 exe 图标与 `icons/32x32.png` 比对。Explorer 另有一层按路径的图标缓存，验证时先看复制/重命名的副本。
- **Tauri 默认不暴露 `window.__TAURI__`**：CDP 脚本不能裸 invoke，验证钩子统一挂 `window.__oblet`（setup.ts 注入，如 testSanitize/testExportVault）。
- **Milkdown 7.22 给 `.milkdown` 钉了 `font-size: var(--crepe-base-font-size, 16px)`**（7.21 无此钉值，靠继承 body 内联字号）——升级后基础字号设置进不了编辑器。修复：obsidian-base.css 桥接块加 `--crepe-base-font-size: var(--ob-font-size)`。验证 `node scripts/repro-fontsize.mjs`（断言 正文/h1/代码行 随 base_font_size 等比缩放）
- **Mermaid 12 的 `render(id, text)` 不再收 per-render config**（`setConfig` 已废弃为 no-op）——按图注入主题配色要走 `%%{init: {...}}%%` 指令（prepend 在渲染入参上，不碰文档原文；用户自己的 init 指令在后可覆盖默认值）。官方 `@milkdown/plugin-diagram` 已废弃且与 Crepe 代码块组件抢 `$view`，不可用，接 renderPreview 是唯一正道
- **Mermaid 配色三坑**：① `theme:"base"` 的 `updateColors()` 会**重算派生变量**（lineColor/actorBkg/doneTaskBkgColor 等被覆盖成 `mainContrastColor`=白）——themeVariables 只能救 pie/venn/git/cynefin/xyChart/requirement 这类不被重算的，sequence 底部框/生命线/序号、timeline、kanban、gantt done 等硬编码色必须走 CSS 覆盖（`.ob-mermaid svg .xxx{fill:…!important}`，SVG presentation attribute 优先级低于 CSS）；② `background` 必须用实色（bg）不能 transparent——mermaid 多处 `isDark(background)` 判明暗（venn 文字明暗、git 分支明暗），transparent 被判成浅色致深色下颜色放反；③ 新图表（kanban 0 处/mindmap/timeline 部分）主题化不完整，`look:"classic"` 回退平面风去掉 neo 发光。验证 `node scripts/probe-mermaid-colors.mjs`（dump SVG 源码 hex）+ `scripts/.repro/check-computed.mjs`（读 computed 确认 CSS 覆盖生效）
- **`LanguageDescription.of` 必填 `load` 或 `support`**：漏了在启动时抛 `RangeError: Must pass either 'load' or 'support'`（前端 boot 直接崩、软件起不来）。mermaid 无 CM 语法，用 `support: new LanguageSupport(StreamLanguage.define({ token: () => null }))` 空语言纯占位，只为进候选列表
- **Mermaid 语法的中文限制**：sankey 的 CSV 解析器不吃中文节点名（引号也无效）；requirementDiagram 的 text/type 字段中文必须加引号；usecase 边不支持 `: 标签`；gitGraph 分支名中文要加引号——验收文档里的写法都实证过，新增图类型先小范围探测再入文档
- **Mermaid 序号徽章与 init 覆盖两坑**（2026-09-22）：① 时序图序号徽章的圆底与数字**共用** `sequenceNumberColor`（同色即隐形，白底白字/深底深字都出现过）——必须 CSS 分离双色：`[id$="-sequencenumber"]{fill:bg-alt}` 圆底 + `.sequenceNumber{fill:正文色}` 数字，深浅自适应；② 多份 `%%{init}%%` 指令按序**深度合并、后者覆盖**（chunk-ZIGJFQKS detectInit→assignWithDepth）——用户自带 init 要拆出后置，且我方指令收敛到仅 `fontFamily`，否则我们的 themeVariables 会盖掉用户的 theme（如 forest）
- **单实例会抢调试会话**：CDP 冒烟（repro-webview/repro-export）前必须 `taskkill //F //IM oblet.exe` 清残留——否则新实例被单实例逻辑转发到旧实例、调试端口永远不起（报"CDP 端口未就绪"先查这个）。
- **exe 被运行实例锁定**：tauri build 后往 release/Oblet/ 拷贝报 Device or resource busy 时，复制为 `oblet-new.exe` 再 `mv -f` 原子改名绕过。`npm run tauri build` 末尾 MSI bundling（light.exe）失败不影响 exe 本体产出。
- **导出自绘弹窗的 promise 会阻塞**：`exportToVault` 等 `confirmDialog` 点击才 resolve——测试脚本里不能 `await` 后再点弹窗（死等），要先挂起 promise、点击、再 await。
- **打印导出**：Mica 开着先临时关（摘 `ob-vibrancy` 类 + `set_window_effect(null)`，双 rAF 后 `window.print()`，`afterprint` 恢复 + 30s 超时）；打印下 `.markdown-rendered` 必须 `overflow: visible` 否则只出第一页。
- **Tab 切换三坑**（详见 打磨清单 Bug 修复记录）：① 缓存键污染——`updatePaths` 改变 `tabs[active]` 指向，必须先用 `model.get(oldActivePath)` 保存当前状态、用路径比较而非索引比较做 guard；② `path` 闭包变量不同步——`switchToTab` 后需通过 `cb.setPath(targetPath)` 同步，否则拖入判断/Esc 关 tab 会找错文件；③ 滚动残留——长→短文档切后空白，用 PM 原生 `scrollIntoView()` 在事务中滚到位，前置 `scrollTop=0` + 强制重排。
- **浮层触发的 `tr.scrollIntoView()` 不可靠**：从编辑器外浮层（TOC 面板）点击派发的 `setSelection(...).scrollIntoView()` 只落光标不滚动。改用 search.ts 验证过的模式：dispatch 后 rAF 里 `v.domAtPos(pos)` 取 DOM，原生 `el.scrollIntoView({block})`（TOC 跳转/进度球回光标均走此路径）。
- **`--ctp-*` 变量是 RGB 三元组**（`203, 166, 247`），不是颜色值：裸写 `color: var(--ctp-mauve)` 会得到 `color: 203, 166, 247` 无效声明被整体丢弃（曾致 CM 高亮全灭）。一切消费必须 `rgb()/rgba()` 包裹（cm-theme.ts、obsidian-base.css 的毛玻璃 fallback 同理）。
- **clip-path 揭示动画与 box-shadow 互斥**：TOC 面板的 clip-path 会把投影裁成同尺寸方框影——带 clip-path 动画的浮层不要挂 box-shadow。
- **Mica 已暂时下架**（2026-09）：上游 window-vibrancy#183，Win11 24H2/25H2 上 DWM 系统级失效退化为纯色底；系统 Acrylic 实测效果诡异且 22H2+ 参数不可调，弃。下架范围：设置面板开关、applyTypography 的 ob-vibrancy/set_window_effect 应用、打印路径材质摘除；Rust 命令与 CSS 透明链路保留待复活（`window_effect` 字段保留兼容旧配置）。
- **蒸馏器选择器匹配两个坑**（scripts/theme-distill.mjs）：① flavor 正则交替必须长者在前（rosepine-light 先于 rosepine），否则 `\b` 截断误判；② AnuPpuccin 把 `--h1-color` 等定义在 `.app-container` 层级，CSS 自定义属性 var() 在声明点求值后继承，`--ob-*` 块必须同时挂 `body.theme-x` 和 `body.theme-x .app-container` 双选择器。
- **Crepe 代码块是 IntersectionObserver 懒挂载**（@milkdown/components code-block：视口外只有无高亮的 placeholder `<pre>`，离开视口 5s 拆回 placeholder）。后果有二：① 打印前必须全量挂载——setup.ts `doPrint` 先 `mountAllCodeBlocks()`（快速滚一遍全文再回位，5s teardown 窗口内打印）；② 蒸馏器运行时探测若验收文档无图片/代码，相关规则会被误判死规则剔除（图片圆角 `img{border-radius}` 曾因此丢失，已在 obsidian-base.css 基座收回 `--ob-img-radius`）
- **PM 表格 tbody 含表头行**（prosemirror-tables: `table>tbody` 装全部 tr）——Obsidian 主题的斑马纹 `tbody tr:nth-child(2n)` 搬过来会错位（表头深+数据行1深连排），蒸馏 patches 机制改成 `2n+1`（themes.config.mjs github 条目）
- **蒸馏器产物规则级修正走 `patches` 配置**（themes.config.mjs，match 正则源串 + replace 全局替换 + 未命中告警），不要手改 theme-*.css——重跑蒸馏会覆盖
- **蒸馏器二期三坑**：① 桥/hl 表达式引用的变量必须入闭包播种——瘦主题活内容少，不播种会在剪枝阶段把 `--text-normal` 等待解析变量剪掉；② 内核替身兜底层（`--background-primary: #1e1e1e` 等）会遮蔽桥回退链中段的 var()——主题特有变量（如 Things 的 `--color-base-*`）在 bridgeOverrides 里必须排在内核变量**前面**；③ Things 桌面端把深浅调色板塞在 `body.theme-*.is-mobile` 作用域（不写 is-mobile 就没色），generic 作用域匹配靠纯类复合判定天然兼容。
- **上游 image-block schema 把 ratio 偷渡在 alt 槽位**（@milkdown/components image-block/schema.ts：解析 `Number(alt||1)` 丢 alt、序列化 alt 写 `ratio.toFixed(2)`，全部图片 alt 变 `1.00`）——`src/editor/image-block.ts` 用 `imageBlockSchema.extendSchema` 同名覆盖（nodesCtx 按 id upsert，后注册者胜，须在 Crepe 构造器特性加载之后 .use，setup.ts 的 addFeature 链即满足）；alt 独立 attr 往返，ratio 降级为会话内存态不落盘。验证 `node scripts/repro-image-alt.mjs`（跑前无 oblet.exe 在运行 + target/release 最新构建）
- **GFM singleTilde 已关闭**（tuneSerialization 里 `remarkGFMPlugin.options` 设 `singleTilde:false`，对齐 Obsidian 单 ~ 非语法）：单 `\~` 转义全部可撤销；`~~`+ run 保留转义防重解析成删除线。`\*` 按 flanking 收紧：非 left-flanking 即不可能开启强调 → 撤销，行首保守保留（列表/分隔线风险）。**但 flanking 是局部判定，定界符匹配是段落级全局行为**：强调/加粗（strong/emphasis）内部的 closer-capable `*` run 会与外层结构性 opener 配对、提前闭合强调（实案：加粗图注里 `\* FDR`、`+2.26\*\*` 被剥离后整行加粗被切碎）——keepStarEscape 必须吃 `state.stack` 的 strong/emphasis 上下文，只对"既不在强调内、又非 left-flanking"的 run 撤销（单 ~ 无此问题：strikethrough 只配对等长 run，单 ~ 无法闭合 ~~）
- **window 捕获阶段 `stopImmediatePropagation` 会掐断整条传播链**（v0.7.0 踩过）：想抢在 setup.ts 全局 Esc（关 tab）之前拦截，处理逻辑必须直接在捕获处理器里完成——只 stop 不传逻辑的话事件永远到不了 input 自己的 keydown（提交静默失效）。当前形态：imagePanelEscGuard 只在面板打开时拦 Esc（Enter 无窗口级监听竞争，留 input 自身处理）。插件 view 注册早于 setup 的 window 监听，同相位按注册序触发可利用
- **Crepe 斜杠菜单扩展点 `buildMenu`**（BlockEdit featureConfig）：默认组构建完后回调，`builder.getGroup('advanced').addItem(key, {label, icon, onRun})` 加自定义项；onRun 里先 `clearTextInCurrentBlockCommand` 清掉 `/过滤词` 再 `addBlockTypeCommand` 插块。**弃用方案教训**：插 `![](` 文本等用户敲 `)` 触发 input rule 的方案不可靠（光标挪走规则不触发、用户还得自补反括号），直接插空 image-block 节点 + 占位框才是正道。CDP 测试可用 `Input.insertText`（可信事件）驱动 SlashProvider，菜单项是 `.menu-groups li`、onPointerup 触发
- **node view 里异步错误处理必须绑定构建时快照**：img error 事件是任务队列触发，若 handler 读实时 state（rendered.src）而非该 img 构建时的 src，中间渲染（旧 src 的 img 已被 replaceChildren 摘除）的迟到 error 会拿新 src 去 probe—— probe 结果 ok 却显示"加载失败"占位（实踩）。双守卫：`!img.isConnected || rendered.src !== srcAtBuild` 直接丢弃过期错误
- **自绘 node view 里 SVG 图标必须套 `span.milkdown-icon`**（inline-flex，reset.css 提供）：裸 svg 是 inline 元素、基线对齐，在圆形按钮底里 glyph 会掉出圆圈几十 px（实踩：用户看到"圆圈 + 气泡两个按钮"）。Crepe 图标字符串带前后空白，innerHTML 前先 trim
- **img error/load 事件不冒泡**，若在视图层统一监听必须挂祖先的捕获阶段；自绘 node view 里直接往 img 上挂 listener 更省事。失败占位框用「隐藏 img + 兄弟占位」而非替换 DOM，修复后 load 摘除占位

## 已知合理规范化（不是 bug）

首次保存产生一批渲染等价的 AST 归一化（空格/列表符/围栏符/标题格式/转义字符等），之后往返字节级不变。表格统一输出紧凑形态（`| a | b |` + `|---|---|`）：已是紧凑写法的手写表格零 diff，padding 对齐过的表格首次保存归一化。详见《技术设计文档》第 5 节。低优先级转义噪音（词内 `*`、空括号、单反引号等）不修。

## 环境备忘

- **仓库真实路径是 `D:\个人文档\PROJECTS\Oblet`**；桌面的 `Oblet`（以及 `PROJECTS`、`RAINOTES` 等）全是符号链接/重解析点。跑任何 `tauri android` 命令必须 cd 到真实路径，否则 cargo-mobile2 的 asset 目录校验 canonicalize 穿透链接后路径字符串对不上，启动即 panic `AssetDirOutsideOfAppRoot { asset_dir: "assets" }`（2026-10 实踩，详见 docs/android-dev-setup.md 第四步警告）
- `src-tauri/target/` 约 3.6G 属 Rust 调试编译产物常态，已 gitignore，清理用 `cargo clean`（需先关闭运行中的 oblet.exe，否则文件锁导致拒绝访问）。
- `ref/` 是参考素材（历史主题、测试文档），不参与运行时。
- `scripts/`（repro-*/verify-* 冒烟）、根目录 `test-*-roundtrip.mjs`、`Oblet-打磨*.md`、本文件均为**本地开发资产**：.gitignore 防回流云端，本地保留可正常跑；CI 发布链路依赖的组包/审计/许可收集脚本在 `.github/`（`npm run pack` / `npm run audit` 即指向那里）。
- 回复与文档一律使用简体中文。

