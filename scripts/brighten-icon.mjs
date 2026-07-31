// logo 提亮：晶体中调伽马提升 + 饱和增强，深色背景不动
// 问题：晶体暗面与深色圆角底亮度接近，小尺寸下图标糊成一团暗色，只有细棱线可见。
// 做法：逐像素按亮度区分——背景（max<=50）原样；晶体像素做 gamma 0.65 提升（中调大幅变亮、
// 高光渐近 255 不硬切），再沿灰度轴外扩 1.3 倍提饱和，让紫调更跳。
// 用法：node scripts/brighten-icon.mjs <输入.png> <输出.png> [gamma] [饱和]
import sharp from "sharp";

const [, , src, dest, gammaArg, satArg] = process.argv;
if (!src || !dest) {
  console.error("用法: node scripts/brighten-icon.mjs <输入.png> <输出.png> [gamma=0.65] [饱和=1.3]");
  process.exit(1);
}
const GAMMA = gammaArg ? Number(gammaArg) : 0.65;
const SAT = satArg ? Number(satArg) : 1.3;
const BG_MAX = 50; // 背景亮度上限（圆角底约 rgb(20,18,37)）

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
const px = data;
let lifted = 0;

for (let i = 0; i < px.length; i += 4) {
  if (px[i + 3] === 0) continue;
  const mx = Math.max(px[i], px[i + 1], px[i + 2]);
  if (mx <= BG_MAX) continue;
  // 半透明边缘像素同样提亮（颜色已是背景色，提亮后边缘更亮，与晶体一致）
  const mean = (px[i] + px[i + 1] + px[i + 2]) / 3;
  for (let c = 0; c < 3; c++) {
    const liftedC = 255 * Math.pow(px[i + c] / 255, GAMMA);
    px[i + c] = Math.max(0, Math.min(255, Math.round(mean + (liftedC - mean) * SAT)));
  }
  lifted++;
}

await sharp(px, { raw: { width, height, channels: 4 } }).png().toFile(dest);
console.log(`已提亮: ${dest}（gamma=${GAMMA} 饱和=${SAT}，处理像素 ${lifted} 个）`);
