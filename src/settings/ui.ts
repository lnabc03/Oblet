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
          <label>标题字体</label>
          <input type="text" data-typo="title_font" placeholder="跟随主题">
          <label>基础字号</label>
          <input type="number" data-num="base_font_size" min="12" max="32" placeholder="跟随主题">
          <label>行高</label>
          <input type="number" data-num="line_height" min="1.2" max="2.4" step="0.05" placeholder="1.75">
          <label>段间距 (em)</label>
          <input type="number" data-num="paragraph_gap" min="0" max="2" step="0.1" placeholder="0.4">
          <label>标题缩放</label>
          <input type="number" data-num="heading_scale" min="0.7" max="1.5" step="0.05" placeholder="1.0">
          <label>正文颜色</label>
          <span class="color-row">
            <input type="color" data-color="text_color">
            <button class="color-reset" data-reset="text_color" title="恢复跟随主题">✕</button>
          </span>
          <label>强调色</label>
          <span class="color-row">
            <input type="color" data-color="accent_color">
            <button class="color-reset" data-reset="accent_color" title="恢复跟随主题">✕</button>
          </span>
        </div>
        <p class="muted small">留空则跟随主题；修改后失焦或回车生效</p>
      </div>
      <div class="settings-section">
        <h3>编辑器</h3>
        <label class="check-row">
          <input type="checkbox" data-check="auto_save" data-default="true">
          <span>自动保存</span>
        </label>
        <label class="check-row">
          <span>自动保存延迟 (ms)</span>
          <input type="number" data-num="auto_save_delay_ms" min="200" max="10000" step="100" placeholder="1000">
        </label>
        <label class="check-row">
          <input type="checkbox" data-check="show_active_block" data-default="true">
          <span>光标所在块底色</span>
        </label>
        <label class="check-row">
          <span>块底色强度</span>
          <select data-select="active_block_alpha" data-select-type="number">
            <option value="">默认</option>
            <option value="0.02">几乎不可见</option>
            <option value="0.03">淡</option>
            <option value="0.06">适中</option>
            <option value="0.09">醒目</option>
            <option value="0.13">很醒目</option>
          </select>
        </label>
        <label class="check-row">
          <input type="checkbox" data-check="code_block_wrap">
          <span>代码块自动换行</span>
        </label>
      </div>
      <div class="settings-section">
        <h3>界面</h3>
        <label class="check-row">
          <span>底部留白 (px)</span>
          <input type="number" data-num="bottom_padding" min="0" max="800" step="10" placeholder="280">
        </label>
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
    const s = await getSettings();
    const ed = s.editor as unknown as Record<string, unknown>;
    // 文本输入：回填当前值
    overlay
      .querySelectorAll<HTMLInputElement>("input[data-typo]")
      .forEach((input) => {
        const v = ed[input.dataset.typo!];
        input.value = v == null ? "" : String(v);
      });
    // 数字输入：回填当前值
    overlay
      .querySelectorAll<HTMLInputElement>("input[data-num]")
      .forEach((input) => {
        const v = ed[input.dataset.num!];
        input.value = v == null ? "" : String(v);
      });
    // 颜色输入：无覆盖时显示一个中性占位色（不代表实际主题色）
    overlay
      .querySelectorAll<HTMLInputElement>("input[data-color]")
      .forEach((input) => {
        const v = ed[input.dataset.color!];
        input.value = typeof v === "string" && v ? v : "#888888";
      });
    // 复选框：默认值由 data-default 声明（默认 false）；值为 null 时按默认值显示
    overlay
      .querySelectorAll<HTMLInputElement>("input[data-check]")
      .forEach((input) => {
        const def = input.dataset.default === "true";
        const v = ed[input.dataset.check!];
        input.checked = v == null ? def : v === true;
      });
    // 下拉框：回填当前值
    overlay
      .querySelectorAll<HTMLSelectElement>("select[data-select]")
      .forEach((sel) => {
        const v = ed[sel.dataset.select!];
        sel.value = v == null ? "" : String(v);
      });
    renderKeymapList();
  }

  // 下拉框：change 即保存应用；空串 = 跟随默认（写回 null）；
  // data-select-type="number" 的选项值按数字解析（如块底色强度）
  overlay
    .querySelectorAll<HTMLSelectElement>("select[data-select]")
    .forEach((sel) => {
      sel.addEventListener("change", async () => {
        const patch: Record<string, string | number | null> = {};
        patch[sel.dataset.select!] =
          sel.dataset.selectType === "number"
            ? sel.value
              ? Number(sel.value)
              : null
            : sel.value || null;
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

  // 文本输入：change（失焦/回车）即保存并应用；留空 = 清除覆盖
  overlay
    .querySelectorAll<HTMLInputElement>("input[data-typo]")
    .forEach((input) => {
      input.addEventListener("change", async () => {
        const patch: Record<string, string | null> = {};
        patch[input.dataset.typo!] = input.value.trim() || null;
        await switchTypography(patch);
      });
    });

  // 数字输入：change 即保存并应用；按 min/max 夹取；留空 = 清除覆盖（跟随默认）
  overlay
    .querySelectorAll<HTMLInputElement>("input[data-num]")
    .forEach((input) => {
      input.addEventListener("change", async () => {
        const raw = input.value.trim();
        const patch: Record<string, number | null> = {};
        if (!raw) {
          patch[input.dataset.num!] = null;
        } else {
          const min = input.min ? Number(input.min) : -Infinity;
          const max = input.max ? Number(input.max) : Infinity;
          const n = Number(raw);
          patch[input.dataset.num!] = Number.isFinite(n)
            ? Math.min(max, Math.max(min, n))
            : null;
          input.value = patch[input.dataset.num!] == null ? "" : String(patch[input.dataset.num!]);
        }
        await switchTypography(patch);
      });
    });

  // 颜色输入：input 事件实时保存应用；✕ 按钮清除覆盖（跟随主题）
  overlay
    .querySelectorAll<HTMLInputElement>("input[data-color]")
    .forEach((input) => {
      input.addEventListener("input", async () => {
        const patch: Record<string, string | null> = {};
        patch[input.dataset.color!] = input.value;
        await switchTypography(patch);
      });
    });
  overlay
    .querySelectorAll<HTMLButtonElement>("button[data-reset]")
    .forEach((btn) => {
      btn.addEventListener("click", async () => {
        const patch: Record<string, string | null> = {};
        patch[btn.dataset.reset!] = null;
        await switchTypography(patch);
        void renderPanel();
      });
    });
}
