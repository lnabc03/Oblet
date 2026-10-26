// 移动端应用菜单（左上角 ☰）：触屏上长按右键与选中工具栏互相干扰（问题 4），
// 提供一个常驻显性入口——打开/最近/新建 + 编辑器命令（与右键菜单同一份 ITEMS）+ 设置/主题
import type { EditorView } from "@milkdown/prose/view";
import { IS_MOBILE } from "../platform";
import { runCommand } from "../commands";
import { editorMenuEntries, openMenu, type MenuEntry } from "./contextmenu";

export interface AppMenuHandlers {
  /** 编辑器存活时返回其 view（起始页为 null，此时不展示编辑区命令） */
  getView: () => EditorView | null;
  /** 「打开文件…」：走原生 SAF 选择器（无桥时该项不显示） */
  openFile: () => void;
  /** 「新建文件」 */
  newNote: () => void;
  /** 「最近打开」子项点击 */
  openPath: (path: string) => void;
  /** 最近打开列表（新→旧） */
  getRecents: () => Promise<string[]>;
}

interface ObletNativeBridge {
  pickFile?: () => void;
}

export function initAppMenu(h: AppMenuHandlers) {
  // 桌面端入口已足够（双击/拖入/右键/快捷键），此按钮仅移动端
  if (!IS_MOBILE) return;

  const btn = document.createElement("button");
  btn.className = "appmenu-btn";
  btn.textContent = "☰";
  btn.title = "菜单";
  document.body.appendChild(btn);

  btn.addEventListener("click", async () => {
    const entries: MenuEntry[] = [];

    const bridge = (window as unknown as { ObletNative?: ObletNativeBridge })
      .ObletNative;
    if (typeof bridge?.pickFile === "function") {
      entries.push({
        label: "打开文件…",
        enabled: true,
        run: () => h.openFile(),
      });
    }

    const recents = await h.getRecents().catch(() => [] as string[]);
    entries.push({
      label: "最近打开",
      enabled: recents.length > 0,
      children: recents.map((p) => ({
        label: p.split("/").pop() || p,
        enabled: true,
        run: () => h.openPath(p),
      })),
    });

    entries.push({ label: "新建文件", enabled: true, run: () => h.newNote() });

    const view = h.getView();
    if (view) {
      entries.push({ label: "", enabled: false, divider: true });
      entries.push(...editorMenuEntries(view));
    }

    entries.push({ label: "", enabled: false, divider: true });
    entries.push({
      label: "搜索替换",
      enabled: !!view,
      run: () => runCommand("search"),
    });
    entries.push({
      label: "切换深色/浅色",
      enabled: true,
      run: () => runCommand("toggle-theme"),
    });
    entries.push({
      label: "设置",
      enabled: true,
      run: () => runCommand("settings"),
    });

    const r = btn.getBoundingClientRect();
    openMenu(r.left, r.bottom + 6, entries);
  });
}
