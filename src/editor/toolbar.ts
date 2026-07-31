// 快捷操作栏（bubble toolbar）增强：==高亮== 开关 + callout 包裹
// 经 Crepe Toolbar 的 buildToolbar 钩子挂进 function 组；
// 高亮不是 PM mark（文档存 == 原文），开关 = 选区两侧插入/删除 == 字符
import { editorViewCtx } from "@milkdown/core";
import { TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
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

/** 光标所在是否已在引用块内（嵌套 callout 无意义，此时按钮只作状态指示） */
export function inBlockquote(view: EditorView): boolean {
  const $from = view.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "blockquote") return true;
  }
  return false;
}

/** 把选区覆盖的顶层块包成 callout：包 blockquote + 首段前插 [!note]（类型文字后续可直接改）。
 *  光标态（无选区）包当前块；首子节点不是段落时（如列表）只包引用块、不插标记 */
export function wrapCallout(view: EditorView) {
  if (inBlockquote(view)) return;
  const bq = view.state.schema.nodes.blockquote;
  if (!bq) return;  const doc = view.state.doc;
  const { from, to } = view.state.selection;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const blockFrom = $from.depth >= 1 ? $from.before(1) : from;
  const blockTo = $to.depth >= 1 ? $to.after(1) : to;

  const slice = doc.slice(blockFrom, blockTo);
  const node = bq.create(null, slice.content);
  const tr = view.state.tr.replaceRangeWith(blockFrom, blockTo, node);
  // blockquote 起于 blockFrom；首子块在 +1，其内容起点在 +2
  const firstChild = node.firstChild;
  if (firstChild && firstChild.type.name === "paragraph") {
    tr.insertText("[!note] ", blockFrom + 2);
  }
  view.dispatch(tr.scrollIntoView());
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
        onRun: (ctx: Ctx) => wrapCallout(ctx.get(editorViewCtx)),
      });
  },
};
