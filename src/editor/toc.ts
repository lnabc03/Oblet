// 悬浮 TOC（外观移植 obsidian-next-toc，vanilla TS + ProseMirror 重写，GPL-3.0 同源）
// 收起态：进度球 + bar 指示条；hover 300ms 面板从 bar 左缘 clip-path 抽屉式展开（不覆盖 bar/进度球），
// 移开 300ms 缓冲关闭。bar 与面板行一一对齐（同 26px 行距），悬停双向联动高亮，两侧均可点击跳转。
// 数据驱动：docChanged 事务重扫标题（切 tab 的 replaceAll 自然触发，无需 tab 钩子）；
// active 判定光标优先——selection 所在标题区间高亮，滚动不追
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";

interface TocHeading {
  pos: number;
  level: number;
  text: string;
}

const MAX_LEVEL = 4; // 仅解析 H1-H4
const EXPAND_DELAY = 300; // hover 展开延迟
const COLLAPSE_DELAY = 300; // 移开关闭缓冲（重进取消）

/** 收集 H1-H4 标题（textContent 天然纯文本，行内标记不进串） */
function collectHeadings(view: EditorView): TocHeading[] {
  const out: TocHeading[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading" && (node.attrs.level as number) <= MAX_LEVEL) {
      out.push({ pos, level: node.attrs.level as number, text: node.textContent });
    }
    return true;
  });
  return out;
}

/** 光标优先：最后一个 pos < selection.from 的标题为活动项 */
function activeIndexOf(headings: TocHeading[], from: number): number {
  let active = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].pos < from) active = i;
    else break;
  }
  return active;
}

export const tocPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("oblet-toc"),
      view(v) {
        const container = document.createElement("div");
        container.className = "ob-toc ob-toc-empty";
        // hover 区（指示条 + 抽屉面板）与进度球分离：进度球悬停不触发展开，只有单击回顶
        container.innerHTML = `
          <div class="ob-toc-hoverzone">
            <div class="ob-toc-indicators"></div>
            <div class="ob-toc-panel">
              <div class="ob-toc-items"></div>
            </div>
          </div>
          <div class="ob-toc-progress" title="单击回顶部（已在顶部时返回光标所在行）">
            <svg viewBox="0 0 100 100">
              <circle class="ob-toc-progress-trail" cx="50" cy="50" r="46"/>
              <circle class="ob-toc-progress-path" cx="50" cy="50" r="46"/>
              <text class="ob-toc-progress-text" x="50" y="55">0%</text>
            </svg>
          </div>`;
        document.body.appendChild(container);

        const hoverzoneEl = container.querySelector<HTMLElement>(".ob-toc-hoverzone")!;

        const indicatorsEl = container.querySelector<HTMLElement>(".ob-toc-indicators")!;
        const itemsEl = container.querySelector<HTMLElement>(".ob-toc-items")!;
        const progressEl = container.querySelector<HTMLElement>(".ob-toc-progress")!;
        const progressPath = container.querySelector<SVGCircleElement>(".ob-toc-progress-path")!;
        const progressText = container.querySelector<SVGTextElement>(".ob-toc-progress-text")!;

        // 滚动容器：.ProseMirror 向上找 .markdown-rendered（obsidian-base.css 的滚动容器）
        const scrollEl = v.dom.closest(".markdown-rendered") as HTMLElement | null;

        let headings: TocHeading[] = collectHeadings(v);
        let signature = "";
        let active = -1;
        let minLevel = 1;
        let rafPending = false;
        let expanded = false;
        let expandTimer: number | undefined;
        let collapseTimer: number | undefined;

        // ---- hover 时序：300ms 展开 / 300ms 缓冲关闭（仅 hover 区触发，进度球除外） ----
        hoverzoneEl.addEventListener("mouseenter", () => {
          window.clearTimeout(collapseTimer);
          if (expanded) return;
          expandTimer = window.setTimeout(() => {
            expanded = true;
            container.classList.add("ob-toc-expanded");
            scrollActiveIntoPanel();
          }, EXPAND_DELAY);
        });
        hoverzoneEl.addEventListener("mouseleave", () => {
          window.clearTimeout(expandTimer);
          collapseTimer = window.setTimeout(() => {
            expanded = false;
            container.classList.remove("ob-toc-expanded");
          }, COLLAPSE_DELAY);
        });

        // ---- 进度球：单击回顶部；已在顶部（0%）则返回光标所在行 ----
        progressEl.addEventListener("click", () => {
          if (scrollEl && scrollEl.scrollTop > 1) {
            scrollEl.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }
          // 已在顶部：滚回光标（rAF + domAtPos，与 jumpTo 同款可靠路径）
          requestAnimationFrame(() => {
            const dom = v.domAtPos(v.state.selection.from);
            const el =
              dom.node.nodeType === 1
                ? (dom.node as HTMLElement)
                : dom.node.parentElement;
            el?.scrollIntoView({ block: "center" });
          });
        });

        // ---- 阅读进度：滚动节流 16ms ----
        const CIRCLE_LEN = 2 * Math.PI * 46;
        let scrollScheduled = false;
        const updateProgress = () => {
          scrollScheduled = false;
          if (!scrollEl) return;
          const range = scrollEl.scrollHeight - scrollEl.clientHeight;
          const pct = range > 0 ? Math.min(100, Math.max(0, (scrollEl.scrollTop / range) * 100)) : 100;
          progressText.textContent = `${Math.round(pct)}%`;
          progressPath.style.strokeDashoffset = String(CIRCLE_LEN * (1 - pct / 100));
        };
        scrollEl?.addEventListener(
          "scroll",
          () => {
            if (!scrollScheduled) {
              scrollScheduled = true;
              requestAnimationFrame(updateProgress);
            }
          },
          { passive: true }
        );

        // ---- 跳转：光标落标题文字末尾，再把标题行滚到视口顶部 ----
        // 不用 tr.scrollIntoView（浮层点击场景下未生效），用 search.ts 验证过的
        // rAF + domAtPos + 原生 scrollIntoView 模式
        const jumpTo = (index: number) => {
          const h = headings[index];
          if (!h) return;
          const node = v.state.doc.nodeAt(h.pos);
          if (!node) return;
          const end = h.pos + 1 + node.content.size;
          v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, end)));
          v.focus();
          requestAnimationFrame(() => {
            const dom = v.domAtPos(h.pos + 1);
            const el =
              dom.node.nodeType === 1
                ? (dom.node as HTMLElement)
                : dom.node.parentElement;
            el?.scrollIntoView({ block: "start" });
          });
        };

        // ---- DOM 重建（heading 签名变化才重排，否则只刷 active 类） ----
        const renderItems = () => {
          itemsEl.textContent = "";
          indicatorsEl.textContent = "";
          headings.forEach((h, i) => {
            const depth = h.level - minLevel;

            const bar = document.createElement("div");
            bar.className = "ob-toc-indicator";
            bar.dataset.index = String(i);
            bar.dataset.actualDepth = String(depth);
            bar.appendChild(document.createElement("span"));
            indicatorsEl.appendChild(bar);

            const item = document.createElement("div");
            item.className = "ob-toc-item";
            item.dataset.index = String(i);
            item.dataset.actualDepth = String(depth);
            if (h.text) item.title = h.text; // 省略号时 tooltip 看全文
            const text = document.createElement("span");
            text.className = "ob-toc-item-text";
            text.textContent = h.text || "（空标题）";
            item.appendChild(text);

            // 悬停双向联动：任一侧悬停，对应行同步高亮；两侧均可点击跳转
            const link = (a: HTMLElement, b: HTMLElement) => {
              a.addEventListener("mouseenter", () => { b.dataset.hover = "true"; });
              a.addEventListener("mouseleave", () => { b.dataset.hover = "false"; });
            };
            link(item, bar);
            link(bar, item);
            item.addEventListener("click", () => jumpTo(i));
            bar.addEventListener("click", () => jumpTo(i));
            itemsEl.appendChild(item);
          });
          container.classList.toggle("ob-toc-empty", headings.length === 0);
        };

        const paintActive = () => {
          container.querySelectorAll(".ob-toc-item, .ob-toc-indicator").forEach((el) => {
            (el as HTMLElement).dataset.active = String(
              Number((el as HTMLElement).dataset.index) === active
            );
          });
        };

        const scrollActiveIntoPanel = () => {
          if (!expanded || active < 0) return;
          itemsEl
            .querySelector(`.ob-toc-item[data-index="${active}"]`)
            ?.scrollIntoView({ block: "nearest" });
        };

        const sync = (rescan: boolean) => {
          if (rescan) {
            headings = collectHeadings(v);
            minLevel = headings.reduce((m, h) => Math.min(m, h.level), MAX_LEVEL);
            const sig = headings.map((h) => `${h.level}:${h.text}`).join("\n");
            if (sig !== signature && !rafPending) {
              rafPending = true;
              requestAnimationFrame(() => {
                rafPending = false;
                signature = headings.map((h) => `${h.level}:${h.text}`).join("\n");
                renderItems();
                paintActive();
              });
            }
          }
          const next = activeIndexOf(headings, v.state.selection.from);
          if (next !== active) {
            active = next;
            paintActive();
            scrollActiveIntoPanel();
          }
        };

        // 首渲染
        minLevel = headings.reduce((m, h) => Math.min(m, h.level), MAX_LEVEL);
        signature = headings.map((h) => `${h.level}:${h.text}`).join("\n");
        renderItems();
        active = activeIndexOf(headings, v.state.selection.from);
        paintActive();
        updateProgress();

        return {
          update(view, prevState) {
            sync(view.state.doc !== prevState.doc);
          },
          destroy() {
            window.clearTimeout(expandTimer);
            window.clearTimeout(collapseTimer);
            container.remove();
          },
        };
      },
    })
);
