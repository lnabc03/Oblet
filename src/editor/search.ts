// 检索浮条（Ctrl+F）：装饰器高亮命中，文档完全不动（保真原则的检索侧体现）
// - 命中扫描与高亮都是只读装饰；跳转用选区事务 + scrollIntoView 居中
// - 替换功能待检索稳定后再加（打磨清单 3.3 分期）
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import type { Transaction } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type { EditorView } from "@milkdown/prose/view";
import type { Node as PMNode } from "@milkdown/prose/model";

interface Match {
  from: number;
  to: number;
}

interface SearchState {
  open: boolean;
  query: string;
  active: number; // 当前命中下标，-1 = 无
  matches: Match[];
}

const searchKey = new PluginKey<SearchState>("oblet-search");

const CLOSED: SearchState = { open: false, query: "", active: -1, matches: [] };

/** 全文档文本扫描（大小写不敏感）。虚拟串方案同高亮插件：
 *  非文本内联节点占一格 ，查询串含  的概率视为零 */
function findMatches(doc: PMNode, query: string): Match[] {
  if (!query) return [];
  const q = query.toLowerCase();
  const matches: Match[] = [];
  doc.descendants((node: PMNode, pos: number) => {
    if (!node.isTextblock) return true;
    let vtext = "";
    const vpos: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) {
          vtext += child.text[i].toLowerCase();
          vpos.push(start + i);
        }
      } else {
        vtext += "\u0001";
        vpos.push(start);
      }
    });
    let idx = 0;
    while ((idx = vtext.indexOf(q, idx)) !== -1) {
      matches.push({ from: vpos[idx], to: vpos[idx + q.length - 1] + 1 });
      idx += q.length; // 不允许重叠命中（"aa" 在 "aaa" 中只命中一次，对齐编辑器惯例）
    }
    return false;
  });
  return matches;
}

function searchDecorations(doc: PMNode, s: SearchState): DecorationSet | null {
  if (!s.open || !s.query || s.matches.length === 0) return null;
  return DecorationSet.create(
    doc,
    s.matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === s.active ? "ob-search-match ob-search-active" : "ob-search-match",
      })
    )
  );
}

type Meta =
  | { type: "open" }
  | { type: "close" }
  | { type: "query"; query: string }
  | { type: "navigate"; delta: 1 | -1 };

function applyMeta(tr: Transaction, s: SearchState): SearchState {
  const meta = tr.getMeta(searchKey) as Meta | undefined;
  const docChanged = tr.docChanged;
  if (!meta && !docChanged) return s;

  let { open, query, active, matches } = s;
  if (meta?.type === "open") open = true;
  if (meta?.type === "close") return CLOSED;
  if (meta?.type === "query") query = meta.query;

  if (open && (docChanged || meta?.type === "query")) {
    matches = findMatches(tr.doc, query);
    // 查询变化后尽量保留活动下标，越界则回 0
    active = matches.length === 0 ? -1 : Math.min(Math.max(active, 0), matches.length - 1);
  }
  if (meta?.type === "navigate" && matches.length > 0) {
    active = (active + meta.delta + matches.length) % matches.length;
  }
  return { open, query, active, matches };
}

export const searchPlugin = $prose(() => {
  let view: EditorView | null = null;

  const dispatchMeta = (meta: Meta, select = false) => {
    if (!view) return;
    const tr = view.state.tr.setMeta(searchKey, meta);
    view.dispatch(tr);
    if (select) scrollToActive(view);
  };

  /** 把活动命中设为选区并滚动到视口中部 */
  const scrollToActive = (v: EditorView) => {
    const s = searchKey.getState(v.state);
    if (!s || s.active < 0) return;
    const m = s.matches[s.active];
    const tr = v.state.tr.setSelection(
      TextSelection.create(v.state.doc, m.from, m.to)
    );
    v.dispatch(tr);
    // PM 自带 scrollIntoView 只保证可见（贴边），手动居中
    requestAnimationFrame(() => {
      const dom = v.domAtPos(m.from);
      const el =
        dom.node.nodeType === 1
          ? (dom.node as HTMLElement)
          : dom.node.parentElement;
      el?.scrollIntoView({ block: "center" });
    });
  };

  return new Plugin({
    key: searchKey,
    state: {
      init: () => CLOSED,
      apply(tr, s) {
        return applyMeta(tr, s);
      },
    },
    props: {
      decorations(state) {
        return searchDecorations(state.doc, searchKey.getState(state)!);
      },
      handleKeyDown(v, event) {
        const s = searchKey.getState(v.state)!;
        // Ctrl+F 不在此处拦截：浮条聚焦时 PM 收不到事件，会漏出 webview 默认检索。
        // 统一在 plugin view 的 window 捕获监听器里处理
        if (event.key === "Escape" && s.open) {
          dispatchMeta({ type: "close" });
          return true;
        }
        // Enter 跳转只在浮条输入框里处理（input 自己的 keydown）；
        // 编辑器里 Enter 必须照常换行，不能因浮条开着就被劫持
        return false;
      },
    },
    view(v) {
      view = v;
      const bar = document.createElement("div");
      bar.className = "search-bar hidden";
      bar.innerHTML = `
        <div class="search-row">
          <input type="text" class="search-query" placeholder="搜索…" spellcheck="false">
          <span class="search-count"></span>
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

      let wasOpen = false;

      input.addEventListener("input", () =>
        dispatchMeta({ type: "query", query: input.value })
      );
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          dispatchMeta({ type: "navigate", delta: e.shiftKey ? -1 : 1 }, true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          dispatchMeta({ type: "close" });
          v.focus();
        }
      });
      prevBtn.addEventListener("click", () =>
        dispatchMeta({ type: "navigate", delta: -1 }, true)
      );
      nextBtn.addEventListener("click", () =>
        dispatchMeta({ type: "navigate", delta: 1 }, true)
      );
      closeBtn.addEventListener("click", () => {
        dispatchMeta({ type: "close" });
        v.focus();
      });

      // 替换走正常 PM 事务（userEditTracker 会正常标脏、自动保存接管）。
      // 命中区间永不跨块（扫描以 textblock 为单位），纯文本替换安全；
      // 命中重算由 docChanged 驱动：替换当前后原下标自然指向"下一个"命中
      const doReplace = (all: boolean) => {
        if (!v.editable) return;
        const s = searchKey.getState(v.state)!;
        if (s.matches.length === 0) return;
        const text = replaceInput.value;
        const tr = v.state.tr;
        if (all) {
          // 从后往前替换，前面的命中位置不受后面改动影响；单事务 = 单次撤销
          for (let i = s.matches.length - 1; i >= 0; i--) {
            tr.insertText(text, s.matches[i].from, s.matches[i].to);
          }
        } else if (s.active >= 0) {
          const m = s.matches[s.active];
          tr.insertText(text, m.from, m.to);
        } else {
          return;
        }
        v.dispatch(tr);
      };
      replaceOneBtn.addEventListener("click", () => doReplace(false));
      replaceAllBtn.addEventListener("click", () => doReplace(true));
      replaceInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          doReplace(false);
        } else if (e.key === "Escape") {
          e.preventDefault();
          dispatchMeta({ type: "close" });
          v.focus();
        }
      });

      // Ctrl+F 全局捕获：浮条聚焦时再按 Ctrl+F 会触发 webview 默认检索，
      // 必须 capture 阶段 preventDefault；已打开则聚焦回输入框（编辑器惯例）
      const onGlobalKey = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f") {
          e.preventDefault();
          const s = searchKey.getState(v.state)!;
          if (s.open) {
            input.focus();
            input.select();
          } else {
            dispatchMeta({ type: "open" });
          }
        }
      };
      window.addEventListener("keydown", onGlobalKey, true);

      return {
        update(v2) {
          const s = searchKey.getState(v2.state)!;
          bar.classList.toggle("hidden", !s.open);
          if (s.open && !wasOpen) {
            // 打开时若编辑器有选区，预填为查询词（编辑器惯例）
            const { from, to } = v2.state.selection;
            const selected = v2.state.doc.textBetween(from, to, " ", " ").trim();
            if (selected && selected.length <= 100) {
              input.value = selected;
              dispatchMeta({ type: "query", query: selected });
            }
            input.focus();
            input.select();
          }
          wasOpen = s.open;
          count.textContent = !s.query
            ? ""
            : s.matches.length === 0
              ? "无结果"
              : `${s.active + 1}/${s.matches.length}`;
          // 只读文档或无命中时禁用替换按钮
          const canReplace = v2.editable && s.matches.length > 0;
          replaceOneBtn.disabled = !canReplace;
          replaceAllBtn.disabled = !canReplace;
        },
        destroy() {
          bar.remove();
          window.removeEventListener("keydown", onGlobalKey, true);
          view = null;
        },
      };
    },
  });
});
