// Oblet 入口 —— 编辑器装配见 editor/setup.ts
// CSS 顺序敏感：Crepe 样式最先，obsidian-base.css 在其后压制 Crepe reset 的 px 钉值，
// AnuPpuccin 定制主题最后（变量定义覆盖基座 fallback）
import "@milkdown/crepe/theme/common/style.css";
import "./styles/obsidian-base.css";
import "./styles/anuppuccin-custom.css";
import { boot } from "./editor/setup";
import { initKeymap } from "./commands";
import { initMicaTuner } from "./mica-tuner";

// 4.5 当前块高亮：主题里 anp-current-line 的 CM5 选择器是死规则，
// 实际显隐由这个类门控 .ob-active-block 样式。先默认加上（设置加载前的瞬时态），
// 设置项 show_active_block 生效后由 applyTypography 接管显隐
document.body.classList.add("anp-current-line");

void initKeymap();

// Mica 调优面板（开发工具 Ctrl+Shift+M），DOM 提前挂载，命令在 initKeymap 后注册
initMicaTuner();

boot().catch((e) => {
  document.body.innerHTML = `<pre style="color:red;padding:2em">启动失败: ${e}</pre>`;
});
