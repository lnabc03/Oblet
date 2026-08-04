// Oblet 入口 —— 编辑器装配见 editor/setup.ts
// CSS 顺序敏感：Crepe 样式最先，obsidian-base.css 在其后压制 Crepe reset 的 px 钉值，
// AnuPpuccin 定制主题最后（变量定义覆盖基座 fallback）
import "@milkdown/crepe/theme/common/style.css";
import "./styles/obsidian-base.css";
import "./styles/anuppuccin-custom.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { boot } from "./editor/setup";
import { initKeymap } from "./commands";

// 窗口初始隐藏（lib.rs visible(false)）：透明窗口从 WebView2 就绪到首帧 paint
// 之间会白屏/透屏/异常渲染，等 splash 画上一帧后再揭窗。Rust 侧有 3s 兜底
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    void getCurrentWindow().show();
  })
);

// 4.5 当前块高亮：主题里 anp-current-line 的 CM5 选择器是死规则，
// 实际显隐由这个类门控 .ob-active-block 样式。先默认加上（设置加载前的瞬时态），
// 设置项 show_active_block 生效后由 applyTypography 接管显隐
document.body.classList.add("anp-current-line");

void initKeymap();

/** 启动遮罩淡出：先加 class 触发 CSS transition，transitionend 后移除节点（超时兜底） */
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
