// 批次 6 出口审计：zip 内容完整性校验（一次性，随审随用）
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "oblet-audit-"));
execSync(
  `powershell -NoProfile -Command "Expand-Archive -Path 'release/Oblet-0.1.0-win-x64.zip' -DestinationPath '${tmp.replace(/\\/g, "/")}' -Force"`
);
const md5 = (p) => createHash("md5").update(readFileSync(p)).digest("hex");
const zipExe = md5(join(tmp, "oblet.exe"));
const buildExe = md5("src-tauri/target/release/oblet.exe");
console.log("zip 内 exe MD5 :", zipExe);
console.log("构建产物 MD5   :", buildExe);
console.log(zipExe === buildExe ? "MATCH: zip 内 exe 即当前构建产物" : "MISMATCH!");
console.log("licenses 份数  :", readdirSync(join(tmp, "licenses")).length);
console.log(
  "bat 脚本       :",
  ["register-md.bat", "unregister-md.bat"].every((f) => existsSync(join(tmp, f)))
    ? "齐全"
    : "缺失"
);
rmSync(tmp, { recursive: true, force: true });
