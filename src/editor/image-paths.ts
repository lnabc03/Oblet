// 图片路径工具（v0.7.0）：渲染侧 toDomUrl（setup.ts）、块级图片路径编辑/失败占位
// （image-edit.ts）、右键批量转相对路径（contextmenu.ts / setup.ts localizeImages）
// 三处共用同一套判定与解析，避免口径漂移
// D12 起兼作前端路径共享层：pathKey 供 tabs.ts 缓存键与 setup.ts 路径比较使用
import type { Node as PMNode } from "@milkdown/prose/model";

/** 文件系统大小写不敏感平台（仅 Windows 小写归一；Android/Linux 区分大小写，macOS 适配时再议） */
export const FS_CASE_INSENSITIVE = /Windows/i.test(navigator.userAgent);

/** 路径比较键：分隔符统一为 /；Windows 另做小写归一，其余平台保持原样（区分大小写） */
export function pathKey(p: string): string {
  const n = p.replace(/\\/g, "/");
  return FS_CASE_INSENSITIVE ? n.toLowerCase() : n;
}

/** 网络/data/blob/asset 协议原样放行，不做本地解析 */
export const REMOTE_SRC_RE = /^(https?:|data:|blob:|asset:|tauri:)/i;
/** 本地绝对路径：盘符（C:\ / C:/）、UNC（\\host\share）、根相对（/） */
export const ABS_PATH_RE = /^([a-zA-Z]:[\\/]|\\\\|\/)/;

export function decodeMaybe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function dirnameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i < 0 ? p : p.slice(0, i);
}

/** 拼合 dir 与 rel 并归一化 . / .. 段。D12：输出统一以 / 分隔
 * （Windows API 与 Rust Path 均接受正斜杠，POSIX 平台必需）；保留盘符与 UNC 前缀 */
export function joinResolve(dir: string, rel: string): string {
  const combined = `${dir}/${rel}`;
  const unc = /^[\\/]{2}/.test(combined);
  const posixRoot = !unc && combined.startsWith("/");
  const parts = combined.split(/[\\/]+/).filter(Boolean);
  // 锚点段数：UNC 主机/共享名占 2、盘符占 1，均不可被 .. 弹出；POSIX 根无锚段
  const anchor = unc ? 2 : /^[a-zA-Z]:$/.test(parts[0] ?? "") ? 1 : 0;
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (out.length > anchor) out.pop();
      continue;
    }
    out.push(seg);
  }
  const prefix = unc ? "//" : posixRoot ? "/" : "";
  return prefix + out.join("/");
}

/** 本地路径解析：远程/空 src 返回 null；否则返回绝对路径（相对路径按文档目录解析） */
export function resolveLocalAbs(src: string, docPath: string): string | null {
  if (!src || REMOTE_SRC_RE.test(src)) return null;
  const decoded = decodeMaybe(src);
  return ABS_PATH_RE.test(decoded)
    ? decoded
    : joinResolve(dirnameOf(docPath), decoded);
}

/** 是否为本地绝对路径引用（批量转换的收纳判定；%XX 编码形式先解码再判） */
export function isAbsoluteLocalSrc(src: string): boolean {
  if (!src || REMOTE_SRC_RE.test(src)) return false;
  return ABS_PATH_RE.test(decodeMaybe(src));
}

/** 文档中是否存在本地绝对路径图片（块级 image-block + 行内 image），右键菜单置灰用 */
export function docHasAbsoluteImages(doc: PMNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (
      (node.type.name === "image-block" || node.type.name === "image") &&
      isAbsoluteLocalSrc((node.attrs.src as string) ?? "")
    ) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}
