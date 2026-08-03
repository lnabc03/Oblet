// 保存至 Obsidian Vault（批次 7.1）：把当前 md 原文复制到用户配置的 Vault 内目标文件夹。
// 复制语义（原文件不动）；路径规整全兜底——使用者批示"带不带引号、正斜杠反斜杠均可"。
import { invoke } from "@tauri-apps/api/core";
import { currentEditorSettings } from "../settings/typography";
import { confirmDialog, notify } from "../notify";

/** 规整用户随手输入的路径：去首尾空白与成对引号、正斜杠归一为反斜杠、去末尾分隔符 */
export function sanitizePathInput(raw: string): string {
  let s = raw.trim();
  // 成对引号（支持嵌套误输的多次剥离，如 ""D:\Notes""）
  while (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\//g, "\\");
  // 去末尾分隔符；但保留 UNC 根（\\server\share\）与盘符根（C:\）的语义最小形
  while (s.length > 1 && s.endsWith("\\")) s = s.slice(0, -1);
  if (s === "") return "";
  // 盘符根被削成 "C:" 时补回（C: 在 Windows 上是"当前目录"相对语义，不是根）
  if (/^[a-zA-Z]:$/.test(s)) s += "\\";
  return s;
}

/** 保存至 Vault 主流程：导出当前 md 原文；同名冲突弹确认覆盖 */
export async function exportToVault(
  filePath: string,
  content: string
): Promise<void> {
  const raw = currentEditorSettings().vault_dir;
  if (!raw || !raw.trim()) {
    notify("请先到 设置 → 路径 填写另存目标文件夹", "warn");
    return;
  }
  const dir = sanitizePathInput(raw);
  if (!dir) {
    notify("另存路径为空，请到 设置 → 路径 检查", "warn");
    return;
  }
  const fileName = filePath.split(/[\\/]/).pop() ?? "untitled.md";
  try {
    const dest = await invoke<string>("export_to_vault", {
      targetDir: dir,
      fileName,
      content,
      overwrite: false,
    });
    notify(`已保存至 ${dest}`);
  } catch (e) {
    if (String(e) === "EXISTS") {
      // 自绘确认弹窗（原生 window.confirm 是浏览器默认样式，与设计语言不符）
      const ok = await confirmDialog(
        `目标已存在同名文件：\n${dir}\\${fileName}\n\n覆盖它吗？`,
        "覆盖"
      );
      if (!ok) return;
      try {
        const dest = await invoke<string>("export_to_vault", {
          targetDir: dir,
          fileName,
          content,
          overwrite: true,
        });
        notify(`已覆盖保存至 ${dest}`);
      } catch (e2) {
        notify(`保存失败：${e2}`, "error");
      }
    } else {
      notify(`保存失败：${e}`, "error");
    }
  }
}
