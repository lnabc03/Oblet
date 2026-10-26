import { minimalSetup } from "codemirror";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  ViewPlugin,
} from "@codemirror/view";
import { obletCmTheme } from "./cm-theme";
import { createSearchBar, type SearchBar } from "./search-bar";

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
  closeSearch(focusEditor?: boolean): void;
  isSearchOpen(): boolean;
  destroy(): void;
}

interface TextSearchMatch {
  from: number;
  to: number;
}

interface TextSearchState {
  open: boolean;
  query: string;
  active: number;
  matches: TextSearchMatch[];
}

const CLOSED_TEXT_SEARCH: TextSearchState = {
  open: false,
  query: "",
  active: -1,
  matches: [],
};

const setTextSearch = StateEffect.define<TextSearchState | null>();

/** 与 Markdown 检索同一口径：大小写不敏感、不允许重叠命中。 */
function findTextMatches(text: string, query: string): TextSearchMatch[] {
  if (!query) return [];
  // toLowerCase 可能改变字符串长度（如 İ → i̇），直接索引会错位；
  // 用转义后的字面量正则让引擎返回原串上的真实偏移。
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexp = new RegExp(pattern, "giu");
  const matches: TextSearchMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = regexp.exec(text)) !== null) {
    matches.push({ from: match.index, to: match.index + match[0].length });
    if (match[0].length === 0) regexp.lastIndex++;
  }
  return matches;
}

const textSearchField = StateField.define<TextSearchState>({
  create: () => CLOSED_TEXT_SEARCH,
  update(value, tr) {
    let next = value;
    let touched = false;

    for (const effect of tr.effects) {
      if (!effect.is(setTextSearch)) continue;
      if (effect.value === null) return CLOSED_TEXT_SEARCH;
      next = effect.value;
      touched = true;
    }
    if (!next.open) return next;

    // 只有查询变化或文档变化才重新扫描；跳转只改活动下标。
    const queryChanged = touched && next.query !== value.query;
    if (!tr.docChanged && !queryChanged && !(touched && !value.open)) {
      return next;
    }
    const matches = findTextMatches(tr.newDoc.toString(), next.query);
    const active = matches.length === 0
      ? -1
      : Math.min(Math.max(next.active, 0), matches.length - 1);
    return { ...next, matches, active };
  },
});

/** 与 Markdown 检索共用 .ob-search-match / .ob-search-active 装饰类。 */
const textSearchHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view.state);
    }

    update(update: { docChanged: boolean; startState: EditorState; state: EditorState }) {
      const before = update.startState.field(textSearchField, false);
      const after = update.state.field(textSearchField, false);
      if (update.docChanged || before !== after) {
        this.decorations = this.build(update.state);
      }
    }

    private build(state: EditorState): DecorationSet {
      const search = state.field(textSearchField, false);
      if (!search?.open || !search.query || search.matches.length === 0) {
        return Decoration.none;
      }
      return Decoration.set(
        search.matches.map((match, index) =>
          Decoration.mark({
            class:
              index === search.active
                ? "ob-search-match ob-search-active"
                : "ob-search-match",
          }).range(match.from, match.to),
        ),
        true,
      );
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

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
  let bar: SearchBar | null = null;

  const searchState = (): TextSearchState =>
    view.state.field(textSearchField, false) ?? CLOSED_TEXT_SEARCH;

  function syncSearchBar(): void {
    if (!bar) return;
    const search = searchState();
    bar.setVisible(search.open);
    bar.setCount(
      !search.query
        ? ""
        : search.matches.length === 0
          ? "无结果"
          : `${search.active + 1}/${search.matches.length}`,
    );
    bar.setReplaceEnabled(!readonly && search.matches.length > 0);
  }

  const baseExtensions: Extension[] = [
    minimalSetup,
    // 覆盖 minimalSetup 的浅色默认活动行/选区，颜色全部跟随 --ob-*。
    obletCmTheme,
    highlightActiveLine(),
    textSearchField,
    textSearchHighlighter,
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
      if (destroyed) return;
      const before = update.startState.field(textSearchField, false);
      const after = update.state.field(textSearchField, false);
      if (update.docChanged || before !== after) syncSearchBar();
      if (replacing || !update.docChanged) return;
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
    syncSearchBar();
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
    syncSearchBar();
  };

  const closeSearch = (focusEditor = false): void => {
    if (!bar) return;
    if (!searchState().open) {
      bar.setVisible(false);
      if (focusEditor) view.focus();
      return;
    }
    view.dispatch({ effects: setTextSearch.of(null) });
    bar.setVisible(false);
    if (focusEditor) view.focus();
  };

  const openSearch = (): void => {
    if (destroyed || !bar) return;
    if (searchState().open) {
      bar.focusInput();
      return;
    }
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to).trim();
    const query =
      selected && selected.length <= 100 ? selected : bar.getQuery();
    view.dispatch({
      effects: setTextSearch.of({
        open: true,
        query,
        active: query ? 0 : -1,
        matches: [],
      }),
    });
    bar.setQuery(query);
    syncSearchBar();
    bar.focusInput();
  };

  const navigateSearch = (delta: 1 | -1): void => {
    const search = searchState();
    if (!search.open || search.matches.length === 0) return;
    const active = search.active < 0
      ? delta > 0
        ? 0
        : search.matches.length - 1
      : (search.active + delta + search.matches.length) %
        search.matches.length;
    const match = search.matches[active];
    view.dispatch({
      effects: setTextSearch.of({ ...search, active }),
      selection: { anchor: match.from, head: match.to },
      userEvent: "select.search",
    });
    requestAnimationFrame(() => {
      if (destroyed) return;
      const pos = view.domAtPos(match.from);
      const el =
        pos.node.nodeType === 1
          ? (pos.node as HTMLElement)
          : pos.node.parentElement;
      el?.scrollIntoView({ block: "center" });
    });
  };

  const replaceSearch = (all: boolean): void => {
    if (destroyed || readonly || !bar) return;
    const search = searchState();
    if (!search.open || search.matches.length === 0) return;
    const text = bar.getReplacement();

    if (all) {
      // 单事务 = 单次撤销，与 Markdown「全部替换」一致。
      view.dispatch({
        changes: search.matches.map((match) => ({
          from: match.from,
          to: match.to,
          insert: text,
        })),
        userEvent: "input.replace.all",
      });
      return;
    }
    if (search.active < 0) return;
    const match = search.matches[search.active];
    view.dispatch({
      changes: { from: match.from, to: match.to, insert: text },
      userEvent: "input.replace",
    });
  };

  bar = createSearchBar({
    onQuery: (query) => {
      const search = searchState();
      if (!search.open) return;
      view.dispatch({
        effects: setTextSearch.of({ ...search, query }),
      });
    },
    onNavigate: navigateSearch,
    onReplace: replaceSearch,
    onClose: closeSearch,
  });

  // 安卓返回键桥注入 window 级合成 Esc；浮条开着时接住并标记已消费。
  // 注册早于 setup.ts 的全局 Esc（关 Tab），同相位按注册序触发。
  const onWindowSearchEsc = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !searchState().open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeSearch(true);
  };
  window.addEventListener("keydown", onWindowSearchEsc, true);
  syncSearchBar();

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("keydown", onWindowSearchEsc, true);
    bar?.destroy();
    bar = null;
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
    openSearch,
    closeSearch,
    isSearchOpen: () => !destroyed && searchState().open,
    destroy,
  };
}
