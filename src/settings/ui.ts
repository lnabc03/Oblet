// 设置浮层：排版/编辑器/界面覆盖（主题已固化为 AnuPpuccin 深色单主题，不再可选）
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
      </div>
      <div class="settings-section">
        <h3>编辑器</h3>
        <label class="check-row">
          <input type="checkbox" data-check="auto_save" data-default="true">
          <span>自动保存</span>
        </label>
        <label class="check-row">
          <input type="checkbox" data-check="show_active_block" data-default="true">
          <span>光标所在块底色</span>
        </label>
        <label class="check-row">
          <input type="checkbox" data-check="code_block_wrap">
          <span>代码块自动换行</span>
        </label>
      </div>
      <div class="settings-section">
        <h3>界面</h3>
        <label class="check-row">
          <input type="checkbox" id="mica-toggle">
          <span>Mica 窗口效果（Win11）</span>
        </label>
        <label class="check-row">
          <input type="checkbox" data-check="show_author" data-default="true">
          <span>起始页显示署名</span>
        </label>
      </div>
      <div class="settings-section">
        <h3>Obsidian</h3>
        <div class="typo-grid">
          <label>笔记存放至</label>
          <input type="text" data-typo="vault_dir" class="vault-input"
                 placeholder="如 D:\Notes\MyVault\收件箱（留空 = 未配置）">
        </div>
      </div>
      <div class="settings-section">
        <h3>快捷键</h3>
        <div class="keymap-list"></div>
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
    const s = await getSettings();
    const ed = s.editor as unknown as Record<string, unknown>;
    // 排版输入：回填当前值
    overlay
      .querySelectorAll<HTMLInputElement>("input[data-typo]")
      .forEach((input) => {
        const v = ed[input.dataset.typo!];
        input.value = v == null ? "" : String(v);
      });
    // 复选框：默认值由 data-default 声明（默认 false）；值为 null 时按默认值显示
    overlay
      .querySelectorAll<HTMLInputElement>("input[data-check]")
      .forEach((input) => {
        const def = input.dataset.default === "true";
        const v = ed[input.dataset.check!];
        input.checked = v == null ? def : v === true;
      });
    // Mica 开关：window_effect === "mica"
    overlay.querySelector<HTMLInputElement>("#mica-toggle")!.checked =
      ed.window_effect === "mica";
    renderKeymapList();
  }

  // Mica 开关（十一轮：Acrylic 已删，窗口效果收敛为 Mica 开关）
  overlay
    .querySelector<HTMLInputElement>("#mica-toggle")!
    .addEventListener("change", async (e) => {
      const on = (e.target as HTMLInputElement).checked;
      await switchTypography({ window_effect: on ? "mica" : null });
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
