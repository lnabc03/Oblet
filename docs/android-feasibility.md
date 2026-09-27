# Oblet 安卓端适配可行性评估

> 评估日期：2026-09-27 · 基于当前仓库 v0.7.0 代码
> 决策确认：2026-09-27（见文末"决策记录"）

## 结论

**可行，且技术底座已经就位，但"外壳层"需要一轮系统性重构。** 编辑器内核（约 6000 行前端）几乎零改动即可运行；工作量集中在桌面范式的窗口管理、文件打开方式、存储路径与输入交互的替换上。预估工作量：**2~4 周**（熟悉 Tauri 移动端的前提下），其中一半时间会花在 SAF 存储权限与输入法联调上。

## 有利因素（适配成本低的部分)

1. **Tauri 2 官方支持 Android**，且项目已具备移动端雏形：
   - `Cargo.toml` 已配置 `crate-type = ["staticlib", "cdylib", "rlib"]`（移动端编译必需的产物类型）
   - `lib.rs` 已标注 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`
   - `src-tauri/icons/android/` 图标已生成
   - 即作者已有预案，运行 `npm run tauri android init` 即可生成 `gen/android` 工程
2. **编辑器内核纯 Web 实现**：Milkdown/ProseMirror、CodeMirror 6、Mermaid、KaTeX、6 款主题、搜索替换、TOC 全部是前端代码，Android System WebView 是常青 Chromium，兼容性良好，无需任何修改。
3. **Rust 命令层大部分可移植**：`read_file` / `write_file`（原子写入）/ `rename_file` / `save_image_asset` 等均基于 `std::fs`，在应用私有目录下直接可用。`notify` 文件监听 crate 在 Android（inotify）上对真实路径同样工作。
4. **前后端通信方式规范**：全部通过 `invoke` + 自定义命令，无直连 Node/Electron API，天然适配 Tauri 移动端模型。

## 阻碍点（按严重程度排序）

### 🟡 中高危：Android 分区存储（需选型，有成熟解法）

Oblet 的定位是"点任意 `.md` 即编辑、原地读写、外部变更监听"，Android 10+ 的分区存储对此有限制，但**并非无解**，取决于权限路线：

| 路线 | 机制 | 结果 |
| --- | --- | --- |
| **A. 常规 SAF 权限** | intent-filter 注册为 .md 默认打开方式，收到 `content://` URI，首次经系统选择器换持久读写授权 | 可编辑，但：只能原地覆盖（无原子写入）、不能建同级 `assets/`、不能重命名、`notify` 监听失效。核心承诺折损过半，不推荐 |
| **B. 所有文件访问权限（推荐）** | 申请 `MANAGE_EXTERNAL_STORAGE`，将 content URI 还原为 `/sdcard` 真实路径 | 现有 Rust 逻辑（原地读写、原子写入、notify、assets、改名）**全部原样可用**，桌面体验完整平移 |

路线 B 的依据与边界：

- **先例成立**：开源编辑器 Markor 即采用此方案（GitHub/F-Droid 版申请所有文件访问，实现任意 .md 即点即编）
- **分发匹配**：Google Play 对该权限审核极严，但 Oblet 走 GitHub Releases 侧载分发，不受约束
- **一次性成本**：首次启动引导用户在系统设置页开权限
- **残留边界**：`/sdcard/Android/data` 内其他应用私有目录不可达（用户 md 文件基本不在此）；个别只发只读 content URI 的来源以只读模式打开并提供"另存为到本地"
- **权限门槛**：未授予所有文件访问权限则拒绝进入编辑器，仅显示权限引导页（已决策，不做 SAF 降级模式）
- **实现路径**：Manifest 注册 intent-filter + 权限 → Kotlin 接 Intent 做 URI→路径解析（DocumentsContract/MediaStore 两条成熟套路）→ 真实路径直接喂给现有 `add_tab` 流程，后端基本零改动

### 🟡 中危：桌面专属代码需要 cfg 隔离或替换

以下代码在 Android 上**编译失败或无意义**，需 `#[cfg(desktop)]` 隔离并提供移动端替代：

- `window-vibrancy` crate（桌面专属，Android 不编译）→ `set_window_effect` 在移动端做 no-op
- `tauri-plugin-single-instance`（桌面专属插件）+ 整套 `open_or_focus` 多窗口/聚焦逻辑 → Android 单窗口，直接走 tab 追加
- `rundll32` 打开 URL（`commands.rs:459`）→ 换 `tauri-plugin-opener`
- argv 入口（`.md` 文件关联、`--new` 右键新建）→ 改用 Android Intent Filter（`ACTION_VIEW`，mime `text/markdown`），需要在 Kotlin 侧接 Intent 或借助社区插件
- 窗口建造参数：`inner_size` / `transparent` / `visible(false)` / `unminimize` / `set_focus` / `set_always_on_top` 在移动端大多无效，需条件编译
- 设置存储 `exe 同级 data/settings.json`（`settings.rs:70` 基于 `current_exe()`）→ 改用 `app_data_dir`
- `get_desktop_dir`（桌面概念）→ 改用 Documents 目录或工作区

这些改动机械、低风险，约 1~2 天可完成编译层面的打通。

### 🟡 中危：触屏交互适配

- **右键菜单**（`contextmenu.ts`，Callout/图片操作入口）→ 需增加长按手势触发
- **键盘快捷键**（Ctrl+T 等）→ 移动端需工具栏按钮兜底（`toolbar.ts` 已有基础，成本可控）
- **拖入文件打开** → 移动端不存在，入口改为文件选择器 / 分享 Intent（"用 Oblet 打开"）
- **窗口置顶、多窗口** → 移动端无此概念，相关 UI 隐藏
- **PDF 导出**：`window.print()` 链路在 Android WebView 行为不同，需验证或改为后端生成

### 🟢 低危但需实测：输入法（IME）

ProseMirror 在 Android WebView 上的**中文输入法组合（composition）**是业内公认的痛点（候选词上屏时事件序列与桌面不同，偶发丢字/光标跳动）。Milkdown 底层是 ProseMirror，无法绕开，只能在真机上实测主流输入法（Gboard/搜狗/讯飞）。这是上线前必须过的验收项，建议第一周就做最小验证。

## 构建环境提醒

当前开发环境是 Android 设备本机（Termux 类环境），**无法在本机构建 Tauri Android 应用**：需要桌面系统（Windows/macOS/Linux）安装 Android Studio（SDK + NDK）和 Rust Android targets。替代方案：用 GitHub Actions 在云端构建 APK（仓库已有 `.github` 工作流目录，可扩展）。

## 建议的实施顺序

1. **第 1 周 · 打通编译**：桌面机器搭好 Android 工具链 → `tauri android init` → cfg 隔离桌面代码 → 跑出能在模拟器打开的空壳 App
2. **第 1 周 · IME 最小验证**：在真机上跑纯 Milkdown 编辑器页，中文输入法高强度测试，确认无致命问题再继续投入
3. **第 2 周 · 存储链路定型**：Manifest intent-filter + 权限引导页 → Kotlin 侧 URI→路径解析 → 文件打开/保存链路改造 → 设置迁移到 `app_data_dir`（移动端暂不做外部变更监听，已决策）
4. **第 3 周 · 交互适配**：长按菜单、触屏工具栏、Intent 接收（"打开方式"/"分享到"）、隐藏桌面专属 UI
5. **第 4 周 · 打磨与发布**：图标/启动屏、ABI 分包（arm64-v8a 为主）、签名与分发渠道

## 构建环境

构建需一台桌面电脑（Windows/macOS/Linux），本机 Termux 环境无法承担。一次性安装约 7~8 GB：Android Studio（SDK + Build Tools，~3.5 GB）+ Android NDK（~2.5 GB，Rust 交叉编译必需）+ Rust Android targets（~0.3 GB）。按 Tauri 官方 Android setup 指引 1~2 小时可完成，不需要安卓开发经验，日常开发仍写 Rust + TypeScript。无桌面电脑时可用 GitHub Actions 云端构建 APK、手机浏览器直接下载安装，适合发版不适合联调。

## APK 体积

Tauri 安卓端不打包浏览器内核（用系统 WebView），体积构成：Rust 原生库单架构约 3~6 MB + 前端 dist（Milkdown/Mermaid/KaTeX）约 3~6 MB。**只发 arm64-v8a 单架构 APK**（勿打 universal 包，那会膨胀到 25~40 MB），总体可维持在 **10~15 MB**，与现有 Windows zip 体量相当。后续可选优化：Mermaid 动态加载、KaTeX 字体子集化，可再省 2~3 MB。

## 决策记录（2026-09-27 确认）

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

## 一句话总结

技术可行性 **高**：Tauri 2 移动端支持成熟，编辑器内核零改动，脚手架已备好。产品定位"任意 .md 即点即编"可通过申请所有文件访问权限（Markor 已验证的先例，匹配 GitHub 侧载分发）完整保留。剩余挑战集中在真机验证项：中文输入法表现、各文件管理器的 URI 授权行为差异。建议先用一周时间做编译打通 + IME 验证这两个最大不确定项，再决定全面投入。
