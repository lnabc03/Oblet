// 从 CHANGELOG.md 提取当前版本（tauri.conf.json version）的变更说明，
// 写入 release/release-notes.md，作为 GitHub Release 正文（body_path）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")
).version;
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

// 定位当前版本标题（形如 "## [0.4.2]"），提取到下一个 "## [" 之前
const marker = `## [${version}]`;
const start = changelog.indexOf(marker);
if (start < 0) {
  console.error(`CHANGELOG.md 未找到版本标题: ${marker}`);
  process.exit(1);
}
// 跳过标题行剩余部分（日期等），从下一行开始提取
const lineEnd = changelog.indexOf("\n", start);
if (lineEnd < 0) process.exit(1);
const afterStart = lineEnd + 1;
const next = changelog.indexOf("\n## [", afterStart);
const body = changelog.slice(afterStart, next < 0 ? undefined : next).trim();

const out = join(root, "release", "release-notes.md");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, body + "\n", "utf8");
console.log(`已提取 ${version} 变更说明（${body.length} 字符）→ ${out}`);
