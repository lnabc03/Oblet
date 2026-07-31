// 性能夹具生成：真实感 md（标题/段落/列表/任务/代码块/callout/高亮混合）
// 用法: node scripts/gen-perf-fixture.mjs <输出路径> <目标中文字数>
import { writeFileSync } from "node:fs";

const [out, targetArg] = process.argv.slice(2);
const target = Number(targetArg) || 100_000;

const PARA =
  "排版引擎的难点从来不在渲染本身，而在编辑与渲染之间的往返保真：用户在所见即所得模型里每一次击键，" +
  "都会被翻译成对文档树的结构性修改，序列化层必须保证未触碰的区域字节级不变。这意味着解析器、模型与" +
  "序列化器三者的约定要严丝合缝——列表的松紧、空行的归属、标记字符的转义边界，任何一处松动都会在" +
  "与外部编辑器协同编辑时暴露出来。\n\n";
const CODE = "```rust\nfn roundtrip(doc: &Document) -> String {\n    let mut out = String::with_capacity(doc.len());\n    for node in doc.blocks() {\n        out.push_str(&node.serialize());\n    }\n    out\n}\n```\n\n";
const LIST = "- 第一项：解析侧修剪，序列化侧不做补救\n- 第二项：==高亮== 与 `行内代码` 的配对边界\n  - 嵌套项：跨代码允许配对，代码内不配对\n- [x] 已完成：任务列表勾选状态保留\n- [ ] 待办：大文档增量装饰\n\n";
const CALLOUT = "> [!warning] 注意\n> 外部修改与自动保存竞态时，以用户未保存内容为优先，绝不静默覆盖。\n\n";

let chars = 0;
let i = 0;
let out$ = "---\ntitle: 性能测试文档\ntags: [perf, fixture]\n---\n\n# 性能测试文档\n\n";
const pieces = [PARA, CODE, PARA, LIST, PARA, CALLOUT];
while (chars < target) {
  const head = `## 第 ${++i} 节\n\n`;
  const body = pieces[i % pieces.length];
  out$ += head + body;
  chars += head.length + body.length;
}

writeFileSync(out, out$, "utf8");
console.log(`${out}: ${out$.length} chars, ${Buffer.byteLength(out$)} bytes`);
