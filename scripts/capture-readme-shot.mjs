// README 截图（批次 6）：CDP 直连真实 exe 的 WebView2，Page.captureScreenshot 截屏。
// 测试 md 覆盖 README 需要的元素：深色主题 + 属性栏（frontmatter）+ callout + 代码块 + ==高亮==。
// 用法：node scripts/capture-readme-shot.mjs [输出.png]（默认 release/readme-shot.png）
import { writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const outPng = resolve(process.argv[2] ?? "release/readme-shot.png");
const reproDir = resolve("scripts/.repro");
mkdirSync(reproDir, { recursive: true });
const testMd = resolve(reproDir, "readme-shot.md");
writeFileSync(
  testMd,
  `---
title: Oblet 截图示例
tags: [markdown, 编辑器]
status: 进行中
---

# 欢迎使用 Oblet

轻量、快速的独立 Markdown 编辑器，与 Obsidian 双向兼容。
支持 ==高亮==、callout 与属性栏，保存**绝不改写**原文。

> [!tip] 双击即编辑
> 每个文件一个窗口，自动保存，无需任何配置。

\`\`\`python
def hello(name: str) -> None:
    print(f"Hello, {name}!")
\`\`\`

- [x] 序列化保真
- [x] AnuPpuccin 深色主题
- [ ] 更多打磨中
`
);

const DEBUG_PORT = 9334;
const exe = resolve("release/Oblet/oblet.exe");
const child = spawn(exe, [testMd], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEBUG_PORT}`,
  },
  detached: true,
  stdio: "ignore",
});
child.unref();

const base = `http://127.0.0.1:${DEBUG_PORT}`;
let target = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const list = await (await fetch(`${base}/json/list`)).json();
    const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
    if (page) { target = page; break; }
  } catch { /* 端口未就绪 */ }
}
if (!target) { console.error("CDP 端口未就绪"); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) =>
  (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result;

// 等编辑器装配 + 代码块懒挂载 + 属性栏/callout 渲染
await new Promise((r) => setTimeout(r, 6000));

//  sanity check：关键元素都在再截
const ready = await evaluate(`({
  editor: !!document.querySelector(".ProseMirror"),
  frontmatter: !!document.querySelector(".ob-frontmatter"),
  callout: !!document.querySelector(".callout"),
  codeBlock: !!document.querySelector(".milkdown-code-block .cm-editor"),
})`);
console.log("元素就绪:", JSON.stringify(ready?.result?.value ?? ready));

// 截屏（从页面合成层直接抓，不含窗口边框）
const shot = await send("Page.captureScreenshot", { format: "png" });
if (!shot.result?.data) { console.error("截图失败", JSON.stringify(shot).slice(0, 300)); process.exit(1); }
writeFileSync(outPng, Buffer.from(shot.result.data, "base64"));
console.log("截图已存:", outPng);

await evaluate(`window.close()`).catch(() => {});
process.exit(0);
