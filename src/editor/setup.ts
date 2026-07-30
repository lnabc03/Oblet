// Oblet 编辑器装配（Crepe 底座）与文件生命周期
// 流程：取窗口文件 → 读文件 → 建 Crepe → 防抖自动保存 / Ctrl+S → 外部变更监听
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Crepe } from "@milkdown/crepe";
import { replaceAll } from "@milkdown/utils";
import "@milkdown/crepe/theme/common/style.css";
import { initTheme } from "../theme/loader";
import { initSettingsUI } from "../settings/ui";

interface FilePayload {
  content: string;
  newline: string;
  readonly: boolean;
  readonly_reason: string | null;
}

const AUTOSAVE_DELAY = 1000;

export async function boot() {
  const app = document.getElementById("app")!;
  await initTheme();
  void initSettingsUI(app);
  const path = await invoke<string | null>("get_window_file");

  if (!path) {
    app.innerHTML = `<div class="empty-state">
      <p>Oblet</p>
      <p class="muted">双击任意 .md 文件即可编辑</p>
    </div>`;
    return;
  }

  const payload = await invoke<FilePayload>("read_file", { path });

  // 编辑器容器：对齐 Ob 阅读视图类名
  const host = document.createElement("div");
  host.className = "markdown-rendered";
  app.appendChild(host);

  if (payload.readonly_reason) {
    const banner = document.createElement("div");
    banner.className = "readonly-banner";
    banner.textContent = payload.readonly_reason;
    app.prepend(banner);
  }

  // ---- 保存状态机 ----
  let dirty = false;
  let saving = false;
  let pendingSave = false;
  let saveTimer: number | undefined;

  const flushSave = async () => {
    if (payload.readonly || !crepe) return;
    if (saving) {
      pendingSave = true;
      return;
    }
    const md = crepe.getMarkdown();
    saving = true;
    try {
      await invoke("write_file", { path, content: md, newline: payload.newline });
      dirty = false;
    } catch (e) {
      console.error("保存失败:", e);
    } finally {
      saving = false;
      if (pendingSave) {
        pendingSave = false;
        void flushSave();
      }
    }
  };

  const scheduleSave = () => {
    dirty = true;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushSave(), AUTOSAVE_DELAY);
  };

  // Ctrl+S 立即保存
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      window.clearTimeout(saveTimer);
      void flushSave();
    }
  });

  const crepe = new Crepe({
    root: host,
    defaultValue: payload.content,
    features: {
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.TopBar]: false,
    },
  });

  crepe.on((api) => {
    api.markdownUpdated(() => {
      if (!payload.readonly) scheduleSave();
    });
  });

  await crepe.create();
  if (payload.readonly) crepe.setReadonly(true);

  // ---- 外部变更：无脏内容自动重载，有则提示 ----
  const winLabel = getCurrentWindow().label;
  await listen(`file-changed:${winLabel}`, async () => {
    if (!dirty && !saving) {
      const fresh = await invoke<FilePayload>("read_file", { path });
      payload.newline = fresh.newline;
      crepe.editor.action(replaceAll(fresh.content));
    } else {
      const tip = document.createElement("div");
      tip.className = "external-change-tip";
      tip.textContent = "文件已被外部修改，当前有未保存内容，未自动重载。";
      app.prepend(tip);
      setTimeout(() => tip.remove(), 6000);
    }
  });
}
