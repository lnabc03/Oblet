// 设置浮层：排版覆盖（主题已固化为 AnuPpuccin 深色单主题，不再可选）
import {
  getSettings,
  switchTypography,
} from "./typography";

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
        <h3>排版</h3>
        <div class="typo-grid">
          <label>正文字体</label>
          <input type="text" data-typo="text_font" placeholder="跟随主题">
          <label>等宽字体</label>
          <input type="text" data-typo="mono_font" placeholder="跟随主题">
          <label>界面字体</label>
          <input type="text" data-typo="interface_font" placeholder="跟随主题">
          <label>基础字号</label>
          <input type="number" data-typo="base_font_size" min="12" max="32" placeholder="跟随主题">
        </div>
        <p class="muted small">留空则跟随主题；修改后失焦或回车生效</p>
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
    // 排版：回填当前值
    const s = await getSettings();
    overlay
      .querySelectorAll<HTMLInputElement>("input[data-typo]")
      .forEach((input) => {
        const key = input.dataset.typo as
          | "text_font"
          | "mono_font"
          | "interface_font"
          | "base_font_size";
        const v = s.editor[key];
        input.value = v == null ? "" : String(v);
      });
  }

  // 排版输入：change（失焦/回车）即保存并应用；留空 = 清除覆盖
  overlay
    .querySelectorAll<HTMLInputElement>("input[data-typo]")
    .forEach((input) => {
      input.addEventListener("change", async () => {
        const key = input.dataset.typo!;
        const raw = input.value.trim();
        const patch: Record<string, string | number | null> = {};
        patch[key] =
          key === "base_font_size"
            ? raw
              ? Math.min(32, Math.max(12, Number(raw) || 16))
              : null
            : raw || null;
        await switchTypography(patch);
      });
    });
}
