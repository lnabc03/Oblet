import type { Crepe } from "@milkdown/crepe";
import { replaceAll } from "@milkdown/utils";
import { TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import type { EditorAdapter, EditorSelectionState } from "./adapter";

/** Crepe/ProseMirror 适配：位置换算与滚动实现只留在 Markdown 侧。 */
export function createMarkdownAdapter(
  crepe: Crepe,
  view: EditorView,
  scroller: HTMLElement,
): EditorAdapter {
  return {
    kind: "markdown",
    getContent: () => crepe.getMarkdown(),
    replaceContent(content) {
      crepe.editor.action(replaceAll(content));
    },
    setReadonly(readonly) {
      crepe.setReadonly(readonly);
    },
    getSelection() {
      return {
        from: view.state.selection.from,
        to: view.state.selection.to,
        scrollTop: scroller.scrollTop,
      };
    },
    restoreSelection(state: EditorSelectionState) {
      const doc = view.state.doc;
      const from = Math.min(Math.max(state.from ?? 1, 0), doc.content.size);
      const to = Math.min(Math.max(state.to ?? from, 0), doc.content.size);
      scroller.scrollTop = 0;
      void scroller.offsetHeight;
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(doc, from, to))
          .scrollIntoView(),
      );
      if (state.from == null && state.scrollTop != null) {
        scroller.scrollTop = state.scrollTop;
      }
    },
    focus() {
      view.focus();
    },
  };
}
