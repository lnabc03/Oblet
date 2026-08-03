// Mica 调优 demo（开发工具）：手动调节窗口材质效果的各项参数，一键导出配置
// 快捷键 Ctrl+Shift+M 开关面板
import { invoke } from "@tauri-apps/api/core";
import { registerCommand } from "./commands";

// ---- 当前参数状态 ----
export interface MicaConfig {
  // 系统效果参数（Rust 侧）
  variant: string; // "mica" | "tabbed"
  dark: string; // "auto" | "dark" | "light"
  // CSS 覆盖（前端侧）
  overlayOpacity: number; // 背景遮罩透明度 0-1
  floatOpacity: number; // 浮层背景透明度 0-1
  floatBlur: number; // 浮层模糊 px 0-48
  floatSaturate: number; // 浮层饱和度 0-2
  btnOpacity: number; // 按钮透明度 0-1
  searchOpacity: number; // 搜索框透明度 0-1
}

// 默认值（与 CSS 中的 var() fallback 对齐）
const DEFAULTS: MicaConfig = {
  variant: "mica",
  dark: "dark",
  overlayOpacity: 0,
  floatOpacity: 0.8,
  floatBlur: 1,
  floatSaturate: 2,
  btnOpacity: 0.5,
  searchOpacity: 0.45,
};

// 当前生效值（面板内修改即更新）
let current: MicaConfig = { ...DEFAULTS };

// ---- DOM 引用 ----
let panel: HTMLElement | null = null;
let overlay: HTMLElement | null = null;

// 控件引用
let ctrlVariant: HTMLSelectElement;
let ctrlDark: HTMLSelectElement;
let ctrlOverlayOpacity: HTMLInputElement;
let ctrlFloatOpacity: HTMLInputElement;
let ctrlFloatBlur: HTMLInputElement;
let ctrlFloatSaturate: HTMLInputElement;
let ctrlBtnOpacity: HTMLInputElement;
let ctrlSearchOpacity: HTMLInputElement;
let txtOverlayOpacity: HTMLElement;
let txtFloatOpacity: HTMLElement;
let txtFloatBlur: HTMLElement;
let txtFloatSaturate: HTMLElement;
let txtBtnOpacity: HTMLElement;
let txtSearchOpacity: HTMLElement;
let jsonPreview: HTMLElement;

// ---- Rust 端应用效果 ----
async function applySystemEffect() {
  const darkMap: Record<string, boolean | null> = {
    auto: null,
    dark: true,
    light: false,
  };
  const variant = current.variant || null;
  const dark = darkMap[current.dark] ?? true;

  await invoke("tune_mica", { config: { variant, dark } }).catch((e) =>
    console.warn("tune_mica 失败:", e)
  );

  // 同步更新 settings 中的 window_effect（让主设置开关与调优面板不打架）
  const effectOn = variant ? variant : null;
  // 仅调 body 类，不写 settings（避免覆盖其他设置项）
  document.body.classList.toggle("ob-vibrancy", effectOn !== null);
}

// ---- CSS 端应用效果 ----
function applyCssOverrides() {
  const root = document.documentElement;
  const v = current;

  // overlayOpacity 0 = transparent, >0 = rgba(0,0,0,x)
  if (v.overlayOpacity <= 0.005) {
    root.style.removeProperty("--mica-overlay");
  } else {
    root.style.setProperty("--mica-overlay", `rgba(0,0,0,${v.overlayOpacity})`);
  }

  root.style.setProperty("--mica-float-opacity", String(v.floatOpacity));
  root.style.setProperty("--mica-float-blur", `${v.floatBlur}px`);
  root.style.setProperty("--mica-float-saturate", String(v.floatSaturate));
  root.style.setProperty("--mica-btn-opacity", String(v.btnOpacity));
  root.style.setProperty("--mica-search-opacity", String(v.searchOpacity));
}

// ---- 全局应用 ----
function applyAll() {
  applyCssOverrides();
  void applySystemEffect();
  updateJsonPreview();
}

// ---- JSON 预览与导出 ----
function buildExportJson(): string {
  return JSON.stringify(current, null, 2);
}

function updateJsonPreview() {
  jsonPreview.textContent = buildExportJson();
}

async function exportConfig() {
  const json = buildExportJson();
  try {
    await navigator.clipboard.writeText(json);
    showToast("✅ 配置已复制到剪贴板，请粘贴给我");
  } catch {
    // fallback：选中文本让用户手动复制
    jsonPreview.textContent = json;
    const range = document.createRange();
    range.selectNodeContents(jsonPreview);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    showToast("⚠️ 自动复制失败，已选中 JSON 文本，请手动 Ctrl+C");
  }
}

function resetDefaults() {
  current = { ...DEFAULTS };
  syncControlsToState();
  applyAll();
  showToast("已重置为默认值");
}

// ---- Toast ----
function showToast(msg: string) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => el.remove(), 2200);
}

// ---- 控件同步 ----
function syncControlsToState() {
  const v = current;
  ctrlVariant.value = v.variant;
  ctrlDark.value = v.dark;
  ctrlOverlayOpacity.value = String(v.overlayOpacity);
  txtOverlayOpacity.textContent = v.overlayOpacity.toFixed(2);
  ctrlFloatOpacity.value = String(v.floatOpacity);
  txtFloatOpacity.textContent = v.floatOpacity.toFixed(2);
  ctrlFloatBlur.value = String(v.floatBlur);
  txtFloatBlur.textContent = `${v.floatBlur}px`;
  ctrlFloatSaturate.value = String(v.floatSaturate);
  txtFloatSaturate.textContent = v.floatSaturate.toFixed(2);
  ctrlBtnOpacity.value = String(v.btnOpacity);
  txtBtnOpacity.textContent = v.btnOpacity.toFixed(2);
  ctrlSearchOpacity.value = String(v.searchOpacity);
  txtSearchOpacity.textContent = v.searchOpacity.toFixed(2);
}

// ---- 面板 HTML ----
const PANEL_HTML = /* html */ `
<div class="mica-tuner-panel">
  <div class="mica-tuner-header">
    <span>🎨 Mica 调优</span>
    <button class="mica-tuner-close" title="关闭 (Esc)">✕</button>
  </div>
  <div class="mica-tuner-body">

    <div class="mica-tuner-group">
      <div class="mica-tuner-group-title">系统效果</div>
      <label class="mica-tuner-row">
        <span>变体</span>
        <select id="mt-variant">
          <option value="mica">Mica（标准）</option>
          <option value="tabbed">Mica Tabbed（标签页式）</option>
          <option value="">关闭效果</option>
        </select>
      </label>
      <label class="mica-tuner-row">
        <span>暗色模式</span>
        <select id="mt-dark">
          <option value="auto">跟随系统</option>
          <option value="dark">强制暗色</option>
          <option value="light">强制亮色</option>
        </select>
      </label>
    </div>

    <div class="mica-tuner-group">
      <div class="mica-tuner-group-title">背景遮罩（overlay）</div>
      <label class="mica-tuner-row">
        <span>透明度 <em id="mt-v-overlay">0.00</em></span>
        <input type="range" id="mt-overlay" min="0" max="1" step="0.01" value="0">
      </label>
      <p class="mica-tuner-hint">在 Mica 材质上叠加黑色半透明遮罩，值越大背景越暗</p>
    </div>

    <div class="mica-tuner-group">
      <div class="mica-tuner-group-title">浮层面板（设置/toast/菜单/确认框）</div>
      <label class="mica-tuner-row">
        <span>透明度 <em id="mt-v-float-o">0.80</em></span>
        <input type="range" id="mt-float-opacity" min="0.1" max="1" step="0.01" value="0.8">
      </label>
      <label class="mica-tuner-row">
        <span>模糊度 <em id="mt-v-blur">1px</em></span>
        <input type="range" id="mt-blur" min="0" max="48" step="1" value="1">
      </label>
      <label class="mica-tuner-row">
        <span>饱和度 <em id="mt-v-saturate">2.00</em></span>
        <input type="range" id="mt-saturate" min="0" max="2" step="0.05" value="2">
      </label>
    </div>

    <div class="mica-tuner-group">
      <div class="mica-tuner-group-title">控件按钮（大头针/设置齿轮）</div>
      <label class="mica-tuner-row">
        <span>透明度 <em id="mt-v-btn">0.50</em></span>
        <input type="range" id="mt-btn-opacity" min="0.1" max="1" step="0.01" value="0.5">
      </label>
    </div>

    <div class="mica-tuner-group">
      <div class="mica-tuner-group-title">搜索框输入栏</div>
      <label class="mica-tuner-row">
        <span>透明度 <em id="mt-v-search">0.45</em></span>
        <input type="range" id="mt-search-opacity" min="0.1" max="1" step="0.01" value="0.45">
      </label>
    </div>

    <div class="mica-tuner-group">
      <div class="mica-tuner-group-title">当前配置</div>
      <pre class="mica-tuner-json" id="mt-json"></pre>
      <div class="mica-tuner-actions">
        <button id="mt-export" class="mica-tuner-btn primary">📋 复制导出</button>
        <button id="mt-reset" class="mica-tuner-btn">↩ 重置默认</button>
      </div>
    </div>

  </div>
</div>
`;

// ---- 初始化 ----
export function initMicaTuner() {
  // 创建面板 DOM（与设置浮层同级，初始隐藏）
  overlay = document.createElement("div");
  overlay.className = "mica-tuner-overlay hidden";
  overlay.innerHTML = PANEL_HTML;
  document.body.appendChild(overlay);

  panel = overlay.querySelector(".mica-tuner-panel")!;

  // 缓存控件引用
  ctrlVariant = document.getElementById("mt-variant") as HTMLSelectElement;
  ctrlDark = document.getElementById("mt-dark") as HTMLSelectElement;
  ctrlOverlayOpacity = document.getElementById("mt-overlay") as HTMLInputElement;
  ctrlFloatOpacity = document.getElementById("mt-float-opacity") as HTMLInputElement;
  ctrlFloatBlur = document.getElementById("mt-blur") as HTMLInputElement;
  ctrlFloatSaturate = document.getElementById("mt-saturate") as HTMLInputElement;
  ctrlBtnOpacity = document.getElementById("mt-btn-opacity") as HTMLInputElement;
  ctrlSearchOpacity = document.getElementById("mt-search-opacity") as HTMLInputElement;
  txtOverlayOpacity = document.getElementById("mt-v-overlay")!;
  txtFloatOpacity = document.getElementById("mt-v-float-o")!;
  txtFloatBlur = document.getElementById("mt-v-blur")!;
  txtFloatSaturate = document.getElementById("mt-v-saturate")!;
  txtBtnOpacity = document.getElementById("mt-v-btn")!;
  txtSearchOpacity = document.getElementById("mt-v-search")!;
  jsonPreview = document.getElementById("mt-json")!;

  // 控件事件绑定
  const onSlider = (
    slider: HTMLInputElement,
    label: HTMLElement,
    setter: (v: number) => void,
    fmt: (v: number) => string
  ) => {
    slider.addEventListener("input", () => {
      const v = parseFloat(slider.value);
      setter(v);
      label.textContent = fmt(v);
      applyAll();
    });
  };

  ctrlVariant.addEventListener("change", () => {
    current.variant = ctrlVariant.value;
    applyAll();
  });

  ctrlDark.addEventListener("change", () => {
    current.dark = ctrlDark.value;
    applyAll();
  });

  onSlider(ctrlOverlayOpacity, txtOverlayOpacity, (v) => (current.overlayOpacity = v), (v) => v.toFixed(2));
  onSlider(ctrlFloatOpacity, txtFloatOpacity, (v) => (current.floatOpacity = v), (v) => v.toFixed(2));
  onSlider(ctrlFloatBlur, txtFloatBlur, (v) => (current.floatBlur = v), (v) => `${v}px`);
  onSlider(ctrlFloatSaturate, txtFloatSaturate, (v) => (current.floatSaturate = v), (v) => v.toFixed(2));
  onSlider(ctrlBtnOpacity, txtBtnOpacity, (v) => (current.btnOpacity = v), (v) => v.toFixed(2));
  onSlider(ctrlSearchOpacity, txtSearchOpacity, (v) => (current.searchOpacity = v), (v) => v.toFixed(2));

  // 导出按钮
  document.getElementById("mt-export")!.addEventListener("click", () => void exportConfig());
  // 重置按钮
  document.getElementById("mt-reset")!.addEventListener("click", resetDefaults);

  // 关闭按钮 & 遮罩点击关闭
  overlay.querySelector(".mica-tuner-close")!.addEventListener("click", () => toggle(false));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) toggle(false);
  });

  // 注册快捷键
  registerCommand({
    id: "mica-tuner",
    title: "Mica 调优面板",
    defaultCombo: "Ctrl+Shift+M",
    run: () => toggle(!isOpen()),
  });

  // Esc 关闭
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && isOpen()) {
        toggle(false);
        e.stopImmediatePropagation();
      }
    },
    true
  );

  // 初始化 JSON 预览
  syncControlsToState();
  updateJsonPreview();
}

// ---- 开关控制 ----
function isOpen(): boolean {
  return overlay != null && !overlay.classList.contains("hidden");
}

export function toggle(show: boolean) {
  if (!overlay) return;
  if (show) {
    // 打开时从当前运行状态回读控件值（保证与 CSS 属性一致）
    syncControlsFromRuntime();
    overlay.classList.remove("hidden");
  } else {
    overlay.classList.add("hidden");
  }
}

/** 从 DOM 上当前的 --mica-* 值回读到 current 对象（打开面板时同步） */
function syncControlsFromRuntime() {
  const root = document.documentElement;
  const readNum = (prop: string, def: number): number => {
    const v = root.style.getPropertyValue(prop);
    if (!v) return def;
    const n = parseFloat(v);
    return isNaN(n) ? def : n;
  };
  const readPx = (prop: string, def: number): number => {
    const v = root.style.getPropertyValue(prop);
    if (!v) return def;
    const n = parseInt(v, 10);
    return isNaN(n) ? def : n;
  };

  // overlay 特殊处理：读 --mica-overlay 的 alpha 分量
  const ov = root.style.getPropertyValue("--mica-overlay");
  if (ov && ov.includes("rgba")) {
    const m = ov.match(/[\d.]+\)$/);
    if (m) {
      const a = parseFloat(m[0].replace(")", ""));
      if (!isNaN(a)) current.overlayOpacity = a;
    }
  } else if (!ov) {
    // property 未设置 → 当前为 0（transparent）
    // 保持 current 中的值不变
  }

  current.floatOpacity = readNum("--mica-float-opacity", current.floatOpacity);
  current.floatBlur = readPx("--mica-float-blur", current.floatBlur);
  current.floatSaturate = readNum("--mica-float-saturate", current.floatSaturate);
  current.btnOpacity = readNum("--mica-btn-opacity", current.btnOpacity);
  current.searchOpacity = readNum("--mica-search-opacity", current.searchOpacity);

  // variant 和 dark 不从 DOM 读取（只有 Rust 侧知道），保持 current 值
  syncControlsToState();
  updateJsonPreview();
}
