# Oblet 打磨清单（P1 阶段工作项）

> **状态：P1 阶段全部完成（2026-07-31，一至九轮）**——批次 1-6 全项 `[x]` 闭环；唯一悬项为 4.1 Acrylic 终审判（九轮包 alpha 200 实测，不达标则删方案）。后续打磨新项请另起清单或追加于打磨记录。

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
  三轮修订（2026-07-31，真根因）：**空代码块**（新建/删空内容）浮层空白，有内容的正常——自有 CSS `.milkdown-code-block { overflow: hidden }`（圆角裁剪）把 NodeView dom 内的浮层裁掉，空块高度不足以容纳 410px 列表。DOM 内 143 项一直在，只是像素被裁；此前验证全用 getBoundingClientRect 量布局尺寸故漏检。修法：`:has(.language-button[data-expanded="true"]) { overflow: visible }`，浮层展开才放开裁剪。判定方法固化为 `elementFromPoint` 像素级取样（repro-dist/repro-webview 均已加空块断言，真机 CDP 通过）。

- [x] **1.5 logo 低对比、不醒目**（小-中）✅ 2026-07-31
  方案：`scripts/brighten-icon.mjs` 后处理——晶体中调 gamma 0.65 提升 + 饱和 1.3，深色背景不动。
  验证：vision 评估 64px 下"亮主体+暗背景对比极佳，无过曝"；exe 内嵌图标与 32x32.png diff 0.00，平均色 rgb(25,23,43)→rgb(33,30,52)。
  已重跑 tauri icon + touch build.rs + 重打 exe + 重封 zip（2.7MB）。

- [x] **1.6 高亮复合渲染 bug**（P0 / 中）✅ 2026-07-31
  根因一（粗斜体失效）：PM 把装饰 span 包在 strong/em **内侧**，`.ob-highlight` 钉死的 `color: var(--text-normal)` 直接命中 span 压掉 mark 颜色。修复：删除该 color 声明，span 继承、mark 色透出。
  根因二（行内代码不兼容）：旧实现遇 inlineCode 断 run，`==`代码`==` 无法配对。重写为虚拟串方案——代码节点占一格（代码内 == 不配对，Ob 同款），跨代码允许配对并把代码节点包进高亮。
  验证：六场景离屏模拟配对区间全部正确；渲染效果使用者目测通过（批次 1 反馈，Ob 同款边角问题不再修）。

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

- [x] **3.1 底部留白**（小）✅ 2026-07-31（核对时发现前序已实现；九轮改固定值）
  `.markdown-rendered { padding: 24px 32px 40vh }` 已在基座中，末行可滚动到视口中部。
  九轮修订（2026-07-31）：40vh 随窗高线性膨胀（最大化近半屏），按批示改固定 **280px**（≈ 默认窗口下原观感，任何窗高一致）。

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
    验收使用者目测通过（批次 3 反馈 + 多轮回退/五色迭代后确认）。

- [x] **3.6 右键菜单**（中）✅ 2026-07-31
  `src/editor/contextmenu.ts`：复制/剪切/粘贴/全选 + 高亮 + Callout 类型子菜单（hover 展开、贴右缘自动左翻），替换浏览器系统菜单。
  二轮修订（2026-07-31）：菜单项"== 高亮"改名"高亮"。

- [x] **3.7 图片块样式实测**（中）✅ 2026-07-31 使用者实测通过（三类图源 + 样式观感"没问题"）
  已知：网络 URL 图片预览默认可用（CSP 已放行 https）。
  三轮接线（2026-07-31）：静态核查——CSP `img-src` 与 assetProtocol（scope `**`）早已就绪，缺口只在 Crepe 不转换本地路径。
  修复：`proxyDomURL` 官方钩子接通（块级+行内共用）——远程原样；本地绝对路径直接 `convertFileSrc`；相对路径相对当前 md 目录解析（`.`/`..` 归一化、盘符与 UNC 保护）；`%20` 等转义先 decode；DOM src 转换只影响渲染，文档原文不动。拖入换文件后闭包跟随新目录。
  使用者实测：三类图源（本地绝对/相对/网络）渲染与样式观感均通过（2026-07-31 九轮批示"图片样式没问题"）。

- [x] **3.8 callout 颜色与样式丰富**（中）✅ 2026-07-31（图标映射部分）
  图标映射补全 Ob 全部类型别名：新增 tldr/faq/attention/error/cite/missing（原 24 → 30 项）。
  主题命中：`Decoration.node` 在 blockquote 上设 `.callout` + `data-callout`，主题内 149 处 `data-callout` 选择器形状吻合；
  各类型配色与 `anp-callout-sleek` 等定制的实际观感使用者目测通过（2026-07-31）。

- [x] **3.9 Crepe 浮层组件主题化**（中）✅ 2026-07-31
  核查结论：颜色/字体早已全部经 `--crepe-*` 变量桥收口（obsidian-base.css 45-71 行），无需逐组件改色。
  落地：`--crepe-shadow-1/2` 加重为深色浮层投影（与 toast/检索条/右键菜单同语言）；斜杠菜单/工具栏/链接提示框/语言选择浮层统一补 `1px solid var(--ob-border)` 边框；斜杠菜单与语言浮层圆角 12px→8px 统一。
  实际观感使用者目测通过（2026-07-31 九轮批示，callout 样式与浮层观感均确认）。

- [x] **3.10 代码块自动换行开关**（小，设置项先挂简易入口）✅ 2026-07-31
  设置面板新增"编辑器"一节 + `code_block_wrap` 设置项（默认不换行）；`body.ob-code-wrap` + `.cm-line { white-space: pre-wrap }` 即时切换。
  发现：主题里的 `anp-codeblock-edit-nowrap` 在静态打包后无消费规则（目标 CM5 选择器在本编辑器不存在），属死类，未复用。
  二轮修订（2026-07-31）：实测未生效，根因——`.cm-scroller` 是 **flex 容器**且 `.cm-content flex-shrink: 0`，长行把内容盒按 max-content 撑宽，永远到不了换行宽度；对齐 CM6 官方 lineWrapping 做法，在 `.cm-content` 上补 `flex-shrink: 1 + white-space: break-spaces`。
  已知小限制：切换瞬间 CM 行高缓存在下一个渲染周期自愈；设置页完善（批次 4）后归位。

## 批次 4：设置体系（压轴，批示"最后一起做"）

- [x] **4.1 窗口透明度定制（毛玻璃）**（中）✅ 2026-07-31
  全链路落地：`window-vibrancy` 0.6 直接依赖 → 窗口建为 `transparent: true`（两处 WindowBuilder）→ 新命令 `set_window_effect`（mica/acrylic/关，关时双清）→ 设置项 `window_effect`（界面节下拉，默认关）→ `body.ob-vibrancy` + html 透明链路 CSS；跨窗口广播随排版事件。
  Acrylic tint 深色 (24,20,40,60) 贴近主题底色。默认关 = 默认路径与之前视觉一致（CSS 背景不透明）。
  **实机效果多轮迭代中**：Mica 按九轮批示回滚为系统材质原样；Acrylic alpha 已第四档 200，**终审判待九轮包实测——仍不达标则按预案删除 Acrylic 方案**。
  二轮修订（2026-07-31）：文档主体 `.milkdown` 透明化（原"两边透明中间紫黑"）；设置按钮半透明化；Acrylic tint alpha 60→150。
  三轮修订（2026-07-31）：Mica 罩 text 色 5% 薄纱调浅色调（系统不透明材质给不了"更透"）；Acrylic alpha 150→**179**（≈70% 不透明深灰目标）；浮层家族（搜索浮条/设置面板/toast/右键菜单）半透明 `rgba(ctp-base,0.72)` + `backdrop-filter: blur(24px)`；body 增 `ob-vibrancy-mica/acrylic` 子类区分叠加策略。
  四轮修订（2026-07-31）：按批示**回滚 Mica 薄纱**（系统材质原样透出，子类随之移除）；Acrylic alpha 179→**200**（78%）；浮层适配保留。Acrylic 仍不达标则按预案删除该方案。

- [x] **4.2 完善设置页面**（大）✅ 2026-07-31（随 4.1/4.4 收口）
  设置页现为统一四节信息架构：**排版**（字体/字号覆盖）、**编辑器**（代码块自动换行）、**界面**（起始页署名、窗口效果）、**快捷键**（4.4 键位列表）。
  视觉与通知/右键菜单同语言（--ob-\* 变量、8px 圆角、1px 边框、深色投影）。布局与滚动条外观使用者实测通过（六/七轮反馈修订后确认）。

- [x] **4.3 settings 默认值实体化**（小）✅ 2026-07-31
  首次运行 get\_settings 即落盘完整默认形（version:1 + editor 全字段，None 显式序列化为 null），与设计文档 §8 示例一致，文件自说明可手改。

- [x] **4.4 快捷键系统（可设置）**（大）✅ 2026-07-31
  `src/commands.ts`：命令注册表（id/title/defaultCombo/run）+ `comboOf` 规范化（e.code 物理键码，免疫输入法全角）+ window 捕获阶段统一派发器（命中即 preventDefault + stopPropagation）。
  三个散点处理器迁移为命令：save（Ctrl+S）、search（Ctrl+F）、settings（Ctrl+,）。
  覆盖存 `settings.json editor.keymap`（命令 id → 组合串），缓存随排版广播跨窗口同步。
  设置页快捷键节：点击组合键进入捕获模式（派发器静默，Esc 取消/纯修饰键续等），双击恢复默认。

- [x] **4.5 当前行高亮决策**（大，慎重）✅ 2026-07-31 **保留**（使用者观感评审通过）
  核查更正：body 上其实**没有** anp-current-line 类（清单原假设有误，主题内全是 CM5 死选择器）。
  原型：`activeBlockPlugin`（选区变化即重算，深度 1 顶层块 `ob-active-block` 装饰）+ 7% 不透明度 mauve 底色；显隐由 main.ts 挂上的 `body.anp-current-line` 一个类门控。

## 批次 5：性能保障（要有数字，不能靠感觉）

- [x] **5.1 建立性能基线**（P0 / 小）✅ 2026-07-31（自动化外部测量，口径见附录 A）
  夹具 `scripts/gen-perf-fixture.mjs`（真实感混合内容）；PowerShell 测量：窗口标题就绪时间 + CPU 安静时间（≈可编辑）+ 主进程/ WebView2 增量内存。
  结果：**冷启动（首进程）标题就绪 1059ms、CPU 安静 5.6s；热启动 \~180ms**。内存合计：空文档 472MB / 10万字 670MB（含 WebView2 共享运行时，增量口径有噪音）。数字已填附录 A。
- [x] **5.2 大文档实测**（P0 / 中）✅ 2026-07-31（自动部分）
  1MB 级（923KB / 40万字）夹具：打开到 CPU 安静 **4.5s**，内存合计 **\~1GB**（放大 \~1000 倍，PM 全量装饰 + CM 代码块是主要嫌疑）。
  打字跟手度/滚动帧率使用者手感复测通过（2026-07-31，"操作丝滑"）——装饰器增量预案搁置。
- [x] **5.3 多窗口内存审计**（P2 / 小）✅ 2026-07-31
  5 窗口各载 10 万字：合计 591MB，低于单窗口首测（WebView2 共享进程被复用）——无线性异常驻留迹象。增量口径噪音大，建议任务管理器目测复核。

## 批次 6：发布前最后一遍（P2 出口检查，备忘）

- [x] README.md：✅ 2026-07-31 初稿落地（简介/特性/下载使用/register-md.bat 说明/SmartScreen 说明/快捷键表/许可与致谢含 Buy Me a Coffee 链接）；截图已补 `docs/screenshot.png`（`scripts/capture-readme-shot.mjs` 实机 CDP 截屏：深色主题 + 属性栏 + callout + 代码高亮 + 任务列表，vision 检查全元素渲染正常）。
- [x] LICENSE 与第三方许可归置：✅ 2026-07-31 `scripts/collect-licenses.mjs` 自动收集生产依赖闭包 217 份 + 手工补齐 4 份（@tauri-apps/api 双许可、remark-math、format、AnuPpuccin GPL-3.0 原文 + NOTICE 署名 + Oblet MIT），共 221 份入 zip `licenses/`。
  ⚠️ **遗留决策**：根 LICENSE 为 MIT，但静态打包的 AnuPpuccin 衍生 CSS 是 GPL-3.0——发行二进制按 GPL-3.0 义务归置了许可文本，根 LICENSE 是否改为 GPL-3.0 由使用者定夺。
- [x] 版本号与关于信息：exe 文件属性经 tauri.conf.json 补齐 ✅ 2026-07-31（publisher/copyright/description 已嵌入 winres，中文经 UTF-8 落盘验证无损）；窗口标题格式（随 1.1 定稿）。
- [x] GitHub Actions：✅ 2026-07-31 `.github/workflows/release.yml`（tag v\* 触发 → windows-latest 构建 `--no-bundle` → 组 zip → softprops/action-gh-release 上传）。未实际触发过，首个 tag 时验证。
  备注：本机 WiX light.exe 环境问题导致 msi 打包失败（已用 ASCII 元数据对照实验排除中文因素）；发行物为绿色 zip，不受影响，构建统一走 `--no-bundle`。
- [x] zip 出口审计：✅ 2026-07-31 `scripts/audit-zip.mjs`——zip 内 exe 与构建产物 MD5 一致（九轮）、licenses 222 份齐全、register/unregister bat 在位。

---

## 七、已验证无需改动（批示归档）

| 项                        | 批示                 |
| ------------------------ | ------------------ |
| 列表编辑手感（Enter/Tab/嵌套/任务项） | 全部验证通过，默认已支持，不用改   |
| 表格编辑手感                   | Crepe 默认做得非常完善，不用改 |
| 选区颜色 / 虚拟光标 / 输入法候选框     | 目测都没问题             |
| watcher 外部删除/重建边缘情况      | 无意测试过，好像可以         |

## 八、已决策不做 / 搁置

| 项           | 决策 | 理由                                               |
| ----------- | -- | ------------------------------------------------ |
| 回车行为双模式开关   | 不做 | 两种行为在 Ob 中没有可视区别                                 |
| 可读行宽限宽 + 居中 | 不做 | 保持现状                                             |
| 打开文件恢复滚动位置  | 搁置 | 这块 bug 较多，暂缓                                     |
| 2.1 拖拽卡死悬案  | 搁置 | 使用者复测：小概率触发、原因不明（2026-07-31）；再发时收集主进程/webview 状态 |

---

## 附录 A：性能基线（待填）

| 指标           | 数值                                         | 测量日期       | 备注                                 |
| ------------ | ------------------------------------------ | ---------- | ---------------------------------- |
| 冷启动到可编辑      | 冷 1059ms / 热 \~180ms（标题就绪）；冷启动 CPU 安静 5.6s | 2026-07-31 | 空文档；外部测量（窗口标题 + CPU 安静口径）          |
| 内存（空文档）      | 合计 \~472MB（主进程 84 + WV 388）                | 2026-07-31 | WebView2 增量口径，含共享运行时，有噪音           |
| 内存（10 万字）    | 合计 \~670MB（主进程 82 + WV 588）                | 2026-07-31 | 同上                                 |
| 内存（1MB 级）    | 合计 \~1006MB（主进程 82 + WV 924）               | 2026-07-31 | 5.2 夹具（923KB/40万字）；打开到 CPU 安静 4.5s |
| 内存（5窗口×10万字） | 合计 \~591MB                                 | 2026-07-31 | 单进程多窗口，WV 共享复用，无线性驻留               |
| zip 体积       | 4.57MB                                     | 2026-07-31 | 八轮后重封（含 licenses/ 与空代码块浮层修复、毛玻璃三轮） |
| exe 体积       | 10.9MB                                     | 2026-07-31 | 批次 4 后重打（含 window-vibrancy）        |

