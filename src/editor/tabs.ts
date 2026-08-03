// Tab 切换系统（批次 7.3 多文档单窗口）
// 单 Crepe 实例方案：切 tab 即 replaceAll 换内容，undo 不跨 tab 保留
import { invoke } from "@tauri-apps/api/core";
import { replaceAll, $prose } from "@milkdown/utils";
import { editorViewCtx } from "@milkdown/core";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import type { Crepe } from "@milkdown/crepe";
import { confirmDialog, notify } from "../notify";
import { currentEditorSettings } from "../settings/typography";

// ---- 类型 ----

export interface TabState {
  path: string;
  content: string;
  newline: string;
  readonly: boolean;
  readonly_reason: string | null;
  dirty: boolean;
  /** 切出时保存的光标位置（from），切回时恢复 */
  cursorFrom?: number;
  cursorTo?: number;
  /** 切出时保存的滚动位置 */
  scrollTop?: number;
}

interface TabsPayload {
  path: string;
  tabs: string[];
  active_index: number;
}

// ---- 箭头 SVG ----

const ARROW_LEFT_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8L10 13"/></svg>`;
const ARROW_RIGHT_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3L11 8L6 13"/></svg>`;

// ---- 回调接口：setup.ts 注入闭包 ----

export interface TabsCallbacks {
  /** 当前 Crepe 实例引用（可能为 null，起始页尚未创建） */
  getCrepe: () => Crepe | null;
  /** 获取/设置 suppressSave 标志 */
  getSuppressSave: () => boolean;
  setSuppressSave: (v: boolean) => void;
  /** 获取/设置 dirty 标志 */
  getDirty: () => boolean;
  setDirty: (v: boolean) => void;
  /** 获取/设置 lastContent */
  getLastContent: () => string;
  setLastContent: (v: string) => void;
  /** 获取/设置 payload */
  getPayload: () => { newline: string; readonly: boolean; readonly_reason: string | null };
  setPayload: (p: { newline: string; readonly: boolean; readonly_reason: string | null }) => void;
  /** 更新只读横幅 */
  updateBanner: () => void;
  /** 清空搜索高亮状态 */
  clearSearch: () => void;
  /** 更新当前活跃路径（tab 切换后同步 setup.ts 的 path 变量） */
  setPath: (p: string) => void;
}

// ---- 工厂函数 ----

export function createTabsModel(initialTabs: string[], activeIndex: number) {
  const cache = new Map<string, TabState>();

  // 预填活跃 tab 的路径占位（内容稍后由 setup.ts 填充）
  for (const p of initialTabs) {
    if (!cache.has(p.toLowerCase())) {
      cache.set(p.toLowerCase(), {
        path: p,
        content: "",
        newline: "CRLF",
        readonly: false,
        readonly_reason: null,
        dirty: false,
      });
    }
  }

  let tabs = [...initialTabs];
  let active = activeIndex;

  const model = {
    /** 当前活跃索引 */
    get activeIndex() { return active; },
    /** tab 总数 */
    get count() { return tabs.length; },
    /** 全部 tab 路径 */
    get paths(): string[] { return [...tabs]; },
    /** 活跃 tab 路径 */
    get activePath() { return tabs[active] ?? ""; },

    /** 获取 tab 缓存（按路径，大小写不敏感） */
    get(path: string): TabState | undefined {
      return cache.get(path.toLowerCase());
    },

    /** 更新当前活跃 tab 的缓存字段 */
    updateCurrent(patch: Partial<TabState>) {
      const key = tabs[active]?.toLowerCase();
      if (!key) return;
      const cur = cache.get(key);
      if (cur) Object.assign(cur, patch);
    },

    /** 仅更新路径列表，不改变活跃索引（供 switchToTab 内部使用） */
    updatePaths(t: string[]) {
      tabs = [...t];
      // 确保所有路径都有缓存占位
      for (const p of t) {
        if (!cache.has(p.toLowerCase())) {
          cache.set(p.toLowerCase(), {
            path: p,
            content: "",
            newline: "CRLF",
            readonly: false,
            readonly_reason: null,
            dirty: false,
          });
        }
      }
    },

    /** 设置活跃索引 */
    setActiveIndex(idx: number) {
      if (idx >= 0 && idx < tabs.length) active = idx;
    },

    /** 批量同步 tab 列表（外部操作如 add_tab/remove_tab 返回后调用） */
    sync(t: string[], idx: number) {
      tabs = t;
      active = idx;
      // 确保所有路径都有缓存占位
      for (const p of t) {
        if (!cache.has(p.toLowerCase())) {
          cache.set(p.toLowerCase(), {
            path: p,
            content: "",
            newline: "CRLF",
            readonly: false,
            readonly_reason: null,
            dirty: false,
          });
        }
      }
    },

    /** 移除指定索引的 tab（本地操作，Rust 侧已通过 remove_tab 先执行） */
    removeLocal(index: number): boolean {
      if (tabs.length <= 1) {
        tabs = [];
        active = 0;
        return false; // 窗口无 tab，前端应退起始页
      }
      tabs.splice(index, 1);
      if (active >= index) {
        active = Math.max(0, active - 1);
      }
      if (active >= tabs.length) {
        active = tabs.length - 1;
      }
      return true;
    },

    /** 获取活跃 tab 的缓存状态（不存在则创建空占位） */
    current(): TabState {
      const key = tabs[active]?.toLowerCase() ?? "";
      if (!cache.has(key)) {
        cache.set(key, {
          path: tabs[active],
          content: "",
          newline: "CRLF",
          readonly: false,
          readonly_reason: null,
          dirty: false,
        });
      }
      return cache.get(key)!;
    },
  };

  return model;
}

export type TabsModel = ReturnType<typeof createTabsModel>;

// ---- 箭头 UI ----

export function createTabArrows(container: HTMLElement) {
  const left = document.createElement("div");
  left.className = "tab-arrow-left tab-arrow-hidden";
  left.innerHTML = ARROW_LEFT_SVG;
  left.title = "上一个标签页 (Alt+Left)";

  const right = document.createElement("div");
  right.className = "tab-arrow-right tab-arrow-hidden";
  right.innerHTML = ARROW_RIGHT_SVG;
  right.title = "下一个标签页 (Alt+Right)";

  container.appendChild(left);
  container.appendChild(right);

  const arrows = {
    left,
    right,
    show(v: boolean) {
      left.classList.toggle("tab-arrow-hidden", !v);
      right.classList.toggle("tab-arrow-hidden", !v);
    },
    onLeftClick(fn: () => void) {
      left.addEventListener("click", fn);
    },
    onRightClick(fn: () => void) {
      right.addEventListener("click", fn);
    },
  };

  return arrows;
}

export type TabArrows = ReturnType<typeof createTabArrows>;

// ---- switchTo 核心流程 ----
// updatedTabs: Rust 侧 add_tab/remove_tab 返回的最新路径列表
// targetIndex: 要切换到的目标索引

export async function switchToTab(
  model: TabsModel,
  updatedTabs: string[],
  targetIndex: number,
  cb: TabsCallbacks,
): Promise<void> {
  // 循环处理目标索引
  const n = updatedTabs.length;
  const newIndex = ((targetIndex % n) + n) % n;
  const targetPath = updatedTabs[newIndex];

  // guard：用路径比较而非索引比较（remove_tab 场景下索引会偏移）
  const oldActivePath = model.activePath;
  if (oldActivePath.replace(/\//g, "\\").toLowerCase() === targetPath.replace(/\//g, "\\").toLowerCase()) {
    model.updatePaths(updatedTabs);
    return;
  }

  const crepe = cb.getCrepe();
  if (!crepe) return;

  // ⚠️ 以下所有"保存当前状态"操作必须在 updatePaths 之前完成——
  // updatePaths 会改变 tabs[active] 指向，导致缓存键污染。

  // 1. 保存当前光标/滚动位置（用 oldActivePath 定位缓存键）
  try {
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
    if (view) {
      const sel = view.state.selection;
      const cur = model.get(oldActivePath);
      if (cur) {
        cur.cursorFrom = sel.from;
        cur.cursorTo = sel.to;
        cur.scrollTop = (view.dom.parentElement as HTMLElement)?.scrollTop ?? 0;
      }
    }
  } catch { /* ignore */ }

  // 2. 脏内容处理
  if (cb.getDirty() && !cb.getPayload().readonly) {
    const autoSave = currentEditorSettings().auto_save;
    if (autoSave === false) {
      const choice = await confirmDialog("有未保存的更改，切换前要保存吗？", "保存", "丢弃");
      if (choice === null) return;
      if (choice) {
        cb.setDirty(false);
        const md = crepe.getMarkdown();
        const last = cb.getLastContent();
        if (md !== last) {
          try {
            await invoke("write_file", { path: oldActivePath, content: md, newline: cb.getPayload().newline });
          } catch (e) {
            notify(`保存失败：${e}`, "error");
            return;
          }
        }
      }
    }
  }

  // 3. 保存当前 tab 的 markdown 到缓存（key = oldActivePath）
  const curMd = crepe.getMarkdown();
  const curCache = model.get(oldActivePath);
  if (curCache) {
    curCache.content = curMd;
    curCache.dirty = cb.getDirty();
  }

  // ⚠️ 从此处开始可以安全调用 updatePaths

  // 4. 更新路径列表（不改变 activeIndex，仍指向旧路径）
  model.updatePaths(updatedTabs);

  // 5. 获取目标 tab 内容（缓存优先，否则读盘）
  let tab = model.get(targetPath);
  if (!tab?.content) {
    try {
      const fresh = await invoke<{ content: string; newline: string; readonly: boolean; readonly_reason: string | null }>(
        "read_file",
        { path: targetPath }
      );
      if (!tab) {
        tab = {
          path: targetPath,
          content: fresh.content,
          newline: fresh.newline,
          readonly: fresh.readonly,
          readonly_reason: fresh.readonly_reason,
          dirty: false,
        };
      } else {
        tab.content = fresh.content;
        tab.newline = fresh.newline;
        tab.readonly = fresh.readonly;
        tab.readonly_reason = fresh.readonly_reason;
      }
    } catch (e) {
      notify(`文件已被删除或无法读取：${e}`, "error");
      model.removeLocal(newIndex);
      if (model.count === 0) return;
      return switchToTab(model, model.paths, model.activeIndex, cb);
    }
  }

  // 6. 切换到目标：先设置 active，再替换内容
  model.setActiveIndex(newIndex);
  cb.setPath(targetPath);

  // 7. 替换编辑器内容
  cb.setSuppressSave(true);
  try {
    crepe.editor.action(replaceAll(tab!.content));
  } catch { /* ignore */ }
  cb.setSuppressSave(false);
  cb.setDirty(false);
  cb.setLastContent(tab!.content.replace(/\r\n/g, "\n"));
  cb.setPayload({
    newline: tab!.newline,
    readonly: tab!.readonly,
    readonly_reason: tab!.readonly_reason,
  });
  crepe.setReadonly(tab!.readonly);
  cb.updateBanner();
  cb.clearSearch();

  // 8. 滚动到光标位置（用 PM 原生 scrollIntoView，不跟浏览器抢滚动控制权）
  try {
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
    if (view) {
      const doc = view.state.doc;
      const from = tab!.cursorFrom != null
        ? Math.min(tab!.cursorFrom, doc.content.size)
        : 1;
      const to = tab!.cursorTo != null
        ? Math.min(tab!.cursorTo, doc.content.size)
        : from;
      // 先重置 scrollTop 消除跨文档滚动残留
      const scrollEl = view.dom.parentElement as HTMLElement;
      scrollEl.scrollTop = 0;
      void scrollEl.offsetHeight; // 强制重排：让新文档的 scrollHeight 立即生效
      // 设光标并让 PM 把光标滚入视口
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(doc, from, to))
          .scrollIntoView()
      );
    }
  } catch { /* ignore */ }

  // 9. 通知 Rust 侧
  await invoke("switch_tab", { index: newIndex }).catch(() => {});
  await invoke("watch_file", { path: targetPath }).catch(() => {});
}
