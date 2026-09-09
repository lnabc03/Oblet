// 设置浮层：排版/编辑器/界面覆盖（主题 = 白名单注册表选择 × 深/浅/跟随系统模式）
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  currentEditorSettings,
  getSettings,
  resolveTheme,
  setKeybinding,
  switchTypography,
} from "./typography";
import { resolveThemeId, THEMES } from "./theme-classes";
import {
  comboOf,
  effectiveCombo,
  listCommands,
  registerCommand,
  setKeymapCaptureActive,
} from "../commands";

/** 置顶按钮 SVG 大头针路径（纯色，跟随 currentColor，与 ⚙ 同款设计语言） */
const PIN_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="3.5" r="2.2"/><line x1="8" y1="5.5" x2="8" y2="14.5"/></svg>`;

export async function initSettingsUI(container: HTMLElement) {
  // ---- 置顶按钮（左上角浮动，纯色 SVG 大头针图标） ----
  const pinBtn = document.createElement("button");
  pinBtn.className = "pin-btn";
  pinBtn.innerHTML = PIN_SVG;
  pinBtn.title = "窗口置顶 (Alt+P)";
  let pinned = false;
  const togglePin = async () => {
    pinned = !pinned;
    pinBtn.classList.toggle("pinned", pinned);
    pinBtn.title = pinned ? "取消置顶 (Alt+P)" : "窗口置顶 (Alt+P)";
    await getCurrentWindow().setAlwaysOnTop(pinned);
  };
  pinBtn.addEventListener("click", togglePin);
  document.body.appendChild(pinBtn);

  // Alt+P 快捷键（经命令注册表统一派发，键位可在设置中覆盖）
  registerCommand({
    id: "toggle-pin",
    title: "窗口置顶",
    defaultCombo: "Alt+P",
    run: togglePin,
  });

  // Ctrl+T 深浅切换：按当前**解析后**的主题取反并显式落盘（system 模式下同样生效，
  // 切换后脱离跟随；想恢复跟随在设置面板选回）
  registerCommand({
    id: "toggle-theme",
    title: "切换深色/浅色",
    defaultCombo: "Ctrl+T",
    run: () => {
      const resolved = resolveTheme(currentEditorSettings().theme_mode);
      void switchTypography({
        theme_mode: resolved === "dark" ? "light" : "dark",
      });
    },
  });

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
          <input type="text" data-typo="text_font" placeholder="霞鹜臻楷 GB">
          <label>等宽字体</label>
          <input type="text" data-typo="mono_font" placeholder="JetBrainsMonoNL NF">
          <label>界面字体</label>
          <input type="text" data-typo="interface_font" placeholder="华文中宋">
          <label>基础字号</label>
          <input type="number" data-typo="base_font_size" min="12" max="32" placeholder="17">
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
          <span>当前行底色</span>
        </label>
        <label class="check-row">
          <input type="checkbox" data-check="code_block_wrap">
          <span>代码自动换行</span>
        </label>
        <label class="check-row">
          <input type="checkbox" data-check="toc" data-default="true">
          <span>悬浮目录</span>
        </label>
      </div>
      <div class="settings-section">
        <h3>界面</h3>
        <label class="check-row">
          <span>主题</span>
          <select id="theme-id-select"></select>
        </label>
        <label class="check-row">
          <span>主题模式</span>
          <select id="theme-mode-select">
            <option value="dark">深色</option>
            <option value="light">浅色</option>
            <option value="system">跟随系统</option>
          </select>
        </label>
        <label class="check-row">
          <input type="checkbox" data-check="show_author" data-default="true">
          <span>版本与署名</span>
        </label>
        <label class="check-row">
          <input type="checkbox" data-check="allow_multi_window">
          <span>多窗口编辑</span>
        </label>
        <label class="check-row">
          <input type="checkbox" data-check="transition_animation">
          <span>过渡动画</span>
        </label>
      </div>
      <div class="settings-section">
        <h3>路径</h3>
        <div class="typo-grid">
          <label>笔记新建至</label>
          <input type="text" data-typo="new_note_dir" class="vault-input" placeholder="默认为用户桌面">
          <label>笔记另存至</label>
          <input type="text" data-typo="vault_dir" class="vault-input" placeholder="">
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
  // 仅当设置面板开着时才吞 Esc（stopImmediatePropagation 阻止编辑器 Esc handler 误触退回起始页）
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
        toggle(false);
        e.stopImmediatePropagation();
      }
    },
    true
  );

  // 快捷键列表：当前生效组合（覆盖 > 默认）；点击进入捕获模式，双击恢复默认
  function renderKeymapList() {
    const host = overlay.querySelector(".keymap-list");
    if (!host) return;
    host.innerHTML = "";
    // 快捷键列表顺序：设置 → 窗口置顶 → 其余按注册序
    const order = ["settings", "toggle-pin"];
    const cmds = [...listCommands()].sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return 0;
    });
    for (const cmd of cmds) {
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
    // 主题：null = AnuPpuccin（默认）
    overlay.querySelector<HTMLSelectElement>("#theme-id-select")!.value =
      resolveThemeId(ed.theme_id as string | null).id;
    // 主题模式：null = 深色（默认）
    overlay.querySelector<HTMLSelectElement>("#theme-mode-select")!.value =
      (ed.theme_mode as string | null) ?? "dark";
    renderKeymapList();
  }

  // 主题选择（多主题二期）：选项由注册表生成；保存即广播，各窗口即时换肤
  const themeIdSelect = overlay.querySelector<HTMLSelectElement>("#theme-id-select")!;
  for (const t of THEMES) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    themeIdSelect.appendChild(opt);
  }
  themeIdSelect.addEventListener("change", async (e) => {
    const v = (e.target as HTMLSelectElement).value;
    await switchTypography({ theme_id: v === "anuppuccin" ? null : v });
  });

  // 主题模式（多主题一期）：三选，默认深色写回 null（文件自说明）；
  // 保存即广播，各窗口即时换肤（Mica dark 参数随 applyTypography 重放）
  overlay
    .querySelector<HTMLSelectElement>("#theme-mode-select")!
    .addEventListener("change", async (e) => {
      const v = (e.target as HTMLSelectElement).value;
      await switchTypography({
        theme_mode: v === "dark" ? null : (v as "light" | "system"),
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
        // 过渡动画：即时镜像 localStorage——本会话内的 reload（Esc/追加 tab）
        // 由 splash-early.js 读它决定首帧显隐，不等下次启动收敛
        if (input.dataset.check === "transition_animation") {
          try {
            localStorage.setItem("oblet.transition_animation", String(input.checked));
          } catch { /* 忽略 */ }
        }
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
