// 编辑器语境右键菜单：复制/剪切/粘贴/全选 + 高亮/callout（与工具栏共用命令）
// 浏览器风格的系统右键菜单在编辑器里没有价值，替换为贴合 Oblet 语境的自绘菜单
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { AllSelection, TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { toggleHighlight, wrapCallout, isWrapped } from "./toolbar";
import { notify } from "../notify";

interface Item {
  label: string;
  run: (view: EditorView) => void;
  enabled: (view: EditorView) => boolean;
}

const ITEMS: Item[] = [
  {
    label: "复制",
    run: () => document.execCommand("copy"),
    enabled: (v) => !v.state.selection.empty,
  },
  {
    label: "剪切",
    run: () => document.execCommand("cut"),
    enabled: (v) => !v.state.selection.empty && v.editable,
  },
  {
    label: "粘贴",
    // execCommand("paste") 在 webview 里不可用；走异步剪贴板 API，失败时引导快捷键
    run: (v) => {
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text) v.dispatch(v.state.tr.insertText(text));
        })
        .catch(() => notify("无法读取剪贴板，请用 Ctrl+V 粘贴", "warn"));
    },
    enabled: (v) => v.editable,
  },
  {
    label: "全选",
    run: (v) => v.dispatch(v.state.tr.setSelection(new AllSelection(v.state.doc))),
    enabled: () => true,
  },
  {
    label: "== 高亮",
    run: (v) => toggleHighlight(v),
    enabled: (v) => !v.state.selection.empty && v.editable,
  },
  {
    label: "Callout 包裹",
    run: (v) => wrapCallout(v),
    enabled: (v) => v.editable,
  },
];

export const contextMenuPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("oblet-context-menu"),
      view(view) {
        let menu: HTMLElement | null = null;

        const close = () => {
          menu?.remove();
          menu = null;
        };

        const open = (x: number, y: number) => {
          close();
          menu = document.createElement("div");
          menu.className = "context-menu";
          for (const item of ITEMS) {
            const btn = document.createElement("button");
            btn.textContent = item.label;
            btn.disabled = !item.enabled(view);
            btn.addEventListener("click", () => {
              close();
              item.run(view);
              view.focus();
            });
            menu.appendChild(btn);
          }
          document.body.appendChild(menu);
          // 防溢出：先渲染再按实际尺寸收边
          const rect = menu.getBoundingClientRect();
          menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
          menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
        };

        const onContextMenu = (e: MouseEvent) => {
          e.preventDefault();
          // 光标态右键：先把光标挪到点击处，让菜单项作用在直觉位置
          if (view.state.selection.empty) {
            const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
            if (pos) {
              view.dispatch(
                view.state.tr.setSelection(
                  TextSelection.create(view.state.doc, pos.pos)
                )
              );
            }
          }
          open(e.clientX, e.clientY);
        };

        // 点击别处 / Esc / 滚动 / 窗口失焦时关闭
        const onGlobalDown = (e: Event) => {
          if (menu && !menu.contains(e.target as Node)) close();
        };
        const onKey = (e: KeyboardEvent) => {
          if (e.key === "Escape") close();
        };

        view.dom.addEventListener("contextmenu", onContextMenu);
        window.addEventListener("mousedown", onGlobalDown, true);
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("blur", close);
        // 编辑器滚动容器是 .markdown-rendered（view.dom 的祖先）
        const scroller = view.dom.closest(".markdown-rendered");
        scroller?.addEventListener("scroll", close);

        return {
          destroy() {
            close();
            view.dom.removeEventListener("contextmenu", onContextMenu);
            window.removeEventListener("mousedown", onGlobalDown, true);
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("blur", close);
            scroller?.removeEventListener("scroll", close);
          },
        };
      },
    })
);
