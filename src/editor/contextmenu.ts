// 编辑器语境右键菜单：复制/剪切/粘贴/全选 + callout（与工具栏共用命令）
// 浏览器风格的系统右键菜单在编辑器里没有价值，替换为贴合 Oblet 语境的自绘菜单
// （高亮项已按十一轮批示移除——快捷键 Ctrl+H 与工具栏按钮已够）
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { AllSelection, TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { toggleCallout } from "./toolbar";
import { hasFrontmatter, insertFrontmatter } from "./frontmatter";
import { notify } from "../notify";

/** 导出动作回调（批次 7）：由 setup.ts 注入（插件内拿不到文件路径闭包） */
let exportHandlers: { print?: () => void; vault?: () => void } = {};
export function setExportHandlers(h: typeof exportHandlers) {
  exportHandlers = h;
}

interface Item {
  label: string;
  run?: (view: EditorView) => void;
  enabled?: (view: EditorView) => boolean;
  children?: Item[];
}

/** 右键可主动创建的 callout 类型（与 Ob 常用类型对齐；其余类型可在标记文本上直接改） */
const CALLOUT_TYPES = [
  { type: "note", label: "Note 备注" },
  { type: "tip", label: "Tip 提示" },
  { type: "important", label: "Important 重要" },
  { type: "warning", label: "Warning 警告" },
  { type: "caution", label: "Caution 当心" },
];

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
    // 已处于 callout 内时选同类型 = 回退原样，选异类型 = 换类型（见 toggleCallout）
    label: "Callout",
    enabled: (v) => v.editable,
    children: CALLOUT_TYPES.map(({ type, label }) => ({
      label,
      run: (v) => toggleCallout(v, type),
      enabled: (v) => v.editable,
    })),
  },
  {
    // 无 frontmatter 的文档才有创建入口；插入空属性栏并聚焦键名（见 frontmatter.ts）
    label: "添加笔记属性",
    run: (v) => insertFrontmatter(v),
    enabled: (v) => v.editable && !hasFrontmatter(v.state.doc),
  },
  {
    // 批次 7.2：系统打印对话框（用户自定义纸张/边距/缩放）；Mica 临时关闭见 setup.ts
    label: "导出为 PDF",
    run: () => exportHandlers.print?.(),
    enabled: () => !!exportHandlers.print,
  },
  {
    // 批次 7.1：复制当前 md 到 Vault 目标文件夹；未配置时点击给引导 toast
    label: "另存",
    run: () => exportHandlers.vault?.(),
    enabled: () => !!exportHandlers.vault,
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
            if (item.children) {
              // 子菜单：hover 展开浮出层（CSS :hover 驱动，JS 只负责收边翻转）
              const sub = document.createElement("div");
              sub.className = "context-sub";
              const btn = document.createElement("button");
              btn.textContent = `${item.label} ▸`;
              btn.disabled = !(item.enabled?.(view) ?? true);
              const flyout = document.createElement("div");
              flyout.className = "context-menu context-flyout";
              for (const child of item.children) {
                const cbtn = document.createElement("button");
                cbtn.textContent = child.label;
                cbtn.disabled = !(child.enabled?.(view) ?? true);
                cbtn.addEventListener("click", () => {
                  close();
                  child.run?.(view);
                  view.focus();
                });
                flyout.appendChild(cbtn);
              }
              sub.appendChild(btn);
              sub.appendChild(flyout);
              menu.appendChild(sub);
              continue;
            }
            const btn = document.createElement("button");
            btn.textContent = item.label;
            btn.disabled = !(item.enabled?.(view) ?? true);
            btn.addEventListener("click", () => {
              close();
              item.run?.(view);
              view.focus();
            });
            menu.appendChild(btn);
          }
          document.body.appendChild(menu);
          // 防溢出：先渲染再按实际尺寸收边；贴右缘时子菜单向左展开
          const rect = menu.getBoundingClientRect();
          menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
          menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
          if (x + rect.width + 180 > window.innerWidth) menu.classList.add("flip");
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
