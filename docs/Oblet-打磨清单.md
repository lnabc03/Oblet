# Oblet 打磨清单

> 基线版本：v0.1.0 → v0.3.0（2026-07-30 \~ 2026-08-05）

---

## 批次 8：v0.3.0 核心修复与打磨（2026-08-04 \~ 2026-08-05）

- [x] **CSP nonce 导致代码块渲染崩溃**（P0）：Tauri 2 运行时注入 CSP nonce → `style-src` 含 nonce 时 `'unsafe-inline'` 对 `<style>` 元素失效 → CodeMirror style-mod 动态 `<style>` 全部 `.sheet === null`。修复：`tauri.conf.json` 设 `"csp": null`（本地桌面应用无需 CSP）
- [x] 启动过渡动画改为设置项（默认关）：界面区段新增"启动过渡动画"复选框；关闭时 `splash-early.js` 首帧前摘除 splash 节点（避免 localStorage 异步读取闪一帧动画）
- [x] 启动性能打点：Rust 侧 exe 入口/首窗建成 epoch 打点 + `get_boot_marks` 命令，前端 `__obletBootTiming` 对齐折算 WebView2 冷启动耗时（基线 ~1.5s，WebView2 硬地板 ~956ms）
- [x] 窗口初始隐藏：splash 首帧后 `show()` 揭窗，根治遮罩前白屏/透屏（Rust 3s 兜底防幽灵进程）
- [x] `.md` 文件关联图标：独立 `md.ico`（372KB），`register-md.bat` 与打包审计脚本同步更新
- [x] Tab 系统打磨：Esc 关最后一 tab 退起始页后，双击同一文件正确重新打开；多窗口=关时 emit `add-tab` 全局事件追加到前台窗口
- [x] `package.json` 版本号同步到 v0.3.0（发布版本号更新清单补入项目长期记忆）
- [x] CLAUDE.md 补 Tab 切换 Bug 修复记录（缓存键污染、路径闭包同步、滚动残留等 5 坑）

---

## 批次 7：保存至 Obsidian + 导出为 PDF（v0.1.0 收尾）

- [x] 保存至 Obsidian Vault（复制语义 + 路径规整容错 + EXISTS 确认覆盖）
- [x] 导出为 PDF（window\.print 系统窗 + Mica 自动开关 + 打印 CSS 跨页保护）
- [x] 覆盖确认换自绘弹窗（toast 同族）
- [x] 设置加"笔记存放至"小标题
- [x] Ctrl+O 保存至 Obsidian 进快捷键表
- [x] 菜单项改名去截断
- [x] 打印隐高亮行与虚拟光标

## 批次 7.1：起始页优化

- [x] 起始页显示版本号
- [x] 新建 Markdown 笔记（弹出文件名输入框、默认桌面路径、sanitizePathInput 规整管线）
- [x] Esc 退回起始页（有未保存内容弹确认）
- [x] 修复 auto_save 设不上的死循环（Option<bool>，null 是合法默认态）
- [x] 修复 create_note 参数命名（camelCase → snake_case 匹配 Tauri 协定）
- [x] 修复 Esc 与设置面板冲突（stopImmediatePropagation）

## 批次 7.2：窗口置顶 + 排版硬默认

- [x] 窗口置顶按钮（左上角大头针 SVG 图标）：点击切换 always-on-top，置顶态高亮主题色
- [x] Mica/打印适配置顶按钮
- [x] 快捷键 Alt+P（可改键）
- [x] 补 Tauri 权限 allow-set-always-on-top
- [x] 排版硬默认替代"跟随主题"透传（霞鹜臻楷 GB / JetBrainsMonoNL NF / 华文中宋 / 17px）
- [x] 设置面板去"(Win11)"与 Vault 提示占位

## 批次 7.3：多文档标签页切换（v0.2.0 核心特性）

- [x] 单窗口多 Tab（单 Crepe 实例 replaceAll 方案）
- [x] 箭头 UI（屏幕左右两侧半透明 SVG 箭头，hover 加深）
- [x] Alt+Left/Right 快捷键切换（首尾循环，可改键）
- [x] Tab 内容缓存（Map<路径, TabState>，切回时缓存命中免读盘）
- [x] 光标/滚动位置记忆与恢复（PM 原生 scrollIntoView）
- [x] Esc 关当前 Tab（多 tab 关当前、单 tab 退起始页）
- [x] 拖入追加（去重：已在列表中则直接切换）
- [x] 双击 .md 默认追加到现有窗口（允许多窗口=关时）
- [x] 设置面板"允许多窗口"复选框
- [x] Rust 侧：state.rs windows 结构升级（Vec<String>, usize）+ add_tab/remove_tab/switch_tab 命令
- [x] 文件监听目录引用计数（同目录多 tab 只 watch 一次）
- [x] 自动保存关时切 Tab 弹确认（保存/丢弃/取消）
- [x] 窗口标题随 Tab 切换更新
- [x] 非活跃 Tab 被外部修改时静默更新缓存
- [x] Tab 文件被外部删除时 toast 提示并自动移除

### Tab 切换 Bug 修复记录

1. **TDZ 错误**（`cannot access 'b' before initialization`）：`tabCallbacks` 在空窗口路径未初始化，`add-tab` 监听器闭包引用报错。修复：声明提升 + null 检查。
2. **拖入 B 显示 A 的旧内容**（3 轮修复）：根因依次为 sync 过早调导致 guard 短路 → 索引比较 guard 在 remove_tab 后失效 → updatePaths 在保存当前状态前调用导致缓存键污染。最终方案：路径比较 guard + 所有保存操作在 updatePaths 前完成 + 用 `oldActivePath` 做缓存键。
3. **Esc 关最后一篇后窗口标题残留**：Rust `clear_window_file` 补 `setTitle("Oblet")`。
4. **关闭 A 后无法重新拖入 A**：`path` 闭包变量未同步，`samePath(md, path)` 误判为已存在。修复：`setPath` 回调在 switchToTab 中同步。
5. **长文档切短文档滚动残留空白**：手动 `scrollTop` 被浏览器覆盖。修复：PM 原生 `scrollIntoView()` + 前置 `scrollTop=0` + 强制重排。

---

## 已知限制

1. **Undo 不跨 Tab**：切 Tab 后原 Tab 的撤销历史丢失（单 Crepe 实例的固有取舍）
2. **无标签栏**：只能通过箭头/快捷键切换，看不到 Tab 列表
3. **无法从编辑态新建笔记**：新建入口仅在起始页
4. **Tab 列表不持久化**：关闭窗口后 Tab 列表不保存，下次启动重新开始

