# Oblet macOS 适配指南

> 本文档供接手 macOS 适配的开发者（及 AI agent）参考，覆盖从 Rust 后端到前端 UI、从构建到分发的全部适配要点。
>
> 基线版本：Oblet v0.3.0（2026-08-05） | Windows 端成熟度：已发布，功能完整

---

## 一、项目速览

### 1.1 技术栈

| 层       | 选型                                       | macOS 适配影响                                                       |
| ------- | ---------------------------------------- | ---------------------------------------------------------------- |
| 外壳      | Tauri 2.x (Rust)                         | 跨平台框架，自带 macOS 支持；窗口效果后端不同                                       |
| WebView | Windows: WebView2 / macOS: **WKWebView** | 渲染行为与首帧时序有差异                                                     |
| 编辑器     | Milkdown 7.21.3 + Crepe（ProseMirror 内核）  | 纯 JS，跨平台，无需适配                                                    |
| 代码高亮    | CodeMirror 6（style-mod 动态注入 CSS）         | 纯 JS，跨平台                                                         |
| 数学      | KaTeX                                    | 纯 JS，跨平台                                                         |
| 构建      | Vite + TypeScript                        | 跨平台                                                              |
| 窗口效果    | window-vibrancy 0.8（Rust crate）          | 已同时支持 Windows Mica 和 macOS Vibrancy，需做 `#[cfg]` 分支               |
| 文件监听    | notify v6                                | 自动选择后端（Windows: ReadDirectoryChangesW / macOS: FSEvents），路径对照需修正 |

### 1.2 关键文件地图

**Rust 侧（`src-tauri/src/`）**

| 文件            | 职责                        | macOS 适配关注点                                                                                            |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `lib.rs`      | 窗口创建、单实例、文件监听             | 路径归一化 `norm` 闭包（Windows 专用）、`read_allow_multi_window` 路径逻辑                                             |
| `commands.rs` | 文件 IO、Tab 命令、窗口效果、URL 打开  | `set_window_effect`（Mica）、`get_desktop_dir`（USERPROFILE）、`open_url`（rundll32）、`detect_newline` 默认 CRLF |
| `state.rs`    | 窗口↔Tab 映射、哈希缓存            | `canonical_key` 注释（仅提 Windows 大小写）                                                                     |
| `settings.rs` | `./data/settings.json` 读写 | `data_dir()` 用 exe 同级路径——macOS app bundle 内不可写                                                         |

**前端侧（`src/`）**

| 文件                             | 职责                     | macOS 适配关注点                                                                           |
| ------------------------------ | ---------------------- | ------------------------------------------------------------------------------------- |
| `commands.ts`                  | 快捷键注册表 + 统一派发          | `comboOf()` 融合 Ctrl/Cmd→"Ctrl"，全部显示与默认组合                                              |
| `main.ts`                      | 入口，splash 遮罩，CSS 加载顺序  | WebView2 假设（双 rAF 时序、3s 兜底注释）                                                         |
| `editor/setup.ts`              | Crepe 装配、文件生命周期、Tab 集成 | 路径操作假设反斜杠、PDF 导出 Mica 开关                                                              |
| `editor/tabs.ts`               | Tab 切换系统               | 箭头 tooltip 写死 "Alt+Left/Right"                                                        |
| `editor/vault.ts`              | 保存至 Obsidian（复制语义）     | `sanitizePathInput` 归一化到反斜杠 + 盘符处理                                                    |
| `editor/contextmenu.ts`        | 自绘右键菜单                 | toast 消息 "Ctrl+V"、`execCommand("copy/cut")` 已废弃                                       |
| `editor/search.ts`             | 检索浮条（Ctrl+F）           | 默认组合 "Ctrl+F"                                                                         |
| `settings/typography.ts`       | 排版覆盖 + 持久化             | 硬默认字体（霞鹜臻楷 GB/华文中宋）macOS 不存在                                                          |
| `settings/ui.ts`               | 设置浮层 UI                | "Mica 材质"标签、"设置 (Ctrl+/)" tooltip                                                     |
| `styles/obsidian-base.css`     | 结构基座 + 变量桥             | `ob-vibrancy` 透明链路、字体 fallback（Segoe UI/Consolas）、`::-webkit-scrollbar`（WKWebView 不认） |
| `styles/anuppuccin-custom.css` | AnuPpuccin 深色主题        | 大量 Obsidian 专属 CSS（无害死代码），font-family 含 Segoe UI                                      |

### 1.3 核心原则（适配不能违反）

1. **序列化保真**：保存不侵入 Markdown 原文——与平台无关，无需修改
2. **前端不碰文件系统**：全部 IO 走 Rust command——与平台无关
3. **单 Crepe 实例**：Tab 切换走 replaceAll——与平台无关
4. **绿色/便携**：设置存 exe 同级 `data/`——**macOS 上不可行**（app bundle 只读），需迁至 `~/Library/Application Support/`

---

## 二、Rust 侧适配清单

### 2.1 P0 — 阻断编译/运行

#### #1 `set_window_effect` — 窗口材质效果（commands.rs 行 275-290）

**现状**：仅调用 `window_vibrancy::apply_mica` / `clear_mica` / `clear_acrylic`，这些是 Windows 专有 API。

```rust
// 当前代码（commands.rs 行 280-287）
let res = match effect.as_deref() {
    Some("mica") => window_vibrancy::apply_mica(&window, Some(true)),
    _ => {
        let a = window_vibrancy::clear_mica(&window);
        let b = window_vibrancy::clear_acrylic(&window);
        a.and(b)
    }
};
```

**macOS 改动**：`window-vibrancy` 0.8 已支持 macOS，改用 `apply_vibrancy` / `clear_vibrancy`：

```rust
#[cfg(target_os = "windows")]
fn apply_effect(window: &WebviewWindow, effect: &str) -> Result<(), String> {
    match effect {
        "mica" => window_vibrancy::apply_mica(window, Some(true)).map_err(|e| e.to_string()),
        _ => Ok(()),
    }
}
#[cfg(target_os = "windows")]
fn clear_effect(window: &WebviewWindow) -> Result<(), String> {
    window_vibrancy::clear_mica(window)
        .and(window_vibrancy::clear_acrylic(window))
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn apply_effect(window: &WebviewWindow, _effect: &str) -> Result<(), String> {
    // macOS Vibrancy: NSVisualEffectView 由 window-vibrancy 自动注入
    window_vibrancy::apply_vibrancy(window).map_err(|e| e.to_string())
}
#[cfg(target_os = "macos")]
fn clear_effect(window: &WebviewWindow) -> Result<(), String> {
    window_vibrancy::clear_vibrancy(window).map_err(|e| e.to_string())
}
```

**同步改动**：`settings.rs` 的 `window_effect` 字段注释需补 `"vibrancy"`（见 2.3 #9）。

---

#### #2 `get_desktop_dir` — 桌面路径（commands.rs 行 355-360）

**现状**：直接用 Windows 环境变量 `USERPROFILE` + 反斜杠拼接。

```rust
// 当前代码
pub fn get_desktop_dir() -> Result<String, String> {
    let home = std::env::var("USERPROFILE").map_err(|e| format!("获取用户目录失败: {e}"))?;
    Ok(format!("{home}\\Desktop"))
}
```

**macOS 改动**：推荐引入 `dirs` crate（零依赖，跨平台）：

```rust
// Cargo.toml 添加
dirs = "5"

// commands.rs 改为
pub fn get_desktop_dir() -> Result<String, String> {
    dirs::desktop_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "无法获取桌面目录".to_string())
}
```

`dirs::desktop_dir()` 在各平台的返回值：

- Windows: `C:\Users\<用户名>\Desktop`
- macOS: `/Users/<用户名>/Desktop`（不受语言影响，即使桌面文件夹叫"Schreibtisch"）

---

#### #3 `open_url` — 外链用系统浏览器打开（commands.rs 行 369-381）

**现状**：调用 `rundll32 url.dll,FileProtocolHandler`——Windows 专有机制。

**macOS 改动**：用 `open` 命令：

```rust
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("仅支持打开 http/https 链接".to_string());
    }
    #[cfg(target_os = "windows")]
    { std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn().map_err(|e| format!("打开链接失败: {e}"))?; }
    #[cfg(target_os = "macos")]
    { std::process::Command::new("open")
        .arg(&url)
        .spawn().map_err(|e| format!("打开链接失败: {e}"))?; }
    Ok(())
}
```

> **备选方案**：使用 Tauri 内置的 `tauri::api::shell::open`（跨平台），但当前版本已弃用此 API，`open` crate 也行。直接在 commands.rs 中 `#[cfg]` 无新增依赖，最轻量。

---

#### #4 路径归一化 `norm` 闭包（lib.rs 行 182-187）

**现状**：文件监听的事件路径归一化专用 Windows 管道：

```rust
let norm = |p: &Path| {
    p.to_string_lossy()
        .trim_start_matches(r"\\?\")  // Windows UNC extended-length prefix
        .replace('/', "\\")            // 归一化到反斜杠
        .to_lowercase()                // Windows 不区分大小写
};
```

**问题**：

- `trim_start_matches(r"\\?\")`——macOS 路径无此前缀（无害 no-op）
- `.replace('/', "\\")`——macOS 上 `/` 是原生分隔符，转成 `\` 后与 FSEvents（返回 `/` 路径）对照会失败
- `.to_lowercase()`——macOS APFS 默认也不区分大小写，保留无害

**macOS 改动**：

```rust
#[cfg(target_os = "windows")]
fn normalize_path(p: &Path) -> String {
    p.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .to_lowercase()
}
#[cfg(target_os = "macos")]
fn normalize_path(p: &Path) -> String {
    p.to_string_lossy().to_lowercase()
}
```

> **更优方案**：`state.rs` 已有 `canonical_key()` 函数（用 `std::fs::canonicalize`），可统一用这个——但要处理文件不存在时 `canonicalize` 失败的回退。无论选哪种方案，**norm 和 canonical_key 必须用同一种归一化逻辑**，否则监听事件哈希对比会失效。

---

### 2.2 P1 — 行为不正确

#### #5 `detect_newline` 新文件默认换行符（commands.rs 行 185-186）

**现状**：无换行的新文件默认 CRLF（Windows 惯例）。

```rust
// 无换行的新文件：Windows 平台默认 CRLF
"CRLF".to_string()
```

**macOS 改动**：

```rust
#[cfg(target_os = "windows")]
const DEFAULT_NEWLINE: &str = "CRLF";
#[cfg(not(target_os = "windows"))]
const DEFAULT_NEWLINE: &str = "LF";
// 然后用 DEFAULT_NEWLINE.to_string()
```

---

#### #6 `data_dir()` — 数据目录路径（settings.rs 行 59-65）

**现状**：`data/` 目录建在 exe 同级。这是"绿色便携版"的核心设计——把设置 `data/settings.json` 和 exe 放一起。

```rust
fn data_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe.parent().ok_or("无法定位 exe 目录")?.join("data"))
}
```

**macOS 问题**：macOS 的 `.app` bundle 结构下，exe 位于 `Oblet.app/Contents/MacOS/oblet`，其父目录 `MacOS/` 在 bundle 内，不可写。写 `data/settings.json` 到 bundle 内会：

- 开发阶段（`cargo tauri dev`）：exe 在 `target/debug/`，可写，看似正常
- 打包后（`.app`）：写入失败或被 macOS 的 App Translocation 重定向

**macOS 改动**：用 Tauri 的路径 API（推荐）或 `dirs` crate：

```rust
// 方案 A：Tauri 内置（推荐——自动返回 OS 标准路径）
use tauri::Manager;
// 在 command 中从 app handle 获取：
// let data_dir = app.path().app_data_dir()?;

// 方案 B：dirs crate（与 #2 共享依赖）
fn data_dir() -> Result<PathBuf, String> {
    let dir = dirs::config_dir()
        .ok_or("无法获取配置目录")?
        .join("com.oblet.app")  // 与 tauri.conf.json identifier 对齐
        .join("data");
    Ok(dir)
}
```

返回值对比：

- Windows（保持兼容）：`C:\Users\<用户名>\AppData\Roaming\com.oblet.app\data`
- macOS：`/Users/<用户名>/Library/Application Support/com.oblet.app/data`

> **⚠ 向下兼容**：Windows 现有用户的数据在 exe 同级 `data/`。可加回退逻辑：先检查 exe 同级 `data/` 是否存在，存在则沿用（不迁移），不存在则用 OS 标准路径。这样既兼容老用户，又可让新用户（和 macOS）走标准路径。

---

#### #7 `read_allow_multi_window` — 同款路径问题（lib.rs 行 11-25）

与 #6 完全相同的 exe 同级路径逻辑。**改动**：与 #6 统一，或直接改为在前端读设置（setup.ts 初始化时已有 `get_settings`），免除 Rust 侧单独读盘。

---

#### #8 notify 文件监听 — FSEvents 行为差异（lib.rs 行 170-245）

`notify` v6 在 macOS 上自动使用 **FSEvents** 后端，与 Windows 的 **ReadDirectoryChangesW** 有以下差异：

| 行为        | Windows（ReadDirectoryChangesW） | macOS（FSEvents）        |
| --------- | ------------------------------ | ---------------------- |
| 事件粒度      | 文件级（精确到具体文件）                   | **目录级**（报告整个目录的变更）     |
| 事件合并      | 较少                             | **激进合并**（短时多次写入合并为一条）  |
| Rename 检测 | Modify + Create/Remove 组合      | 有专用 `ItemRenamed` flag |
| 延迟需求      | 100ms 通常够用                     | **可能需要更长的去抖**          |

**现有代码已做的防护**：

- 按目录 watch（`RecursiveMode::NonRecursive`）+ 事件中的路径过滤——兼容 FSEvents 目录级报告
- 100ms sleep 去抖 + 内容哈希对比——兼容事件合并
- 按文件名过滤 rename 事件——逻辑本身跨平台

**需注意的点**：

1. `norm` 归一化必须与 FSEvents 返回的 `/` 路径兼容（见 #4）
2. 去抖可能需要调长到 200-300ms（FSEvents 合并更激进）
3. 建议在 macOS 实机上模拟 Obsidian 的 rename 式保存（写临时文件 + rename 覆盖目标），验证文件变更能被正确检测和重载

---

#### #9 `std::fs::rename()` 覆盖行为差异（commands.rs 行 213、324）

**这是一个极易遗漏的关键差异。**

Windows 上 `std::fs::rename()` 会原子性地**覆盖**已存在的目标文件。macOS（和其他 Unix 系统）上，`rename()` 在目标已存在时**返回错误**（`EEXIST` / `PermissionDenied`）。

Oblet 的原子写入依赖此行为：

```rust
// commands.rs write_file() 行 213 — 保存 md 文件
fs::rename(&tmp, &dest).map_err(|e| format!("写入失败: {e}"))?;

// commands.rs export_to_vault() 行 324 — 复制到 Obsidian Vault
fs::rename(&tmp, &dest).map_err(|e| format!("复制失败: {e}"))?;
```

**macOS 改动**：在 `rename` 前显式删除目标文件：

```rust
// 跨平台原子写入辅助函数
fn atomic_rename(tmp: &Path, dest: &Path) -> Result<(), String> {
    // macOS/Unix: rename 不覆盖已存在文件，先删除
    #[cfg(not(target_os = "windows"))]
    if dest.exists() {
        fs::remove_file(dest).map_err(|e| format!("无法移除旧文件: {e}"))?;
    }
    fs::rename(tmp, dest).map_err(|e| format!("原子写入失败: {e}"))?;
    Ok(())
}
```

> **注意**：`remove_file` + `rename` 不是严格原子的（两步之间系统可能崩溃），但对于本地 Markdown 编辑器是可接受的风险。如需严格原子性，macOS 上可用 `renamex_np(2)` 配合 `RENAME_SWAP` flag，但需引入 `libc` crate，复杂度高。

---

### 2.3 P2 — 注释/文档完善

- **#10** `settings.rs` 行 31：`window_effect: Option<String>` 注释仅写 `"mica"（Win11）`，需补 `"vibrancy"（macOS）`
- **#11** `lib.rs` 窗口创建注释：transparent 窗口注释仅提 Mica/Acrylic，需补 macOS Vibrancy
- **#12** `state.rs` 行 139：`canonical_key` 注释"Windows 不区分大小写"→"Windows/macOS 默认均不区分大小写"

---

## 三、前端适配清单

### 3.1 快捷键系统（commands.ts）——影响面最大

#### 3.1.1 根因：Ctrl 与 Cmd 的融合

`commands.ts` 行 62：

```typescript
if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
```

这行代码将 Windows 的 `Ctrl` 和 macOS 的 `Cmd`（metaKey）**不可逆地融合为同一字符串**。导致两个问题：

1. **所有显示都说 "Ctrl"**：macOS 用户看到 `Ctrl+S`、`Ctrl+F`，但实际应显示 `Cmd+S`、`Cmd+F`
2. **无法区分两种修饰键**：用户自定义键位也用 `"Ctrl"`，macOS 和 Windows 键位配置不可互换

#### 3.1.2 推荐方案：引入 `Mod` 占位符

借鉴 CodeMirror/ProseMirror 的 `Mod-` 惯例：

```typescript
// 新增：平台感知工具函数
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

function primaryMod(): string { return IS_MAC ? 'Cmd' : 'Ctrl'; }

// 修改 comboOf (line 50-67)
export function comboOf(e: KeyboardEvent): string | null {
  // ... key 解析不变 ...
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push(primaryMod());  // 改为平台感知
  if (e.altKey) parts.push(IS_MAC ? 'Option' : 'Alt');   // macOS 显示 Option
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}
```

**影响**：所有 `defaultCombo` 需要更新为 `Cmd+X`（macOS）或 `Ctrl+X`（Windows），或者引入 `Mod` 占位符在注册时展开。

#### 3.1.3 全部默认快捷键清单（需逐个审查）

| 命令           | 当前默认             | Windows 建议   | macOS 建议      | 备注                               |
| ------------ | ---------------- | ------------ | ------------- | -------------------------------- |
| save         | `Ctrl+S`         | `Ctrl+S`     | `Cmd+S`       |                                  |
| save-vault   | `Ctrl+O`         | `Ctrl+O`     | `Cmd+O`       |                                  |
| bold         | `Ctrl+B`         | `Ctrl+B`     | `Cmd+B`       |                                  |
| italic       | `Ctrl+I`         | `Ctrl+I`     | `Cmd+I`       |                                  |
| inline-code  | `` Ctrl+` ``     | `` Ctrl+` `` | `` Cmd+` ``   |                                  |
| highlight    | `Ctrl+H`         | `Ctrl+H`     | `Cmd+H`       | ⚠ macOS `Cmd+H` 系统级隐藏窗口          |
| search       | `Ctrl+F`         | `Ctrl+F`     | `Cmd+F`       |                                  |
| settings     | `Ctrl+/`         | `Ctrl+/`     | `Cmd+,`       | macOS 惯例是 Cmd+, 而非 Cmd+/         |
| toggle-pin   | `Alt+P`          | `Alt+P`      | `Option+P`    | Option+P = π，但 Oblet 捕获阶段拦截，不会输入 |
| next-tab     | `Alt+ArrowRight` | `Alt+Right`  | `Cmd+Shift+]` | ⚠ Option+Arrow 是 macOS 逐词跳转      |
| prev-tab     | `Alt+ArrowLeft`  | `Alt+Left`   | `Cmd+Shift+[` | ⚠ 同上                             |
| callout      | `Alt+A`          | `Alt+A`      | **去掉默认**      | Option+A = å，与系统输入法冲突            |
| heading-1\~6 | `Alt+1~6`        | `Alt+1~6`    | **去掉默认**      | Option+数字 = 特殊字符（™£¢∞§¶）         |

> **对于 heading**：Crepe 原生支持 `# ` 空格触发标题，macOS 上不设快捷键也能流畅编辑。callout 走右键菜单。
>
> **对于 `Ctrl+H`**（highlight）：macOS 上 `Cmd+H` 是系统级隐藏窗口（Hide），不能占用。可改为 `Cmd+Shift+H` 或仅保留 `==` 输入触发。

#### 3.1.4 用户可见字符串中的 "Ctrl"

| 文件                      | 行        | 内容                            | 改动                                  |
| ----------------------- | -------- | ----------------------------- | ----------------------------------- |
| `settings/ui.ts`        | 47       | `btn.title = "设置 (Ctrl+/)"`   | → 平台感知 `Cmd,` / `Ctrl+/`            |
| `editor/tabs.ts`        | 195, 200 | 箭头 tooltip `"Alt+Left/Right"` | → 平台感知 `Cmd+Shift+[` / `Ctrl+Alt+←` |
| `editor/contextmenu.ts` | 54       | `"无法读取剪贴板，请用 Ctrl+V 粘贴"`      | → 平台感知 `Cmd` / `Ctrl`               |

### 3.2 字体栈（typography.ts + obsidian-base.css）

#### 3.2.1 硬默认字体（typography.ts 行 57-62）

```typescript
const TYPO_DEFAULTS = {
  text_font: "霞鹜臻楷 GB",        // macOS 需用户自行安装
  mono_font: "JetBrainsMonoNL NF", // macOS 需用户自行安装
  interface_font: "华文中宋",      // ⚠ Windows Office 字体，macOS 不存在
  base_font_size: 17,
};
```

**建议**：引入平台感知默认值：

```typescript
const IS_MAC = /Mac/i.test(navigator.platform);

const TYPO_DEFAULTS = {
  text_font: IS_MAC ? "PingFang SC" : "霞鹜臻楷 GB",
  mono_font: IS_MAC ? "SF Mono" : "JetBrainsMonoNL NF",
  interface_font: IS_MAC ? "PingFang SC" : "华文中宋",
  base_font_size: 17,
};
```

#### 3.2.2 CSS 字体 fallback 链（obsidian-base.css 行 18-19）

```css
--ob-font: var(--font-text, var(--font-interface, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif));
--ob-font-mono: var(--font-monospace, Consolas, "Cascadia Mono", monospace);
```

**问题**：

- `"Segoe UI"`、`"Microsoft YaHei"`——Windows 专属，macOS 渲染为 fallback sans-serif
- `Consolas`、`"Cascadia Mono"`——Windows 专属，macOS 渲染为 fallback monospace（Menlo）

**改动**：macOS 有 `-apple-system` 在最前面，实际渲染不会出错，但链太长且含无用项。加入 macOS 推荐字体作为前置 fallback：

```css
--ob-font: var(--font-text, var(--font-interface, -apple-system, "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei", sans-serif));
--ob-font-mono: var(--font-monospace, "SF Mono", Menlo, Monaco, Consolas, "Cascadia Mono", monospace);
```

### 3.3 CSS 适配

#### 3.3.1 `body.ob-vibrancy` 透明链路（obsidian-base.css 行 112-144）

**现状**：`body.ob-vibrancy` 触发 `background: transparent` + `backdrop-filter: blur(1px) saturate(2)`。

**macOS 差异**：Tauri 的 macOS Vibrancy（`NSVisualEffectView`）**自动提供模糊背景**，不需要 CSS backdrop-filter 模拟。前端 CSS 的 `background: transparent` 让出底色给原生 NSVisualEffectView，效果即为原生 Vibrancy。`backdrop-filter` 在 WKWebView 中也支持，但叠加原生和 CSS 模糊可能造成"双重模糊"。

**建议**：macOS 上仅做 `background: transparent`（让原生 Vibrancy 接管），去掉浮层面板的 `backdrop-filter`。可用平台检测或直接检测 body 是否有 macOS 特征类：

```css
/* macOS: 原生 Vibrancy 已提供模糊，CSS 仅需透明 */
body.ob-vibrancy-macos .search-bar,
body.ob-vibrancy-macos .settings-panel,
/* ... */ {
  background: rgba(var(--ctp-base), 0.75);  /* 半透明，无 blur */
}
/* Windows: 原生 Mica + CSS blur 补齐浮层 */
body.ob-vibrancy-windows .search-bar,
/* ... */ {
  background: rgba(var(--ctp-base), 0.8);
  backdrop-filter: blur(1px) saturate(2);
}
```

#### 3.3.2 `::-webkit-scrollbar` 自定义滚动条（obsidian-base.css 行 332-357）

**WKWebView 不支持 `::-webkit-scrollbar`**。macOS 系统级 overlay scrollbar 不接受 CSS 样式覆盖。这对视觉一致性有轻微影响，但不构成功能问题——滚动条仍然可用，只是样式跟随系统。

> 无需改动，macOS 原生滚动条已符合系统设计语言。但在 WKWebView 验证时注意：滚动条宽度/颜色不回退到难看的状态。

#### 3.3.3 macOS traffic light 按钮与现有 UI 布局

macOS 窗口左上角有红/黄/绿三个 traffic light 按钮（关闭/最小化/全屏）。Oblet 的窗口置顶大头针按钮（pin-btn）位于左上角（`left: 12px, top: 12px`），可能与 traffic light 重叠。

**建议**：macOS 上给 pin-btn 增加 `margin-top` 偏移（或检测 traffic light 区域高度，约 28px），或改为右侧放置。

#### 3.3.4 表单控件（settings panel）

`obsidian-base.css` 行 987-996 的 `select` / `input` 样式使用自定义外观。macOS 原生 select/input 控件外观与 Windows 差异显著——圆角、边框、聚焦环均不同。当前 CSS 使用 `appearance: none` 自绘，消除了平台差异，**无需额外适配**。

### 3.4 窗口效果设置面板（settings/ui.ts）

#### 3.4.1 "Mica 材质" → 平台感知标签

`ui.ts` 行 97-99：

```html
<input type="checkbox" id="mica-toggle">
<span>Mica 材质</span>
```

**改动**：标签改为平台感知——Windows 显示"Mica 材质"，macOS 显示"Vibrancy 模糊"或"窗口半透明"。

#### 3.4.2 window_effect 值的平台适配

当前 toggle 写入 `"mica"` 或 `null`。macOS 上应写入 `"vibrancy"` 或 `null`。前端需要一个平台感知的 effect 值常量：

```typescript
const WINDOW_EFFECT = IS_MAC ? "vibrancy" : "mica";
```

### 3.5 main.ts — WebView2 假设

`main.ts` 的 splash 遮罩链路包含多处 WebView2 特定注释和时序调整：

```typescript
// 行 13-14: "透明窗口从 WebView2 就绪"、"3s 兜底"
// 行 37: 双 rAF → getCurrentWindow().show()
// 行 58-64: 双 rAF → dismissSplash
```

**WKWebView 差异**：

- 首帧绘制时机不同，双 rAF 可能不够或多余
- WKWebView 透明窗口行为与 WebView2 不同（`NSWindow.isOpaque=false` + 原生 compositor）
- Rust 侧 3s 兜底 `show()` 在 macOS 上仍然必要（防御性编程，不依赖特定 WebView 行为）

**建议策略**：

1. **第一阶段**：macOS 上先跳过 splash 整个链路（`window.visible(true)` 直接显示），聚焦编辑器和核心功能跑通
2. **第二阶段**：回来适配 splash，在 WKWebView 上实测确定正确的揭窗时机
3. 如需保留 splash，把等待逻辑改为 promise-based (`document.readyState === 'complete'` + 单 rAF)，不依赖 WebView2 特性

### 3.6 路径操作（前端的 Windows 假设）

以下前端函数的路径处理假设反斜杠为规范分隔符：

| 文件                        | 函数                                   | 问题                               |
| ------------------------- | ------------------------------------ | -------------------------------- |
| `editor/setup.ts` 行 61-87 | `samePath`、`dirnameOf`、`joinResolve` | `replace(/\//g, "\\")`、`"\\"` 拼接 |
| `editor/vault.ts` 行 17-22 | `sanitizePathInput`                  | `replace(/\//g, "\\")`、盘符检测 `C:` |

**这些函数在 macOS 上会导致什么？**

- `samePath("a/b", "a\\b")` → `"a\\b" === "a\\b"` → true（结果碰对，但逻辑不合理）
- `dirnameOf("/Users/xxx/file.md")` → 用 `lastIndexOf("\\")` 找到 -1，用 `lastIndexOf("/")` 找到最后一个 `/` → 碰对
- `joinResolve("/Users/xxx", "file.md")` → `"/Users/xxx\\file.md"` → 路径含 `\\`，传给 Rust 后 `PathBuf::from` 会将其视为文件名的一部分（macOS 允许 `\` 在文件名中）→ **路径错误**
- `sanitizePathInput` 把所有 `/` 替换为 `\` + 盘符识别 `C:` → macOS 路径 `/Users/xxx/Desktop` 被错误转换

**全部需改为平台感知**。推荐方案：**重构路径操作函数，用 POSIX `/` 作为内部统一分隔符**（Rust 的 `PathBuf::from` 也能正确处理），前端不再做反斜杠归一化。这比 `#[cfg]` 分支更干净。

### 3.7 `document.execCommand` 已废弃（contextmenu.ts 行 37-42）

```typescript
run: () => document.execCommand("copy"),
run: () => document.execCommand("cut"),
```

`execCommand` 在 WKWebView 中行为可能与 WebView2 不同。**推荐改为 `navigator.clipboard.writeText()`**（paste 处已用了 `navigator.clipboard.readText()`，copy/cut 应统一）。

---

## 四、构建与打包

### 4.1 tauri.conf.json

当前缺少 `bundle.macOS` 配置块。需补充：

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "macOS": {
      "minimumSystemVersion": "11.0"
    }
  }
}
```

- `icon.icns` 已有（macOS 格式），无需新增
- `icon.ico` 是 Windows 格式，macOS 会忽略
- 建议添加 `entitlements` 路径（用于 Hardened Runtime / 公证）

### 4.2 Cargo.toml 依赖

| 依赖                                   | 现状                                       | macOS 动作                     |
| ------------------------------------ | ---------------------------------------- | ---------------------------- |
| `window-vibrancy = "0.8"`            | ✅ 已跨平台                                   | 不变                           |
| `notify = "6"`                       | ✅ 已跨平台（FSEvents）                         | 不变                           |
| `tauri-plugin-single-instance = "2"` | ✅ 已跨平台（Unix domain socket / named mutex） | 不变                           |
| —                                    | —                                        | **新增** `dirs = "5"`（桌面/配置目录） |

### 4.3 分发形态差异

| 维度    | Windows                     | macOS                                                             |
| ----- | --------------------------- | ----------------------------------------------------------------- |
| 包格式   | 绿色 zip（exe + data/）         | `.app` bundle + DMG                                               |
| 设置路径  | exe 同级 `data/settings.json` | `~/Library/Application Support/com.oblet.app/data/`               |
| 文件关联  | `register-md.bat`（注册表 HKCU） | Info.plist `CFBundleDocumentTypes` + `UTImportedTypeDeclarations` |
| 未签名警告 | SmartScreen "已保护你的电脑"       | Gatekeeper "无法验证开发者"，需右键→打开                                       |
| 公证    | 不需要                         | 需 Apple Developer 账号 + Notary Service（否则每次更新用户都被拦）                |

### 4.4 .md 文件关联（macOS 方案）

替代 Windows 的 `register-md.bat`，macOS 通过 Info.plist 声明支持的文件类型：

- 在 `tauri.conf.json` 的 `bundle.macOS.info.plist` 中添加 `CFBundleDocumentTypes`
- 或在 Tauri 构建后手动修改 `Info.plist`
- UTI: `net.daringfireball.markdown`（系统已定义）或自定义 `com.oblet.markdown`

### 4.5 CI（.github/workflows/）

现有 Actions 仅 Windows runner。需新增 macOS job：

```yaml
build-macos:
  runs-on: macos-latest
  steps:
    - uses: actions/checkout@v4
    - name: Setup Node
      uses: actions/setup-node@v4
      with: { node-version: '20' }
    - name: Setup Rust
      uses: dtolnay/rust-toolchain@stable
    - run: npm ci
    - run: npm run tauri build
    - name: Create DMG
      run: |
        # 打包为 DMG
        hdiutil create -volname Oblet -srcfolder src-tauri/target/release/bundle/macos -ov -format UDZO Oblet-macOS-${{ github.ref_name }}.dmg
    - name: Upload Release Asset
      uses: softprops/action-gh-release@v1
      with: { files: '*.dmg' }
```

---

## 五、暂不处理的（可直接用，无需改）

以下模块与平台无关，macOS 上直接可用：

- **Milkdown/Crepe 编辑器内核**：纯 JS/TS + ProseMirror，跨平台
- **CodeMirror 6 代码高亮**：纯 JS（style-mod CSS 注入在 WKWebView 中同样可用）
- **KaTeX 数学公式**：纯 JS，跨平台
- **序列化保真层（frontmatter.ts）**：mdast 操作，与平台无关
- **Tab 切换（tabs.ts）**：DOM + ProseMirror 操作，跨平台
- **属性栏 / 右键菜单 / toast / 搜索浮条**：纯 Web 技术，跨平台
- **Vite 构建**：跨平台（路径为 POSIX 风格，Windows 也能处理）
- **`notify.ts`**：toast 弹窗 + 自绘确认弹窗，纯 DOM 操作
- **`public/splash-early.js`**：localStorage 读取，跨平台

---

## 六、推荐实施策略

### 阶段 1：先跑通（目标：npm run tauri dev 不报错）

1. 用 `#[cfg]` 包裹/替换这 6 处 Rust 代码：`set_window_effect`、`get_desktop_dir`、`open_url`、`norm` 路径归一化、`detect_newline` 默认值、`data_dir()` 路径
2. 前端路径操作暂时跳过（`joinResolve` 中 `\\` 不改也能启动，只是文件 IO 会失败）
3. `cargo check` 通过
4. `npm run tauri dev` 启动到起始页

### 阶段 2：核心功能可用（目标：读写 md、切换 tab、搜索/替换）

1. 前端路径操作改为 POSIX 分隔符或平台感知
2. 快捷键系统引入 `IS_MAC` + `primaryMod()`
3. macOS 默认快捷键（Cmd+S / Cmd+F / Cmd+, 等）
4. 文件监听（FSEvents）验证

### 阶段 3：体验对齐（目标：视觉接近 Windows 版）

1. 窗口 Vibrancy 效果
2. 字体栈 macOS 默认值
3. CSS 透明链路适配
4. 设置面板标签/tooltip 文本适配
5. splash 链路在 WKWebView 上验证/重写

### 阶段 4：可发布（目标：DMG 可运行、可分发）

1. tauri.conf.json 补充 macOS 配置
2. 文件关联（Info.plist）
3. CI 新增 macOS build job
4. Gatekeeper 绕行说明文档（README）

---

## 七、验证路径

1. `cargo check` 在 macOS 上编译通过
2. `npm run tauri dev` 启动无报错
3. 起始页正常显示（版本号、新建按钮）
4. 拖入 .md 渲染正确、编辑可用
5. 保存后重新打开：内容无损（序列化保真）
6. Tab 切换（多文件拖入 → Alt/快捷键切换 → Esc 关）
7. 外部变更监听（另一编辑器修改文件 → Oblet 自动重载/toast 提示）
8. 查找替换 Ctrl+F（Cmd+F）
9. 导出为 PDF（打印对话框）
10. 序列化回归测试通过：`node test-break-roundtrip.mjs && node test-list-roundtrip.mjs`

---

*文档版本：v1.0（2026-08-05）｜ 基线 Oblet v0.3.0*
