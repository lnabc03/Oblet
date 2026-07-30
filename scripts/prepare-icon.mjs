// 图标预处理：边缘白底转透明 + 颜色净化
// 生图模型给的图四角是白底，圆角边缘有一圈"前景色 over 白色"的抗锯齿混合环。
// 直接从边缘泛洪定位整个混合区域，按 O = α·C + (1-α)·255 反解 α，
// 再把像素颜色统一替换为背景色 C —— 消除白色/灰色毛边，边缘平滑无色差。
// 用法：node scripts/prepare-icon.mjs <输入.png> <输出.png>
import sharp from "sharp";

const [, , src, dest] = process.argv;
if (!src || !dest) {
  console.error("用法: node scripts/prepare-icon.mjs <输入.png> <输出.png>");
  process.exit(1);
}

const { data, info } = await sharp(src)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height } = info;
const px = data;
const n = width * height;
const minCh = (i) => Math.min(px[i], px[i + 1], px[i + 2]);

// 1. 估计背景色 C：取暗而均匀的像素（深色圆角方块的底色）的逐通道中位数
const samples = [[], [], []];
for (let p = 0; p < n; p++) {
  const i = p * 4;
  const r = px[i], g = px[i + 1], b = px[i + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 80 && mx - mn < 40) {
    samples[0].push(r);
    samples[1].push(g);
    samples[2].push(b);
  }
}
const median = (arr) => arr.sort((a, b) => a - b)[arr.length >> 1] ?? 0;
const C = [median(samples[0]), median(samples[1]), median(samples[2])];
console.log(`背景色估计: rgb(${C.join(",")})`);

// 2. 从四边泛洪：把所有"比背景明显发白"且与边缘连通的像素标记为混合区
//    （晶体内部高光不与边缘连通，不受影响）
const SEED_DELTA = 8;
const threshold = Math.min(...C) + SEED_DELTA;
const inRegion = new Uint8Array(n);
const queue = [];
const seed = (x, y) => {
  const p = y * width + x;
  if (!inRegion[p] && minCh(p * 4) >= threshold) {
    inRegion[p] = 1;
    queue.push(p);
  }
};
for (let x = 0; x < width; x++) (seed(x, 0), seed(x, height - 1));
for (let y = 0; y < height; y++) (seed(0, y), seed(width - 1, y));
while (queue.length) {
  const p = queue.pop();
  const x = p % width;
  const y = (p - x) / width;
  if (x > 0) seed(x - 1, y);
  if (x < width - 1) seed(x + 1, y);
  if (y > 0) seed(x, y - 1);
  if (y < height - 1) seed(x, y + 1);
}

// 3. 混合区像素：反解 α（三通道平均），颜色替换为背景色
let touched = 0;
for (let p = 0; p < n; p++) {
  if (!inRegion[p]) continue;
  const i = p * 4;
  if (minCh(i) >= 250) {
    px[i + 3] = 0; // 纯白：全透明
    touched++;
    continue;
  }
  let sum = 0, cnt = 0;
  for (let c = 0; c < 3; c++) {
    const denom = 255 - C[c];
    if (denom < 10) continue;
    sum += (255 - px[i + c]) / denom;
    cnt++;
  }
  const alpha = cnt ? Math.max(0, Math.min(1, sum / cnt)) : 0;
  px[i] = C[0];
  px[i + 1] = C[1];
  px[i + 2] = C[2];
  px[i + 3] = Math.round(alpha * 255);
  touched++;
}

await sharp(px, { raw: { width, height, channels: 4 } }).png().toFile(dest);
console.log(`已处理: ${dest}（${width}x${height}，净化混合像素 ${touched} 个）`);
