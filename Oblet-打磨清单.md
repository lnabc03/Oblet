# Oblet 打磨清单（P1 阶段工作项）

> 定位回顾：轻量、快速、基于 Obsidian 和 AnuPpuccin 深度定制的独立 Markdown 编辑器。
> 本清单只做三件事——**修复已知问题、打磨操作体验、保障性能**，不引入新功能方向、不增加架构重量。
> 每条标注：优先级（P0 影响日常使用 / P1 明显可感 / P2 锦上添花）、工作量（小=半天内 / 中=一两天 / 大=需专题）。
>
> **排期原则（使用者批示）**：修复顺序从简单到复杂，先前端后后端，先修已知 bug 再加新增。
>
> v1.1（2026-07-31）：按批示重整——已验证项归档（§七）、否决项记录决策（§八）；视觉打磨以自我观感为准。
> v1.2（2026-07-31）：并入新一批已知 bug 与改进方向（属性栏光标、起始页设置不生效、斜杠菜单、标题顺序、logo 对比度、毛玻璃），全清单按排期原则重排为六个批次。

---

## 批次 1：已知 bug 速修（前端为主，小工作量，逐条闭环）

- [x] **1.1 窗口标题顺序**（小）✅ 2026-07-31
  ~~现状：标题为 `文件名 - Oblet`，使用者要求调整为 `Oblet - 文件名`（左上角先见品牌）。~~
  已改：`lib.rs` 建窗标题 + `commands.rs set_window_file` 两处格式串，cargo check 通过。

- [x] **1.2 属性栏光标问题**（小-中）✅ 2026-07-31
  现象（使用者确认）：光标在属性栏单元格内不显示，但编辑正常。
  根因：prosemirror-virtual-cursor 给 `.ProseMirror` 设 `caret-color: transparent`，该属性可继承，属性栏原生 input 被一并隐藏。
  修复：obsidian-base.css 在 `.ob-frontmatter input` 作用域恢复 `caret-color: var(--ob-text)`。
  二轮修订（2026-07-31）：键名/值两列点击高亮框宽度不一（键名列 input 自适应、值列全占满）→ 删去键名输入框 `width:auto` 特例，两列统一填满单元格。

- [x] **1.3 设置在起始页不生效**（小）✅ 2026-07-31
  根因：`boot()` 先 `initSettingsUI(app)`（浮层挂进 #app），无文件分支随后 `app.innerHTML = …` 把浮层抹掉；按钮幸存但切换的是脱离文档的节点。
  修复：起始页改用 createElement + appendChild，不动既有子树。
  二轮修订（2026-07-31）：Ctrl+, 快捷键不生效 → 监听器改 **capture 阶段 + 物理键码 `e.code === "Comma"`**（中文输入法下 `e.key` 可能是全角"，"，CM/PM 内部编辑器可能 stopPropagation 阻断冒泡监听）。

- [x] **1.4 斜杠菜单删减**（小）✅ 2026-07-31
  使用者批示删减：Quote / Divider / H4-H6 / Image / Math。
  实现：Crepe BlockEdit featureConfig 项置 `null`（官方机制），语法本身不受影响（\$\$ 围栏、#### 标题仍可用）。
  保留：Text、H1-H3、三种列表、Code、Table。
  二轮修订（2026-07-31）：代码块语言选择弹出空白——Crepe 不传 `languages` 时以**空数组**覆盖组件默认配置。修复：显式传入 `@codemirror/language-data` 全量预设（升为直接依赖，高亮按需懒加载）；预设外的自定义语言可在标记文本上直接改。

- [x] **1.5 logo 低对比、不醒目**（小-中）✅ 2026-07-31
  方案：`scripts/brighten-icon.mjs` 后处理——晶体中调 gamma 0.65 提升 + 饱和 1.3，深色背景不动。
  验证：vision 评估 64px 下"亮主体+暗背景对比极佳，无过曝"；exe 内嵌图标与 32x32.png diff 0.00，平均色 rgb(25,23,43)→rgb(33,30,52)。
  已重跑 tauri icon + touch build.rs + 重打 exe + 重封 zip（2.7MB）。

- [x] **1.6 高亮复合渲染 bug**（P0 / 中）✅ 2026-07-31
  根因一（粗斜体失效）：PM 把装饰 span 包在 strong/em **内侧**，`.ob-highlight` 钉死的 `color: var(--text-normal)` 直接命中 span 压掉 mark 颜色。修复：删除该 color 声明，span 继承、mark 色透出。
  根因二（行内代码不兼容）：旧实现遇 inlineCode 断 run，`==`代码`==` 无法配对。重写为虚拟串方案——代码节点占一格（代码内 == 不配对，Ob 同款），跨代码允许配对并把代码节点包进高亮。
  验证：六场景离屏模拟配对区间全部正确；渲染效果待使用者目测。

## 批次 2：复杂问题与代码治理（后端/诊断/大项）

- [x] **2.1 dev 模式拖拽新 md 卡死悬案**（P0 / 待定）✅ 2026-07-31 结案（搁置）
  线索：dev 模式热修复后拖拽新 md 渲染有概率直接卡死，已发生数起。
  使用者复测结论：release 版小概率触发、具体原因不明，**暂降级搁置**（移入 §八），再发时收集主进程/webview 状态。

- [x] **2.2 渲染逻辑系统性梳理（"屎山"治理）**（P0 / 大）✅ 2026-07-31（首轮）
  结论：自有代码仅 \~800 行（frontmatter 331 / setup 260 / plugins 200+），魔改比预想收敛。
  - frontmatter.ts：8 处兜底机制**全部已有注释固化**（InitReady 时序、relatedTarget 跳提交、pendingFocus 延迟聚焦、currentNode 取新鲜节点防过时 nodeSize、stopEvent 全拦截防 NodeSelection 吞节点、join 容忍字符串 spread、任务项空格解析侧修剪、disableEmptyLineBr）。
  - plugins.ts：高亮/callout 两插件骨架完全重复 → 提取 `makeDecoratorPlugin` 工厂收口；装饰计算注释齐全。
  - setup.ts：userEditTracker（appendedTransaction 过滤）、suppressSave、lastContent 归一化比较均有注释；showTip 为临时实现，待 3.4 通知系统统一收口。
  - 无可删死代码（主题层 v2.0 已删）；回归测试 8 项全过。
    遗留观察项（不阻塞）：装饰器全量重算是大文档性能嫌疑（见 5.2）；payload 可变捕获模式在 3.4/3.6 落地时顺带收敛。

## 批次 3：体验与视觉增强（新增，小→中排序）

- [x] **3.1 底部留白**（小）✅ 2026-07-31（核对时发现前序已实现）
  `.markdown-rendered { padding: 24px 32px 40vh }` 已在基座中，末行可滚动到视口中部。

- [x] **3.2 起始页设计**（小）✅ 2026-07-31
  居中排版：logo（`src/assets/logo.png`，提亮版 256px 打包进前端，mauve 光晕 drop-shadow）+ 标题 Oblet + 操作提示 + 署名 **弋鹓 | lnabc03**。样式全走 --ob-\* 变量。
  顺带补齐 `src/vite-env.d.ts`（vite/client 类型，图片 import 不再报 TS2307）。
  二轮修订（2026-07-31）：删去快捷键提示文案；新增设置项 `show_author`（界面节"起始页显示署名"，默认显示）可隐藏署名。

- [x] **3.3 检索与替换**（P0 / 中）✅ 2026-07-31（检索+替换全部落地）
  已实现（`src/editor/search.ts`）：Ctrl+F 浮条（设置浮层同款视觉语言）；装饰器高亮命中（文档不动）；Enter/Shift+Enter 与 ↑↓ 按钮循环跳转、选区落到命中并滚动居中；Esc/✕ 关闭；命中计数 `n/m` / 无结果；打开时预填当前选区文本；大小写不敏感。
  设计决策：编辑器内 Enter **不**劫持（对齐 Ob，照常换行），跳转只在浮条输入框处理。
  二轮修订（2026-07-31）：浮条聚焦时再按 Ctrl+F 会漏出 webview 默认检索——Ctrl+F 改到 window **capture 阶段**统一拦截（已开则聚焦回输入框），PM handleKeyDown 不再处理。
  替换（2026-07-31 三轮落地）：浮条第二行替换输入框 + 替换/全部按钮；走正常 PM 事务（自动保存接管），命中永不跨块故纯文本替换安全；"全部"从后往前后单事务（一次撤销整体回退）；替换当前后原下标自然指向下一个命中；只读/无命中禁用按钮。

- [x] **3.4 统一通知系统**（中）✅ 2026-07-31
  `src/notify.ts`：info/warn/error 三级 toast，顶部居中、滑入滑出动画、点击即关、分级别自动消失（4/6/9s）。
  迁移：外部变更提示、外部删除提示、拖入换文件保存失败提示全部走 notify；**保存失败原来只 console.error，现在用户可见（error 级）**。
  只读横幅是持久状态指示，保留原横幅形态；`.external-change-tip` 死样式已清除。

- [x] **3.5 快捷操作栏增强**（中）✅ 2026-07-31
  `src/editor/toolbar.ts` 经 Crepe Toolbar `buildToolbar` 钩子在 function 组追加两按钮：
  - **高亮开关**：选区两侧插入/删除 `==` 字符（高亮非 PM mark，文本级开关，序列化天然无损）；active 态检测选区是否已被 `==` 包裹。
  - **callout 包裹**：选区覆盖的顶层块包成 blockquote 并首段前插 `[!note] `；已在引用块内时不嵌套（active 态指示）；首子块非段落（列表等）只包引用不插标记。
  二轮修订（2026-07-31）：`wrapCallout` 升级为 `toggleCallout(view, type)`——同类型再按**回退原样**（删标记 + 解除引用包裹）、异类型改写标记、普通引用块补标记；右键菜单新增 Callout 类型子菜单（Note/Tip/Important/Warning/Caution）。
  验收待目测：选中文本 → 工具栏出现两按钮；序列化为 `==文本==`、`> [!note] 文本`。

- [x] **3.6 右键菜单**（中）✅ 2026-07-31
  `src/editor/contextmenu.ts`：复制/剪切/粘贴/全选 + 高亮 + Callout 类型子菜单（hover 展开、贴右缘自动左翻），替换浏览器系统菜单。
  二轮修订（2026-07-31）：菜单项"== 高亮"改名"高亮"。

- [ ] **3.7 图片块样式实测**（中）◐ 2026-07-31 图源链路已接通，样式实测待续
  已知：网络 URL 图片预览默认可用（CSP 已放行 https）。
  三轮接线（2026-07-31）：静态核查——CSP `img-src` 与 assetProtocol（scope `**`）早已就绪，缺口只在 Crepe 不转换本地路径。
  修复：`proxyDomURL` 官方钩子接通（块级+行内共用）——远程原样；本地绝对路径直接 `convertFileSrc`；相对路径相对当前 md 目录解析（`.`/`..` 归一化、盘符与 UNC 保护）；`%20` 等转义先 decode；DOM src 转换只影响渲染，文档原文不动。拖入换文件后闭包跟随新目录。
  待使用者实测：本地绝对路径/相对路径/网络 URL 三类图源渲染，圆角/边框/失败占位/caption 样式观感。

- [x] **3.8 callout 颜色与样式丰富**（中）✅ 2026-07-31（图标映射部分）
  图标映射补全 Ob 全部类型别名：新增 tldr/faq/attention/error/cite/missing（原 24 → 30 项）。
  主题命中：`Decoration.node` 在 blockquote 上设 `.callout` + `data-callout`，主题内 149 处 `data-callout` 选择器形状吻合；
  各类型配色与 `anp-callout-sleek` 等定制的实际观感待使用者目测，不命中的再手工桥接。

- [x] **3.9 Crepe 浮层组件主题化**（中）✅ 2026-07-31
  核查结论：颜色/字体早已全部经 `--crepe-*` 变量桥收口（obsidian-base.css 45-71 行），无需逐组件改色。
  落地：`--crepe-shadow-1/2` 加重为深色浮层投影（与 toast/检索条/右键菜单同语言）；斜杠菜单/工具栏/链接提示框/语言选择浮层统一补 `1px solid var(--ob-border)` 边框；斜杠菜单与语言浮层圆角 12px→8px 统一。
  实际观感待使用者目测微调。

- [x] **3.10 代码块自动换行开关**（小，设置项先挂简易入口）✅ 2026-07-31
  设置面板新增"编辑器"一节 + `code_block_wrap` 设置项（默认不换行）；`body.ob-code-wrap` + `.cm-line { white-space: pre-wrap }` 即时切换。
  发现：主题里的 `anp-codeblock-edit-nowrap` 在静态打包后无消费规则（目标 CM5 选择器在本编辑器不存在），属死类，未复用。
  二轮修订（2026-07-31）：实测未生效，根因——`.cm-scroller` 是 **flex 容器**且 `.cm-content flex-shrink: 0`，长行把内容盒按 max-content 撑宽，永远到不了换行宽度；对齐 CM6 官方 lineWrapping 做法，在 `.cm-content` 上补 `flex-shrink: 1 + white-space: break-spaces`。
  已知小限制：切换瞬间 CM 行高缓存在下一个渲染周期自愈；设置页完善（批次 4）后归位。

## 批次 4：设置体系（压轴，批示"最后一起做"）

- [ ] **4.1 窗口透明度定制（毛玻璃）**（中）
  窗口整体透明度 + 毛玻璃效果（Mica/Acrylic）。
  接线现状（2026-07-31 核实）：`window-vibrancy` **不是直接依赖**（构建日志里的 Compiling 记录来自 tauri 依赖树）；tauri.conf 无 transparent，lib.rs 无效果调用，CSS 无透明链路——全部待做。
  待做清单：Cargo.toml 加 window-vibrancy → tauri.conf 窗口 `transparent: true` → lib.rs 建窗后应用效果 → html/body/#app 背景透明链路 → 设置项（关/Mica/Acrylic + 透明度滑杆）随 4.2 设置页落地。

- [ ] **4.2 完善设置页面**（大）
  汇总所有已落地设置项统一设计：排版覆盖、代码块换行、透明度（4.1）、快捷键（4.4）……信息架构分组，视觉与通知系统/右键菜单同语言。

- [x] **4.3 settings 默认值实体化**（小）✅ 2026-07-31
  首次运行 get\_settings 即落盘完整默认形（version:1 + editor 全字段，None 显式序列化为 null），与设计文档 §8 示例一致，文件自说明可手改。

- [ ] **4.4 快捷键系统（可设置）**（大）
  命令注册表 + settings.json 键位覆盖 + 设置页键位编辑 UI。不依赖 vault/hotkeys.json（设计文档已定）。

- [ ] **4.5 当前行高亮决策**（大，慎重）
  body 上挂着 `anp-current-line` 类但 PM 无"行"概念，该定制永不生效。
  决策点：做"光标所在块淡底色"原型 → 自我观感评审 → 保留或移除 body 上的类，二选一，不留中间态。

## 批次 5：性能保障（要有数字，不能靠感觉）

- [ ] **5.1 建立性能基线**（P0 / 小）
  冷启动到可编辑耗时、release 内存（空文档 / 10 万字文档）、安装包体积，填入附录 A。每次大改后复测对比。
- [ ] **5.2 大文档实测**（P0 / 中）
  造 1MB 级真实感 md，实测打开耗时、打字跟手度、滚动帧率、自动保存耗时。
  瓶颈预案（按需启用，不提前优化）：装饰器插件改增量计算（全文档重建 DecorationSet 是打字卡顿最大嫌疑）；`getMarkdown()` 全量序列化耗时测量。
- [ ] **5.3 多窗口内存审计**（P2 / 小）
  5 窗口各载中等文档，总内存是否线性增长、有无异常驻留。

## 批次 6：发布前最后一遍（P2 出口检查，备忘）

- [ ] README.md：简介、截图（深色主题 + 属性栏 + callout）、下载使用、register-md.bat 说明、AnuPpuccin attribution + Buy Me a Coffee 链接（GPL-3.0 义务）、SmartScreen 说明。
- [ ] LICENSE 与第三方许可归置：AnuPpuccin GPL-3.0、KaTeX/Milkdown 等依赖许可打包进 zip（`licenses/` 目录）。
- [ ] 版本号与关于信息：exe 文件属性经 tauri.conf.json 补齐；窗口标题格式（随 1.1 定稿）。
- [ ] GitHub Actions：tag 触发 Windows 构建 + 自动上传 zip 到 Release。

---

## 七、已验证无需改动（批示归档）

| 项                        | 批示                 |
| ------------------------ | ------------------ |
| 列表编辑手感（Enter/Tab/嵌套/任务项） | 全部验证通过，默认已支持，不用改   |
| 表格编辑手感                   | Crepe 默认做得非常完善，不用改 |
| 选区颜色 / 虚拟光标 / 输入法候选框     | 目测都没问题             |
| watcher 外部删除/重建边缘情况      | 无意测试过，好像可以         |

## 八、已决策不做 / 搁置

| 项           | 决策 | 理由               |
| ----------- | -- | ---------------- |
| 回车行为双模式开关   | 不做 | 两种行为在 Ob 中没有可视区别 |
| 可读行宽限宽 + 居中 | 不做 | 保持现状             |
| 打开文件恢复滚动位置  | 搁置 | 这块 bug 较多，暂缓     |
| 2.1 拖拽卡死悬案 | 搁置 | 使用者复测：小概率触发、原因不明（2026-07-31）；再发时收集主进程/webview 状态 |

---

## 附录 A：性能基线（待填）

| 指标        | 数值     | 测量日期       | 备注                  |
| --------- | ------ | ---------- | ------------------- |
| 冷启动到可编辑   |        |            |                     |
| 内存（空文档）   |        |            |                     |
| 内存（10 万字） |        |            |                     |
| zip 体积    | 2.7MB  | 2026-07-31 | 提亮图标后重封（含批次 1 全部修复） |
| exe 体积    | 10.8MB | 2026-07-31 | 含新图标                |

