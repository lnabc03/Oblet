// Oblet 入口 —— 编辑器装配见 editor/setup.ts
// CSS 顺序敏感：Crepe 样式最先，obsidian-base.css 在其后压制 Crepe reset 的 px 钉值，
// AnuPpuccin 定制主题最后（变量定义覆盖基座 fallback）
import "@milkdown/crepe/theme/common/style.css";
import "./styles/obsidian-base.css";
import "./styles/anuppuccin-custom.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { boot } from "./editor/setup";
import { initKeymap } from "./commands";

// 窗口初始隐藏（lib.rs visible(false)）：透明窗口从 WebView2 就绪到首帧 paint
// 之间会白屏/透屏/异常渲染，等首帧画好后再揭窗。Rust 侧有 3s 兜底。
// 过渡动画关闭时（设置项 transition_animation）：窗口尚隐藏，摘除 splash 不可见，
// 用户看到的是素底加载页而非 logo 动画
void (async () => {
  let splashOn = true;
  try {
    const s = await invoke<{ editor?: { transition_animation?: boolean | null } }>(
      "get_settings"
    );
    splashOn = s.editor?.transition_animation !== false;
  } catch { /* 读取失败按默认开 */ }
  if (!splashOn) document.getElementById("ob-splash")?.remove();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      void getCurrentWindow().show();
    })
  );
})();

// 4.5 当前块高亮：主题里 anp-current-line 的 CM5 选择器是死规则，
// 实际显隐由这个类门控 .ob-active-block 样式。先默认加上（设置加载前的瞬时态），
// 设置项 show_active_block 生效后由 applyTypography 接管显隐
document.body.classList.add("anp-current-line");

void initKeymap();

/** 过渡动画淡出：先加 class 触发 CSS transition，transitionend 后移除节点（超时兜底） */
const dismissSplash = () => {
  const splash = document.getElementById("ob-splash");
  if (!splash) return;
  splash.classList.add("ob-splash-hide");
  splash.addEventListener("transitionend", () => splash.remove(), { once: true });
  window.setTimeout(() => splash.remove(), 400);
};

boot()
  // 双 rAF：等编辑器内容真正画上一帧后再揭遮罩，避免露出半渲染状态
  .then(() => requestAnimationFrame(() => requestAnimationFrame(dismissSplash)))
  .catch((e) => {
    dismissSplash();
    document.body.innerHTML = `<pre style="color:red;padding:2em">启动失败: ${e}</pre>`;
  });
