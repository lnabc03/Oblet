// theme.css 轻量 sanitize
// 放行：https 字体/图片资源（含 fonts.googleapis.com 的 @import）
// 拦截：url(javascript:...) 与非白名单的远程 @import
const IMPORT_ALLOWLIST = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "fastly.jsdelivr.net",
];

export function sanitizeCss(css: string): string {
  // 1. javascript: 伪协议一律清除
  let out = css.replace(
    /url\(\s*(['"]?)\s*javascript:[^)]*\)/gi,
    "url(about:blank)"
  );

  // 2. 远程 @import：白名单字体源放行，其余剔除（保留本地相对路径 @import）
  out = out.replace(
    /@import\s+(?:url\(\s*)?(['"]?)(https?:\/\/[^'")]+)\1\s*\)?\s*;/gi,
    (whole, _q, url: string) => {
      try {
        const host = new URL(url).host;
        if (IMPORT_ALLOWLIST.some((h) => host === h || host.endsWith("." + h))) {
          return whole; // 放行
        }
      } catch {
        /* 无法解析的 URL 按拦截处理 */
      }
      return `/* [oblet] blocked remote @import: ${url} */`;
    }
  );

  return out;
}
