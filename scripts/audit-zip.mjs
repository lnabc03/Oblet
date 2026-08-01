// 出口审计：zip 内容完整性校验（随审随用；任一检查 FAIL 即退出码 1，可作发布硬闸门）
// 用法: node scripts/audit-zip.mjs [zip 路径]（缺省按 tauri.conf.json 版本号定位）
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")
).version;
const zipPath =
  process.argv[2] ?? join(root, "release", `Oblet-${version}-win-x64.zip`);
if (!existsSync(zipPath)) {
  console.error("zip 不存在:", zipPath);
  process.exit(1);
}

let failed = false;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` : ${detail}` : ""}`);
  if (!ok) failed = true;
};

const tmp = mkdtempSync(join(tmpdir(), "oblet-audit-"));
execSync(
  `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmp.replace(/\\/g, "/")}' -Force"`
);
const md5 = (p) => createHash("md5").update(readFileSync(p)).digest("hex");
const zipExe = md5(join(tmp, "oblet.exe"));
const buildExe = md5(join(root, "src-tauri", "target", "release", "oblet.exe"));
check("zip 内 exe 即当前构建产物", zipExe === buildExe, zipExe);
const licCount = readdirSync(join(tmp, "licenses")).length;
check("licenses 份数 >= 200", licCount >= 200, String(licCount));
check(
  "bat 脚本齐全",
  ["register-md.bat", "unregister-md.bat"].every((f) => existsSync(join(tmp, f)))
);
// 绿色包不得夹带本机个人设置——曾因 release/Oblet/data 残留把私人字体/键位
// 覆盖/auto_save=false 打进 zip；data/ 由运行时自建，打包不带（查整个目录，
// 不限 settings.json 单文件；现由 pack-zip.mjs 干净暂存根治）
check("个人设置泄漏（data/ 目录）", !existsSync(join(tmp, "data")));
rmSync(tmp, { recursive: true, force: true });

process.exit(failed ? 1 : 0);
