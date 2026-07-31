// Oblet 自定义 ProseMirror 插件（Crepe 底座之上）
// 1. ==高亮==：装饰器方案 —— 文档保持 == 原文（序列化无损），渲染时隐藏标记、文字加高亮色
// 2. Callout：装饰器方案 —— > [!type] 引用块加 .callout 类与 data-callout 属性，
//    隐藏 [!type] 标记，注入图标 widget；AnuPpuccin 等主题的 callout 样式直接命中
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type { EditorState } from "@milkdown/prose/state";
import type { Node as PMNode } from "@milkdown/prose/model";

// ---------------------------------------------------------------- 装饰器插件工厂

/** 装饰器插件骨架：仅 doc 变更时全量重算装饰（选区变化直接复用）。
 *  全量重建 DecorationSet 是大文档打字卡顿的最大嫌疑，增量优化见打磨清单 5.2；
 *  目前文档规模下全量足够，先保持实现简单 */
function makeDecoratorPlugin(
  name: string,
  compute: (state: EditorState) => DecorationSet
) {
  const key = new PluginKey(name);
  return $prose(
    () =>
      new Plugin({
        key,
        props: {
          decorations(state) {
            return key.getState(state) as DecorationSet;
          },
        },
        state: {
          init(_, state) {
            return compute(state);
          },
          apply(tr, old, _o, newState) {
            if (!tr.docChanged) return old;
            return compute(newState);
          },
        },
      })
  );
}

// ---------------------------------------------------------------- ==高亮==

function highlightDecorations(state: EditorState): DecorationSet {
  const decos: Decoration[] = [];
  const re = /==([^=]+?)==/g;
  const CODE = "\u0001"; // 行内代码/原子内联节点在虚拟串里的占位符

  state.doc.descendants((node: PMNode, pos: number) => {
    if (!node.isTextblock) return true;

    // 拼接虚拟串：普通文本逐字进串；带 inlineCode 标记的文本与原子内联节点
    // 整体占一格 —— 代码内的 == 不参与配对（Ob 同款：代码里按原样渲染），
    // 但 ==`代码`== 允许跨代码配对，代码节点被包进高亮范围
    let vtext = "";
    const vpos: number[] = []; // 虚串下标 → 文档位置
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      const isCodeText =
        child.isText && child.marks.some((mk) => mk.type.name === "inlineCode");
      if (child.isText && !isCodeText && child.text) {
        for (let i = 0; i < child.text.length; i++) {
          vtext += child.text[i];
          vpos.push(start + i);
        }
      } else {
        vtext += CODE;
        vpos.push(start);
      }
    });

    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(vtext)) !== null) {
      const openStart = vpos[m.index];
      const openEnd = vpos[m.index + 1] + 1;
      const closeIdx = m.index + 2 + m[1].length;
      const closeStart = vpos[closeIdx];
      const closeEnd = vpos[closeIdx + 1] + 1;
      decos.push(
        Decoration.inline(openEnd, closeStart, { class: "ob-highlight" }),
        Decoration.inline(openStart, openEnd, { class: "ob-deco-hide" }),
        Decoration.inline(closeStart, closeEnd, { class: "ob-deco-hide" })
      );
    }

    return false; // 子节点已手动处理
  });

  return DecorationSet.create(state.doc, decos);
}

export const highlightPlugin = makeDecoratorPlugin(
  "oblet-highlight",
  highlightDecorations
);

// ---------------------------------------------------------------- Callout

// 常见 callout 类型的图标（简易内联 SVG，对齐 lucide 风格）
const ICONS: Record<string, string> = {
  note: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  info: "M12 8h.01M12 12v4M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  tip: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3Z",
  hint: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3Z",
  important:
    "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM12 7v4M12 13h.01",
  warning:
    "M12 8v5M12 16.5h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  caution:
    "M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688ZM12 8v4M12 14h.01",
  danger:
    "M12 8v5M12 16.5h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  question:
    "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  help: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  quote: "M7 7h4v6H7zM7 13c0 2 1 3 3 3M15 7h4v6h-4zM15 13c0 2 1 3 3 3",
  todo: "M9 11l3 3 8-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9",
  success: "M20 6 9 17l-5-5",
  check: "M20 6 9 17l-5-5",
  done: "M20 6 9 17l-5-5",
  failure: "M18 6 6 18M6 6l12 12",
  fail: "M18 6 6 18M6 6l12 12",
  bug: "M9 9l-3-3M15 9l3-3M9 15l-3 3M15 15l3 3M12 8a4 4 0 0 1 4 4v3a4 4 0 0 1-8 0v-3a4 4 0 0 1 4-4Z",
  example: "M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Zm0 0a2 2 0 0 0 2 2h13",
  abstract: "M4 6h16M4 12h16M4 18h10",
  summary: "M4 6h16M4 12h16M4 18h10",
  tldr: "M4 6h16M4 12h16M4 18h10",
  faq: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  attention:
    "M12 8v5M12 16.5h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  error:
    "M12 8v5M12 16.5h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  cite: "M7 7h4v6H7zM7 13c0 2 1 3 3 3M15 7h4v6h-4zM15 13c0 2 1 3 3 3",
  missing: "M18 6 6 18M6 6l12 12",
};

function calloutIconSvg(type: string): string {
  const path = ICONS[type] ?? ICONS.note;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
}

const CALLOUT_RE = /^\[!([a-zA-Z-]+)\][+-]?[ \t]?/;

function calloutDecorations(state: EditorState): DecorationSet {
  const decos: Decoration[] = [];

  state.doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== "blockquote") return true;
    const firstPara = node.firstChild;
    if (!firstPara || firstPara.type.name !== "paragraph") return false;

    const text = firstPara.textContent;
    const m = text.match(CALLOUT_RE);
    if (!m) return false;

    const type = m[1].toLowerCase();
    const paraPos = pos + 1; // paragraph 起点
    const markerStart = paraPos + 1; // paragraph 内容起点

    // 1. 引用块整体 → callout 类 + data-callout（主题样式命中）
    decos.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: "callout",
        "data-callout": type,
      })
    );

    // 2. 隐藏 [!type] 标记（其后标题文字保留可编辑）
    decos.push(
      Decoration.inline(markerStart, markerStart + m[0].length, {
        class: "ob-deco-hide",
      })
    );

    // 3. 标题范围 = 标记之后到本段第一个软换行（Ob 行为：首行即标题）
    const contentStart = paraPos + 1;
    const titleStart = markerStart + m[0].length;
    let titleEnd = contentStart + firstPara.content.size;
    let foundBreak = false;
    firstPara.forEach((child, childOffset) => {
      if (!foundBreak && child.type.name === "hardbreak") {
        titleEnd = contentStart + childOffset;
        foundBreak = true;
      }
    });
    const titleText = state.doc.textBetween(titleStart, titleEnd).trim();

    // 4. 标题栏 widget：图标（无自定义标题时追加类型名，对齐 Ob 回退行为）
    decos.push(
      Decoration.widget(
        markerStart,
        () => {
          const span = document.createElement("span");
          span.className = "callout-title";
          span.contentEditable = "false";
          span.innerHTML =
            `<span class="callout-icon">${calloutIconSvg(type)}</span>` +
            (titleText
              ? ""
              : `<span class="callout-title-inner">${type[0].toUpperCase()}${type.slice(1)}</span>`);
          return span;
        },
        { side: -1, ignoreSelection: true }
      )
    );

    // 5. 自定义标题文字上标题样式（保留可编辑，颜色随 callout 类型）
    if (titleText) {
      decos.push(
        Decoration.inline(titleStart, titleEnd, { class: "callout-title-text" })
      );
    }

    return false;
  });

  return DecorationSet.create(state.doc, decos);
}

export const calloutPlugin = makeDecoratorPlugin(
  "oblet-callout",
  calloutDecorations
);

// ---------------------------------------------------------------- 光标所在块淡底色（4.5 原型）

/** 原型评审机制：装饰常驻计算，显隐由 body.anp-current-line 一个类决定。
 *  决策=保留或移除该类（连本插件与 CSS 一起），不留中间态。
 *  与另两个装饰器不同：选区变化也要重算（光标移动即换块） */
function activeBlockDecorations(state: EditorState): DecorationSet {
  const { $from } = state.selection;
  if ($from.depth < 1) return DecorationSet.empty;
  const start = $from.before(1);
  const node = $from.node(1);
  return DecorationSet.create(state.doc, [
    Decoration.node(start, start + node.nodeSize, { class: "ob-active-block" }),
  ]);
}

const activeBlockKey = new PluginKey<DecorationSet>("oblet-active-block");

export const activeBlockPlugin = $prose(
  () =>
    new Plugin({
      key: activeBlockKey,
      props: {
        decorations(state) {
          return activeBlockKey.getState(state);
        },
      },
      state: {
        init(_, state) {
          return activeBlockDecorations(state);
        },
        apply(tr, old, _o, newState) {
          if (!tr.docChanged && !tr.selectionSet) return old;
          return activeBlockDecorations(newState);
        },
      },
    })
);

// ---- 代码块语言自由输入（1.4 批注落地）----
// Crepe 原版语言浮层的搜索框回车没有任何行为（只能从预设列表点选）。
// 捕获 Enter：以输入文本设置当前代码块语言——命中预设（按 name/alias 匹配）照常
// 懒加载高亮；自定义语言无高亮、按纯文本渲染，围栏序列化保留原文（与 Obsidian 一致）。
export const languageFreeInputPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("oblet-language-free-input"),
      view(view) {
        const onKeydown = (e: KeyboardEvent) => {
          if (e.key !== "Enter") return;
          const input = e.target;
          if (
            !(input instanceof HTMLInputElement) ||
            !input.classList.contains("search-input")
          ) {
            return;
          }
          const text = input.value.trim();
          if (!text) return;
          const blockDom = input.closest(".milkdown-code-block");
          if (!blockDom) return;
          e.preventDefault();
          e.stopPropagation();
          // 浮层挂在 NodeView dom 内：posAtDOM 反查文档位置，沿深度链找 code_block
          const pos = view.posAtDOM(blockDom, 0);
          const $pos = view.state.doc.resolve(pos);
          for (let d = $pos.depth; d >= 0; d--) {
            if ($pos.node(d).type.name !== "code_block") continue;
            view.dispatch(
              view.state.tr.setNodeAttribute($pos.before(d), "language", text)
            );
            break;
          }
          // 组件浮层由 window click 监听关闭（点击目标在 picker 外即收起），
          // 派一个落到 body 的 click 让它自然收起；焦点还给编辑器
          document.body.click();
          view.focus();
        };
        // capture 阶段：抢在组件与 PM 的 keydown 处理之前
        view.dom.addEventListener("keydown", onKeydown, true);
        return {
          destroy() {
            view.dom.removeEventListener("keydown", onKeydown, true);
          },
        };
      },
    })
);

// ---- 选区拖动移动（十一轮 #5）→（2026-08-01 回滚）----
// 需求源于"文字选中后无法拖动到其他位置，是禁止拖动的符号"。
// 根因：Tauri 的文件拖放（wry）在窗口上 RevokeDragDrop + 注册自家 IDropTarget，
// Chromium 的 OLE 拖动会话（页面内拖文字也走 OLE）被它接管，非文件载荷一律回
// DROPEFFECT_NONE——于是选区拖动只剩"禁止"光标。
// 曾实现鼠标事件自驱动版（git 历史可查），但发现与文件拖放冲突：禁止 dragstart
// 后外部文件拖入失效（被原生 OLE 会话吞掉，到不了 Tauri 的 IDropTarget）。
// 两功能在 OLE 层互斥，运行时无法动态切换（tauri 2.11 无 set_drag_drop_enabled）。
// 经权衡保留文件拖入（拖入换文件是核心交互），牺牲选区拖动移动。
// 后续：若 Tauri 暴露运行时拖放开关或改走 JS File API（如 webview2-com），可重开。
export const dragMovePlugin = $prose(() => new Plugin({ key: new PluginKey("oblet-drag-move") }));

export const obletPlugins = [
  highlightPlugin,
  calloutPlugin,
  activeBlockPlugin,
  languageFreeInputPlugin,
  dragMovePlugin,
];
