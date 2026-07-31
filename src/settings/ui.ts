// 设置浮层：排版覆盖（主题已固化为 AnuPpuccin 深色单主题，不再可选）
import {
  getSettings,
  setKeybinding,
  switchTypography,
} from "./typography";
import {
  comboOf,
  effectiveCombo,
  listCommands,
  registerCommand,
  setKeymapCaptureActive,
} from "../commands";

export async function initSettingsUI(container: HTMLElement) {
  // 设置按钮（右上角浮动）
  const btn = document.createElement("button");
  btn.className = "settings-btn";
  btn.textContent = "⚙";
  btn.title = "设置 (Ctrl+/)";
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
      <div class="settings-section">
        <h3>快捷键</h3>
        <div class="keymap-list"></div>
        <p class="muted small">点击组合键后按新键位；Esc 取消；双击恢复默认</p>
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
  // Ctrl+/（4.4 起经命令注册表统一派发，键位可在设置中覆盖）
  // 默认从 Ctrl+, 改为 Ctrl+/：部分输入法/键盘布局下 Comma 键码不可靠（用户批示）
  registerCommand({
    id: "settings",
    title: "设置",
    defaultCombo: "Ctrl+/",
    run: () => {
      toggle(overlay.classList.contains("hidden"));
      if (!overlay.classList.contains("hidden")) void renderPanel();
    },
  });
  // Esc 关闭浮层是面板自身行为，不进命令表
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") toggle(false);
    },
    true
  );

  // 快捷键列表：当前生效组合（覆盖 > 默认）；点击进入捕获模式，双击恢复默认
  function renderKeymapList() {
    const host = overlay.querySelector(".keymap-list");
    if (!host) return;
    host.innerHTML = "";
    for (const cmd of listCommands()) {
      const row = document.createElement("div");
      row.className = "keymap-row";
      const label = document.createElement("span");
      label.textContent = cmd.title;
      const btn = document.createElement("button");
      btn.className = "keymap-combo";
      btn.textContent = effectiveCombo(cmd);
      btn.addEventListener("click", () => {
        // 捕获模式：派发器静默（否则按 Ctrl+S 改键会先触发保存）
        setKeymapCaptureActive(true);
        btn.classList.add("capturing");
        btn.textContent = "按下新组合…";
        const onKey = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          window.removeEventListener("keydown", onKey, true);
          setKeymapCaptureActive(false);
          btn.classList.remove("capturing");
          if (e.key === "Escape") {
            btn.textContent = effectiveCombo(cmd); // 取消
            return;
          }
          const combo = comboOf(e);
          if (!combo) {
            // 纯修饰键：继续等下一键
            btn.textContent = "按下新组合…";
            window.addEventListener("keydown", onKey, true);
            return;
          }
          void setKeybinding(cmd.id, combo).then(renderKeymapList);
        };
        window.addEventListener("keydown", onKey, true);
      });
      btn.addEventListener("dblclick", () => {
        void setKeybinding(cmd.id, null).then(renderKeymapList);
      });
      row.appendChild(label);
      row.appendChild(btn);
      host.appendChild(row);
    }
  }

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
    renderKeymapList();
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
