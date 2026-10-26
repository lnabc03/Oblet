import { minimalSetup } from "codemirror";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  closeSearchPanel,
  highlightSelectionMatches,
  openSearchPanel,
  searchKeymap,
} from "@codemirror/search";

/** TXT 使用 CodeMirror 字符偏移，不与 ProseMirror 位置互相解释。 */
export interface PlainTextSelection {
  from: number;
  to: number;
  scrollTop: number;
}

export interface PlainTextEditor {
  /** CodeMirror 根元素，已挂载到传入的 host。 */
  readonly dom: HTMLElement;
  getContent(): string;
  /** 程序化替换不触发 onUserEdit，并重置撤销历史。 */
  replaceContent(content: string): void;
  /** 菜单触发的真实编辑：替换当前选区、进入历史并触发 onUserEdit。 */
  insertText(text: string): void;
  setReadonly(readonly: boolean): void;
  getSelection(): PlainTextSelection;
  /** 支持适配层传入部分状态；越界偏移会收敛到当前文档范围。 */
  restoreSelection(selection: Partial<PlainTextSelection>): void;
  selectAll(): void;
  focus(): void;
  /** Android 应用菜单入口，与 Ctrl+F 使用同一个 CM 搜索面板。 */
  openSearch(): void;
  closeSearch(): void;
  destroy(): void;
}

function clampOffset(value: number, docLength: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(docLength, Math.max(0, Math.trunc(value)));
}

/**
 * 创建独立 TXT 编辑器。文档值始终是纯文本，不安装 Markdown 语言或序列化器。
 * onUserEdit 只由未被 replaceContent 接管的文档变更触发，选区和搜索操作不触发。
 */
export function createPlainTextEditor(
  host: HTMLElement,
  initialContent: string,
  initialReadonly = false,
  onUserEdit?: () => void,
): PlainTextEditor {
  const readonlyConfig = new Compartment();
  const hadHostClass = host.classList.contains("ob-plaintext-host");
  host.classList.add("ob-plaintext-host");

  let readonly = initialReadonly;
  let replacing = false;
  let destroyed = false;

  const baseExtensions: Extension[] = [
    // 搜索键先于默认键表；minimalSetup 提供纯文本默认键、历史记录和选区绘制。
    keymap.of([...searchKeymap]),
    minimalSetup,
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    EditorView.editorAttributes.of({ class: "ob-plaintext-editor" }),
    EditorView.contentAttributes.of({
      "aria-label": "TXT 纯文本编辑器",
      inputmode: "text",
    }),
    // editable=false 只约束 DOM，本过滤器同时阻断命令或直接事务造成的变更。
    EditorState.transactionFilter.of((tr) => {
      if (!readonly || !tr.docChanged) return tr;
      return [];
    }),
    EditorView.updateListener.of((update) => {
      if (destroyed || replacing || !update.docChanged) return;
      // replaceContent 经 setState 重建文档，update.transactions 为空。
      // 普通 CM 输入、粘贴、撤销和重做均带有文档变更事务，只通知一次。
      if (update.transactions.some((tr) => tr.docChanged)) onUserEdit?.();
    }),
  ];

  const createState = (content: string): EditorState =>
    EditorState.create({
      doc: content,
      extensions: [
        readonlyConfig.of([
          EditorState.readOnly.of(readonly),
          EditorView.editable.of(!readonly),
        ]),
        ...baseExtensions,
      ],
    });

  const view = new EditorView({
    state: createState(initialContent),
    parent: host,
  });

  // 在 Markdown 宿主中让既有容器负责滚动；独立宿主则使用 CM 的 scrollDOM。
  const scrollElement = (): HTMLElement =>
    host.closest<HTMLElement>(".markdown-rendered") ?? view.scrollDOM;

  const getSelection = (): PlainTextSelection => {
    const main = view.state.selection.main;
    return {
      from: main.from,
      to: main.to,
      scrollTop: scrollElement().scrollTop,
    };
  };

  const restoreSelection = (selection: Partial<PlainTextSelection>): void => {
    if (destroyed) return;
    const docLength = view.state.doc.length;

    if (selection.from !== undefined || selection.to !== undefined) {
      const from = clampOffset(selection.from ?? selection.to!, docLength);
      const to = clampOffset(selection.to ?? selection.from!, docLength);
      view.dispatch({ selection: { anchor: from, head: to } });
    }

    if (selection.scrollTop !== undefined && Number.isFinite(selection.scrollTop)) {
      scrollElement().scrollTop = Math.max(0, selection.scrollTop);
    }
  };

  const replaceContent = (content: string): void => {
    if (destroyed || content === view.state.doc.toString()) return;
    const previous = getSelection();

    replacing = true;
    try {
      // 新文档不继承旧历史的字符偏移，避免外部重载后撤销回另一份内容。
      // 当前只读值由 createState 保留，随后恢复仍有效的选区与滚动位置。
      view.setState(createState(content));
    } finally {
      replacing = false;
    }
    restoreSelection(previous);
  };

  const setReadonly = (next: boolean): void => {
    if (destroyed || readonly === next) return;
    readonly = next;
    view.dispatch({
      effects: readonlyConfig.reconfigure([
        EditorState.readOnly.of(next),
        EditorView.editable.of(!next),
      ]),
    });
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    view.destroy();
    if (!hadHostClass) host.classList.remove("ob-plaintext-host");
  };

  return {
    dom: view.dom,
    getContent: () => view.state.doc.toString(),
    replaceContent,
    insertText: (text: string) => {
      if (destroyed || readonly) return;
      view.dispatch(view.state.replaceSelection(text), {
        userEvent: "input",
        scrollIntoView: true,
      });
    },
    setReadonly,
    getSelection,
    restoreSelection,
    selectAll: () => {
      if (!destroyed) {
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      }
    },
    focus: () => {
      if (!destroyed) view.focus();
    },
    openSearch: () => {
      if (!destroyed) openSearchPanel(view);
    },
    closeSearch: () => {
      if (!destroyed) closeSearchPanel(view);
    },
    destroy,
  };
}
