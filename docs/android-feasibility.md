# Oblet 安卓端适配可行性评估

> 评估日期：2026-09-27 · 基于当前仓库 v0.7.0 代码
> 修订：v2（2026-09-28）——初版因 gitignore 问题未对照 AGENTS.md 与 doc/ 全量文档，本版结合《Oblet-技术设计文档》《Oblet-macOS-适配指南》与源码逐条复审重写：补充前端路径 Windows 假设（初版最大遗漏）、Rust 侧漏项、触屏交互完整清单，修正 inotify 口径矛盾，新增决策 D12–D15。

## 结论

**可行，且技术底座已经就位，但"外壳层"需要一轮系统性重构。** 编辑器内核（约 6000 行前端）在渲染与编辑层面几乎零改动即可运行；工作量集中在四处：桌面范式的窗口/文件入口替换、**前端路径处理的 Windows 反斜杠假设重构**、SAF 存储权限、触屏交互与输入法联调。预估工作量：**3~4 周**（熟悉 Tauri 移动端的前提下），其中 SAF 与 IME 仍是最不可预测的部分。

## 有利因素（适配成本低的部分)

1. **Tauri 2 官方支持 Android**，且项目已具备移动端雏形：
   - `Cargo.toml` 已配置 `crate-type = ["staticlib", "cdylib", "rlib"]`（移动端编译必需的产物类型）
   - `lib.rs` 已标注 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`
   - `src-tauri/icons/android/` 图标已生成
   - 即作者已有预案，运行 `npm run tauri android init` 即可生成 `gen/android` 工程
2. **编辑器内核纯 Web 实现**：Milkdown/ProseMirror、CodeMirror 6、Mermaid、KaTeX、6 款主题、搜索替换全部是前端代码，Android System WebView 是常青 Chromium，渲染与编辑层面无需修改。**例外**：TOC 悬浮目录是 hover 驱动的桌面交互，需触屏适配（见触屏交互节，已决策 D14）。
3. **Rust 命令层大部分可移植**：`read_file` / `write_file`（原子写入）/ `rename_file` / `save_image_asset` / `localize_image_assets` 等均基于 `std::fs`，拿到真实路径后可直接用。`save_image_asset`/`rename_file` 的文件名非法字符净化用的是 Windows 字符集，在 Linux 上只会更宽松，无副作用。
4. **前后端通信方式规范**：全部通过 `invoke` + 自定义命令，无直连 Node/Electron API，天然适配 Tauri 移动端模型。
5. **tab 系统天然契合移动形态**：桌面默认的"单窗口多 Tab"正是 Android 唯一窗口形态，`open_or_focus` 多窗口分叉整体下线后，tab 链路（`add_tab`/`switch_tab`/`TabState` 缓存）原样保留。
6. **asset 协议已全开**：`tauri.conf.json` 的 `assetProtocol.scope = ["**"]`，本地图片经 `convertFileSrc` 渲染的链路无需重开权限（Android WebView 上 tauri 走 `https://tauri.localhost`，行为需实测确认）。
7. **主题体系零适配成本**：6 主题 × 深浅双模全部静态打包 + body 类门控，`theme_mode: system` 走 `matchMedia`，Android WebView 原生支持，深浅跟随系统白得。

## 阻碍点（按严重程度排序）

### 🔴 高危（初版遗漏）：前端路径处理的 Windows 反斜杠假设

**《Oblet-macOS-适配指南》§3.6 已识别同款问题，安卓端后果更严重。** 多处前端代码假设 `\` 是规范分隔符，在 Android（POSIX）上不是"碰对"而是**直接产出坏路径**——Linux 下 `\` 是合法文件名字符，`PathBuf::from("a\\b")` 会得到一个字面含 `\` 的文件名：

| 位置 | 现状 | Android 后果 |
| --- | --- | --- |
| `editor/image-paths.ts:26` `joinResolve` | `` `${dir}\\${rel}` `` 拼接，输出 `\` 连接 | v0.7.0 图片相对路径解析**全灭**：`assets/x.png` 拼成 `/sdcard/dir\assets\x.png` |
| `editor/setup.ts:87,179` `samePath` | `replace(/\//g,"\\")` + 小写化比较 | 比较碰巧一致但语义错误，依赖它的拖入判断/外部重载 guard 行为漂移 |
| `editor/vault.ts` `sanitizePathInput` | 归一化到反斜杠 + 盘符识别 | 用户输入 `/sdcard/Documents/vault` 被转义损坏 |
| `editor/tabs.ts` TabState 缓存键 | 路径 `toLowerCase()` | Android 文件系统**区分大小写**：`A.md` 与 `a.md` 是两个文件，缓存会错误命中 |
| Rust 侧 `lib.rs:236` `norm` 闭包、`state.rs` `canonical_key` | 小写化 + 反斜杠归一 | 同款大小写假设（安卓 v1 不做外部监听，影响推迟但不消失） |

**方案（已决策 D12）**：前端路径内部表示统一为 POSIX `/`（macOS 指南推荐方案），`joinResolve`/`samePath`/`dirnameOf`/`sanitizePathInput` 一次重构双端受益；路径大小写归一化全部去掉（Windows 上靠 Rust `Path` 语义兜底）。改动集中在 `image-paths.ts` / `setup.ts` / `vault.ts` / `tabs.ts` 四个文件，桌面端需回归测试：图片三特性、tab 切换、vault 导出、拖入打开。估 2~3 天（含回归）。

### 🟡 中高危：Android 分区存储（需选型，有成熟解法）

Oblet 的定位是"点任意 `.md` 即编辑、原地读写、外部变更监听"，Android 10+ 的分区存储对此有限制，但**并非无解**，取决于权限路线：

| 路线 | 机制 | 结果 |
| --- | --- | --- |
| **A. 常规 SAF 权限** | intent-filter 注册为 .md 默认打开方式，收到 `content://` URI，首次经系统选择器换持久读写授权 | 可编辑，但：只能原地覆盖（无原子写入）、不能建同级 `assets/`、不能重命名、`notify` 监听失效。核心承诺折损过半，不推荐 |
| **B. 所有文件访问权限（推荐）** | 申请 `MANAGE_EXTERNAL_STORAGE`，将 content URI 还原为 `/sdcard` 真实路径 | 现有 Rust 逻辑（原地读写、原子写入、assets、改名）**全部原样可用**，桌面体验完整平移 |

路线 B 的依据与边界：

- **先例成立**：开源编辑器 Markor 即采用此方案（GitHub/F-Droid 版申请所有文件访问，实现任意 .md 即点即编）
- **分发匹配**：Google Play 对该权限审核极严，但 Oblet 走 GitHub Releases 侧载分发，不受约束
- **一次性成本**：首次启动引导用户在系统设置页开权限
- **残留边界**：`/sdcard/Android/data` 内其他应用私有目录不可达（用户 md 文件基本不在此）；个别只发只读 content URI 的来源以只读模式打开并提供"另存为到本地"
- **权限门槛**：未授予所有文件访问权限则拒绝进入编辑器，仅显示权限引导页（已决策 D4，不做 SAF 降级模式）
- **实现路径**：Manifest 注册 intent-filter + 权限 → Kotlin 接 Intent 做 URI→路径解析（DocumentsContract/MediaStore 两条成熟套路）→ 真实路径直接喂给现有 `add_tab` 流程，后端基本零改动
- **intent-filter 的 mime 陷阱**：相当多文件管理器打开 .md 时发的是 `application/octet-stream` 或干脆不带 mimeType，只注册 `text/markdown` 会收不到 Intent。需要 `text/*` + `application/octet-stream` + `*/*` 配合 `pathPattern=".*\\.md"` 多组 filter 覆盖（Markor/Obsidian 均为此堆了多组声明），实测各主流文件管理器（系统文件、MT、Solid、ES）后才能收口

### 🟡 中危：桌面专属代码需要 cfg 隔离或替换

以下代码在 Android 上**编译失败或无意义**，需 `#[cfg(desktop)]` 隔离并提供移动端替代：

- `window-vibrancy` crate（桌面专属，Android 不编译）→ `set_window_effect` 在移动端做 no-op（Mica 在桌面端亦已下架，移动端更无此概念）
- `tauri-plugin-single-instance`（桌面专属插件）+ 整套 `open_or_focus` 多窗口/聚焦逻辑 → Android 单 Activity 单窗口，Intent 收到文件直接走 tab 追加
- `rundll32` 打开 URL（`commands.rs:459`）→ 换 `tauri-plugin-opener`
- argv 入口（`.md` 文件关联、`--new` 右键新建）→ 改用 Android Intent Filter（`ACTION_VIEW`），Kotlin 侧接 Intent 或借助社区插件
- 窗口建造参数：`inner_size` / `transparent` / `visible(false)` / `unminimize` / `set_focus` / `set_always_on_top` 在移动端大多无效，需条件编译。**splash 遮罩链路整体待实测**：Android WebView 冷启动同样有首帧黑盒，splash 思路可复用，但 `visible(false)` 建窗 + 双 rAF 揭窗的时序在 Tauri Android 上是否成立未知，第一版可先直接可见启动、再补遮罩
- `detect_newline` 新文件默认 CRLF（`commands.rs:192`）→ Android 应默认 LF（macOS 指南 #5 同款修正）
- `read_allow_multi_window`（`lib.rs:28-44`）与 `settings.rs:70` 同源：都基于 `current_exe()` 读 exe 同级 `data/settings.json` → 统一改用 `app_data_dir`（初版只提了 settings.rs 一处）
- `get_desktop_dir`（`commands.rs:364`，USERPROFILE 桌面概念）→ 改用 Documents 目录或工作区
- `ensure_md_icon`（`lib.rs:15`）已 `#[cfg(windows)]`，无需处理（正面确认项）
- 硬默认字体（霞鹜臻楷 GB / JetBrainsMonoNL NF / 华文中宋，`typography.ts`）在 Android 上全部不存在 → 平台感知默认值（macOS 指南 §3.2 同款修正，Android 候选：系统默认 sans / Noto Sans CJK / monospace）

这些改动机械、低风险，约 1~2 天可完成编译层面的打通。

### 🟡 中危：触屏交互适配

初版只列了右键菜单与快捷键，复审后补全清单：

- **右键菜单**（`contextmenu.ts`，Callout/图片操作入口）→ 需增加长按手势触发；子菜单 hover 展开（`contextmenu.ts:131` 由 CSS `:hover` 驱动）也要改为点按展开
- **TOC 悬浮目录**（`toc.ts`，初版遗漏）→ hover 500ms 展开在触屏不存在。**已决策 D14**：hover 改点按——点 bar 指示区展开面板，进度球维持原单击行为（回顶/已在顶部回光标行）
- **返回手势/返回键**（初版遗漏）→ **已决策 D15**：映射桌面 Esc 语义链——有浮层先关浮层 → 无浮层关当前 tab → 单 tab 退起始页 → 起始页再按退出 App。需 Android 侧 `onBackPressed` 桥接事件到前端
- **软键盘遮挡**（初版遗漏）→ Manifest 配 `windowSoftInputMode="adjustResize"`，前端视口用 `100dvh` / `visualViewport` 适配；光标所在行需保证不被键盘遮挡（PM `scrollIntoView` 链路实测）
- **刘海屏/安全区**（初版遗漏）→ `viewport-fit=cover` + `env(safe-area-inset-*)` 适配状态栏与手势条区域
- **Crepe 块手柄拖拽排序、图片块缩放手柄**（`image-edit.ts`）→ 拖拽类交互触屏可用性存疑，列入真机实测项，不可用时隐藏手柄降级为菜单操作
- **键盘快捷键**（Ctrl+T 等）→ 移动端需工具栏按钮兜底（`toolbar.ts` 已有基础，成本可控）；蓝牙键盘场景 Ctrl 系组合在 Android WebView 可用，无需另改
- **拖入文件打开** → 移动端不存在，入口改为文件选择器 / 分享 Intent（"用 Oblet 打开"）
- **窗口置顶、多窗口** → 移动端无此概念，相关 UI 隐藏
- **PDF 导出**：`window.print()` 链路在 Android WebView 行为不同，初版隐藏（已决策 D9）

### 🟢 低危但需实测：输入法（IME）

ProseMirror 在 Android WebView 上的**中文输入法组合（composition）**是业内公认的痛点（候选词上屏时事件序列与桌面不同，偶发丢字/光标跳动）。Milkdown 底层是 ProseMirror，无法绕开，只能在真机上实测主流输入法（Gboard/搜狗/讯飞）。这是上线前必须过的验收项，建议第一周就做最小验证。

## 外部变更监听：口径修正

初版有利因素 #3 称"notify 在 Android（inotify）上对真实路径同样工作"，与决策 D7"FUSE 下 inotify 不可靠"**自相矛盾**，本版修正为：

- **应用私有目录**（`/data/data/com.oblet.app`）：inotify 有效，notify crate 正常工作
- **`/sdcard`（FUSE/sdcardfs 挂载）**：inotify **不可靠**（其他进程的写入不触发事件），这正是 D7 的依据

结论不变：安卓 v1 不做外部变更监听（D7），二期可评估轮询方案。`lib.rs` setup 里的 watcher 创建代码在移动端直接 cfg 跳过。

## 构建环境

构建需一台桌面电脑（Windows/macOS/Linux），本机 Termux 环境无法承担。一次性安装约 7~8 GB：Android Studio（SDK + Build Tools，~3.5 GB）+ Android NDK（~2.5 GB，Rust 交叉编译必需）+ Rust Android targets（~0.3 GB）。按 Tauri 官方 Android setup 指引 1~2 小时可完成，不需要安卓开发经验，日常开发仍写 Rust + TypeScript。无桌面电脑时可用 GitHub Actions 云端构建 APK、手机浏览器直接下载安装，适合发版不适合联调（仓库已有 `.github/workflows/release.yml`，可扩展 Android job）。

## APK 体积

Tauri 安卓端不打包浏览器内核（用系统 WebView），体积构成：Rust 原生库单架构约 3~6 MB + 前端 dist（Milkdown/Mermaid/KaTeX）约 3~6 MB。**只发 arm64-v8a 单架构 APK**（勿打 universal 包，那会膨胀到 25~40 MB），总体可维持在 **10~15 MB**，与现有 Windows zip 体量相当。后续可选优化：Mermaid 动态加载、KaTeX 字体子集化，可再省 2~3 MB。

## 建议的实施顺序

1. **第 1 周 · 打通编译**：桌面机器搭好 Android 工具链 → `tauri android init` → cfg 隔离桌面代码（含 `detect_newline` LF、`read_allow_multi_window` 路径）→ 跑出能在模拟器打开的空壳 App
2. **第 1 周 · IME 最小验证**：在真机上跑纯 Milkdown 编辑器页，中文输入法高强度测试，确认无致命问题再继续投入
3. **第 2 周 · 路径重构 + 存储链路定型**：前端路径统一 POSIX `/`（D12，桌面端先回归）→ Manifest intent-filter + 权限引导页 → Kotlin 侧 URI→路径解析 → 文件打开/保存链路改造 → 设置迁移到 `app_data_dir`（移动端不做外部变更监听，D7）
4. **第 3 周 · 交互适配**：长按菜单、TOC 点按（D14）、返回键 Esc 语义（D15）、软键盘与安全区适配、Intent 接收（"打开方式"/"分享到"）、隐藏桌面专属 UI、字体平台默认值
5. **第 4 周 · 打磨与发布**：图标/启动屏、ABI 分包（arm64-v8a 为主）、签名与分发渠道、真机全功能回归（含 Crepe 块手柄/图片手柄可用性定夺）

## 决策记录

### 2026-09-27 初版确认（D0–D11）

| 编号 | 事项 | 决策 |
| --- | --- | --- |
| D0 | 存储权限路线 | **方案 B**：申请所有文件访问权限（MANAGE_EXTERNAL_STORAGE），仅 GitHub 直发 APK，不上 Play |
| D1 | 构建环境 | 有桌面电脑；本地装工具链调试构建，GitHub Actions 云端发版 |
| D2 | 最低系统版本 | **Android 11（API 30）起步**，不写旧版存储兼容代码 |
| D3 | ABI 架构 | **仅 arm64-v8a**，不做老旧设备适配 |
| D4 | 权限被拒行为 | **直接拒绝使用**，仅显示权限引导页（不做 SAF 降级模式） |
| D5 | 无法解析真实路径的来源 | **只读模式**打开 + "另存为到本地"按钮 |
| D6 | 新建笔记默认目录 | 首次新建时由用户选择（建议默认 `Documents/Oblet`），设置中可改 |
| D7 | 外部变更监听 | **安卓版暂不做**（/sdcard FUSE 挂载下 inotify 不可靠；二期可评估轮询方案） |
| D8 | 触屏交互 | 保留现有布局与视觉；右键菜单 → 长按触发；快捷键 → 工具栏按钮兜底；隐藏窗口控制按钮 |
| D9 | PDF 导出 | 初版隐藏入口，二期再评估 Kotlin 桥接 PrintManager |
| D10 | 代码组织 | **单代码库双端**，`cfg(desktop)`/`cfg(mobile)` 隔离差异，不分叉仓库 |
| D11 | 签名与更新 | 自签名 keystore 离线保管、CI 加密签名；应用内查 GitHub Releases 跳浏览器下载，不做静默更新 |

### 2026-09-28 复审新增（D12–D15）

| 编号 | 事项 | 决策 |
| --- | --- | --- |
| D12 | 前端路径 Windows 假设 | **统一重构为 POSIX `/` 内部分隔符**（`image-paths.ts`/`setup.ts`/`vault.ts`/`tabs.ts`），去掉路径小写化归一；一次重构同时服务 macOS 与 Android，桌面端全量回归后落地 |
| D13 | v1 功能子集 | **除 PDF 导出（D9）外全量保留**：Vault 导出、图片编辑三特性（依赖 D12 先行）、设置面板全量、TOC、搜索替换等不做删减 |
| D14 | TOC 触屏形态 | **hover 改点按**：点 bar 指示区展开面板（原 hover 语义），进度球维持原单击行为（回顶/回光标行）不变 |
| D15 | 返回键语义 | **映射桌面 Esc 语义链**：有浮层先关浮层 → 无浮层关当前 tab → 单 tab 退起始页 → 起始页再按退出 App |

## 后续文档动作

- 《Oblet-技术设计文档》第 12 节"明确不做的"含"不做移动端、macOS、Linux"——安卓适配立项后需修订此条（macOS 指南的存在说明该条款已事实松动）
- 安卓适配启动后，本报告的实施顺序与实测结论（IME、intent-filter mime、splash 链路）应回写为新的适配指南文档，与 macOS 指南并列

## 一句话总结

技术可行性 **高**：Tauri 2 移动端支持成熟，编辑器内核零改动，脚手架已备好。产品定位"任意 .md 即点即编"可通过申请所有文件访问权限（Markor 已验证的先例，匹配 GitHub 侧载分发）完整保留。复审新发现的最大技术项是**前端路径的 Windows 反斜杠假设**（安卓上直接产出坏路径，须以 POSIX 重构先行）。剩余挑战集中在真机验证项：中文输入法表现、各文件管理器的 URI 授权与 mime 行为差异、触屏拖拽交互。建议先用一周时间做编译打通 + IME 验证这两个最大不确定项，再决定全面投入。
