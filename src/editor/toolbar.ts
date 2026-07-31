// 快捷操作栏（bubble toolbar）增强：==高亮== 开关 + callout 包裹
// 经 Crepe Toolbar 的 buildToolbar 钩子挂进 function 组；
// 高亮不是 PM mark（文档存 == 原文），开关 = 选区两侧插入/删除 == 字符
import { editorViewCtx } from "@milkdown/core";
import { TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import type { Node as PMNode } from "@milkdown/prose/model";
import type { Ctx } from "@milkdown/ctx";

const highlightIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4Z"/></svg>`;
const calloutIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h4v6H7zM7 13c0 2 1 3 3 3M15 7h4v6h-4zM15 13c0 2 1 3 3 3"/></svg>`;

/** 选区是否已被 == 包裹 */
export function isWrapped(view: EditorView): boolean {
  const { from, to } = view.state.selection;
  if (from === to) return false;
  const doc = view.state.doc;
  const before = from >= 2 ? doc.textBetween(from - 2, from) : "";
  const after =
    to + 2 <= doc.content.size ? doc.textBetween(to, to + 2) : "";
  return before === "==" && after === "==";
}

/** ==高亮== 开关：已包裹则解包，未包裹则包上。直接文本插入/删除，序列化天然无损 */
export function toggleHighlight(view: EditorView) {
  const { from, to } = view.state.selection;
  if (from === to) return;
  const tr = view.state.tr;
  if (isWrapped(view)) {
    // 先删后面再删前面，前面的位置不受后面删除影响
    tr.delete(to, to + 2).delete(from - 2, from);
    tr.setSelection(TextSelection.create(tr.doc, from - 2, to - 2));
  } else {
    tr.insertText("==", to).insertText("==", from);
    tr.setSelection(TextSelection.create(tr.doc, from + 2, to + 2));
  }
  view.dispatch(tr.scrollIntoView());
}

/** 光标/选区所在的引用块语境（嵌套取最内层） */
export interface CalloutCtx {
  pos: number; // blockquote 起点
  node: PMNode;
  /** 小写类型；无 [!type] 标记的普通引用块为 null */
  type: string | null;
  markerLen: number; // 标记全文长度（含尾随空格）
}

const CALLOUT_MARKER_RE = /^\[!([a-zA-Z-]+)\][+-]?[ \t]?/;

export function calloutContext(view: EditorView): CalloutCtx | null {
  const $from = view.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name !== "blockquote") continue;
    let type: string | null = null;
    let markerLen = 0;
    const first = node.firstChild;
    if (first && first.type.name === "paragraph") {
      const m = first.textContent.match(CALLOUT_MARKER_RE);
      if (m) {
        type = m[1].toLowerCase();
        markerLen = m[0].length;
      }
    }
    return { pos: $from.before(d), node, type, markerLen };
  }
  return null;
}

/** 光标所在是否已在引用块内（工具栏 active 态指示） */
export function inBlockquote(view: EditorView): boolean {
  return calloutContext(view) !== null;
}

/** Callout 开关：
 *  - 不在引用块内 → 选区覆盖的顶层块包成 [!type] callout（光标态包当前块）
 *  - 已在同类型 callout 内 → 回退：删标记 + 解除引用包裹，恢复原样
 *  - 已在其他类型 callout 内 → 改写标记文本换类型；
 *    revertAnyType 时（工具栏按钮）不区分类型直接回退——用户批示：
 *    非 note callout 点按钮应直接回退，而不是先变 note 再回退
 *  - 普通引用块（无标记）→ 补标记升级为 callout */
export function toggleCallout(
  view: EditorView,
  type = "note",
  opts?: { revertAnyType?: boolean }
) {
  const ctx = calloutContext(view);
  const tr = view.state.tr;

  if (ctx) {
    const markerStart = ctx.pos + 2; // blockquote 首段内容起点
    if (ctx.type !== null) {
      if (opts?.revertAnyType || ctx.type === type) {
        // 回退：解除引用包裹，同时剥掉首段的 [!type] 标记
        const first = ctx.node.firstChild!;
        const newFirst = first.type.create(
          first.attrs,
          first.content.cut(ctx.markerLen),
          first.marks
        );
        const content = ctx.node.content.replaceChild(0, newFirst);
        view.dispatch(
          tr.replaceWith(ctx.pos, ctx.pos + ctx.node.nodeSize, content).scrollIntoView()
        );
      } else {
        // 换类型：标记文本整体替换为规范形 [!type]␣
        view.dispatch(
          tr
            .insertText(`[!${type}] `, markerStart, markerStart + ctx.markerLen)
            .scrollIntoView()
        );
      }
      return;
    }
    // 普通引用块：首子块是段落才能放标记（列表等无处可插，保持原样）
    if (ctx.node.firstChild?.type.name === "paragraph") {
      view.dispatch(tr.insertText(`[!${type}] `, markerStart).scrollIntoView());
    }
    return;
  }

  // 不在引用块内：包成新 callout
  const bq = view.state.schema.nodes.blockquote;
  if (!bq) return;
  const doc = view.state.doc;
  const { from, to } = view.state.selection;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const blockFrom = $from.depth >= 1 ? $from.before(1) : from;
  const blockTo = $to.depth >= 1 ? $to.after(1) : to;

  const slice = doc.slice(blockFrom, blockTo);
  const node = bq.create(null, slice.content);
  const tr2 = view.state.tr.replaceRangeWith(blockFrom, blockTo, node);
  // blockquote 起于 blockFrom；首子块在 +1，其内容起点在 +2
  if (node.firstChild && node.firstChild.type.name === "paragraph") {
    tr2.insertText(`[!${type}] `, blockFrom + 2);
  }
  view.dispatch(tr2.scrollIntoView());
}

interface ToolbarGroupBuilder {
  getGroup(key: string): {
    addItem(key: string, item: unknown): { addItem(key: string, item: unknown): unknown };
  };
}

/** Crepe.Feature.Toolbar 的 featureConfig：在原功能组追加两个按钮 */
export const toolbarConfig = {
  buildToolbar(builder: ToolbarGroupBuilder) {
    builder
      .getGroup("function")
      .addItem("oblet-highlight", {
        icon: highlightIcon,
        active: (ctx: Ctx) => {
          try {
            return isWrapped(ctx.get(editorViewCtx));
          } catch {
            return false;
          }
        },
        onRun: (ctx: Ctx) => toggleHighlight(ctx.get(editorViewCtx)),
      })
      .addItem("oblet-callout", {
        icon: calloutIcon,
        active: (ctx: Ctx) => {
          try {
            return inBlockquote(ctx.get(editorViewCtx));
          } catch {
            return false;
          }
        },
        onRun: (ctx: Ctx) =>
          toggleCallout(ctx.get(editorViewCtx), "note", { revertAnyType: true }),
      });
  },
};
