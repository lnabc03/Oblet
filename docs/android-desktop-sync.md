# 安卓 → 桌面同步调研清单（v0.8.0 合并后）

> 执行状态（2026-10-04）：第二节 1~4 已全部落地（欢迎页三按钮按用户批示改为全平台
> 完全一致：新建/打开文件|最近打开无边框统一样式，桌面打开文件走 tauri-plugin-dialog；
> 桌面直列式最近列表方案被该批示取代）。第三节回归已实测：图片 `../` 解析、
> 右键菜单 Esc 链（只关菜单不关 tab）、设置面板清空历史、不存在目录自动创建均通过。
> 序列化脚本本机缺失（本地资产未同步到这台机器），本轮未动序列化逻辑，风险低。

安卓适配期间相当一部分改动写在共享代码路径上，合并后已直接在桌面端生效；
另一部分被 `IS_MOBILE` / `cfg(mobile)` 门控只服务安卓。本文档分四类收口：
已自动同步（只需回归留意）、建议回同步（桌面可受益）、回归风险点、明确不同步。

## 一、已随合并自动同步到桌面（共享代码路径，无需动作）

| # | 改动 | 桌面侧影响 |
|---|------|-----------|
| 1 | `add_tab` 打开前 `is_file()` 校验（NOT_FOUND）+ 欢迎页/boot 文件被删的优雅降级（停留欢迎页 + toast + 剔除最近记录） | 桌面双击已删除的历史文件同样受益，不再进红字死页 |
| 2 | `set_title` 失败容错（add_tab/remove_tab/switch_tab/rename_file 四处 `let _ =`） | 更健壮，行为无可见变化 |
| 3 | contextmenu 重构为 `openMenu` 共享构建器（右键/长按/应用菜单同源） | 桌面右键菜单行为微调见「三-2」 |
| 4 | Esc 消费语义（菜单/搜索/设置/弹窗 Esc 统一 `preventDefault` + `stopImmediatePropagation`） | 修了一个隐性双重触发：菜单开着按 Esc 原本会**连带关 tab**，现在只关菜单 |
| 5 | `blockConfig.filterNodes` 修复（math_inline 不再被当作活动块） | 桌面同样存在的块手柄错位 bug 被顺带修复 |
| 6 | 触屏块手柄驱动 + 手柄 offset 0/16 按 `noHoverPointer` 分叉 | 桌面鼠标不变；Windows 触屏设备自动受益 |
| 7 | TOC 点按模式（COARSE_POINTER 分叉） | 桌面 hover 不变；触屏设备自动受益 |
| 8 | `joinResolve` 输出 POSIX `/` 分隔（D12 前端路径共享层） | **行为变化点**：Windows 下图片解析路径现在含正斜杠，见「三-4」 |
| 9 | `pathKey`（tabs 缓存键、samePath） | Windows 仍小写归一，行为等价 |
| 10 | `note_recent_file`（Rust 侧每次 add_tab 记录，全平台） | 桌面 settings.json 已在静默累积 `recent_files`，但**桌面无任何 UI 消费它**（见「二-1」） |
| 11 | `-webkit-tap-highlight-color: transparent`、viewport meta | 桌面无影响 |

## 二、建议回同步到桌面（按价值排序）

1. **欢迎页「最近打开」入口**（高价值）：数据管线已全平台打通（Rust 记录 + 前端读取 +
   `openMenu` 列表渲染都是现成的），桌面只差一个入口。建议欢迎页加最近列表
   （直接列出最近 3~5 条，比按钮+浮层更顺）；同时桌面欢迎页可加「打开文件」按钮
   （桌面走 tauri dialog 插件，需新增依赖，或用命令行/拖入已有入口的理由不做也行）。
2. **「笔记」→「文件」文案统一**（一致性）：欢迎页按钮已改「新建 Markdown 文件」，但
   `promptDialog` 标题（setup.ts:153）、设置面板 label「笔记新建至/笔记另存至」、
   Rust 注释仍是「笔记」。编辑器语义上「文件」更准确。
3. **`create_note` / `export_to_vault` 目录不存在时自动创建**（安卓已做 `cfg(android)` 限定）：
   桌面目前报「目录不存在」。建议同步为自动创建（桌面路径手输成本高），或至少
   错误提示里给「创建该目录」按钮。
4. （低优先级）设置面板「最近打开」管理项：清空历史 / 条数上限（目前固定 10 封顶）。

## 三、桌面回归风险点（合并后建议逐项过一遍）

1. **Esc 链路注册顺序**：openMenu / search / imagePanelEscGuard / setup 全局关 tab
   都在 window 捕获层，同相位按注册序触发。菜单/面板开着时 Esc 应只关最上层。
2. **右键菜单**：子菜单 hover 展开、点击/滚动/失焦/Esc 关闭、贴右缘 flip、
   贴左缘不 flip（新增左界判断）。
3. **带选区右键时 Crepe 选中工具栏会被 `ob-ctx-open` 规则隐藏**（display:none）。
   桌面原本两者并存无冲突，现在右键期间工具栏消失——确认这个顺带行为变化可接受，
   否则把该 CSS 规则加移动端口径。
4. **图片链路**：`joinResolve` 改输出 `/` 后，Windows 下含 `..`/相对路径的图片渲染、
   图片另存 assets/、localizeImages 全链路回归（Windows API 与 asset 协议都接受 `/`，
   理论兼容，实测为准）。
5. **序列化回归**：`node scripts/test-break-roundtrip.mjs` + `test-list-roundtrip.mjs`
   全 PASS（本轮未动序列化，预期零 diff）。
6. **桌面欢迎页样式**：新建按钮仍带边框（无边框样式限定在 `.empty-actions` 内）。

## 四、明确不同步（安卓独有，桌面无对应概念）

- MainActivity 全部（返回键桥 / Alt+数字拦截 / 安全区注入 / SAF 选择器 /
  所有文件权限引导 / 剪贴板桥 / Intent 路径解析）
- ☰ 应用菜单（appmenu.ts，移动端入口替代物；桌面有快捷键+右键+拖入）
- `set_window_effect` 移动端 no-op、多窗口开关隐藏、置顶按钮不注册
- `get_desktop_dir` 安卓返回公共 Documents、`sanitizePathInput` 伪路径前缀剥除
- `tauri.android.conf.json`、gen/android 工程、安卓图标资源
