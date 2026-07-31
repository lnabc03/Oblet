// Oblet 入口 —— 编辑器装配见 editor/setup.ts
// CSS 顺序敏感：Crepe 样式最先，obsidian-base.css 在其后压制 Crepe reset 的 px 钉值，
// AnuPpuccin 定制主题最后（变量定义覆盖基座 fallback）
import "@milkdown/crepe/theme/common/style.css";
import "./styles/obsidian-base.css";
import "./styles/anuppuccin-custom.css";
import { boot } from "./editor/setup";

// 4.5 当前行高亮原型：主题里 anp-current-line 的 CM5 选择器是死规则，
// 实际显隐由这个类门控 .ob-active-block 原型样式——评审后保留或移除，不留中间态
document.body.classList.add("anp-current-line");

boot().catch((e) => {
  document.body.innerHTML = `<pre style="color:red;padding:2em">启动失败: ${e}</pre>`;
});
