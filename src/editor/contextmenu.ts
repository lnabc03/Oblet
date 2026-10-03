// 编辑器语境右键菜单：复制/剪切/粘贴/全选 + callout（与工具栏共用命令）
// 浏览器风格的系统右键菜单在编辑器里没有价值，替换为贴合 Oblet 语境的自绘菜单
// （高亮项已按十一轮批示移除——快捷键 Ctrl+H 与工具栏按钮已够）
// 菜单 DOM 构建收口在 openMenu：右键/长按入口与移动端应用菜单（appmenu.ts）共用
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { AllSelection, TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { toggleCallout } from "./toolbar";
import { hasFrontmatter, insertFrontmatter } from "./frontmatter";
import { docHasAbsoluteImages } from "./image-paths";
import { notify } from "../notify";
import { COARSE_POINTER } from "../platform";

/** 导出动作回调（批次 7）：由 setup.ts 注入（插件内拿不到文件路径闭包） */
let exportHandlers: {
  print?: () => void;
  vault?: () => void;
  rename?: () => void;
  localizeImages?: () => void;
} = {};
export function setExportHandlers(h: typeof exportHandlers) {
  exportHandlers = h;
}

interface Item {
  label: string;
  run?: (view: EditorView) => void;
  enabled?: (view: EditorView) => boolean;
  children?: Item[];
  /** true 时整项不出现（区别于 enabled=false 的置灰）：用于平台级裁剪 */
  hide?: () => boolean;
}

/** 菜单构建的统一输入（openMenu）：enabled 已求值、run 已绑定闭包 */
export interface MenuEntry {
  label: string;
  enabled: boolean;
  run?: () => void;
  children?: MenuEntry[];
  /** true = 分隔线（忽略其余字段） */
  divider?: boolean;
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
    // D9：移动端无打印链路，setup.ts 不注入 print 处理器 → 整项隐藏（而非置灰）
    label: "导出为 PDF",
    run: () => exportHandlers.print?.(),
    enabled: () => !!exportHandlers.print,
    hide: () => !exportHandlers.print,
  },
  {
    // 批次 7.1：复制当前 md 到 Vault 目标文件夹；未配置时点击给引导 toast
    label: "另存",
    run: () => exportHandlers.vault?.(),
    enabled: () => !!exportHandlers.vault,
  },
  {
    // v0.6.0：同目录重命名当前文档（预填原文件名，见 setup.ts doRename）
    label: "重命名文档",
    run: () => exportHandlers.rename?.(),
    enabled: () => !!exportHandlers.rename,
  },
  {
    // v0.7.0：本地绝对路径图片批量复制进 assets/ 并改写为相对引用
    // （同步工作区到其他设备后绝对路径失效；常显，无可转换图片时置灰）
    label: "转换图片为相对路径（assets/）",
    run: () => exportHandlers.localizeImages?.(),
    enabled: (v) =>
      !!exportHandlers.localizeImages && docHasAbsoluteImages(v.state.doc),
  },
];

/** 编辑器菜单项求值（右键菜单与移动端应用菜单共用同一份 ITEMS） */
export function editorMenuEntries(view: EditorView): MenuEntry[] {
  const map = (item: Item): MenuEntry => ({
    label: item.label,
    enabled: item.enabled?.(view) ?? true,
    run: item.run
      ? () => {
          item.run?.(view);
          view.focus();
        }
      : undefined,
    children: item.children?.map(map),
  });
  return ITEMS.filter((i) => !i.hide?.()).map(map);
}

/** 通用自绘菜单：在 (x, y) 处打开 entries，点别处/Esc/滚动/失焦关闭。
 *  打开期间挂 body.ob-ctx-open——触屏上长按会同时拉起 Crepe 选中工具栏，
 *  CSS 按这个类把工具栏压掉，解决两菜单叠屏冲突 */
export function openMenu(x: number, y: number, entries: MenuEntry[]): () => void {
  const menu = document.createElement("div");
  menu.className = "context-menu";

  const build = (list: MenuEntry[], host: HTMLElement) => {
    for (const entry of list) {
      if (entry.divider) {
        const hr = document.createElement("div");
        hr.className = "context-divider";
        host.appendChild(hr);
        continue;
      }
      if (entry.children) {
        const sub = document.createElement("div");
        sub.className = "context-sub";
        const btn = document.createElement("button");
        btn.textContent = `${entry.label} ▸`;
        btn.disabled = !entry.enabled;
        const flyout = document.createElement("div");
        flyout.className = "context-menu context-flyout";
        build(entry.children, flyout);
        sub.appendChild(btn);
        sub.appendChild(flyout);
        // 触屏无 hover：点按父项切换子菜单（CSS .open 类与 :hover 规则并列）
        if (COARSE_POINTER) {
          btn.addEventListener("click", () => {
            const willOpen = !sub.classList.contains("open");
            menu
              .querySelectorAll(".context-sub.open")
              .forEach((el) => el.classList.remove("open"));
            sub.classList.toggle("open", willOpen);
          });
        }
        host.appendChild(sub);
        continue;
      }
      const btn = document.createElement("button");
      btn.textContent = entry.label;
      btn.disabled = !entry.enabled;
      btn.addEventListener("click", () => {
        close();
        entry.run?.();
      });
      host.appendChild(btn);
    }
  };
  build(entries, menu);

  const close = () => {
    menu.remove();
    document.body.classList.remove("ob-ctx-open");
    window.removeEventListener("pointerdown", onGlobalDown, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", close);
    window.removeEventListener("scroll", onScroll, true);
  };
  const onGlobalDown = (e: Event) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    // preventDefault：安卓返回键桥以此判定"已消费"（菜单开着时不退页面）
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  };
  // 捕获阶段滚动（编辑器滚动容器是 .markdown-rendered，不冒泡到 window）
  const onScroll = () => close();

  document.body.appendChild(menu);
  document.body.classList.add("ob-ctx-open");
  // 防溢出：先渲染再按实际尺寸收边；贴右缘时子菜单向左展开
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  if (x + rect.width + 180 > window.innerWidth) menu.classList.add("flip");

  window.addEventListener("pointerdown", onGlobalDown, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", close);
  window.addEventListener("scroll", onScroll, true);
  return close;
}

export const contextMenuPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("oblet-context-menu"),
      view(view) {
        let closeMenu: (() => void) | null = null;

        const open = (x: number, y: number) => {
          closeMenu?.();
          closeMenu = openMenu(x, y, editorMenuEntries(view));
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

        // 触屏：长按（500ms 不位移超阈值）触发自绘菜单——contenteditable 里
        // Android 不一定发 contextmenu 事件，用 pointer 事件自实现
        let lpTimer: number | undefined;
        let lpX = 0, lpY = 0;
        const lpCancel = () => window.clearTimeout(lpTimer);
        const onPointerDown = (e: PointerEvent) => {
          if (e.pointerType !== "touch") return;
          lpX = e.clientX; lpY = e.clientY;
          lpCancel();
          lpTimer = window.setTimeout(() => {
            // 与右键同款语义：空选区先把光标落到长按处
            if (view.state.selection.empty) {
              const pos = view.posAtCoords({ left: lpX, top: lpY });
              if (pos) {
                view.dispatch(
                  view.state.tr.setSelection(
                    TextSelection.create(view.state.doc, pos.pos)
                  )
                );
              }
            }
            open(lpX, lpY);
          }, 500);
        };
        const onPointerMove = (e: PointerEvent) => {
          if (Math.abs(e.clientX - lpX) > 10 || Math.abs(e.clientY - lpY) > 10) lpCancel();
        };

        view.dom.addEventListener("contextmenu", onContextMenu);
        if (COARSE_POINTER) {
          view.dom.addEventListener("pointerdown", onPointerDown);
          view.dom.addEventListener("pointermove", onPointerMove);
          view.dom.addEventListener("pointerup", lpCancel);
          view.dom.addEventListener("pointercancel", lpCancel);
        }

        return {
          destroy() {
            closeMenu?.();
            lpCancel();
            view.dom.removeEventListener("contextmenu", onContextMenu);
            if (COARSE_POINTER) {
              view.dom.removeEventListener("pointerdown", onPointerDown);
              view.dom.removeEventListener("pointermove", onPointerMove);
              view.dom.removeEventListener("pointerup", lpCancel);
              view.dom.removeEventListener("pointercancel", lpCancel);
            }
          },
        };
      },
    })
);
