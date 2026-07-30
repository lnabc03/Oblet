// 设置浮层：主题列表 + 明暗切换 + 拖拽导入 theme.css
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getThemeState,
  listThemes,
  switchTheme,
  type ThemeInfo,
} from "../theme/loader";

export async function initSettingsUI(container: HTMLElement) {
  // 设置按钮（右上角浮动）
  const btn = document.createElement("button");
  btn.className = "settings-btn";
  btn.textContent = "⚙";
  btn.title = "设置 (Ctrl+,)";
  document.body.appendChild(btn);

  // 浮层
  const overlay = document.createElement("div");
  overlay.className = "settings-overlay hidden";
  overlay.innerHTML = `
    <div class="settings-panel">
      <div class="settings-header">
        <span>设置</span>
        <button class="settings-close">✕</button>
      </div>
      <div class="settings-section">
        <h3>外观模式</h3>
        <div class="mode-toggle">
          <button data-mode="light">浅色</button>
          <button data-mode="dark">深色</button>
        </div>
      </div>
      <div class="settings-section">
        <h3>主题</h3>
        <ul class="theme-list"></ul>
        <p class="muted small">把 Obsidian 主题的 theme.css 拖入窗口即可导入</p>
      </div>
    </div>`;
  container.appendChild(overlay);

  const toggle = (show: boolean) =>
    overlay.classList.toggle("hidden", !show);

  btn.addEventListener("click", () => {
    toggle(overlay.classList.contains("hidden"));
    if (!overlay.classList.contains("hidden")) void renderPanel();
  });
  overlay
    .querySelector(".settings-close")!
    .addEventListener("click", () => toggle(false));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) toggle(false);
  });
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === ",") {
      e.preventDefault();
      toggle(overlay.classList.contains("hidden"));
      if (!overlay.classList.contains("hidden")) void renderPanel();
    }
    if (e.key === "Escape") toggle(false);
  });

  async function renderPanel() {
    const { name, mode } = getThemeState();
    const themes = await listThemes();

    overlay.querySelectorAll<HTMLButtonElement>(".mode-toggle button").forEach(
      (b) => b.classList.toggle("active", b.dataset.mode === mode)
    );

    const ul = overlay.querySelector(".theme-list")!;
    ul.innerHTML = "";
    const items: (ThemeInfo | null)[] = [null, ...themes];
    for (const t of items) {
      const li = document.createElement("li");
      const label = t ? t.name : "默认";
      const author = t?.author ? ` <span class="muted">by ${t.author}</span>` : "";
      li.innerHTML = `<label><input type="radio" name="theme" ${
        (t?.name ?? null) === name ? "checked" : ""
      }> ${label}${author}</label>`;
      li.querySelector("input")!.addEventListener("change", async () => {
        await switchTheme(t?.name ?? null, getThemeState().mode);
        void renderPanel();
      });
      ul.appendChild(li);
    }
  }

  overlay.querySelectorAll<HTMLButtonElement>(".mode-toggle button").forEach(
    (b) =>
      b.addEventListener("click", async () => {
        await switchTheme(getThemeState().name, b.dataset.mode!);
        void renderPanel();
      })
  );

  // 拖拽导入 theme.css
  await getCurrentWindow().onDragDropEvent(async (e) => {
    if (e.payload.type !== "drop") return;
    for (const path of e.payload.paths) {
      if (!path.toLowerCase().endsWith("theme.css")) continue;
      try {
        const name = await invoke<string>("import_theme", { cssPath: path });
        await switchTheme(name, getThemeState().mode);
        if (!overlay.classList.contains("hidden")) void renderPanel();
      } catch (err) {
        console.error("导入主题失败:", err);
      }
    }
  });
}
