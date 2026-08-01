// 组包（发布）：干净暂存 → 绿色 zip。本地与 CI 共用同一口径。
// 评审修复轮新增：此前手动对 release/Oblet/ 打 zip，exe 运行时自建的 data/
// （本机个人设置）会被夹带进包；现改为显式拷贝清单（exe + scripts/ 下的
// bat 源 + 现场收集的许可），暂存目录一次一建，污染源到不了 zip。
// 用法: node scripts/pack-zip.mjs
import { spawnSync, execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")
).version;

const exe = join(root, "src-tauri", "target", "release", "oblet.exe");
const stageRoot = join(root, "release", ".staging");
const stage = join(stageRoot, "Oblet");
rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

copyFileSync(exe, join(stage, "oblet.exe"));
// bat 的受控源在 scripts/（release/Oblet/ 副本只是运行时镜像，且 release/ 不入库）
for (const bat of ["register-md.bat", "unregister-md.bat"])
  copyFileSync(join(root, "scripts", bat), join(stage, bat));

// 许可现场收集进暂存（collect-licenses 支持 argv 指定输出目录）
const lic = spawnSync(
  process.execPath,
  [join(root, "scripts", "collect-licenses.mjs"), join(stage, "licenses")],
  { stdio: "inherit" }
);
if (lic.status !== 0) process.exit(lic.status ?? 1);

// 与既往发行口径一致：zip 根即包内容（无顶层文件夹）
const zip = join(root, "release", `Oblet-${version}-win-x64.zip`);
rmSync(zip, { force: true });
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${stage}/*' -DestinationPath '${zip}' -CompressionLevel Optimal"`
);
rmSync(stageRoot, { recursive: true, force: true });
console.log("packed ->", zip);
