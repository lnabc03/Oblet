// 第三方许可归置（批次 6）：把生产依赖闭包的 LICENSE 收集到 licenses 目录
// 用法: node .github/collect-licenses.mjs [输出目录]（缺省 release/Oblet/licenses）
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = process.argv[2] ?? join(root, "release", "Oblet", "licenses");
mkdirSync(outDir, { recursive: true });

// npm ls 可能因 peer 告警非零退出，stdout 仍可用
let lsOut = "";
try {
  lsOut = execSync("npm ls --omit=dev --all --parseable", { cwd: root, encoding: "utf8" });
} catch (e) {
  lsOut = e.stdout ?? "";
}
const dirs = lsOut.trim().split("\n").slice(1).filter(Boolean);

const LICENSE_RE = /^(licen[cs]e|copying|notice)(\.(txt|md))?$/i;
let copied = 0;
const missing = [];
for (const dir of dirs) {
  const pkgJson = join(dir, "package.json");
  if (!existsSync(pkgJson)) continue;
  const name = JSON.parse(readFileSync(pkgJson, "utf8")).name ?? basename(dir);
  const file = readdirSync(dir).find((f) => LICENSE_RE.test(f));
  if (!file) {
    missing.push(name);
    continue;
  }
  const out = join(outDir, `${name.replace(/[@/]/g, "_")}.txt`);
  copyFileSync(join(dir, file), out);
  copied++;
}

console.log(`collected ${copied} licenses -> ${outDir}`);
if (missing.length) console.log(`no license file: ${missing.join(", ")}`);
