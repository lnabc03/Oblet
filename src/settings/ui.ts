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
      <div class="settings-section">
        <h3>编辑器</h3>
        <label class="check-row">
          <input type="checkbox" data-check="code_block_wrap">
          <span>代码块自动换行</span>
        </label>
      </div>
      <div class="settings-section">
        <h3>界面</h3>
        <label class="check-row">
          <input type="checkbox" data-check="show_author" data-default="true">
          <span>起始页显示署名</span>
        </label>
        <label class="check-row">
          <span>窗口效果</span>
          <select data-select="window_effect">
            <option value="">关闭</option>
            <option value="mica">Mica（Win11）</option>
            <option value="acrylic">Acrylic（Win10/11）</option>
          </select>
        </label>
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
  window.addEventListener(
    "keydown",
    (e) => {
      // 物理键码判定（e.code）：中文输入法下 e.key 可能是全角"，"；
      // capture 阶段拦截：焦点在 CM/PM 内部编辑器时事件可能被 stopPropagation，
      // 冒泡阶段的监听器收不到
      if ((e.ctrlKey || e.metaKey) && e.code === "Comma") {
        e.preventDefault();
        toggle(overlay.classList.contains("hidden"));
        if (!overlay.classList.contains("hidden")) void renderPanel();
      }
      if (e.key === "Escape") toggle(false);
    },
    true
  );

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
    overlay
      .querySelectorAll<HTMLInputElement>("input[data-check]")
      .forEach((input) => {
        const key = input.dataset.check as "code_block_wrap" | "show_author";
        // 复选框默认值由 data-default 声明（默认 false）；值为 null 时按默认值显示
        const def = input.dataset.default === "true";
        const v = s.editor[key];
        input.checked = v == null ? def : v === true;
      });
    // 下拉框：回填当前值
    overlay
      .querySelectorAll<HTMLSelectElement>("select[data-select]")
      .forEach((sel) => {
        const key = sel.dataset.select as "window_effect";
        sel.value = s.editor[key] ?? "";
      });
  }

  // 下拉框：change 即保存应用；空串 = 关闭（写回 null）
  overlay
    .querySelectorAll<HTMLSelectElement>("select[data-select]")
    .forEach((sel) => {
      sel.addEventListener("change", async () => {
        const patch: Record<string, string | null> = {};
        patch[sel.dataset.select!] = sel.value || null;
        await switchTypography(patch);
      });
    });

  // 复选框：change 即保存应用；取值为默认值时写回 null（跟随默认，文件自说明）
  overlay
    .querySelectorAll<HTMLInputElement>("input[data-check]")
    .forEach((input) => {
      input.addEventListener("change", async () => {
        const def = input.dataset.default === "true";
        const patch: Record<string, boolean | null> = {};
        patch[input.dataset.check!] = input.checked === def ? null : input.checked;
        await switchTypography(patch);
      });
    });

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
