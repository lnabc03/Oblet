// Oblet 入口 —— 编辑器装配见 editor/setup.ts
import "./styles/obsidian-base.css";
import { boot } from "./editor/setup";

boot().catch((e) => {
  document.body.innerHTML = `<pre style="color:red;padding:2em">启动失败: ${e}</pre>`;
});
