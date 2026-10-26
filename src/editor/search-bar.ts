// 检索浮条的共享 UI：Markdown（ProseMirror）与 TXT（CodeMirror）共用同一份
// DOM、事件接管与样式类名，确保两种文档的检索体验完全一致。
// 只负责界面，不持有文档状态；查询、跳转、替换由宿主实现。

export interface SearchBarHandlers {
  onQuery(query: string): void;
  onNavigate(delta: 1 | -1): void;
  onReplace(all: boolean): void;
  /** focusEditor = 输入框内 Esc / 关闭按钮；窗口级 Esc 关闭时不抢焦点 */
  onClose(focusEditor: boolean): void;
}

export interface SearchBar {
  readonly dom: HTMLDivElement;
  setVisible(visible: boolean): void;
  isVisible(): boolean;
  setQuery(query: string): void;
  getQuery(): string;
  getReplacement(): string;
  focusInput(): void;
  setCount(text: string): void;
  setReplaceEnabled(enabled: boolean): void;
  destroy(): void;
}

export function createSearchBar(handlers: SearchBarHandlers): SearchBar {
  const bar = document.createElement("div");
  bar.className = "search-bar hidden";
  bar.innerHTML = `
    <div class="search-row">
      <span class="search-field">
        <input type="text" class="search-query" placeholder="搜索…" spellcheck="false">
        <span class="search-count"></span>
      </span>
      <button class="search-prev" title="上一个 (Shift+Enter)">↑</button>
      <button class="search-next" title="下一个 (Enter)">↓</button>
      <button class="search-close" title="关闭 (Esc)">✕</button>
    </div>
    <div class="search-row">
      <input type="text" class="search-replace" placeholder="替换为…" spellcheck="false">
      <button class="replace-one" title="替换当前命中并跳到下一个">替换</button>
      <button class="replace-all" title="全部替换（一次撤销可整体回退）">全部</button>
    </div>`;
  document.body.appendChild(bar);

  const input = bar.querySelector<HTMLInputElement>(".search-query")!;
  const replaceInput = bar.querySelector<HTMLInputElement>(".search-replace")!;
  const count = bar.querySelector(".search-count")!;
  const prevBtn = bar.querySelector<HTMLButtonElement>(".search-prev")!;
  const nextBtn = bar.querySelector<HTMLButtonElement>(".search-next")!;
  const closeBtn = bar.querySelector<HTMLButtonElement>(".search-close")!;
  const replaceOneBtn = bar.querySelector<HTMLButtonElement>(".replace-one")!;
  const replaceAllBtn = bar.querySelector<HTMLButtonElement>(".replace-all")!;

  input.addEventListener("input", () => handlers.onQuery(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handlers.onNavigate(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      handlers.onClose(true);
    }
  });
  prevBtn.addEventListener("click", () => handlers.onNavigate(-1));
  nextBtn.addEventListener("click", () => handlers.onNavigate(1));
  closeBtn.addEventListener("click", () => handlers.onClose(true));
  replaceOneBtn.addEventListener("click", () => handlers.onReplace(false));
  replaceAllBtn.addEventListener("click", () => handlers.onReplace(true));
  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handlers.onReplace(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      handlers.onClose(true);
    }
  });

  return {
    dom: bar,
    setVisible: (visible) => bar.classList.toggle("hidden", !visible),
    isVisible: () => !bar.classList.contains("hidden"),
    setQuery: (query) => {
      input.value = query;
    },
    getQuery: () => input.value,
    getReplacement: () => replaceInput.value,
    focusInput: () => {
      input.focus();
      input.select();
    },
    setCount: (text) => {
      count.textContent = text;
    },
    setReplaceEnabled: (enabled) => {
      replaceOneBtn.disabled = !enabled;
      replaceAllBtn.disabled = !enabled;
    },
    destroy: () => bar.remove(),
  };
}
